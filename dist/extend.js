"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withFbnsAndRealtime = exports.withRealtime = exports.withFbns = exports.IgApiClientExt = void 0;

const IgApiClient = require('./core/client');

let FbnsClient = null;
try { FbnsClient = require('./fbns/fbns.client').FbnsClient; } catch (e) {}

const { RealtimeClient } = require('./realtime');

class IgApiClientExt extends IgApiClient {
    constructor() {
        super();
        this.stateHooks = [];
        this.addStateHook({
            name: 'client',
            onExport: async (client) => {
                if (client.state && typeof client.state.serialize === 'function') {
                    const state = await client.state.serialize();
                    const { constants, ...rest } = state;
                    return rest;
                }
                return {};
            },
            onImport: (data, client) => {
                if (client.state && typeof client.state.deserialize === 'function') {
                    return client.state.deserialize(data);
                }
            },
        });
    }

    async exportState() {
        const data = {};
        for (const hook of this.stateHooks) {
            try {
                data[hook.name] = await hook.onExport(this);
            } catch (e) {
                data[hook.name] = null;
            }
        }
        return JSON.stringify(data);
    }

    async importState(state) {
        if (typeof state === 'string') state = JSON.parse(state);
        for (const [key, value] of Object.entries(state)) {
            const hook = this.stateHooks.find(x => x.name === key);
            if (hook) {
                try {
                    await hook.onImport(value, this);
                } catch (e) {}
            }
        }
    }

    addStateHook(hook) {
        if (this.stateHooks.some(x => x.name === hook.name)) {
            return;
        }
        this.stateHooks.push(hook);
    }
}
exports.IgApiClientExt = IgApiClientExt;

function upgradeToExt(client) {
    if (client instanceof IgApiClientExt) return client;
    Object.setPrototypeOf(client, IgApiClientExt.prototype);
    if (!client.stateHooks) {
        client.stateHooks = [];
        client.addStateHook({
            name: 'client',
            onExport: async (c) => {
                if (c.state && typeof c.state.serialize === 'function') {
                    const state = await c.state.serialize();
                    const { constants, ...rest } = state;
                    return rest;
                }
                return {};
            },
            onImport: (data, c) => {
                if (c.state && typeof c.state.deserialize === 'function') {
                    return c.state.deserialize(data);
                }
            },
        });
    }
    return client;
}

function withFbns(client) {
    if (!FbnsClient) {
        throw new Error('FbnsClient is not available (mqtt-shim dependency missing)');
    }
    client = upgradeToExt(client);
    Object.defineProperty(client, 'fbns', {
        value: new FbnsClient(client),
        enumerable: false,
        configurable: true,
    });
    client.addStateHook({
        name: 'fbns',
        onExport: (c) => c.fbns && c.fbns.auth ? c.fbns.auth.toString() : null,
        onImport: (data, c) => {
            if (c.fbns && c.fbns.auth && typeof c.fbns.auth.read === 'function') {
                c.fbns.auth.read(data);
            }
        },
    });
    return client;
}
exports.withFbns = withFbns;

function withRealtime(client, mixins) {
    client = upgradeToExt(client);
    let realtimeInstance = null;
    Object.defineProperty(client, 'realtime', {
        get() {
            if (!realtimeInstance) {
                realtimeInstance = new RealtimeClient(client, mixins);
            }
            return realtimeInstance;
        },
        enumerable: false,
        configurable: true,
    });
    return client;
}
exports.withRealtime = withRealtime;

function withFbnsAndRealtime(client, mixins) {
    client = withRealtime(client, mixins);
    if (FbnsClient) {
        try {
            client = withFbns(client);
        } catch (e) {}
    }
    return client;
}
exports.withFbnsAndRealtime = withFbnsAndRealtime;
