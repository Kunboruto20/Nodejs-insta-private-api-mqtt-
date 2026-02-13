"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedDirectCommands = void 0;

const shared_1 = require("../../shared");
const uuid_1 = require("uuid");
const constants_1 = require("../../constants");
const thrift_1 = require("../../thrift");

/**
 * EnhancedDirectCommands
 *
 * - Full, self-contained class that publishes correctly-formatted payloads to Instagram's
 *   Direct MQTT (Thrift + compressed payloads).
 * - Updated sendLocation implementation:
 *    1) try publish a story with a Location sticker (preferred, matches APK behavior)
 *    2) share that story to the thread (reel/media_share)
 *    3) fallback: send a link to /explore/locations/{placeId}/ if (1) fails
 *
 * Note: server-side validation may still reject location stickers in some contexts.
 */
class EnhancedDirectCommands {
    constructor(client) {
        this.realtimeClient = client;
        this.enhancedDebug = (0, shared_1.debugChannel)('realtime', 'enhanced-commands');

        // Foreground state config for Thrift encoding (matching instagram_mqtt)
        this.foregroundStateConfig = [
            thrift_1.ThriftDescriptors.boolean('inForegroundApp', 1),
            thrift_1.ThriftDescriptors.boolean('inForegroundDevice', 2),
            thrift_1.ThriftDescriptors.int32('keepAliveTimeout', 3),
            thrift_1.ThriftDescriptors.listOfBinary('subscribeTopics', 4),
            thrift_1.ThriftDescriptors.listOfBinary('subscribeGenericTopics', 5),
            thrift_1.ThriftDescriptors.listOfBinary('unsubscribeTopics', 6),
            thrift_1.ThriftDescriptors.listOfBinary('unsubscribeGenericTopics', 7),
            thrift_1.ThriftDescriptors.int64('requestId', 8),
        ];
    }

    /**
     * Attempt to locate the MQTT client object on the realtime client.
     * Many wrappers expose mqtt under different property names.
     */
    getMqtt() {
        const candidates = [
            'mqtt',
            '_mqtt',
            'client',
            '_client',
            'connection',
            'mqttClient',
        ];
        let mqtt = null;
        for (const key of candidates) {
            if (this.realtimeClient && Object.prototype.hasOwnProperty.call(this.realtimeClient, key) && this.realtimeClient[key]) {
                mqtt = this.realtimeClient[key];
                break;
            }
        }
        // fallback: maybe the realtimeClient itself *is* the mqtt client
        if (!mqtt && this.realtimeClient && typeof this.realtimeClient.publish === 'function') {
            mqtt = this.realtimeClient;
        }

        if (!mqtt || typeof mqtt.publish !== 'function') {
            throw new Error('MQTT client not available or does not expose publish(). Found client keys: ' +
                (this.realtimeClient ? Object.keys(this.realtimeClient).join(',') : 'none'));
        }
        return mqtt;
    }

    /**
     * Robust mqtt publish wrapper - handles both:
     * - mqtt.publish({ topic, payload, qosLevel }) returning a Promise or using callback
     * - mqtt.publish(topic, payload, { qos }, cb)
     */
    async publishToMqtt(mqtt, publishObj) {
        const topic = publishObj.topic;
        const payload = publishObj.payload;
        const qosLevel = typeof publishObj.qosLevel !== 'undefined' ? publishObj.qosLevel : 1;

        // Try object-style publish first (some wrappers expect object)
        try {
            const maybePromise = mqtt.publish({
                topic,
                payload,
                qosLevel,
            });
            if (maybePromise && typeof maybePromise.then === 'function') {
                return await maybePromise;
            }
            // if it returned synchronously, maybe it still used callback style
            return await new Promise((resolve, reject) => {
                try {
                    mqtt.publish({ topic, payload, qosLevel }, (err, res) => {
                        if (err)
                            return reject(err);
                        return resolve(res);
                    });
                } catch (err) {
                    reject(err);
                }
            });
        } catch (e) {
            // fallthrough to positional try
        }

        // Try positional-style publish (topic, payload, options, callback)
        try {
            return await new Promise((resolve, reject) => {
                try {
                    mqtt.publish(topic, payload, { qos: qosLevel }, (err, res) => {
                        if (err)
                            return reject(err);
                        return resolve(res);
                    });
                } catch (err) {
                    reject(err);
                }
            });
        } catch (e) {
            // final fallback: some clients return synchronously or throw - try positional without callback
            try {
                const res = mqtt.publish(topic, payload, { qos: qosLevel });
                if (res && typeof res.then === 'function') {
                    return await res;
                }
                // last attempt: resolve with returned value
                return res;
            } catch (err) {
                // give clear error
                throw new Error(`MQTT publish failed: no known publish signature worked. Errors: ${err && err.message ? err.message : String(err)}`);
            }
        }
    }

    /**
     * Send foreground state via MQTT with Thrift encoding (matching instagram_mqtt)
     */
    async sendForegroundState(state) {
        this.enhancedDebug(`Updated foreground state: ${JSON.stringify(state)}`);

        try {
            const mqtt = this.getMqtt();

            const thriftBuffer = (0, thrift_1.thriftWriteFromObject)(state, this.foregroundStateConfig);
            const concat = Buffer.concat([
                Buffer.alloc(1, 0),
                thriftBuffer
            ]);

            // ensure we pass Buffer to compressDeflate
            const payload = await (0, shared_1.compressDeflate)(concat);

            const result = await this.publishToMqtt(mqtt, {
                topic: constants_1.Topics.FOREGROUND_STATE.id,
                payload: payload,
                qosLevel: 1,
            });

            // Update keepAlive if provided
            if ((0, shared_1.notUndefined)(state.keepAliveTimeout)) {
                mqtt.keepAlive = state.keepAliveTimeout;
            }

            this.enhancedDebug(`✅ Foreground state updated via MQTT!`);
            return result;
        } catch (err) {
            this.enhancedDebug(`Foreground state failed: ${err && err.message ? err.message : String(err)}`);
            throw err;
        }
    }

