'use strict';
// Instagram version marker (adjust as you like)
Object.defineProperty(exports, "__esModule", { value: true });
exports.mqttotConnectFlow = exports.MQTToTClient = void 0;
exports.INSTAGRAM_VERSION = '415.0.0.36.76';

const shared_1 = require("../shared");
const mqttot_connect_request_packet_1 = require("./mqttot.connect.request.packet");
// Use external mqtts package (must be installed in your project)
const mqtts_1 = require("mqtts");
const errors_1 = require("../errors");
const mqttot_connect_response_packet_1 = require("./mqttot.connect.response.packet");

/**
 * MQTToTClient
 * - Subclasses external mqtts.MqttClient
 * - Adds Instagram-specific helpers (connect flow, compressed publish)
 * - Adds keepalive (PING) and robust reconnect with exponential backoff
 *
 * Comments/notes are inline. This file is ready to paste into your project.
 */
class MQTToTClient extends mqtts_1.MqttClient {
    /**
     * @param {Object} options
     *   options:
     *     - url: broker host
     *     - socksOptions: optional proxy options
     *     - autoReconnect: boolean
     *     - payloadProvider: async function returning connection payload (Thrift blob)
     *     - requirePayload: boolean (legacy behavior)
     *     - additionalOptions: transport options passthrough
     */
    constructor(options) {
        super({
            autoReconnect: options.autoReconnect,
            readMap: {
                ...mqtts_1.DefaultPacketReadMap,
                [mqtts_1.PacketType.ConnAck]: mqttot_connect_response_packet_1.readConnectResponsePacket,
            },
            writeMap: {
                ...mqtts_1.DefaultPacketWriteMap,
                [mqtts_1.PacketType.Connect]: mqttot_connect_request_packet_1.writeConnectRequestPacket,
            },
            transport: options.socksOptions
                ? new mqtts_1.SocksTlsTransport({
                    host: options.url,
                    port: 443,
                    proxyOptions: options.socksOptions,
                    additionalOptions: options.additionalOptions,
                })
                : new mqtts_1.TlsTransport({
                    host: options.url,
                    port: 443,
                    additionalOptions: options.additionalOptions,
                }),
        });

        // Save options for reconnect attempts
        this._options = options || {};
        // Debug helper prefixed with broker url
        this.mqttotDebug = (msg, ...args) => (0, shared_1.debugChannel)('mqttot')(`${this._options.url}: ${msg}`, ...args);
        this.connectPayloadProvider = options.payloadProvider;
        this.mqttotDebug(`Creating client`);
        // Register listeners (errors, disconnect, pingresps, etc.)
        this.registerListeners();
        this.requirePayload = options.requirePayload;

        this._keepaliveMs = (typeof options.keepaliveMs === 'number') ? options.keepaliveMs : (8 * 60 * 1000);
        this._consecutivePingFailures = 0;
        this._startKeepalive();
    }

    _startKeepalive() {
        try {
            if (this._keepaliveTimer) clearInterval(this._keepaliveTimer);
            const jitter = Math.floor(Math.random() * 30000);
            this._keepaliveTimer = setInterval(() => {
                try {
                    if (typeof this.ping === 'function') {
                        this.mqttotDebug('Sending PINGREQ (keepalive)');
                        const res = this.ping();
                        if (res && typeof res.then === 'function') {
                            res.then(() => {
                                this._consecutivePingFailures = 0;
                            }).catch((e) => {
                                this._consecutivePingFailures++;
                                this.mqttotDebug(`Ping failed (${this._consecutivePingFailures}): ${e?.message || e}`);
                                if (this._consecutivePingFailures >= 3) {
                                    this.mqttotDebug('3 consecutive ping failures - emitting disconnect for reconnect');
                                    this._consecutivePingFailures = 0;
                                    this.emit('disconnect', 'ping_failure');
                                }
                            });
                        }
                    } else {
                        this.mqttotDebug('ping() not available - keepalive skipped');
                    }
                } catch (e) {
                    this.mqttotDebug(`Ping error: ${e?.message || e}`);
                }
            }, this._keepaliveMs + jitter);
        } catch (e) {
            this.mqttotDebug(`Keepalive setup error: ${e?.message || e}`);
        }
    }

    /**
     * Stop keepalive timer (call on explicit close/disconnect)
     */
    _stopKeepalive() {
        try {
            if (this._keepaliveTimer) {
                clearInterval(this._keepaliveTimer);
                this._keepaliveTimer = null;
            }
        } catch (e) {
            // ignore
        }
    }

