const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const State = require('./state');
const Request = require('./request');
const AccountRepository = require('../repositories/account.repository');
const UserRepository = require('../repositories/user.repository');
const DirectRepository = require('../repositories/direct.repository');
const DirectThreadRepository = require('../repositories/direct-thread.repository');
const MediaRepository = require('../repositories/media.repository');
const UploadRepository = require('../repositories/upload.repository');
const StoryRepository = require('../repositories/story.repository');
const FeedRepository = require('../repositories/feed.repository');
const FriendshipRepository = require('../repositories/friendship.repository');
const LocationRepository = require('../repositories/location.repository');
const HashtagRepository = require('../repositories/hashtag.repository');
const NewsRepository = require('../repositories/news.repository');
const CollectionRepository = require('../repositories/collection.repository');
const CloseFriendsRepository = require('../repositories/close-friends.repository');
const ClipRepository = require('../repositories/clip.repository');
const TimelineRepository = require('../repositories/timeline.repository');
const InsightsRepository = require('../repositories/insights.repository');
const NoteRepository = require('../repositories/note.repository');
const NotificationRepository = require('../repositories/notification.repository');
const SignupRepository = require('../repositories/signup.repository');
const TOTPRepository = require('../repositories/totp.repository');
const BloksRepository = require('../repositories/bloks.repository');
const ChallengeRepository = require('../repositories/challenge.repository');
const ShareRepository = require('../repositories/share.repository');
const TrackRepository = require('../repositories/track.repository');
const ExploreRepository = require('../repositories/explore.repository');
const FBSearchRepository = require('../repositories/fbsearch.repository');
const FundraiserRepository = require('../repositories/fundraiser.repository');
const MultipleAccountsRepository = require('../repositories/multiple-accounts.repository');
const CaptchaRepository = require('../repositories/captcha.repository');
const HighlightsRepository = require('../repositories/highlights.repository');
const SearchService = require('../services/search.service');
const LiveService = require('../services/live.service');

/**
 * IgApiClient
 *
 * - Păstrăm în totalitate funcționalitatea existentă (login/logout/isLoggedIn/saveSession/loadSession/isSessionValid/destroy)
 * - Am eliminat complet stratul Realtime (WebSocket). Orice cod dependent de realtime trebuie migrat separat.
 * - Am adăugat un helper generic `retryAsync(fn, opts)` pentru retry/backoff la operații asincrone (utile pentru request-uri).
 */
class IgApiClient extends EventEmitter {
  constructor() {
    super();

    this.state = new State();
    this.request = new Request(this);
    this.navChain = this.request.navChain;

    // Initialize repositories
    this.account = new AccountRepository(this);
    this.user = new UserRepository(this);
    this.direct = new DirectRepository(this);
    this.directThread = new DirectThreadRepository(this);
    this.media = new MediaRepository(this);
    this.upload = new UploadRepository(this);
    this.story = new StoryRepository(this);
    this.feed = new FeedRepository(this);
    this.friendship = new FriendshipRepository(this);
    this.location = new LocationRepository(this);
    this.hashtag = new HashtagRepository(this);
    this.news = new NewsRepository(this);
    this.collection = new CollectionRepository(this);
    this.closeFriends = new CloseFriendsRepository(this);
    this.clip = new ClipRepository(this);
    this.timeline = new TimelineRepository(this);
    this.insights = new InsightsRepository(this);
    this.note = new NoteRepository(this);
    this.notification = new NotificationRepository(this);
    this.signup = new SignupRepository(this);
    this.totp = new TOTPRepository(this);
    this.bloks = new BloksRepository(this);
    this.challenge = new ChallengeRepository(this);
    this.share = new ShareRepository(this);
    this.track = new TrackRepository(this);
    this.explore = new ExploreRepository(this);
    this.fbsearch = new FBSearchRepository(this);
    this.fundraiser = new FundraiserRepository(this);
    this.multipleAccounts = new MultipleAccountsRepository(this);
    this.captcha = new CaptchaRepository(this);
    this.highlights = new HighlightsRepository(this);

    // Initialize services
    this.search = new SearchService(this);
    this.live = new LiveService(this);

    // Create dm object for easier access (keeps backward compatibility)
    this.dm = {
      send: this.direct.send.bind(this.direct),
      sendToGroup: this.directThread.sendToGroup.bind(this.directThread),
      sendImage: this.direct.sendImage.bind(this.direct),
      sendVideo: this.direct.sendVideo.bind(this.direct),
      getInbox: this.direct.getInbox.bind(this.direct),
      getThread: this.directThread.getThread.bind(this.directThread)
    };

    // Proxy debug / verbose
    this.state.verbose = this.state.verbose || false;

    // Default retry policy for the new helper retryAsync
    this._defaultRetryPolicy = { retries: 3, delayMs: 500 };

  }

