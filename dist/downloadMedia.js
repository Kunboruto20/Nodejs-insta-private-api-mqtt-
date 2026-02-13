/**
 * Download Media from Instagram Messages
 * 
 * Similar to Baileys' downloadContentFromMessage() function.
 * Extracts and downloads media (photos, videos, voice notes) from Instagram DM messages.
 * 
 * Supports:
 * - Regular photos/videos in DMs
 * - View-once (raven) media - MUST download BEFORE marking as seen
 * - Voice messages
 * - Shared reels/posts
 * 
 * @author Added for nodejs-insta-private-api
 * @version 1.0.0
 */

const axios = require('axios');
const { Transform } = require('stream');

/**
 * Media types supported
 */
const MEDIA_TYPES = {
  IMAGE: 'image',
  VIDEO: 'video', 
  AUDIO: 'audio',
  VOICE: 'voice',
  RAVEN_IMAGE: 'raven_image',
  RAVEN_VIDEO: 'raven_video',
  MEDIA_SHARE: 'media_share',
  REEL_SHARE: 'reel_share',
  STORY_SHARE: 'story_share',
  CLIP: 'clip'
};

/**
 * Extract media URLs from an Instagram message object
 * 
 * @param {Object} message - The Instagram message object from MQTT/API
 * @returns {Object|null} - Object with urls, type, and metadata or null if no media
 */
function extractMediaUrls(message) {
  if (!message) return null;
  
  const result = {
    urls: [],
    type: null,
    width: null,
    height: null,
    duration: null,
    isViewOnce: false,
    expiresAt: null,
    originalMessage: message
  };

  // Check item_type for message type
  const itemType = message.item_type || message.type;
  
  // Handle view-once (raven) media
  if (itemType === 'raven_media' || message.visual_media) {
    result.isViewOnce = true;
    const visualMedia = message.visual_media || message.raven_media;
    
    if (visualMedia) {
      const media = visualMedia.media || visualMedia;
      result.expiresAt = visualMedia.expiring_media_action_summary?.timestamp;
      
      // Extract image
      if (media.image_versions2?.candidates) {
        result.type = MEDIA_TYPES.RAVEN_IMAGE;
        result.urls = media.image_versions2.candidates.map(c => ({
          url: c.url,
          width: c.width,
          height: c.height
        }));
        result.width = result.urls[0]?.width;
        result.height = result.urls[0]?.height;
      }
      
      // Extract video
      if (media.video_versions) {
        result.type = MEDIA_TYPES.RAVEN_VIDEO;
        result.urls = media.video_versions.map(v => ({
          url: v.url,
          width: v.width,
          height: v.height,
          type: v.type
        }));
        result.duration = media.video_duration;
        result.width = result.urls[0]?.width;
        result.height = result.urls[0]?.height;
      }
    }
    
    return result.urls.length > 0 ? result : null;
  }
  
  // Handle regular media message
  if (itemType === 'media' || message.media) {
    const media = message.media || message;
    
    // Image
    if (media.image_versions2?.candidates) {
      result.type = MEDIA_TYPES.IMAGE;
      result.urls = media.image_versions2.candidates.map(c => ({
        url: c.url,
        width: c.width,
        height: c.height
      }));
      result.width = result.urls[0]?.width;
      result.height = result.urls[0]?.height;
    }
    
    // Video
    if (media.video_versions) {
      result.type = MEDIA_TYPES.VIDEO;
      result.urls = media.video_versions.map(v => ({
        url: v.url,
        width: v.width,
        height: v.height,
        type: v.type
      }));
      result.duration = media.video_duration;
      result.width = result.urls[0]?.width;
      result.height = result.urls[0]?.height;
    }
    
    return result.urls.length > 0 ? result : null;
  }
  
  // Handle voice message
  if (itemType === 'voice_media' || message.voice_media) {
    const voiceMedia = message.voice_media || message;
    const audio = voiceMedia.media || voiceMedia;
    
    if (audio.audio) {
      result.type = MEDIA_TYPES.VOICE;
      result.urls = [{
        url: audio.audio.audio_src,
        duration: audio.audio.duration
      }];
      result.duration = audio.audio.duration;
    }
    
    return result.urls.length > 0 ? result : null;
  }
  
  // Handle media share (shared post)
  if (itemType === 'media_share' || message.media_share) {
    const mediaShare = message.media_share || message;
    
    if (mediaShare.image_versions2?.candidates) {
      result.type = MEDIA_TYPES.MEDIA_SHARE;
      result.urls = mediaShare.image_versions2.candidates.map(c => ({
        url: c.url,
        width: c.width,
        height: c.height
      }));
    }
    
    if (mediaShare.video_versions) {
      result.type = MEDIA_TYPES.MEDIA_SHARE;
      result.urls = mediaShare.video_versions.map(v => ({
        url: v.url,
        width: v.width,
        height: v.height
      }));
      result.duration = mediaShare.video_duration;
    }
    
    return result.urls.length > 0 ? result : null;
  }
  
  // Handle reel share
  if (itemType === 'clip' || itemType === 'felix_share' || message.clip) {
    const clip = message.clip?.clip || message.felix_share?.video || message;
    
    if (clip.image_versions2?.candidates) {
      result.type = MEDIA_TYPES.CLIP;
      result.urls = clip.image_versions2.candidates.map(c => ({
        url: c.url,
        width: c.width,
        height: c.height
      }));
    }
    
    if (clip.video_versions) {
      result.type = MEDIA_TYPES.CLIP;
      result.urls = clip.video_versions.map(v => ({
        url: v.url,
        width: v.width,
        height: v.height
      }));
      result.duration = clip.video_duration;
    }
    
    return result.urls.length > 0 ? result : null;
  }
  
  // Handle story share
  if (itemType === 'story_share' || message.story_share) {
    const story = message.story_share?.media || message.story_share || message;
    
    if (story.image_versions2?.candidates) {
      result.type = MEDIA_TYPES.STORY_SHARE;
      result.urls = story.image_versions2.candidates.map(c => ({
        url: c.url,
        width: c.width,
        height: c.height
      }));
    }
    
    if (story.video_versions) {
      result.type = MEDIA_TYPES.STORY_SHARE;
      result.urls = story.video_versions.map(v => ({
        url: v.url,
        width: v.width,
        height: v.height
      }));
    }
    
    return result.urls.length > 0 ? result : null;
  }
  
  return null;
}

