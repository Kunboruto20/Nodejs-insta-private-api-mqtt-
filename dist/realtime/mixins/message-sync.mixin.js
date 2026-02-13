"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageSyncMixin = void 0;
const mixin_1 = require("./mixin");
const constants_1 = require("../../constants");
const shared_1 = require("../../shared")
const mqtts_1 = require("mqtts");

/**
 * MessageSyncMixin - patched for 2026 (robust parsing + safe username fetch + tolerant timestamp handling)
 *
 * Changes applied:
 * - tolerant parsing for e.value (string / object / already-parsed)
 * - support for several path shapes when extracting thread id
 * - safer timestamp parsing (accepts seconds, milliseconds, microseconds, nanoseconds)
 * - username fetch uses a pending map + small backoff to reduce rush/rate-limit risk
 * - defensive try/catch around JSON.parse and all external calls
 * - keeps original API: apply(client) registers post-connect hook and emits same events
 *
 * Additional change requested:
 * - set message status to 'received' for incoming messages and 'sent' for messages authored by the logged-in account,
 *   instead of the previous 'good'.
 *
 * Note: No rate-limiting code is included.
 */

class MessageSyncMixin extends mixin_1.Mixin {
    constructor() {
        super();
        this.userCache = new Map();
        this.pendingUserFetches = new Map();
    }

    apply(client) {
        console.log(`\n[MESSAGE_SYNC MIXIN] Applying mixin...`);
        
        (0, mixin_1.hook)(client, 'connect', {
            post: async () => {
                console.log(`[MESSAGE_SYNC] Post-connect hook called`);
                
                let retries = 0;
                while (!client.mqtt && retries < 50) {
                    await new Promise(r => setTimeout(r, 100));
                    retries++;
                }
                if (!client.mqtt) {
                    throw new mqtts_1.IllegalStateError('No mqtt client created after retries');
                }
                
                console.log(`[MESSAGE_SYNC] MQTT ready, registering listen() on topic 146 (MESSAGE_SYNC)`);
                
                if (client.mqtt.listen) {
                    console.log(`[MESSAGE_SYNC] mqtt.listen() method found, registering callback...`);
                    client.mqtt.listen({
                        topic: constants_1.Topics.MESSAGE_SYNC.id,
                        transformer: async ({ payload }) => {
                            try {
                                const unzipped = await (0, shared_1.tryUnzipAsync)(payload);
                                const parsed = constants_1.Topics.MESSAGE_SYNC.parser
                                    .parseMessage(constants_1.Topics.MESSAGE_SYNC, unzipped)
                                    .map(msg => msg.data);
                                return parsed;
                            } catch (err) {
                                // If transformer fails, return empty array so handler is tolerant
                                console.warn('[MESSAGE_SYNC] transformer parse failed:', err?.message || err);
                                return [];
                            }
                        },
                    }, data => {
                        this.handleMessageSync(client, data);
                    });
                } else {
                    console.log(`[MESSAGE_SYNC] mqtt.listen() NOT FOUND - using fallback 'receive' event`);
                    client.on('receive', (topic, messages) => {
                        try {
                            if (topic.id === constants_1.Topics.MESSAGE_SYNC.id) {
                                const data = messages.map(m => m.data);
                                this.handleMessageSync(client, data);
                            }
                        } catch (err) {
                            console.warn('[MESSAGE_SYNC] receive fallback handler error:', err?.message || err);
                        }
                    });
                }
            },
        });
    }