    /**
     * Base command sender (matching instagram_mqtt format)
     * It encodes the command as JSON, compresses, and publishes to SEND_MESSAGE topic.
     */
    async sendCommand({ action, data, threadId, clientContext }) {
        try {
            const mqtt = this.getMqtt();

            if (clientContext) {
                data.client_context = clientContext;
            }

            const json = JSON.stringify({
                action,
                thread_id: threadId,
                ...data,
            });

            // ensure Buffer (some compress implementations expect Buffer)
            const payload = await (0, shared_1.compressDeflate)(Buffer.from(json));

            return this.publishToMqtt(mqtt, {
                topic: constants_1.Topics.SEND_MESSAGE.id,
                qosLevel: 1,
                payload: payload,
            });
        } catch (err) {
            this.enhancedDebug(`sendCommand failed: ${err && err.message ? err.message : String(err)}`);
            throw err;
        }
    }

    /**
     * Base item sender (matching instagram_mqtt format)
     */
    async sendItem({ threadId, itemType, data, clientContext }) {
        return this.sendCommand({
            action: 'send_item',
            threadId,
            clientContext: clientContext || (0, uuid_1.v4)(),
            data: {
                item_type: itemType,
                ...data,
            },
        });
    }

    /**
     * Send text via MQTT
     */
    async sendText({ text, clientContext, threadId }) {
        this.enhancedDebug(`Sending text to ${threadId}: "${text}"`);

        const result = await this.sendItem({
            itemType: 'text',
            threadId,
            clientContext,
            data: {
                text,
            },
        });

        this.enhancedDebug(`✅ Text sent via MQTT!`);
        return result;
    }

    /**
     * Alias for sendText
     */
    async sendTextViaRealtime(threadId, text, clientContext) {
        return this.sendText({
            text,
            threadId,
            clientContext,
        });
    }

    /**
     * Send hashtag via MQTT
     */
    async sendHashtag({ text, threadId, hashtag, clientContext }) {
        this.enhancedDebug(`Sending hashtag #${hashtag} to ${threadId}`);

        const result = await this.sendItem({
            itemType: 'hashtag',
            threadId,
            clientContext,
            data: {
                text: text || '',
                hashtag,
                item_id: hashtag,
            },
        });

        this.enhancedDebug(`✅ Hashtag sent via MQTT!`);
        return result;
    }

    /**
     * Send like via MQTT
     */
    async sendLike({ threadId, clientContext }) {
        this.enhancedDebug(`Sending like in thread ${threadId}`);

        const result = await this.sendItem({
            itemType: 'like',
            threadId,
            clientContext,
            data: {},
        });

        this.enhancedDebug(`✅ Like sent via MQTT!`);
        return result;
    }

    /**
     * Send location via MQTT (reworked)
     *
     * Now:
     *  - Tries to publish a Story with a Location sticker (preferred; matches APK behavior)
     *  - Shares that Story to the thread (reel_share / media_share)
     *  - If any step fails, falls back to sending a link to /explore/locations/{placeId}/
     *
     * venue shape expected:
     *  { id, name, address, lat, lng, facebook_places_id, external_source }
     */
    async sendLocation({ threadId, clientContext, venue, text = '' }) {
        this.enhancedDebug(`Attempting to send location to ${threadId}. Venue: ${venue ? JSON.stringify(venue) : 'none'}`);

        // Basic validation - need at least an id (or facebook_places_id)
        const hasCoords = venue && typeof venue.lat === 'number' && typeof venue.lng === 'number';
        const hasId = venue && (venue.facebook_places_id || venue.id);

        // prefer facebook_places_id if present
        const placeId = venue && (venue.facebook_places_id || venue.id);

        // create sticker structure (format used by many reverse-engineered clients)
        const sticker = this.createLocationStickerFromVenue(venue);

        // If we have an ig client capable of publishing stories, attempt the sticker flow.
        const ig = this.realtimeClient && this.realtimeClient.ig;
        if (ig && typeof ig.publish === 'object' && typeof ig.publish.story === 'function') {
            try {
                // Use a tiny placeholder image if caller didn't provide one (1x1 PNG)
                const SINGLE_PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=";
                const photoBuffer = Buffer.from(SINGLE_PIXEL_PNG_BASE64, 'base64');

                this.enhancedDebug(`Publishing story with location sticker (venue id: ${placeId})...`);

                // Build publish params. Many clients accept `file` and `stickers` array like this.
                const publishParams = {
                    file: photoBuffer,
                    stickers: [sticker],
                    // optional: caption/text not always supported on story publish in the same way; keep minimal
                };

                const publishResult = await ig.publish.story(publishParams);

                this.enhancedDebug(`Story publish result: ${publishResult ? JSON.stringify(publishResult).slice(0, 400) : 'no result'}`);

                // Try to resolve story media id
                let storyId = null;
                if (publishResult) {
                    // common fields returned by private clients
                    storyId = publishResult.media && (publishResult.media.pk || publishResult.media.id || publishResult.media_id) ||
                              publishResult.item_id || publishResult.upload_id || publishResult.media_id;
                }

                // If we didn't get a story id, try common fallback fields
                if (!storyId && publishResult && publishResult.params && publishResult.params.upload_id) {
                    storyId = publishResult.params.upload_id;
                }

                if (!storyId) {
                    // If publish succeeded but no usable id found, still attempt best-effort: some clients return a "media" object later on pubsub
                    this.enhancedDebug(`Could not determine story id from publish result; continuing to fallback to link/share attempt.`);
                    throw new Error('Could not determine story id from publish result.');
                }

                // Now share the story to the thread (reel_share/media_share)
                // Use the existing helper sendUserStory if available (it uses itemType: 'reel_share')
                this.enhancedDebug(`Sharing published story ${storyId} to thread ${threadId}...`);
                try {
                    const shareResult = await this.sendUserStory({
                        text: text || '',
                        storyId: storyId,
                        threadId,
                        clientContext: clientContext || (0, uuid_1.v4)(),
                    });
                    this.enhancedDebug(`✅ Location story shared to thread via MQTT! (storyId=${storyId})`);
                    return shareResult;
                } catch (shareErr) {
                    // If sharing via MQTT fails, try a fallback: some clients expose direct send helper
                    this.enhancedDebug(`Sharing story to thread failed: ${shareErr && shareErr.message ? shareErr.message : String(shareErr)}`);
                    // fall through to fallback link below
                    throw shareErr;
                }
            } catch (err) {
                this.enhancedDebug(`Story-with-sticker attempt failed: ${err && err.message ? err.message : String(err)} - falling back to link`);
                // fallthrough to fallback block below
            }
        } else {
            this.enhancedDebug(`ig.publish.story not available on realtimeClient.ig — will use fallback link if possible.`);
        }

        // Fallback: send as a link to the location explore page (guaranteed to render in DM)
        if (hasId) {
            const link = `https://www.instagram.com/explore/locations/${placeId}/`;
            this.enhancedDebug(`Sending location fallback link: ${link}`);

            try {
                const fallback = await this.sendItem({
                    itemType: 'link',
                    threadId,
                    clientContext: clientContext || (0, uuid_1.v4)(),
                    data: {
                        link_text: text || (venue && venue.name) || 'Location',
                        link_urls: [link],
                    },
                });
                this.enhancedDebug(`✅ Location fallback link sent via MQTT!`);
                return fallback;
            } catch (err) {
                this.enhancedDebug(`Fallback link send failed: ${err && err.message ? err.message : String(err)}`);
                throw err;
            }
        }

        // If we don't have any usable info, throw an error
        throw new Error('sendLocation requires a venue object with at least id (or facebook_places_id).');
    }

