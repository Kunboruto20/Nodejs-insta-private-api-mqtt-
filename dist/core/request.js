/**
 * request.fixed.js
 *
 * Repaired Request wrapper for nodejs-insta-private-api(-mqtt).
 * Changes / fixes applied:
 *  - Removed global Content-Type header (was forcing urlencoded for all requests).
 *  - Made axios timeout configurable via client.state.requestTimeout (fallback 120s).
 *  - Set maxContentLength / maxBodyLength = Infinity to allow binary uploads.
 *  - Accept both `data` and `body` when callers pass payload; ensures axios receives `data`.
 *  - Preserve ability to pass signal (AbortController) through axios config.
 *  - Keep updateState / cookie handling intact.
 *
 * Replace the original request.js with this file (or apply same changes).
 */

const axios = require('axios');
const crypto = require('crypto');
const { random } = require('lodash');
const NavChainManager = require('./nav-chain');

class Request {
  constructor(client) {
    this.client = client;
    this.end$ = { complete: () => {} };
    this.error$ = { complete: () => {} };
    this.navChain = new NavChainManager();

    // Determine timeout: prefer client.state.requestTimeout if provided, otherwise 120s
    const timeoutMs = (this.client && this.client.state && this.client.state.requestTimeout)
      ? this.client.state.requestTimeout
      : 120000;

    // Create axios instance with sensible defaults for uploads
    this.httpClient = axios.create({
      baseURL: 'https://i.instagram.com/',
      timeout: timeoutMs,
      // Allow large uploads
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      // Do not set a global Content-Type here -- requests will set their own appropriate Content-Type
      // headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
    });

    // Optional: you can add interceptors for debugging if needed
    // this.httpClient.interceptors.response.use(resp => resp, err => Promise.reject(err));
  }

  signature(data) {
    return 'SIGNATURE';
  }

  sign(payload) {
    const json = typeof payload === 'object' ? JSON.stringify(payload) : payload;
    return {
      signed_body: `SIGNATURE.${json}`,
    };
  }

  userBreadcrumb(size) {
    const term = random(2, 3) * 1000 + size + random(15, 20) * 1000;
    const textChangeEventCount = Math.round(size / random(2, 3)) || 1;
    const data = `${size} ${term} ${textChangeEventCount} ${Date.now()}`;
    const signature = Buffer.from(
      crypto.createHmac('sha256', this.client.state.userBreadcrumbKey)
        .update(data)
        .digest('hex'),
    ).toString('base64');
    const body = Buffer.from(data).toString('base64');
    return `${signature}\n${body}\n`;
  }

  /**
   * Send a request.
   * options should follow axios request config shape but this wrapper supports:
   *  - options.form -> object (will be turned into application/x-www-form-urlencoded)
   *  - options.qs -> query params
   *  - options.data or options.body -> request payload (we prefer data)
   */
  async send(options = {}) {
    const requestUrl = options.url || options.path || options.uri || '';
    this._autoUpdateNavChain(requestUrl, (options.method || 'GET').toUpperCase());

    // base axios config
    const config = {
      url: requestUrl,
      method: (options.method || 'GET').toUpperCase(),
      headers: {
        ...this.getDefaultHeaders(),
        ...(options.headers || {})
      },
      // allow override of responseType if needed
      responseType: options.responseType || undefined,
      // allow axios to handle decompress etc.
      decompress: options.decompress !== undefined ? options.decompress : true,
    };

    // Query string / params
    if (options.qs) {
      config.params = options.qs;
    }

    // Abort signal support (axios v0.22+ supports signal)
    if (options.signal) {
      config.signal = options.signal;
    }

    // Handle form data (application/x-www-form-urlencoded)
    if (options.form && (config.method === 'POST' || config.method === 'PUT' || config.method === 'PATCH')) {
      // Build a urlencoded string
      const formData = new URLSearchParams();
      Object.keys(options.form).forEach(key => {
        const val = options.form[key];
        // For arrays/objects convert to JSON string to be safe
        if (typeof val === 'object') {
          formData.append(key, JSON.stringify(val));
        } else {
          formData.append(key, String(val));
        }
      });
      config.data = formData.toString();
      config.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    } else {
      // If caller supplied data or body, prefer data
      if (options.data !== undefined) {
        config.data = options.data;
      } else if (options.body !== undefined) {
        // Accept legacy 'body' name used in some wrappers: ensure binary stays as-is
        config.data = options.body;
      }
    }

    // If caller explicitly passed paramsSerializer (rare), keep it
    if (options.paramsSerializer) {
      config.paramsSerializer = options.paramsSerializer;
    }

    try {
      // Use axios instance
      const response = await this.httpClient.request(config);
      // Update internal client state (cookies, headers, auth, etc.)
      this.updateState(response);

      // Normalize success check: either HTTP 200 or response.data.status === 'ok'
      const data = response.data;
      if ((data && data.status && data.status === 'ok') || response.status === 200 || response.status === 201) {
        return { body: data, headers: response.headers, status: response.status };
      }

      // If not explicitly ok, throw a processed error
      throw this.handleResponseError(response);
    } catch (error) {
      // If axios error with response, map to IG-specific errors
      if (error && error.response) {
        throw this.handleResponseError(error.response);
      }

      // Re-throw axios error (timeout, network, abort, etc.)
      throw error;
    }
  }

