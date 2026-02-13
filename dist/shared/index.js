"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.delay = exports.debugChannel = exports.tryUnzipAsync = exports.compressDeflate = exports.prepareLogString = void 0;

const pako = require('pako');
const debug = require('debug');

function prepareLogString(str) {
    return str.length > 100 ? str.substring(0, 100) + '...' : str;
}
exports.prepareLogString = prepareLogString;

function compressDeflate(data) {
    return Buffer.from(pako.deflate(data));
}
exports.compressDeflate = compressDeflate;

async function tryUnzipAsync(data) {
    try {
        return Buffer.from(pako.inflate(data));
    } catch (e) {
        return data;
    }
}
exports.tryUnzipAsync = tryUnzipAsync;

function debugChannel(channel) {
    return debug(`ig:mqtt:${channel}`);
}
exports.debugChannel = debugChannel;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
exports.delay = delay;

function createFbnsUserAgent(ig) {
    const deviceStr = ig.state?.deviceString || '';
    const parts = deviceStr.split('; ');
    const androidVersion = (parts[0] || '').split('/')[1] || '15';
    const resolution = parts[2] || '1440x3120';
    const manufacturer = (parts[3] || 'samsung').trim();
    const deviceName = (parts[4] || 'SM-S928B').trim();
    const [width, height] = resolution.split('x');
    const params = {
        FBAN: 'MQTT',
        FBAV: ig.state?.appVersion || '415.0.0.36.76',
        FBBV: ig.state?.appVersionCode || '580610226',
        FBDM: `{density=4.0,width=${width},height=${height}`,
        FBLC: ig.state?.language || 'en_US',
        FBCR: 'Android',
        FBMF: manufacturer,
        FBBD: 'Android',
        FBPN: 'com.instagram.android',
        FBDV: deviceName,
        FBSV: androidVersion,
        FBLR: '0',
        FBBK: '1',
        FBCA: 'x86:armeabi-v7a',
    };
    return `[${Object.entries(params).map(p => p.join('/')).join(';')}]`;
}
exports.createFbnsUserAgent = createFbnsUserAgent;

function notUndefined(a) {
    return typeof a !== 'undefined';
}
exports.notUndefined = notUndefined;

function listenOnce(client, topic) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (typeof removeFn === 'function') try { removeFn(); } catch(e) {}
            reject(new Error('listenOnce timeout after 30s'));
        }, 30000);
        let removeFn;
        if (typeof client.listen === 'function') {
            removeFn = client.listen(topic, msg => {
                clearTimeout(timeout);
                if (typeof removeFn === 'function') try { removeFn(); } catch(e) {}
                resolve(msg);
            });
        } else {
            const handler = (msg) => {
                if (msg && (msg.topic === topic || String(msg.topic) === String(topic))) {
                    clearTimeout(timeout);
                    client.removeListener('message', handler);
                    resolve(msg);
                }
            };
            client.on('message', handler);
            removeFn = () => client.removeListener('message', handler);
        }
    });
}
exports.listenOnce = listenOnce;
