'use strict';

const fs = require('fs');
const path = require('path');
const { CookieJar } = require('tough-cookie');
const util = require('util');
const EventEmitter = require('events');
const crypto = require('crypto');

const FILE_NAMES = {
  creds: 'creds.json',
  device: 'device.json',
  cookies: 'cookies.json',
  mqttSession: 'mqtt-session.json',
  subscriptions: 'subscriptions.json',
  seqIds: 'seq-ids.json',
  appState: 'app-state.json',

  // Newly added MQTT / realtime persistence files
  irisState: 'iris-state.json',               // subscription / iris specific state
  mqttTopics: 'mqtt-topics.json',             // observed topics
  mqttCapabilities: 'mqtt-capabilities.json', // realtime capabilities per device/version
  mqttAuth: 'mqtt-auth.json',                 // mqtt auth token / jwt (if available)
  lastPublishIds: 'last-publish-ids.json',    // last published message ids / ack info

  // Added utility files
  loginHistory: 'login-history.json',
  usageStats: 'usage-stats.json',
  accountsIndex: 'accounts.json',

  // MQTT helpers files
  mqttHealth: 'mqtt-health.json',
  mqttReconnect: 'mqtt-reconnect.json',
  mqttMessageCache: 'mqtt-message-cache.json',
  mqttOutbox: 'mqtt-outbox.json',
  mqttSubscriptionHealth: 'mqtt-subscription-health.json',
  mqttTraffic: 'mqtt-traffic.json',
  mqttRisk: 'mqtt-risk.json'
};

class MultiFileAuthState extends EventEmitter {
  constructor(folder) {
    super();
    this.folder = folder;
    this._saveDebounceTimer = null;
    this._saveDebounceMs = 500;
    this._dirty = new Set();

    // Auto-refresh fields
    this._autoRefreshTimer = null;
    this._autoRefreshIntervalMs = 5 * 60 * 1000; // default 5 minutes
    this._autoRefreshClient = null;

    // Reconnect/backoff runtime
    this._reconnectBackoff = [2000, 5000, 15000, 60000];
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;

    this.data = {
      creds: null,
      device: null,
      cookies: null,
      mqttSession: null,
      subscriptions: null,
      seqIds: null,
      appState: null,

      // new
      irisState: null,
      mqttTopics: null,
      mqttCapabilities: null,
      mqttAuth: null,
      lastPublishIds: null,

      // utility
      loginHistory: null,
      usageStats: null,
      accountsIndex: null,

      // mqtt helpers
      mqttHealth: null,
      mqttReconnect: null,
      mqttMessageCache: null,
      mqttOutbox: null,
      mqttSubscriptionHealth: null,
      mqttTraffic: null,
      mqttRisk: null
    };

    // ensure folder structure
    this._ensureFolder();
    this._ensureBackupFolder();
  }

  _getFilePath(key) {
    return path.join(this.folder, FILE_NAMES[key]);
  }

  _getBackupFolder() {
    return path.join(this.folder, 'backup');
  }

  _ensureFolder() {
    if (!fs.existsSync(this.folder)) {
      fs.mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    }
  }

  _ensureBackupFolder() {
    // backups disabled — no-op
    return;
  }

  // sanitize state to avoid nulls for key fields (useful to ensure instant non-null)
  _sanitizeForSave(key, data) {
    try {
      if (!data) return data;
      if (key === 'creds') {
        if (typeof data.userId === 'undefined' || data.userId === null) data.userId = data.userId || 'pending';
        if (typeof data.username === 'undefined' || data.username === null) data.username = data.username || 'pending';
        if (typeof data.sessionId === 'undefined' || data.sessionId === null) data.sessionId = data.sessionId || `pending-${Date.now()}`;
        if (typeof data.csrfToken === 'undefined' || data.csrfToken === null) data.csrfToken = data.csrfToken || 'pending';
        if (typeof data.isLoggedIn === 'undefined') data.isLoggedIn = !!data.sessionId || !!data.authorization;
        if (!data.loginAt) data.loginAt = data.loginAt || new Date().toISOString();
      }
      if (key === 'mqttSession') {
        if (!data.sessionId) data.sessionId = data.sessionId || `local-mqtt-${Date.now()}`;
        if (!data.mqttSessionId) data.mqttSessionId = data.mqttSessionId || 'boot';
        if (!data.lastConnected) data.lastConnected = new Date().toISOString();
      }
      if (key === 'seqIds') {
        if (typeof data.seq_id === 'undefined' || data.seq_id === null) data.seq_id = data.seq_id || 0;
        if (typeof data.snapshot_at_ms === 'undefined' || data.snapshot_at_ms === null) data.snapshot_at_ms = data.snapshot_at_ms || Date.now();
      }
      if (key === 'mqttTopics') {
        if (!data.topics) data.topics = data.topics || ['ig_sub_direct', 'ig_sub_direct_v2_message_sync', 'presence_subscribe'];
        if (!data.updatedAt) data.updatedAt = new Date().toISOString();
      }
      if (key === 'mqttCapabilities') {
        data.supportsTyping = Boolean(data.supportsTyping ?? true);
        data.supportsReactions = Boolean(data.supportsReactions ?? true);
        data.supportsVoice = Boolean(data.supportsVoice ?? false);
        data.protocolVersion = data.protocolVersion || 3;
        data.collectedAt = data.collectedAt || new Date().toISOString();
      }
      if (key === 'mqttHealth') {
        data.lastPingAt = data.lastPingAt || null;
        data.lastPongAt = data.lastPongAt || null;
        data.latencyMs = data.latencyMs || 0;
        data.missedPings = data.missedPings || 0;
        data.status = data.status || 'unknown';
      }
      if (key === 'mqttMessageCache') {
        if (!Array.isArray(data.lastIds)) data.lastIds = [];
        if (!data.max) data.max = data.max || 500;
      }
      if (key === 'mqttOutbox') {
        if (!Array.isArray(data)) return [];
      }
      if (key === 'mqttSubscriptionHealth') {
        data.expected = data.expected || (this.getMqttTopics()?.topics || ['ig_sub_direct']);
        data.active = data.active || data.expected.slice();
        data.lastCheck = data.lastCheck || new Date().toISOString();
        data.needsResubscribe = data.needsResubscribe || false;
      }
      if (key === 'mqttTraffic') {
        data.messagesInPerMin = data.messagesInPerMin || 0;
        data.messagesOutPerMin = data.messagesOutPerMin || 0;
        data.lastReset = data.lastReset || new Date().toISOString();
      }
      if (key === 'mqttReconnect') {
        data.attempts = data.attempts || 0;
        data.lastReason = data.lastReason || null;
        data.lastAttemptAt = data.lastAttemptAt || null;
        data.nextRetryInMs = data.nextRetryInMs || 0;
      }
      if (key === 'mqttRisk') {
        data.riskScore = typeof data.riskScore === 'number' ? data.riskScore : 0;
        data.level = data.level || 'low';
        data.updatedAt = data.updatedAt || new Date().toISOString();
      }
    } catch (e) {
      // ignore sanitize errors
    }
    return data;
  }

  // create a timestamped backup of existing file (if present)
  async _createBackup(key) {
    // backups disabled — do nothing
    return null;
  }

  async _writeFileAtomic(filePath, data) {
    const tempPath = filePath + '.tmp';
    const jsonData = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(tempPath, jsonData, { mode: 0o600 });
    await fs.promises.rename(tempPath, filePath);
  }

