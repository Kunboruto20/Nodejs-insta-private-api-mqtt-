// state.js
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const { CookieJar } = require('tough-cookie');
const Chance = require('chance');
const Constants = require('../constants');
const EventEmitter = require('events');

const SESSION_FILE = path.resolve(process.cwd(), 'session.json');
const SESSION_BACKUP = path.resolve(process.cwd(), 'session_backup.json');

class State {
  constructor() {
    // public constants reference (kept as property for backwards compat)
    this.constants = Constants;

    // basic defaults
    this.language = 'en_US';
    this.locale = 'en_US';
    this.timezoneOffset = new Date().getTimezoneOffset() * -60;
    this.radioType = 'wifi-none';
    this.capabilitiesHeader = '3brTvx0=';
    this.connectionTypeHeader = 'WIFI';
    this.isLayoutRTL = false;
    this.adsOptOut = false;
    this.thumbnailCacheBustingValue = 1000;
    this.proxyUrl = null;
    this.checkpoint = null;
    this.challenge = null;
    this.clientSessionIdLifetime = 1200000;
    this.pigeonSessionIdLifetime = 1200000;
    this.parsedAuthorization = undefined;

    this.mid = '';
    this.country = 'US';
    this.countryCode = 1;
    this.igURur = '';
    this.igWWWClaim = '0';
    this.requestId = '';
    this.traySessionId = '';

    // ===== PLATFORM SUPPORT (iOS + Android) =====
    this.platform = 'android'; // 'android' or 'ios'
    this.iosVersion = '18.3';
    this.iosAppVersion = '366.0.0.38.99';
    this.iosAppVersionCode = '632412089';
    this.iosDeviceModel = 'iPhone16,2'; // iPhone 15 Pro Max
    this.iosDeviceName = 'iPhone';
    this.iosBundleId = 'com.burbn.instagram';

    // cookie jar (tough-cookie)
    this.cookieJar = new CookieJar();

    // device defaults
    this.generateDevice('instagram-private-api');

    // internal event emitter (non-invasive - backward-compatible)
    this._emitter = new EventEmitter();

    // internal watcher handle for session file (if used)
    this._sessionFileWatcher = null;

    // Default values for added utilities
    this._saveRetries = 3;
    this._saveRetryDelayMs = 300;
    this._maxBackupCopies = 5; // rotate backups up to this many
  }

  // ===== getters mapping to constants (read-only) =====
  get appVersion() {
    return this.constants.APP_VERSION;
  }

  get appVersionCode() {
    return this.constants.APP_VERSION_CODE;
  }

  get signatureKey() {
    return this.constants.SIGNATURE_KEY;
  }

  get signatureVersion() {
    return this.constants.SIGNATURE_VERSION;
  }

  get fbAnalyticsApplicationId() {
    return this.constants.FACEBOOK_ANALYTICS_APPLICATION_ID;
  }

  get bloksVersionId() {
    return this.constants.BLOKS_VERSION_ID;
  }

  get clientSessionId() {
    return this.generateTemporaryGuid('clientSessionId', this.clientSessionIdLifetime);
  }

  get pigeonSessionId() {
    return this.generateTemporaryGuid('pigeonSessionId', this.pigeonSessionIdLifetime);
  }

  get appUserAgent() {
    if (this.platform === 'ios') {
      return this.iosUserAgent;
    }
    return `Instagram ${this.appVersion} Android (${this.deviceString}; ${this.language}; ${this.appVersionCode})`;
  }

  get iosUserAgent() {
    return `Instagram ${this.iosAppVersion} (${this.iosDeviceModel}; iOS ${this.iosVersion}; ${this.language}; ${this.language}; scale=3.00; ${this.iosResolution}; ${this.iosAppVersionCode}) AppleWebKit/420+`;
  }

  get iosResolution() {
    const resolutions = {
      'iPhone17,1': '1320x2868', // iPhone 16 Pro Max
      'iPhone17,2': '1206x2622', // iPhone 16 Pro
      'iPhone17,3': '1290x2796', // iPhone 16 Plus
      'iPhone17,4': '1179x2556', // iPhone 16
      'iPhone16,1': '1179x2556', // iPhone 15 Pro
      'iPhone16,2': '1290x2796', // iPhone 15 Pro Max
      'iPhone15,4': '1179x2556', // iPhone 15
      'iPhone15,5': '1290x2796', // iPhone 15 Plus
      'iPhone15,2': '1179x2556', // iPhone 14 Pro
      'iPhone15,3': '1290x2796', // iPhone 14 Pro Max
      'iPhone14,7': '1170x2532', // iPhone 14
      'iPhone14,8': '1284x2778', // iPhone 14 Plus
      'iPhone14,2': '1170x2532', // iPhone 13 Pro
      'iPhone14,3': '1284x2778', // iPhone 13 Pro Max
      'iPhone14,5': '1170x2532', // iPhone 13
      'iPhone13,2': '1170x2532', // iPhone 12
      'iPhone13,3': '1170x2532', // iPhone 12 Pro
      'iPhone13,4': '1284x2778', // iPhone 12 Pro Max
      'iPad14,3': '2048x2732',   // iPad Pro 12.9" (6th gen)
      'iPad14,4': '2048x2732',   // iPad Pro 12.9" (6th gen)
      'iPad14,5': '1668x2388',   // iPad Pro 11" (4th gen)
      'iPad14,6': '1668x2388',   // iPad Pro 11" (4th gen)
      'iPad13,18': '2360x1640',  // iPad Air (5th gen)
      'iPad13,19': '2360x1640',  // iPad Air (5th gen)
    };
    return resolutions[this.iosDeviceModel] || '1290x2796';
  }

  get packageName() {
    return this.platform === 'ios' ? this.iosBundleId : 'com.instagram.android';
  }

