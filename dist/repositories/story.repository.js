const Repository = require('../core/repository');
const fs = require('fs');

class StoryRepository extends Repository {
  async react(options) {
    const { storyId, reaction } = options;
    const response = await this.client.request.send({
      url: `/api/v1/media/${storyId}/story_react/`,
      method: 'POST',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        reaction_type: 'like',
        emoji: reaction || '\u2764\uFE0F',
      }),
    });
    return response.body;
  }

  async getFeed() {
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

  async getUser(userId) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/feed/user/${userId}/reel_media/`,
    });
    return response.body;
  }

  async getUserStories(userId) {
    return this.getUser(userId);
  }

  async upload(options) {
    const { imagePath, caption, mentions, links, hashtags, stickers } = options;
    const imageBuffer = fs.readFileSync(imagePath);
    const uploadId = Date.now();
    const uploadResult = await this.client.upload.photo({
      file: imageBuffer,
      uploadId,
    });

    return this.configureStory({
      uploadId: uploadResult.upload_id,
      caption,
      mentions,
      links,
      hashtags,
      stickers,
    });
  }

  async uploadVideo(options) {
    const { videoPath, caption, mentions, links, hashtags, stickers } = options;
    const videoBuffer = fs.readFileSync(videoPath);
    const uploadId = Date.now();
    const uploadResult = await this.client.upload.video({
      video: videoBuffer,
      uploadId,
      duration_ms: options.duration_ms || 15000,
      width: options.width || 720,
      height: options.height || 1280,
    });

    return this.configureStoryVideo({
      uploadId: uploadResult.upload_id,
      caption,
      mentions,
      links,
      hashtags,
      stickers,
      length: options.duration_ms || 15000,
    });
  }

  async configureStory(options = {}) {
    const { uploadId, caption, mentions, links, hashtags, stickers } = options;
    const data = {
      upload_id: uploadId,
      source_type: '4',
      configure_mode: '1',
      caption: caption || '',
      _uid: this.client.state.cookieUserId,
      _uuid: this.client.state.uuid,
    };

    if (mentions && mentions.length > 0) {
      data.reel_mentions = JSON.stringify(mentions);
    }
    if (links && links.length > 0) {
      data.story_cta = JSON.stringify(links.map(l => ({
        links: [{ webUri: l.url || l, linkType: 1 }],
      })));
    }
    if (hashtags && hashtags.length > 0) {
      data.story_hashtags = JSON.stringify(hashtags);
    }
    if (stickers && stickers.length > 0) {
      data.story_sticker_ids = JSON.stringify(stickers.map(s => s.id || s));
    }

    const response = await this.client.request.send({
      url: '/api/v1/media/configure_to_story/',
      method: 'POST',
      form: this.client.request.sign(data),
    });
    return response.body;
  }

  async configureStoryVideo(options = {}) {
    const { uploadId, caption, mentions, links, hashtags, stickers, length } = options;
    const data = {
      upload_id: uploadId,
      source_type: '4',
      configure_mode: '1',
      caption: caption || '',
      _uid: this.client.state.cookieUserId,
      _uuid: this.client.state.uuid,
      video_result: 'deprecated',
      length: length || 0,
      clips: JSON.stringify([{ length: length || 0, source_type: '4' }]),
      poster_frame_index: '0',
      audio_muted: '0',
    };

    if (mentions && mentions.length > 0) {
      data.reel_mentions = JSON.stringify(mentions);
    }
    if (links && links.length > 0) {
      data.story_cta = JSON.stringify(links.map(l => ({
        links: [{ webUri: l.url || l, linkType: 1 }],
      })));
    }
    if (hashtags && hashtags.length > 0) {
      data.story_hashtags = JSON.stringify(hashtags);
    }
    if (stickers && stickers.length > 0) {
      data.story_sticker_ids = JSON.stringify(stickers.map(s => s.id || s));
    }

    const response = await this.client.request.send({
      url: '/api/v1/media/configure_to_story/',
      method: 'POST',
      form: this.client.request.sign(data),
    });
    return response.body;
  }

  async seen(input, sourceId = null) {
    let items = [];
    if (Array.isArray(input)) {
      items = input;
    } else {
      items = Object.values(input).reduce((acc, reel) => acc.concat(reel.items || []), []);
    }

    const reels = {};
    const maxSeenAt = Math.floor(Date.now() / 1000);
    let seenAt = maxSeenAt - items.length;

    for (const item of items) {
      const itemTakenAt = item.taken_at;
      if (seenAt < itemTakenAt) seenAt = itemTakenAt + 1;
      if (seenAt > maxSeenAt) seenAt = maxSeenAt;
      const itemSourceId = sourceId === null ? item.user.pk : sourceId;
      const reelId = `${item.id}_${itemSourceId}`;
      reels[reelId] = [`${itemTakenAt}_${seenAt}`];
      seenAt += 1;
    }

    return this.client.media.seen(reels);
  }

  async getHighlights(userId) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/highlights/${userId}/highlights_tray/`,
    });
    return response.body;
  }

  async getHighlight(highlightId) {
    const ids = Array.isArray(highlightId) ? highlightId : [highlightId];
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

  async getHighlightById(highlightId) {
    return this.getHighlight(highlightId);
  }

  async viewers(storyId) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/media/${storyId}/list_reel_media_viewer/`,
    });
    return response.body;
  }

  async deleteStory(storyId) {
    return this.client.media.delete(storyId, 'STORY');
  }

  async downloadByUrl(url) {
    const axios = require('axios');
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  }

  async download(storyPk) {
    const result = await this.client.media.info(storyPk);
    const items = result.items || [result];
    const item = items[0] || result;
    if (item.video_versions && item.video_versions.length > 0) {
      return this.downloadByUrl(item.video_versions[0].url);
    }
    const candidates = item.image_versions2?.candidates || [];
    if (candidates.length > 0) {
      return this.downloadByUrl(candidates[0].url);
    }
    throw new Error('No media URL found for story');
  }

  async createHighlight(options = {}) {
    const { title, coverMediaId, mediaIds = [] } = options;
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/highlights/create_reel/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        _uid: this.client.state.cookieUserId,
        title: title || '',
        cover: JSON.stringify({ media_id: coverMediaId }),
        media_ids: JSON.stringify(mediaIds),
      }),
    });
    return response.body;
  }

  async editHighlight(highlightId, options = {}) {
    const { title, coverMediaId, addedMediaIds = [], removedMediaIds = [] } = options;
    const data = {
      _uuid: this.client.state.uuid,
      _uid: this.client.state.cookieUserId,
    };
    if (title) data.title = title;
    if (coverMediaId) data.cover = JSON.stringify({ media_id: coverMediaId });
    if (addedMediaIds.length > 0) data.added_media_ids = JSON.stringify(addedMediaIds);
    if (removedMediaIds.length > 0) data.removed_media_ids = JSON.stringify(removedMediaIds);

    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/highlights/${highlightId}/edit_reel/`,
      form: this.client.request.sign(data),
    });
    return response.body;
  }

  async deleteHighlight(highlightId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/highlights/${highlightId}/delete_reel/`,
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        _uid: this.client.state.cookieUserId,
      }),
    });
    return response.body;
  }
}

module.exports = StoryRepository;
