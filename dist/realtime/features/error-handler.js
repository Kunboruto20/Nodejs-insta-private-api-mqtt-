"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorHandler = void 0;
const shared_1 = require("../../shared");

const ERROR_TYPES = {
    RATE_LIMIT: 'rate_limit',
    AUTH_FAILURE: 'auth_failure',
    NETWORK: 'network',
    PROTOCOL: 'protocol',
    SERVER: 'server',
    UNKNOWN: 'unknown',
};

const RATE_LIMIT_PATTERNS = [
    'rate limit', 'too many', 'throttl', 'spam', 'please wait',
    'action blocked', 'try again later', 'temporarily blocked',
    '429', 'flood',
];

const AUTH_PATTERNS = [
    'auth', 'login', 'session', 'credential', 'token', 'expired',
    'unauthorized', '401', 'forbidden', '403', 'password',
    'challenge_required', 'checkpoint', 'checkpoint_required',
    'login_required', 'consent_required', 'two_factor',
];

const NETWORK_PATTERNS = [
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
    'ENETUNREACH', 'socket hang up', 'network', 'dns',
    'getaddrinfo', 'connect EHOSTUNREACH', 'EPIPE', 'EAI_AGAIN',
];

class ErrorHandler {
    constructor(client) {
        this.errorDebug = (0, shared_1.debugChannel)('realtime', 'errors');
        this.errorCount = 0;
        this.maxRetries = 15;
        this.client = client;
        this.errorHistory = [];
        this.rateLimitUntil = 0;
        this.consecutiveAuthFailures = 0;
    }

    classifyError(error) {
        const msg = (error?.message || String(error)).toLowerCase();

        for (const pattern of RATE_LIMIT_PATTERNS) {
            if (msg.includes(pattern)) return ERROR_TYPES.RATE_LIMIT;
        }
        for (const pattern of AUTH_PATTERNS) {
            if (msg.includes(pattern)) return ERROR_TYPES.AUTH_FAILURE;
        }
        for (const pattern of NETWORK_PATTERNS) {
            if (msg.includes(pattern.toLowerCase())) return ERROR_TYPES.NETWORK;
        }
        if (msg.includes('connack') || msg.includes('protocol') || msg.includes('thrift') || msg.includes('parse')) {
            return ERROR_TYPES.PROTOCOL;
        }
        if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server')) {
            return ERROR_TYPES.SERVER;
        }
        return ERROR_TYPES.UNKNOWN;
    }

    getBackoffForType(errorType, attemptNumber) {
        const jitter = Math.floor(Math.random() * 2000);
        switch (errorType) {
            case ERROR_TYPES.RATE_LIMIT:
                return Math.min(60000 * Math.pow(1.5, attemptNumber - 1), 600000) + jitter;
            case ERROR_TYPES.AUTH_FAILURE:
                return Math.min(10000 * Math.pow(2, attemptNumber - 1), 120000) + jitter;
            case ERROR_TYPES.NETWORK:
                return Math.min(2000 * Math.pow(2, attemptNumber - 1), 60000) + jitter;
            case ERROR_TYPES.SERVER:
                return Math.min(5000 * Math.pow(2, attemptNumber - 1), 120000) + jitter;
            case ERROR_TYPES.PROTOCOL:
                return Math.min(5000 * Math.pow(2, attemptNumber - 1), 60000) + jitter;
            default:
                return Math.min(3000 * Math.pow(2, attemptNumber - 1), 90000) + jitter;
        }
    }

    handleConnectionError(error) {
        this.errorCount++;
        const errorType = this.classifyError(error);
        const delay = this.getBackoffForType(errorType, this.errorCount);

        this.errorHistory.push({
            type: errorType,
            message: error?.message || String(error),
            timestamp: Date.now(),
            attempt: this.errorCount,
        });
        if (this.errorHistory.length > 50) this.errorHistory.shift();

        this.errorDebug(`[${errorType.toUpperCase()}] Error (${this.errorCount}/${this.maxRetries}): ${error?.message || error}`);

        if (errorType === ERROR_TYPES.RATE_LIMIT) {
            this.rateLimitUntil = Date.now() + delay;
            this.errorDebug(`Rate limited. Waiting ${Math.round(delay/1000)}s before retry.`);
        }

        if (errorType === ERROR_TYPES.AUTH_FAILURE) {
            this.consecutiveAuthFailures++;
            if (this.consecutiveAuthFailures >= 3) {
                this.errorDebug('Multiple auth failures. Credentials may need refresh.');
                this.client.emit('auth_failure', {
                    count: this.consecutiveAuthFailures,
                    error: error?.message || String(error),
                });
                return false;
            }
        } else {
            this.consecutiveAuthFailures = 0;
        }

        if (this.errorCount >= this.maxRetries) {
            this.client.emit('error', new Error(`Max retries (${this.maxRetries}) exceeded. Last error type: ${errorType}`));
            return false;
        }

        this.errorDebug(`Scheduling retry in ${Math.round(delay/1000)}s (type: ${errorType})`);

        setTimeout(() => {
            if (typeof this.client.reconnect === 'function') {
                this.client.reconnect();
            } else if (typeof this.client._attemptReconnectSafely === 'function') {
                this.client._attemptReconnectSafely().catch(() => {});
            }
        }, delay);

        return true;
    }

    isRateLimited() {
        return Date.now() < this.rateLimitUntil;
    }

    getRateLimitRemainingMs() {
        return Math.max(0, this.rateLimitUntil - Date.now());
    }

    handlePayloadError(error, topic) {
        this.errorDebug(`Payload Error on topic ${topic}: ${error.message}`);
        this.client.emit('warning', {
            type: 'payload_error',
            topic,
            error: error.message,
        });
    }

    handleProtocolError(error) {
        this.errorDebug(`Protocol Error: ${error.message}`);
        this.client.emit('error', new Error(`MQTT Protocol Error: ${error.message}`));
    }

    resetErrorCounter() {
        this.errorCount = 0;
        this.consecutiveAuthFailures = 0;
        this.errorDebug('Error counter reset');
    }

    getErrorStats() {
        const recentErrors = this.errorHistory.filter(e => Date.now() - e.timestamp < 3600000);
        const typeBreakdown = {};
        for (const e of recentErrors) {
            typeBreakdown[e.type] = (typeBreakdown[e.type] || 0) + 1;
        }
        return {
            errorCount: this.errorCount,
            maxRetries: this.maxRetries,
            canRetry: this.errorCount < this.maxRetries,
            isRateLimited: this.isRateLimited(),
            rateLimitRemainingMs: this.getRateLimitRemainingMs(),
            consecutiveAuthFailures: this.consecutiveAuthFailures,
            recentErrorCount: recentErrors.length,
            typeBreakdown,
        };
    }
}

ErrorHandler.ERROR_TYPES = ERROR_TYPES;
exports.ErrorHandler = ErrorHandler;
exports.ERROR_TYPES = ERROR_TYPES;
