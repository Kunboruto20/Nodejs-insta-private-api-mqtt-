const Repository = require('../core/repository');
const fs = require('fs');

class FeedRepository extends Repository {
  async upload(options) {
    const { imagePath, caption, usertags, location } = options;
    const imageBuffer = fs.readFileSync(imagePath);
    const uploadResult = await this.client.upload.photo({
      file: imageBuffer,
      uploadId: Date.now()
    });
    return this.client.upload.configurePhoto({
      uploadId: uploadResult.upload_id,
      caption: caption || '',
      source_type: '4',
      usertags,
      location,
    });
  }

  async uploadVideo(options) {
    const { videoPath, caption, usertags, location } = options;
    const videoBuffer = fs.readFileSync(videoPath);
    const uploadResult = await this.client.upload.video({
      video: videoBuffer,
      uploadId: Date.now(),
      duration_ms: options.duration_ms || 15000,
      width: options.width || 720,
      height: options.height || 1280,
    });
    return this.client.upload.configureVideo({
      uploadId: uploadResult.upload_id,
      caption: caption || '',
      source_type: '4',
      length: options.duration_ms || 15000,
      usertags,
      location,
    });
  }

  async getFeed(maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/feed/timeline/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        is_prefetch: '0',
        feed_view_info: '[]',
        seen_posts: '',
        phone_id: this.client.state.phoneId,
        battery_level: String(Math.floor(Math.random() * 50) + 50),
        timezone_offset: String(this.client.state.timezoneOffset),
        max_id: maxId || '',
      }),
    });
    return response.body;
  }

  async getUserFeed(userId, maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/feed/user/${userId}/`,
      qs
    });
    return response.body;
  }

  async getUserStoryFeed(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/feed/user/${userId}/story/`,
      form: {
        supported_capabilities_new: JSON.stringify(this.client.state.constants.SUPPORTED_CAPABILITIES),
      },
    });
    return response.body;
  }

  async getTag(tag, maxId = null) {
    const qs = { rank_token: this.client.state.uuid };
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/feed/tag/${tag}/`,
      qs
    });
    return response.body;
  }

  async getLiked(maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/feed/liked/',
      qs
    });
    return response.body;
  }

  async getSaved(maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/feed/saved/',
      qs
    });
    return response.body;
  }

  async getLocation(locationId, maxId = null) {
    const qs = { rank_token: this.client.state.uuid };
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/feed/location/${locationId}/`,
      qs
    });
    return response.body;
  }

  async getExploreFeed(maxId = null) {
    const qs = {
      is_prefetch: false,
      is_from_promote: false,
      timezone_offset: this.client.state.timezoneOffset,
      session_id: this.client.state.clientSessionId,
    };
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/discover/explore/',
      qs
    });
    return response.body;
  }

  async getReelsFeed(maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/clips/browse/',
      form: qs,
    });
    return response.body;
  }

  async getUserReelsFeed(userId, maxId = null) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/clips/user/',
      form: {
        target_user_id: userId,
        page_size: '12',
        max_id: maxId || '',
      },
    });
    return response.body;
  }

  async uploadCarousel(options) {
    const { items, caption, usertags, location } = options;
    const uploadIds = [];

    for (const item of items) {
      if (item.type === 'photo') {
        const imageBuffer = fs.readFileSync(item.path);
        const uploadResult = await this.client.upload.photo({
          file: imageBuffer,
          uploadId: Date.now() + Math.random() * 1000,
          for_album: true,
        });
        uploadIds.push({
          upload_id: uploadResult.upload_id,
          source_type: '4',
        });
      } else if (item.type === 'video') {
        const videoBuffer = fs.readFileSync(item.path);
        const uploadResult = await this.client.upload.video({
          video: videoBuffer,
          uploadId: Date.now() + Math.random() * 1000,
          duration_ms: item.duration_ms || 15000,
          width: item.width || 720,
          height: item.height || 1280,
          for_album: true,
        });
        uploadIds.push({
          upload_id: uploadResult.upload_id,
          source_type: '4',
        });
      }
    }

    const data = {
      caption: caption || '',
      client_sidecar_id: String(Date.now()),
      children_metadata: uploadIds,
      _uid: this.client.state.cookieUserId,
      _uuid: this.client.state.uuid,
    };
    if (usertags) data.usertags = JSON.stringify({ in: usertags });
    if (location) data.location = JSON.stringify(location);

    const response = await this.client.request.send({
      url: '/api/v1/media/configure_sidecar/',
      method: 'POST',
      form: this.client.request.sign(data),
    });
    return response.body;
  }

  async reelsMedia(userIds) {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/feed/reels_media/',
      form: this.client.request.sign({
        user_ids: ids,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async reelsTray() {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/feed/reels_tray/',
      form: this.client.request.sign({
        supported_capabilities_new: JSON.stringify(this.client.state.constants.SUPPORTED_CAPABILITIES),
        reason: 'pull_to_refresh',
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }
}

module.exports = FeedRepository;