    /**
     * Helper that returns a "location sticker" object compatible with many reverse-engineered
     * clients / the publish.story helper. This mirrors the "LocationStickerClientModel" semantics.
     *
     * Format produced:
     * {
     *   type: 'location',
     *   location_id: '12345',
     *   location: { lat, lng, name, address, external_source, facebook_places_id },
     *   x: 0.5,
     *   y: 0.5,
     *   width: 0.7,
     *   height: 0.15,
     *   rotation: 0,
     *   is_pinned: false
     * }
     */
    createLocationStickerFromVenue(venue) {
        // Defensive defaults
        if (!venue) {
            throw new Error('venue required to create location sticker');
        }
        const placeId = venue.facebook_places_id || String(venue.id || '');
        const lat = (typeof venue.lat === 'number') ? venue.lat : (venue.location && venue.location.lat) || null;
        const lng = (typeof venue.lng === 'number') ? venue.lng : (venue.location && venue.location.lng) || null;

        const locationObj = {
            lat: lat,
            lng: lng,
            name: venue.name || '',
            address: venue.address || '',
            external_source: venue.external_source || 'facebook_places',
            facebook_places_id: placeId || '',
        };

        // Sticker appearance / position defaults - caller may tweak later if needed
        const sticker = {
            type: 'location',
            // some clients expect locationId, some expect venue_id or location_id
            locationId: placeId,
            venue_id: placeId,
            location: locationObj,
            x: 0.5,
            y: 0.5,
            width: 0.7,
            height: 0.15,
            rotation: 0,
            isPinned: false,
        };

        return sticker;
    }

    /**
     * Helper: search places via the Instagram client (optional).
     * If your realtimeClient has an .ig.request helper, this will call the appropriate
     * endpoint to fetch place metadata, and then call sendLocation with the full venue.
     *
     * This is optional — you can call sendLocation yourself with the venue object you already have.
     */
    async searchAndSendLocation({ threadId, query, lat, lng, clientContext }) {
        const ig = this.realtimeClient && this.realtimeClient.ig;
        if (!ig || !ig.request) {
            throw new Error('Instagram client (ig.request) not available on realtimeClient. Provide `venue` directly to sendLocation instead.');
        }

        this.enhancedDebug(`Searching location: ${query} at ${lat},${lng}`);

        // Example endpoint - private API endpoints vary. If your client has a helper method,
        // prefer that. This tries a common private endpoint pattern.
        const url = '/fbsearch/places/';
        const params = {
            search_media_creation: false,
            rank_token: (0, uuid_1.v4)(),
            query: query,
            latitude: lat,
            longitude: lng,
        };

        try {
            const res = await ig.request.send({
                url: url,
                method: 'GET',
                qs: params,
            });

            // Parse response - different private API clients return different shapes.
            // We try to find the first usable place with id/lat/lng/name.
            const places = (res && (res.places || res.items || res.results)) || [];
            const place = places.find(p => p && (p.pk || p.place || p.location || p.facebook_places_id)) || places[0];

            if (!place) {
                throw new Error('No places found from search.');
            }

            // Normalize to `venue` shape our sendLocation expects
            const venue = {
                id: String(place.pk || (place.place && place.place.id) || place.id || place.facebook_places_id || ''),
                name: place.name || (place.place && place.place.name) || '',
                address: place.address || (place.place && place.place.address) || '',
                lat: (place.location && (place.location.lat || place.location.latitude)) || place.lat || null,
                lng: (place.location && (place.location.lng || place.location.longitude)) || place.lng || null,
                facebook_places_id: place.facebook_places_id || (place.place && place.place.id) || String(place.pk || ''),
                external_source: place.external_source || 'facebook_places',
            };

            return await this.sendLocation({ threadId, clientContext, venue });
        } catch (err) {
            this.enhancedDebug(`place search/send failed: ${err && err.message ? err.message : String(err)}`);
            throw err;
        }
    }

    /**
     * Send media via MQTT (media_share)
     */
    async sendMedia({ text, mediaId, threadId, clientContext }) {
        this.enhancedDebug(`Sending media ${mediaId} to ${threadId}`);

        const result = await this.sendItem({
            itemType: 'media_share',
            threadId,
            clientContext,
            data: {
                text: text || '',
                media_id: mediaId,
            },
        });

        this.enhancedDebug(`✅ Media sent via MQTT!`);
        return result;
    }

    /**
     * Send profile via MQTT
     */
    async sendProfile({ text, userId, threadId, clientContext }) {
        this.enhancedDebug(`Sending profile ${userId} to ${threadId}`);

        const result = await this.sendItem({
            itemType: 'profile',
            threadId,
            clientContext,
            data: {
                text: text || '',
                profile_user_id: userId,
                item_id: userId,
            },
        });

        this.enhancedDebug(`✅ Profile sent via MQTT!`);
        return result;
    }

    /**
     * Send reaction via MQTT
     */
    async sendReaction({ itemId, reactionType, clientContext, threadId, reactionStatus, targetItemType, emoji }) {
        this.enhancedDebug(`Sending ${reactionType || 'like'} reaction to message ${itemId}`);

        const result = await this.sendItem({
            itemType: 'reaction',
            threadId,
            clientContext,
            data: {
                item_id: itemId,
                node_type: 'item',
                reaction_type: reactionType || (emoji ? 'emoji' : 'like'),
                reaction_status: reactionStatus || 'created',
                target_item_type: targetItemType,
                emoji: emoji || '',
            },
        });

        this.enhancedDebug(`✅ Reaction sent via MQTT!`);
        return result;
    }

