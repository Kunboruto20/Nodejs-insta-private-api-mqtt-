'use strict';

const EventEmitter = require('eventemitter3');

const SESSION_CHECK_INTERVAL = 30 * 60 * 1000;
const SESSION_CHECK_JITTER = 5 * 60 * 1000;
const MIN_CHECK_INTERVAL = 5 * 60 * 1000;

class SessionHealthMonitor extends EventEmitter {
    constructor(realtimeClient, options = {}) {
        super();
        this.rt = realtimeClient;
        this.ig = realtimeClient.ig;
        this.options = {
            checkIntervalMs: options.checkIntervalMs || SESSION_CHECK_INTERVAL,
            jitterMs: options.jitterMs || SESSION_CHECK_JITTER,
            autoRelogin: options.autoRelogin !== false,
            credentials: options.credentials || null,
            onSessionExpired: options.onSessionExpired || null,
            maxConsecutiveFailures: options.maxConsecutiveFailures || 5,
            ...options,
        };

        this._checkTimer = null;
        this._running = false;
        this._consecutiveFailures = 0;
        this._lastCheckAt = null;
        this._lastCheckResult = null;
        this._sessionValid = true;
        this._reloginInProgress = false;
        this._reloginCount = 0;

        this._stats = {
            startedAt: null,
            totalChecks: 0,
            successfulChecks: 0,
            failedChecks: 0,
            sessionExpiries: 0,
            relogins: 0,
            successfulRelogins: 0,
            failedRelogins: 0,
            totalUptimeMs: 0,
            longestUptimeMs: 0,
            reconnects: 0,
            lastUptimeStart: null,
            uptimeSegments: [],
        };
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._stats.startedAt = Date.now();
        this._stats.lastUptimeStart = Date.now();
        this._log('[HEALTH] Session health monitor started');
        this._log(`[HEALTH] Check interval: ${Math.round(this.options.checkIntervalMs / 60000)}min + up to ${Math.round(this.options.jitterMs / 60000)}min jitter`);
        this._log(`[HEALTH] Auto-relogin: ${this.options.autoRelogin ? 'enabled' : 'disabled'}`);

        this._scheduleNextCheck();

        if (this.rt) {
            this.rt.on('reconnected', () => {
                this._stats.reconnects++;
                this._recordUptimeSegment();
                this._stats.lastUptimeStart = Date.now();
                this._log('[HEALTH] Reconnected - uptime segment recorded');
            });

            this.rt.on('disconnect', () => {
                this._recordUptimeSegment();
            });

            this.rt.on('reconnect_failed', () => {
                this._log('[HEALTH] All reconnect attempts exhausted - checking session validity');
                this._performCheck().catch(() => {});
            });
        }
    }

    stop() {
        this._running = false;
        if (this._checkTimer) {
            clearTimeout(this._checkTimer);
            this._checkTimer = null;
        }
        this._recordUptimeSegment();
        this._log('[HEALTH] Session health monitor stopped');
    }

    _scheduleNextCheck() {
        if (!this._running) return;
        if (this._checkTimer) clearTimeout(this._checkTimer);

        const jitter = Math.floor(Math.random() * this.options.jitterMs);
        const delay = Math.max(MIN_CHECK_INTERVAL, this.options.checkIntervalMs + jitter);

        this._checkTimer = setTimeout(async () => {
            try {
                await this._performCheck();
            } catch (e) {
                this._log('[HEALTH] Check error:', e?.message || e);
            }
            this._scheduleNextCheck();
        }, delay);
    }

