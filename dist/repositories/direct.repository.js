const Repository = require('../core/repository');
const fs = require('fs');

class DirectRepository extends Repository {
  constructor(client) {
    super(client);
    this.maxRetries = 3;
  }

  async requestWithRetry(requestFn, retries = 0) {
    try {
      const result = await requestFn();
      return result;
    } catch (error) {
      const shouldRetry =
        (error.data?.error_type === 'server_error' ||
         error.data?.error_type === 'rate_limited') &&
        retries < this.maxRetries;
      if (shouldRetry) {
        const delay = 1000 * (retries + 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.requestWithRetry(requestFn, retries + 1);
      }
      throw error;
    }
  }

  async send(options) {
    const { to, message } = options;
    if (!to || !message) throw new Error('Recipient (to) and message are required');

    return this.requestWithRetry(async () => {
      const user = await this.client.user.infoByUsername(to);
      const thread = await this.client.directThread.getByParticipants([user.pk]);
      return this.client.directThread.broadcast({
        threadIds: [thread.thread_id],
        item: 'text',
        form: { text: message },
      });
    });
  }

  async sendToUserId(userId, message) {
    return this.requestWithRetry(async () => {
      return this.client.directThread.broadcast({
        userIds: [userId],
        item: 'text',
        form: { text: message },
      });
    });
  }

  async sendImage(options) {
    const { to, imagePath } = options;
    if (!to || !imagePath) throw new Error('Recipient (to) and imagePath are required');

    return this.requestWithRetry(async () => {
      const imageBuffer = fs.readFileSync(imagePath);
      const uploadResult = await this.client.upload.photo({ file: imageBuffer, uploadId: Date.now() });
      const user = await this.client.user.infoByUsername(to);
      const thread = await this.client.directThread.getByParticipants([user.pk]);
      return this.client.directThread.broadcast({
        threadIds: [thread.thread_id],
        item: 'configure_photo',
        form: { upload_id: uploadResult.upload_id, allow_full_aspect_ratio: true },
      });
    });
  }

  async sendVideo(options) {
    const { to, videoPath } = options;
    if (!to || !videoPath) throw new Error('Recipient (to) and videoPath are required');

    return this.requestWithRetry(async () => {
      const videoBuffer = fs.readFileSync(videoPath);
      const uploadResult = await this.client.upload.video({ video: videoBuffer, uploadId: Date.now() });
      const user = await this.client.user.infoByUsername(to);
      const thread = await this.client.directThread.getByParticipants([user.pk]);
      return this.client.directThread.broadcast({
        threadIds: [thread.thread_id],
        item: 'configure_video',
        form: { upload_id: uploadResult.upload_id, video_result: 'deprecated' },
      });
    });
  }

  async sendLink(options) {
    const { to, text, urls } = options;
    return this.requestWithRetry(async () => {
      const user = await this.client.user.infoByUsername(to);
      const thread = await this.client.directThread.getByParticipants([user.pk]);
      return this.client.directThread.broadcast({
        threadIds: [thread.thread_id],
        item: 'link',
        form: {
          link_text: text || '',
          link_urls: JSON.stringify(urls || []),
        },
      });
    });
  }

  async sendMediaShare(options) {
    const { to, mediaId } = options;
    return this.requestWithRetry(async () => {
      const user = await this.client.user.infoByUsername(to);
      const thread = await this.client.directThread.getByParticipants([user.pk]);
      return this.client.directThread.broadcast({
        threadIds: [thread.thread_id],
        item: 'media_share',
        form: { media_id: mediaId },
      });
    });
  }

  async sendProfile(options) {
    const { to, profileUserId } = options;
    return this.requestWithRetry(async () => {
      const user = await this.client.user.infoByUsername(to);
      const thread = await this.client.directThread.getByParticipants([user.pk]);
      return this.client.directThread.broadcast({
        threadIds: [thread.thread_id],
        item: 'profile',
        form: { profile_user_id: profileUserId },
      });
    });
  }

  async sendHashtag(options) {
    const { to, hashtag, text } = options;
    return this.requestWithRetry(async () => {
      const user = await this.client.user.infoByUsername(to);
      const thread = await this.client.directThread.getByParticipants([user.pk]);
      return this.client.directThread.broadcast({
        threadIds: [thread.thread_id],
        item: 'hashtag',
        form: {
          hashtag,
          text: text || '',
        },
      });
    });
  }

  async sendLocation(options) {
    const { to, locationId, text } = options;
    return this.requestWithRetry(async () => {
      const user = await this.client.user.infoByUsername(to);
      const thread = await this.client.directThread.getByParticipants([user.pk]);
      return this.client.directThread.broadcast({
        threadIds: [thread.thread_id],
        item: 'location',
        form: {
          venue_id: locationId,
          text: text || '',
        },
      });
    });
  }

  async getInbox(cursor = null, limit = 20) {
    return this.requestWithRetry(async () => {
      const qs = { persistentBadging: true, limit };
      if (cursor) qs.cursor = cursor;
      const response = await this.client.request.send({ method: 'GET', url: '/api/v1/direct_v2/inbox/', qs });
      return response.body;
    });
  }

  async getPendingInbox(cursor = null) {
    return this.requestWithRetry(async () => {
      const qs = cursor ? { cursor } : {};
      const response = await this.client.request.send({ method: 'GET', url: '/api/v1/direct_v2/pending_inbox/', qs });
      return response.body;
    });
  }

  async createGroupThread(recipientUsers, threadTitle) {
    if (!Array.isArray(recipientUsers) || !threadTitle) throw new Error('recipientUsers must be array and threadTitle required');

    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/direct_v2/create_group_thread/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          _uid: this.client.state.cookieUserId,
          recipient_users: JSON.stringify(recipientUsers),
          thread_title: threadTitle,
        }),
      });
      return response.body;
    });
  }

  async rankedRecipients(mode = 'raven', query = '') {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'GET',
        url: '/api/v1/direct_v2/ranked_recipients/',
        qs: { mode, query, show_threads: true },
      });
      return response.body;
    });
  }

  async getPresence() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({ method: 'GET', url: '/api/v1/direct_v2/get_presence/' });
      return response.body;
    });
  }

  async markAsSeen(threadId, itemId) {
    return this.client.directThread.markItemSeen(threadId, itemId);
  }

  async hideThread(threadId) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: `/api/v1/direct_v2/threads/${threadId}/hide/`,
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
        }),
      });
      return response.body;
    });
  }
}

module.exports = DirectRepository;