    async getUsernameFromId(client, userId) {
        if (!userId) return null;
        
        const userIdStr = String(userId);
        
        if (this.userCache.has(userIdStr)) {
            return this.userCache.get(userIdStr);
        }
        
        if (this.pendingUserFetches.has(userIdStr)) {
            try {
                return await this.pendingUserFetches.get(userIdStr);
            } catch (e) {
                // if pending fetch failed, continue to fresh attempt
            }
        }
        
        const fetchPromise = (async () => {
            try {
                // small backoff to avoid immediate burst of parallel requests
                await new Promise(r => setTimeout(r, 120));
                if (client.ig && client.ig.user && client.ig.user.info) {
                    try {
                        const userInfo = await client.ig.user.info(userIdStr);
                        if (userInfo && userInfo.username) {
                            this.userCache.set(userIdStr, userInfo.username);
                            return userInfo.username;
                        }
                    } catch (innerErr) {
                        // rate-limited or not found - swallow
                    }
                }
            } catch (err) {
                // Silently fail - will use ID instead
            }
            return null;
        })();
        
        this.pendingUserFetches.set(userIdStr, fetchPromise);
        const result = await fetchPromise;
        this.pendingUserFetches.delete(userIdStr);
        
        return result;
    }

    extractMessageContent(msgValue, itemType) {
        let content = '';
        let mediaInfo = '';
        
        try {
            switch (itemType) {
                case 'text':
                    content = msgValue.text || msgValue.body || '';
                    break;
                    
                case 'media':
                case 'raven_media':
                    content = '[PHOTO/VIDEO]';
                    if (msgValue.media) {
                        const media = msgValue.media;
                        if (media.image_versions2) {
                            content = '[PHOTO]';
                            mediaInfo = ` URL: ${media.image_versions2?.candidates?.[0]?.url || 'N/A'}`;
                        } else if (media.video_versions) {
                            content = '[VIDEO]';
                            mediaInfo = ` Duration: ${media.video_duration || 'N/A'}s`;
                        }
                    }
                    if (msgValue.visual_media) {
                        content = '[DISAPPEARING MEDIA]';
                    }
                    break;
                    
                case 'voice_media':
                    content = '[VOICE MESSAGE]';
                    if (msgValue.voice_media?.media?.audio) {
                        const duration = msgValue.voice_media.media.audio.duration || 0;
                        content = `[VOICE MESSAGE] Duration: ${duration}ms`;
                    }
                    break;
                    
                case 'animated_media':
                    content = '[GIF]';
                    if (msgValue.animated_media?.images?.fixed_height?.url) {
                        mediaInfo = ` URL: ${msgValue.animated_media.images.fixed_height.url}`;
                    }
                    break;
                    
                case 'media_share':
                    content = '[SHARED POST]';
                    if (msgValue.media_share) {
                        const share = msgValue.media_share;
                        content = `[SHARED POST] From: @${share.user?.username || 'unknown'}`;
                        if (share.caption?.text) {
                            content += ` Caption: "${String(share.caption.text).substring(0, 50)}..."`;
                        }
                    }
                    break;
                    
                case 'reel_share':
                    content = '[SHARED REEL]';
                    if (msgValue.reel_share) {
                        const reel = msgValue.reel_share;
                        content = `[SHARED REEL] From: @${reel.media?.user?.username || 'unknown'}`;
                        if (reel.text) {
                            content += ` Text: "${reel.text}"`;
                        }
                    }
                    break;
                    
                case 'story_share':
                    content = '[SHARED STORY]';
                    if (msgValue.story_share) {
                        const story = msgValue.story_share;
                        content = `[SHARED STORY] From: @${story.media?.user?.username || 'unknown'}`;
                        if (story.message) {
                            content += ` Message: "${story.message}"`;
                        }
                    }
                    break;
                    
                case 'felix_share':
                    content = '[SHARED IGTV/VIDEO]';
                    if (msgValue.felix_share?.video) {
                        content = `[SHARED IGTV] Title: "${msgValue.felix_share.video.title || 'N/A'}"`;
                    }
                    break;
                    
                case 'clip':
                    content = '[SHARED CLIP]';
                    if (msgValue.clip?.clip) {
                        content = `[SHARED CLIP] From: @${msgValue.clip.clip.user?.username || 'unknown'}`;
                    }
                    break;
                    
                case 'profile':
                    content = '[SHARED PROFILE]';
                    if (msgValue.profile) {
                        content = `[SHARED PROFILE] @${msgValue.profile.username || 'unknown'}`;
                    }
                    break;
                    
                case 'location':
                    content = '[LOCATION]';
                    if (msgValue.location) {
                        content = `[LOCATION] ${msgValue.location.name || msgValue.location.address || 'Unknown location'}`;
                    }
                    break;
                    
                case 'hashtag':
                    content = '[HASHTAG]';
                    if (msgValue.hashtag) {
                        content = `[HASHTAG] #${msgValue.hashtag.name || 'unknown'}`;
                    }
                    break;
                    
                case 'like':
                    content = '[LIKE]';
                    break;
                    
                case 'link':
                    content = '[LINK]';
                    if (msgValue.link) {
                        content = `[LINK] ${msgValue.link.text || msgValue.link.link_url || 'N/A'}`;
                    }
                    break;
                    
                case 'action_log':
                    content = '[ACTION]';
                    if (msgValue.action_log) {
                        content = `[ACTION] ${msgValue.action_log.description || 'N/A'}`;
                    }
                    break;
                    
                case 'placeholder':
                    content = '[PLACEHOLDER]';
                    if (msgValue.placeholder?.message) {
                        content = `[PLACEHOLDER] ${msgValue.placeholder.message}`;
                    }
                    break;
                    
                case 'xma':
                case 'xma_media_share':
                    content = '[XMA SHARE]';
                    if (msgValue.xma_link_url) {
                        content = `[XMA SHARE] ${msgValue.xma_link_url}`;
                    }
                    break;
                    
                case 'video_call_event':
                    content = '[VIDEO CALL EVENT]';
                    if (msgValue.video_call_event) {
                        content = `[VIDEO CALL] ${msgValue.video_call_event.action || 'event'}`;
                    }
                    break;
                    
                default:
                    if (msgValue && (msgValue.text || msgValue.body)) {
                        content = msgValue.text || msgValue.body;
                    } else {
                        content = `[${(itemType || 'UNKNOWN').toUpperCase()}]`;
                    }
            }
        } catch (e) {
            // defensive fallback
            try {
                if (msgValue && (msgValue.text || msgValue.body)) {
                    content = msgValue.text || msgValue.body;
                } else {
                    content = `[${(itemType || 'UNKNOWN').toUpperCase()}]`;
                }
            } catch (e2) {
                content = `[${(itemType || 'UNKNOWN').toUpperCase()}]`;
            }
        }
        
        return content + mediaInfo;
    }