    async _performCheck() {
        this._stats.totalChecks++;
        this._lastCheckAt = Date.now();

        try {
            const result = await this._checkSessionValidity();
            this._lastCheckResult = result;

            if (result.valid) {
                this._consecutiveFailures = 0;
                this._sessionValid = true;
                this._stats.successfulChecks++;
                this._log(`[HEALTH] Session valid (userId: ${result.userId || 'unknown'}, check #${this._stats.totalChecks})`);
                this.emit('health_check', { status: 'ok', result, stats: this.getStats() });
                return true;
            } else {
                this._consecutiveFailures++;
                this._stats.failedChecks++;
                this._log(`[HEALTH] Session check failed (${this._consecutiveFailures}/${this.options.maxConsecutiveFailures}): ${result.reason}`);
                this.emit('health_check', { status: 'failed', result, consecutiveFailures: this._consecutiveFailures });

                if (this._consecutiveFailures >= 2) {
                    this._sessionValid = false;
                    this._stats.sessionExpiries++;
                    this._log('[HEALTH] Session appears expired');
                    this.emit('session_expired', { result, consecutiveFailures: this._consecutiveFailures });

                    if (this.options.autoRelogin) {
                        return await this._attemptRelogin();
                    } else if (typeof this.options.onSessionExpired === 'function') {
                        try { await this.options.onSessionExpired(result); } catch (e) {}
                    }
                }
                return false;
            }
        } catch (e) {
            this._consecutiveFailures++;
            this._stats.failedChecks++;
            this._log('[HEALTH] Session check threw:', e?.message || e);
            this.emit('health_check', { status: 'error', error: e?.message, consecutiveFailures: this._consecutiveFailures });

            if (this._consecutiveFailures >= this.options.maxConsecutiveFailures) {
                this._log(`[HEALTH] Max consecutive failures (${this.options.maxConsecutiveFailures}) reached`);
                if (this.options.autoRelogin) {
                    return await this._attemptRelogin();
                }
            }
            return false;
        }
    }