  /**
   * Login -> uses account.login. Returns whatever account.login returns.
   * NOTE: removed automatic realtime connection attempt.
   */
  async login(credentials) {
    this.navChain.simulateAppOpen();
    if (this.state.deviceId) {
       try {
         await this.preLoginFlow();
       } catch (e) {
         if (this.state.verbose) console.warn('[Pre-Login] Flow error (non-fatal):', e.message);
       }
    }
    const result = await this.account.login(credentials);
    try {
      await this.postLoginFlow();
    } catch (e) {
      if (this.state.verbose) console.warn('[Post-Login] Flow error (non-fatal):', e.message);
    }
    return result;
  }

  /**
   * Additional Android-specific behavior simulation
   */
  async simulateAndroidBehavior() {
    if (this.state.verbose) console.log('[Anti-Bot] Simulating Android-specific background behaviors...');
    
    // 0. Pre-login notification suppression / Trust signal
    try {
      await this.request.send({
        url: '/api/v1/accounts/get_presence_disabled/',
        method: 'GET',
      });
    } catch (e) {}

    // 1. Fetch Contact Permission (often requested on start/login)
    try {
      await this.request.send({
        url: '/api/v1/accounts/contact_point_pref/',
        method: 'GET',
      });
    } catch (e) {}

    // 2. Fetch Zero Rating (Mobile data settings)
    try {
      await this.request.send({
        url: '/api/v1/zero/get_headers/',
        method: 'GET',
      });
    } catch (e) {}

    // 3. Fetch Banyan (Explore/Search context)
    try {
      await this.request.send({
        url: '/api/v1/banyan/banyan/',
        method: 'GET',
        qs: {
          views: '["direct_user_search","direct_search_context","direct_share_sheet"]',
        },
      });
    } catch (e) {}
  }

  async logout() {
    return await this.account.logout();
  }

  isLoggedIn() {
    try {
      return !!this.state.cookieUserId;
    } catch {
      return false;
    }
  }

  async saveSession() {
    return await this.state.serialize();
  }

  async loadSession(session) {
    const ret = await this.state.deserialize(session);
    this.navChain.simulateAppOpen();
    return ret;
  }

  async isSessionValid() {
    try {
      await this.account.currentUser();
      return true;
    } catch {
      return false;
    }
  }

  destroy() {
    // Cleanup resources - keep original behaviour for request streams if present
    try { this.request.error$.complete(); } catch (_) {}
    try { this.request.end$.complete(); } catch (_) {}
  }

  // -------------------------------
  // === UTILITY HELPER METHODS
  // -------------------------------

  async preLoginFlow() {
    if (this.state.verbose) console.log('[Pre-Login] Starting pre-login flow (sync_launcher)...');
    try {
      await this.request.send({
        url: '/api/v1/launcher/sync/',
        method: 'POST',
        form: this.request.sign({
          id: this.state.uuid,
          server_config_retrieval: '1',
        }),
      });
      if (this.state.verbose) console.log('[Pre-Login] Launcher Sync: OK');
    } catch (e) {
      if (this.state.verbose) console.warn('[Pre-Login] Launcher Sync Failed (non-fatal):', e.message);
    }
    await new Promise(resolve => setTimeout(resolve, Math.random() * 700 + 175));
  }

