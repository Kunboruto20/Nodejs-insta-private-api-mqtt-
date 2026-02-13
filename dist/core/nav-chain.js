'use strict';

const { random } = require('lodash');

const SCREEN_IDS = {
  MAIN_FEED: 'MainFeedFragment',
  FEED_TIMELINE: 'FeedTimelineFragment',
  DIRECT_INBOX: 'DirectInboxFragment',
  DIRECT_THREAD: 'DirectThreadFragment',
  DIRECT_PENDING: 'DirectPendingInboxFragment',
  SELF_PROFILE: 'SelfProfileFragment',
  PROFILE: 'ProfileFragment',
  PROFILE_MEDIA_TAB: 'ProfileMediaTabFragment',
  EXPLORE: 'ExploreFragment',
  REELS: 'ReelsFragment',
  STORY_VIEWER: 'StoryViewerFragment',
  SEARCH: 'SearchFragment',
  ACTIVITY: 'ActivityFeedFragment',
  SETTINGS: 'SettingsFragment',
  MEDIA_VIEWER: 'MediaViewerFragment',
};

const MODULE_IDS = {
  MAIN_FEED: 'feed_timeline',
  DIRECT_INBOX: 'direct_inbox',
  DIRECT_THREAD: 'direct_thread',
  DIRECT_PENDING: 'direct_pending_inbox',
  SELF_PROFILE: 'self_profile',
  PROFILE: 'profile',
  EXPLORE: 'explore_popular',
  REELS: 'clips_viewer',
  STORY_VIEWER: 'reel_feed_timeline',
  SEARCH: 'search',
  ACTIVITY: 'news',
  SETTINGS: 'settings',
  MEDIA_VIEWER: 'feed_contextual_profile',
};

const SHORT_CODES = {
  feed_timeline: '9MV',
  direct_inbox: 'QrA',
  direct_thread: 'MpL',
  direct_pending_inbox: 'QrB',
  self_profile: '9Xf',
  profile: '8wC',
  explore_popular: '6xQ',
  clips_viewer: '9Ly',
  reel_feed_timeline: '5RE',
  search: '7GJ',
  news: '9HR',
  settings: '4Dn',
  feed_contextual_profile: '9z6',
};

const ALTERNATIVE_SHORT_CODES = {
  feed_timeline: ['MainFeedFragment', '9MV', 'cold_start'],
  direct_inbox: ['QrA', 'DirectInboxFragment', 'ig_direct'],
  direct_thread: ['MpL', 'DirectThreadFragment', 'ig_direct_thread'],
  self_profile: ['9Xf', 'SelfFragment', 'self_profile'],
  profile: ['8wC', 'ProfileFragment', 'profile'],
  explore_popular: ['6xQ', 'ExploreFragment', 'explore'],
};

class NavChainManager {
  constructor() {
    this._chain = [];
    this._stepCounter = 0;
    this._lastActionTimestamp = Date.now();
    this._sessionStarted = false;
    this._currentContext = null;
  }

  reset() {
    this._chain = [];
    this._stepCounter = 0;
    this._lastActionTimestamp = Date.now();
    this._sessionStarted = false;
    this._currentContext = null;
  }

  _pickShortCode(moduleId) {
    const alts = ALTERNATIVE_SHORT_CODES[moduleId];
    if (alts && Math.random() < 0.3) {
      return alts[Math.floor(Math.random() * alts.length)];
    }
    return SHORT_CODES[moduleId] || moduleId;
  }

  _addStep(screenOrShortCode, moduleId) {
    this._stepCounter++;
    const entry = `${screenOrShortCode}:${moduleId}:${this._stepCounter}`;
    this._chain.push(entry);
    if (this._chain.length > 8) {
      this._chain = this._chain.slice(-6);
    }
    this._lastActionTimestamp = Date.now();
    return entry;
  }

  simulateAppOpen() {
    this.reset();
    this._sessionStarted = true;

    const openVariant = Math.random();
    if (openVariant < 0.6) {
      this._addStep(this._pickShortCode('feed_timeline'), 'feed_timeline');
    } else if (openVariant < 0.85) {
      this._addStep(this._pickShortCode('feed_timeline'), 'feed_timeline');
      const delay = random(200, 800);
      this._lastActionTimestamp = Date.now() - delay;
    } else {
      this._addStep('cold_start', 'feed_timeline');
    }

    this._currentContext = 'feed';
    return this.getChainString();
  }