  updateState(response) {
    const headers = response.headers || {};

    if (headers['x-ig-set-www-claim']) {
      this.client.state.igWWWClaim = headers['x-ig-set-www-claim'];
    }
    if (headers['ig-set-authorization'] && !headers['ig-set-authorization'].endsWith(':')) {
      this.client.state.authorization = headers['ig-set-authorization'];
    }
    if (headers['ig-set-password-encryption-key-id']) {
      this.client.state.passwordEncryptionKeyId = headers['ig-set-password-encryption-key-id'];
    }
    if (headers['ig-set-password-encryption-pub-key']) {
      this.client.state.passwordEncryptionPubKey = headers['ig-set-password-encryption-pub-key'];
    }
    const mid = headers['ig-set-x-mid'];
    if (mid) {
      this.client.state.mid = mid;
    }
    const igURur = headers['ig-set-ig-u-rur'];
    if (igURur) {
      this.client.state.igURur = igURur;
    }

    // Update cookies from Set-Cookie headers (if cookieJar is available)
    const setCookieHeaders = headers['set-cookie'] || headers['Set-Cookie'];
    if (setCookieHeaders && Array.isArray(setCookieHeaders) && this.client.state && this.client.state.cookieStore && typeof this.client.state.cookieStore.setCookieSync === 'function') {
      setCookieHeaders.forEach(cookieString => {
        try {
          // host constant fallback if available
          const host = (this.client.state.constants && this.client.state.constants.HOST) ? this.client.state.constants.HOST : 'https://i.instagram.com';
          this.client.state.cookieStore.setCookieSync(cookieString, host);
        } catch (e) {
          // ignore cookie parsing errors
        }
      });
    }
  }

  handleResponseError(response) {
    const data = response.data || {};
    const status = response.status;

    if (data && data.spam) {
      const error = new Error('Action blocked as spam');
      error.name = 'IgActionSpamError';
      error.response = response;
      return error;
    }

    if (status === 404) {
      const error = new Error('Not found');
      error.name = 'IgNotFoundError';
      error.response = response;
      return error;
    }

    if (data && data.message === 'challenge_required') {
      this.client.state.checkpoint = data;
      const error = new Error('Challenge required');
      error.name = 'IgCheckpointError';
      error.response = response;
      return error;
    }

    if (data && data.message === 'user_has_logged_out') {
      const error = new Error('User has logged out');
      error.name = 'IgUserHasLoggedOutError';
      error.response = response;
      return error;
    }

    if (data && data.message === 'login_required') {
      const error = new Error('Login required');
      error.name = 'IgLoginRequiredError';
      error.response = response;
      return error;
    }

    if (data && data.error_type === 'sentry_block') {
      const error = new Error('Sentry block');
      error.name = 'IgSentryBlockError';
      error.response = response;
      return error;
    }

    if (data && data.error_type === 'inactive user') {
      const error = new Error('Inactive user');
      error.name = 'IgInactiveUserError';
      error.response = response;
      return error;
    }

    const error = new Error((data && data.message) ? data.message : 'Request failed');
    error.name = 'IgResponseError';
    error.response = response;
    error.status = status;
    error.data = data;
    return error;
  }

  _autoUpdateNavChain(url, method) {
    if (!url) return;
    const path = url.toLowerCase();

    if (path.includes('/accounts/login/') || path.includes('/launcher/sync/')) {
      this.navChain.simulateAppOpen();
      return;
    }

    if (path.includes('/direct_v2/inbox/') || path.includes('/direct_v2/pending_inbox/') || path.includes('/direct_v2/ranked_recipients/')) {
      this.navChain.navigateToInbox();
      return;
    }

    if (path.includes('/direct_v2/threads/broadcast/')) {
      this.navChain.getChainForDMBroadcast();
      return;
    }

    if (path.includes('/direct_v2/threads/') && !path.includes('broadcast')) {
      if (path.includes('/seen/') || path.includes('/items/')) {
        this.navChain.incrementForAction();
      } else {
        this.navChain.navigateToThread();
      }
      return;
    }

    if (path.includes('/direct_v2/get_presence/')) {
      this.navChain.incrementForAction();
      return;
    }

    if (path.includes('/feed/timeline/') || path.includes('/feed/reels_tray/')) {
      this.navChain.navigateToFeed();
      return;
    }

    if (path.includes('/users/') && path.includes('/info/')) {
      this.navChain.incrementForAction();
      return;
    }

    if (path.includes('/explore/')) {
      this.navChain.navigateToExplore();
      return;
    }

    if (path.includes('/accounts/current_user/') || path.includes('/users/self/')) {
      this.navChain.navigateToProfile(true);
      return;
    }

    if (method === 'POST') {
      this.navChain.incrementForAction();
    }
  }

