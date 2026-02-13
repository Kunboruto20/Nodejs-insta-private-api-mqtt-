const Repository = require('../core/repository');
const Chance = require('chance');
const { random } = require('lodash');
const FormData = require('form-data');

class UploadRepository extends Repository {
  constructor(client) {
    super(client);
    this.chance = new Chance();
  }

  async photo(options) {
    const uploadId = options.uploadId || Date.now();
    const name = `${uploadId}_0_${random(1000000000, 9999999999)}`;
    const waterfallId = options.waterfallId || this.chance.guid();

    const ruploadParams = this.createPhotoRuploadParams(options, uploadId);

    const response = await this.client.request.send({
      url: `/rupload_igphoto/${name}`,
      method: 'POST',
      headers: {
        'X_FB_PHOTO_WATERFALL_ID': waterfallId,
        'X-Entity-Type': 'image/jpeg',
        'Offset': '0',
        'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
        'X-Entity-Name': name,
        'X-Entity-Length': options.file.length.toString(),
        'Content-Type': 'application/octet-stream',
        'Content-Length': options.file.length.toString(),
        'Accept-Encoding': 'gzip',
      },
      body: options.file,
    });

    return response.body;
  }

  async video(options) {
    const uploadId = options.uploadId || Date.now();
    const name = options.uploadName || `${uploadId}_0_${random(1000000000, 9999999999)}`;
    const waterfallId = options.waterfallId || this.chance.guid();

    const ruploadParams = this.createVideoRuploadParams(options, uploadId);

    const response = await this.client.request.send({
      url: `/rupload_igvideo/${name}`,
      method: 'POST',
      headers: {
        'X_FB_VIDEO_WATERFALL_ID': waterfallId,
        'X-Entity-Type': 'video/mp4',
        'Offset': options.offset || '0',
        'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
        'X-Entity-Name': name,
        'X-Entity-Length': options.video.length.toString(),
        'Content-Type': 'application/octet-stream',
        'Content-Length': options.video.length.toString(),
        'Accept-Encoding': 'gzip',
      },
      body: options.video,
    });

    return response.body;
  }

  createPhotoRuploadParams(options, uploadId) {
    const params = {
      retry_context: JSON.stringify({
        num_step_auto_retry: 0,
        num_reupload: 0,
        num_step_manual_retry: 0,
      }),
      media_type: '1',
      xsharing_user_ids: JSON.stringify([]),
      upload_id: uploadId.toString(),
      image_compression: JSON.stringify({
        lib_name: 'moz',
        lib_version: '3.1.m',
        quality: '80',
      }),
    };
    if (options.for_album) params.is_sidecar = '1';
    if (options.isClip) params.is_clips_video = '1';
    return params;
  }

  createVideoRuploadParams(options, uploadId) {
    const params = {
      retry_context: JSON.stringify({
        num_step_auto_retry: 0,
        num_reupload: 0,
        num_step_manual_retry: 0,
      }),
      media_type: '2',
      xsharing_user_ids: JSON.stringify([]),
      upload_id: uploadId.toString(),
      upload_media_duration_ms: options.duration_ms || '0',
      upload_media_width: options.width || '720',
      upload_media_height: options.height || '1280',
    };
    if (options.for_album) params.is_sidecar = '1';
    if (options.isClip) {
      params.is_clips_video = '1';
      params.clips_uses_original_audio = '1';
    }
    return params;
  }

  async configure(options) {
    const basePayload = {
      upload_id: options.uploadId,
      source_type: options.source_type || '4',
      camera_position: options.camera_position || 'back',
      _uid: this.client.state.cookieUserId,
      _uuid: this.client.state.uuid,
      creation_logger_session_id: this.chance.guid(),
      device: {
        manufacturer: this.client.state.devicePayload?.manufacturer || 'samsung',
        model: this.client.state.devicePayload?.model || 'SM-S928B',
        android_version: this.client.state.devicePayload?.android_version || 35,
        android_release: this.client.state.devicePayload?.android_release || '15',
      },
      length: options.length || 0,
      audio_muted: options.audio_muted || false,
      poster_frame_index: options.poster_frame_index || 0,
      filter_type: options.filter_type || '0',
      video_result: options.video_result || '',
      composition_id: this.chance.guid(),
      clips: options.clips || [
        {
          length: options.length || 0,
          source_type: '4',
          camera_position: 'back',
        },
      ],
    };

    if (options.caption) basePayload.caption = options.caption;
    if (options.configure_mode) basePayload.configure_mode = options.configure_mode;
    if (options.location) basePayload.location = JSON.stringify(options.location);
    if (options.usertags) basePayload.usertags = JSON.stringify({ in: options.usertags });

    const response = await this.client.request.send({
      url: '/api/v1/media/configure/',
      method: 'POST',
      form: this.client.request.sign(basePayload),
    });

    return response.body;
  }

  async configureVideo(options) {
    return this.configure({
      ...options,
      video_result: 'deprecated',
    });
  }

  async configurePhoto(options) {
    return this.configure({
      ...options,
      source_type: '4',
    });
  }

  async configureToStory(options) {
    return this.configure({
      ...options,
      configure_mode: 1,
    });
  }

  async configureToClips(options) {
    const data = {
      upload_id: options.uploadId,
      source_type: '4',
      _uid: this.client.state.cookieUserId,
      _uuid: this.client.state.uuid,
      caption: options.caption || '',
      clips_share_preview_to_feed: options.shareToFeed ? '1' : '0',
      device: {
        manufacturer: 'samsung',
        model: 'SM-S928B',
        android_version: 35,
        android_release: '15',
      },
      length: options.length || 0,
      poster_frame_index: '0',
      audio_muted: '0',
      filter_type: '0',
      video_result: '',
      clips_creation_entry_point: 'clips',
    };

    const response = await this.client.request.send({
      url: '/api/v1/media/configure_to_clips/',
      method: 'POST',
      form: this.client.request.sign(data),
    });
    return response.body;
  }
}

module.exports = UploadRepository;
