/**
 * uploadfFile.js - FIXED version based on instagram-private-api
 */

const { v4: uuidv4 } = require('uuid');

const DEFAULT_CHUNK_SIZE = 512 * 1024; // 512KB

/**
 * Validate upload input
 */
function validateFileInput(fileBuffer, mimeType) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error('uploadFile: fileBuffer must be a non-empty Buffer.');
  }
  if (typeof mimeType !== 'string' || mimeType.length === 0) {
    throw new Error('uploadFile: mimeType must be a non-empty string.');
  }
}

/**
 * Build rupload params - Matching instagram-private-api
 */
function buildRuploadParams(uploadId, mimeType, opts) {
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');
  
  const params = {
    retry_context: JSON.stringify({ num_step_auto_retry: 0, num_reupload: 0, num_step_manual_retry: 0 }),
    media_type: isVideo ? '2' : '3', // 2 for video, 3 for audio/others?
    upload_id: uploadId.toString(),
    xsharing_user_ids: JSON.stringify([]),
  };

  if (isVideo) {
    params.upload_media_duration_ms = opts.duration?.toString() || '0';
    params.upload_media_width = opts.width?.toString() || '720';
    params.upload_media_height = opts.height?.toString() || '1280';
    params.direct_v2 = '1';
  }

  return params;
}

/**
 * Upload file via rupload with chunking.
 */
async function uploadFile(session, fileBuffer, options = {}) {
  const {
    mimeType = 'video/mp4',
    fileName,
    chunkSize = DEFAULT_CHUNK_SIZE,
    signal,
  } = options;

  validateFileInput(fileBuffer, mimeType);

  const uploadId = Date.now().toString();
  const name = `${uploadId}_0_${Math.floor(Math.random() * 9000000000 + 1000000000)}`;
  const totalLength = fileBuffer.length;
  const waterfallId = uuidv4();

  const ruploadParams = buildRuploadParams(uploadId, mimeType, options);
  
  const endpoint = mimeType.startsWith('image/')
    ? `/rupload_igphoto/${name}`
    : `/rupload_igvideo/${name}`;

  // Start upload
  let offset = 0;
  const size = Math.max(64 * 1024, Math.min(4 * 1024 * 1024, chunkSize));

  try {
    while (offset < totalLength) {
      const end = Math.min(offset + size, totalLength);
      const chunk = fileBuffer.subarray(offset, end);

      const headers = {
        'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
        'X_FB_VIDEO_WATERFALL_ID': waterfallId,
        'X-Entity-Type': mimeType,
        'X-Entity-Name': name,
        'X-Entity-Length': String(totalLength),
        'Offset': String(offset),
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(chunk.length),
        'Accept-Encoding': 'gzip',
      };

      const res = await session.request.send({
        url: endpoint,
        method: 'POST',
        headers,
        body: chunk,
        signal,
      });

      if (!res) throw new Error(`uploadFile: Empty response at offset ${offset}`);
      offset = end;
    }

    // Finalize
    const confirm = await session.request.send({
      url: endpoint,
      method: 'POST',
      headers: {
        'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
        'X_FB_VIDEO_WATERFALL_ID': waterfallId,
        'X-Entity-Type': mimeType,
        'Offset': String(totalLength),
        'Content-Length': '0',
      },
      signal,
    });

    let serverUploadId = null;
    if (confirm && confirm.body) {
        try {
            const body = typeof confirm.body === 'string' ? JSON.parse(confirm.body) : confirm.body;
            serverUploadId = body.upload_id;
        } catch (e) {}
    }

    return serverUploadId || uploadId;
  } catch (err) {
    throw new Error(`uploadFile: Upload failed — ${err.message}`);
  }
}

module.exports = uploadFile;