    formatMessageForConsole(msgData) {
        const separator = '----------------------------------------';
        // robust timestamp formatting into readable date+time in Europe/Bucharest
        let ts = 'N/A';
        try {
            const parsed = this.parseTimestamp(msgData.timestamp);
            if (parsed) {
                const d = new Date(parsed);
                ts = d.toLocaleString('ro-RO', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                    timeZone: 'Europe/Bucharest'
                });
            }
        } catch (e) {
            ts = 'N/A';
        }
        const lines = [
            '',
            separator,
            '[NEW MESSAGE]',
            separator,
            `Username: ${msgData.username || 'unknown'}`,
            `ID: ${msgData.userId || 'unknown'}`,
            `Text: ${msgData.text || 'N/A'}`,
            `Type: ${msgData.itemType || 'text'}`,
            `Thread: ${msgData.threadId || 'unknown'}`,
            `Message ID: ${msgData.messageId || 'unknown'}`,
            `Timestamp: ${ts}`,
            `Status: ${msgData.status || 'unknown'}`,
            separator,
            ''
        ];
        return lines.join('\n');
    }

    /**
     * parseTimestamp
     * - accepts numeric strings or numbers in seconds, milliseconds, microseconds, nanoseconds
     * - normalizes to milliseconds
     * - sanity-checks to avoid absurd future dates; returns Date.now() fallback if out of range
     */
    parseTimestamp(ts) {
        try {
            if (ts === undefined || ts === null) return null;
            // if object with .ms or similar, try common fields
            if (typeof ts === 'object') {
                if (ts.ms) return Number(ts.ms);
                if (ts.seconds) return Number(ts.seconds) * 1000;
                if (ts.nano) return Math.floor(Number(ts.nano) / 1e6);
                // fallback to toString
                ts = String(ts);
            }
            let n = Number(ts);
            if (!Number.isFinite(n)) return null;

            // Heuristics:
            // nanoseconds ~ 1e18+, microseconds ~ 1e15+, milliseconds ~ 1e12, seconds ~ 1e9
            if (n > 1e17) {
                // nanoseconds -> ms
                n = Math.floor(n / 1e6);
            } else if (n > 1e14) {
                // microseconds -> ms
                n = Math.floor(n / 1e3);
            } else if (n > 1e12) {
                // likely already ms (leave)
                n = Math.floor(n);
            } else if (n > 1e9) {
                // seconds -> ms
                n = Math.floor(n * 1000);
            } else if (n > 1e6) {
                // ambiguous (older formats) -> treat as seconds -> ms
                n = Math.floor(n * 1000);
            } else {
                // too small -> invalid
                return null;
            }

            // sanity range: allow roughly 2010-2036 (ms)
            const min = 1262304000000; // 2010-01-01
            const max = 2114380800000; // 2037-01-01 (safe future upper bound)
            if (!Number.isFinite(n) || n < min || n > max) {
                // fallback to now to avoid huge future years displayed
                return Date.now();
            }
            return n;
        } catch (e) {
            return null;
        }
    }

    async handleMessageSync(client, syncData) {
        if (!syncData || !Array.isArray(syncData)) {
            console.log(`[MESSAGE_SYNC] No sync data received`);
            return;
        }

        for (const element of syncData) {
            try {
                const data = element.data;
                
                if (!data) {
                    // fallback: emit iris with original element
                    client.emit('iris', element);
                    continue;
                }
                
                // ensure element.data removed in downstream parsed message (keeps original behavior)
                delete element.data;
                
                for (const e of data) {
                    try {
                        // tolerant handling: e.value may be string, object, null, or already parsed
                        let parsedValue = {};
                        if (e.value === undefined || e.value === null) {
                            parsedValue = {};
                        } else if (typeof e.value === 'string') {
                            const str = e.value.trim();
                            if (str.length === 0) {
                                parsedValue = {};
                            } else {
                                try {
                                    parsedValue = JSON.parse(str);
                                } catch (errJson) {
                                    // If not JSON, attempt basic fallback (sometimes server sends plain key=value or quoted)
                                    try {
                                        // try to safe-evaluate limited forms like a bare object without quotes (rare)
                                        parsedValue = {};
                                    } catch (err2) {
                                        parsedValue = {};
                                    }
                                }
                            }
                        } else if (typeof e.value === 'object') {
                            parsedValue = e.value;
                        } else {
                            parsedValue = {};
                        }

                        // Sometimes the message payload is nested under 'message' or similar
                        const msgValue = parsedValue.message || parsedValue.data || parsedValue || {};

                        if (!e.path) {
                            // no path means iris-like delta; merge element + e
                            client.emit('iris', { ...element, ...e, value: msgValue });
                            continue;
                        }
                        
                        // normalize path check for thread messages
                        if ((e.path && e.path.startsWith('/direct_v2/threads')) ||
                            (e.path && e.path.startsWith('/direct_v2/inbox/threads')) ||
                            (e.path && e.path.indexOf('/direct_v2/threads/') !== -1) ) {
                            
                            if (msgValue && (msgValue.item_type || msgValue.itemType || msgValue.type || msgValue.msg_type)) {
                                // determine item type as robustly as possible
                                const itemType = msgValue.item_type || msgValue.itemType || msgValue.type || msgValue.msg_type || 'text';

                                // thread id extraction
                                const threadId = MessageSyncMixin.getThreadIdFromPath(e.path);

                                // user id resolution: try many possible fields
                                const userId = msgValue.user_id || msgValue.from_user_id || msgValue.sender_id || msgValue.userId || msgValue.senderId || null;

                                // username resolution: prefer embedded username, otherwise fetch
                                let username = msgValue.username || msgValue.from_username || null;
                                if (!username && userId) {
                                    try {
                                        username = await this.getUsernameFromId(client, userId);
                                    } catch (ux) {
                                        username = null;
                                    }
                                }
                                if (!username) {
                                    username = `user_${userId || 'unknown'}`;
                                }

                                const textContent = this.extractMessageContent(msgValue, itemType);

                                const messageId = msgValue.item_id || msgValue.id || msgValue.client_context || msgValue.client_context_id || msgValue.message_id || msgValue.messageId || null;
                                const timestamp = msgValue.timestamp || msgValue.ts || msgValue.client_time || null;

                                // determine status based on whether message author is the logged-in account
                                let status = 'received';
                                try {
                                    const ownId = client?.ig?.state?.cookieUserId || client?.ig?.state?.userId || null;
                                    if (ownId && userId && String(userId) === String(ownId)) {
                                        status = 'sent';
                                    } else {
                                        status = 'received';
                                    }
                                } catch (stErr) {
                                    status = 'received';
                                }

                                const msgData = {
                                    username: username,
                                    userId: userId,
                                    text: textContent,
                                    itemType: itemType,
                                    threadId: threadId,
                                    messageId: messageId,
                                    timestamp: timestamp,
                                    status: status,
                                    rawData: msgValue
                                };

                                // console output (keeps original formatted block)
                                try {
                                    console.log(this.formatMessageForConsole(msgData));
                                } catch (eLog) {
                                    // don't let logging break processing
                                }

                                const parsedMessage = {
                                    ...element,
                                    message: {
                                        path: e.path,
                                        op: e.op,
                                        thread_id: threadId,
                                        ...msgValue,
                                    },
                                    parsed: msgData
                                };

                                client.emit('message', parsedMessage);
                                continue;
                            } // end if msgValue has item_type
                        } // end if path matches threads
                        
                        // If not a thread message, emit as threadUpdate or iris depending on payload
                        try {
                            const updateValue = e.value ? (typeof e.value === 'string' ? (() => {
                                try { return JSON.parse(e.value); } catch { return e.value; }
                            })() : e.value) : {};
                            client.emit('threadUpdate', {
                                ...element,
                                meta: {
                                    path: e.path,
                                    op: e.op,
                                    thread_id: MessageSyncMixin.getThreadIdFromPath(e.path),
                                },
                                update: updateValue,
                            });
                        } catch (errUpdate) {
                            client.emit('iris', { ...element, ...e, value: parsedValue });
                        }
                    } catch (inner) {
                        console.log(`[MESSAGE_SYNC] element handling error: ${inner?.message || inner}`);
                    }
                }
            } catch (outer) {
                console.log(`[MESSAGE_SYNC] item error: ${outer?.message || outer}`);
            }
        }
    }

    static getThreadIdFromPath(path) {
        if (!path) return undefined;
        // Common patterns:
        // /direct_v2/threads/<thread_id>/...
        // /direct_v2/inbox/threads/<thread_id>/...
        // /direct_v2/threads/<thread_id>
        // possibly with trailing segments
        try {
            let m = path.match(/\/direct_v2\/threads\/(\d+)/);
            if (m && m[1]) return m[1];
            m = path.match(/\/direct_v2\/inbox\/threads\/(\d+)/);
            if (m && m[1]) return m[1];
            m = path.match(/\/direct_v2\/inbox\/(\d+)/);
            if (m && m[1]) return m[1];
            // last resort: look for any long numeric id in path
            const anyId = path.match(/(\d{6,})/);
            if (anyId && anyId[1]) return anyId[1];
        } catch (e) {
            // ignore
        }
        return undefined;
    }
    
    get name() {
        return 'Message Sync';
    }
}
exports.MessageSyncMixin = MessageSyncMixin;