  async _readFile(key) {
    const filePath = this._getFilePath(key);
    try {
      if (fs.existsSync(filePath)) {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn(`[MultiFileAuthState] Error reading ${key}:`, e.message);
    }
    return null;
  }

  async _writeFile(key, data) {
    this._ensureFolder();
    const filePath = this._getFilePath(key);
    try {
      // sanitize to avoid nulls for key fields
      const sanitized = this._sanitizeForSave(key, JSON.parse(JSON.stringify(data)));
      // create backup before overwriting existing file
      await this._createBackup(key);
      await this._writeFileAtomic(filePath, sanitized);
      return true;
    } catch (e) {
      console.error(`[MultiFileAuthState] Error writing ${key}:`, e.message);
      return false;
    }
  }

  // restore the latest backup for a key (returns path of restored file or null)
  async restoreLatestBackup(key) {
    try {
      const base = FILE_NAMES[key];
      const bfolder = this._getBackupFolder();
      if (!fs.existsSync(bfolder)) return null;
      const files = await fs.promises.readdir(bfolder);
      const matches = files.filter(f => f.startsWith(base + '.'));
      if (!matches.length) return null;
      // sort descending by timestamp embedded in filename
      matches.sort().reverse();
      const latest = matches[0];
      const src = path.join(bfolder, latest);
      const dest = this._getFilePath(key);
      await fs.promises.copyFile(src, dest);
      this.emit('backup-restored', { key, file: src });
      // reload into memory
      this.data[key] = await this._readFile(key);
      return src;
    } catch (e) {
      console.warn('[MultiFileAuthState] restoreLatestBackup error:', e.message);
      return null;
    }
  }

  async loadAll() {
    this._ensureFolder();
    this._ensureBackupFolder();

    const loadPromises = Object.keys(FILE_NAMES).map(async (key) => {
      this.data[key] = await this._readFile(key);
    });

    await Promise.all(loadPromises);

    // ensure usageStats and loginHistory objects exist
    if (!this.data.loginHistory) this.data.loginHistory = [];
    if (!this.data.usageStats) this.data.usageStats = {
      apiRequests: 0,
      mqttMessages: 0,
      errors: 0,
      reconnects: 0,
      lastReset: new Date().toISOString()
    };
    if (!this.data.accountsIndex) this.data.accountsIndex = {};

    // ensure mqtt helper objects exist
    if (!this.data.mqttHealth) this.data.mqttHealth = { lastPingAt: null, lastPongAt: null, latencyMs: 0, missedPings: 0, status: 'unknown' };
    if (!this.data.mqttReconnect) this.data.mqttReconnect = { attempts: 0, lastReason: null, lastAttemptAt: null, nextRetryInMs: 0 };
    if (!this.data.mqttMessageCache) this.data.mqttMessageCache = { lastIds: [], max: 500 };
    if (!this.data.mqttOutbox) this.data.mqttOutbox = [];
    if (!this.data.mqttSubscriptionHealth) this.data.mqttSubscriptionHealth = { expected: (this.data.mqttTopics?.topics || ['ig_sub_direct']), active: (this.data.mqttTopics?.topics || ['ig_sub_direct']).slice(), lastCheck: new Date().toISOString(), needsResubscribe: false };
    if (!this.data.mqttTraffic) this.data.mqttTraffic = { messagesInPerMin: 0, messagesOutPerMin: 0, lastReset: new Date().toISOString() };
    if (!this.data.mqttRisk) this.data.mqttRisk = { riskScore: 0, level: 'low', updatedAt: new Date().toISOString() };

    return {
      creds: this.data.creds,
      device: this.data.device,
      cookies: this.data.cookies,
      mqttSession: this.data.mqttSession,
      subscriptions: this.data.subscriptions,
      seqIds: this.data.seqIds,
      appState: this.data.appState,
      irisState: this.data.irisState,
      mqttTopics: this.data.mqttTopics,
      mqttCapabilities: this.data.mqttCapabilities,
      mqttAuth: this.data.mqttAuth,
      lastPublishIds: this.data.lastPublishIds,
      loginHistory: this.data.loginHistory,
      usageStats: this.data.usageStats,
      accountsIndex: this.data.accountsIndex,
      mqttHealth: this.data.mqttHealth,
      mqttReconnect: this.data.mqttReconnect,
      mqttMessageCache: this.data.mqttMessageCache,
      mqttOutbox: this.data.mqttOutbox,
      mqttSubscriptionHealth: this.data.mqttSubscriptionHealth,
      mqttTraffic: this.data.mqttTraffic,
      mqttRisk: this.data.mqttRisk,
      hasSession: !!(this.data.creds && this.data.cookies)
    };
  }

  async saveAll() {
    const savePromises = Object.keys(FILE_NAMES).map(async (key) => {
      if (this.data[key] !== null && this.data[key] !== undefined) {
        await this._writeFile(key, this.data[key]);
      }
    });
    // also save usageStats and loginHistory explicitly
    if (this.data.loginHistory) {
      try { await this._writeFile('loginHistory', this.data.loginHistory); } catch (e) {}
    }
    if (this.data.usageStats) {
      try { await this._writeFile('usageStats', this.data.usageStats); } catch (e) {}
    }
    if (this.data.accountsIndex) {
      try { await this._writeFile('accountsIndex', this.data.accountsIndex); } catch (e) {}
    }
    // mqtt helpers
    try { await this._writeFile('mqttHealth', this.data.mqttHealth); } catch (e) {}
    try { await this._writeFile('mqttReconnect', this.data.mqttReconnect); } catch (e) {}
    try { await this._writeFile('mqttMessageCache', this.data.mqttMessageCache); } catch (e) {}
    try { await this._writeFile('mqttOutbox', this.data.mqttOutbox); } catch (e) {}
    try { await this._writeFile('mqttSubscriptionHealth', this.data.mqttSubscriptionHealth); } catch (e) {}
    try { await this._writeFile('mqttTraffic', this.data.mqttTraffic); } catch (e) {}
    try { await this._writeFile('mqttRisk', this.data.mqttRisk); } catch (e) {}

    await Promise.all(savePromises);
  }

  async saveCreds() {
    const promises = [];
    if (this.data.creds) promises.push(this._writeFile('creds', this.data.creds));
    if (this.data.device) promises.push(this._writeFile('device', this.data.device));
    if (this.data.cookies) promises.push(this._writeFile('cookies', this.data.cookies));
    // also persist loginHistory and usageStats after creds save
    if (this.data.loginHistory) promises.push(this._writeFile('loginHistory', this.data.loginHistory));
    if (this.data.usageStats) promises.push(this._writeFile('usageStats', this.data.usageStats));
    await Promise.all(promises);
    this.emit('creds-saved');
  }

  async saveMqttState() {
    // Save base mqtt data
    const promises = [];
    if (this.data.mqttSession) promises.push(this._writeFile('mqttSession', this.data.mqttSession));
    if (this.data.subscriptions) promises.push(this._writeFile('subscriptions', this.data.subscriptions));
    if (this.data.seqIds) promises.push(this._writeFile('seqIds', this.data.seqIds));

    // Save extended mqtt/realtime data (new files)
    if (this.data.irisState) promises.push(this._writeFile('irisState', this.data.irisState));
    if (this.data.mqttTopics) promises.push(this._writeFile('mqttTopics', this.data.mqttTopics));
    if (this.data.mqttCapabilities) promises.push(this._writeFile('mqttCapabilities', this.data.mqttCapabilities));
    if (this.data.mqttAuth) promises.push(this._writeFile('mqttAuth', this.data.mqttAuth));
    if (this.data.lastPublishIds) promises.push(this._writeFile('lastPublishIds', this.data.lastPublishIds));

    // mqtt helpers
    promises.push(this._writeFile('mqttHealth', this.data.mqttHealth));
    promises.push(this._writeFile('mqttReconnect', this.data.mqttReconnect));
    promises.push(this._writeFile('mqttMessageCache', this.data.mqttMessageCache));
    promises.push(this._writeFile('mqttOutbox', this.data.mqttOutbox));
    promises.push(this._writeFile('mqttSubscriptionHealth', this.data.mqttSubscriptionHealth));
    promises.push(this._writeFile('mqttTraffic', this.data.mqttTraffic));
    promises.push(this._writeFile('mqttRisk', this.data.mqttRisk));

    await Promise.all(promises);
    this.emit('mqtt-state-saved');
  }

  async saveAppState() {
    if (this.data.appState) {
      await this._writeFile('appState', this.data.appState);
    }
  }

  _debouncedSave(keys) {
    keys.forEach(k => this._dirty.add(k));

    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
    }

    this._saveDebounceTimer = setTimeout(async () => {
      const toSave = Array.from(this._dirty);
      this._dirty.clear();

      for (const key of toSave) {
        if (this.data[key] !== null && this.data[key] !== undefined) {
          try {
            // ensure backup for critical files
            if (['creds', 'cookies', 'device'].includes(key)) {
              await this._createBackup(key);
            }
            await this._writeFile(key, this.data[key]);
          } catch (e) {
            console.error(`[MultiFileAuthState] Debounced write error for ${key}:`, e.message);
            // increment usageStats.errors
            try { this.incrementStat('errors'); } catch (e2) {}
          }
        }
      }
      this.emit('debounced-save-complete', toSave);
    }, this._saveDebounceMs);
  }

