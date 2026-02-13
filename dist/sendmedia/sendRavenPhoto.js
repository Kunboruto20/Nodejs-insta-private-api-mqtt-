const { v4: uuidv4 } = require('uuid');

function buildRavenPhotoRuploadParams(uploadId) {
  return {
    retry_context: JSON.stringify({ num_step_auto_retry: 0, num_reupload: 0, num_step_manual_retry: 0 }),
    media_type: '1',
    upload_id: uploadId.toString(),
    image_compression: JSON.stringify({ lib_name: 'moz', lib_version: '3.1.m', quality: '95' }),
    xsharing_user_ids: JSON.stringify([]),
    direct_v2: '1',
  };
}

async function sendRavenPhoto(session, photoBuffer, options = {}) {
  const {
    threadId,
    ephemeralMediaViewMode = 0,
    viewMode,
    mimeType = 'image/jpeg',
  } = options;

  if (!photoBuffer || !Buffer.isBuffer(photoBuffer) || photoBuffer.length === 0) {
    throw new Error('sendRavenPhoto: photoBuffer must be a non-empty Buffer.');
  }
  if (!threadId) {
    throw new Error('sendRavenPhoto: threadId is required.');
  }

  const resolvedViewMode = (ephemeralMediaViewMode !== undefined && ephemeralMediaViewMode !== null)
    ? ephemeralMediaViewMode
    : (viewMode === 'replayable' ? 1 : 0);

  const uploadId = Date.now().toString();
  const randomSuffix = Math.floor(Math.random() * (9999999999 - 1000000000) + 1000000000);
  const name = `${uploadId}_0_${randomSuffix}`;
  const waterfallId = uuidv4();
  const ruploadParams = buildRavenPhotoRuploadParams(uploadId);

  const uploadHeaders = {
    'X_FB_PHOTO_WATERFALL_ID': waterfallId,
    'X-Entity-Type': mimeType,
    'Offset': '0',
    'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
    'X-Entity-Name': name,
    'X-Entity-Length': String(photoBuffer.length),
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(photoBuffer.length),
  };

  const uploadResponse = await session.request.send({
    url: `/rupload_igphoto/${name}`,
    method: 'POST',
    headers: uploadHeaders,
    data: photoBuffer,
    transformRequest: [(d) => d],
  });

  let serverUploadId = uploadId;
  const respBody = uploadResponse && (uploadResponse.body || uploadResponse.data || uploadResponse);
  if (respBody) {
    const parsed = typeof respBody === 'string' ? JSON.parse(respBody) : respBody;
    if (parsed && (parsed.upload_id || (parsed.media && parsed.media.upload_id))) {
      serverUploadId = (parsed.upload_id || parsed.media.upload_id).toString();
    }
  }

  const clientContext = uuidv4();
  const form = {
    action: 'send_item',
    upload_id: serverUploadId,
    thread_ids: JSON.stringify([String(threadId)]),
    client_context: clientContext,
    _csrftoken: session.state.cookieCsrfToken,
    mutation_token: clientContext,
    offline_threading_id: clientContext,
    device_id: session.state.deviceId,
    _uuid: session.state.uuid,
    ephemeral_media_view_mode: String(resolvedViewMode),
  };

  const payloadForm = (session.request && typeof session.request.sign === 'function')
    ? session.request.sign(form)
    : form;

  const broadcastResponse = await session.request.send({
    url: '/api/v1/direct_v2/threads/broadcast/raven_attachment/',
    method: 'POST',
    form: payloadForm,
    qs: { use_unified_inbox: true },
  });

  const body = broadcastResponse && (broadcastResponse.body || broadcastResponse.data || broadcastResponse);
  return typeof body === 'string' ? JSON.parse(body) : body;
}

module.exports = sendRavenPhoto;
