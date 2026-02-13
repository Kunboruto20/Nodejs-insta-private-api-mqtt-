'use strict';

/*
  RealtimeClient
  --------------
  This file implements the RealtimeClient which manages:
    - constructing the FBNS/MQTT connection payload (Thrift)
    - starting the MQTT client (MQTToTClient)
    - attaching lifecycle handlers (connect/close/error)
    - keepalives, message-sync refresh and traffic watchdogs
    - wiring MQTT messages into higher-level events (message, iris, receive)

  The implementation keeps original structure while applying compatibility tweaks:
    - persistent clientMqttSessionId and client_context handling
    - robust sessionid / mqttJwt / deviceSecret fallbacks
    - slightly adjusted appSpecificInfo to match mobile client fields
    - uses mqttot.MQTToTConnection to build a thrift connection payload
    - MQTT URL remains 'edge-mqtt.facebook.com' (Instagram/Meta edge host)

  Additional improvements added to keep bots alive across long idle periods:
    - persistent mqtt-session load/save on disk at startup & after connect
    - heartbeat improvements: MQTT-level ping (if available), numeric-topic pings and foreground keepalive
    - credential refresh hook (if auth helper exposes refreshMqttAuth or similar)
    - robust reconnect loop with exponential backoff and credential refresh attempts
    - enhanced logging and defensive guards so long-idle reconnections work better
*/

// Keep module imports similar to your original code
const constants_1 = require("../constants");
const commands_1 = require("./commands");
const shared_1 = require("../shared");
const mqttot_1 = require("../mqttot");
// Use mqtts for errors / IllegalStateError compatibility
const mqtts_1 = require("mqtts");
const errors_1 = require("../errors");
const eventemitter3_1 = require("eventemitter3");
const mixins_1 = require("./mixins");
const iris_handshake_1 = require("./protocols/iris.handshake");
const skywalker_protocol_1 = require("./protocols/skywalker.protocol");
const presence_manager_1 = require("./features/presence.manager");
const dm_sender_1 = require("./features/dm-sender");
const error_handler_1 = require("./features/error-handler");
const gap_handler_1 = require("./features/gap-handler");
const enhanced_direct_commands_1 = require("./commands/enhanced.direct.commands");
const presence_typing_mixin_1 = require("./mixins/presence-typing.mixin");
const { SessionHealthMonitor } = require("./features/session-health-monitor");
const { PersistentLogger } = require("./features/persistent-logger");
const fs = require('fs');
const path = require('path');

// Use INSTAGRAM_VERSION exported from mqttot so it is applied automatically where available
const INSTAGRAM_VERSION = mqttot_1.INSTAGRAM_VERSION;

/**
 * RealtimeClient
 * - Extends EventEmitter to emit high-level events for consumers.
 * - Responsible for constructing the thrift payload, creating the MQTToTClient and wiring its events.
 */
class RealtimeClient extends eventemitter3_1.EventEmitter {
    // getter to expose the underlying mqtt client instance
    get mqtt() {
        return this._mqtt;
    }

    /**
     * constructor(ig, mixins)
     * - ig: instance of instagram client (used for building payloads & fetching inbox)
     * - mixins: collection of mixins applied to this realtime client (message-sync, realtime-sub, presence/typing)
     */
    constructor(ig, mixins = [new mixins_1.MessageSyncMixin(), new mixins_1.RealtimeSubMixin(), new presence_typing_mixin_1.PresenceTypingMixin()]) {
        super();
        // debug helpers
        this.realtimeDebug = (0, shared_1.debugChannel)('realtime');
        this.messageDebug = this.realtimeDebug.extend('message');

        // enhanced direct commands debug (exposed for compatibility with the enhanced commands)
        this.enhancedDebug = this.realtimeDebug.extend('enhanced-commands');

        // safeDisconnect flag used when user intentionally disconnects
        this.safeDisconnect = false;

        // convenience wrappers to emit events
        this.emitError = (e) => this.emit('error', e);
        this.emitWarning = (e) => this.emit('warning', e);

        // persistent references
        this.ig = ig;
        this.threads = new Map();

        // instantiate features / protocols / mixins
        this.irisHandshake = new iris_handshake_1.IrisHandshake(this);
        this.skywalkerProtocol = new skywalker_protocol_1.SkywalkerProtocol(this);
        this.presenceManager = new presence_manager_1.PresenceManager(this);
        this.dmSender = new dm_sender_1.DMSender(this);
        this.errorHandler = new error_handler_1.ErrorHandler(this);
        this.gapHandler = new gap_handler_1.GapHandler(this);
        this.directCommands = new enhanced_direct_commands_1.EnhancedDirectCommands(this);

        // Add transaction and ordering capability
        try {
            const { addTransactionCapability } = require('../utils/insta-mqtt-helper');
            addTransactionCapability(this);
        } catch (e) {
            this.realtimeDebug('Failed to add transaction capability:', e.message);
        }

        this.realtimeDebug(`Applying mixins: ${mixins.map(m => m.name).join(', ')}`);
        // apply mixins to this instance (keeps modular features separated)
        (0, mixins_1.applyMixins)(mixins, this, this.ig);

        // Default subscriptions (force-enable if saved ones are empty)
        this.defaultGraphQlSubs = ['ig_sub_direct', 'ig_sub_direct_v2_message_sync'];
        this.defaultSkywalkerSubs = ['presence_subscribe', 'typing_subscribe'];

        // internal flags & timers
        this._attachedAuthState = null;
        this._messageSyncAttached = false;
        this._reconnectInProgress = false;
        this._lastMessageAt = Date.now();
        this._foregroundTimer = null;
        this._syncTimer = null;
        this._trafficWatchdog = null;
        this._heartbeatTimer = null; // new: heartbeat timer
        this._reconnectDebounceMs = 500;
        this._reconnectTimeoutId = null;

        // MQTT session tracking & persistence
        this._mqttSessionId = null; // actual server-provided mqtt session id (string)
        this._mqttSessionPersistIntervalId = null; // periodic persist interval handler

        // Active keepalive/query timer (added)
        this._activeKeepaliveTimer = null;

        // Timer for credential refresh
        this._mqttAuthRefreshTimer = null;

        // Session health monitor (initialized on connect with enableHealthMonitor option)
        this.healthMonitor = null;
        // Persistent logger (initialized on connect with enablePersistentLogger option)
        this.persistentLogger = null;

        // Persisted identity items that must survive reconnects:
        // - clientMqttSessionId must NOT be re-generated each connect
        // - _clientContext for EnhancedDirectCommands (for message identity)
        if (!this._clientMqttSessionId) {
            // generate once for lifetime of this RealtimeClient instance
            try {
                this._clientMqttSessionId = (BigInt(Date.now()) & BigInt(0xffffffff));
            } catch (e) {
                this._clientMqttSessionId = BigInt(0);
            }
        }
        if (!this._clientContext) {
            // persistent client_context for message sends — single per session
            try {
                this._clientContext = require('uuid').v4();
            } catch (e) {
                this._clientContext = `cc_${Date.now()}`;
            }
        }

        //
        // AUTH/PERSISTENCE FOLDER RESOLUTION
        // - unify folder selection so we don't miss persisted mqtt-session.json saved under
        //   different folder names in various versions.
        //
        try {
            const candidates = ['./authinfo_instagram', './auth_info_ig', './auth_info_ig'];
            let chosen = null;
            for (const c of candidates) {
                try {
                    if (fs.existsSync(c)) {
                        chosen = c;
                        break;
                    }
                } catch (e) {}
            }
            if (!chosen) chosen = './authinfo_instagram';
            this._authFolder = chosen;
        } catch (e) {
            this._authFolder = './authinfo_instagram';
        }

        // attempt to load persisted mqtt-session information (if available) to keep continuity across restarts
        try {
            this._loadPersistedMqttSession();
        } catch (e) {
            this.realtimeDebug('[MQTT] loadPersistedMqttSession failed:', e?.message || e);
        }

        // auto-connect block preserved (no change)
        const { useMultiFileAuthState } = require('../useMultiFileAuthState');

        /**
         * waitForMqttCredentials(auth, timeoutMs, pollMs)
         * - Poll the auth state for device / mqtt credentials before proceeding with auto-connect.
         * - This ensures the saved auth state contains the fields required to build the MQTT payload.
         */
        const waitForMqttCredentials = async (auth, timeoutMs = 15000, pollMs = 250) => {
            const start = Date.now();
            const hasCreds = () => {
                try {
                    const d = (auth && typeof auth.getData === 'function') ? auth.getData() : (auth && auth.data ? auth.data : null);
                    if (!d) return false;
                    if (d.device && (d.device.deviceSecret || d.device.secret)) return true;
                    if (d.mqttAuth && (d.mqttAuth.jwt || d.mqttAuth.deviceSecret)) return true;
                    if (d.creds && (d.creds.sessionId || d.creds.csrfToken || d.creds.authorization)) return true;
                    return false;
                } catch (e) {
                    return false;
                }
            };
            while (Date.now() - start < timeoutMs) {
                if (hasCreds()) return true;
                await new Promise(r => setTimeout(r, pollMs));
            }
            return false;
        };

        // Auto-start if saved creds exist on disk (non-blocking)
        if (fs.existsSync(path.join(this._authFolder, 'creds.json'))) {
            setTimeout(async () => {
                try {
                    if (this._mqttConnected || this._connectInProgress) {
                        console.log('[REALTIME] Auto-start skipped — MQTT already connected or connect in progress.');
                        return;
                    }
                    const auth = await useMultiFileAuthState(this._authFolder);
                    this._attachedAuthState = auth;
                    if (auth.hasSession && auth.hasSession()) {
                        if (this._mqttConnected || this._connectInProgress) {
                            console.log('[REALTIME] Auto-start skipped (after auth load) — MQTT already connected or connect in progress.');
                            return;
                        }
                        console.log('[REALTIME] Auto-start candidate session detected — loading creds...');
                        try {
                            await auth.loadCreds(this.ig);
                        } catch (e) {
                            console.warn('[REALTIME] loadCreds warning:', e?.message || e);
                        }
                        const ready = await waitForMqttCredentials(auth, 20000, 300);
                        if (!ready) {
                            console.warn('[REALTIME] MQTT/device credentials not found within timeout — auto-connect aborted (will still allow manual connect).');
                            return;
                        }
                        if (this._mqttConnected || this._connectInProgress) {
                            console.log('[REALTIME] Auto-start skipped (after wait) — MQTT already connected or connect in progress.');
                            return;
                        }
                        console.log('[REALTIME] Device/MQTT credentials present — attempting connectFromSavedSession...');
                        try {
                            await this.connectFromSavedSession(auth);
                        } catch (e) {
                            console.error('[REALTIME] Constructor auto-connect failed:', e?.message || e);
                        }
                    }
                } catch (e) {
                    console.error('[REALTIME] Constructor auto-start exception:', e?.message || e);
                }
            }, 100);
        }
    }