  // --- Setters that schedule debounced saves ---
  setCreds(creds) {
    this.data.creds = creds;
    this._debouncedSave(['creds']);
  }

  setDevice(device) {
    this.data.device = device;
    this._debouncedSave(['device']);
  }

  setCookies(cookies) {
    this.data.cookies = cookies;
    this._debouncedSave(['cookies']);
  }

  setMqttSession(session) {
    this.data.mqttSession = session;
    this._debouncedSave(['mqttSession']);
  }

  setSubscriptions(subs) {
    this.data.subscriptions = subs;
    this._debouncedSave(['subscriptions']);
  }

  setSeqIds(seqIds) {
    this.data.seqIds = seqIds;
    this._debouncedSave(['seqIds']);
  }

  setAppState(state) {
    this.data.appState = state;
    this._debouncedSave(['appState']);
  }

  // --- New setters for additional MQTT files ---
  setIrisState(irisState) {
    this.data.irisState = irisState;
    this._debouncedSave(['irisState']);
  }

  setMqttTopics(topics) {
    this.data.mqttTopics = topics;
    this._debouncedSave(['mqttTopics']);
  }

  setMqttCapabilities(capabilities) {
    this.data.mqttCapabilities = capabilities;
    this._debouncedSave(['mqttCapabilities']);
  }

  setMqttAuth(auth) {
    this.data.mqttAuth = auth;
    this._debouncedSave(['mqttAuth']);
  }

  setLastPublishIds(lastPublishIds) {
    this.data.lastPublishIds = lastPublishIds;
    this._debouncedSave(['lastPublishIds']);
  }

  // --- Utility setters ---
  addLoginHistory(entry) {
    if (!this.data.loginHistory) this.data.loginHistory = [];
    this.data.loginHistory.unshift(entry);
    // keep bounded history length
    if (this.data.loginHistory.length > 200) this.data.loginHistory.length = 200;
    this._debouncedSave(['loginHistory']);
    this.emit('login-attempt', entry);
  }

  incrementStat(statName, by = 1) {
    if (!this.data.usageStats) this.data.usageStats = {
      apiRequests: 0,
      mqttMessages: 0,
      errors: 0,
      reconnects: 0,
      lastReset: new Date().toISOString()
    };
    if (typeof this.data.usageStats[statName] === 'number') {
      this.data.usageStats[statName] += by;
    } else {
      this.data.usageStats[statName] = (this.data.usageStats[statName] || 0) + by;
    }
    this._debouncedSave(['usageStats']);
  }

  // --- MQTT helper methods ---

  // update mqtt health and persist
  _updateMqttHealth(partial) {
    try {
      if (!this.data.mqttHealth) this.data.mqttHealth = {};
      Object.assign(this.data.mqttHealth, partial);
      // recompute status
      if (this.data.mqttHealth.missedPings > 3) {
        this.data.mqttHealth.status = 'degraded';
      } else if (this.data.mqttHealth.lastPongAt) {
        this.data.mqttHealth.status = 'ok';
      } else {
        this.data.mqttHealth.status = this.data.mqttHealth.status || 'unknown';
      }
      this._debouncedSave(['mqttHealth']);
    } catch (e) {}
  }

  // mark ping sent
  markPing() {
    this._updateMqttHealth({ lastPingAt: new Date().toISOString() });
  }

  // mark pong received and update latency
  markPong() {
    const now = Date.now();
    const lastPing = this.data.mqttHealth?.lastPingAt ? new Date(this.data.mqttHealth.lastPingAt).getTime() : null;
    const latency = lastPing ? (now - lastPing) : 0;
    const missed = Math.max(0, (this.data.mqttHealth?.missedPings || 0) - 1);
    this._updateMqttHealth({ lastPongAt: new Date().toISOString(), latencyMs: latency, missedPings: missed });
  }

  // increment missed ping
  markMissedPing() {
    const missed = (this.data.mqttHealth?.missedPings || 0) + 1;
    this._updateMqttHealth({ missedPings: missed });
  }

  // message deduplication: return true if duplicate
  isDuplicateMessage(messageId) {
    if (!messageId) return false;
    if (!this.data.mqttMessageCache) this.data.mqttMessageCache = { lastIds: [], max: 500 };
    const idx = this.data.mqttMessageCache.lastIds.indexOf(messageId);
    if (idx !== -1) return true;
    // push and cap
    this.data.mqttMessageCache.lastIds.push(messageId);
    if (this.data.mqttMessageCache.lastIds.length > (this.data.mqttMessageCache.max || 500)) {
      this.data.mqttMessageCache.lastIds.shift();
    }
    this._debouncedSave(['mqttMessageCache']);
    return false;
  }

  // enqueue outgoing message to outbox
  enqueueOutbox(item) {
    if (!this.data.mqttOutbox) this.data.mqttOutbox = [];
    // item: { topic, payload, qos, createdAt, tries }
    const i = Object.assign({ qos: 1, createdAt: new Date().toISOString(), tries: 0 }, item);
    this.data.mqttOutbox.push(i);
    this._debouncedSave(['mqttOutbox']);
    this.emit('outbox-enqueued', i);
    return i;
  }