    /**
     * Send user story via MQTT (reel_share)
     */
    async sendUserStory({ text, storyId, threadId, clientContext }) {
        this.enhancedDebug(`Sending story ${storyId} to ${threadId}`);

        const result = await this.sendItem({
            itemType: 'reel_share',
            threadId,
            clientContext,
            data: {
                text: text || '',
                item_id: storyId,
                media_id: storyId,
            },
        });

        this.enhancedDebug(`✅ Story sent via MQTT!`);
        return result;
    }

    /**
     * Mark as seen via REST API (with MQTT fallback)
     *
     * Instagram requires the REST endpoint /api/v1/direct_v2/threads/{threadId}/items/{itemId}/seen/
     * for marking messages as seen. The MQTT mark_seen action on topic 132 is not processed
     * by Instagram's servers. This method uses the ig client's REST API which is accessible
     * through the realtime client.
     */
    async markAsSeen({ threadId, itemId }) {
        this.enhancedDebug(`Marking message ${itemId} as seen in thread ${threadId}`);

        const ig = this.realtimeClient && this.realtimeClient.ig;
        if (ig && ig.request) {
            try {
                const clientContext = (0, uuid_1.v4)();
                const form = {
                    _uuid: ig.state.uuid,
                    device_id: ig.state.deviceId,
                    use_unified_inbox: true,
                    action: 'mark_seen',
                    thread_id: threadId,
                    item_id: itemId,
                    client_context: clientContext,
                    mutation_token: clientContext,
                };

                const response = await ig.request.send({
                    url: `/api/v1/direct_v2/threads/${threadId}/items/${itemId}/seen/`,
                    method: 'POST',
                    form: form,
                });

                const body = response.body || response.data || response;
                const parsed = typeof body === 'string' ? JSON.parse(body) : body;

                if (parsed && parsed.status === 'ok') {
                    this.enhancedDebug(`✅ Message marked as seen via REST API! Status: ok`);
                    return parsed;
                }

                this.enhancedDebug(`REST mark_seen response: ${JSON.stringify(parsed).slice(0, 300)}`);
                return parsed;
            } catch (restErr) {
                this.enhancedDebug(`REST mark_seen failed: ${restErr && restErr.message ? restErr.message : String(restErr)}, falling back to MQTT`);
            }
        } else {
            this.enhancedDebug(`ig.request not available, using MQTT fallback for mark_seen`);
        }

        const result = await this.sendCommand({
            action: 'mark_seen',
            threadId,
            data: {
                item_id: itemId,
            },
        });

        this.enhancedDebug(`⚠️ Message mark_seen sent via MQTT (fallback - may not be processed by Instagram)`);
        return result;
    }

    /**
     * Indicate activity (typing) via MQTT (activity_status)
     */
    async indicateActivity({ threadId, isActive, clientContext }) {
        const active = typeof isActive === 'undefined' ? true : isActive;
        this.enhancedDebug(`Indicating ${active ? 'typing' : 'stopped'} in thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'indicate_activity',
            threadId,
            clientContext: clientContext || (0, uuid_1.v4)(),
            data: {
                activity_status: active ? '1' : '0',
            },
        });

        this.enhancedDebug(`✅ Activity indicator sent via MQTT!`);
        return result;
    }

    /**
     * Delete message via MQTT
     */
    async deleteMessage(threadId, itemId) {
        this.enhancedDebug(`Deleting message ${itemId} from thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'delete_item',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {
                item_id: itemId,
            },
        });