  async postLoginFlow() {
    if (this.state.verbose) console.log('[Post-Login] Starting post-login flow...');
    try {
      await this.request.send({
        url: '/api/v1/feed/reels_tray/',
        method: 'POST',
        form: this.request.sign({
          supported_capabilities_new: JSON.stringify(this.state.constants.SUPPORTED_CAPABILITIES),
          reason: 'cold_start',
          timezone_offset: String(this.state.timezoneOffset),
          tray_session_id: this.state.traySessionId,
          request_id: this.state.requestId,
          _uuid: this.state.uuid,
          page_size: 50,
          reel_tray_impressions: {},
        }),
      });
      if (this.state.verbose) console.log('[Post-Login] Reels tray: OK');
    } catch (e) {
      if (this.state.verbose) console.warn('[Post-Login] Reels tray failed (non-fatal):', e.message);
    }
    try {
      const timelineData = JSON.stringify({
        has_camera_permission: '1',
        feed_view_info: '[]',
        phone_id: this.state.phoneId,
        reason: 'cold_start_fetch',
        battery_level: 100,
        timezone_offset: String(this.state.timezoneOffset),
        device_id: this.state.uuid,
        request_id: this.state.requestId,
        _uuid: this.state.uuid,
        is_charging: Math.random() > 0.5 ? 1 : 0,
        is_dark_mode: 1,
        will_sound_on: Math.random() > 0.5 ? 1 : 0,
        session_id: this.state.clientSessionId,
        bloks_versioning_id: this.state.bloksVersionId,
        is_pull_to_refresh: '0',
      });
      await this.request.send({
        url: '/api/v1/feed/timeline/',
        method: 'POST',
        data: timelineData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Ads-Opt-Out': '0',
          'X-DEVICE-ID': this.state.uuid,
          'X-CM-Bandwidth-KBPS': '-1.000',
          'X-CM-Latency': String(Math.floor(Math.random() * 5) + 1),
        },
      });
      if (this.state.verbose) console.log('[Post-Login] Timeline feed: OK');
    } catch (e) {
      if (this.state.verbose) console.warn('[Post-Login] Timeline feed failed (non-fatal):', e.message);
    }
  }

  async simulateAppStart() {
    return this.preLoginFlow();
  }

  /**
   * Generic retry helper for async functions.
   *
   * Usage:
   * await client.retryAsync(() => client.request.post(...), { retries: 5, delayMs: 1000 });
   *
   * Options:
   *  - retries: number (default from this._defaultRetryPolicy.retries)
   *  - delayMs: base delay in ms (default from this._defaultRetryPolicy.delayMs)
   *  - factor: multiplier for exponential backoff (default 1.5)
   *  - onRetry: optional callback (err, attempt) called before next retry
   */
  async retryAsync(fn, options = {}) {
    const retries = typeof options.retries === 'number' ? options.retries : this._defaultRetryPolicy.retries;
    const delayMs = typeof options.delayMs === 'number' ? options.delayMs : this._defaultRetryPolicy.delayMs;
    const factor = typeof options.factor === 'number' ? options.factor : 1.5;
    const onRetry = typeof options.onRetry === 'function' ? options.onRetry : null;

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (this.state.verbose) {
          console.log(`[Retry] attempt ${attempt + 1}/${retries + 1}`);
        }
        const res = await fn();
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt === retries) break;
        if (onRetry) {
          try { onRetry(err, attempt + 1); } catch (_) {}
        }
        const backoff = Math.round(delayMs * Math.pow(factor, attempt));
        if (this.state.verbose) {
          console.warn(`[Retry] attempt ${attempt + 1} failed: ${err && err.message ? err.message : err}. Backoff ${backoff}ms`);
        }
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    throw lastErr || new Error('retryAsync failed without specific error');
  }

  /**
   * Set default retry policy for retryAsync.
   * Example: client.setDefaultRetryPolicy({ retries: 5, delayMs: 800 });
   */
  setDefaultRetryPolicy(policy = {}) {
    if (typeof policy.retries === 'number') this._defaultRetryPolicy.retries = policy.retries;
    if (typeof policy.delayMs === 'number') this._defaultRetryPolicy.delayMs = policy.delayMs;
    return this._defaultRetryPolicy;
  }

  /**
   * Save session object to a file. Path optional (defaults to ./session.json).
   * Will call this.saveSession() internally.
   */
  async saveSessionToFile(filePath) {
    const p = filePath || path.resolve(process.cwd(), 'session.json');
    const data = await this.saveSession();
    // Ensure JSON string
    const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await fs.promises.writeFile(p, json, { mode: 0o600 });
    if (this.state.verbose) console.log('[Session] Saved session to', p);
    return p;
  }

  /**
   * Load session from file path (defaults to ./session.json). Returns true on success.
   */
  async loadSessionFromFile(filePath) {
    const p = filePath || path.resolve(process.cwd(), 'session.json');
    if (!fs.existsSync(p)) {
      if (this.state.verbose) console.warn('[Session] loadSessionFromFile: file not found', p);
      return false;
    }
    const raw = await fs.promises.readFile(p, 'utf8');
    let sessionObj;
    try {
      sessionObj = JSON.parse(raw);
    } catch (e) {
      if (this.state.verbose) console.warn('[Session] loadSessionFromFile: invalid JSON in', p);
      throw e;
    }
    await this.loadSession(sessionObj);
    if (this.state.verbose) console.log('[Session] Loaded session from', p);
    return true;
  }

  /**
   * Attempt to load session JSON if exists and valid, else false.
   * Wrapper helper for convenience.
   */
  async tryLoadSessionFileIfExists(filePath) {
    try {
      const loaded = await this.loadSessionFromFile(filePath);
      if (!loaded) return false;
      return await this.isSessionValid();
    } catch (e) {
      if (this.state.verbose) console.warn('[Session] tryLoadSessionFileIfExists failed:', e && e.message);
      return false;
    }
  }

  /**
   * Set verbose mode on/off.
   */
  setVerbose(flag) {
    this.state.verbose = !!flag;
    return this.state.verbose;
  }

  /**
   * safeDestroy: a slightly more robust destroy which attempts to stop requests, etc.
   */
  async safeDestroy() {
    try { if (this.request && this.request.error$ && typeof this.request.error$.complete === 'function') this.request.error$.complete(); } catch (_) {}
    try { if (this.request && this.request.end$ && typeof this.request.end$.complete === 'function') this.request.end$.complete(); } catch (_) {}
    
    
    // keep original destroy for backward compatibility
    try { this.destroy(); } catch (_) {}
  }
}

module.exports = IgApiClient;