  // flush outbox (attempt send). Tries to use common publish/send methods on client
  async flushOutbox(realtimeClient, maxPerRun = 50) {
    if (!this.data.mqttOutbox || !this.data.mqttOutbox.length) return 0;
    const sent = [];
    const keep = [];
    let processed = 0;
    for (const item of this.data.mqttOutbox) {
      if (processed >= maxPerRun) {
        keep.push(item);
        continue;
      }
      processed++;
      try {
        item.tries = (item.tries || 0) + 1;
        // try publish methods in order of likelihood
        let ok = false;
        if (realtimeClient && typeof realtimeClient.publish === 'function') {
          // mqtt.js style
          try {
            realtimeClient.publish(item.topic, typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload), { qos: item.qos });
            ok = true;
          } catch (e) {
            ok = false;
          }
        } else if (realtimeClient && typeof realtimeClient.send === 'function') {
          try {
            realtimeClient.send(item.topic, item.payload);
            ok = true;
          } catch (e) { ok = false; }
        } else if (realtimeClient && typeof realtimeClient.sendMessage === 'function') {
          try {
            realtimeClient.sendMessage(item.payload);
            ok = true;
          } catch (e) { ok = false; }
        } else {
          // cannot send: keep in outbox
          ok = false;
        }

        if (ok) {
          sent.push(item);
          this.incrementStat('mqttMessages', 1);
        } else {
          // keep for retry, but if tries exceed threshold move to dead-letter (drop)
          if (item.tries >= 10) {
            this.emit('outbox-dropped', item);
          } else {
            keep.push(item);
          }
        }
      } catch (e) {
        keep.push(item);
      }
    }
    // replace queue
    this.data.mqttOutbox = keep.concat(this.data.mqttOutbox.slice(processed));
    this._debouncedSave(['mqttOutbox']);
    this.emit('outbox-flushed', { sentCount: sent.length, remaining: this.data.mqttOutbox.length });
    return sent.length;
  }

  // subscription watchdog: check and attempt resubscribe
  async checkSubscriptions(realtimeClient) {
    try {
      const expected = this.data.mqttSubscriptionHealth?.expected || (this.data.mqttTopics?.topics || []);
      let active = [];
      // try to read from client
      if (realtimeClient?.connection?.subscribedTopics) active = realtimeClient.connection.subscribedTopics;
      else if (realtimeClient?._subscribedTopics) active = realtimeClient._subscribedTopics;
      else if (Array.isArray(this.data.mqttTopics?.topics)) active = this.data.mqttTopics.topics;

      const needs = expected.filter(t => !active.includes(t));
      this.data.mqttSubscriptionHealth = {
        expected,
        active,
        lastCheck: new Date().toISOString(),
        needsResubscribe: needs.length > 0
      };
      this._debouncedSave(['mqttSubscriptionHealth']);

      if (needs.length && realtimeClient) {
        for (const t of needs) {
          try {
            // call common subscribe methods
            if (typeof realtimeClient.subscribe === 'function') {
              realtimeClient.subscribe(t);
            } else if (realtimeClient.connection && typeof realtimeClient.connection.subscribe === 'function') {
              realtimeClient.connection.subscribe(t);
            } else if (typeof realtimeClient.subscriptions === 'function') {
              realtimeClient.subscriptions([t]);
            }
            // update active
            if (!this.data.mqttSubscriptionHealth.active.includes(t)) this.data.mqttSubscriptionHealth.active.push(t);
            this.emit('resubscribe-attempt', { topic: t });
          } catch (e) {
            this.emit('resubscribe-failed', { topic: t, error: e.message });
          }
        }
        this._debouncedSave(['mqttSubscriptionHealth']);
      }
      return this.data.mqttSubscriptionHealth;
    } catch (e) {
      return null;
    }
  }

  // traffic profiler: update incoming/outgoing counters
  _updateTraffic(incoming = 0, outgoing = 0) {
    try {
      if (!this.data.mqttTraffic) this.data.mqttTraffic = { messagesInPerMin: 0, messagesOutPerMin: 0, lastReset: new Date().toISOString() };
      const lastReset = new Date(this.data.mqttTraffic.lastReset).getTime();
      if (Date.now() - lastReset > 60 * 1000) {
        // reset every minute
        this.data.mqttTraffic.messagesInPerMin = 0;
        this.data.mqttTraffic.messagesOutPerMin = 0;
        this.data.mqttTraffic.lastReset = new Date().toISOString();
      }
      this.data.mqttTraffic.messagesInPerMin += incoming;
      this.data.mqttTraffic.messagesOutPerMin += outgoing;
      this._debouncedSave(['mqttTraffic']);
    } catch (e) {}
  }

  // compute simple risk score from reconnects, errors, traffic
  _computeRiskScore() {
    try {
      const reconnects = this.data.usageStats?.reconnects || 0;
      const errors = this.data.usageStats?.errors || 0;
      const outPerMin = this.data.mqttTraffic?.messagesOutPerMin || 0;
      // simple heuristic
      let score = 0;
      score += Math.min(1, reconnects / 10) * 0.4;
      score += Math.min(1, errors / 20) * 0.3;
      score += Math.min(1, outPerMin / 200) * 0.3;
      const level = score > 0.7 ? 'high' : score > 0.35 ? 'medium' : 'low';
      this.data.mqttRisk = { riskScore: Number(score.toFixed(3)), level, updatedAt: new Date().toISOString() };
      this._debouncedSave(['mqttRisk']);
      this.emit('risk-updated', this.data.mqttRisk);
      return this.data.mqttRisk;
    } catch (e) {
      return null;
    }
  }

  // schedule auto reconnect using backoff; will attempt to call client.reconnect() if available or emit event
  _scheduleReconnect(realtimeClient, reason = 'unknown') {
    try {
      this._reconnectAttempts = (this._reconnectAttempts || 0) + 1;
      const idx = Math.min(this._reconnectAttempts - 1, this._reconnectBackoff.length - 1);
      const delay = this._reconnectBackoff[idx] || this._reconnectBackoff[this._reconnectBackoff.length - 1];
      this.data.mqttReconnect = {
        attempts: this._reconnectAttempts,
        lastReason: reason,
        lastAttemptAt: new Date().toISOString(),
        nextRetryInMs: delay
      };
      this.incrementStat('reconnects', 1);
      this._debouncedSave(['mqttReconnect']);
      if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(async () => {
        try {
          if (realtimeClient) {
            if (typeof realtimeClient.reconnect === 'function') {
              realtimeClient.reconnect();
            } else if (typeof realtimeClient.connect === 'function') {
              // some libs have connect
              realtimeClient.connect();
            } else {
              // can't auto-call: emit event so app can handle
              this.emit('should-reconnect', { reason });
            }
          } else {
            this.emit('should-reconnect', { reason });
          }
        } catch (e) {
          this.emit('reconnect-failed', { reason, error: e.message });
        }
      }, delay);
    } catch (e) {}
  }

  // reset reconnect attempts after successful connect
  _resetReconnect() {
    this._reconnectAttempts = 0;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.data.mqttReconnect) {
      this.data.mqttReconnect.attempts = 0;
      this.data.mqttReconnect.nextRetryInMs = 0;
      this._debouncedSave(['mqttReconnect']);
    }
  }

  // warm-restore: apply saved options into realtimeClient before connect to speed startup
  warmRestoreClient(realtimeClient) {
    try {
      const opts = this.getMqttConnectOptions();
      if (!opts) return false;
      // Merge irisData, mqttAuthToken etc. into client init options if possible
      if (realtimeClient.initOptions && typeof realtimeClient.initOptions === 'object') {
        Object.assign(realtimeClient.initOptions, opts);
      } else {
        realtimeClient.initOptions = opts;
      }
      // also set connection clientInfo if supported
      if (realtimeClient.connection && realtimeClient.connection.clientInfo && this.data.mqttSession?.mqttSessionId) {
        realtimeClient.connection.clientInfo.clientMqttSessionId = this.data.mqttSession.mqttSessionId;
      }
      this.emit('warm-restore', { options: opts });
      return true;
    } catch (e) {
      return false;
    }
  }

  // attach runtime helpers to realtimeClient to manage instant improvements
  attachRealtimeClient(realtimeClient, opts = {}) {
    try {
      if (!realtimeClient) return;

      // warm restore immediately
      try { this.warmRestoreClient(realtimeClient); } catch (e) {}

      // ping/pong monitoring
      const pingIntervalMs = opts.pingIntervalMs || 30 * 1000; // 30s
      let pingTimer = null;
      const startPing = () => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          try {
            this.markPing();
            if (typeof realtimeClient.ping === 'function') {
              realtimeClient.ping();
            } else if (typeof realtimeClient.pingReq === 'function') {
              realtimeClient.pingReq();
            } else if (typeof realtimeClient.pingServer === 'function') {
              realtimeClient.pingServer();
            } else {
              // some libraries use publish to $SYS topic or nothing; we still mark ping
            }
            // after ping, schedule missed ping detection
            setTimeout(() => {
              // if lastPongAt older than lastPingAt, consider missed
              const lastPing = new Date(this.data.mqttHealth?.lastPingAt || 0).getTime();
              const lastPong = new Date(this.data.mqttHealth?.lastPongAt || 0).getTime();
              if (lastPing && (!lastPong || lastPong < lastPing)) {
                this.markMissedPing();
              }
            }, Math.min(5000, Math.floor(pingIntervalMs / 2)));
          } catch (e) {}
        }, pingIntervalMs);
      };
      const stopPing = () => { if (pingTimer) clearInterval(pingTimer); pingTimer = null; };

      // event handlers (subscribe to multiple common event names)
      const onConnect = async (...args) => {
        this._resetReconnect();
        this.data.mqttSession = this.data.mqttSession || {};
        this.data.mqttSession.lastConnected = new Date().toISOString();
        this._debouncedSave(['mqttSession']);
        this._updateMqttHealth({ status: 'ok', lastPongAt: new Date().toISOString(), missedPings: 0 });
        this.emit('realtime-connected', { args });
        // flush outbox on connect
        try { await this.flushOutbox(realtimeClient); } catch (e) {}
        // check subscriptions
        try { await this.checkSubscriptions(realtimeClient); } catch (e) {}
        startPing();
      };

      const onClose = (...args) => {
        stopPing();
        this._updateMqttHealth({ status: 'dead' });
        this._scheduleReconnect(realtimeClient, 'close');
        this.emit('realtime-closed', { args });
      };

      const onReconnect = (...args) => {
        this.emit('realtime-reconnect', { args });
      };

      const onOffline = (...args) => {
        this._updateMqttHealth({ status: 'degraded' });
        this._scheduleReconnect(realtimeClient, 'offline');
        this.emit('realtime-offline', { args });
      };

      const onError = (err) => {
        this.incrementStat('errors', 1);
        this._scheduleReconnect(realtimeClient, err?.message || 'error');
        this.emit('realtime-error', { error: err?.message || String(err) });
      };

      const onMessage = async (topic, payload, packet) => {
        // generic message handler: try to extract id for dedupe
        // Many IG messages contain an id field in JSON payload; try to parse
        let messageId = null;
        try {
          const s = (typeof payload === 'string') ? payload : (payload && payload.toString ? payload.toString() : null);
          if (s) {
            const j = JSON.parse(s);
            if (j && (j.message_id || j.id || j.msg_id)) messageId = j.message_id || j.id || j.msg_id;
          }
        } catch (e) {
          // not json, ignore
        }
        if (messageId && this.isDuplicateMessage(messageId)) {
          this.emit('message-duplicate', { topic, messageId });
          return;
        }
        // update traffic counters
        this._updateTraffic(1, 0);
        this.incrementStat('mqttMessages', 1);
        // mark pong if message looks like pong or heartbeat
        if (topic && topic.includes('pong')) this.markPong();
        this.emit('realtime-message', { topic, payload, packet });
      };

      // wire up events safely for common handlers
      try {
        // mqtt.js style
        if (typeof realtimeClient.on === 'function') {
          realtimeClient.on('connect', onConnect);
          realtimeClient.on('reconnect', onReconnect);
          realtimeClient.on('close', onClose);
          realtimeClient.on('offline', onOffline);
          realtimeClient.on('error', onError);
          realtimeClient.on('message', onMessage);
        }
        // websockets or other: attempt to attach possible event names
        if (realtimeClient.addEventListener && typeof realtimeClient.addEventListener === 'function') {
          try { realtimeClient.addEventListener('open', onConnect); } catch (e) {}
          try { realtimeClient.addEventListener('close', onClose); } catch (e) {}
          try { realtimeClient.addEventListener('error', onError); } catch (e) {}
          try { realtimeClient.addEventListener('message', (ev) => onMessage(ev.topic || ev.type, ev.data || ev.payload, ev)); } catch (e) {}
        }
      } catch (e) {}

      // also attach one-time status: if the client supports events differently, let app listen to 'should-reconnect'
      // attach a cleanup handle
      const cleanup = () => {
        stopPing();
        try {
          if (typeof realtimeClient.off === 'function') {
            realtimeClient.off('connect', onConnect);
            realtimeClient.off('reconnect', onReconnect);
            realtimeClient.off('close', onClose);
            realtimeClient.off('offline', onOffline);
            realtimeClient.off('error', onError);
            realtimeClient.off('message', onMessage);
          }
        } catch (e) {}
        this.emit('realtime-detach');
      };

      // expose cleanup on client for convenience
      try { realtimeClient._authStateCleanup = cleanup; } catch (e) {}

      // return helper object to caller
      return {
        pingIntervalMs,
        stop: cleanup,
        flushOutbox: async (max) => { return await this.flushOutbox(realtimeClient, max); },
        checkSubscriptions: async () => { return await this.checkSubscriptions(realtimeClient); },
        warmRestore: () => { return this.warmRestoreClient(realtimeClient); }
      };
    } catch (e) {
      // emit attach failure
      this.emit('attach-failed', { error: e.message });
      return null;
    }
  }

  // --- Getters ---
  getCreds() { return this.data.creds; }
  getDevice() { return this.data.device; }
  getCookies() { return this.data.cookies; }
  getMqttSession() { return this.data.mqttSession; }
  getSubscriptions() { return this.data.subscriptions; }
  getSeqIds() { return this.data.seqIds; }
  getAppState() { return this.data.appState; }
  getIrisState() { return this.data.irisState; }
  getMqttTopics() { return this.data.mqttTopics; }
  getMqttCapabilities() { return this.data.mqttCapabilities; }
  getMqttAuth() { return this.data.mqttAuth; }
  getLastPublishIds() { return this.data.lastPublishIds; }
  getLoginHistory() { return this.data.loginHistory || []; }
  getUsageStats() { return this.data.usageStats || {}; }
  getAccountsIndex() { return this.data.accountsIndex || {}; }
  getMqttHealth() { return this.data.mqttHealth || {}; }
  getMqttReconnect() { return this.data.mqttReconnect || {}; }
  getMqttMessageCache() { return this.data.mqttMessageCache || {}; }
  getMqttOutbox() { return this.data.mqttOutbox || []; }
  getMqttSubscriptionHealth() { return this.data.mqttSubscriptionHealth || {}; }
  getMqttTraffic() { return this.data.mqttTraffic || {}; }
  getMqttRisk() { return this.data.mqttRisk || {}; }

  hasValidSession() {
    return !!(this.data.creds && this.data.cookies && this.data.creds.authorization);
  }

  hasMqttSession() {
    return !!(
      (this.data.mqttSession && this.data.mqttSession.sessionId) ||
      (this.data.mqttAuth && this.data.mqttAuth.jwt)
    );
  }

  async clearAll() {
    for (const key of Object.keys(FILE_NAMES)) {
      const filePath = this._getFilePath(key);
      try {
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      } catch (e) {}
      this.data[key] = null;
    }
    // clear backups too? leave backups intact but emit event
    this.emit('cleared-all');
  }

  // --- Backup utilities exposed ---
  async listBackups() {
    try {
      const b = this._getBackupFolder();
      if (!fs.existsSync(b)) return [];
      const files = await fs.promises.readdir(b);
      return files.map(f => path.join(b, f));
    } catch (e) {
      return [];
    }
  }

  // --- Device fingerprint helpers ---
  computeDeviceFingerprint(deviceObj) {
    try {
      const s = JSON.stringify(deviceObj || this.data.device || {});
      return crypto.createHash('sha256').update(s).digest('hex');
    } catch (e) {
      return null;
    }
  }

  // lock device fingerprint: saves hash into device.json (device.locked = true)
  async lockDeviceFingerprint() {
    try {
      if (!this.data.device) this.data.device = {};
      const hash = this.computeDeviceFingerprint(this.data.device);
      this.data.device.fingerprintHash = hash;
      this.data.device.locked = true;
      await this._writeFile('device', this.data.device);
      this.emit('device-locked', { fingerprintHash: hash });
      return hash;
    } catch (e) {
      console.warn('[MultiFileAuthState] lockDeviceFingerprint failed:', e.message);
      return null;
    }
  }

  verifyDeviceFingerprint(deviceObj) {
    try {
      const stored = this.data.device?.fingerprintHash || null;
      if (!stored) return true; // no lock present
      const hash = this.computeDeviceFingerprint(deviceObj || this.data.device);
      return stored === hash;
    } catch (e) {
      return false;
    }
  }

  // --- Login history helpers ---
  recordLoginAttempt({ success, ip, userAgent, method = 'password', reason = null }) {
    const entry = {
      date: new Date().toISOString(),
      success: Boolean(success),
      ip: ip || null,
      userAgent: userAgent || null,
      method,
      reason
    };
    this.addLoginHistory(entry);
    return entry;
  }

  // mark account restricted / checkpoint
  markAccountRestricted({ status = 'checkpoint', reason = null }) {
    if (!this.data.creds) this.data.creds = {};
    this.data.creds.accountStatus = status;
    this.data.creds.restrictedAt = new Date().toISOString();
    this.data.creds.lastError = reason;
    this._debouncedSave(['creds']);
    this.emit('account-restricted', { status, reason });
  }

  // clear restriction
  clearAccountRestriction() {
    if (this.data.creds) {
      delete this.data.creds.accountStatus;
      delete this.data.creds.restrictedAt;
      delete this.data.creds.lastError;
      this._debouncedSave(['creds']);
      this.emit('account-unrestricted');
    }
  }

  // --- Health check ---
  getHealth() {
    return {
      validSession: this.hasValidSession(),
      hasCookies: !!this.data.cookies,
      hasMqtt: this.hasMqttSession(),
      lastLogin: (this.data.loginHistory && this.data.loginHistory[0]?.date) || null,
      usageStats: this.getUsageStats(),
      accountStatus: this.data.creds?.accountStatus || 'ok',
      deviceLocked: !!this.data.device?.locked,
      mqttHealth: this.getMqttHealth(),
      mqttRisk: this.getMqttRisk()
    };
  }
}

