const Repository = require('../core/repository');

class ClipRepository extends Repository {
  async upload(options = {}) {
    const {
      videoPath,
      thumbnailPath,
      caption = '',
      uploadId = null,
      usertags = [],
      location = null,
      audio = null,
      shareToFeed = true,
      extraData = {},
    } = options;

    const actualUploadId = uploadId || String(Date.now());

    const uploadResult = await this.client.upload.video(videoPath, {
      uploadId: actualUploadId,
      isClip: true,
      thumbnail: thumbnailPath,
    });

    return this.configure({
      uploadId: actualUploadId,
      caption,
      usertags,
      location,
      audio,
      shareToFeed,
      ...extraData,
      width: uploadResult.width,
      height: uploadResult.height,
      duration: uploadResult.duration,
    });
  }

  async configure(options = {}) {
    const {
      uploadId,
      caption = '',
      usertags = [],
      location = null,
      audio = null,
      shareToFeed = true,
      width = 1080,
      height = 1920,
      duration = 0,
    } = options;

    const data = {
      _uuid: this.client.state.uuid,
      upload_id: uploadId,
      caption,
      source_type: '4',
      clips_share_preview_to_feed: shareToFeed ? '1' : '0',
      device: {
        manufacturer: 'samsung',
        model: 'SM-S928B',
        android_version: 35,
        android_release: '15',
      },
      extra: JSON.stringify({ source_width: width, source_height: height }),
      length: duration,
      poster_frame_index: '0',
      audio_muted: '0',
      filter_type: '0',
      video_result: '',
      clips_creation_entry_point: 'clips',
      media_folder: 'Camera',
      camera_position: 'unknown',
    };

    if (usertags.length > 0) {
      data.usertags = JSON.stringify({ in: usertags });
    }
    if (location) {
      data.location = JSON.stringify(location);
      data.media_latitude = String(location.lat || '');
      data.media_longitude = String(location.lng || '');
    }
    if (audio) {
      data.clips_audio = JSON.stringify(audio);
    }

    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/media/configure_to_clips/',
      form: this.client.request.sign(data),
    });
    return response.body;
  }

  async downloadByUrl(url) {
    const axios = require('axios');
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  }

  async download(mediaPk) {
    const info = await this.client.media.info(mediaPk);
    const items = info.items || [info];
    const item = items[0] || info;
    const videoVersions = item.video_versions || [];
    if (videoVersions.length === 0) throw new Error('No video versions found');
    return this.downloadByUrl(videoVersions[0].url);
  }

  async connectedReels(amount = 10, maxId = '') {
    const items = [];
    let nextMaxId = maxId;
    while (items.length < amount) {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/clips/connected/',
        form: { max_id: nextMaxId },
      });
      const body = response.body;
      for (const item of (body.items || [])) {
        items.push(item.media || item);
      }
      const pagingInfo = body.paging_info || {};
      if (!pagingInfo.more_available) break;
      nextMaxId = pagingInfo.max_id || '';
    }
    return items.slice(0, amount);
  }

  async discoverReels(amount = 10, maxId = '') {
    const items = [];
    let nextMaxId = maxId;
    while (items.length < amount) {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/clips/discover/',
        form: { max_id: nextMaxId },
      });
      const body = response.body;
      for (const item of (body.items || [])) {
        items.push(item.media || item);
      }
      const pagingInfo = body.paging_info || {};
      if (!pagingInfo.more_available) break;
      nextMaxId = pagingInfo.max_id || '';
    }
    return items.slice(0, amount);
  }

  async musicInfo(data = {}) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/clips/music/',
      form: {
        tab_type: 'clips',
        referrer_media_id: '',
        _uuid: this.client.state.uuid,
        ...data,
      },
    });
    return response.body;
  }
}

module.exports = ClipRepository;
