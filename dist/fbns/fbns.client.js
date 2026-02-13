"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FbnsClient = void 0;
const constants_1 = require("../constants");
const fbns_device_auth_1 = require("./fbns.device-auth");
const shared_1 = require("../shared");
const mqttot_1 = require("../mqttot");
const chance_1 = require("chance");
const mqtts_1 = require("../mqtt-shim");
const errors_1 = require("../errors");
const eventemitter3_1 = require("eventemitter3");
const fbns_utilities_1 = require("./fbns.utilities");

/**
 * FbnsClient
 *
 * Lightweight wrapper around MQTToTClient to handle FBNS-specific connection
 * payloads, registration, message handling and safe disconnect behavior.
 *
 * NOTE: This file contains a small but important robustness change:
 * when receiving an empty CONNACK payload we no longer force a disconnect.
 * Instagram sometimes returns a successful CONNACK with an empty payload;
 * treating that as a fatal error causes unnecessary disconnect loops.
 */
class FbnsClient extends eventemitter3_1.EventEmitter {
    get auth() {
        return this._auth;
    }
    set auth(value) {
        this._auth = value;
    }
    constructor(ig) {
        super();
        this.ig = ig;
        this.fbnsDebug = (0, shared_1.debugChannel)('fbns');
        this.safeDisconnect = false;
        this._auth = new fbns_device_auth_1.FbnsDeviceAuth(this.ig);
    }

    buildConnection() {
        this.fbnsDebug('Constructing connection');
        this.conn = new mqttot_1.MQTToTConnection({
            clientIdentifier: this._auth.clientId,
            clientInfo: {
                userId: BigInt(this._auth.userId),
                userAgent: (0, shared_1.createFbnsUserAgent)(this.ig),
                clientCapabilities: 183,
                endpointCapabilities: 128,
                publishFormat: 1,
                noAutomaticForeground: true,
                makeUserAvailableInForeground: false,
                deviceId: this._auth.deviceId,
                isInitiallyForeground: false,
                networkType: 1,
                networkSubtype: 0,
                clientMqttSessionId: BigInt(Date.now()) & BigInt(0xffffffff),
                subscribeTopics: [76, 80, 231],
                clientType: 'device_auth',
                appId: BigInt(567310203415052),
                deviceSecret: this._auth.deviceSecret,
                anotherUnknown: BigInt(-1),
                clientStack: 3,
            },
            password: this._auth.password,
        });
    }

