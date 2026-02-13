/**
 * sendFile.js - Fixed to support MQTT if realtime client provided
 */

const uploadFile = require('./uploadfFile');

/**
 * Send a file to Instagram Direct.
 */
async function sendFile(session, opts = {}) {
  const {
    fileBuffer,
    mimeType = 'video/mp4',
    fileName,
    caption = '',
    userId,
    threadId,
    signal,
    realtimeClient,
  } = opts;

  if (!userId && !threadId) {
    throw new Error('sendFile: Provide userId or threadId.');
  }
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error('sendFile: fileBuffer must be a non-empty Buffer.');
  }

  // 1) Upload
  const upload_id = await uploadFile(session, fileBuffer, {
    mimeType,
    fileName,
    signal,
  });

  // 2) MQTT Check
  if (realtimeClient && realtimeClient.direct && typeof realtimeClient.direct.sendMedia === 'function') {
      return await realtimeClient.direct.sendMedia({
          text: caption,
          mediaId: upload_id,
          threadId: threadId || userId,
      });
  }

  // 3) REST Fallback
  const url = '/direct_v2/threads/broadcast/upload_video/';
  const form = {
    upload_id,
    action: 'send_item',
    caption,
  };

  if (userId) {
    form.recipient_users = JSON.stringify([[String(userId)]]);
  } else {
    form.thread_ids = JSON.stringify([String(threadId)]);
  }

  try {
    const response = await session.request.send({
      url,
      method: 'POST',
      form,
      signal,
    });
    return response;
  } catch (err) {
    throw new Error(`sendFile: Broadcast failed — ${err.message}`);
  }
}

module.exports = sendFile;
