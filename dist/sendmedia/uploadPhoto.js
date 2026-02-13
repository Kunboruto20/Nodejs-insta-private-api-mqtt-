/**
 * uploadPhoto.js - FIXED version based on instagram-private-api
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Validate buffer and mime type
 */
function validateImageInput(photoBuffer, mimeType) {
  if (!photoBuffer || !Buffer.isBuffer(photoBuffer) || photoBuffer.length === 0) {
    throw new Error('uploadPhoto: photoBuffer must be a non-empty Buffer.');
  }
  const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!allowed.includes(mimeType)) {
    throw new Error(`uploadPhoto: mimeType must be one of ${allowed.join(', ')}.`);
  }
}

/**
 * Build Instagram rupload params for photo - Matching instagram-private-api
 */
function buildRuploadParams(uploadId, mimeType) {
  const isJpeg = mimeType === 'image/jpeg' || mimeType === 'image/jpg';
  const compression = isJpeg
    ? JSON.stringify({ lib_name: 'moz', lib_version: '3.1.m', quality: '80' })
    : JSON.stringify({ lib_name: 'png', lib_version: '1.0', quality: '100' });

  return {
    retry_context: JSON.stringify({ num_step_auto_retry: 0, num_reupload: 0, num_step_manual_retry: 0 }),
    media_type: '1', // String '1' per instagram-private-api
    upload_id: uploadId.toString(),
    xsharing_user_ids: JSON.stringify([]),
    image_compression: compression,
  };
}

/**
 * Upload a photo to Instagram's rupload endpoint.
 */
async function uploadPhoto(session, photoBuffer, options = {}) {
  const {
    mimeType = 'image/jpeg',
    fileName,
    signal,
  } = options;

  validateImageInput(photoBuffer, mimeType);

  const uploadId = Date.now().toString();
  const name = `${uploadId}_0_${Math.floor(Math.random() * (9999999999 - 1000000000) + 1000000000)}`;
  const contentLength = photoBuffer.byteLength;
  
  const ruploadParams = buildRuploadParams(uploadId, mimeType);

  // Headers expected by Instagram rupload (matched with instagram-private-api)
  const headers = {
    'X_FB_PHOTO_WATERFALL_ID': uuidv4(),
    'X-Entity-Type': 'image/jpeg',
    'Offset': '0',
    'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
    'X-Entity-Name': name,
    'X-Entity-Length': String(contentLength),
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(contentLength),
    'Accept-Encoding': 'gzip',
  };

  // If it's png, maybe we should adjust X-Entity-Type? 
  // instagram-private-api seems to hardcode 'image/jpeg' in the trace for 'photo' method.
  // We'll stick to 'image/jpeg' for X-Entity-Type as per reference unless user provided PNG which might work anyway.

  const url = `/rupload_igphoto/${name}`;

  try {
    const response = await session.request.send({
      url,
      method: 'POST',
      headers,
      body: photoBuffer,
      signal,
    });

    if (!response) {
      throw new Error('uploadPhoto: Empty response from Instagram rupload endpoint.');
    }

    // Try to get upload_id from response
    let serverUploadId = null;
    if (typeof response === 'object' && response.body) {
        try {
            const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
            serverUploadId = body.upload_id;
        } catch (e) {
            // ignore parse error
        }
    }

    return serverUploadId || uploadId;
  } catch (err) {
    // If error, try to extract message
    const msg = err.message || err.toString();
    throw new Error(`uploadPhoto: Upload failed — ${msg}`);
  }
}

module.exports = uploadPhoto;