    /**
     * Connect to FBNS (Firebase/FBNS equivalent over Instagram MQTT)
     *
     * Options:
     *  - enableTrace
     *  - autoReconnect
     *  - socksOptions
     *  - additionalTlsOptions
     *
     * Important robustness changes:
     *  - Do not force disconnect on empty CONNACK payload; log and continue.
     *  - Use clean:false to prefer session resume on reconnect (less aggressive).
     */
    async connect({ enableTrace, autoReconnect, socksOptions, additionalTlsOptions, } = {}) {
        this.fbnsDebug('Connecting to FBNS...');
        // Ensure auth info is up-to-date
        this.auth.update();

        this.client = new mqttot_1.MQTToTClient({
            url: constants_1.FBNS.HOST_NAME_V6,
            payloadProvider: () => {
                this.buildConnection();
                if (!this.conn) {
                    throw new errors_1.InvalidStateError("No connection created - can't build provider");
                }
                return (0, shared_1.compressDeflate)(this.conn.toThrift());
            },
            enableTrace,
            autoReconnect: autoReconnect ?? true,
            requirePayload: false,
            socksOptions,
            additionalOptions: additionalTlsOptions,
        });

        // Re-emit warnings/errors to outer listeners
        this.client.on('warning', w => this.emit('warning', w));
        this.client.on('error', e => this.emit('error', e));

        // If disconnect happens and safeDisconnect is false, emit error to upper layer
        this.client.on('disconnect', reason => this.safeDisconnect
            ? this.emit('disconnect', reason && JSON.stringify(reason))
            : this.emit('error', new errors_1.ClientDisconnectedError(`MQTToTClient got disconnected. Reason: ${reason && JSON.stringify(reason)}`)));

        // Listen for FBNS messages and transform them accordingly
        this.client.listen(constants_1.FbnsTopics.FBNS_MESSAGE.id, msg => this.handleMessage(msg));
        this.client.listen({
            topic: constants_1.FbnsTopics.FBNS_EXP_LOGGING.id,
            transformer: async (msg) => JSON.parse((await (0, shared_1.tryUnzipAsync)(msg.payload)).toString()),
        }, msg => this.emit('logging', msg));
        this.client.listen(constants_1.FbnsTopics.PP.id, msg => this.emit('pp', msg.payload.toString()));

        // Handle connect event from the underlying mqtt client
        this.client.on('connect', async (res) => {
            if (!this.client) {
                throw new mqtts_1.IllegalStateError('No client registered but an event was received');
            }

            this.fbnsDebug('Connected to MQTT');

            // IMPORTANT: Instagram sometimes returns a valid CONNACK with an empty payload.
            // Historically this library treated that as an error and disconnected.
            // That behavior causes unnecessary reconnect loops. Instead, log and continue.
            if (!res.payload?.length) {
                this.fbnsDebug(`Received empty connect packet. Reason: ${res.errorName} (continuing without disconnect)`);
                // Emit a warning but do not disconnect.
                this.emit('warning', new errors_1.EmptyPacketError('Received empty connect packet (continuing).'));
                // NOTE: we do not return here because some flows expect the registration step below.
                // If you prefer to skip registration on empty payload, uncomment the next line:
                // return;
            } else {
                // If payload present, read auth as before
                try {
                    const payload = res.payload.toString('utf8');
                    this.fbnsDebug(`Received auth: ${payload}`);
                    this._auth.read(payload);
                    this.emit('auth', this.auth);
                } catch (e) {
                    this.fbnsDebug(`Failed to parse connect payload: ${e?.message || e}`);
                    this.emit('error', e);
                    // do not force disconnect here - let reconnect logic handle transient issues
                }
            }

            // Continue with registration attempt if possible.
            try {
                await this.client.mqttotPublish({
                    topic: constants_1.FbnsTopics.FBNS_REG_REQ.id,
                    payload: Buffer.from(JSON.stringify({
                        pkg_name: constants_1.INSTAGRAM_PACKAGE_NAME,
                        appid: this.ig.state.fbAnalyticsApplicationId,
                    }), 'utf8'),
                    qosLevel: 1,
                });
            } catch (e) {
                // Log registration publish error but don't necessarily abort connection entirely here
                this.fbnsDebug(`FBNS_REG_REQ publish failed: ${e?.message || e}`);
                this.emit('warning', e);
            }
        });

        // Set up the register response listener BEFORE connecting
        // because the response can arrive before connect() returns
        const regRespPromise = (0, shared_1.listenOnce)(this.client, constants_1.FbnsTopics.FBNS_REG_RESP.id);

        // Establish connection with conservative options (prefer session resume)
        await this.client
            .connect({
                keepAlive: 60,
                protocolLevel: 3,
                // Use clean: false to allow session resume where the broker supports it.
                // If you have issues with stale state, consider setting clean: true.
                clean: false,
                connectDelay: 60 * 1000,
            })
            .catch(e => {
                this.fbnsDebug(`Connection failed: ${e}`);
                throw e;
            });

        // Subscribe to FBNS message topic
        await this.client.subscribe({ topic: constants_1.FbnsTopics.FBNS_MESSAGE.id });

        // Wait for the register response (listener was set up before connect)
        const msg = await regRespPromise;
        const data = await (0, shared_1.tryUnzipAsync)(msg.payload);
        const payload = data.toString('utf8');
        this.fbnsDebug(`Received register response: ${payload}`);
        const { token, error } = JSON.parse(payload);
        if (error) {
            this.emit('error', error);
            throw error;
        }
        try {
            await this.sendPushRegister(token);
        }
        catch (e) {
            if (e instanceof Error) {
                this.emit('error', e);
            }
            throw e;
        }
    }

    disconnect() {
        this.safeDisconnect = true;
        if (!this.client) {
            return Promise.resolve();
        }
        return this.client.disconnect();
    }

    async handleMessage(msg) {
        const payload = JSON.parse((await (0, shared_1.tryUnzipAsync)(msg.payload)).toString('utf8'));
        if ((0, shared_1.notUndefined)(payload.fbpushnotif)) {
            const notification = (0, fbns_utilities_1.createNotificationFromJson)(payload.fbpushnotif);
            this.emit('push', notification);
            if (notification.collapseKey)
                this.emit(notification.collapseKey, notification);
        }
        else {
            this.fbnsDebug(`Received a message without 'fbpushnotif': ${JSON.stringify(payload)}`);
            this.emit('message', payload);
        }
    }

    async sendPushRegister(token) {
        const { body } = await this.ig.request.send({
            url: `/api/v1/push/register/`,
            method: 'POST',
            form: {
                device_type: 'android_mqtt',
                is_main_push_channel: true,
                device_sub_type: 2,
                device_token: token,
                guid: this.ig.state.uuid,
                uuid: this.ig.state.uuid,
                users: this.ig.state.cookieUserId,
                family_device_id: new chance_1.Chance().guid({ version: 4 }),
            },
        });
        return body;
    }
}
exports.FbnsClient = FbnsClient;
//# sourceMappingURL=fbns.client.js.map
