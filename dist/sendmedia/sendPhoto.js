/**
 * uploadPhoto.fixed.js
 *
 * Fixed and hardened version of uploadPhoto for nodejs-insta-private-api(-mqtt).
 * - sends Buffer in `data` (axios uses `data`, not `body`)
 * - sets axios-friendly headers (X-Entity-Type uses provided mimeType)
 * - removes explicit Accept-Encoding header (axios handles it)
 * - sets maxContentLength / maxBodyLength via Request httpClient (should be patched there too)
 * - returns the rupload/uploadId (server-provided when available, otherwise local uploadId)
 *
 * Usage:
 *   const uploadPhoto = require('./uploadPhoto.fixed');
 *   const uploadId = await uploadPhoto(session, photoBuffer, { mimeType: 'image/jpeg' });
 *
 * Note: session.request.send(...) is expected to accept axios-like options.
 */

const { v4: uuidv4 } = require('uuid');

function validateImageInput(photoBuffer, mimeType) {
  if (!photoBuffer || !Buffer.isBuffer(photoBuffer) || photoBuffer.length === 0) {
    throw new Error('uploadPhoto: photoBuffer must be a non-empty Buffer.');
  }
  const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!allowed.includes(mimeType)) {
    throw new Error(`uploadPhoto: mimeType must be one of ${allowed.join(', ')}.`);
  }
}

function buildRuploadParams(uploadId, mimeType) {
  const isJpeg = mimeType === 'image/jpeg' || mimeType === 'image/jpg';
  const compression = isJpeg
    ? { lib_name: 'moz', lib_version: '3.1.m', quality: '80' }
    : { lib_name: 'png', lib_version: '1.0', quality: '100' };

  // Match instagram-private-api shape; include is_sidecar for compatibility
  return {
    retry_context: JSON.stringify({ num_step_auto_retry: 0, num_reupload: 0, num_step_manual_retry: 0 }),
    media_type: '1',
    upload_id: uploadId.toString(),
    xsharing_user_ids: JSON.stringify([]),
    image_compression: JSON.stringify(compression),
    is_sidecar: '0'
  };
}

/**
 * Upload a photo buffer to Instagram rupload endpoint.
 *
 * @param {Object} session - client/session object that exposes session.request.send(options)
 * @param {Buffer} photoBuffer - binary buffer of the image
 * @param {Object} options - { mimeType = 'image/jpeg', fileName?, signal? }
 * @returns {Promise<string>} uploadId (server upload_id when available, otherwise local uploadId)
 */
async function uploadPhoto(session, photoBuffer, options = {}) {
  const {
    mimeType = 'image/jpeg',
    fileName,
    signal
  } = options;

  validateImageInput(photoBuffer, mimeType);

  // local upload id similar to insta clients
  const uploadId = Date.now().toString();
  // create an entity name similar to instagram-private-api naming
  const randomSuffix = Math.floor(Math.random() * (9999999999 - 1000000000) + 1000000000);
  const name = `${uploadId}_0_${randomSuffix}`;
  const contentLength = photoBuffer.byteLength;

  const ruploadParams = buildRuploadParams(uploadId, mimeType);

  const headers = {
    'X_FB_PHOTO_WATERFALL_ID': uuidv4(),
    'X-Entity-Type': mimeType,                      // use actual mimeType
    'Offset': '0',
    'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
    'X-Entity-Name': name,
    'X-Entity-Length': String(contentLength),
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(contentLength),
    // remove explicit Accept-Encoding to avoid conflicts; axios handles compression
    // 'Accept-Encoding': 'gzip',
  };

  const url = `/rupload_igphoto/${name}`;

  try {
    // session.request.send is expected to forward options to axios (or similar)
    // We MUST use `data` (not `body`) for axios-friendly request.
    const response = await session.request.send({
      url,
      method: 'POST',
      headers,
      data: photoBuffer,
      signal,
      // ensure axios does not apply any transform that would corrupt binary
      transformRequest: [(d) => d]
    });

    if (!response) {
      throw new Error('uploadPhoto: Empty response from Instagram rupload endpoint.');
    }

    // The request wrapper in different forks may return { body, headers } OR axios response
    // Normalize possible shapes:
    let respBody = null;
    if (response.body !== undefined) {
      // wrapper returned { body, headers }
      respBody = response.body;
    } else if (response.data !== undefined) {
      respBody = response.data;
    } else {
      respBody = response;
    }

    // If respBody is a string, try parse JSON
    let parsed = null;
    if (typeof respBody === 'string') {
      try { parsed = JSON.parse(respBody); } catch (e) { parsed = null; }
    } else if (typeof respBody === 'object') {
      parsed = respBody;
    }

    // server might return upload_id inside parsed
    const serverUploadId = parsed && (parsed.upload_id || parsed.uploadId || parsed.media && parsed.media.upload_id);
    if (serverUploadId) {
      return serverUploadId.toString();
    }

    // fallback: some endpoints respond with status only; return our local uploadId
    return uploadId;
  } catch (err) {
    // try to unwrap axios error message
    let msg = '';
    if (err && err.message) msg = err.message;
    else msg = String(err);
    throw new Error(`uploadPhoto: Upload failed — ${msg}`);
  }
}

module.exports = uploadPhoto;