// Helper: try to safely extract cookieJar serialization if exists
async function trySerializeCookieJar(igState) {
  let cookies = null;
  try {
    if (igState.cookieJar && typeof igState.serializeCookieJar === 'function') {
      cookies = await igState.serializeCookieJar();
    } else if (igState.cookieJar && typeof igState.cookieJar.serialize === 'function') {
      // fallback: tough-cookie jar serialize
      const ser = await util.promisify(igState.cookieJar.serialize).bind(igState.cookieJar)();
      cookies = ser;
    }
  } catch (e) {
    console.warn('[MultiFileAuthState] Could not serialize cookies:', e.message);
  }
  return cookies;
}

// Helper: try to read a cookie value from a tough-cookie Jar or equivalent
async function getCookieValueFromJar(cookieJar, name) {
  if (!cookieJar) return null;

  // try getCookieString (tough-cookie)
  try {
    if (typeof cookieJar.getCookieString === 'function') {
      const getCookieString = util.promisify(cookieJar.getCookieString).bind(cookieJar);
      const urls = ['https://www.instagram.com', 'https://instagram.com', 'https://i.instagram.com'];
      for (const url of urls) {
        try {
          const cookieString = await getCookieString(url);
          if (cookieString && typeof cookieString === 'string') {
            const pairs = cookieString.split(';').map(s => s.trim());
            for (const p of pairs) {
              const [k, ...rest] = p.split('=');
              if (k === name) return rest.join('=');
            }
          }
        } catch (e) {
          // ignore and try next url
        }
      }
    }
  } catch (e) {
    // ignore
  }

  // try getCookies which returns Cookie objects
  try {
    if (typeof cookieJar.getCookies === 'function') {
      const getCookies = util.promisify(cookieJar.getCookies).bind(cookieJar);
      const urls = ['https://www.instagram.com', 'https://instagram.com', 'https://i.instagram.com'];
      for (const url of urls) {
        try {
          const cookies = await getCookies(url);
          if (Array.isArray(cookies)) {
            for (const c of cookies) {
              // cookie object shapes vary: check common keys
              const key = c.key ?? c.name ?? c.name;
              const val = c.value ?? c.value ?? c.value;
              if (key === name) return val;
            }
          }
        } catch (e) {
          // ignore and try next url
        }
      }
    }
  } catch (e) {
    // ignore
  }

  // try serialized cookie jar structure if present
  try {
    if (cookieJar && typeof cookieJar === 'object' && cookieJar.cookies && Array.isArray(cookieJar.cookies)) {
      const found = cookieJar.cookies.find(c => (c.key === name || c.name === name || c.name === name));
      if (found) return found.value ?? found.value;
    }
  } catch (e) {
    // ignore
  }

  return null;
}

