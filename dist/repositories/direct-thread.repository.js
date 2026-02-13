const Repository = require('../core/repository');
const Chance = require('chance');

class DirectThreadRepository extends Repository {
  constructor(client) {
    super(client);
    this.maxRetries = 3; // default max retries for requests
  }

  /**
   * Generic request wrapper with retry and debug logging
   * @param {Function} requestFn - async function performing request
   * @param {number} retries - current retry count
   */
  async requestWithRetry(requestFn, retries = 0) {
    try {
      if (process.env.DEBUG) console.log(`[DEBUG] Attempt #${retries + 1}`);
      const result = await requestFn();
      return result;
    } catch (error) {
      const shouldRetry =
        (error.data?.error_type === 'server_error' ||
         error.data?.error_type === 'rate_limited' ||
         error.name === 'IgActionSpamError' ||
         error.status === 503 ||
         error.status === 429) &&
        retries < this.maxRetries;

      if (shouldRetry) {
        const delay = 1000 * (retries + 1);
        if (process.env.DEBUG) console.log(`[DEBUG] Retrying after ${delay}ms due to ${error.data?.error_type || error.message || error.name || error.status}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.requestWithRetry(requestFn, retries + 1);
      }

      throw error;
    }
  }

  /**
   * Send a text message to a group thread
   * @param {Object} options - { threadId, message }
   */
  async sendToGroup(options) {
    const { threadId, message } = options;
    if (!threadId || !message) throw new Error('threadId and message are required');

    return this.broadcast({
      threadIds: [threadId],
      item: 'text',
      form: { text: message },
    });
  }

  /**
   * Fetch a specific thread by its ID
   * @param {string} threadId
   */
  async getThread(threadId) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'GET',
        url: `/api/v1/direct_v2/threads/${threadId}/`,
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Fetch threads by participants
   * @param {Array} recipientUsers
   */
  async getByParticipants(recipientUsers) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'GET',
        url: '/api/v1/direct_v2/threads/get_by_participants/',
        qs: { recipient_users: JSON.stringify(recipientUsers) },
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Broadcast a message to multiple threads or users
   */
  async broadcast(options) {
    const mutationToken = new Chance().guid();
    const recipients = options.threadIds || options.userIds;
    const recipientsType = options.threadIds ? 'thread_ids' : 'recipient_users';
    const recipientsIds = Array.isArray(recipients) ? recipients : [recipients];
    const recipientsValue = recipientsType === 'thread_ids'
      ? JSON.stringify(recipientsIds)
      : JSON.stringify([recipientsIds]);

    const form = {
      action: 'send_item',
      [recipientsType]: recipientsValue,
      client_context: mutationToken,
      _csrftoken: this.client.state.cookieCsrfToken,
      device_id: this.client.state.deviceId,
      mutation_token: mutationToken,
      _uuid: this.client.state.uuid,
      ...options.form,
    };

    return this.requestWithRetry(async () => {
      const payloadForm = options.signed && this.client.request && typeof this.client.request.sign === 'function'
        ? this.client.request.sign(form)
        : form;

      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/broadcast/${options.item}/`,
        method: 'POST',
        form: payloadForm,
        qs: options.qs,
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Broadcast a photo to one or more threads (uses REST configure_photo)
   * Options:
   *  - uploadId (required) : upload_id returned from rupload
   *  - threadIds or threadId (required) : target thread id(s)
   *  - caption (optional) : caption/text to attach
   *  - signed (optional, default true) : whether to sign the form (if client.request.sign available)
   */
  async broadcastPhoto(options) {
    // normalize inputs
    const uploadId = options.uploadId || options.upload_id || options.uploadIdStr;
    const threadIds = options.threadIds || (options.threadId ? [options.threadId] : []);
    const caption = options.caption || options.text || '';
    const signed = (options.signed === undefined) ? true : !!options.signed; // default to true for media
    const mutationToken = new Chance().guid();
    const clientContext = mutationToken;

    if (!uploadId) throw new Error('broadcastPhoto: uploadId is required');
    if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) throw new Error('broadcastPhoto: at least one threadId is required');

    const form = {
      action: 'send_item',
      upload_id: uploadId.toString(),
      thread_ids: JSON.stringify(threadIds),
      client_context: clientContext,
      _csrftoken: this.client.state.cookieCsrfToken,
      mutation_token: mutationToken,
      offline_threading_id: clientContext,
      device_id: this.client.state.deviceId,
      _uuid: this.client.state.uuid,
    };

    if (caption) {
      // Instagram often expects 'text' for the message body
      form.text = caption;
    }

    // perform request with retry wrapper
    return this.requestWithRetry(async () => {
      const payloadForm = (signed && this.client.request && typeof this.client.request.sign === 'function')
        ? this.client.request.sign(form)
        : form;

      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/broadcast/configure_photo/`,
        method: 'POST',
        form: payloadForm,
        qs: {
          use_unified_inbox: true,
        },
      });

      // normalize: some wrappers return { body } or axios response
      const body = response && (response.body || response.data || response);

      if (!body) {
        const err = new Error('broadcastPhoto: empty response');
        throw err;
      }

      // parse if string
      let parsed = null;
      if (typeof body === 'string') {
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          parsed = null;
        }
      } else if (typeof body === 'object') {
        parsed = body;
      }

      // Typical success: parsed.status === 'ok' OR parsed.media/parsed.result/payload present
      const ok = parsed && (parsed.status === 'ok' || parsed.media || parsed.result || parsed.payload || parsed.items || parsed.thread);
      if (ok) return parsed;

      // If we reach here, treat as error to trigger retry logic
      const error = new Error('broadcastPhoto: Request failed');
      error.response = response;
      if (parsed) error.data = parsed;
      throw error;
    });
  }

  /**
   * Broadcast a raven (view-once/ephemeral) attachment to one or more threads via REST.
   * Uses endpoint: /api/v1/direct_v2/threads/broadcast/raven_attachment/
   *
   * Options:
   *  - uploadId (required): upload_id from rupload
   *  - threadIds or threadId (required): target thread id(s)
   *  - ephemeralMediaViewMode (optional, default 0): 0 = view-once, 1 = replayable
   *  - mediaType (optional, default 1): 1 = photo, 2 = video
   *  - signed (optional, default true): whether to sign the form
   */
  async broadcastRaven(options) {
    const uploadId = options.uploadId || options.upload_id;
    const threadIds = options.threadIds || (options.threadId ? [options.threadId] : []);
    const viewMode = (options.ephemeralMediaViewMode !== undefined) ? options.ephemeralMediaViewMode : 0;
    const signed = (options.signed === undefined) ? true : !!options.signed;
    const mutationToken = new Chance().guid();
    const clientContext = mutationToken;

    if (!uploadId) throw new Error('broadcastRaven: uploadId is required');
    if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) throw new Error('broadcastRaven: at least one threadId is required');

    const form = {
      action: 'send_item',
      upload_id: uploadId.toString(),
      thread_ids: JSON.stringify(threadIds.map(String)),
      client_context: clientContext,
      _csrftoken: this.client.state.cookieCsrfToken,
      mutation_token: mutationToken,
      offline_threading_id: clientContext,
      device_id: this.client.state.deviceId,
      _uuid: this.client.state.uuid,
      ephemeral_media_view_mode: String(viewMode),
    };

    return this.requestWithRetry(async () => {
      const payloadForm = (signed && this.client.request && typeof this.client.request.sign === 'function')
        ? this.client.request.sign(form)
        : form;

      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/broadcast/raven_attachment/`,
        method: 'POST',
        form: payloadForm,
        qs: {
          use_unified_inbox: true,
        },
      });

      const body = response && (response.body || response.data || response);
      if (!body) {
        throw new Error('broadcastRaven: empty response');
      }

      let parsed = null;
      if (typeof body === 'string') {
        try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
      } else if (typeof body === 'object') {
        parsed = body;
      }

      const ok = parsed && (parsed.status === 'ok' || parsed.media || parsed.result || parsed.payload || parsed.items || parsed.thread);
      if (ok) return parsed;

      const error = new Error('broadcastRaven: Request failed');
      error.response = response;
      if (parsed) error.data = parsed;
      throw error;
    });
  }

  /**
   * Mark a specific item in a thread as seen
   */
  async markItemSeen(threadId, threadItemId) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/${threadId}/items/${threadItemId}/seen/`,
        method: 'POST',
        form: {
          _uuid: this.client.state.uuid,
          use_unified_inbox: true,
          action: 'mark_seen',
          thread_id: threadId,
          item_id: threadItemId,
        },
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Delete an item from a thread
   */
  async deleteItem(threadId, itemId) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/${threadId}/items/${itemId}/delete/`,
        method: 'POST',
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Approve a pending thread
   */
  async approve(threadId) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/${threadId}/approve/`,
        method: 'POST',
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Decline a pending thread
   */
  async decline(threadId) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/${threadId}/decline/`,
        method: 'POST',
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Mute a thread
   */
  async mute(threadId) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/${threadId}/mute/`,
        method: 'POST',
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Unmute a thread
   */
  async unmute(threadId) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/${threadId}/unmute/`,
        method: 'POST',
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Add users to a thread
   */
  async addUser(threadId, userIds) {
    if (!Array.isArray(userIds)) throw new Error('userIds must be an array');
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/${threadId}/add_user/`,
        method: 'POST',
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Leave a thread
   */
  async leave(threadId) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/${threadId}/leave/`,
        method: 'POST',
      });
      return response.body || response.data || response;
    });
  }

  /**
   * Update thread title
   */
  async updateTitle(threadId, title) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: `/api/v1/direct_v2/threads/${threadId}/update_title/`,
        method: 'POST',
      });
      return response.body || response.data || response;
    });
  }
}

module.exports = DirectThreadRepository;