    /**
     * _loadPersistedMqttSession()
     * - Attempt to read <authFolder>/mqtt-session.json on startup and restore
     *   client-generated ids so the client can reuse previous session identifiers.
     */
    _loadPersistedMqttSession() {
        try {
            const folder = this._authFolder || './authinfo_instagram';
            const file = path.join(folder, 'mqtt-session.json');
            if (!fs.existsSync(file)) return false;
            const raw = fs.readFileSync(file, { encoding: 'utf8' });
            const data = JSON.parse(raw);
            if (data && data.mqttSessionId) {
                // restore clientMqttSessionId (if possible)
                try {
                    // prefer to set local client id if server one is missing
                    this._mqttSessionId = data.sessionId || null;
                    if (!this._clientMqttSessionId && data.mqttSessionId) {
                        // preserve numeric/persistent value as BigInt if possible
                        try {
                            this._clientMqttSessionId = BigInt(data.mqttSessionId);
                        } catch (e) {
                            // leave as-is if not parseable
                        }
                    }
                    this.realtimeDebug('[MQTT] Loaded persisted mqtt session data from disk.');
                    return true;
                } catch (e) {}
            }
        } catch (e) {
            this.realtimeDebug('[MQTT] _loadPersistedMqttSession error', e?.message || e);
        }
        return false;
    }

    /**
     * startRealTimeListener(options)
     * - Convenience method to fetch initial inbox (IRIS) and connect with those subscriptions.
     */
    async startRealTimeListener(options = {}) {
        this._connectInProgress = true;
        try {
            console.log('[REALTIME] Starting Real-Time Listener...');
            console.log('[REALTIME] Fetching inbox (IRIS data)...');
            const inboxData = await this.ig.direct.getInbox();
            console.log('[REALTIME] Connecting to MQTT with IRIS subscription...');
            await this.connect({
                graphQlSubs: [
                    'ig_sub_direct',
                    'ig_sub_direct_v2_message_create',
                ],
                skywalkerSubs: [
                    'presence_subscribe',
                    'typing_subscribe',
                ],
                irisData: inboxData
            });
            console.log('[REALTIME] MQTT Connected with IRIS');
            console.log('----------------------------------------');
            console.log('[REALTIME] Real-Time Listener ACTIVE');
            console.log('[REALTIME] Waiting for messages...');
            console.log('----------------------------------------');
            this._setupMessageHandlers();

            if (options.enableHealthMonitor !== false) {
                this.enableHealthMonitor(options.healthMonitorOptions || options);
            }
            if (options.enablePersistentLogger || options.logDir) {
                this.enablePersistentLogger(options.persistentLoggerOptions || options);
            }

            return { success: true };
        } catch (error) {
            console.error('[REALTIME] Failed:', error.message);
            throw error;
        }
    }

    _setupMessageHandlers() {
        this.on('message', (data) => {
            const msg = this._parseMessage(data);
            if (msg) this.emit('message_live', msg);
        });
        this.on('iris', (data) => {
            const msg = this._parseIrisMessage(data);
            if (msg) this.emit('message_live', msg);
        });
        this.on('receive', (topic, messages) => {
            try {
                const topicPath = topic.path || '';
                for (const msg of (Array.isArray(messages) ? messages : [messages])) {
                    const data = msg?.data || msg;
                    if (!data) continue;
                    switch (topicPath) {
                        case '/ig_msg_dr':
                            this.emit('deliveryReceipt', {
                                threadId: data.thread_id || data.threadId,
                                itemId: data.item_id || data.itemId,
                                userId: data.user_id || data.userId,
                                timestamp: data.timestamp || Date.now(),
                                raw: data,
                            });
                            break;
                        case '/ig_conn_update':
                            this.emit('connectionUpdate', {
                                type: data.type || data.event,
                                reason: data.reason,
                                raw: data,
                            });
                            break;
                        case '/notify_disconnect':
                            this.emit('notifyDisconnect', {
                                reason: data.reason || data.message,
                                code: data.code,
                                raw: data,
                            });
                            break;
                        case '/t_thread_typing':
                            this.emit('threadTyping', {
                                threadId: data.thread_id || data.threadId,
                                userId: data.user_id || data.sender_id,
                                isTyping: data.activity_status !== undefined ? data.activity_status === 1 : (data.is_typing !== false),
                                timestamp: data.timestamp || Date.now(),
                                raw: data,
                            });
                            break;
                        case '/iris_server_reset':
                            this.realtimeDebug('[IRIS] Server reset received, re-subscribing...');
                            this.emit('irisServerReset', { raw: data });
                            this._handleIrisReset();
                            break;
                        case '/t_ig_family_navigation_badge':
                            this.emit('badgeCount', {
                                count: data.badge_count ?? data.count ?? data.total,
                                dmCount: data.dm_count ?? data.direct_count,
                                activityCount: data.activity_count,
                                raw: data,
                            });
                            break;
                        case '/t_entity_presence':
                            this.emit('entityPresence', {
                                userId: data.user_id || data.entity_id,
                                isActive: data.is_active ?? data.active ?? false,
                                lastActivityAt: data.last_activity_at_ms || data.last_activity_at,
                                raw: data,
                            });
                            break;
                        case '/opened_thread':
                            this.emit('threadOpened', {
                                threadId: data.thread_id || data.threadId,
                                userId: data.user_id,
                                raw: data,
                            });
                            break;
                        case '/buddy_list':
                            this.emit('buddyList', {
                                users: data.overlay || data.buddies || data,
                                raw: data,
                            });
                            break;
                        case '/webrtc':
                        case '/webrtc_response':
                            this.emit('callEvent', {
                                type: data.event || data.type || (topicPath === '/webrtc' ? 'offer' : 'answer'),
                                callId: data.call_id || data.video_call_id,
                                peerId: data.peer_id || data.caller_id || data.user_id,
                                sdp: data.sdp,
                                raw: data,
                            });
                            break;
                        case '/onevc':
                            this.emit('callEvent', {
                                type: data.event || data.action || 'onevc',
                                callId: data.call_id || data.video_call_id,
                                peerId: data.peer_id || data.caller_id,
                                raw: data,
                            });
                            break;
                        case '/graphql':
                            this._handleGraphQLEvent(data);
                            break;
                        case '/pubsub':
                            this._handlePubsubEvent(data);
                            break;
                    }
                }
            } catch (e) {
                this.realtimeDebug('[EVENT_HANDLER] Error processing topic event:', e?.message || e);
            }
        });
    }

    async _handleIrisReset() {
        try {
            this.realtimeDebug('[IRIS_RESET] Attempting to re-subscribe after server reset...');
            const inboxData = await this.ig.direct.getInbox();
            if (inboxData) {
                await this.irisSubscribe(inboxData);
                this.realtimeDebug('[IRIS_RESET] Re-subscribed successfully');
            }
        } catch (e) {
            this.realtimeDebug('[IRIS_RESET] Failed to re-subscribe:', e?.message || e);
        }
    }