// Extract cookie-derived fields (sessionid, csrftoken, ds_user_id, mid)
async function extractCookieFields(igState) {
  const out = {
    sessionIdCookie: null,
    csrfTokenCookie: null,
    dsUserIdCookie: null,
    midCookie: null
  };
  try {
    const cookieJar = igState.cookieJar;
    out.sessionIdCookie = await getCookieValueFromJar(cookieJar, 'sessionid');
    out.csrfTokenCookie = await getCookieValueFromJar(cookieJar, 'csrftoken');
    out.dsUserIdCookie = await getCookieValueFromJar(cookieJar, 'ds_user_id') || await getCookieValueFromJar(cookieJar, 'ds_user');
    out.midCookie = await getCookieValueFromJar(cookieJar, 'mid');
  } catch (e) {
    // ignore
  }
  return out;
}

async function extractStateData(igState) {
  // Basic creds (existing)
  const creds = {
    authorization: igState.authorization || null,
    igWWWClaim: igState.igWWWClaim || null,
    passwordEncryptionKeyId: igState.passwordEncryptionKeyId || null,
    passwordEncryptionPubKey: igState.passwordEncryptionPubKey || null
  };

  // Device remains same
  const device = {
    deviceString: igState.deviceString || null,
    deviceId: igState.deviceId || null,
    uuid: igState.uuid || null,
    phoneId: igState.phoneId || null,
    adid: igState.adid || null,
    build: igState.build || null
  };

  // Try to serialize cookies (kept separate)
  const cookies = await trySerializeCookieJar(igState);

  // App state remains same
  const appState = {
    language: igState.language || 'en_US',
    timezoneOffset: igState.timezoneOffset || null,
    connectionTypeHeader: igState.connectionTypeHeader || 'WIFI',
    capabilitiesHeader: igState.capabilitiesHeader || null,
    checkpoint: igState.checkpoint || null,
    challenge: igState.challenge || null
  };

  // --- NEW: richer creds fields derived from igState + cookies ---
  // try to obtain cookie fields
  const cookieFields = await extractCookieFields(igState);

  // Primary identifiers
  const userIdFromState = igState.cookieUserId || igState.userId || igState.user_id || null;
  const dsUserIdFromCookies = cookieFields.dsUserIdCookie || igState.dsUserId || igState.ds_user_id || null;
  const sessionIdFromCookies = cookieFields.sessionIdCookie || null;
  const csrfFromCookies = cookieFields.csrfTokenCookie || null;
  const midFromCookies = cookieFields.midCookie || igState.mid || null;

  // username if exposed on state
  const usernameFromState = igState.username || igState.userName || igState.user?.username || null;

  // rankToken: if userId + uuid available, form `${userId}_${uuid}`
  let rankToken = null;
  try {
    if (userIdFromState && (igState.uuid || device.uuid)) {
      rankToken = `${userIdFromState}_${igState.uuid || device.uuid}`;
    } else if (igState.rankToken) {
      rankToken = igState.rankToken;
    }
  } catch (e) {
    rankToken = igState.rankToken || null;
  }

  // sessionId and csrfToken - prefer cookies, fallback to state fields if present
  const sessionId = sessionIdFromCookies || igState.sessionId || igState.sessionid || null;
  const csrfToken = csrfFromCookies || igState.csrfToken || igState.csrftoken || null;

  // mid fallback
  const mid = midFromCookies || igState.mid || null;

  // isLoggedIn heuristic: presence of sessionid cookie or an 'isLoggedIn' flag or authorization header
  const isLoggedIn = Boolean(
    sessionId ||
    igState.isLoggedIn ||
    (creds.authorization && creds.authorization.length)
  );

  // loginAt / lastValidatedAt: try to take from igState if present, otherwise null
  const loginAt = igState.loginAt || igState.loggedInAt || null;
  const lastValidatedAt = igState.lastValidatedAt || igState.lastValidated || null;

  // Attach all new fields into creds object (non-destructive)
  creds.userId = userIdFromState || dsUserIdFromCookies || creds.userId || null;
  creds.dsUserId = dsUserIdFromCookies || null;
  creds.username = usernameFromState || null;
  creds.rankToken = rankToken;
  creds.sessionId = sessionId;
  creds.csrfToken = csrfToken;
  creds.mid = mid;
  creds.isLoggedIn = isLoggedIn;
  creds.loginAt = loginAt;
  creds.lastValidatedAt = lastValidatedAt;

  return { creds, device, cookies, appState };
}

async function applyStateData(igState, authState) {
  const { creds, device, cookies, appState } = authState.data;

  if (creds) {
    if (creds.authorization) igState.authorization = creds.authorization;
    if (creds.igWWWClaim) igState.igWWWClaim = creds.igWWWClaim;
    if (creds.passwordEncryptionKeyId) igState.passwordEncryptionKeyId = creds.passwordEncryptionKeyId;
    if (creds.passwordEncryptionPubKey) igState.passwordEncryptionPubKey = creds.passwordEncryptionPubKey;
    // if igState provides a helper to update authorization, call it
    if (typeof igState.updateAuthorization === 'function') {
      try { igState.updateAuthorization(); } catch (e) {}
    }

    // apply new creds-derived fields if state supports them (non-intrusive)
    try {
      if (creds.userId && !igState.cookieUserId) igState.cookieUserId = creds.userId;
      if (creds.username && !igState.username) igState.username = creds.username;
      if (creds.rankToken && !igState.rankToken) igState.rankToken = creds.rankToken;
      if (creds.sessionId && !igState.sessionId) igState.sessionId = creds.sessionId;
      if (creds.csrfToken && !igState.csrfToken) igState.csrfToken = creds.csrfToken;
      if (creds.mid && !igState.mid) igState.mid = creds.mid;
      if (typeof creds.isLoggedIn !== 'undefined' && !igState.isLoggedIn) igState.isLoggedIn = creds.isLoggedIn;
      if (creds.loginAt && !igState.loginAt) igState.loginAt = creds.loginAt;
      if (creds.lastValidatedAt && !igState.lastValidatedAt) igState.lastValidatedAt = creds.lastValidatedAt;
    } catch (e) {
      // ignore if igState shape different
    }
  }

  if (device) {
    if (device.deviceString) igState.deviceString = device.deviceString;
    if (device.deviceId) igState.deviceId = device.deviceId;
    if (device.uuid) igState.uuid = device.uuid;
    if (device.phoneId) igState.phoneId = device.phoneId;
    if (device.adid) igState.adid = device.adid;
    if (device.build) igState.build = device.build;
  }

  if (cookies) {
    try {
      if (typeof igState.deserializeCookieJar === 'function') {
        await igState.deserializeCookieJar(cookies);
      } else if (igState.cookieJar && typeof igState.cookieJar.restore === 'function') {
        // fallback restore
        await util.promisify(igState.cookieJar.restore).bind(igState.cookieJar)(cookies);
      } else if (igState.cookieJar && typeof igState.cookieJar._importCookies === 'function') {
        // last-resort, not likely
        try { igState.cookieJar._importCookies(cookies); } catch (e) {}
      }
    } catch (e) {
      console.warn('[MultiFileAuthState] Could not deserialize cookies:', e.message);
    }
  }

  if (appState) {
    if (appState.language) igState.language = appState.language;
    if (appState.timezoneOffset) igState.timezoneOffset = appState.timezoneOffset;
    if (appState.connectionTypeHeader) igState.connectionTypeHeader = appState.connectionTypeHeader;
    if (appState.capabilitiesHeader) igState.capabilitiesHeader = appState.capabilitiesHeader;
    if (appState.checkpoint) igState.checkpoint = appState.checkpoint;
    if (appState.challenge) igState.challenge = appState.challenge;
  }
}

