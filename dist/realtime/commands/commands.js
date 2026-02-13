"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Commands = void 0;
const shared_1 = require("../../shared");

class Commands {
    constructor(client) {
        this.client = client;
    }

    /**
     * Publish a compressed payload to a topic.
     * - Forces QoS 0 (no PUBACK wait) because Instagram internal MQTT often
     *   doesn't reply PUBACK for these internal topics and QoS1 causes timeouts
     *   and reconnect instability.
     * - No-op if client is not connected to avoid "Socket not writable" errors.
     * - Defensive checks: if the client exposes .connected or .isConnected(), respect them.
     */
    async publishToTopic(topic, compressedData, qos = 0) {
        try {
            // Defensive: ensure we have a client
            if (!this.client) return;

            // If client exposes a boolean 'connected' flag, respect it
            if (typeof this.client.connected !== 'undefined' && !this.client.connected) {
                return;
            }

            // If client exposes an isConnected() method, respect it
            if (typeof this.client.isConnected === 'function' && !this.client.isConnected()) {
                return;
            }

            // Build payload buffer
            const payloadBuf = compressedData instanceof Buffer ? compressedData : Buffer.from(compressedData);

            // Always publish with QoS 0 for stability on IG edge MQTT
            return this.client.publish({
                topic,
                payload: payloadBuf,
                qosLevel: 0,
            });
        } catch (err) {
            // Swallow non-fatal publish errors. Upper layers/watchdog should handle reconnections.
            return;
        }
    }

    /**
     * updateSubscriptions used by RealtimeClient for keepalive / subscription refreshes.
     * - Compresses the subscription payload and publishes with QoS 0.
     * - Skips publishing if the MQTT client doesn't appear ready.
     */
    async updateSubscriptions(options) {
        try {
            if (!this.client) return;

            // Defensive connection checks
            if (typeof this.client.connected !== 'undefined' && !this.client.connected) return;
            if (typeof this.client.isConnected === 'function' && !this.client.isConnected()) return;

            const payload = await (0, shared_1.compressDeflate)(JSON.stringify(options.data || {}));
            return this.publishToTopic(options.topic.id, payload, 0);
        } catch (e) {
            // Non-fatal — avoid bubbling errors from keepalive timers
            return;
        }
    }
}
exports.Commands = Commands;