    _handleGraphQLEvent(data) {
        try {
            const json = data.json || data;
            const event = json?.event || json?.data?.event;
            const payload = json?.data || json;
            if (!payload) return;

            if (payload.live_broadcast_comments) {
                this.emit('liveComment', {
                    broadcastId: payload.broadcast_id,
                    comments: payload.live_broadcast_comments,
                    raw: payload,
                });
            }
            if (payload.live_broadcast_like_count !== undefined) {
                this.emit('liveLikeCount', {
                    broadcastId: payload.broadcast_id,
                    likeCount: payload.live_broadcast_like_count,
                    raw: payload,
                });
            }
            if (payload.live_broadcast_wave) {
                this.emit('liveWave', {
                    broadcastId: payload.broadcast_id,
                    wave: payload.live_broadcast_wave,
                    raw: payload,
                });
            }
            if (payload.live_broadcast_typing_indicator) {
                this.emit('liveTyping', {
                    broadcastId: payload.broadcast_id,
                    userId: payload.user_id,
                    raw: payload,
                });
            }
            if (payload.live_viewer_count !== undefined) {
                this.emit('liveViewerCount', {
                    broadcastId: payload.broadcast_id,
                    viewerCount: payload.live_viewer_count,
                    raw: payload,
                });
            }
            if (payload.media_feedback || payload.feedback_action) {
                this.emit('mediaFeedback', {
                    mediaId: payload.media_id || payload.feedback_id,
                    action: payload.feedback_action || payload.action_type,
                    userId: payload.user_id,
                    raw: payload,
                });
            }
            if (payload.direct_typing || payload.activity_indicator_id) {
                this.emit('directTyping', {
                    userId: payload.user_id || payload.sender_id,
                    threadId: payload.thread_id || payload.activity_indicator_id,
                    timestamp: payload.timestamp,
                    raw: payload,
                });
            }
            if (payload.presence_event || payload.user_presence) {
                this.emit('appPresence', {
                    userId: payload.user_id,
                    isActive: payload.is_active ?? payload.active,
                    lastActivityAt: payload.last_activity_at_ms,
                    raw: payload,
                });
            }
            if (payload.direct_status) {
                this.emit('directStatus', payload);
            }
            if (payload.interactivity) {
                this.emit('liveInteractivity', {
                    broadcastId: payload.broadcast_id,
                    data: payload.interactivity,
                    raw: payload,
                });
            }
            if (payload.video_call_participant_state) {
                this.emit('callStateChange', {
                    callId: payload.video_call_id,
                    participants: payload.video_call_participant_state,
                    raw: payload,
                });
            }
            this.emit('graphqlEvent', { event, payload, raw: data });
        } catch (e) {
            this.realtimeDebug('[GRAPHQL_EVENT] Parse error:', e?.message || e);
        }
    }

    _handlePubsubEvent(data) {
        try {
            const json = data.json || data;
            const payload = json?.data || json;
            if (!payload) return;

            if (payload.doublePublish) return;

            if (payload.event === 'patch' || payload.op) {
                this.emit('direct', {
                    op: payload.op,
                    path: payload.path,
                    value: payload.value,
                    threadId: payload.thread_id,
                    raw: payload,
                });
            }
            if (payload.activity_indicator_id || (payload.event === 'typing')) {
                this.emit('directTyping', {
                    userId: payload.user_id || payload.sender_id,
                    threadId: payload.thread_id || payload.activity_indicator_id,
                    isTyping: payload.activity_status !== 0,
                    raw: payload,
                });
            }
            this.emit('pubsubEvent', { payload, raw: data });
        } catch (e) {
            this.realtimeDebug('[PUBSUB_EVENT] Parse error:', e?.message || e);
        }
    }

    // Parse a standard realtime message packet into a simplified message object
    _parseMessage(data) {
        try {
            const msg = data.message;
            if (!msg) return null;
            if (data.parsed) return data.parsed;
            const threadInfo = this.threads.get(msg.thread_id);
            return {
                id: msg.item_id || msg.id,
                userId: msg.user_id || msg.from_user_id,
                username: msg.username || msg.from_username || `user_${msg.user_id || 'unknown'}`,
                text: msg.text || msg.body || '',
                itemType: msg.item_type || 'text',
                thread: threadInfo?.title || `Thread ${msg.thread_id}`,
                thread_id: msg.thread_id,
                timestamp: msg.timestamp,
                isGroup: threadInfo?.isGroup,
                status: 'good'
            };
        } catch (e) {
            return null;
        }
    }

