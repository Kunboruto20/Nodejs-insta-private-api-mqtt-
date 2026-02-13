const Repository = require('../core/repository');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

class MediaRepository extends Repository {
  async info(mediaId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/info/`,
      method: 'GET',
    });
    return response.body;
  }

  async like(mediaId, moduleInfo = { module_name: 'feed_timeline' }) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/like/`,
      method: 'POST',
      form: this.client.request.sign({
        media_id: mediaId,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        radio_type: this.client.state.radioType,
        module_name: moduleInfo.module_name,
      }),
    });
    return response.body;
  }

  async unlike(mediaId, moduleInfo = { module_name: 'feed_timeline' }) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/unlike/`,
      method: 'POST',
      form: this.client.request.sign({
        media_id: mediaId,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        radio_type: this.client.state.radioType,
        module_name: moduleInfo.module_name,
      }),
    });
    return response.body;
  }

  async comment(mediaId, commentText) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/comment/`,
      method: 'POST',
      form: this.client.request.sign({
        media_id: mediaId,
        comment_text: commentText,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        radio_type: this.client.state.radioType,
        module_name: 'feed_timeline',
      }),
    });
    return response.body;
  }

  async deleteComment(mediaId, commentId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/comment/${commentId}/delete/`,
      method: 'POST',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async delete(mediaId, mediaType = 'PHOTO') {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/delete/`,
      method: 'POST',
      qs: { media_type: mediaType },
      form: this.client.request.sign({
        igtv_feed_preview: false,
        media_id: mediaId,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async edit(mediaId, captionText, options = {}) {
    const { usertags, location } = options;
    const data = {
      igtv_feed_preview: false,
      media_id: mediaId,
      _uid: this.client.state.cookieUserId,
      _uuid: this.client.state.uuid,
      caption_text: captionText,
    };
    if (usertags) data.usertags = JSON.stringify({ in: usertags });
    if (location) {
      data.location = JSON.stringify(location);
    }
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/edit_media/`,
      method: 'POST',
      form: this.client.request.sign(data),
    });
    return response.body;
  }

  async seen(reels) {
    const response = await this.client.request.send({
      url: '/api/v1/media/seen/',
      method: 'POST',
      form: this.client.request.sign({
        reels: JSON.stringify(reels),
        live_vods: JSON.stringify([]),
        nf_token: '',
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        container_module: 'feed_short_url',
      }),
    });
    return response.body;
  }

  async likers(mediaId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/likers/`,
      method: 'GET',
    });
    return response.body;
  }

  async comments(mediaId, maxId = null, amount = 20) {
    const allComments = [];
    let nextMaxId = maxId;
    while (allComments.length < amount) {
      const qs = {};
      if (nextMaxId) qs.max_id = nextMaxId;
      const response = await this.client.request.send({
        url: `/api/v1/media/${mediaId}/comments/`,
        method: 'GET',
        qs,
      });
      const body = response.body;
      allComments.push(...(body.comments || []));
      if (!body.has_more_comments || !body.next_max_id) break;
      nextMaxId = body.next_max_id;
    }
    return allComments.slice(0, amount);
  }

  async replyToComment(mediaId, commentId, replyText) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/comment/`,
      method: 'POST',
      form: this.client.request.sign({
        media_id: mediaId,
        comment_text: replyText,
        replied_to_comment_id: commentId,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        radio_type: this.client.state.radioType,
      }),
    });
    return response.body;
  }

  async likeComment(mediaId, commentId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/comment/${commentId}/comment_like/`,
      method: 'POST',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async unlikeComment(mediaId, commentId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/comment/${commentId}/comment_unlike/`,
      method: 'POST',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async pinComment(mediaId, commentId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/comment/${commentId}/pin_comment/`,
      method: 'POST',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async unpinComment(mediaId, commentId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/comment/${commentId}/unpin_comment/`,
      method: 'POST',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async bulkDeleteComments(mediaId, commentIds) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/comment/bulk_delete/`,
      method: 'POST',
      form: this.client.request.sign({
        comment_ids_to_delete: Array.isArray(commentIds) ? commentIds.join(',') : commentIds,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async save(mediaId, collectionId = null) {
    const form = {
      _uid: this.client.state.cookieUserId,
      _uuid: this.client.state.uuid,
    };
    if (collectionId) form.added_collection_ids = JSON.stringify([collectionId]);
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/save/`,
      method: 'POST',
      form: this.client.request.sign(form),
    });
    return response.body;
  }

  async unsave(mediaId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/unsave/`,
      method: 'POST',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async archive(mediaId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/only_me/`,
      method: 'POST',
      form: this.client.request.sign({
        media_id: mediaId,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async unarchive(mediaId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/undo_only_me/`,
      method: 'POST',
      form: this.client.request.sign({
        media_id: mediaId,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async disableComments(mediaId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/disable_comments/`,
      method: 'POST',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async enableComments(mediaId) {
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/enable_comments/`,
      method: 'POST',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async commentThreadComments(mediaId, commentId, maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      url: `/api/v1/media/${mediaId}/comments/${commentId}/inline_child_comments/`,
      method: 'GET',
      qs,
    });
    return response.body;
  }

  async oembed(url) {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/oembed/',
      qs: { url },
    });
    return response.body;
  }

  async downloadByUrl(url) {
    const axios = require('axios');
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  }

  async downloadPhoto(mediaPk) {
    const result = await this.info(mediaPk);
    const items = result.items || [result];
    const item = items[0] || result;
    const candidates = item.image_versions2?.candidates || [];
    if (!candidates.length) throw new Error('No image candidates found');
    return this.downloadByUrl(candidates[0].url);
  }

  async downloadVideo(mediaPk) {
    const result = await this.info(mediaPk);
    const items = result.items || [result];
    const item = items[0] || result;
    const videoVersions = item.video_versions || [];
    if (!videoVersions.length) throw new Error('No video versions found');
    return this.downloadByUrl(videoVersions[0].url);
  }

  static mediaPkFromCode(code) {
    let pk = BigInt(0);
    for (let i = 0; i < Math.min(code.length, 11); i++) {
      const idx = ALPHABET.indexOf(code[i]);
      if (idx === -1) continue;
      pk = pk * BigInt(64) + BigInt(idx);
    }
    return pk.toString();
  }

  static mediaCodeFromPk(pk) {
    let id = BigInt(pk);
    let code = '';
    while (id > BigInt(0)) {
      const remainder = Number(id % BigInt(64));
      code = ALPHABET[remainder] + code;
      id = id / BigInt(64);
    }
    return code;
  }

  static mediaPkFromUrl(url) {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(p => p.length > 0);
      const code = parts[parts.length - 1];
      return MediaRepository.mediaPkFromCode(code.substring(0, 11));
    } catch {
      return null;
    }
  }

  mediaId(mediaPk, userId) {
    return `${mediaPk}_${userId}`;
  }

  mediaPk(mediaId) {
    return String(mediaId).split('_')[0];
  }

  async getUser(mediaPk) {
    const result = await this.info(mediaPk);
    const items = result.items || [result];
    return (items[0] || result).user;
  }
}

module.exports = MediaRepository;