    async _checkSessionValidity() {
        try {
            const response = await this.ig.request.send({
                url: '/api/v1/accounts/current_user/',
                method: 'GET',
                qs: { edit: true },
            });

            if (response?.body?.user) {
                return {
                    valid: true,
                    userId: response.body.user.pk || response.body.user.pk_id,
                    username: response.body.user.username,
                    fullName: response.body.user.full_name,
                };
            }

            return { valid: false, reason: 'No user data in response', statusCode: response?.statusCode };
        } catch (e) {
            const status = e?.response?.statusCode || e?.statusCode;
            const body = e?.response?.body;

            if (status === 401 || status === 403) {
                return { valid: false, reason: `Auth error (${status})`, statusCode: status, requiresRelogin: true };
            }
            if (status === 429) {
                return { valid: false, reason: 'Rate limited (429) - session might still be valid', statusCode: status, rateLimited: true };
            }
            if (body?.message === 'login_required' || body?.error_type === 'inactive user') {
                return { valid: false, reason: body.message || body.error_type, statusCode: status, requiresRelogin: true };
            }
            if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') {
                return { valid: false, reason: `Network error: ${e.code}`, networkError: true };
            }

            return { valid: false, reason: e?.message || 'Unknown error', statusCode: status };
        }
    }

    async _attemptRelogin() {
        if (this._reloginInProgress) {
            this._log('[HEALTH] Relogin already in progress, skipping');
            return false;
        }
        this._reloginInProgress = true;
        this._stats.relogins++;

        try {
            const creds = this.options.credentials;
            if (!creds || !creds.username || !creds.password) {
                this._log('[HEALTH] No credentials available for auto-relogin');
                this.emit('relogin_needed', { reason: 'No credentials configured' });
                return false;
            }

            this._log(`[HEALTH] Attempting auto-relogin as ${creds.username}...`);
            this.emit('relogin_start', { username: creds.username });

            try {
                await this.ig.login({ username: creds.username, password: creds.password });
                this._log('[HEALTH] Relogin successful!');
                this._stats.successfulRelogins++;
                this._reloginCount++;
                this._consecutiveFailures = 0;
                this._sessionValid = true;

                if (this.rt._attachedAuthState && typeof this.rt._attachedAuthState.saveCreds === 'function') {
                    try {
                        await this.rt._attachedAuthState.saveCreds(this.ig);
                        this._log('[HEALTH] Credentials saved after relogin');
                    } catch (e) {
                        this._log('[HEALTH] Failed to save credentials:', e?.message || e);
                    }
                }

                this.emit('relogin_success', { username: creds.username, reloginCount: this._reloginCount });

                try {
                    this._log('[HEALTH] Triggering MQTT reconnect with fresh session...');
                    await this.rt._attemptReconnectSafely();
                } catch (e) {
                    this._log('[HEALTH] MQTT reconnect after relogin failed:', e?.message || e);
                }

                return true;
            } catch (e) {
                this._stats.failedRelogins++;
                const isChallenge = e?.message?.includes('challenge') || e?.message?.includes('checkpoint');
                this._log(`[HEALTH] Relogin failed: ${e?.message || e}`);

                if (isChallenge) {
                    this._log('[HEALTH] Account requires verification - cannot auto-relogin');
                    this.emit('relogin_challenge', { error: e?.message });
                }

                this.emit('relogin_failed', { error: e?.message, isChallenge });
                return false;
            }
        } finally {
            this._reloginInProgress = false;
        }
    }

    async forceCheck() {
        return this._performCheck();
    }

    isSessionValid() {
        return this._sessionValid;
    }

    getStats() {
        const now = Date.now();
        const currentSegmentMs = this._stats.lastUptimeStart ? (now - this._stats.lastUptimeStart) : 0;
        const totalUptime = this._stats.totalUptimeMs + currentSegmentMs;
        const totalRuntime = this._stats.startedAt ? (now - this._stats.startedAt) : 0;

        return {
            running: this._running,
            sessionValid: this._sessionValid,
            startedAt: this._stats.startedAt ? new Date(this._stats.startedAt).toISOString() : null,
            totalRuntimeMs: totalRuntime,
            totalRuntimeHuman: this._humanDuration(totalRuntime),
            totalUptimeMs: totalUptime,
            totalUptimeHuman: this._humanDuration(totalUptime),
            uptimePercent: totalRuntime > 0 ? Math.round((totalUptime / totalRuntime) * 10000) / 100 : 100,
            currentSessionMs: currentSegmentMs,
            currentSessionHuman: this._humanDuration(currentSegmentMs),
            longestSessionMs: Math.max(this._stats.longestUptimeMs, currentSegmentMs),
            longestSessionHuman: this._humanDuration(Math.max(this._stats.longestUptimeMs, currentSegmentMs)),
            totalChecks: this._stats.totalChecks,
            successfulChecks: this._stats.successfulChecks,
            failedChecks: this._stats.failedChecks,
            sessionExpiries: this._stats.sessionExpiries,
            reconnects: this._stats.reconnects,
            relogins: this._stats.relogins,
            successfulRelogins: this._stats.successfulRelogins,
            failedRelogins: this._stats.failedRelogins,
            consecutiveFailures: this._consecutiveFailures,
            lastCheckAt: this._lastCheckAt ? new Date(this._lastCheckAt).toISOString() : null,
            lastCheckResult: this._lastCheckResult,
        };
    }

    _recordUptimeSegment() {
        if (this._stats.lastUptimeStart) {
            const segmentMs = Date.now() - this._stats.lastUptimeStart;
            this._stats.totalUptimeMs += segmentMs;
            if (segmentMs > this._stats.longestUptimeMs) this._stats.longestUptimeMs = segmentMs;
            this._stats.uptimeSegments.push({
                start: new Date(this._stats.lastUptimeStart).toISOString(),
                end: new Date().toISOString(),
                durationMs: segmentMs,
            });
            if (this._stats.uptimeSegments.length > 100) {
                this._stats.uptimeSegments = this._stats.uptimeSegments.slice(-50);
            }
            this._stats.lastUptimeStart = null;
        }
    }

    _humanDuration(ms) {
        if (!ms || ms <= 0) return '0s';
        const d = Math.floor(ms / 86400000);
        const h = Math.floor((ms % 86400000) / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const parts = [];
        if (d > 0) parts.push(`${d}d`);
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        if (s > 0 || parts.length === 0) parts.push(`${s}s`);
        return parts.join(' ');
    }

    _log(...args) {
        if (this.rt && typeof this.rt.realtimeDebug === 'function') {
            this.rt.realtimeDebug(...args);
        } else {
            console.log(...args);
        }
        try {
            this.emit('log', args.join(' '));
        } catch (e) {}
    }
}

module.exports = { SessionHealthMonitor };