  navigateToInbox() {
    if (!this._sessionStarted) {
      this.simulateAppOpen();
    }
    this._addStep(this._pickShortCode('direct_inbox'), 'direct_inbox');
    this._currentContext = 'direct_inbox';
    return this.getChainString();
  }

  navigateToThread(threadId) {
    if (this._currentContext !== 'direct_inbox' && this._currentContext !== 'direct_thread') {
      this.navigateToInbox();
    }
    this._addStep(this._pickShortCode('direct_thread'), 'direct_thread');
    this._currentContext = 'direct_thread';
    return this.getChainString();
  }

  navigateToPendingInbox() {
    if (this._currentContext !== 'direct_inbox') {
      this.navigateToInbox();
    }
    this._addStep(this._pickShortCode('direct_pending_inbox'), 'direct_pending_inbox');
    this._currentContext = 'direct_pending';
    return this.getChainString();
  }

  navigateToProfile(isSelf = false) {
    if (!this._sessionStarted) {
      this.simulateAppOpen();
    }
    if (isSelf) {
      this._addStep(this._pickShortCode('self_profile'), 'self_profile');
      this._currentContext = 'self_profile';
    } else {
      this._addStep(this._pickShortCode('profile'), 'profile');
      this._currentContext = 'profile';
    }
    return this.getChainString();
  }

  navigateToExplore() {
    if (!this._sessionStarted) {
      this.simulateAppOpen();
    }
    this._addStep(this._pickShortCode('explore_popular'), 'explore_popular');
    this._currentContext = 'explore';
    return this.getChainString();
  }

  navigateToFeed() {
    if (!this._sessionStarted) {
      this.simulateAppOpen();
    } else {
      this._addStep(this._pickShortCode('feed_timeline'), 'feed_timeline');
    }
    this._currentContext = 'feed';
    return this.getChainString();
  }

  incrementForAction() {
    if (!this._sessionStarted) {
      this.simulateAppOpen();
    }
    const ctx = this._currentContext || 'feed_timeline';
    const moduleMap = {
      'feed': 'feed_timeline',
      'direct_inbox': 'direct_inbox',
      'direct_thread': 'direct_thread',
      'direct_pending': 'direct_pending_inbox',
      'self_profile': 'self_profile',
      'profile': 'profile',
      'explore': 'explore_popular',
    };
    const moduleId = moduleMap[ctx] || 'feed_timeline';
    this._addStep(this._pickShortCode(moduleId), moduleId);
    return this.getChainString();
  }

  getChainForDMBroadcast(isNewThread = false) {
    if (!this._sessionStarted) {
      this.simulateAppOpen();
    }

    if (this._currentContext !== 'direct_thread') {
      if (this._currentContext !== 'direct_inbox') {
        this.navigateToInbox();
      }
      this.navigateToThread();
    }

    this._stepCounter++;
    this._lastActionTimestamp = Date.now();
    return this.getChainString();
  }

  getChainForDMSequence(messageIndex) {
    if (messageIndex === 0 || !this._sessionStarted) {
      this.simulateAppOpen();
      this.navigateToInbox();
      this.navigateToThread();
    } else {
      this._stepCounter++;
      const lastEntry = this._chain[this._chain.length - 1];
      if (lastEntry) {
        const parts = lastEntry.split(':');
        if (parts.length === 3) {
          parts[2] = String(this._stepCounter);
          this._chain[this._chain.length - 1] = parts.join(':');
        }
      }
    }

    this._lastActionTimestamp = Date.now();
    return this.getChainString();
  }

  getChainForBulkDM(recipientIndex, totalRecipients) {
    if (recipientIndex === 0) {
      this.simulateAppOpen();
      this.navigateToInbox();
    }

    this.navigateToThread();

    this._stepCounter++;
    this._lastActionTimestamp = Date.now();

    if (recipientIndex > 0 && recipientIndex % random(3, 6) === 0) {
      this.navigateToInbox();
      this.navigateToThread();
    }

    return this.getChainString();
  }

  getChainString() {
    if (this._chain.length === 0) {
      this.simulateAppOpen();
    }
    return this._chain.join(',');
  }

  getCurrentContext() {
    return this._currentContext;
  }

  getStepCounter() {
    return this._stepCounter;
  }

  setContext(contextName) {
    this._currentContext = contextName;
    if (!this._sessionStarted) {
      this.simulateAppOpen();
    }
  }
}

NavChainManager.SCREEN_IDS = SCREEN_IDS;
NavChainManager.MODULE_IDS = MODULE_IDS;
NavChainManager.SHORT_CODES = SHORT_CODES;

module.exports = NavChainManager;