    /**
     * Register event listeners on the underlying mqtt client to handle:
     * - errors / warnings
     * - disconnects -> attempt reconnection with exponential backoff
     * - pingresp events for diagnostics
     */
    registerListeners() {
        const printErrorOrWarning = (type) => (e) => {
            if (typeof e === 'string') {
                this.mqttotDebug(`${type}: ${e}`);
            }
            else {
                this.mqttotDebug(`${type}: ${e.message}\n\tStack: ${e.stack}`);
            }
        };

        // Attach diagnostics
        this.on('error', printErrorOrWarning('Error'));
        this.on('warning', printErrorOrWarning('Warning'));

        // Listen to ping responses if the library emits them
        this.on('pingresp', () => {
            this.mqttotDebug('Received PINGRESP (keepalive ok)');
        });

        this.on('disconnect', async (reason) => {
            try {
                this.mqttotDebug(`Disconnected. Reason: ${reason}`);
                this._stopKeepalive();

                if (this._options && this._options.autoReconnect === false) {
                    this.mqttotDebug('autoReconnect disabled; will not attempt reconnect.');
                    return;
                }

                let delay = 3000 + Math.floor(Math.random() * 2000);
                const maxAttempts = 12;
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    try {
                        this.mqttotDebug(`Reconnect attempt #${attempt + 1} (delay ${delay}ms)`);
                        try { this.reset(); } catch (_e) {}
                        try { this.transport.reset(); } catch (_e) {}
                        try { this.transformer = this.createTransformer(); } catch (_e) {}
                        await this.connect(this._options);
                        this.mqttotDebug('Reconnected successfully');
                        this._consecutivePingFailures = 0;
                        this._startKeepalive();
                        return;
                    } catch (err) {
                        const errMsg = (err?.message || String(err)).toLowerCase();
                        const isRateLimit = errMsg.includes('rate') || errMsg.includes('throttl') || errMsg.includes('429');
                        this.mqttotDebug(`Reconnect attempt #${attempt + 1} failed: ${err?.message || err}`);
                        if (isRateLimit) {
                            delay = Math.min(delay * 3, 10 * 60 * 1000);
                        } else {
                            delay = Math.min(delay * 2, 5 * 60 * 1000);
                        }
                        const jitter = Math.floor(Math.random() * Math.min(delay * 0.2, 5000));
                        await new Promise(r => setTimeout(r, delay + jitter));
                    }
                }
                this.mqttotDebug(`Exceeded ${maxAttempts} reconnect attempts. Waiting for external trigger.`);
            } catch (e) {
                this.mqttotDebug(`Error in disconnect handler: ${e?.message || e}`);
            }
        });
    }

    /**
     * connect override
     * - Waits for connect payload from provider before calling parent connect
     */
    async connect(options) {
        // Acquire the payload (Thrift serialized connection blob) before connecting.
        if (typeof this.connectPayloadProvider === 'function') {
            try {
                this.connectPayload = await this.connectPayloadProvider();
            } catch (e) {
                this.mqttotDebug(`connectPayloadProvider failed: ${e?.message || e}`);
                throw e;
            }
        } else {
            this.mqttotDebug('No connectPayloadProvider provided; proceeding without payload');
            this.connectPayload = null;
        }
        // Call super.connect to establish connection
        return super.connect(options);
    }

    /**
     * Return an Instagram-flavored connect flow function for the mqtts client.
     * If payload is missing but CONNACK indicates success, accept it (robustness).
     */
    getConnectFlow() {
        if (!this.connectPayload) {
            throw new mqtts_1.IllegalStateError('Called getConnectFlow() before calling connect()');
        }
        return mqttotConnectFlow(this.connectPayload, this.requirePayload);
    }

    /**
     * Compresses payload using shared.compressDeflate and publishes with QoS 0.
     * QoS 0 forced for Instagram edge stability (avoid PUBACK waits causing reconnect loops).
     */
    async mqttotPublish(message) {
        this.mqttotDebug(`Publishing ${message.payload.byteLength || message.payload.length} bytes to topic ${message.topic}`);
        const compressed = await (0, shared_1.compressDeflate)(message.payload);
        return await this.publish({
            topic: message.topic,
            payload: compressed,
            qosLevel: 0, // FORCED: QoS 0 for stability on Instagram edge
        });
    }

    /**
     * Helper to listen for a specific topic and run transformer before calling handler.
     */
    listen(configOrTopic, handler) {
        if (typeof configOrTopic === 'string') {
            const topicId = configOrTopic;
            this.mqttotDebug(`[LISTEN] Setting up raw listener on topic ${topicId}`);
            const listener = async (msg) => {
                if (msg.topic === topicId) {
                    try {
                        handler(msg);
                    } catch (e) {
                        this.mqttotDebug(`Error in handler for topic ${topicId}: ${e?.message || e}`);
                        this.emit('error', e);
                    }
                }
            };
            this.on('message', listener);
            return () => { this.removeListener('message', listener); };
        }

        const config = configOrTopic;
        this.mqttotDebug(`[LISTEN] Setting up listener on topic ${config.topic} with transformer`);
        const listener = async (msg) => {
            if (msg.topic === config.topic) {
                try {
                    const data = await config.transformer({ payload: msg.payload });
                    handler(data);
                } catch (e) {
                    this.mqttotDebug(`Error in transformer for topic ${config.topic}: ${e?.message || e}`);
                    this.emit('error', e);
                }
            }
        };
        this.on('message', listener);
        return () => { this.removeListener('message', listener); };
    }

    /**
     * Clean shutdown helper: stop keepalive & close
     */
    async gracefulClose() {
        try {
            this._stopKeepalive();
            if (typeof super.close === 'function') {
                // some libs provide close() or end()
                await super.close();
            } else if (typeof super.end === 'function') {
                await super.end();
            }
        } catch (e) {
            this.mqttotDebug(`Error during gracefulClose: ${e?.message || e}`);
        }
    }
}
exports.MQTToTClient = MQTToTClient;

/**
 * mqttotConnectFlow
 * - Returns a flow object that the mqtts client uses to perform CONNECT/CONNACK handshake.
 * - Changed behavior: treat CONNACK success as success even if payload missing (robustness).
 */
function mqttotConnectFlow(payload, requirePayload) {
    return (success, error) => ({
        start: () => ({
            type: mqtts_1.PacketType.Connect,
            options: {
                payload,
                keepAlive: 60,
            },
        }),
        accept: mqtts_1.isConnAck,
        next: (packet) => {
            if (packet.isSuccess) {
                // Accept success even if payload is empty to avoid noisy errors
                success(packet);
            }
            else {
                error(new errors_1.ConnectionFailedError(`CONNACK returnCode: ${packet.returnCode} errorName: ${packet.errorName}`));
            }
        },
    });
}
exports.mqttotConnectFlow = mqttotConnectFlow;
