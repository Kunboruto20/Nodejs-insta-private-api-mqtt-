const debug = require('debug')('ig:reconnect');

class ReconnectManager {
  constructor(options = {}) {
    this.initialDelay = options.initialDelay || 3000;
    this.maxDelay = options.maxDelay || 300000;
    this.multiplier = options.multiplier || 2;
    this.maxAttempts = options.maxAttempts || 0;
    
    this.currentAttempt = 0;
    this.currentDelay = this.initialDelay;
    this.timerId = null;
    this.lastErrorType = null;
  }

  getNextDelay(errorType) {
    this.lastErrorType = errorType || this.lastErrorType;

    if (this.currentAttempt === 0) {
      this.currentDelay = this.initialDelay;
    } else {
      let multiplier = this.multiplier;
      if (this.lastErrorType === 'rate_limit') {
        multiplier = 3;
      } else if (this.lastErrorType === 'auth_failure') {
        multiplier = 2.5;
      }
      this.currentDelay = Math.min(
        this.currentDelay * multiplier,
        this.maxDelay
      );
    }

    const jitter = Math.floor(Math.random() * Math.min(this.currentDelay * 0.3, 10000));
    this.currentAttempt++;
    
    const totalDelay = this.currentDelay + jitter;
    debug(`Reconnect attempt #${this.currentAttempt}, type: ${this.lastErrorType || 'unknown'}, delay: ${totalDelay}ms`);
    
    return totalDelay;
  }

  scheduleReconnect(callback, errorType) {
    if (this.maxAttempts > 0 && this.currentAttempt >= this.maxAttempts) {
      debug('[RECONNECT] Max reconnection attempts reached');
      return false;
    }

    const delay = this.getNextDelay(errorType);
    
    this.timerId = setTimeout(() => {
      debug(`[RECONNECT] Reconnecting... (attempt ${this.currentAttempt}, type: ${this.lastErrorType || 'unknown'})`);
      callback();
    }, delay);

    return true;
  }

  reset() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.currentAttempt = 0;
    this.currentDelay = this.initialDelay;
    this.lastErrorType = null;
    debug('[RECONNECT] Manager reset');
  }

  cancel() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  getState() {
    return {
      currentAttempt: this.currentAttempt,
      currentDelay: this.currentDelay,
      maxAttempts: this.maxAttempts,
      pending: !!this.timerId,
      lastErrorType: this.lastErrorType
    };
  }
}

module.exports = ReconnectManager;