    // Parse IRIS message data into a simplified message object
    _parseIrisMessage(data) {
        try {
            if (data.event !== 'message_create' && !data.type?.includes('message')) return null;
            return {
                id: data.item_id || data.id,
                userId: data.user_id || data.from_user_id,
                username: data.username || data.from_username || `user_${data.user_id || 'unknown'}`,
                text: data.text || '',
                itemType: data.item_type || 'text',
                thread_id: data.thread_id,
                timestamp: data.timestamp,
                status: 'good'
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * setInitOptions(initOptions)
     * - Normalizes init options for connect calls (accepts array or object)
     */
    setInitOptions(initOptions) {
        if (Array.isArray(initOptions))
            initOptions = { graphQlSubs: initOptions };
        this.initOptions = {
            graphQlSubs: [],
            skywalkerSubs: [],
            ...(initOptions || {}),
            socksOptions: typeof initOptions === 'object' && !Array.isArray(initOptions) ? initOptions.socksOptions : undefined,
        };
    }

    // Extract session ID from a JWT-like authorization header if present
    extractSessionIdFromJWT() {
        try {
            const authHeader = this.ig.state.authorization;
            if (!authHeader) return null;
            const raw = String(authHeader || '');
            const candidate = raw.replace(/^Bearer\s*/i, '').replace(/^IGT:2:/i, '');
            if (candidate.includes('.')) {
                const parts = candidate.split('.');
                if (parts.length >= 2) {
                    try {
                        const payload = Buffer.from(parts[1], 'base64').toString('utf8');
                        const parsed = JSON.parse(payload);
                        return parsed.sessionid || parsed.session_id || parsed.session || null;
                    } catch (e) {}
                }
            }
            try {
                const decoded = Buffer.from(candidate, 'base64').toString('utf8');
                const parsed = JSON.parse(decoded);
                return parsed.sessionid || parsed.session_id || null;
            } catch (e) {}
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * constructConnection()
     * - Build the MQTToTConnection payload (thrift object) used to connect.
     * - Pulls deviceId, sessionid, device secrets and app-specific headers to populate the payload.
     */
    constructConnection() {
        // Choose the best available user agent value from state fallbacks
        const userAgent =
            typeof this.ig.state.userAgent === 'string'
                ? this.ig.state.userAgent
                : typeof this.ig.state.appUserAgent === 'string'
                    ? this.ig.state.appUserAgent
                    : typeof this.ig.state.deviceString === 'string'
                        ? this.ig.state.deviceString
                        : 'Instagram 415.0.0.36.76 Android (34/14; 420dpi; 1080x2340; samsung; SM-S911B; e1s; exynos2400; en_US; 580610226)';

        // deviceId / phoneId fallback handling (string coercion)
        const deviceId = String(this.ig.state.phoneId || this.ig.state.deviceId || 'device_unknown');

        // attempt to extract sessionid from various locations: Authorization JWT, cookie helpers, state fields, or cookie jar
        let sessionid = null;
        try {
            sessionid = this.extractSessionIdFromJWT();
        } catch (e) { sessionid = null; }

        if (!sessionid) {
            try {
                if (typeof this.ig.state.extractCookieValue === 'function') {
                    sessionid = this.ig.state.extractCookieValue('sessionid');
                }
            } catch (e) { sessionid = null; }
        }

        if (!sessionid) {
            try {
                sessionid = this.ig.state.sessionId || this.ig.state.sessionid || this.ig.state.cookies?.sessionid || null;
            } catch (e) { sessionid = null; }
        }

        if (!sessionid) {
            try {
                if (this.ig.state.cookieJar && typeof this.ig.state.cookieJar.getCookiesSync === 'function') {
                    const cookies = this.ig.state.cookieJar.getCookiesSync('https://i.instagram.com/') || [];
                    const found = cookies.find(c => (c.key === 'sessionid' || c.name === 'sessionid'));
                    if (found) sessionid = found.value;
                }
            } catch (e) {}
        }

        // fallback sessionid generation — only used if nothing else found
        if (!sessionid) {
            const userId = this.ig.state.cookieUserId || this.ig.state.userId || '0';
            sessionid = String(userId) + '_' + Date.now();
            this.realtimeDebug(`SessionID generated (fallback): ${sessionid}`);
        }

        // device secret retrieval (from attached auth helper or state)
        let deviceSecret = null;
        try {
            if (this._attachedAuthState && typeof this._attachedAuthState.getData === 'function') {
                const d = this._attachedAuthState.getData();
                if (d && d.device && (d.device.deviceSecret || d.device.secret)) {
                    deviceSecret = d.device.deviceSecret || d.device.secret;
                }
                if (!deviceSecret && d && d.mqttAuth && (d.mqttAuth.deviceSecret || d.mqttAuth.secret)) {
                    deviceSecret = d.mqttAuth.deviceSecret || d.mqttAuth.secret;
                }
            }
        } catch (e) {}
        try {
            if (!deviceSecret && (this.ig.state.deviceSecret || this.ig.state.mqttDeviceSecret)) {
                deviceSecret = this.ig.state.deviceSecret || this.ig.state.mqttDeviceSecret;
            }
        } catch (e) {}

        // mqtt JWT token if available (preferred)
        let mqttJwt = null;
        try {
            if (this._attachedAuthState && typeof this._attachedAuthState.getData === 'function') {
                const d = this._attachedAuthState.getData();
                if (d && d.mqttAuth && d.mqttAuth.jwt) mqttJwt = d.mqttAuth.jwt;
            }
            if (!mqttJwt && this.ig.state.mqttJwt) mqttJwt = this.ig.state.mqttJwt;
        } catch (e) {}

        // password is either "jwt=..." or "sessionid=..."
        let password;
        if (mqttJwt) {
            password = `jwt=${mqttJwt}`;
        } else {
            password = `sessionid=${sessionid}`;
        }

        // client type indicates if device secret is available
        const clientType = deviceSecret ? 'secure_cookie_auth' : 'cookie_auth';

        // IMPORTANT: keep clientMqttSessionId persistent across reconnects (already set in constructor)
        if (!this._clientMqttSessionId) {
            try {
                this._clientMqttSessionId = (BigInt(Date.now()) & BigInt(0xffffffff));
            } catch (e) {
                this._clientMqttSessionId = BigInt(0);
            }
        }
        const clientMqttSessionId = this._clientMqttSessionId;

        const subscribeTopics = [88, 135, 149, 150, 133, 146, 165, 164, 176, 195, 141, 152, 160, 139, 0, 62, 63, 211];

        // Build the thrift connection object using mqttot.MQTToTConnection
        // NOTE: use deviceId.substring(0,20) for clientIdentifier because the mobile app often truncates it.
        //       endpointCapabilities set to 128 for broader compatibility (some clients use 0, 128 provides better capability advertising).
        this.connection = new mqttot_1.MQTToTConnection({
            clientIdentifier: deviceId.substring(0, 20),
            clientInfo: {
                userId: BigInt(Number(this.ig.state.cookieUserId || this.ig.state.userId || 0)),
                userAgent,
                clientCapabilities: 439,
                endpointCapabilities: 128,
                publishFormat: 1,
                noAutomaticForeground: false,
                makeUserAvailableInForeground: true,
                deviceId,
                isInitiallyForeground: true,
                networkType: 1,
                networkSubtype: 0,
                clientMqttSessionId: clientMqttSessionId,
                subscribeTopics,
                clientType,
                appId: BigInt(567067343352427),
                deviceSecret: deviceSecret || '',
                clientStack: 3,
                ...(this.initOptions?.connectOverrides || {}),
            },
            password,
            appSpecificInfo: {
                // Use exported INSTAGRAM_VERSION automatically, fallback to this.ig.state.appVersion if missing
                app_version: INSTAGRAM_VERSION || this.ig.state.appVersion,
                'X-IG-Capabilities': this.ig.state.capabilitiesHeader,
                everclear_subscriptions: JSON.stringify({
                    inapp_notification_subscribe_comment: '17899377895239777',
                    inapp_notification_subscribe_comment_mention_and_reply: '17899377895239777',
                    video_call_participant_state_delivery: '17977239895057311',
                    presence_subscribe: '17846944882223835',
                }),
                // Extra app-specific fields observed in the mobile APK (helps the server identify the client capabilities)
                'User-Agent': userAgent,
                'Accept-Language': (this.ig.state.language || 'en_US').replace('_', '-'),
                platform: 'android',
                ig_mqtt_route: 'django',
                pubsub_msg_type_blacklist: 'direct, typing_type',
                auth_cache_enabled: '0',
            },
        });
    }

    /**
     * connect(options)
     * - Creates the MQTToTClient using mqttot.MQTToTClient and the payloadProvider.
     * - Attaches idempotent lifecycle handlers for connect/close/error.
     * - Starts keepalive/watchdog timers and message listeners after successful connect.
     */
    async connect(options) {
        this._connectInProgress = true;
        try {
        this.setInitOptions(options);
        this.constructConnection();
        const { MQTToTClient } = require("../mqttot");
        const { compressDeflate } = require("../shared");

        if (this._mqtt) {
            try { this._mqtt.removeAllListeners(); } catch (_e) {}
            try { this._mqtt._stopKeepalive(); } catch (_e) {}
            try { this._mqtt.disconnect(); } catch (_e) {}
            this._mqtt = null;
        }

        this._mqtt = new MQTToTClient({
            url: 'edge-mqtt.facebook.com',
            payloadProvider: async () => {
                return await compressDeflate(this.connection.toThrift());
            },
            autoReconnect: false,
            requirePayload: false,
        });

        // attach lifecycle handlers idempotent (create once)
        try {
            if (typeof this._attachMqttLifecycle !== 'function') {
                this._attachMqttLifecycle = async () => {
                    if (!this._mqtt) return;
                    try {
                        this._mqtt.on('connect', async () => {
                            this.realtimeDebug('[MQTT] client emitted connect');
                            try {
                                // After normal after-connect handlers, try extract session id and persist it
                                await this._afterConnectHandlers();
                            } catch (e) {
                                this.realtimeDebug('[MQTT] afterConnect error', e?.message || e);
                            }
                            // After everything, attempt to detect and persist MQTT session id
                            try {
                                await this._onMqttConnected();
                            } catch (e) {
                                this.realtimeDebug('[MQTT] _onMqttConnected error', e?.message || e);
                            }
                        });
                    } catch (e) {}
                    try {
                        this._mqtt.on('close', async () => {
                            this.realtimeDebug('[MQTT] client close event');
                            this._lastMessageAt = Date.now();
                            try { await this._persistMqttSession(); } catch (e) {}
                            this._mqttConnected = false;
                            this._connectInProgress = false;
                            this.emit('mqtt_disconnected');
                            if (this._reconnectInProgress) {
                                this.realtimeDebug('[MQTT] close event ignored — reconnect already in progress');
                                return;
                            }
                            if (this.safeDisconnect) {
                                this.realtimeDebug('[MQTT] close event ignored — safe disconnect');
                                return;
                            }
                            if (this._reconnectTimeoutId) clearTimeout(this._reconnectTimeoutId);
                            this._reconnectTimeoutId = setTimeout(async () => {
                                try { await this._attemptReconnectSafely(); } catch (e) {}
                            }, this._reconnectDebounceMs);
                        });
                    } catch (e) {}
                    try {
                        this._mqtt.on('error', (err) => {
                            this.realtimeDebug('[MQTT] client error:', err?.message || err);
                            this.emit('mqtt_error', err);
                            if (this._reconnectInProgress) {
                                this.realtimeDebug('[MQTT] error event ignored — reconnect already in progress');
                                return;
                            }
                            if (this.safeDisconnect) return;
                            if (this._reconnectTimeoutId) clearTimeout(this._reconnectTimeoutId);
                            const debounceMs = (this.errorHandler && this.errorHandler.isRateLimited())
                                ? this.errorHandler.getRateLimitRemainingMs()
                                : this._reconnectDebounceMs;
                            this._reconnectTimeoutId = setTimeout(async () => {
                                try { await this._attemptReconnectSafely(err); } catch (e) {}
                            }, debounceMs);
                        });
                    } catch (e) {}
                };
            }
            try { await this._attachMqttLifecycle(); } catch (e) {}
        } catch (e) {}

        // actually connect the mqtt client (this will emit connect when done)
        await this._mqtt.connect();

        // Commands uses mqtt client; Commands.updateSubscriptions has been set to use qos 0.
        this.commands = new commands_1.Commands(this._mqtt);

        // Notify higher-level code that we are connected
        this._mqttConnected = true;
        this._connectInProgress = false;
        this.emit('connected');
        this.emit('mqtt_connected');

        // WATCHDOG / KEEPALIVE / TRAFFIC MONITOR (rationalized - 2 primary timers + 1 watchdog)
        try {
            this._lastMessageAt = Date.now();
            this._lastServerTrafficAt = Date.now();
            const updateLast = () => { try { this._lastMessageAt = Date.now(); this._lastServerTrafficAt = Date.now(); } catch (e) {} };
            this.on('receive', updateLast);
            this.on('receiveRaw', updateLast);
            this.on('message', updateLast);
            this.on('iris', updateLast);

            const KEEPALIVE_FOREGROUND_MS = (this.initOptions && this.initOptions.keepaliveForegroundMs) ? this.initOptions.keepaliveForegroundMs : 60000;
            const MESSAGE_SYNC_REFRESH_MS = (this.initOptions && this.initOptions.messageSyncRefreshMs) ? this.initOptions.messageSyncRefreshMs : 300000;
            const TRAFFIC_INACTIVITY_MS = (this.initOptions && this.initOptions.trafficInactivityMs) ? this.initOptions.trafficInactivityMs : 300000;
            const HEARTBEAT_MS = (this.initOptions && this.initOptions.heartbeatMs) ? this.initOptions.heartbeatMs : 240000;

            try {
                if (this._foregroundTimer) clearInterval(this._foregroundTimer);
                this._foregroundTimer = setInterval(async () => {
                    try {
                        if (!this.commands) return;
                        await this.commands.updateSubscriptions({
                            topic: constants_1.Topics.PUBSUB,
                            data: { foreground: true }
                        });
                        this._lastMessageAt = Date.now();
                        this.realtimeDebug('[KEEPALIVE] Foreground pulse sent.');
                    } catch (e) {
                        this.realtimeDebug('[KEEPALIVE] Foreground pulse failed:', e?.message || e);
                    }
                }, KEEPALIVE_FOREGROUND_MS + Math.floor(Math.random() * 5000));
            } catch (e) {
                this.realtimeDebug('[KEEPALIVE] Could not start foreground timer:', e?.message || e);
            }

            try {
                if (this._syncTimer) clearInterval(this._syncTimer);
                this._syncTimer = setInterval(async () => {
                    try {
                        if (!this.commands) return;
                        const subs = (this.initOptions && this.initOptions.graphQlSubs && this.initOptions.graphQlSubs.length) ? this.initOptions.graphQlSubs : this.defaultGraphQlSubs;
                        await this.graphQlSubscribe(subs);
                        this._lastMessageAt = Date.now();
                        this.realtimeDebug('[KEEPALIVE] GraphQL subs refreshed.');
                    } catch (e) {
                        this.realtimeDebug('[KEEPALIVE] GraphQL refresh failed:', e?.message || e);
                    }
                }, MESSAGE_SYNC_REFRESH_MS + Math.floor(Math.random() * 10000));
            } catch (e) {
                this.realtimeDebug('[KEEPALIVE] Could not start sync timer:', e?.message || e);
            }

            try {
                if (this._trafficWatchdog) clearInterval(this._trafficWatchdog);
                this._trafficWatchdog = setInterval(async () => {
                    try {
                        const idle = Date.now() - (this._lastServerTrafficAt || 0);
                        if (idle > TRAFFIC_INACTIVITY_MS) {
                            this.realtimeDebug(`[WATCHDOG] No server traffic for ${Math.round(idle/1000)}s -> attempting reconnect`);
                            try {
                                if (this._mqtt && typeof this._mqtt.ping === 'function') {
                                    await this._mqtt.ping();
                                    this._lastMessageAt = Date.now();
                                    this.realtimeDebug('[WATCHDOG] Ping succeeded, connection is alive.');
                                    return;
                                }
                            } catch (e) {
                                this.realtimeDebug('[WATCHDOG] Ping failed, proceeding with reconnect:', e?.message || e);
                            }
                            await this._attemptReconnectSafely();
                        }
                    } catch (e) {
                        this.realtimeDebug('[WATCHDOG] trafficWatchdog fault:', e?.message || e);
                    }
                }, 60000);
            } catch (e) {
                this.realtimeDebug('[WATCHDOG] Could not start traffic watchdog:', e?.message || e);
            }

            try {
                if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
                this._heartbeatTimer = setInterval(async () => {
                    try {
                        if (this._mqtt && typeof this._mqtt.ping === 'function') {
                            try {
                                await this._mqtt.ping();
                                this._lastMessageAt = Date.now();
                                this.realtimeDebug('[HEARTBEAT] mqtt.ping() ok.');
                            } catch (e) {
                                this.realtimeDebug('[HEARTBEAT] mqtt.ping failed:', e?.message || e);
                            }
                        }
                    } catch (e) {
                        this.realtimeDebug('[HEARTBEAT] fault:', e?.message || e);
                    }
                }, HEARTBEAT_MS + Math.floor(Math.random() * 5000));
            } catch (e) {
                this.realtimeDebug('[HEARTBEAT] Could not start heartbeat timer:', e?.message || e);
            }

        } catch (e) {
            this.realtimeDebug('[WATCHDOG] initialization error:', e?.message || e);
        }

        /**
         * Set up on-message handler:
         * - Messages arriving from low-level MQTT are looked up in mqtt.topicMap,
         *   then parsed by the topic's parser if available. Otherwise payload is emitted as raw.
         */
        this._mqtt.on('message', async (msg) => {
            const topicMap = this.mqtt?.topicMap;
            const topic = topicMap?.get(msg.topic);
            if (topic && topic.parser && !topic.noParse) {
                try {
                    const unzipped = await (0, shared_1.tryUnzipAsync)(msg.payload);
                    const parsedMessages = topic.parser.parseMessage(topic, unzipped);
                    this.emit('receive', topic, Array.isArray(parsedMessages) ? parsedMessages : [parsedMessages]);
                } catch(e) {}
            } else {
                try {
                    await (0, shared_1.tryUnzipAsync)(msg.payload);
                    this.emit('receiveRaw', msg);
                } catch(e) {}
            }
        });
        // propagate mqtt errors to RealtimeClient error handler
        this._mqtt.on('error', this.emitError);

        try { await this._afterConnectHandlers(); } catch (e) { this.realtimeDebug('[MQTT] afterConnectHandlers failed', e?.message || e); }

        // Initial subscriptions / iris
        await (0, shared_1.delay)(100);
        if (this.initOptions.graphQlSubs && this.initOptions.graphQlSubs.length > 0) {
            await this.graphQlSubscribe(this.initOptions.graphQlSubs);
        } else {
            // ensure defaults if none provided
            await this.graphQlSubscribe(this.defaultGraphQlSubs);
        }
        if (this.initOptions.irisData) {
            await this.irisSubscribe(this.initOptions.irisData);
        } else {
            try {
                console.log('[REALTIME] Auto-fetching IRIS data...');
                const autoIrisData = await this.ig.direct.getInbox();
                if (autoIrisData) {
                    await this.irisSubscribe(autoIrisData);
                    console.log('[REALTIME] IRIS subscription successful');
                }
            } catch (e) {
                console.log('[REALTIME] Could not auto-fetch IRIS data:', e.message);
            }
        }
        if ((this.initOptions.skywalkerSubs ?? []).length > 0) {
            await this.skywalkerSubscribe(this.initOptions.skywalkerSubs);
        } else {
            // ensure default skywalker subs if none provided
            await this.skywalkerSubscribe(this.defaultSkywalkerSubs);
        }
        await (0, shared_1.delay)(100);
        try {
            await this.ig.direct.getInbox();
            try {
                await this.ig.request.send({
                    url: '/api/v1/direct_v2/threads/get_most_recent_message/',
                    method: 'POST',
                });
            } catch(e) {}
        } catch (error) {}
        this._setupMessageHandlers();

        // Active query keepalive disabled - redundant with rationalized foreground + heartbeat timers
        // The foreground timer (60s) and heartbeat (90s) provide sufficient keepalive coverage
        // without generating excessive traffic that could trigger Instagram rate limiting
        } catch (connectError) {
            this._connectInProgress = false;
            throw connectError;
        }
    }

    /**
     * Attempt to detect server-provided MQTT session id and persist it.
     * This method is defensive: it tries multiple places on the mqtt client object.
     *
     * Also: schedule credential refresh if mqttAuth.expiresAt is present (so tokens are refreshed
     * before they expire).
     */
    async _onMqttConnected() {
        try {
            let found = null;
            try {
                const mqtt = this._mqtt;
                if (mqtt) {
                    // try common accessor first
                    if (typeof mqtt.getSessionId === 'function') {
                        try { found = mqtt.getSessionId(); } catch (e) {}
                    }
                    // try common property names (defensive)
                    if (!found && mqtt.sessionId) found = mqtt.sessionId;
                    if (!found && mqtt._sessionId) found = mqtt._sessionId;
                    // some clients keep last connack info
                    if (!found && mqtt.lastConnack && mqtt.lastConnack.sessionId) found = mqtt.lastConnack.sessionId;
                    if (!found && mqtt.connack && mqtt.connack.sessionId) found = mqtt.connack.sessionId;
                    // fallback to connection.clientInfo.clientMqttSessionId (local id)
                    if (!found && this.connection && this.connection.clientInfo && this.connection.clientInfo.clientMqttSessionId) {
                        try { found = String(this.connection.clientInfo.clientMqttSessionId); } catch (e) {}
                    }
                }
            } catch (e) {}
            // If no server-provided id was found, fall back to the persistent client id (if present) or 'boot'
            if (!found) {
                if (this._clientMqttSessionId) {
                    try {
                        found = String(this._clientMqttSessionId);
                        this.realtimeDebug('[MQTT] No server mqttSessionId yet — falling back to clientMqttSessionId.');
                    } catch (e) {
                        // ignore and keep found null
                    }
                } else {
                    // final fallback
                    found = 'boot';
                    this.realtimeDebug('[MQTT] No mqttSessionId available — using boot fallback.');
                }
            }
            if (found) {
                this._mqttSessionId = String(found);
                this.realtimeDebug(`[MQTT] detected mqttSessionId: ${this._mqttSessionId}`);
                // emit event for consumers
                try { this.emit('mqtt_session', this._mqttSessionId); } catch (e) {}
                // persist it right away
                try { await this._persistMqttSession(); } catch (e) { this.realtimeDebug('[MQTT] persist after connect failed', e?.message || e); }
                // start periodic persist if not already (persist every 4 hours to avoid excessive I/O and detection)
                if (!this._mqttSessionPersistIntervalId) {
                    try {
                        this._mqttSessionPersistIntervalId = setInterval(() => {
                            try { this._persistMqttSession(); } catch (e) {}
                        }, 4 * 60 * 60 * 1000); // every 4 hours
                    } catch (e) {}
                }
            } else {
                this.realtimeDebug('[MQTT] mqttSessionId not found on client after connect (will attempt again on subsequent connects)');
            }

            //
            // SCHEDULE CREDENTIAL REFRESH (if auth helper provided mqttAuth.expiresAt).
            // We schedule a timer to refresh credentials some seconds before expiry and then attempt a
            // graceful reconnect so the new token is used.
            //
            try {
                // clear any previous timer
                if (this._mqttAuthRefreshTimer) {
                    try { clearTimeout(this._mqttAuthRefreshTimer); } catch (e) {}
                    this._mqttAuthRefreshTimer = null;
                }
                if (this._attachedAuthState && typeof this._attachedAuthState.getData === 'function') {
                    try {
                        const d = this._attachedAuthState.getData();
                        const mqttAuth = d?.mqttAuth;
                        if (mqttAuth && mqttAuth.expiresAt) {
                            const expires = new Date(mqttAuth.expiresAt).getTime();
                            if (!isNaN(expires)) {
                                // refresh 60 seconds before expiry (buffer)
                                const msBefore = expires - Date.now() - (60 * 1000);
                                if (msBefore > 0) {
                                    this.realtimeDebug(`[CREDENTIAL_REFRESH] scheduling mqttAuth refresh in ${msBefore}ms (expiresAt: ${mqttAuth.expiresAt})`);
                                    this._mqttAuthRefreshTimer = setTimeout(async () => {
                                        try {
                                            this.realtimeDebug('[CREDENTIAL_REFRESH] timer fired - attempting refresh');
                                            const refreshed = await this._refreshMqttCredentials();
                                            if (refreshed) {
                                                try {
                                                    // rebuild payload and attempt reconnect so new token is used
                                                    this.constructConnection();
                                                } catch (e) {}
                                                try {
                                                    await this._attemptReconnectSafely();
                                                } catch (e) {
                                                    this.realtimeDebug('[CREDENTIAL_REFRESH] reconnect after refresh failed:', e?.message || e);
                                                }
                                            } else {
                                                this.realtimeDebug('[CREDENTIAL_REFRESH] refresh attempt did not produce new mqtt credentials.');
                                            }
                                        } catch (e) {
                                            this.realtimeDebug('[CREDENTIAL_REFRESH] unexpected error during scheduled refresh:', e?.message || e);
                                        }
                                    }, msBefore);
                                } else {
                                    // expiry is imminent — attempt immediate refresh now
                                    (async () => {
                                        try {
                                            this.realtimeDebug('[CREDENTIAL_REFRESH] mqttAuth near-expired or expired — attempting immediate refresh');
                                            const refreshedNow = await this._refreshMqttCredentials();
                                            if (refreshedNow) {
                                                try { this.constructConnection(); } catch (e) {}
                                                try { await this._attemptReconnectSafely(); } catch (e) {}
                                            }
                                        } catch (e) {}
                                    })();
                                }
                            }
                        }
                    } catch (e) {
                        this.realtimeDebug('[CREDENTIAL_REFRESH] scheduling failed:', e?.message || e);
                    }
                }
            } catch (e) {
                this.realtimeDebug('[CREDENTIAL_REFRESH] schedule block failed:', e?.message || e);
            }
        } catch (e) {
            this.realtimeDebug('[MQTT] _onMqttConnected fatal', e?.message || e);
        }
    }

    /**
     * _refreshMqttCredentials()
     * - Attempt to refresh mqtt credentials using attached auth helper if possible.
     * - This method is defensive: many auth helpers won't expose refresh methods, so it tries possible hooks and logs results.
     */
    async _refreshMqttCredentials() {
        try {
            if (!this._attachedAuthState) {
                this.realtimeDebug('[CREDENTIAL_REFRESH] No attached auth helper to refresh credentials.');
                return false;
            }
            const auth = this._attachedAuthState;
            // Preferred hook: auth.refreshMqttAuth() or auth.refreshAuth()
            if (typeof auth.refreshMqttAuth === 'function') {
                try {
                    this.realtimeDebug('[CREDENTIAL_REFRESH] Calling auth.refreshMqttAuth()');
                    await auth.refreshMqttAuth();
                    // reload data into ig or auth helper if possible
                    if (typeof auth.getData === 'function') {
                        const d = auth.getData();
                        if (d && d.mqttAuth && d.mqttAuth.jwt) {
                            this.realtimeDebug('[CREDENTIAL_REFRESH] mqttAuth refreshed via refreshMqttAuth.');
                            return true;
                        }
                    }
                } catch (e) {
                    this.realtimeDebug('[CREDENTIAL_REFRESH] refreshMqttAuth failed:', e?.message || e);
                }
            }
            // Secondary hook: auth.refresh() or auth.loadCreds()
            if (typeof auth.refresh === 'function') {
                try {
                    this.realtimeDebug('[CREDENTIAL_REFRESH] Calling auth.refresh()');
                    await auth.refresh();
                    this.realtimeDebug('[CREDENTIAL_REFRESH] auth.refresh() completed.');
                    return true;
                } catch (e) {
                    this.realtimeDebug('[CREDENTIAL_REFRESH] auth.refresh() failed:', e?.message || e);
                }
            }
            if (typeof auth.loadCreds === 'function') {
                try {
                    this.realtimeDebug('[CREDENTIAL_REFRESH] Calling auth.loadCreds(this.ig)');
                    await auth.loadCreds(this.ig);
                    this.realtimeDebug('[CREDENTIAL_REFRESH] auth.loadCreds() completed.');
                    return true;
                } catch (e) {
                    this.realtimeDebug('[CREDENTIAL_REFRESH] auth.loadCreds() failed:', e?.message || e);
                }
            }
            // If none of the above worked, attempt to re-run the useMultiFileAuthState load path if available (best-effort)
            try {
                if (auth.folder && typeof require('../useMultiFileAuthState') === 'function') {
                    try {
                        const { useMultiFileAuthState } = require('../useMultiFileAuthState');
                        const reloaded = await useMultiFileAuthState(auth.folder);
                        if (reloaded && reloaded.getData && typeof reloaded.getData === 'function') {
                            this._attachedAuthState = reloaded;
                            this.realtimeDebug('[CREDENTIAL_REFRESH] reloaded auth helper from folder.');
                            return true;
                        }
                    } catch (e) {
                        // not critical
                    }
                }
            } catch (e) {}
            this.realtimeDebug('[CREDENTIAL_REFRESH] No refresh hook available or refresh did not produce new mqtt credentials.');
            return false;
        } catch (e) {
            this.realtimeDebug('[CREDENTIAL_REFRESH] unexpected error', e?.message || e);
            return false;
        }
    }

    /**
     * Persist mqtt session details locally and via attached auth helper if available.
     * Writes <authFolder>/mqtt-session.json as a local backup.
     */
    async _persistMqttSession() {
        try {
            const folder = this._authFolder || './authinfo_instagram';
            try {
                if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
            } catch (e) {}

            // IMPORTANT: prefer server-provided mqtt session id when available.
            // Fallback order:
            // 1) this._mqttSessionId (server-provided)
            // 2) this._clientMqttSessionId (client-generated persistent id)
            // 3) 'boot'
            const obj = {
                sessionId: this._mqttSessionId || null,
                mqttSessionId: this._mqttSessionId ? String(this._mqttSessionId) : (this._clientMqttSessionId ? String(this._clientMqttSessionId) : 'boot'),
                lastConnected: new Date().toISOString(),
                userId: String(this.ig?.state?.cookieUserId || this.ig?.state?.userId || '')
            };

            // If an auth helper supports saveMqttSession, call that first (so it can save to the canonical auth state)
            try {
                if (this._attachedAuthState && typeof this._attachedAuthState.saveMqttSession === 'function') {
                    try {
                        // Many helpers expect the realtime client instance
                        await this._attachedAuthState.saveMqttSession(this);
                        this.realtimeDebug('[MQTT] authState.saveMqttSession called');
                    } catch (e) {
                        this.realtimeDebug('[MQTT] authState.saveMqttSession failed', e?.message || e);
                    }
                }
            } catch (e) {}

            // Always write local backup file
            try {
                fs.writeFileSync(path.join(folder, 'mqtt-session.json'), JSON.stringify(obj, null, 2));
                this.realtimeDebug('[MQTT] mqtt-session.json written locally');
            } catch (e) {
                this.realtimeDebug('[MQTT] failed writing mqtt-session.json', e?.message || e);
            }
        } catch (e) {
            // swallow errors to not break main flow
            this.realtimeDebug('[MQTT] _persistMqttSession error', e?.message || e);
        }
    }

    /**
     * _attemptReconnectSafely()
     * - Ensure only a single reconnect flow runs at once.
     * - Disconnects existing mqtt client, waits briefly, refreshes credentials when appropriate,
     *   and calls connect() again with exponential backoff retries.
     */
    async _attemptReconnectSafely(lastError) {
        if (this._reconnectInProgress) {
            this.realtimeDebug('[RECONNECT] Skipped — reconnect already in progress');
            return;
        }
        if (this._mqttConnected) {
            this.realtimeDebug('[RECONNECT] Skipped — MQTT is already connected');
            return;
        }
        if (this.safeDisconnect) {
            this.realtimeDebug('[RECONNECT] Skipped — safe disconnect active');
            return;
        }
        this._reconnectInProgress = true;
        if (this._reconnectTimeoutId) {
            clearTimeout(this._reconnectTimeoutId);
            this._reconnectTimeoutId = null;
        }

        if (this.errorHandler && this.errorHandler.isRateLimited()) {
            const remaining = this.errorHandler.getRateLimitRemainingMs();
            this.realtimeDebug(`[RECONNECT] Rate limited. Waiting ${Math.round(remaining/1000)}s before attempting reconnect.`);
            await (0, shared_1.delay)(remaining);
        }

        try {
            let attempt = 0;
            const maxAttempts = 20;
            let lastErrorType = lastError ? (this.errorHandler ? this.errorHandler.classifyError(lastError) : 'unknown') : 'unknown';

            while (attempt < maxAttempts) {
                attempt++;
                try {
                    if (this._mqttConnected) {
                        this.realtimeDebug('[RECONNECT] MQTT connected during loop — stopping reconnect');
                        break;
                    }

                    const shouldRefreshCreds = lastErrorType === 'auth_failure' || attempt > 3;
                    if (shouldRefreshCreds) {
                        try {
                            const refreshed = await this._refreshMqttCredentials();
                            if (refreshed) {
                                this.realtimeDebug('[RECONNECT] Credentials refreshed successfully.');
                            }
                        } catch (e) {
                            this.realtimeDebug('[RECONNECT] Credential refresh failed:', e?.message || e);
                        }
                    }

                    this.realtimeDebug(`[RECONNECT] Attempt #${attempt}...`);
                    try {
                        await this.connect(this.initOptions);
                        this.realtimeDebug(`[RECONNECT] Reconnect succeeded on attempt #${attempt}.`);
                        if (this.errorHandler) this.errorHandler.resetErrorCounter();
                        this.emit('reconnected', { attempt });
                        return;
                    } catch (e) {
                        lastErrorType = this.errorHandler ? this.errorHandler.classifyError(e) : 'unknown';
                        this.realtimeDebug(`[RECONNECT] Attempt #${attempt} failed (${lastErrorType}):`, e?.message || e);
                    }
                } catch (e) {
                    this.realtimeDebug('[RECONNECT] Loop error:', e?.message || e);
                }

                let backoffMs;
                if (this.errorHandler) {
                    backoffMs = this.errorHandler.getBackoffForType(lastErrorType, attempt);
                } else {
                    const jitter = Math.floor(Math.random() * 3000);
                    backoffMs = Math.min(60000, 2000 * Math.pow(2, attempt)) + jitter;
                }
                this.realtimeDebug(`[RECONNECT] Waiting ${Math.round(backoffMs/1000)}s before attempt #${attempt + 1} (type: ${lastErrorType}).`);
                await (0, shared_1.delay)(backoffMs);

                if (attempt >= maxAttempts) {
                    this.realtimeDebug(`[RECONNECT] Max attempts (${maxAttempts}) reached. Persisting state and stopping.`);
                    try { await this._persistMqttSession(); } catch (e) {}
                    this.emit('reconnect_failed', { attempts: attempt, lastErrorType });
                    break;
                }
            }
        } finally {
            this._reconnectInProgress = false;
        }
    }

    /**
     * _ensureIrisSnapshotAndSubscribe()
     * - Ensure IRIS snapshot is present and subscribe to it.
     * - Tries a fresh fetch after connect to get the latest snapshot.
     */
    async _ensureIrisSnapshotAndSubscribe() {
        try {
            let iris = this.initOptions?.irisData || null;
            let fetched = false;
            try {
                const fetchedInbox = await this.ig.direct.getInbox();
                if (fetchedInbox) {
                    iris = fetchedInbox;
                    fetched = true;
                    this.realtimeDebug('[IRIS] Fetched fresh snapshot after connect.');
                }
            } catch (e) {
                this.realtimeDebug('[IRIS] Fresh fetch failed:', e?.message || e);
            }
            if (iris) {
                try {
                    await this.irisSubscribe(iris);
                    this.realtimeDebug('[IRIS] irisSubscribe executed.');
                } catch (e) {
                    this.realtimeDebug('[IRIS] irisSubscribe failed:', e?.message || e);
                }
            } else {
                this.realtimeDebug('[IRIS] No iris data available to subscribe.');
            }
            return fetched;
        } catch (e) {
            return false;
        }
    }

    /**
     * Attach message_sync listener to mqtt if available
     * - Some mqtt clients provide a listen() helper; attach to both numeric id and string names for compatibility.
     */
    async _ensureMessageSyncListener() {
        try {
            if (this._messageSyncAttached) return;
            if (this._mqtt && typeof this._mqtt.listen === 'function') {
                try {
                    const bound = (payload) => {
                        try { this.emit('message_sync', payload); } catch (e) {}
                    };
                    try { this._mqtt.listen(146, bound); } catch (e) {}
                    try { this._mqtt.listen('message_sync', bound); } catch (e) {}
                    this._messageSyncAttached = true;
                    this.realtimeDebug('[MESSAGE_SYNC] listener attached to mqtt (idempotent).');
                } catch (e) {
                    this.realtimeDebug('[MESSAGE_SYNC] attach failed:', e?.message || e);
                }
            } else {
                this.realtimeDebug('[MESSAGE_SYNC] mqtt.listen not available on client.');
            }
        } catch (e) {}
    }

    async _afterConnectHandlers() {
        try {
            this._lastMessageAt = Date.now();
            await this._ensureMessageSyncListener();
            await this._ensureIrisSnapshotAndSubscribe();
        } catch (e) {
            this.realtimeDebug('[AFTER_CONNECT] handlers error:', e?.message || e);
        }
    }

    enableHealthMonitor(options = {}) {
        if (this.healthMonitor) {
            this.healthMonitor.stop();
        }
        this.healthMonitor = new SessionHealthMonitor(this, {
            checkIntervalMs: options.checkIntervalMs || 30 * 60 * 1000,
            jitterMs: options.jitterMs || 5 * 60 * 1000,
            autoRelogin: options.autoRelogin !== undefined ? options.autoRelogin : !!options.credentials,
            credentials: options.credentials || null,
            maxConsecutiveFailures: options.maxConsecutiveFailures || 5,
            onSessionExpired: options.onSessionExpired || null,
        });

        this.healthMonitor.on('health_check', (data) => {
            this.emit('health_check', data);
        });
        this.healthMonitor.on('session_expired', (data) => {
            this.emit('session_expired', data);
        });
        this.healthMonitor.on('relogin_start', (data) => {
            this.emit('relogin_start', data);
        });
        this.healthMonitor.on('relogin_success', (data) => {
            this.emit('relogin_success', data);
        });
        this.healthMonitor.on('relogin_failed', (data) => {
            this.emit('relogin_failed', data);
        });
        this.healthMonitor.on('relogin_challenge', (data) => {
            this.emit('relogin_challenge', data);
        });
        this.healthMonitor.on('relogin_needed', (data) => {
            this.emit('relogin_needed', data);
        });

        if (this.persistentLogger) {
            this.healthMonitor.on('log', (line) => {
                this.persistentLogger.info(line);
            });
        }

        this.healthMonitor.start();
        this.realtimeDebug('[HEALTH] Session health monitor enabled');
        return this.healthMonitor;
    }

    enablePersistentLogger(options = {}) {
        if (this.persistentLogger) {
            this.persistentLogger.stop();
        }
        this.persistentLogger = new PersistentLogger({
            logDir: options.logDir || './logs',
            prefix: options.logPrefix || 'instagram-mqtt',
            maxFileSize: options.maxLogFileSize || 10 * 1024 * 1024,
            maxFiles: options.maxLogFiles || 5,
            flushIntervalMs: options.logFlushIntervalMs || 30000,
            logToConsole: options.logToConsole !== false,
            logLevel: options.logLevel || 'info',
        });
        this.persistentLogger.start();

        const originalDebug = this.realtimeDebug.bind(this);
        this.realtimeDebug = (...args) => {
            originalDebug(...args);
            if (this.persistentLogger && this.persistentLogger._started) {
                this.persistentLogger.info(...args);
            }
        };

        this.on('error', (err) => {
            if (this.persistentLogger) this.persistentLogger.error('[MQTT_ERROR]', err?.message || err);
        });
        this.on('disconnect', (reason) => {
            if (this.persistentLogger) this.persistentLogger.warn('[DISCONNECT]', reason || 'unknown');
        });
        this.on('reconnected', (data) => {
            if (this.persistentLogger) this.persistentLogger.info('[RECONNECTED]', JSON.stringify(data));
        });

        this.realtimeDebug('[LOGGER] Persistent file logger enabled at', options.logDir || './logs');
        return this.persistentLogger;
    }

    getHealthStats() {
        if (!this.healthMonitor) return null;
        return this.healthMonitor.getStats();
    }

    getLoggerStats() {
        if (!this.persistentLogger) return null;
        return this.persistentLogger.getStats();
    }

    /**
     * connectFromSavedSession(authStateHelper, options)
     * - Reconstructs connect options from saved authState and then calls connect()
     * - Attempts to fetch a fresh IRIS snapshot (up to a few attempts) for safety.
     */
    async connectFromSavedSession(authStateHelper, options = {}) {
        if (!authStateHelper) {
            throw new Error('authStateHelper is required - use useMultiFileAuthState()');
        }

        if (this._mqttConnected) {
            console.log('[RealtimeClient] connectFromSavedSession skipped — already connected.');
            return this;
        }
        if (this._connectInProgress) {
            console.log('[RealtimeClient] connectFromSavedSession skipped — connect already in progress.');
            return this;
        }

        this._connectInProgress = true;
        console.log('[RealtimeClient] Connecting from saved session...');
        try { this._attachedAuthState = authStateHelper; } catch (e) {}

        const savedOptions = authStateHelper.getMqttConnectOptions?.() || {};
        let irisData = options.irisData || savedOptions.irisData || null;

        let fetchedInbox = null;
        const shouldForceFetch = true;
        if (shouldForceFetch) {
            const maxAttempts = 3;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    console.log(`[RealtimeClient] Attempting to fetch fresh IRIS inbox snapshot (attempt ${attempt}/${maxAttempts})...`);
                    fetchedInbox = await this.ig.direct.getInbox();
                    if (fetchedInbox) {
                        irisData = fetchedInbox;
                        console.log('[RealtimeClient] Fetched IRIS snapshot successfully.');
                        break;
                    }
                } catch (e) {
                    const msg = (e?.message || String(e)).toLowerCase();
                    const isAuthIssue = msg.includes('login_required') || msg.includes('401') || msg.includes('403') || msg.includes('not authorized') || msg.includes('checkpoint');
                    console.warn(`[RealtimeClient] Failed to fetch IRIS snapshot (attempt ${attempt}):`, e?.message || e);
                    if (isAuthIssue) {
                        console.warn('[RealtimeClient] IRIS fetch failed due to auth issue — session may be expired.');
                        this.emit('warning', { type: 'auth_issue', message: 'Session may be expired - IRIS fetch returned auth error', error: e?.message });
                        break;
                    }
                }
                try { await (0, shared_1.delay)(1000 * attempt); } catch (e) {}
            }
            if (!fetchedInbox) {
                if (savedOptions.irisData) {
                    irisData = savedOptions.irisData;
                    console.warn('[RealtimeClient] Could not fetch fresh IRIS snapshot — falling back to saved irisData (may be stale).');
                } else if (!irisData) {
                    console.warn('[RealtimeClient] No IRIS snapshot available (neither fetched nor saved). Proceeding without irisData — server may not replay missed events.');
                }
            }
        }

        const connectOptions = {
            graphQlSubs: options.graphQlSubs || savedOptions.graphQlSubs || this.defaultGraphQlSubs,
            skywalkerSubs: options.skywalkerSubs || savedOptions.skywalkerSubs || this.defaultSkywalkerSubs,
            irisData,
            ...options
        };

        console.log('[RealtimeClient] Using saved subscriptions:', {
            graphQlSubs: connectOptions.graphQlSubs,
            skywalkerSubs: connectOptions.skywalkerSubs,
            hasIrisData: !!connectOptions.irisData
        });

        try {
            const d = authStateHelper.getData?.() || authStateHelper.data || {};
            const mqttAuth = d.mqttAuth || null;
            if (mqttAuth && mqttAuth.expiresAt) {
                const t = new Date(mqttAuth.expiresAt).getTime();
                if (!isNaN(t) && Date.now() > t) {
                    console.warn('[RealtimeClient] Warning: saved mqttAuth token appears expired.');
                }
            }
        } catch (e) {}

        await this.connect(connectOptions);

        if (authStateHelper.saveMqttSession) {
            try {
                await authStateHelper.saveMqttSession(this);
                console.log('[RealtimeClient] MQTT session saved after connect');
            } catch (e) {
                console.warn('[RealtimeClient] Failed to save MQTT session:', e.message);
            }
        }

        return this;
    }

    /**
     * saveSession(authStateHelper)
     * - Helper to persist current MQTT session to auth helper if available.
     */
    async saveSession(authStateHelper) {
        if (!authStateHelper || !authStateHelper.saveMqttSession) {
            console.warn('[RealtimeClient] No authStateHelper provided');
            return false;
        }
        await authStateHelper.saveMqttSession(this);
        return true;
    }

    /**
     * disconnect()
     * - Perform a graceful shutdown: clear timers and disconnect mqtt client.
     */
    disconnect() {
        this.safeDisconnect = true;
        try {
            if (this._foregroundTimer) {
                clearInterval(this._foregroundTimer);
                this._foregroundTimer = null;
            }
            if (this._syncTimer) {
                clearInterval(this._syncTimer);
                this._syncTimer = null;
            }
            if (this._trafficWatchdog) {
                clearInterval(this._trafficWatchdog);
                this._trafficWatchdog = null;
            }
            if (this._heartbeatTimer) {
                clearInterval(this._heartbeatTimer);
                this._heartbeatTimer = null;
            }
            // clear periodic mqtt persist
            if (this._mqttSessionPersistIntervalId) {
                clearInterval(this._mqttSessionPersistIntervalId);
                this._mqttSessionPersistIntervalId = null;
            }

            // Clear the active keepalive/query timer if running
            if (this._activeKeepaliveTimer) {
                clearInterval(this._activeKeepaliveTimer);
                this._activeKeepaliveTimer = null;
            }

            // clear credential refresh timer
            if (this._mqttAuthRefreshTimer) {
                try { clearTimeout(this._mqttAuthRefreshTimer); } catch (e) {}
                this._mqttAuthRefreshTimer = null;
            }
        } catch (e) {}
        // persist final session snapshot
        try { this._persistMqttSession(); } catch (e) {}
        return this.mqtt?.disconnect() ?? Promise.resolve();
    }

    /**
     * graphQlSubscribe(sub)
     * - Helper that delegates to Commands.updateSubscriptions (which uses qos 0).
     */
    graphQlSubscribe(sub) {
        sub = typeof sub === 'string' ? [sub] : sub;
        if (!this.commands) {
            throw new mqtts_1.IllegalStateError('connect() must be called before graphQlSubscribe()');
        }
        // If the caller provided an empty array, ensure defaults are used
        if (Array.isArray(sub) && sub.length === 0) sub = this.defaultGraphQlSubs;
        this.realtimeDebug(`Subscribing with GraphQL to ${sub.join(', ')}`);
        return this.commands.updateSubscriptions({
            topic: constants_1.Topics.REALTIME_SUB,
            data: {
                sub,
            },
        });
    }

    /**
     * skywalkerSubscribe(sub)
     * - Delegate to Commands.updateSubscriptions (pubsub topic).
     */
    skywalkerSubscribe(sub) {
        sub = typeof sub === 'string' ? [sub] : sub;
        if (!this.commands) {
            throw new mqtts_1.IllegalStateError('connect() must be called before skywalkerSubscribe()');
        }
        // If empty, use defaults
        if (Array.isArray(sub) && sub.length === 0) sub = this.defaultSkywalkerSubs;
        this.realtimeDebug(`Subscribing with Skywalker to ${sub.join(', ')}`);
        return this.commands.updateSubscriptions({
            topic: constants_1.Topics.PUBSUB,
            data: {
                sub,
            },
        });
    }

    /**
     * irisSubscribe({ seq_id, snapshot_at_ms })
     * - Subscribe to IRIS using the provided snapshot properties.
     */
    irisSubscribe({ seq_id, snapshot_at_ms, }) {
        if (!this.commands) {
            throw new mqtts_1.IllegalStateError('connect() must be called before irisSubscribe()');
        }
        this.realtimeDebug(`Iris Sub to: seqId: ${seq_id}, snapshot: ${snapshot_at_ms}`);
        return this.commands.updateSubscriptions({
            topic: constants_1.Topics.IRIS_SUB,
            data: {
                seq_id,
                snapshot_at_ms,
                snapshot_app_version: this.ig.state.appVersion,
            },
        });
    }

    /**
     * Start an "active query" keepalive loop
     * - This sends a lightweight PUBSUB foreground pulse and a REALTIME_SUB reaffirmation
     *   on a periodic basis to keep the server-side connection state active.
     *
     * Behavior & protections:
     * - Idle-aware: will skip sending if client received traffic within idleThresholdMs (to avoid unnecessary traffic).
     * - Interval configurable via initOptions.activeKeepaliveMs (default 45s).
     * - GraphQL subs reaffirmation uses initOptions.graphQlSubs or defaultGraphQlSubs.
     */
    _startActiveQueryKeepalive() {
        try {
            // Clear any existing timer idempotently
            if (this._activeKeepaliveTimer) {
                clearInterval(this._activeKeepaliveTimer);
                this._activeKeepaliveTimer = null;
            }

            const ms = (this.initOptions && this.initOptions.activeKeepaliveMs) ? this.initOptions.activeKeepaliveMs : 25000;
            const idleThresholdMs = (this.initOptions && this.initOptions.activeKeepaliveIdleThresholdMs) ? this.initOptions.activeKeepaliveIdleThresholdMs : 15000;

            // small wrapper to avoid unhandled rejection inside setInterval
            this._activeKeepaliveTimer = setInterval(async () => {
                try {
                    if (!this.commands) return;

                    // Do not send keepalive if we received traffic recently — avoids noisy pulses during active use.
                    const idle = Date.now() - (this._lastMessageAt || 0);
                    if (idle < idleThresholdMs) {
                        // skip sending if not idle enough
                        return;
                    }

                    // 1) PUBSUB "foreground pulse" with a tiny timestamp payload (safe, no side-effects)
                    try {
                        await this.commands.updateSubscriptions({
                            topic: constants_1.Topics.PUBSUB,
                            data: { foreground: true, keepalive_ts: Date.now() }
                        });
                        // mark activity so the traffic watchdog won't be triggered
                        this._lastMessageAt = Date.now(); // <--- update last-activity timestamp after active keepalive
                    } catch (e) {
                        // log but continue to attempt realtime-sub reaffirmation
                        this.realtimeDebug('[ACTIVE_QUERY] PUBSUB foreground pulse failed:', e?.message || e);
                    }

                    // 2) REALTIME_SUB reaffirmation of GraphQL subs (lightweight)
                    try {
                        const subs = (this.initOptions && this.initOptions.graphQlSubs && this.initOptions.graphQlSubs.length) ? this.initOptions.graphQlSubs : this.defaultGraphQlSubs;
                        await this.commands.updateSubscriptions({
                            topic: constants_1.Topics.REALTIME_SUB,
                            data: { sub: subs, keepalive_ts: Date.now() }
                        });
                        // mark activity after realtime-sub reaffirmation as well
                        this._lastMessageAt = Date.now(); // <--- update last-activity timestamp after realtime-sub reaffirmation
                    } catch (e) {
                        this.realtimeDebug('[ACTIVE_QUERY] REALTIME_SUB reaffirmation failed:', e?.message || e);
                    }

                    this.realtimeDebug('[ACTIVE_QUERY] keepalive query sent (idle ms: ' + idle + ')');
                } catch (e) {
                    this.realtimeDebug('[ACTIVE_QUERY] unexpected error in keepalive loop:', e?.message || e);
                }
            }, ms);
        } catch (e) {
            this.realtimeDebug('[ACTIVE_QUERY] could not start keepalive timer:', e?.message || e);
        }
    }
}
exports.RealtimeClient = RealtimeClient;
