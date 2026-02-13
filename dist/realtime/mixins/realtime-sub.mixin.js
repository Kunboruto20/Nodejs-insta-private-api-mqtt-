"use strict";
/**
 * RealtimeSubMixin - ENHANCED VERSION
 * 
 * This file has been modified to include all MQTT features from instagram_mqtt library.
 * 
 * CHANGES MADE (from instagram_mqtt compatibility):
 * 1. Added import for subscriptions (QueryIDs) - was MISSING
 * 2. Added client.mqtt.listen() approach for REALTIME_SUB topic - was MISSING
 * 3. Added 'realtimeSub' event emission - was MISSING (only had 'subscription')
 * 4. Added 'direct' topic processing - was MISSING
 * 5. Added emitDirectEvent() method - was MISSING
 * 6. Added QueryIDs-based event emission (directTyping, appPresence, etc.) - was MISSING
 * 
 * PRESERVED:
 * - Original 'subscription' event emission (for backwards compatibility)
 * - Original on('message') approach with topicMap (extended, not replaced)
 * - All existing retry logic and error handling
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeSubMixin = void 0;
const mixin_1 = require("./mixin");
const constants_1 = require("../../constants");
const shared_1 = require("../../shared");
// ADDED: Import subscriptions for QueryIDs (was MISSING in nodejs-insta-private-api-mqtt)
const subscriptions_1 = require("../subscriptions");
const mqtts_1 = require("mqtts");

class RealtimeSubMixin extends mixin_1.Mixin {
    apply(client) {
        (0, mixin_1.hook)(client, 'connect', {
            post: async () => {
                // Wait for MQTT client to be ready (PRESERVED from original)
                let retries = 0;
                while (!client.mqtt && retries < 50) {
                    await new Promise(r => setTimeout(r, 100));
                    retries++;
                }
                if (!client.mqtt) {
                    throw new mqtts_1.IllegalStateError('No mqtt client created after retries');
                }

                // ADDED: Use client.mqtt.listen() for REALTIME_SUB topic (from instagram_mqtt)
                // This is the approach used by instagram_mqtt for handling realtime subscriptions
                if (client.mqtt.listen) {
                    client.mqtt.listen({
                        topic: constants_1.Topics.REALTIME_SUB.id,
                        transformer: async ({ payload }) => {
                            try {
                                return constants_1.Topics.REALTIME_SUB.parser.parseMessage(
                                    constants_1.Topics.REALTIME_SUB, 
                                    await (0, shared_1.tryUnzipAsync)(payload)
                                );
                            } catch (err) {
                                // If transformer fails, return null so handler can skip
                                console.warn('[RealtimeSubMixin] transformer parse failed:', err?.message || err);
                                return null;
                            }
                        },
                    }, data => {
                        if (data) {
                            // ADDED: Call the instagram_mqtt compatible handler
                            this.handleRealtimeSubFromListen(client, data);
                        }
                    });
                }

                // PRESERVED: Original on('message') approach with topicMap (for backwards compatibility)
                client.mqtt.on('message', async (msg) => {
                    const topicMap = client.mqtt?.topicMap;
                    const topic = topicMap?.get(msg.topic);
                    if (topic && topic.parser && !topic.noParse) {
                        try {
                            const unzipped = await (0, shared_1.tryUnzipAsync)(msg.payload);
                            const parsedMessages = topic.parser.parseMessage(topic, unzipped);
                            if (Array.isArray(parsedMessages)) {
                                parsedMessages.forEach(m => {
                                    this.handleRealtimeSub(client, topic, m.data);
                                });
                            } else {
                                this.handleRealtimeSub(client, topic, parsedMessages.data);
                            }
                        } catch (e) {
                            console.error(`RealtimeSub parse error on ${topic.path}:`, e.message);
                        }
                    }
                });
            },
        });
    }

    /**
     * ADDED: Handler compatible with instagram_mqtt's listen() approach
     * This method handles data from client.mqtt.listen() and emits instagram_mqtt compatible events
     * 
     * @param {Object} client - The realtime client instance
     * @param {Object} param1 - The parsed data object containing { data, topic }
     */
    handleRealtimeSubFromListen(client, { data, topic: messageTopic }) {
        const { message } = data;
        
        // ADDED: Emit 'realtimeSub' event (was MISSING - this is what instagram_mqtt does)
        client.emit('realtimeSub', { data, topic: messageTopic });
        
        // ADDED: Process message based on type (was MISSING)
        if (typeof message === 'string') {
            // If message is a string, parse it and emit direct event
            this.emitDirectEvent(client, JSON.parse(message));
        }
        else if (message) {
            const { topic, payload, json } = message;
            switch (topic) {
                case 'direct': {
                    // ADDED: Handle 'direct' topic specifically (was MISSING)
                    this.emitDirectEvent(client, json);
                    break;
                }
                default: {
                    // ADDED: Emit QueryID-based events (was MISSING)
                    // This emits events like 'directTyping', 'appPresence', 'directStatus', etc.
                    const entries = Object.entries(subscriptions_1.QueryIDs);
                    const query = entries.find(e => e[1] === topic);
                    if (query) {
                        client.emit(query[0], json || payload);
                    }
                }
            }
        }
    }

    /**
     * ADDED: Method to emit direct events (was MISSING from nodejs-insta-private-api-mqtt)
     * This method parses string values in parsed.data and emits 'direct' event for each
     * 
     * @param {Object} client - The realtime client instance  
     * @param {Object} parsed - The parsed message object containing data array
     */
    emitDirectEvent(client, parsed) {
        if (!parsed || !parsed.data || !Array.isArray(parsed.data)) {
            return;
        }
        
        parsed.data = parsed.data.map((e) => {
            if (typeof e.value === 'string') {
                try {
                    e.value = JSON.parse(e.value);
                } catch (parseErr) {
                    // If parsing fails, keep original value
                    console.warn('[RealtimeSubMixin] emitDirectEvent JSON parse failed:', parseErr?.message);
                }
            }
            return e;
        });
        
        // Emit 'direct' event for each data item
        parsed.data.forEach((data) => client.emit('direct', data));
    }

    /**
     * PRESERVED: Original handler for on('message') approach (for backwards compatibility)
     * This emits the 'subscription' event that existing code may depend on
     * 
     * @param {Object} client - The realtime client instance
     * @param {Object} topic - The topic object from topicMap
     * @param {Object} data - The parsed message data
     */
    handleRealtimeSub(client, topic, data) {
        // PRESERVED: Emit 'subscription' event (original behavior)
        client.emit('subscription', {
            query: topic.path,
            data: data,
            topic: topic,
        });
    }

    get name() {
        return 'Realtime Sub';
    }
}
exports.RealtimeSubMixin = RealtimeSubMixin;
//# sourceMappingURL=realtime-sub.mixin.js.map