/**
 * Download media content from an Instagram message
 * Similar to Baileys' downloadContentFromMessage()
 * 
 * @param {Object} message - The Instagram message object containing media
 * @param {string} type - Optional: 'image', 'video', 'audio' to specify which type to download
 * @param {Object} options - Optional download options
 * @param {number} options.quality - Quality index (0 = highest, default 0)
 * @param {number} options.timeout - Request timeout in ms (default 30000)
 * @param {Object} options.headers - Additional headers for the request
 * @returns {Promise<Transform>} - Readable stream of the media content
 * 
 * @example
 * // Download view-once image before marking as seen
 * const stream = await downloadContentFromMessage(message, 'image');
 * let buffer = Buffer.from([]);
 * for await (const chunk of stream) {
 *   buffer = Buffer.concat([buffer, chunk]);
 * }
 * fs.writeFileSync('saved-viewonce.jpg', buffer);
 */
async function downloadContentFromMessage(message, type = null, options = {}) {
  const mediaInfo = extractMediaUrls(message);
  
  if (!mediaInfo || mediaInfo.urls.length === 0) {
    throw new Error('No media found in message');
  }
  
  // Select quality (0 = best)
  const qualityIndex = options.quality || 0;
  const selectedUrl = mediaInfo.urls[Math.min(qualityIndex, mediaInfo.urls.length - 1)];
  
  if (!selectedUrl?.url) {
    throw new Error('Could not extract media URL from message');
  }
  
  const timeout = options.timeout || 30000;
  const headers = {
    'User-Agent': 'Instagram 415.0.0.36.76 Android',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate',
    ...(options.headers || {})
  };
  
  try {
    const response = await axios({
      method: 'GET',
      url: selectedUrl.url,
      responseType: 'stream',
      timeout: timeout,
      headers: headers,
      maxRedirects: 5
    });
    
    // Create transform stream to pass through
    const transform = new Transform({
      transform(chunk, encoding, callback) {
        this.push(chunk);
        callback();
      }
    });
    
    // Attach metadata to stream
    transform.mediaInfo = {
      type: mediaInfo.type,
      isViewOnce: mediaInfo.isViewOnce,
      width: selectedUrl.width || mediaInfo.width,
      height: selectedUrl.height || mediaInfo.height,
      duration: mediaInfo.duration,
      contentType: response.headers['content-type'],
      contentLength: parseInt(response.headers['content-length']) || null
    };
    
    response.data.pipe(transform);
    
    return transform;
    
  } catch (error) {
    throw new Error(`Failed to download media: ${error.message}`);
  }
}

/**
 * Download media content as a Buffer directly
 * Convenience wrapper around downloadContentFromMessage
 * 
 * @param {Object} message - The Instagram message object containing media
 * @param {string} type - Optional: 'image', 'video', 'audio' to specify type
 * @param {Object} options - Optional download options
 * @returns {Promise<{buffer: Buffer, mediaInfo: Object}>} - Buffer and metadata
 * 
 * @example
 * const { buffer, mediaInfo } = await downloadMediaBuffer(message);
 * console.log('Downloaded', mediaInfo.type, 'size:', buffer.length);
 * fs.writeFileSync('media.' + (mediaInfo.type === 'video' ? 'mp4' : 'jpg'), buffer);
 */
async function downloadMediaBuffer(message, type = null, options = {}) {
  const stream = await downloadContentFromMessage(message, type, options);
  
  const chunks = [];
  
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => {
      resolve({
        buffer: Buffer.concat(chunks),
        mediaInfo: stream.mediaInfo
      });
    });
    stream.on('error', reject);
  });
}

/**
 * Check if a message contains downloadable media
 * 
 * @param {Object} message - The Instagram message object
 * @returns {boolean} - True if message contains downloadable media
 */
function hasMedia(message) {
  return extractMediaUrls(message) !== null;
}

/**
 * Get media type from message without downloading
 * 
 * @param {Object} message - The Instagram message object
 * @returns {string|null} - Media type or null
 */
function getMediaType(message) {
  const info = extractMediaUrls(message);
  return info?.type || null;
}

/**
 * Check if message is view-once (disappearing)
 * 
 * @param {Object} message - The Instagram message object
 * @returns {boolean} - True if view-once media
 */
function isViewOnceMedia(message) {
  const info = extractMediaUrls(message);
  return info?.isViewOnce || false;
}

module.exports = {
  downloadContentFromMessage,
  downloadMediaBuffer,
  extractMediaUrls,
  hasMedia,
  getMediaType,
  isViewOnceMedia,
  MEDIA_TYPES
};