// Main exported helper that wires MultiFileAuthState to your clients
async function useMultiFileAuthState(folder) {
  const authState = new MultiFileAuthState(folder);
  await authState.loadAll();

  // Helper: persist additional derived creds fields when saving creds
  const enrichAndSaveCreds = async (igClientState) => {
    const { creds, device, cookies, appState } = await extractStateData(igClientState);
    // merge with existing creds non-destructive
    authState.data.creds = Object.assign({}, authState.data.creds || {}, creds);
    authState.data.device = Object.assign({}, authState.data.device || {}, device);
    authState.data.cookies = cookies || authState.data.cookies;
    authState.data.appState = Object.assign({}, authState.data.appState || {}, appState);
    await authState.saveCreds();
    await authState.saveAppState();
  };

  const saveCreds = async (igClient) => {
    if (!igClient || !igClient.state) {
      console.warn('[useMultiFileAuthState] No igClient provided to saveCreds');
      return;
    }

    // Use the enriched saver
    await enrichAndSaveCreds(igClient.state);

    // Also attempt to extract some cookie-derived fields for convenience
    try {
      const cookieFields = await extractCookieFields(igClient.state);
      if (cookieFields.sessionIdCookie) {
        if (!authState.data.creds) authState.data.creds = {};
        authState.data.creds.sessionId = cookieFields.sessionIdCookie;
      }
      if (cookieFields.dsUserIdCookie) {
        if (!authState.data.creds) authState.data.creds = {};
        authState.data.creds.dsUserId = cookieFields.dsUserIdCookie;
      }
      authState._debouncedSave(['creds']);
    } catch (e) {}

    console.log('[useMultiFileAuthState] Credentials saved to', folder);
  };

  const saveMqttSession = async (realtimeClient) => {
    if (!realtimeClient) {
      console.warn('[useMultiFileAuthState] No realtimeClient provided');
      return;
    }

    // base mqtt session
    const mqttSession = {
      sessionId: null,
      mqttSessionId: null,
      lastConnected: new Date().toISOString(),
      userId: null
    };

    try {
      if (realtimeClient.ig && realtimeClient.ig.state) {
        mqttSession.userId = realtimeClient.ig.state.cookieUserId || realtimeClient.ig.state.userId || null;
        // attempt to extract sessionId from JWT helper if available
        mqttSession.sessionId = (typeof realtimeClient.extractSessionIdFromJWT === 'function') ? realtimeClient.extractSessionIdFromJWT() : null;
      }
      if (realtimeClient.connection) {
        mqttSession.mqttSessionId = realtimeClient.connection?.clientInfo?.clientMqttSessionId?.toString() || null;
      }
    } catch (e) {
      // ignore
    }

    // subscriptions
    const subscriptions = {
      graphQlSubs: realtimeClient.initOptions?.graphQlSubs || [],
      skywalkerSubs: realtimeClient.initOptions?.skywalkerSubs || [],
      subscribedAt: new Date().toISOString()
    };

    // seq ids (iris)
    const seqIds = {};
    if (realtimeClient.initOptions?.irisData) {
      seqIds.seq_id = realtimeClient.initOptions.irisData.seq_id || null;
      seqIds.snapshot_at_ms = realtimeClient.initOptions.irisData.snapshot_at_ms || null;
    }

    // --- Extended MQTT / realtime info (new) ---
    // irisState: things like subscription_id / device id / other iris metadata
    const irisState = {};
    try {
      // try to glean from various possible places on realtimeClient
      irisState.subscription_id = realtimeClient.initOptions?.irisData?.subscription_id || realtimeClient.iris?.subscriptionId || realtimeClient.irisState?.subscription_id || null;
      irisState.user_id = realtimeClient.ig?.state?.cookieUserId || realtimeClient.ig?.state?.userId || irisState.user_id || null;
      irisState.device_id = realtimeClient.connection?.clientInfo?.deviceId || realtimeClient.initOptions?.deviceId || null;
      irisState.created_at = new Date().toISOString();
    } catch (e) {}

    // mqttTopics: topics observed/subscribed
    const mqttTopics = {};
    try {
      mqttTopics.topics = realtimeClient.connection?.subscribedTopics || realtimeClient._subscribedTopics || realtimeClient.subscribedTopics || [];
      mqttTopics.updatedAt = new Date().toISOString();
    } catch (e) {
      mqttTopics.topics = [];
      mqttTopics.updatedAt = new Date().toISOString();
    }

    // mqttCapabilities: features supported / protocol version
    const mqttCapabilities = {};
    try {
      mqttCapabilities.supportsTyping = Boolean(realtimeClient.initOptions?.supportsTyping ?? realtimeClient.capabilities?.supportsTyping);
      mqttCapabilities.supportsReactions = Boolean(realtimeClient.initOptions?.supportsReactions ?? realtimeClient.capabilities?.supportsReactions);
      mqttCapabilities.supportsVoice = Boolean(realtimeClient.initOptions?.supportsVoice ?? realtimeClient.capabilities?.supportsVoice);
      mqttCapabilities.protocolVersion = realtimeClient.connection?.protocolVersion || realtimeClient.initOptions?.protocolVersion || null;
      mqttCapabilities.collectedAt = new Date().toISOString();
    } catch (e) {}

    // mqttAuth: if realtimeClient keeps an auth token / jwt for mqtt, store (but be careful: short lived)
    const mqttAuth = {};
    try {
      mqttAuth.jwt = realtimeClient.connection?.authToken || realtimeClient.mqttAuth?.jwt || realtimeClient.initOptions?.mqttJwt || null;
      mqttAuth.expiresAt = realtimeClient.connection?.authExpiresAt || realtimeClient.mqttAuth?.expiresAt || null;
      mqttAuth.collectedAt = new Date().toISOString();
    } catch (e) {}

    // lastPublishIds: tracking last message ids for reliable publish/acks
    const lastPublishIds = {};
    try {
      lastPublishIds.lastMessageId = realtimeClient._lastMessageId || realtimeClient.lastMessageId || null;
      lastPublishIds.lastAckedAt = realtimeClient._lastAckedAt || null;
      lastPublishIds.collectedAt = new Date().toISOString();
    } catch (e) {}

    // Assign all into authState and persist
    authState.data.mqttSession = mqttSession;
    authState.data.subscriptions = subscriptions;
    authState.data.seqIds = seqIds;

    authState.data.irisState = irisState;
    authState.data.mqttTopics = mqttTopics;
    authState.data.mqttCapabilities = mqttCapabilities;
    authState.data.mqttAuth = mqttAuth;
    authState.data.lastPublishIds = lastPublishIds;

    // Increment stats
    authState.incrementStat('mqttMessages');

    await authState.saveMqttState();
    console.log('[useMultiFileAuthState] MQTT session saved to', folder);
  };

  const loadCreds = async (igClient) => {
    if (!igClient || !igClient.state) {
      console.warn('[useMultiFileAuthState] No igClient provided to loadCreds');
      return false;
    }

    if (!authState.hasValidSession()) {
      console.log('[useMultiFileAuthState] No valid session found');
      return false;
    }

    await applyStateData(igClient.state, authState);
    console.log('[useMultiFileAuthState] Credentials loaded from', folder);
    return true;
  };

  const getMqttConnectOptions = () => {
    if (!authState.hasMqttSession()) {
      // still return a warm default to help warm-restore
      const defaultTopics = ['ig_sub_direct', 'ig_sub_direct_v2_message_sync'];
      return {
        graphQlSubs: defaultTopics,
        skywalkerSubs: ['presence_subscribe', 'typing_subscribe'],
        irisData: { seq_id: authState.getSeqIds()?.seq_id || 0, snapshot_at_ms: authState.getSeqIds()?.snapshot_at_ms || Date.now() },
        mqttAuthToken: authState.getMqttAuth()?.jwt || null,
        mqttAuthExpiresAt: authState.getMqttAuth()?.expiresAt || null
      };
    }

    const subs = authState.getSubscriptions() || {};
    const seqIds = authState.getSeqIds() || {};
    const mqttAuth = authState.getMqttAuth() || null;

    return {
      graphQlSubs: subs.graphQlSubs || ['ig_sub_direct', 'ig_sub_direct_v2_message_sync'],
      skywalkerSubs: subs.skywalkerSubs || ['presence_subscribe', 'typing_subscribe'],
      irisData: seqIds.seq_id ? {
        seq_id: seqIds.seq_id,
        snapshot_at_ms: seqIds.snapshot_at_ms
      } : { seq_id: 0, snapshot_at_ms: Date.now() },
      mqttAuthToken: mqttAuth?.jwt || null,
      mqttAuthExpiresAt: mqttAuth?.expiresAt || null
    };
  };

  const clearSession = async () => {
    await authState.clearAll();
    console.log('[useMultiFileAuthState] Session cleared');
  };

  const isSessionValid = async (igClient) => {
    if (!authState.hasValidSession()) return false;
    if (!igClient) return true;

    try {
      // quick check by calling account/currentUser or equivalent
      if (igClient.account && typeof igClient.account.currentUser === 'function') {
        await igClient.account.currentUser();
        return true;
      }
      // fallback assume valid if we have creds - up to caller to verify
      return true;
    } catch (e) {
      console.warn('[useMultiFileAuthState] Session validation failed:', e.message);
      // emit session-expired if credentials appear invalid
      authState.emit('session-expired', { reason: e.message });
      return false;
    }
  };

  // --- Auto-refresh / revalidation helpers ---
  const _autoRefreshCheck = async () => {
    try {
      if (!authState.data.creds) return;
      // If creds indicate expiry timestamp, check it
      const expiresAt = authState.data.creds.sessionExpiresAt ? new Date(authState.data.creds.sessionExpiresAt).getTime() : null;
      if (expiresAt && Date.now() > expiresAt) {
        authState.data.creds.isExpired = true;
        authState._debouncedSave(['creds']);
        authState.emit('session-expired', { reason: 'sessionExpiresAt' });
      } else {
        // if igClient provided, optionally validate remote
        if (authState._autoRefreshClient) {
          try {
            const valid = await isSessionValid(authState._autoRefreshClient);
            if (!valid) {
              authState.emit('session-expired', { reason: 'remote-check' });
            } else {
              // update lastValidatedAt
              if (!authState.data.creds) authState.data.creds = {};
              authState.data.creds.lastValidatedAt = new Date().toISOString();
              authState._debouncedSave(['creds']);
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      // ignore
    }
  };

  const enableAutoRefresh = (igClient, intervalMs = 5 * 60 * 1000) => {
    // igClient optional: if provided, will be used to do remote validation
    try {
      disableAutoRefresh();
      authState._autoRefreshClient = igClient || null;
      authState._autoRefreshIntervalMs = intervalMs;
      authState._autoRefreshTimer = setInterval(_autoRefreshCheck, intervalMs);
      // run immediately once
      _autoRefreshCheck();
      authState.emit('auto-refresh-enabled', { intervalMs });
    } catch (e) {
      console.warn('[useMultiFileAuthState] enableAutoRefresh error:', e.message);
    }
  };

  const disableAutoRefresh = () => {
    try {
      if (authState._autoRefreshTimer) {
        clearInterval(authState._autoRefreshTimer);
        authState._autoRefreshTimer = null;
        authState._autoRefreshClient = null;
        authState.emit('auto-refresh-disabled');
      }
    } catch (e) {}
  };

  // --- Login history / audit helpers ---
  const recordLoginAttempt = async ({ success, ip = null, userAgent = null, method = 'password', reason = null }) => {
    const entry = authState.recordLoginAttempt({ success, ip, userAgent, method, reason });
    // return entry for caller
    return entry;
  };

  // --- Account restriction helpers ---
  const markAccountRestricted = ({ status = 'checkpoint', reason = null }) => {
    authState.markAccountRestricted({ status, reason });
  };

  const clearAccountRestriction = () => {
    authState.clearAccountRestriction();
  };

  // --- Usage stats helpers ---
  const incrementStat = (statName, by = 1) => {
    authState.incrementStat(statName, by);
  };

  // --- Backup / restore helpers exposed ---
  const restoreLatestBackup = async (key) => {
    return await authState.restoreLatestBackup(key);
  };

  // --- Device fingerprinting ---
  const lockDeviceFingerprint = async () => {
    return await authState.lockDeviceFingerprint();
  };

  const verifyDeviceFingerprint = (deviceObj) => {
    return authState.verifyDeviceFingerprint(deviceObj);
  };

  // --- Accounts manager ---
  const registerAccount = async (name, folderPath) => {
    if (!authState.data.accountsIndex) authState.data.accountsIndex = {};
    authState.data.accountsIndex[name] = folderPath;
    await authState._writeFile('accountsIndex', authState.data.accountsIndex);
    authState.emit('account-registered', { name, folderPath });
    return authState.data.accountsIndex;
  };

  const listAccounts = () => {
    return authState.getAccountsIndex();
  };

  // --- Health check ---
  const getHealth = () => {
    return authState.getHealth();
  };

  // --- MQTT helpers exposing internal features ---
  const attachRealtimeClient = (realtimeClient, opts = {}) => {
    return authState.attachRealtimeClient(realtimeClient, opts);
  };

  const enqueueOutbox = (item) => authState.enqueueOutbox(item);
  const flushOutbox = (client, max) => authState.flushOutbox(client, max);
  const checkSubscriptions = (client) => authState.checkSubscriptions(client);
  const computeRisk = () => authState._computeRiskScore();
  const warmRestore = (client) => authState.warmRestoreClient(client);
  const getMqttHealth = () => authState.getMqttHealth();
  const getMqttTraffic = () => authState.getMqttTraffic();
  const getMqttRisk = () => authState.getMqttRisk();
  const isDuplicateMessage = (id) => authState.isDuplicateMessage(id);
  const markPing = () => authState.markPing();
  const markPong = () => authState.markPong();

  // --- Misc helpers: loginHistory & usageStats getters ---
  const getLoginHistory = () => authState.getLoginHistory();
  const getUsageStats = () => authState.getUsageStats();

  return {
    state: authState,

    saveCreds,
    loadCreds,

    saveMqttSession,
    getMqttConnectOptions,

    clearSession,
    isSessionValid,

    hasSession: () => authState.hasValidSession(),
    hasMqttSession: () => authState.hasMqttSession(),

    folder,

    // pass-through for convenience
    getData: () => authState.data,

    // convenience setters/getters for the new data
    setIrisState: (s) => authState.setIrisState(s),
    setMqttTopics: (t) => authState.setMqttTopics(t),
    setMqttCapabilities: (c) => authState.setMqttCapabilities(c),
    setMqttAuth: (a) => authState.setMqttAuth(a),
    setLastPublishIds: (p) => authState.setLastPublishIds(p),
    getIrisState: () => authState.getIrisState(),
    getMqttTopics: () => authState.getMqttTopics(),
    getMqttCapabilities: () => authState.getMqttCapabilities(),
    getMqttAuth: () => authState.getMqttAuth(),
    getLastPublishIds: () => authState.getLastPublishIds(),

    // new utilities
    enableAutoRefresh,
    disableAutoRefresh,
    recordLoginAttempt,
    getLoginHistory,
    markAccountRestricted,
    clearAccountRestriction,
    incrementStat,
    getUsageStats,
    restoreLatestBackup,
    lockDeviceFingerprint,
    verifyDeviceFingerprint,
    registerAccount,
    listAccounts,
    getHealth,

    // mqtt helpers
    attachRealtimeClient,
    enqueueOutbox,
    flushOutbox,
    checkSubscriptions,
    computeRisk,
    warmRestore,
    getMqttHealth,
    getMqttTraffic,
    getMqttRisk,
    isDuplicateMessage,
    markPing,
    markPong
  };
}

module.exports = {
  useMultiFileAuthState,
  MultiFileAuthState,
  extractStateData,
  applyStateData
};