        this.enhancedDebug(`✅ Message deleted via MQTT!`);
        return result;
    }

    /**
     * Edit message via MQTT
     */
    async editMessage(threadId, itemId, newText) {
        this.enhancedDebug(`Editing message ${itemId}: "${newText}"`);

        const result = await this.sendCommand({
            action: 'edit_item',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {
                item_id: itemId,
                text: newText,
            },
        });

        this.enhancedDebug(`✅ Message edited via MQTT!`);
        return result;
    }

    /**
     * Reply to message via MQTT (Quote Reply)
     */
    async replyToMessage(threadId, messageId, replyText) {
        this.enhancedDebug(`Replying to ${messageId} in thread ${threadId}: "${replyText}"`);

        const result = await this.sendItem({
            itemType: 'text',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {
                text: replyText,
                replied_to_item_id: messageId,
            },
        });

        this.enhancedDebug(`✅ Reply sent via MQTT!`);
        return result;
    }

    /**
     * Add member to thread via MQTT
     */
    async addMemberToThread(threadId, userId) {
        this.enhancedDebug(`Adding user ${userId} to thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'add_users',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {
                user_ids: Array.isArray(userId) ? userId : [userId],
            },
        });

        this.enhancedDebug(`✅ Member added to thread via MQTT!`);
        return result;
    }

    /**
     * Remove member from thread via MQTT
     */
    async removeMemberFromThread(threadId, userId) {
        this.enhancedDebug(`Removing user ${userId} from thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'remove_users',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {
                user_ids: Array.isArray(userId) ? userId : [userId],
            },
        });

        this.enhancedDebug(`✅ Member removed from thread via MQTT!`);
        return result;
    }

    /**
     * Leave thread via MQTT
     */
    async leaveThread(threadId) {
        this.enhancedDebug(`Leaving thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'leave',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {},
        });

        this.enhancedDebug(`✅ Left thread via MQTT!`);
        return result;
    }

    /**
     * Mute thread via MQTT
     */
    async muteThread(threadId, muteUntil = null) {
        this.enhancedDebug(`Muting thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'mute',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {
                mute_until: muteUntil,
            },
        });

        this.enhancedDebug(`✅ Thread muted via MQTT!`);
        return result;
    }

    /**
     * Unmute thread via MQTT
     */
    async unmuteThread(threadId) {
        this.enhancedDebug(`Unmuting thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'unmute',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {},
        });

        this.enhancedDebug(`✅ Thread unmuted via MQTT!`);
        return result;
    }

    /**
     * Update thread title via MQTT
     */
    async updateThreadTitle(threadId, title) {
        this.enhancedDebug(`Updating thread ${threadId} title to: "${title}"`);

        const result = await this.sendCommand({
            action: 'update_title',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {
                title: title,
            },
        });

        this.enhancedDebug(`✅ Thread title updated via MQTT!`);
        return result;
    }

    /**
     * Send link via MQTT
     */
    async sendLink({ link, text, threadId, clientContext }) {
        this.enhancedDebug(`Sending link ${link} to ${threadId}`);

        const result = await this.sendItem({
            itemType: 'link',
            threadId,
            clientContext,
            data: {
                link_text: text || '',
                // use array (not JSON string) to match instagram_mqtt expectations
                link_urls: [link],
            },
        });

        this.enhancedDebug(`✅ Link sent via MQTT!`);
        return result;
    }

    /**
     * Send animated media (GIF/sticker) via MQTT
     */
    async sendAnimatedMedia({ id, isSticker, threadId, clientContext }) {
        this.enhancedDebug(`Sending animated media ${id} to ${threadId}`);

        const result = await this.sendItem({
            itemType: 'animated_media',
            threadId,
            clientContext,
            data: {
                id: id,
                is_sticker: isSticker || false,
            },
        });

        this.enhancedDebug(`✅ Animated media sent via MQTT!`);
        return result;
    }

    /**
     * Send voice message via MQTT (after upload)
     */
    async sendVoice({ uploadId, waveform, waveformSamplingFrequencyHz, threadId, clientContext }) {
        this.enhancedDebug(`Sending voice ${uploadId} to ${threadId}`);

        const result = await this.sendItem({
            itemType: 'voice_media',
            threadId,
            clientContext,
            data: {
                upload_id: uploadId,
                waveform: waveform,
                waveform_sampling_frequency_hz: waveformSamplingFrequencyHz || 10,
            },
        });

        this.enhancedDebug(`✅ Voice sent via MQTT!`);
        return result;
    }

    /**
     * Send photo via Realtime (Upload + Broadcast)
     * Note: depends on realtimeClient.ig.request for uploading
     */
    async sendPhotoViaRealtime({ photoBuffer, threadId, caption = '', mimeType = 'image/jpeg', clientContext }) {
        this.enhancedDebug(`Sending photo to thread ${threadId} via Realtime`);

        try {
            if (!photoBuffer || !Buffer.isBuffer(photoBuffer) || photoBuffer.length === 0) {
                throw new Error('photoBuffer must be a non-empty Buffer');
            }
            if (!threadId) {
                throw new Error('threadId is required');
            }

            const ig = this.realtimeClient.ig;
            if (!ig || !ig.request) {
                throw new Error('Instagram client not available. Make sure you are logged in.');
            }

            this.enhancedDebug(`Step 1: Uploading photo (${photoBuffer.length} bytes)...`);

            const uploadId = Date.now().toString();
            const objectName = `${(0, uuid_1.v4)()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;

            const isJpeg = mimeType === 'image/jpeg' || mimeType === 'image/jpg';
            const compression = isJpeg
                ? '{"lib_name":"moz","lib_version":"3.1.m","quality":"80"}'
                : '{"lib_name":"png","lib_version":"1.0","quality":"100"}';

            const ruploadParams = {
                upload_id: uploadId,
                media_type: 1,
                image_compression: compression,
                xsharing_user_ids: JSON.stringify([]),
                is_clips_media: false,
            };

            const uploadHeaders = {
                'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
                'Content-Type': mimeType,
                'X_FB_PHOTO_WATERFALL_ID': (0, uuid_1.v4)(),
                'X-Entity-Type': mimeType,
                'X-Entity-Length': String(photoBuffer.length),
                'Content-Length': String(photoBuffer.length),
            };

            const uploadUrl = `/rupload_igphoto/${objectName}`;

            let serverUploadId = uploadId;
            try {
                const uploadResponse = await ig.request.send({
                    url: uploadUrl,
                    method: 'POST',
                    headers: uploadHeaders,
                    body: photoBuffer,
                });

                if (uploadResponse && typeof uploadResponse === 'object' && uploadResponse.upload_id) {
                    serverUploadId = uploadResponse.upload_id;
                }
                this.enhancedDebug(`✅ Photo uploaded! upload_id: ${serverUploadId}`);
            } catch (uploadErr) {
                this.enhancedDebug(`Upload error: ${uploadErr && uploadErr.message ? uploadErr.message : String(uploadErr)}`);
                throw new Error(`Photo upload failed: ${uploadErr && uploadErr.message ? uploadErr.message : String(uploadErr)}`);
            }

            this.enhancedDebug(`Step 2: Broadcasting photo to thread ${threadId}...`);

            const broadcastForm = {
                upload_id: serverUploadId,
                action: 'send_item',
                thread_ids: JSON.stringify([String(threadId)]),
            };

            if (caption) {
                broadcastForm.caption = caption;
            }

            try {
                const broadcastResponse = await ig.request.send({
                    url: '/direct_v2/threads/broadcast/upload_photo/',
                    method: 'POST',
                    form: broadcastForm,
                });

                this.enhancedDebug(`✅ Photo sent successfully to thread ${threadId}!`);
                return broadcastResponse;
            } catch (broadcastErr) {
                this.enhancedDebug(`Broadcast error: ${broadcastErr && broadcastErr.message ? broadcastErr.message : String(broadcastErr)}`);
                throw new Error(`Photo broadcast failed: ${broadcastErr && broadcastErr.message ? broadcastErr.message : String(broadcastErr)}`);
            }

        } catch (err) {
            this.enhancedDebug(`sendPhotoViaRealtime failed: ${err && err.message ? err.message : String(err)}`);
            throw err;
        }
    }

    /**
     * Alias for sendPhotoViaRealtime
     */
    async sendPhoto(options) {
        return this.sendPhotoViaRealtime(options);
    }

    /**
     * Send video via Realtime (Upload + Broadcast)
     * Note: depends on realtimeClient.ig.request for uploading
     */
    async sendVideoViaRealtime({ videoBuffer, threadId, caption = '', duration = 0, width = 720, height = 1280, clientContext }) {
        this.enhancedDebug(`Sending video to thread ${threadId} via Realtime`);

        try {
            if (!videoBuffer || !Buffer.isBuffer(videoBuffer) || videoBuffer.length === 0) {
                throw new Error('videoBuffer must be a non-empty Buffer');
            }
            if (!threadId) {
                throw new Error('threadId is required');
            }

            const ig = this.realtimeClient.ig;
            if (!ig || !ig.request) {
                throw new Error('Instagram client not available. Make sure you are logged in.');
            }

            this.enhancedDebug(`Step 1: Uploading video (${videoBuffer.length} bytes)...`);

            const uploadId = Date.now().toString();
            const objectName = `${(0, uuid_1.v4)()}.mp4`;

            const ruploadParams = {
                upload_id: uploadId,
                media_type: 2,
                xsharing_user_ids: JSON.stringify([]),
                upload_media_duration_ms: Math.round(duration * 1000),
                upload_media_width: width,
                upload_media_height: height,
            };

            const uploadHeaders = {
                'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
                'Content-Type': 'video/mp4',
                'X_FB_VIDEO_WATERFALL_ID': (0, uuid_1.v4)(),
                'X-Entity-Type': 'video/mp4',
                'X-Entity-Length': String(videoBuffer.length),
                'Content-Length': String(videoBuffer.length),
                'Offset': '0',
            };

            const uploadUrl = `/rupload_igvideo/${objectName}`;

            let serverUploadId = uploadId;
            try {
                const uploadResponse = await ig.request.send({
                    url: uploadUrl,
                    method: 'POST',
                    headers: uploadHeaders,
                    body: videoBuffer,
                });

                if (uploadResponse && typeof uploadResponse === 'object' && uploadResponse.upload_id) {
                    serverUploadId = uploadResponse.upload_id;
                }
                this.enhancedDebug(`✅ Video uploaded! upload_id: ${serverUploadId}`);
            } catch (uploadErr) {
                this.enhancedDebug(`Video upload error: ${uploadErr && uploadErr.message ? uploadErr.message : String(uploadErr)}`);
                throw new Error(`Video upload failed: ${uploadErr && uploadErr.message ? uploadErr.message : String(uploadErr)}`);
            }

            this.enhancedDebug(`Step 2: Broadcasting video to thread ${threadId}...`);

            const broadcastForm = {
                upload_id: serverUploadId,
                action: 'send_item',
                thread_ids: JSON.stringify([String(threadId)]),
                video_result: '',
            };

            if (caption) {
                broadcastForm.caption = caption;
            }

            try {
                const broadcastResponse = await ig.request.send({
                    url: '/direct_v2/threads/broadcast/upload_video/',
                    method: 'POST',
                    form: broadcastForm,
                });

                this.enhancedDebug(`✅ Video sent successfully to thread ${threadId}!`);
                return broadcastResponse;
            } catch (broadcastErr) {
                this.enhancedDebug(`Video broadcast error: ${broadcastErr && broadcastErr.message ? broadcastErr.message : String(broadcastErr)}`);
                throw new Error(`Video broadcast failed: ${broadcastErr && broadcastErr.message ? broadcastErr.message : String(broadcastErr)}`);
            }

        } catch (err) {
            this.enhancedDebug(`sendVideoViaRealtime failed: ${err && err.message ? err.message : String(err)}`);
            throw err;
        }
    }

    /**
     * Alias for sendVideoViaRealtime
     */
    async sendVideo(options) {
        return this.sendVideoViaRealtime(options);
    }

    /**
     * Approve pending thread via MQTT
     */
    async approveThread(threadId) {
        this.enhancedDebug(`Approving thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'approve',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {},
        });

        this.enhancedDebug(`✅ Thread approved via MQTT!`);
        return result;
    }

    /**
     * Decline pending thread via MQTT
     */
    async declineThread(threadId) {
        this.enhancedDebug(`Declining thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'decline',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {},
        });

        this.enhancedDebug(`✅ Thread declined via MQTT!`);
        return result;
    }

    /**
     * Block user in thread via MQTT
     */
    async blockUserInThread(threadId, userId) {
        this.enhancedDebug(`Blocking user ${userId} in thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'block',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {
                user_id: userId,
            },
        });

        this.enhancedDebug(`✅ User blocked in thread via MQTT!`);
        return result;
    }

    /**
     * Report thread via MQTT
     */
    async reportThread(threadId, reason) {
        this.enhancedDebug(`Reporting thread ${threadId}`);

        const result = await this.sendCommand({
            action: 'report',
            threadId,
            clientContext: (0, uuid_1.v4)(),
            data: {
                reason: reason || 'spam',
            },
        });

        this.enhancedDebug(`✅ Thread reported via MQTT!`);
        return result;
    }

    /**
     * Remove reaction via MQTT
     */
    async removeReaction({ itemId, threadId, clientContext }) {
        this.enhancedDebug(`Removing reaction from message ${itemId}`);

        const result = await this.sendItem({
            itemType: 'reaction',
            threadId,
            clientContext,
            data: {
                item_id: itemId,
                node_type: 'item',
                reaction_type: 'like',
                reaction_status: 'deleted',
            },
        });

        this.enhancedDebug(`✅ Reaction removed via MQTT!`);
        return result;
    }

    /**
     * Send disappearing photo via MQTT (broadcast only - requires pre-uploaded media)
     */
    async sendDisappearingPhoto({ uploadId, threadId, viewMode = 'once', clientContext }) {
        this.enhancedDebug(`Sending disappearing photo to ${threadId}`);

        const result = await this.sendItem({
            itemType: 'expiring_media_message',
            threadId,
            clientContext,
            data: {
                upload_id: uploadId,
                view_mode: viewMode,
                allow_replay: viewMode === 'replayable',
            },
        });

        this.enhancedDebug(`✅ Disappearing photo sent via MQTT!`);
        return result;
    }

    /**
     * Send disappearing video via MQTT (broadcast only - requires pre-uploaded media)
     */
    async sendDisappearingVideo({ uploadId, threadId, viewMode = 'once', clientContext }) {
        this.enhancedDebug(`Sending disappearing video to ${threadId}`);

        const result = await this.sendItem({
            itemType: 'expiring_media_message',
            threadId,
            clientContext,
            data: {
                upload_id: uploadId,
                view_mode: viewMode,
                allow_replay: viewMode === 'replayable',
                media_type: 2,
            },
        });

        this.enhancedDebug(`✅ Disappearing video sent via MQTT!`);
        return result;
    }

    /**
     * Send raven (view-once) photo - COMPLETE flow: Upload via REST + Broadcast via REST
     *
     * Flow:
     * 1. Upload photo to rupload_igphoto with direct_v2='1' (marks as DM media)
     * 2. Broadcast via REST to /direct_v2/threads/broadcast/raven_attachment/
     *
     * @param {Object} options
     * @param {Buffer} options.photoBuffer - The photo as a Buffer
     * @param {string} options.threadId - Thread ID to send to
     * @param {number} [options.ephemeralMediaViewMode=0] - 0 = view-once, 1 = replayable
     * @param {string} [options.viewMode='once'] - 'once' or 'replayable' (legacy, mapped to ephemeralMediaViewMode)
     * @param {string} [options.mimeType='image/jpeg'] - MIME type of the image
     * @returns {Promise<Object>} - REST broadcast response
     */
    async sendRavenPhoto({ photoBuffer, threadId, ephemeralMediaViewMode, viewMode = 'once', mimeType = 'image/jpeg' }) {
        const resolvedViewMode = (ephemeralMediaViewMode !== undefined)
            ? ephemeralMediaViewMode
            : (viewMode === 'replayable' ? 1 : 0);

        this.enhancedDebug(`Sending raven photo to thread ${threadId} (ephemeral_media_view_mode: ${resolvedViewMode})`);

        try {
            if (!photoBuffer || !Buffer.isBuffer(photoBuffer) || photoBuffer.length === 0) {
                throw new Error('photoBuffer must be a non-empty Buffer');
            }
            if (!threadId) {
                throw new Error('threadId is required');
            }

            const ig = this.realtimeClient.ig;
            if (!ig || !ig.request) {
                throw new Error('Instagram client not available. Make sure you are logged in.');
            }

            this.enhancedDebug(`Step 1: Uploading raven photo (${photoBuffer.length} bytes)...`);

            const uploadId = Date.now().toString();
            const randomSuffix = Math.floor(Math.random() * (9999999999 - 1000000000) + 1000000000);
            const name = `${uploadId}_0_${randomSuffix}`;
            const waterfallId = (0, uuid_1.v4)();

            const ruploadParams = {
                retry_context: '{"num_step_auto_retry":0,"num_reupload":0,"num_step_manual_retry":0}',
                media_type: '1',
                upload_id: uploadId,
                image_compression: '{"lib_name":"moz","lib_version":"3.1.m","quality":"95"}',
                xsharing_user_ids: JSON.stringify([]),
                direct_v2: '1',
            };

            const uploadHeaders = {
                'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
                'X_FB_PHOTO_WATERFALL_ID': waterfallId,
                'X-Entity-Type': 'image/jpeg',
                'X-Entity-Name': name,
                'X-Entity-Length': String(photoBuffer.length),
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(photoBuffer.length),
                'Offset': '0',
            };

            const uploadUrl = `/rupload_igphoto/${name}`;

            let serverUploadId = uploadId;
            try {
                const uploadResponse = await ig.request.send({
                    url: uploadUrl,
                    method: 'POST',
                    headers: uploadHeaders,
                    data: photoBuffer,
                    transformRequest: [(d) => d],
                });

                const respBody = uploadResponse.body || uploadResponse.data || uploadResponse;
                const parsed = typeof respBody === 'string' ? JSON.parse(respBody) : respBody;
                if (parsed && (parsed.upload_id || (parsed.media && parsed.media.upload_id))) {
                    serverUploadId = (parsed.upload_id || parsed.media.upload_id).toString();
                }
                this.enhancedDebug(`Raven photo uploaded! upload_id: ${serverUploadId}`);
            } catch (uploadErr) {
                const msg = uploadErr && uploadErr.message ? uploadErr.message : String(uploadErr);
                this.enhancedDebug(`Raven photo upload error: ${msg}`);
                throw new Error(`Raven photo upload failed: ${msg}`);
            }

            this.enhancedDebug(`Step 2: Broadcasting via REST to raven_attachment/ (ephemeral_media_view_mode=${resolvedViewMode})...`);

            const clientCtx = (0, uuid_1.v4)();

            const form = {
                action: 'send_item',
                upload_id: serverUploadId,
                thread_ids: JSON.stringify([String(threadId)]),
                client_context: clientCtx,
                _csrftoken: ig.state.cookieCsrfToken,
                mutation_token: clientCtx,
                offline_threading_id: clientCtx,
                device_id: ig.state.deviceId,
                _uuid: ig.state.uuid,
                ephemeral_media_view_mode: String(resolvedViewMode),
            };

            const payloadForm = (ig.request && typeof ig.request.sign === 'function')
                ? ig.request.sign(form)
                : form;

            const result = await ig.request.send({
                url: '/api/v1/direct_v2/threads/broadcast/raven_attachment/',
                method: 'POST',
                form: payloadForm,
                qs: { use_unified_inbox: true },
            });

            const body = result && (result.body || result.data || result);
            this.enhancedDebug(`Raven photo REST broadcast result received`);
            return typeof body === 'string' ? JSON.parse(body) : body;

        } catch (err) {
            this.enhancedDebug(`sendRavenPhoto failed: ${err && err.message ? err.message : String(err)}`);
            throw err;
        }
    }

    /**
     * Send raven (view-once) video - COMPLETE flow: Upload via REST + Broadcast via REST
     *
     * Flow:
     * 1. Upload video to rupload_igvideo with direct_v2='1' (marks as DM media)
     * 2. Broadcast via REST to /direct_v2/threads/broadcast/raven_attachment/
     *
     * @param {Object} options
     * @param {Buffer} options.videoBuffer - The video as a Buffer
     * @param {string} options.threadId - Thread ID to send to
     * @param {number} [options.ephemeralMediaViewMode=0] - 0 = view-once, 1 = replayable
     * @param {string} [options.viewMode='once'] - 'once' or 'replayable' (legacy, mapped to ephemeralMediaViewMode)
     * @param {number} [options.duration=0] - Duration in seconds
     * @param {number} [options.width=720] - Video width
     * @param {number} [options.height=1280] - Video height
     * @returns {Promise<Object>} - REST broadcast response
     */
    async sendRavenVideo({ videoBuffer, threadId, ephemeralMediaViewMode, viewMode = 'once', duration = 0, width = 720, height = 1280 }) {
        const resolvedViewMode = (ephemeralMediaViewMode !== undefined)
            ? ephemeralMediaViewMode
            : (viewMode === 'replayable' ? 1 : 0);

        this.enhancedDebug(`Sending raven video to thread ${threadId} (ephemeral_media_view_mode: ${resolvedViewMode})`);

        try {
            if (!videoBuffer || !Buffer.isBuffer(videoBuffer) || videoBuffer.length === 0) {
                throw new Error('videoBuffer must be a non-empty Buffer');
            }
            if (!threadId) {
                throw new Error('threadId is required');
            }

            const ig = this.realtimeClient.ig;
            if (!ig || !ig.request) {
                throw new Error('Instagram client not available. Make sure you are logged in.');
            }

            this.enhancedDebug(`Step 1: Uploading raven video (${videoBuffer.length} bytes)...`);

            const uploadId = Date.now().toString();
            const randomSuffix = Math.floor(Math.random() * (9999999999 - 1000000000) + 1000000000);
            const name = `${uploadId}_0_${randomSuffix}`;
            const waterfallId = (0, uuid_1.v4)();

            const ruploadParams = {
                upload_media_height: String(height),
                upload_media_width: String(width),
                upload_media_duration_ms: String(Math.round(duration * 1000)),
                upload_id: uploadId,
                retry_context: '{"num_step_auto_retry":0,"num_reupload":0,"num_step_manual_retry":0}',
                media_type: '2',
                xsharing_user_ids: JSON.stringify([]),
                direct_v2: '1',
            };

            const uploadHeaders = {
                'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
                'X_FB_VIDEO_WATERFALL_ID': waterfallId,
                'X-Entity-Type': 'video/mp4',
                'X-Entity-Name': name,
                'X-Entity-Length': String(videoBuffer.length),
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(videoBuffer.length),
                'Offset': '0',
            };

            const uploadUrl = `/rupload_igvideo/${name}`;

            let serverUploadId = uploadId;
            try {
                const uploadResponse = await ig.request.send({
                    url: uploadUrl,
                    method: 'POST',
                    headers: uploadHeaders,
                    data: videoBuffer,
                    transformRequest: [(d) => d],
                });

                const respBody = uploadResponse.body || uploadResponse.data || uploadResponse;
                const parsed = typeof respBody === 'string' ? JSON.parse(respBody) : respBody;
                if (parsed && (parsed.upload_id || (parsed.media && parsed.media.upload_id))) {
                    serverUploadId = (parsed.upload_id || parsed.media.upload_id).toString();
                }
                this.enhancedDebug(`Raven video uploaded! upload_id: ${serverUploadId}`);
            } catch (uploadErr) {
                const msg = uploadErr && uploadErr.message ? uploadErr.message : String(uploadErr);
                this.enhancedDebug(`Raven video upload error: ${msg}`);
                throw new Error(`Raven video upload failed: ${msg}`);
            }

            this.enhancedDebug(`Step 2: Broadcasting via REST to raven_attachment/ (ephemeral_media_view_mode=${resolvedViewMode})...`);

            const clientCtx = (0, uuid_1.v4)();

            const form = {
                action: 'send_item',
                upload_id: serverUploadId,
                thread_ids: JSON.stringify([String(threadId)]),
                client_context: clientCtx,
                _csrftoken: ig.state.cookieCsrfToken,
                mutation_token: clientCtx,
                offline_threading_id: clientCtx,
                device_id: ig.state.deviceId,
                _uuid: ig.state.uuid,
                ephemeral_media_view_mode: String(resolvedViewMode),
            };

            const payloadForm = (ig.request && typeof ig.request.sign === 'function')
                ? ig.request.sign(form)
                : form;

            const result = await ig.request.send({
                url: '/api/v1/direct_v2/threads/broadcast/raven_attachment/',
                method: 'POST',
                form: payloadForm,
                qs: { use_unified_inbox: true },
            });

            const body = result && (result.body || result.data || result);
            this.enhancedDebug(`Raven video REST broadcast result received`);
            return typeof body === 'string' ? JSON.parse(body) : body;

        } catch (err) {
            this.enhancedDebug(`sendRavenVideo failed: ${err && err.message ? err.message : String(err)}`);
            throw err;
        }
    }

    /**
     * Mark visual message as seen via REST API (with MQTT fallback)
     */
    async markVisualMessageSeen({ threadId, itemId, clientContext }) {
        this.enhancedDebug(`Marking visual message ${itemId} as seen`);

        const ig = this.realtimeClient && this.realtimeClient.ig;
        if (ig && ig.request) {
            try {
                const ctx = clientContext || (0, uuid_1.v4)();
                const form = {
                    _uuid: ig.state.uuid,
                    device_id: ig.state.deviceId,
                    use_unified_inbox: true,
                    action: 'mark_visual_item_seen',
                    thread_id: threadId,
                    item_id: itemId,
                    client_context: ctx,
                    mutation_token: ctx,
                };

                const response = await ig.request.send({
                    url: `/api/v1/direct_v2/threads/${threadId}/items/${itemId}/seen/`,
                    method: 'POST',
                    form: form,
                });

                const body = response.body || response.data || response;
                const parsed = typeof body === 'string' ? JSON.parse(body) : body;

                if (parsed && parsed.status === 'ok') {
                    this.enhancedDebug(`✅ Visual message marked as seen via REST API! Status: ok`);
                    return parsed;
                }

                this.enhancedDebug(`REST mark_visual_item_seen response: ${JSON.stringify(parsed).slice(0, 300)}`);
                return parsed;
            } catch (restErr) {
                this.enhancedDebug(`REST mark_visual_item_seen failed: ${restErr && restErr.message ? restErr.message : String(restErr)}, falling back to MQTT`);
            }
        }

        const result = await this.sendCommand({
            action: 'mark_visual_item_seen',
            threadId,
            clientContext: clientContext || (0, uuid_1.v4)(),
            data: {
                item_id: itemId,
            },
        });

        this.enhancedDebug(`⚠️ Visual message mark_seen sent via MQTT (fallback - may not be processed by Instagram)`);
        return result;
    }

    /**
     * Screenshot notification via MQTT
     */
    async sendScreenshotNotification({ threadId, itemId, clientContext }) {
        this.enhancedDebug(`Sending screenshot notification for ${itemId}`);

        const result = await this.sendCommand({
            action: 'screenshot_notification',
            threadId,
            clientContext: clientContext || (0, uuid_1.v4)(),
            data: {
                item_id: itemId,
            },
        });

        this.enhancedDebug(`✅ Screenshot notification sent via MQTT!`);
        return result;
    }

    /**
     * Replay notification via MQTT
     */
    async sendReplayNotification({ threadId, itemId, clientContext }) {
        this.enhancedDebug(`Sending replay notification for ${itemId}`);

        const result = await this.sendCommand({
            action: 'replay_notification',
            threadId,
            clientContext: clientContext || (0, uuid_1.v4)(),
            data: {
                item_id: itemId,
            },
        });

        this.enhancedDebug(`✅ Replay notification sent via MQTT!`);
        return result;
    }
}

exports.EnhancedDirectCommands = EnhancedDirectCommands;