  // ===== cookies/auth helpers =====
  extractCookie(key) {
    // tough-cookie CookieJar returns array via getCookiesSync in some versions; use synchronous API if present
    try {
      const cookies = this.cookieJar.getCookiesSync
        ? this.cookieJar.getCookiesSync(this.constants.HOST)
        : this.cookieJar.getCookies(this.constants.HOST);
      // cookies might be an array or a Promise; if array, find
      if (Array.isArray(cookies)) {
        const found = cookies.find(c => c.key === key);
        return found || null;
      }
      return null;
    } catch (e) {
      // fallback: try jar serialized introspection (rare)
      return null;
    }
  }

  extractCookieValue(key) {
    const cookie = this.extractCookie(key);
    if (!cookie) {
      throw new Error(`Could not find cookie: ${key}`);
    }
    return cookie.value;
  }

  get cookieCsrfToken() {
    try {
      return this.extractCookieValue('csrftoken');
    } catch {
      return 'missing';
    }
  }

  get cookieUserId() {
    try {
      return this.extractCookieValue('ds_user_id');
    } catch {
      // fallback to parsed authorization if available
      this.updateAuthorization();
      if (!this.parsedAuthorization) throw new Error('Could not find ds_user_id');
      return this.parsedAuthorization.ds_user_id;
    }
  }

  get cookieUsername() {
    try {
      return this.extractCookieValue('ds_user');
    } catch {
      return null;
    }
  }

  hasValidAuthorization() {
    return this.parsedAuthorization && this.parsedAuthorization.authorizationTag === this.authorization;
  }

  updateAuthorization() {
    if (!this.authorization) {
      this.parsedAuthorization = undefined;
      return;
    }
    if (this.hasValidAuthorization()) return;
    if (typeof this.authorization === 'string' && this.authorization.startsWith('Bearer IGT:2:')) {
      try {
        const json = Buffer.from(this.authorization.substring('Bearer IGT:2:'.length), 'base64').toString();
        const parsed = JSON.parse(json);
        // keep an extra tag to detect equality later
        parsed.authorizationTag = this.authorization;
        this.parsedAuthorization = parsed;
      } catch (e) {
        this.parsedAuthorization = undefined;
      }
    } else {
      this.parsedAuthorization = undefined;
    }
  }

  refreshAuthorization(newAuthToken) {
    if (!newAuthToken || typeof newAuthToken !== 'string') return false;
    this.authorization = newAuthToken;
    this.updateAuthorization();
    return true;
  }

  // ===== serialization helpers for cookieJar =====
  async serializeCookieJar() {
    // CookieJar.serialize(cb) exists in tough-cookie; wrap it
    const serializeFn = util.promisify((cb) => {
      try {
        this.cookieJar.serialize(cb);
      } catch (err) {
        cb(err);
      }
    });
    const data = await serializeFn();
    // return an object safe to JSON.stringify
    return data;
  }

  async deserializeCookieJar(serialized) {
    // Accept serialized either as string (JSON) or object
    let obj = serialized;
    if (typeof serialized === 'string') {
      try {
        obj = JSON.parse(serialized);
      } catch (e) {
        obj = serialized;
      }
    }
    const deserializeFn = util.promisify((input, cb) => {
      try {
        CookieJar.deserialize(input, cb);
      } catch (err) {
        cb(err);
      }
    });
    // CookieJar.deserialize returns a CookieJar instance
    const jar = await deserializeFn(obj);
    if (jar && typeof jar === 'object') {
      this.cookieJar = jar;
    }
  }

  // ===== main serialize / deserialize for whole state =====
  /**
   * Return a plain-object ready to be JSON.stringify-ed and saved to disk.
   */
  async serialize() {
    const cookieData = await this.serializeCookieJar();
    const obj = {
      constants: this.constants,
      cookies: cookieData,
      // include selective state fields (device + auth + extra fields commonly expected)
      deviceString: this.deviceString,
      deviceId: this.deviceId,
      uuid: this.uuid,
      phoneId: this.phoneId,
      adid: this.adid,
      build: this.build,
      authorization: this.authorization,
      igWWWClaim: this.igWWWClaim,
      igURur: this.igURur,
      mid: this.mid,
      country: this.country,
      countryCode: this.countryCode,
      locale: this.locale,
      passwordEncryptionKeyId: this.passwordEncryptionKeyId,
      passwordEncryptionPubKey: this.passwordEncryptionPubKey,
      language: this.language,
      timezoneOffset: this.timezoneOffset,
      connectionTypeHeader: this.connectionTypeHeader,
      capabilitiesHeader: this.capabilitiesHeader,
      requestId: this.requestId,
      traySessionId: this.traySessionId
    };
    return obj;
  }