  getDefaultHeaders() {
    const state = this.client.state;
    const locale = (state.locale || state.language || 'en_US').replace('-', '_');
    const lang = locale.replace('_', '-');
    const acceptLanguage = lang === 'en-US' ? 'en-US' : `${lang}, en-US`;
    const userId = (() => {
      try { return state.cookieUserId; } catch { return 0; }
    })();

    const headers = {
      'X-IG-App-Locale': locale,
      'X-IG-Device-Locale': locale,
      'X-IG-Mapped-Locale': locale,
      'X-Pigeon-Session-Id': `UFS-${state.pigeonSessionId}-1`,
      'X-Pigeon-Rawclienttime': (Date.now() / 1000).toFixed(3),
      'X-IG-Bandwidth-Speed-KBPS': (random(2500000, 3000000) / 1000).toFixed(3),
      'X-IG-Bandwidth-TotalBytes-B': String(random(5000000, 90000000)),
      'X-IG-Bandwidth-TotalTime-MS': String(random(2000, 9000)),
      'X-IG-App-Startup-Country': (state.country || 'US').toUpperCase(),
      'X-Bloks-Version-Id': state.bloksVersionId,
      'X-IG-WWW-Claim': state.igWWWClaim || '0',
      'X-Bloks-Is-Layout-RTL': 'false',
      'X-Bloks-Is-Panorama-Enabled': 'true',
      'X-IG-Device-ID': state.uuid,
      'X-IG-Family-Device-ID': state.phoneId,
      'X-IG-Android-ID': state.deviceId,
      'X-IG-Timezone-Offset': String(state.timezoneOffset),
      'X-IG-Connection-Type': state.connectionTypeHeader || 'WIFI',
      'X-IG-Capabilities': state.capabilitiesHeader || '3brTvx0=',
      'X-IG-App-ID': state.fbAnalyticsApplicationId,
      'Priority': 'u=3',
      'User-Agent': state.appUserAgent,
      'Accept-Language': acceptLanguage,
      'X-MID': state.mid || '',
      'Accept-Encoding': 'gzip, deflate',
      'Host': 'i.instagram.com',
      'X-FB-HTTP-Engine': 'Liger',
      'Connection': 'keep-alive',
      'X-FB-Client-IP': 'True',
      'X-FB-Server-Cluster': 'True',
      'IG-INTENDED-USER-ID': String(userId || 0),
      'X-IG-Nav-Chain': this.navChain.getChainString(),
      'X-IG-SALT-IDS': String(random(1061162222, 1061262222)),
    };

    if (state.authorization) {
      headers['Authorization'] = state.authorization;
    }

    if (userId && userId !== 0 && userId !== '0') {
      const nextYear = Math.floor(Date.now() / 1000) + 31536000;
      headers['IG-U-DS-USER-ID'] = String(userId);
      headers['IG-U-IG-DIRECT-REGION-HINT'] = `LLA,${userId},${nextYear}:01f7bae7d8b131877d8e0ae1493252280d72f6d0d554447cb1dc9049b6b2c507c08605b7`;
      headers['IG-U-SHBID'] = `12695,${userId},${nextYear}:01f778d9c9f7546cf3722578fbf9b85143cd6e5132723e5c93f40f55ca0459c8ef8a0d9f`;
      headers['IG-U-SHBTS'] = `${Math.floor(Date.now() / 1000)},${userId},${nextYear}:01f7ace11925d0388080078d0282b75b8059844855da27e23c90a362270fddfb3fae7e28`;
      headers['IG-U-RUR'] = `RVA,${userId},${nextYear}:01f7f627f9ae4ce2874b2e04463efdb184340968b1b006fa88cb4cc69a942a04201e544c`;
    }
    if (state.igURur) {
      headers['IG-U-RUR'] = state.igURur;
    }
    if (state.igWWWClaim) {
      headers['X-IG-WWW-Claim'] = state.igWWWClaim;
    }

    return headers;
  }
}

module.exports = Request;