  /**
   * Merge data from a saved session into this State instance.
   * Safe: does NOT overwrite prototype getters (like appVersion).
   */
  async deserialize(state) {
    const obj = typeof state === 'string' ? JSON.parse(state) : state;
    if (!obj || typeof obj !== 'object') {
      throw new TypeError("State isn't an object or serialized JSON");
    }

    // If constants present and looks like an object, restore it
    if (obj.constants) {
      this.constants = obj.constants;
      // don't delete - but won't assign later
    }

    // Restore cookieJar if present
    if (obj.cookies) {
      try {
        await this.deserializeCookieJar(obj.cookies);
      } catch (e) {
        // best-effort: ignore cookie restore failures
      }
    }

    // Assign every other top-level property carefully, skipping prototype getters
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'cookies' || key === 'constants') continue;
      // skip if prototype defines a getter for this key
      const desc = Object.getOwnPropertyDescriptor(State.prototype, key);
      if (desc && (typeof desc.get === 'function' || typeof desc.set === 'function')) {
        // skip assigning to avoid "Cannot set property X of #<State> which has only a getter"
        continue;
      }
      // otherwise set on this
      try {
        this[key] = value;
      } catch (e) {
        // ignore property set failures (non-critical)
      }
    }

    // refresh parsed authorization (if any)
    this.updateAuthorization();
  }

  // ===== file helpers: save/load to disk (session + backup) =====
  async saveSessionToFile(filePath = SESSION_FILE, backupPath = SESSION_BACKUP) {
    try {
      const data = await this.serialize();
      // Save cookies field as object (not string) — caller may JSON.stringify whole obj
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
      // Also write a backup
      try {
        fs.writeFileSync(backupPath, JSON.stringify(data, null, 2), { mode: 0o600 });
      } catch (_) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  async loadSessionFromFile(filePath = SESSION_FILE, backupPath = SESSION_BACKUP) {
    try {
      if (!fs.existsSync(filePath)) return false;
      const raw = fs.readFileSync(filePath, 'utf8');
      const obj = JSON.parse(raw);
      await this.deserialize(obj);
      return true;
    } catch (e) {
      // try backup
      try {
        if (fs.existsSync(backupPath)) {
          const rawb = fs.readFileSync(backupPath, 'utf8');
          const objb = JSON.parse(rawb);
          await this.deserialize(objb);
          return true;
        }
      } catch (_) {}
      return false;
    }
  }

  // old convenience names so library code that calls state.saveSession()/loadSession() still works
  async saveSession() {
    return await this.saveSessionToFile();
  }

  async loadSession() {
    return await this.loadSessionFromFile();
  }

  // ===== device / cookie utilities =====
  generateDevice(seed) {
    const chance = new Chance(seed);
    // Default device: Samsung Galaxy S25 Ultra (2025 flagship)
    // Users can override this with setCustomDevice() or usePresetDevice()
    this.deviceString = `35/15; 505dpi; 1440x3120; samsung; SM-S928B; e3q; qcom`;
    this.deviceId = `android-${chance.string({ pool: 'abcdef0123456789', length: 16 })}`;
    this.uuid = chance.guid();
    this.phoneId = chance.guid();
    this.adid = chance.guid();
    this.build = 'UP1A.231005.007';
    this.requestId = chance.guid();
    this.traySessionId = chance.guid();
  }

  regenerateDevice(seed = 'instagram-private-api') {
    this.generateDevice(seed);
  }

  // ===== CUSTOM DEVICE EMULATION =====
  // Allows users to set their own phone model for Instagram emulation
  // Example devices included: Samsung S25 Ultra, Huawei P60 Pro, Google Pixel 8, etc.
  
  /**
   * Set a custom device to emulate when connecting to Instagram.
   * This allows you to choose which phone model Instagram sees.
   * 
   * @param {Object} deviceConfig - The device configuration
   * @param {string} deviceConfig.manufacturer - Phone manufacturer (e.g., 'samsung', 'huawei', 'google')
   * @param {string} deviceConfig.model - Phone model code (e.g., 'SM-S928B' for Samsung S25 Ultra)
   * @param {string} deviceConfig.device - Device codename (e.g., 'e3q' for S25 Ultra)
   * @param {string} deviceConfig.androidVersion - Android version (e.g., '15')
   * @param {number} deviceConfig.androidApiLevel - Android API level (e.g., 35 for Android 15)
   * @param {string} deviceConfig.resolution - Screen resolution (e.g., '1440x3120')
   * @param {string} deviceConfig.dpi - Screen density (e.g., '505dpi')
   * @param {string} deviceConfig.chipset - Chipset name (e.g., 'qcom')
   * @param {string} deviceConfig.build - Build number (optional)
   * 
   * @example
   * // Samsung Galaxy S25 Ultra
   * state.setCustomDevice({
   *   manufacturer: 'samsung',
   *   model: 'SM-S928B',
   *   device: 'e3q',
   *   androidVersion: '15',
   *   androidApiLevel: 35,
   *   resolution: '1440x3120',
   *   dpi: '505dpi',
   *   chipset: 'qcom'
   * });
   */
  setCustomDevice(deviceConfig) {
    const {
      manufacturer = 'samsung',
      model = 'SM-G930F',
      device = 'herolte',
      androidVersion = '8.0.0',
      androidApiLevel = 26,
      resolution = '1080x1920',
      dpi = '480dpi',
      chipset = 'samsungexynos8890',
      build = null
    } = deviceConfig || {};

    // Build the device string in Instagram format
    this.deviceString = `${androidApiLevel}/${androidVersion}; ${dpi}; ${resolution}; ${manufacturer}; ${model}; ${device}; ${chipset}`;
    
    // Optionally update build if provided
    if (build) {
      this.build = build;
    }

    // Emit event for tracking
    if (this._emitter) {
      this._emitter.emit('device_changed', { deviceString: this.deviceString, model, manufacturer });
    }

    return this.deviceString;
  }

  /**
   * Get a list of popular preset devices that can be used with setCustomDevice()
   * @returns {Object} Object containing preset device configurations
   */
  getPresetDevices() {
    return {
      // Samsung devices
      'Samsung Galaxy S25 Ultra': {
        manufacturer: 'samsung',
        model: 'SM-S928B',
        device: 'e3q',
        androidVersion: '15',
        androidApiLevel: 35,
        resolution: '1440x3120',
        dpi: '505dpi',
        chipset: 'qcom',
        build: 'UP1A.231005.007'
      },
      'Samsung Galaxy S24 Ultra': {
        manufacturer: 'samsung',
        model: 'SM-S928B',
        device: 'e2q',
        androidVersion: '14',
        androidApiLevel: 34,
        resolution: '1440x3088',
        dpi: '480dpi',
        chipset: 'qcom',
        build: 'UP1A.231005.007'
      },
      'Samsung Galaxy S23 Ultra': {
        manufacturer: 'samsung',
        model: 'SM-S918B',
        device: 'dm3q',
        androidVersion: '14',
        androidApiLevel: 34,
        resolution: '1440x3088',
        dpi: '480dpi',
        chipset: 'qcom',
        build: 'UP1A.231005.007'
      },
      'Samsung Galaxy Z Fold 5': {
        manufacturer: 'samsung',
        model: 'SM-F946B',
        device: 'q5q',
        androidVersion: '14',
        androidApiLevel: 34,
        resolution: '1812x2176',
        dpi: '420dpi',
        chipset: 'qcom',
        build: 'UP1A.231005.007'
      },
      // Huawei devices
      'Huawei P60 Pro': {
        manufacturer: 'HUAWEI',
        model: 'MNA-AL00',
        device: 'mona',
        androidVersion: '12',
        androidApiLevel: 31,
        resolution: '1260x2720',
        dpi: '480dpi',
        chipset: 'kirin',
        build: 'HUAWEIMNA-AL00'
      },
      'Huawei Mate 60 Pro': {
        manufacturer: 'HUAWEI',
        model: 'ALN-AL10',
        device: 'aln',
        androidVersion: '12',
        androidApiLevel: 31,
        resolution: '1260x2720',
        dpi: '480dpi',
        chipset: 'kirin',
        build: 'HUAWEIALN-AL10'
      },
      // Google Pixel devices
      'Google Pixel 8 Pro': {
        manufacturer: 'Google',
        model: 'Pixel 8 Pro',
        device: 'husky',
        androidVersion: '14',
        androidApiLevel: 34,
        resolution: '1344x2992',
        dpi: '480dpi',
        chipset: 'google',
        build: 'AP2A.240805.005'
      },
      'Google Pixel 9 Pro': {
        manufacturer: 'Google',
        model: 'Pixel 9 Pro',
        device: 'caiman',
        androidVersion: '15',
        androidApiLevel: 35,
        resolution: '1280x2856',
        dpi: '480dpi',
        chipset: 'google',
        build: 'AP3A.241005.015'
      },
      // OnePlus devices
      'OnePlus 12': {
        manufacturer: 'OnePlus',
        model: 'CPH2573',
        device: 'aston',
        androidVersion: '14',
        androidApiLevel: 34,
        resolution: '1440x3168',
        dpi: '525dpi',
        chipset: 'qcom',
        build: 'UP1A.231005.007'
      },
      // Xiaomi devices
      'Xiaomi 14 Ultra': {
        manufacturer: 'Xiaomi',
        model: '24030PN60G',
        device: 'aurora',
        androidVersion: '14',
        androidApiLevel: 34,
        resolution: '1440x3200',
        dpi: '522dpi',
        chipset: 'qcom',
        build: 'UP1A.231005.007'
      },
      'Xiaomi Redmi Note 13 Pro': {
        manufacturer: 'Xiaomi',
        model: '2312DRA50G',
        device: 'emerald',
        androidVersion: '14',
        androidApiLevel: 34,
        resolution: '1220x2712',
        dpi: '446dpi',
        chipset: 'qcom',
        build: 'UP1A.231005.007'
      },
      // OPPO devices
      'OPPO Find X7 Ultra': {
        manufacturer: 'OPPO',
        model: 'PHZ110',
        device: 'OP5D4BL1',
        androidVersion: '14',
        androidApiLevel: 34,
        resolution: '1440x3168',
        dpi: '525dpi',
        chipset: 'qcom',
        build: 'UP1A.231005.007',
        platform: 'android'
      },

      // ===== iOS DEVICES =====
      // iPhone 16 Series (2024)
      'iPhone 16 Pro Max': {
        platform: 'ios',
        iosDeviceModel: 'iPhone17,1',
        iosDeviceName: 'iPhone 16 Pro Max',
        iosVersion: '18.1',
        resolution: '1320x2868',
        chipset: 'A18 Pro'
      },
      'iPhone 16 Pro': {
        platform: 'ios',
        iosDeviceModel: 'iPhone17,2',
        iosDeviceName: 'iPhone 16 Pro',
        iosVersion: '18.1',
        resolution: '1206x2622',
        chipset: 'A18 Pro'
      },
      'iPhone 16 Plus': {
        platform: 'ios',
        iosDeviceModel: 'iPhone17,3',
        iosDeviceName: 'iPhone 16 Plus',
        iosVersion: '18.1',
        resolution: '1290x2796',
        chipset: 'A18'
      },
      'iPhone 16': {
        platform: 'ios',
        iosDeviceModel: 'iPhone17,4',
        iosDeviceName: 'iPhone 16',
        iosVersion: '18.1',
        resolution: '1179x2556',
        chipset: 'A18'
      },

      // iPhone 15 Series (2023)
      'iPhone 15 Pro Max': {
        platform: 'ios',
        iosDeviceModel: 'iPhone16,2',
        iosDeviceName: 'iPhone 15 Pro Max',
        iosVersion: '18.1',
        resolution: '1290x2796',
        chipset: 'A17 Pro'
      },
      'iPhone 15 Pro': {
        platform: 'ios',
        iosDeviceModel: 'iPhone16,1',
        iosDeviceName: 'iPhone 15 Pro',
        iosVersion: '18.1',
        resolution: '1179x2556',
        chipset: 'A17 Pro'
      },
      'iPhone 15 Plus': {
        platform: 'ios',
        iosDeviceModel: 'iPhone15,5',
        iosDeviceName: 'iPhone 15 Plus',
        iosVersion: '18.1',
        resolution: '1290x2796',
        chipset: 'A16'
      },
      'iPhone 15': {
        platform: 'ios',
        iosDeviceModel: 'iPhone15,4',
        iosDeviceName: 'iPhone 15',
        iosVersion: '18.1',
        resolution: '1179x2556',
        chipset: 'A16'
      },

      // iPhone 14 Series (2022)
      'iPhone 14 Pro Max': {
        platform: 'ios',
        iosDeviceModel: 'iPhone15,3',
        iosDeviceName: 'iPhone 14 Pro Max',
        iosVersion: '18.1',
        resolution: '1290x2796',
        chipset: 'A16'
      },
      'iPhone 14 Pro': {
        platform: 'ios',
        iosDeviceModel: 'iPhone15,2',
        iosDeviceName: 'iPhone 14 Pro',
        iosVersion: '18.1',
        resolution: '1179x2556',
        chipset: 'A16'
      },
      'iPhone 14 Plus': {
        platform: 'ios',
        iosDeviceModel: 'iPhone14,8',
        iosDeviceName: 'iPhone 14 Plus',
        iosVersion: '18.1',
        resolution: '1284x2778',
        chipset: 'A15'
      },
      'iPhone 14': {
        platform: 'ios',
        iosDeviceModel: 'iPhone14,7',
        iosDeviceName: 'iPhone 14',
        iosVersion: '18.1',
        resolution: '1170x2532',
        chipset: 'A15'
      },

      // iPhone 13 Series (2021)
      'iPhone 13 Pro Max': {
        platform: 'ios',
        iosDeviceModel: 'iPhone14,3',
        iosDeviceName: 'iPhone 13 Pro Max',
        iosVersion: '17.6',
        resolution: '1284x2778',
        chipset: 'A15'
      },
      'iPhone 13 Pro': {
        platform: 'ios',
        iosDeviceModel: 'iPhone14,2',
        iosDeviceName: 'iPhone 13 Pro',
        iosVersion: '17.6',
        resolution: '1170x2532',
        chipset: 'A15'
      },
      'iPhone 13': {
        platform: 'ios',
        iosDeviceModel: 'iPhone14,5',
        iosDeviceName: 'iPhone 13',
        iosVersion: '17.6',
        resolution: '1170x2532',
        chipset: 'A15'
      },

      // iPhone 12 Series (2020)
      'iPhone 12 Pro Max': {
        platform: 'ios',
        iosDeviceModel: 'iPhone13,4',
        iosDeviceName: 'iPhone 12 Pro Max',
        iosVersion: '17.6',
        resolution: '1284x2778',
        chipset: 'A14'
      },
      'iPhone 12 Pro': {
        platform: 'ios',
        iosDeviceModel: 'iPhone13,3',
        iosDeviceName: 'iPhone 12 Pro',
        iosVersion: '17.6',
        resolution: '1170x2532',
        chipset: 'A14'
      },
      'iPhone 12': {
        platform: 'ios',
        iosDeviceModel: 'iPhone13,2',
        iosDeviceName: 'iPhone 12',
        iosVersion: '17.6',
        resolution: '1170x2532',
        chipset: 'A14'
      },

      // iPad Pro Series
      'iPad Pro 12.9 (6th gen)': {
        platform: 'ios',
        iosDeviceModel: 'iPad14,3',
        iosDeviceName: 'iPad Pro 12.9-inch (6th generation)',
        iosVersion: '18.1',
        resolution: '2048x2732',
        chipset: 'M2'
      },
      'iPad Pro 11 (4th gen)': {
        platform: 'ios',
        iosDeviceModel: 'iPad14,5',
        iosDeviceName: 'iPad Pro 11-inch (4th generation)',
        iosVersion: '18.1',
        resolution: '1668x2388',
        chipset: 'M2'
      },
      'iPad Air (5th gen)': {
        platform: 'ios',
        iosDeviceModel: 'iPad13,18',
        iosDeviceName: 'iPad Air (5th generation)',
        iosVersion: '18.1',
        resolution: '2360x1640',
        chipset: 'M1'
      }
    };
  }

  /**
   * Get only iOS device presets
   * @returns {Object} Object containing iOS device configurations
   */
  getIOSDevices() {
    const all = this.getPresetDevices();
    const iosDevices = {};
    for (const [name, config] of Object.entries(all)) {
      if (config.platform === 'ios') {
        iosDevices[name] = config;
      }
    }
    return iosDevices;
  }

  /**
   * Get only Android device presets
   * @returns {Object} Object containing Android device configurations
   */
  getAndroidDevices() {
    const all = this.getPresetDevices();
    const androidDevices = {};
    for (const [name, config] of Object.entries(all)) {
      if (config.platform !== 'ios') {
        androidDevices[name] = config;
      }
    }
    return androidDevices;
  }

  /**
   * Set an iOS device to emulate
   * @param {Object} iosConfig - iOS device configuration
   * @returns {string} The iOS User-Agent
   */
  setIOSDevice(iosConfig) {
    const {
      iosDeviceModel = 'iPhone16,2',
      iosDeviceName = 'iPhone 15 Pro Max',
      iosVersion = '18.3',
      iosAppVersion = '366.0.0.38.99',
      iosAppVersionCode = '632412089'
    } = iosConfig || {};

    this.platform = 'ios';
    this.iosDeviceModel = iosDeviceModel;
    this.iosDeviceName = iosDeviceName;
    this.iosVersion = iosVersion;
    this.iosAppVersion = iosAppVersion;
    this.iosAppVersionCode = iosAppVersionCode;

    // Generate iOS-specific device identifiers
    const chance = new Chance(`ios-${iosDeviceModel}-${Date.now()}`);
    this.deviceId = `ios-${chance.string({ pool: 'ABCDEF0123456789', length: 40 })}`;
    this.uuid = chance.guid().toUpperCase();
    this.phoneId = chance.guid().toUpperCase();
    this.adid = chance.guid().toUpperCase();

    if (this._emitter) {
      this._emitter.emit('device_changed', { 
        platform: 'ios',
        deviceModel: iosDeviceModel, 
        deviceName: iosDeviceName,
        userAgent: this.iosUserAgent 
      });
    }

    return this.iosUserAgent;
  }

  /**
   * Switch to iOS platform with a preset device
   * @param {string} presetName - Name of the iOS preset (e.g., 'iPhone 16 Pro Max')
   * @returns {string|null} iOS User-Agent if successful, null if preset not found
   */
  useIOSDevice(presetName) {
    const presets = this.getPresetDevices();
    if (presets[presetName] && presets[presetName].platform === 'ios') {
      return this.setIOSDevice(presets[presetName]);
    }
    const iosDevices = Object.keys(this.getIOSDevices());
    console.warn(`iOS device "${presetName}" not found. Available iOS devices:`, iosDevices);
    return null;
  }

  /**
   * Switch to Android platform with a preset device
   * @param {string} presetName - Name of the Android preset (e.g., 'Samsung Galaxy S25 Ultra')
   * @returns {string|null} Device string if successful, null if preset not found
   */
  useAndroidDevice(presetName) {
    const presets = this.getPresetDevices();
    if (presets[presetName] && presets[presetName].platform !== 'ios') {
      this.platform = 'android';
      return this.setCustomDevice(presets[presetName]);
    }
    const androidDevices = Object.keys(this.getAndroidDevices());
    console.warn(`Android device "${presetName}" not found. Available Android devices:`, androidDevices);
    return null;
  }

  /**
   * Switch platform between iOS and Android
   * @param {string} targetPlatform - 'ios' or 'android'
   * @param {string} devicePreset - Optional device preset name
   */
  switchPlatform(targetPlatform, devicePreset = null) {
    if (targetPlatform === 'ios') {
      if (devicePreset) {
        return this.useIOSDevice(devicePreset);
      }
      return this.useIOSDevice('iPhone 16 Pro Max');
    } else if (targetPlatform === 'android') {
      if (devicePreset) {
        return this.useAndroidDevice(devicePreset);
      }
      this.platform = 'android';
      return this.useAndroidDevice('Samsung Galaxy S25 Ultra');
    }
    console.warn('Invalid platform. Use "ios" or "android".');
    return null;
  }

  /**
   * Get current platform info
   * @returns {Object} Current platform and device information
   */
  getPlatformInfo() {
    return {
      platform: this.platform,
      userAgent: this.appUserAgent,
      packageName: this.packageName,
      deviceId: this.deviceId,
      ...(this.platform === 'ios' ? {
        iosDeviceModel: this.iosDeviceModel,
        iosDeviceName: this.iosDeviceName,
        iosVersion: this.iosVersion,
        iosAppVersion: this.iosAppVersion
      } : {
        deviceString: this.deviceString,
        build: this.build
      })
    };
  }

  /**
   * List all available device presets grouped by platform
   * @returns {Object} Devices grouped by platform
   */
  listAllDevices() {
    return {
      android: Object.keys(this.getAndroidDevices()),
      ios: Object.keys(this.getIOSDevices())
    };
  }

  /**
   * Quick method to set a device from presets by name
   * @param {string} presetName - Name of the preset (e.g., 'Samsung Galaxy S25 Ultra')
   * @returns {string|null} Device string if successful, null if preset not found
   * 
   * @example
   * state.usePresetDevice('Samsung Galaxy S25 Ultra');
   * state.usePresetDevice('Huawei P60 Pro');
   * state.usePresetDevice('Google Pixel 8 Pro');
   */
  usePresetDevice(presetName) {
    const presets = this.getPresetDevices();
    if (presets[presetName]) {
      return this.setCustomDevice(presets[presetName]);
    }
    console.warn(`Preset device "${presetName}" not found. Available presets:`, Object.keys(presets));
    return null;
  }

  /**
   * Get the current device info being emulated
   * @returns {Object} Current device configuration
   */
  getCurrentDeviceInfo() {
    return {
      deviceString: this.deviceString,
      deviceId: this.deviceId,
      uuid: this.uuid,
      phoneId: this.phoneId,
      adid: this.adid,
      build: this.build,
      userAgent: this.appUserAgent
    };
  }

  generateTemporaryGuid(seed, lifetime) {
    return new Chance(`${seed}${this.deviceId}${Math.round(Date.now() / lifetime)}`).guid();
  }

  clearCookies() {
    this.cookieJar = new CookieJar();
  }

  listCookies() {
    try {
      const cookies = this.cookieJar.getCookiesSync
        ? this.cookieJar.getCookiesSync(this.constants.HOST)
        : this.cookieJar.getCookies(this.constants.HOST);
      if (Array.isArray(cookies)) {
        for (const c of cookies) {
          console.log(`- ${c.key}=${c.value}`);
        }
        return cookies;
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  logStateSummary() {
    console.log('--- State Summary ---');
    console.log(`Device ID: ${this.deviceId}`);
    console.log(`UUID: ${this.uuid}`);
    console.log(`User Agent: ${this.appUserAgent}`);
    console.log(`Language: ${this.language}`);
    console.log(`Timezone Offset: ${this.timezoneOffset}`);
    console.log(`Authorization: ${this.authorization ? 'Present' : 'Missing'}`);
    console.log('----------------------');
  }

  //
  // === NEW UTILITIES ADDED BELOW (non-destructive; keep backwards compat)
  //

  /**
   * Subscribe to internal state events (non-invasive).
   * Events emitted:
   *  - 'session_saved' => (filePath)
   *  - 'session_save_failed' => (err)
   *  - 'session_loaded' => (filePath)
   *  - 'session_load_failed' => (err)
   *  - 'cookies_cleared'
   *  - 'device_regenerated'
   *  - 'session_file_changed' => (eventType, filename)
   */
  on(event, listener) {
    this._emitter.on(event, listener);
  }

  off(event, listener) {
    this._emitter.removeListener(event, listener);
  }

  once(event, listener) {
    this._emitter.once(event, listener);
  }

  /**
   * Atomic save with retries and backup rotation.
   * Attempts to write to a temp file, rename into place (atomic on most OSes),
   * and maintain up to `_maxBackupCopies` rotated backups.
   */
  async safeSaveSessionToFile(filePath = SESSION_FILE, backupPath = SESSION_BACKUP, opts = {}) {
    const retries = typeof opts.retries === 'number' ? opts.retries : this._saveRetries;
    const delayMs = typeof opts.delayMs === 'number' ? opts.delayMs : this._saveRetryDelayMs;
    const maxBackups = typeof opts.maxBackups === 'number' ? opts.maxBackups : this._maxBackupCopies;

    const tempPath = `${filePath}.tmp`;

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await this.serialize();
        // ensure parent dir exists
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        // write temp and rename (atomic on many systems)
        await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
        await fs.promises.rename(tempPath, filePath);
        // maintain backup copy
        try {
          await this._rotateAndWriteBackup(filePath, backupPath, maxBackups);
        } catch (_) {
          // non-fatal for backup rotation
        }
        this._emitter.emit('session_saved', filePath);
        return true;
      } catch (err) {
        lastErr = err;
        // small backoff
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
    this._emitter.emit('session_save_failed', lastErr);
    throw lastErr || new Error('safeSaveSessionToFile failed');
  }

  // helper: rotate existing backups and write new backup copy
  async _rotateAndWriteBackup(filePath, backupPath, maxBackups) {
    try {
      // if no original file, just copy
      if (!fs.existsSync(filePath)) {
        const data = await this.serialize();
        await fs.promises.writeFile(backupPath, JSON.stringify(data, null, 2), { mode: 0o600 });
        return;
      }

      // rotate existing numeric backups (backupPath.1, backupPath.2, ...)
      for (let i = maxBackups - 1; i >= 1; i--) {
        const src = `${backupPath}.${i}`;
        const dst = `${backupPath}.${i + 1}`;
        if (fs.existsSync(src)) {
          try { await fs.promises.rename(src, dst); } catch (_) {}
        }
      }
      // move current backup to .1
      if (fs.existsSync(backupPath)) {
        try { await fs.promises.rename(backupPath, `${backupPath}.1`); } catch (_) {}
      }
      // write a new backup from current file
      const content = await fs.promises.readFile(filePath, 'utf8');
      await fs.promises.writeFile(backupPath, content, { mode: 0o600 });
    } catch (e) {
      // ignore backup rotation issues
    }
  }

  /**
   * Safe load with retries. Emits session_loaded/session_load_failed events.
   */
  async safeLoadSessionFromFile(filePath = SESSION_FILE, backupPath = SESSION_BACKUP, opts = {}) {
    const retries = typeof opts.retries === 'number' ? opts.retries : 2;
    const delayMs = typeof opts.delayMs === 'number' ? opts.delayMs : 200;

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const ok = await this.loadSessionFromFile(filePath, backupPath);
        if (ok) {
          this._emitter.emit('session_loaded', filePath);
          return true;
        }
        // if not ok, wait and retry
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
    this._emitter.emit('session_load_failed', lastErr);
    throw lastErr || new Error('safeLoadSessionFromFile failed');
  }

  /**
   * Validate minimal session integrity: ensure cookie jar has expected cookies or parsed authorization
   */
  validateSession() {
    try {
      // try to read ds_user_id or parsed authorization
      let ok = false;
      try {
        const uid = this.extractCookieValue('ds_user_id');
        ok = !!uid;
      } catch (_) {
        // fallback to parsed authorization
        this.updateAuthorization();
        ok = !!(this.parsedAuthorization && this.parsedAuthorization.ds_user_id);
      }
      return ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * Merge cookies from another serialized jar or CookieJar instance into current cookieJar.
   * Accepts: serialized object/string (as used by serializeCookieJar) or CookieJar instance.
   */
  async mergeCookieJarFrom(other) {
    try {
      if (!other) return false;
      // if serialized string/object
      if (typeof other === 'string' || (typeof other === 'object' && !other.getCookieSync)) {
        // deserialize into a temporary jar
        const deserializeFn = util.promisify((input, cb) => {
          try {
            CookieJar.deserialize(input, cb);
          } catch (err) {
            cb(err);
          }
        });
        const tmpJar = await deserializeFn(typeof other === 'string' ? JSON.parse(other) : other);
        if (!tmpJar) return false;
        // merge: extract cookies for host and set into current jar
        const host = this.constants.HOST;
        const cookies = tmpJar.getCookiesSync ? tmpJar.getCookiesSync(host) : await tmpJar.getCookies(host);
        if (Array.isArray(cookies)) {
          for (const c of cookies) {
            try {
              // setCookieSync may not exist in some versions; fallback to async
              if (typeof this.cookieJar.setCookieSync === 'function') {
                this.cookieJar.setCookieSync(c, host);
              } else if (typeof this.cookieJar.setCookie === 'function') {
                // promisify setCookie
                await util.promisify(this.cookieJar.setCookie).call(this.cookieJar, c, host);
              }
            } catch (_) {}
          }
        }
        return true;
      } else if (typeof other.getCookiesSync === 'function' || typeof other.getCookies === 'function') {
        // assume CookieJar instance
        const host = this.constants.HOST;
        const cookies = other.getCookiesSync ? other.getCookiesSync(host) : await other.getCookies(host);
        if (Array.isArray(cookies)) {
          for (const c of cookies) {
            try {
              if (typeof this.cookieJar.setCookieSync === 'function') {
                this.cookieJar.setCookieSync(c, host);
              } else if (typeof this.cookieJar.setCookie === 'function') {
                await util.promisify(this.cookieJar.setCookie).call(this.cookieJar, c, host);
              }
            } catch (_) {}
          }
        }
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  /**
   * Export a minimal session object (useful for sending to remote storage or IPC).
   */
  async exportMinimalSession() {
    const cookieData = await this.serializeCookieJar();
    return {
      deviceId: this.deviceId,
      deviceString: this.deviceString,
      uuid: this.uuid,
      phoneId: this.phoneId,
      adid: this.adid,
      build: this.build,
      authorization: this.authorization,
      cookies: cookieData
    };
  }

  /**
   * Import minimal session object (merges cookies if present and sets fields).
   */
  async importMinimalSession(minObj = {}) {
    if (!minObj || typeof minObj !== 'object') return false;
    try {
      if (minObj.cookies) {
        try { await this.mergeCookieJarFrom(minObj.cookies); } catch (_) {}
      }
      // set other fields cautiously
      const fields = ['deviceId', 'deviceString', 'uuid', 'phoneId', 'adid', 'build', 'authorization'];
      for (const k of fields) {
        if (typeof minObj[k] !== 'undefined') this[k] = minObj[k];
      }
      this.updateAuthorization();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Set proxy URL (persists only in-memory; use saveSessionToFile to persist).
   */
  setProxyUrl(url) {
    this.proxyUrl = url || null;
    return this.proxyUrl;
  }

  clearProxyUrl() {
    this.proxyUrl = null;
    return true;
  }

  /**
   * Mark checkpoint metadata object (stores arbitrary checkpoint info).
   */
  markCheckpoint(obj) {
    try {
      this.checkpoint = obj;
      return true;
    } catch (_) {
      return false;
    }
  }

  clearCheckpoint() {
    this.checkpoint = null;
    return true;
  }

  /**
   * Ensure session file has safe permissions (owner read/write only)
   */
  ensureFilePermissions(filePath = SESSION_FILE) {
    try {
      if (fs.existsSync(filePath)) {
        fs.chmodSync(filePath, 0o600);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Watch the session file for external changes and emit 'session_file_changed'.
   * Note: uses fs.watchFile which is more portable; call stopWatchingSessionFile() to stop.
   */
  watchSessionFile(filePath = SESSION_FILE, intervalMs = 1000) {
    try {
      if (this._sessionFileWatcher) {
        // already watching
        return true;
      }
      // use watchFile (polling) for reliability across platforms
      fs.watchFile(filePath, { interval: intervalMs }, (curr, prev) => {
        // ignore if size/time identical
        if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
          this._emitter.emit('session_file_changed', { filePath, curr, prev });
        }
      });
      this._sessionFileWatcher = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  stopWatchingSessionFile(filePath = SESSION_FILE) {
    try {
      if (!this._sessionFileWatcher) return true;
      fs.unwatchFile(filePath);
      this._sessionFileWatcher = null;
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * If device looks missing or invalid, regenerate device fields.
   * Condition: deviceId missing or doesn't start with expected prefix.
   */
  refreshDeviceIfMissingOrOld(seed = 'instagram-private-api') {
    try {
      if (!this.deviceId || typeof this.deviceId !== 'string' || !this.deviceId.startsWith('android-')) {
        this.generateDevice(seed);
        this._emitter.emit('device_regenerated');
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Refresh authorization state from cookies (useful after merging cookies).
   */
  refreshAuthFromCookies() {
    try {
      this.updateAuthorization();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Safe load helper that tries to load, validate, and optionally attempt fallback to backup copies.
   * If `validate` is true, will call validateSession() and throw if invalid.
   */
  async loadAndValidateSession(filePath = SESSION_FILE, backupPath = SESSION_BACKUP, opts = {}) {
    const validate = opts.validate !== false; // default true
    try {
      const ok = await this.safeLoadSessionFromFile(filePath, backupPath, opts);
      if (!ok) throw new Error('load failed');
      if (validate && !this.validateSession()) {
        // try backup load
        const triedBackups = await this._tryLoadRotatedBackups(backupPath, opts);
        if (!triedBackups) throw new Error('session invalid and backups failed');
      }
      this._emitter.emit('session_loaded', filePath);
      return true;
    } catch (e) {
      this._emitter.emit('session_load_failed', e);
      throw e;
    }
  }

  // helper: try load rotated backups .1 .. .N
  async _tryLoadRotatedBackups(backupPath, opts = {}) {
    try {
      const max = typeof opts.maxBackups === 'number' ? opts.maxBackups : this._maxBackupCopies;
      for (let i = 1; i <= max; i++) {
        const p = `${backupPath}.${i}`;
        if (!fs.existsSync(p)) continue;
        try {
          const raw = await fs.promises.readFile(p, 'utf8');
          const obj = JSON.parse(raw);
          await this.deserialize(obj);
          if (this.validateSession()) return true;
        } catch (_) {
          // continue trying next
        }
      }
    } catch (_) {}
    return false;
  }

  /**
   * Clear all session data (cookies + auth + device optional).
   * If `preserveDevice` is true, device fields are kept.
   */
  clearAllSession(preserveDevice = true) {
    try {
      this.clearCookies();
      this.authorization = undefined;
      this.parsedAuthorization = undefined;
      this.igWWWClaim = undefined;
      this.passwordEncryptionKeyId = undefined;
      this.passwordEncryptionPubKey = undefined;
      if (!preserveDevice) {
        this.generateDevice('instagram-private-api');
      }
      this._emitter.emit('cookies_cleared');
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Quick helper: get value of cookie if exists, or null (non-throwing).
   */
  getCookieValueSafe(key) {
    try {
      const c = this.extractCookie(key);
      return c ? c.value : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Convenience: set default save/retry options
   */
  setSaveRetryOptions({ retries, delayMs, maxBackups } = {}) {
    if (typeof retries === 'number') this._saveRetries = retries;
    if (typeof delayMs === 'number') this._saveRetryDelayMs = delayMs;
    if (typeof maxBackups === 'number') this._maxBackupCopies = maxBackups;
    return { retries: this._saveRetries, delayMs: this._saveRetryDelayMs, maxBackups: this._maxBackupCopies };
  }
}

module.exports = State;
