Full featured Java and nodejs Instagram api private with Mqtt full suport and api rest 

Dear users The repository on github is currently unavailable will be available soon 

If you Like This Project You Can Help Me with Donation revolut , My revolut revtag is @gvny22 


# nodejs-insta-private-api-mqtt

This project implements a complete and production-ready MQTT protocol client for Instagram's real-time messaging infrastructure. Instagram uses MQTT natively for direct messages, notifications, and real-time presence updates. This library replicates that exact implementation, allowing developers to build high-performance bots and automation tools that communicate with Instagram's backend using the same protocol the official app uses.

By leveraging MQTT instead of Instagram's REST API, this library achieves sub-500ms message latency, bidirectional real-time communication, and native support for notifications, presence tracking, and thread management. The implementation is reverse-engineered from Instagram's mobile app protocol and tested extensively for reliability and compatibility.

## Features (v5.66.0 - Complete REST API + MQTT)

### REST API (32 Repositories)
- **Account** - Login, 2FA (TOTP + SMS), challenge resolver, edit profile, change password, privacy settings
- **User** - Info, search, follow/unfollow, block/unblock, mute, get posts/reels/stories with pagination
- **Media** - Like, comment (pin/unpin/bulk delete/reply), save, archive, download, PK/shortcode conversion
- **Reels/Clips** - Upload, configure, discover reels, download, music info
- **Stories** - Upload photo/video stories, react, mark seen, highlights management
- **Highlights** - Create, edit, delete highlights, add/remove stories, update cover
- **Direct Messages** - Send text/photo/video/link/media, inbox, pending inbox, group threads
- **Friendship** - Follow, block, restrict, close friends, favorites, pending requests
- **Search** - Users, hashtags, places, music, recent/suggested searches
- **Explore** - Topical explore, report, mark seen
- **Feed** - Timeline, hashtag/location feeds, saved/liked, carousel upload
- **Upload** - Photo/video upload with configure to feed, story, or clips
- **Insights** - Account, media, reel, story analytics (business/creator accounts)
- **Notes** - Create, delete, view Instagram Notes
- **Notifications** - Per-type notification settings (likes, comments, follows, etc.)
- **TOTP** - 2FA setup with authenticator app, SMS 2FA, backup codes
- **Challenge** - Auto-resolve security checkpoints, verify methods
- **Signup** - Account creation, email/phone verification, username availability
- **Music/Tracks** - Search, get info, download audio tracks
- **Fundraiser** - Create, donate, get fundraiser info
- **Multiple Accounts** - Account family, switch accounts
- **Captcha** - reCAPTCHA / hCaptcha handling
- **Share** - Decode QR/NFC share codes, parse share URLs
- **Bloks** - Low-level Instagram Bloks engine actions

### MQTT Real-Time
- **Real-time MQTT messaging** - Receive and send DMs with <500ms latency
- **FBNS Push Notifications** - Follows, likes, comments, story mentions, live broadcasts
- **33 Preset Devices** - 21 iOS + 12 Android device emulation
- **View-Once Media** - Download disappearing photos/videos before they expire
- **Raven (View-Once) Sending** - Send view-once and replayable photos/videos via REST
- **sendPhoto() / sendVideo()** - Upload and send media directly via MQTT
- **Session persistence** - Multi-file auth state like Baileys (WhatsApp library)
- **Automatic reconnection** - Smart error classification with type-specific backoff
- **Session health monitoring** - Auto-relogin, uptime tracking
- **Persistent logging** - File-based logging with rotation
- **Message ordering** - Per-thread message queuing
- **Pure JavaScript** - No compilation required, works in Node.js 18+

## Scope: DM-Focused Implementation

This library is optimized for Direct Messages and implements the core MQTT protocols used by Instagram for:
- Real-time message delivery and reception
- Presence status tracking
- Typing indicators
- Notifications for follows, mentions, and calls
- Group thread management

**For full MQTT coverage analysis, see [MQTT_COVERAGE_ANALYSIS.md](MQTT_COVERAGE_ANALYSIS.md)**

## Installation

```bash
npm install nodejs-insta-private-api-mqtt
```

Requires **Node.js 18 or higher**.

---

## NEW: Custom Device Emulation (v5.60.7)

**Default Device:** Samsung Galaxy S25 Ultra (Android 15) - used automatically if you don't set a custom device.

This feature allows you to **choose which phone model Instagram sees** when your bot connects. Instead of using a default device, you can emulate any Android phone like Samsung Galaxy S25 Ultra, Huawei P60 Pro, Google Pixel 9, and more.

### Why Use Custom Device Emulation?

- **Avoid detection** - Use realistic, modern device fingerprints
- **Match your target audience** - Emulate devices popular in specific regions
- **Testing** - Test how Instagram behaves with different devices
- **Reduce bans** - Modern devices are less likely to trigger security checks

### Quick Start: Use a Preset Device

```javascript
const { IgApiClient } = require('nodejs-insta-private-api');

const ig = new IgApiClient();

// Set device BEFORE login
ig.state.usePresetDevice('Samsung Galaxy S25 Ultra');

// Now login - Instagram will see a Samsung S25 Ultra
await ig.login({
  username: 'your_username',
  password: 'your_password'
});

console.log('Logged in with device:', ig.state.deviceString);
```

### Available Preset Devices

| Device Name | Manufacturer | Android Version |
|-------------|--------------|-----------------|
| Samsung Galaxy S25 Ultra | Samsung | Android 15 |
| Samsung Galaxy S24 Ultra | Samsung | Android 14 |
| Samsung Galaxy S23 Ultra | Samsung | Android 14 |
| Samsung Galaxy Z Fold 5 | Samsung | Android 14 |
| Huawei P60 Pro | Huawei | Android 12 |
| Huawei Mate 60 Pro | Huawei | Android 12 |
| Google Pixel 8 Pro | Google | Android 14 |
| Google Pixel 9 Pro | Google | Android 15 |
| OnePlus 12 | OnePlus | Android 14 |
| Xiaomi 14 Ultra | Xiaomi | Android 14 |
| Xiaomi Redmi Note 13 Pro | Xiaomi | Android 14 |
| OPPO Find X7 Ultra | OPPO | Android 14 |

### Set a Fully Custom Device

For complete control, use `setCustomDevice()` with your own configuration:

```javascript
const ig = new IgApiClient();

ig.state.setCustomDevice({
  manufacturer: 'samsung',
  model: 'SM-S928B',
  device: 'e3q',
  androidVersion: '15',
  androidApiLevel: 35,
  resolution: '1440x3120',
  dpi: '505dpi',
  chipset: 'qcom',
  build: 'UP1A.231005.007'
});
```

---

## Quick Start: Instant MQTT Boot

```javascript
const { IgApiClient, RealtimeClient, useMultiFileAuthState } = require('nodejs-insta-private-api-mqtt');

async function startBot() {
  const ig = new IgApiClient();
  const auth = await useMultiFileAuthState('./auth_info_ig');
  
  ig.state.usePresetDevice('Samsung Galaxy S25 Ultra');
  
  const realtime = new RealtimeClient(ig);

  realtime.on('connected', () => {
    console.log('Bot is online and MQTT is connected!');
  });

  realtime.on('message_live', async (msg) => {
    console.log(`[${msg.username}]: ${msg.text}`);
    
    if (msg.text.toLowerCase() === 'ping') {
      await realtime.directCommands.sendText({
        threadId: msg.thread_id,
        text: 'pong!'
      });
    }
  });

  if (!auth.hasSession()) {
    await ig.login({
      username: 'your_username',
      password: 'your_password'
    });
    
    await auth.saveCreds(ig);
    await realtime.startRealTimeListener();
    await auth.saveMqttSession(realtime);
  }
}

startBot().catch(console.error);
```

---

## EnhancedDirectCommands - Complete MQTT Methods Reference

All MQTT direct messaging functionality is available through `realtime.directCommands`. These methods use proper payload formatting that matches the instagram_mqtt library format.

### Basic Messaging

#### Send Text Message

```javascript
await realtime.directCommands.sendText({
  threadId: '340282366841710300949128114477782749726',
  text: 'Hello from MQTT!'
});
```

#### Send Text (Alternative Signature)

```javascript
await realtime.directCommands.sendTextViaRealtime(threadId, 'Hello!');
```

#### Reply to Message (Quote Reply)

```javascript
await realtime.directCommands.replyToMessage(threadId, messageId, 'This is my reply');
```

#### Edit Message

```javascript
await realtime.directCommands.editMessage(threadId, itemId, 'Updated text here');
```

#### Delete Message

```javascript
await realtime.directCommands.deleteMessage(threadId, itemId);
```

---

### Content Sharing

#### Send Hashtag

```javascript
await realtime.directCommands.sendHashtag({
  threadId: threadId,
  hashtag: 'photography',
  text: 'Check this out'
});
```

#### Send Like (Heart)

```javascript
await realtime.directCommands.sendLike({
  threadId: threadId
});
```

#### Send Location

```javascript
await realtime.directCommands.sendLocation({
  threadId: threadId,
  locationId: '123456789',
  text: 'Meet me here'
});
```

#### Send Media (Share Post)

```javascript
await realtime.directCommands.sendMedia({
  threadId: threadId,
  mediaId: 'media_id_here',
  text: 'Check this post'
});
```

#### Send Profile

```javascript
await realtime.directCommands.sendProfile({
  threadId: threadId,
  userId: '12345678',
  text: 'Follow this account'
});
```

#### Send User Story

```javascript
await realtime.directCommands.sendUserStory({
  threadId: threadId,
  storyId: 'story_id_here',
  text: 'Did you see this?'
});
```

#### Send Link

```javascript
await realtime.directCommands.sendLink({
  threadId: threadId,
  link: 'https://example.com',
  text: 'Check this link'
});
```

#### Send Animated Media (GIF/Sticker)

```javascript
await realtime.directCommands.sendAnimatedMedia({
  threadId: threadId,
  id: 'giphy_id_here',
  isSticker: false
});
```

#### Send Voice Message (after upload)

```javascript
await realtime.directCommands.sendVoice({
  threadId: threadId,
  uploadId: 'your_upload_id',
  waveform: [0.1, 0.5, 0.8, 0.3],
  waveformSamplingFrequencyHz: 10
});
```

---

### Reactions

#### Send Reaction

```javascript
await realtime.directCommands.sendReaction({
  threadId: threadId,
  itemId: messageId,
  reactionType: 'like'
});
```

#### Send Emoji Reaction

```javascript
await realtime.directCommands.sendReaction({
  threadId: threadId,
  itemId: messageId,
  reactionType: 'emoji',
  emoji: '🔥'
});
```

#### Remove Reaction

```javascript
await realtime.directCommands.removeReaction({
  threadId: threadId,
  itemId: messageId
});
```

---

### Read Receipts & Activity

#### Mark Message as Seen

Marks a message as seen (read receipt) in a DM thread. This uses Instagram's REST API internally and falls back to MQTT if needed. The method returns the server response — when successful, `status` will be `"ok"`.

```javascript
// Basic usage — mark a specific message as seen
const result = await realtime.directCommands.markAsSeen({
  threadId: '340282366841710300949128114477782749726',
  itemId: '32661457411201420841385410521202688'
});
console.log(result.status); // "ok"
```

#### Auto-Read All Incoming Messages

A common pattern is to automatically mark every incoming message as seen, so the sender always sees the blue "Seen" indicator:

```javascript
realtime.on('message', async (data) => {
  const threadId = data.parsed?.threadId || data.message?.thread_id;
  const itemId = data.parsed?.messageId || data.message?.item_id;
  const status = data.parsed?.status;

  // Only mark messages from other users (skip our own)
  if (status === 'sent' || !threadId || !itemId) return;

  try {
    await realtime.directCommands.markAsSeen({ threadId, itemId });
  } catch (err) {
    console.error('Failed to mark as seen:', err.message);
  }
});
```

#### Mark as Seen with Delay (Human-Like Behavior)

If you want the bot to appear more human, you can add a small delay before sending the read receipt:

```javascript
realtime.on('message', async (data) => {
  const threadId = data.parsed?.threadId || data.message?.thread_id;
  const itemId = data.parsed?.messageId || data.message?.item_id;

  if (data.parsed?.status === 'sent' || !threadId || !itemId) return;

  // Wait 1-3 seconds before marking as seen
  const delay = 1000 + Math.random() * 2000;
  await new Promise(resolve => setTimeout(resolve, delay));

  await realtime.directCommands.markAsSeen({ threadId, itemId });
});
```

#### Indicate Typing

```javascript
// Start typing
await realtime.directCommands.indicateActivity({
  threadId: threadId,
  isActive: true
});

// Stop typing
await realtime.directCommands.indicateActivity({
  threadId: threadId,
  isActive: false
});
```

#### Mark Visual Message as Seen (disappearing media)

Mark view-once photos/videos as seen. Works the same way as `markAsSeen` but specifically for disappearing media items:

```javascript
await realtime.directCommands.markVisualMessageSeen({
  threadId: threadId,
  itemId: messageId
});
```

---

### Thread Management

#### Add Member to Thread

```javascript
await realtime.directCommands.addMemberToThread(threadId, userId);

// Add multiple members
await realtime.directCommands.addMemberToThread(threadId, [userId1, userId2]);
```

#### Remove Member from Thread

```javascript
await realtime.directCommands.removeMemberFromThread(threadId, userId);
```

#### Leave Thread

```javascript
await realtime.directCommands.leaveThread(threadId);
```

#### Update Thread Title

```javascript
await realtime.directCommands.updateThreadTitle(threadId, 'New Group Name');
```

#### Mute Thread

```javascript
await realtime.directCommands.muteThread(threadId);

// Mute until specific time
await realtime.directCommands.muteThread(threadId, Date.now() + 3600000);
```

#### Unmute Thread

```javascript
await realtime.directCommands.unmuteThread(threadId);
```

---

### Message Requests

#### Approve Pending Thread

```javascript
await realtime.directCommands.approveThread(threadId);
```

#### Decline Pending Thread

```javascript
await realtime.directCommands.declineThread(threadId);
```

---

### Moderation

#### Block User in Thread

```javascript
await realtime.directCommands.blockUserInThread(threadId, userId);
```

#### Report Thread

```javascript
await realtime.directCommands.reportThread(threadId, 'spam');
```

---

### Disappearing Media (View-Once)

#### Send Disappearing Photo

```javascript
await realtime.directCommands.sendDisappearingPhoto({
  threadId: threadId,
  uploadId: 'your_upload_id',
  viewMode: 'once'  // 'once' or 'replayable'
});
```

#### Send Disappearing Video

```javascript
await realtime.directCommands.sendDisappearingVideo({
  threadId: threadId,
  uploadId: 'your_upload_id',
  viewMode: 'once'
});
```

---

### Raven (View-Once) Media — Full Upload + Send

Instagram internally calls view-once DM media "raven." Under the hood, it works like this: upload the file via rupload with `direct_v2: '1'`, then broadcast to the thread via REST at `/direct_v2/threads/broadcast/raven_attachment/`. The `sendRavenPhoto` and `sendRavenVideo` methods handle both steps for you.

Two modes:
- **View-once** (`ephemeralMediaViewMode: 0`) — opens once, then gone
- **Replayable** (`ephemeralMediaViewMode: 1`) — can be replayed, still disappears

#### Send Raven Photo (via directCommands)

If you have a `RealtimeClient` running, use `directCommands`. Internally this still uses the REST endpoint, not MQTT — but it has access to the logged-in client so you don't need to wire anything up.

```javascript
const fs = require('fs');
const photoBuffer = fs.readFileSync('./secret_photo.jpg');

// view-once
await realtime.directCommands.sendRavenPhoto({
  threadId: threadId,
  photoBuffer: photoBuffer,
  ephemeralMediaViewMode: 0
});

// replayable
await realtime.directCommands.sendRavenPhoto({
  threadId: threadId,
  photoBuffer: photoBuffer,
  ephemeralMediaViewMode: 1
});

// you can also use the string shorthand
await realtime.directCommands.sendRavenPhoto({
  threadId: threadId,
  photoBuffer: photoBuffer,
  viewMode: 'once'        // same as ephemeralMediaViewMode: 0
});
```

#### Send Raven Video (via directCommands)

```javascript
const videoBuffer = fs.readFileSync('./secret_clip.mp4');

await realtime.directCommands.sendRavenVideo({
  threadId: threadId,
  videoBuffer: videoBuffer,
  ephemeralMediaViewMode: 0,
  duration: 10,
  width: 720,
  height: 1280
});
```

#### Standalone (no MQTT needed)

If you just need to fire off a view-once photo or video without setting up MQTT, use the `sendmedia` helpers directly with `IgApiClient`:

```javascript
const { IgApiClient, useMultiFileAuthState, sendmedia } = require('nodejs-insta-private-api-mqtt');
const fs = require('fs');

async function sendViewOncePhoto() {
  const ig = new IgApiClient();
  const auth = await useMultiFileAuthState('./auth_session');

  ig.state.usePresetDevice('iPhone 16 Pro Max');

  if (!auth.hasSession()) {
    await ig.login({ username: 'your_username', password: 'your_password' });
    await auth.saveCreds(ig);
  } else {
    await auth.loadCreds(ig);
  }

  const photoBuffer = fs.readFileSync('./secret_photo.jpg');

  const result = await sendmedia.sendRavenPhoto(ig, photoBuffer, {
    threadId: '340282366841710300949128114477782749726',
    ephemeralMediaViewMode: 0
  });
  console.log('Sent:', result.status);
}

sendViewOncePhoto().catch(console.error);
```

Works the same for video:

```javascript
const videoBuffer = fs.readFileSync('./secret_clip.mp4');

const result = await sendmedia.sendRavenVideo(ig, videoBuffer, {
  threadId: '340282366841710300949128114477782749726',
  ephemeralMediaViewMode: 0,
  duration: 10,
  width: 720,
  height: 1280
});
```

#### Low-Level: broadcastRaven (DirectThread Repository)

If you want to handle the upload step yourself and just call the broadcast, use `ig.directThread.broadcastRaven()`. You need to do the rupload first — see `sendRavenPhoto.js` for the exact upload headers and params.

```javascript
// after uploading via rupload_igphoto with direct_v2: '1' ...
const result = await ig.directThread.broadcastRaven({
  uploadId: uploadId,
  threadId: threadId,
  ephemeralMediaViewMode: 0   // 0 = view-once, 1 = replayable
});
```

---

### Notifications

#### Send Screenshot Notification

```javascript
await realtime.directCommands.sendScreenshotNotification({
  threadId: threadId,
  itemId: messageId
});
```

#### Send Replay Notification

```javascript
await realtime.directCommands.sendReplayNotification({
  threadId: threadId,
  itemId: messageId
});
```

---

### Media Upload (HTTP + Broadcast)

These methods handle the full flow: upload via HTTP rupload, then broadcast to thread.

#### Send Photo

```javascript
const fs = require('fs');
const photoBuffer = fs.readFileSync('./photo.jpg');

await realtime.directCommands.sendPhoto({
  threadId: threadId,
  photoBuffer: photoBuffer,
  caption: 'Check this out',
  mimeType: 'image/jpeg'
});
```

#### Send Video

```javascript
const fs = require('fs');
const videoBuffer = fs.readFileSync('./video.mp4');

await realtime.directCommands.sendVideo({
  threadId: threadId,
  videoBuffer: videoBuffer,
  caption: 'Watch this',
  duration: 15,
  width: 720,
  height: 1280
});
```

---

### Foreground State (Connection Keepalive)

```javascript
await realtime.directCommands.sendForegroundState({
  inForegroundApp: true,
  inForegroundDevice: true,
  keepAliveTimeout: 60
});
```

---

## Complete Method Reference Table

| Method | Description |
|--------|-------------|
| `sendText({ threadId, text })` | Send text message |
| `sendTextViaRealtime(threadId, text)` | Send text (alternative) |
| `sendHashtag({ threadId, hashtag, text })` | Send hashtag |
| `sendLike({ threadId })` | Send heart/like |
| `sendLocation({ threadId, locationId, text })` | Send location |
| `sendMedia({ threadId, mediaId, text })` | Share a post |
| `sendProfile({ threadId, userId, text })` | Share a profile |
| `sendUserStory({ threadId, storyId, text })` | Share a story |
| `sendLink({ threadId, link, text })` | Send a link |
| `sendAnimatedMedia({ threadId, id, isSticker })` | Send GIF/sticker |
| `sendVoice({ threadId, uploadId, waveform })` | Send voice message |
| `sendReaction({ threadId, itemId, emoji })` | React to message |
| `removeReaction({ threadId, itemId })` | Remove reaction |
| `replyToMessage(threadId, messageId, text)` | Quote reply |
| `editMessage(threadId, itemId, newText)` | Edit message |
| `deleteMessage(threadId, itemId)` | Delete message |
| `markAsSeen({ threadId, itemId })` | Mark as read |
| `indicateActivity({ threadId, isActive })` | Typing indicator |
| `markVisualMessageSeen({ threadId, itemId })` | Mark disappearing media seen |
| `addMemberToThread(threadId, userId)` | Add group member |
| `removeMemberFromThread(threadId, userId)` | Remove group member |
| `leaveThread(threadId)` | Leave group |
| `updateThreadTitle(threadId, title)` | Change group name |
| `muteThread(threadId, muteUntil)` | Mute thread |
| `unmuteThread(threadId)` | Unmute thread |
| `approveThread(threadId)` | Accept message request |
| `declineThread(threadId)` | Decline message request |
| `blockUserInThread(threadId, userId)` | Block user |
| `reportThread(threadId, reason)` | Report thread |
| `sendDisappearingPhoto({ threadId, uploadId })` | Send view-once photo (MQTT metadata only) |
| `sendDisappearingVideo({ threadId, uploadId })` | Send view-once video (MQTT metadata only) |
| `sendRavenPhoto({ threadId, photoBuffer, ephemeralMediaViewMode })` | Upload & send view-once photo (full flow) |
| `sendRavenVideo({ threadId, videoBuffer, ephemeralMediaViewMode })` | Upload & send view-once video (full flow) |
| `sendScreenshotNotification({ threadId, itemId })` | Screenshot alert |
| `sendReplayNotification({ threadId, itemId })` | Replay alert |
| `sendPhoto({ threadId, photoBuffer, caption })` | Upload & send photo |
| `sendVideo({ threadId, videoBuffer, caption })` | Upload & send video |
| `sendForegroundState(state)` | Connection keepalive |

---

## Download Media from Messages

This feature provides Baileys-style media download for Instagram DM messages.

### Quick Start: Save View-Once Photo

```javascript
const { 
  downloadContentFromMessage,
  isViewOnceMedia 
} = require('nodejs-insta-private-api-mqtt');
const fs = require('fs');

realtime.on('message', async (data) => {
  const msg = data.message;
  
  if (isViewOnceMedia(msg)) {
    const stream = await downloadContentFromMessage(msg);
    
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    
    const ext = stream.mediaInfo.type.includes('video') ? 'mp4' : 'jpg';
    fs.writeFileSync(`viewonce_${Date.now()}.${ext}`, buffer);
  }
});
```

### Download Regular Media

```javascript
const { downloadMediaBuffer, hasMedia } = require('nodejs-insta-private-api-mqtt');

realtime.on('message', async (data) => {
  const msg = data.message;
  
  if (hasMedia(msg)) {
    const { buffer, mediaInfo } = await downloadMediaBuffer(msg);
    fs.writeFileSync(`media_${Date.now()}.jpg`, buffer);
  }
});
```

### Media Functions Reference

| Function | Description |
|----------|-------------|
| `downloadContentFromMessage(message)` | Download as stream |
| `downloadMediaBuffer(message)` | Download as Buffer |
| `extractMediaUrls(message)` | Get CDN URLs |
| `hasMedia(message)` | Check if has media |
| `getMediaType(message)` | Get media type |
| `isViewOnceMedia(message)` | Check if disappearing |

---

## Building Instagram Bots

### Auto-Reply Bot Example

```javascript
const { IgApiClient, RealtimeClient } = require('nodejs-insta-private-api-mqtt');
const fs = require('fs');

(async () => {
  const ig = new IgApiClient();
  const session = JSON.parse(fs.readFileSync('session.json'));
  await ig.state.deserialize(session);

  const realtime = new RealtimeClient(ig);
  const inbox = await ig.direct.getInbox();
  
  await realtime.connect({
    graphQlSubs: ['ig_sub_direct', 'ig_sub_direct_v2_message_sync'],
    irisData: inbox
  });

  console.log('Bot Active\n');

  realtime.on('message', async (data) => {
    const msg = data.message;
    if (!msg?.text) return;

    console.log(`[${msg.from_user_id}]: ${msg.text}`);

    if (msg.text.toLowerCase().includes('hello')) {
      await realtime.directCommands.sendText({
        threadId: msg.thread_id,
        text: 'Hey! Thanks for reaching out!'
      });
    }
  });

  await new Promise(() => {});
})();
```

### Smart Bot with Reactions and Typing

```javascript
realtime.on('message', async (data) => {
  const msg = data.message;
  if (!msg?.text) return;

  // Mark as seen
  await realtime.directCommands.markAsSeen({
    threadId: msg.thread_id,
    itemId: msg.item_id
  });

  // Show typing
  await realtime.directCommands.indicateActivity({
    threadId: msg.thread_id,
    isActive: true
  });

  await new Promise(r => setTimeout(r, 2000));

  if (msg.text.toLowerCase().includes('hi')) {
    await realtime.directCommands.sendText({
      threadId: msg.thread_id,
      text: 'Hello there!'
    });

    // React with emoji
    await realtime.directCommands.sendReaction({
      threadId: msg.thread_id,
      itemId: msg.item_id,
      emoji: '👋'
    });
  }

  // Stop typing
  await realtime.directCommands.indicateActivity({
    threadId: msg.thread_id,
    isActive: false
  });
});
```

---

## Session Management

### Multi-File Auth State (Baileys Style)

```javascript
const authState = await useMultiFileAuthState('./auth_folder');
```

| Method | Description |
|--------|-------------|
| `hasSession()` | Check if credentials exist |
| `hasMqttSession()` | Check if MQTT session exists |
| `loadCreds(ig)` | Load saved credentials |
| `saveCreds(ig)` | Save current credentials |
| `isSessionValid(ig)` | Validate with Instagram |
| `loadMqttSession()` | Get saved MQTT session |
| `saveMqttSession(realtime)` | Save MQTT session |
| `clearSession()` | Delete all session files |

---

## API Reference

### IgApiClient

```javascript
// Login
await ig.login({
  username: 'your_username',
  password: 'your_password'
});

// Save session
const serialized = ig.state.serialize();
fs.writeFileSync('session.json', JSON.stringify(serialized));

// Load session
const session = JSON.parse(fs.readFileSync('session.json'));
await ig.state.deserialize(session);
```

### Direct Messages (REST)

```javascript
// Get inbox
const inbox = await ig.direct.getInbox();

// Get thread
const thread = await ig.direct.getThread(threadId);

// Send text by username (looks up user, finds/creates thread, sends)
await ig.direct.send({ to: 'target_username', message: 'Hello!' });

// Send text by user ID (no username lookup needed)
await ig.direct.sendToUserId('12345678', 'Hello!');

// Send text to an existing thread (by thread ID)
await ig.directThread.sendToGroup({ threadId: '340282366841710300...', message: 'Hello!' });

// Low-level broadcast (full control over payload)
await ig.directThread.broadcast({
  threadIds: ['340282366841710300...'],
  item: 'text',
  form: { text: 'Hello!' },
});
```

---

## REST API — Full Reference (v5.66.0)

Everything below uses the REST HTTP endpoints, not MQTT. You don't need `RealtimeClient` for any of this — just `IgApiClient` and a valid session.

```javascript
const { IgApiClient } = require('nodejs-insta-private-api-mqtt');
const ig = new IgApiClient();

ig.state.usePresetDevice('Samsung Galaxy S25 Ultra');
await ig.login({ username: 'your_username', password: 'your_password' });
// you're ready to use any of the methods below
```

---

### Authentication & Login

#### Basic Login

```javascript
await ig.login({ username: 'your_username', password: 'your_password' });

// or the shorter way
await ig.account.login('your_username', 'your_password');
```

#### Two-Factor Authentication (2FA)

When Instagram asks for a 2FA code, `login()` throws an error that contains the `two_factor_identifier`. Catch it and finish the flow:

```javascript
try {
  await ig.account.login('username', 'password');
} catch (err) {
  if (err.response?.body?.two_factor_required) {
    const twoFactorId = err.response.body.two_factor_info.two_factor_identifier;
    
    // user enters the code from their authenticator app or SMS
    const code = '123456';
    
    await ig.account.twoFactorLogin('username', code, twoFactorId, '1');
    // verificationMethod: '1' = SMS, '3' = TOTP app
    console.log('2FA login successful');
  }
}
```

#### TOTP Two-Factor Setup

Set up authenticator-app-based 2FA for your account. This generates a seed you can add to Google Authenticator, Authy, etc.

```javascript
// generate a TOTP seed (this is the secret key for your authenticator app)
const seed = await ig.totp.generateSeed();
console.log('Add this to your authenticator app:', seed.totp_seed);

// after adding it, verify with a code from the app to confirm
const code = '123456'; // from authenticator app
await ig.totp.enable(code);
console.log('TOTP 2FA is now enabled');

// get backup codes in case you lose your authenticator
const backupCodes = await ig.totp.getBackupCodes();
console.log('Save these somewhere safe:', backupCodes);

// disable TOTP 2FA
await ig.totp.disable();
```

#### SMS-Based 2FA

```javascript
// enable SMS 2FA
await ig.totp.smsTwoFactorEnable('+1234567890');

// confirm with the code you received
await ig.totp.smsTwoFactorConfirm('123456');

// disable it later
await ig.totp.disableSmsTwoFactor();
```

#### Challenge Resolver

When Instagram triggers a security checkpoint (suspicious login, new location, etc.), you need to resolve the challenge:

```javascript
try {
  await ig.account.login('username', 'password');
} catch (err) {
  if (err.response?.body?.challenge) {
    const challengeUrl = err.response.body.challenge.api_path;
    
    // option 1: automatic resolution (tries to handle it for you)
    const result = await ig.challenge.auto(challengeUrl);
    console.log('Challenge result:', result);
    
    // option 2: manual step-by-step
    // first, see what verification methods are available
    const page = await ig.challenge.getChallengePage(challengeUrl);
    
    // choose SMS (0) or email (1)
    await ig.challenge.selectVerifyMethod(challengeUrl, 1);
    
    // enter the code you received
    await ig.challenge.sendSecurityCode(challengeUrl, '123456');
  }
}
```

---

### Account Management

#### Get Current User Info

```javascript
const me = await ig.account.currentUser();
console.log('Username:', me.user.username);
console.log('Follower count:', me.user.follower_count);
```

#### Edit Profile

```javascript
await ig.account.editProfile({
  fullName: 'John Doe',
  biography: 'building cool stuff',
  externalUrl: 'https://example.com',
  email: 'john@example.com',
  phoneNumber: '+1234567890',
  username: 'johndoe_new'
});
```

#### Set Biography

```javascript
await ig.account.setBiography('i like building things that work');
```

#### Set External URL / Remove Bio Links

```javascript
await ig.account.setExternalUrl('https://mywebsite.com');
await ig.account.removeBioLinks();
```

#### Change Password

```javascript
await ig.account.changePassword('old_password_here', 'new_password_here');
```

#### Switch to Private / Public

```javascript
await ig.account.setPrivate();
await ig.account.setPublic();
```

#### Set Gender

```javascript
// 1 = male, 2 = female, 3 = prefer not to say, 4 = custom
await ig.account.setGender(1);
```

#### Profile Picture

```javascript
// you need an upload_id from a previous photo upload
await ig.account.profilePictureChange(uploadId);
await ig.account.profilePictureRemove();
```

#### Password Encryption Keys

```javascript
// get the public keys for Instagram's password encryption (needed for some flows)
const keys = await ig.account.passwordPublicKeys();
```

#### Account Recovery

```javascript
// send password recovery via email
await ig.account.sendRecoveryFlowEmail('user@example.com');

// or via SMS
await ig.account.sendRecoveryFlowSms('+1234567890');
```

---

### User Operations

#### Fetch User Info

```javascript
// by username
const user = await ig.user.infoByUsername('instagram');
console.log('User ID:', user.pk);
console.log('Followers:', user.follower_count);

// by user ID
const userById = await ig.user.info('25025320');
```

#### Resolve Username ↔ User ID

```javascript
const userId = await ig.user.userIdFromUsername('instagram');
// returns '25025320'

const username = await ig.user.usernameFromUserId('25025320');
// returns 'instagram'
```

#### Search Users

```javascript
const results = await ig.user.search('john', 20);
results.users.forEach(u => {
  console.log(u.username, '-', u.full_name);
});

// exact match
const exact = await ig.user.searchExact('johndoe');
```

#### Follow / Unfollow

```javascript
await ig.user.follow('25025320');
await ig.user.unfollow('25025320');
```

#### Block / Unblock

```javascript
await ig.user.block('25025320');
await ig.user.unblock('25025320');

// see all blocked users
const blocked = await ig.user.getBlockedUsers();
```

#### Mute / Unmute

```javascript
// mute posts, stories, or both
await ig.user.mute('25025320', { mutePosts: true, muteStories: true });
await ig.user.unmute('25025320', { unmutePosts: true, unmuteStories: true });
```

#### Get Followers / Following (with pagination)

```javascript
// get up to 200 followers at a time
const followers = await ig.user.getFollowers('25025320', 200);
console.log('Got', followers.users.length, 'followers');

// pagination — pass the maxId from the previous response
const moreFollowers = await ig.user.getFollowers('25025320', 200, followers.next_max_id);

// same for following
const following = await ig.user.getFollowing('25025320', 200);
```

#### Get User's Posts (with pagination)

```javascript
// grab the latest 50 posts
const posts = await ig.user.getUserMedias('25025320', 50);
posts.items.forEach(item => {
  console.log(item.pk, '-', item.caption?.text?.substring(0, 50));
});

// next page
const morePosts = await ig.user.getUserMedias('25025320', 50, posts.next_max_id);
```

#### Get User's Reels / Clips

```javascript
const reels = await ig.user.getUserReels('25025320', 50);
const clips = await ig.user.getUserClips('25025320', 50);
```

#### Get User's Stories

```javascript
const stories = await ig.user.getUserStories('25025320');
stories.reel?.items.forEach(story => {
  console.log('Story:', story.pk, 'taken at:', story.taken_at);
});
```

#### Get Tagged Posts

```javascript
const tagged = await ig.user.getUserTags('25025320');
```

#### Mutual Followers

```javascript
const mutual = await ig.user.getMutualFollowers('25025320');
```

#### Remove a Follower

```javascript
await ig.user.removeFollower('25025320');
```

#### Report a User

```javascript
// reason: 1 = spam, 2 = inappropriate, etc.
await ig.user.report('25025320', 1);
```

#### Get Suggested Users

```javascript
const suggestions = await ig.user.getSuggested();
```

#### Friendship Status (Bulk)

```javascript
// check relationship status with multiple users at once
const statuses = await ig.user.getFriendshipStatuses(['12345', '67890', '11111']);
```

---

### Media Operations

#### Get Media Info

```javascript
const info = await ig.media.info('3193593212003331660');
console.log('Type:', info.items[0].media_type);
console.log('Likes:', info.items[0].like_count);
```

#### PK / Shortcode Conversion

These are super useful when you have a post URL and need the numeric ID, or the other way around.

```javascript
const { MediaRepository } = require('nodejs-insta-private-api-mqtt');

// convert shortcode to numeric PK
const pk = MediaRepository.mediaPkFromCode('CxR7Bsejq5M');
// '3193593212003331660'

// convert PK back to shortcode
const code = MediaRepository.mediaCodeFromPk('3193593212003331660');
// 'CxR7Bsejq5M'

// extract PK directly from a full URL
const pkFromUrl = MediaRepository.mediaPkFromUrl('https://www.instagram.com/p/CxR7Bsejq5M/');
// '3193593212003331660'
```

#### Like / Unlike

```javascript
await ig.media.like('3193593212003331660');
await ig.media.unlike('3193593212003331660');
```

#### Comment

```javascript
const comment = await ig.media.comment('3193593212003331660', 'great shot!');
console.log('Comment ID:', comment.comment.pk);
```

#### Reply to a Comment

```javascript
await ig.media.replyToComment('3193593212003331660', '17858893269000001', '@user thanks!');
```

#### Like / Unlike Comments

```javascript
await ig.media.likeComment('3193593212003331660', '17858893269000001');
await ig.media.unlikeComment('3193593212003331660', '17858893269000001');
```

#### Pin / Unpin Comments

```javascript
await ig.media.pinComment('3193593212003331660', '17858893269000001');
await ig.media.unpinComment('3193593212003331660', '17858893269000001');
```

#### Delete Comments (Single or Bulk)

```javascript
// single
await ig.media.deleteComment('3193593212003331660', '17858893269000001');

// bulk delete
await ig.media.bulkDeleteComments('3193593212003331660', [
  '17858893269000001',
  '17858893269000002',
  '17858893269000003'
]);
```

#### Get Comments (Paginated)

```javascript
const comments = await ig.media.comments('3193593212003331660', null, 20);
// next page:
const moreComments = await ig.media.comments('3193593212003331660', comments.next_min_id, 20);
```

#### Get Comment Thread (Replies to a Comment)

```javascript
const thread = await ig.media.commentThreadComments('3193593212003331660', '17858893269000001');
```

#### Get Likers

```javascript
const likers = await ig.media.likers('3193593212003331660');
likers.users.forEach(u => console.log(u.username));
```

#### Save / Unsave

```javascript
await ig.media.save('3193593212003331660');

// save to a specific collection
await ig.media.save('3193593212003331660', 'collection_id_here');

await ig.media.unsave('3193593212003331660');
```

#### Archive / Unarchive

```javascript
await ig.media.archive('3193593212003331660');
await ig.media.unarchive('3193593212003331660');
```

#### Delete Media

```javascript
// mediaType: 'PHOTO', 'VIDEO', 'CAROUSEL'
await ig.media.delete('3193593212003331660', 'PHOTO');
```

#### Edit Caption

```javascript
await ig.media.edit('3193593212003331660', 'new caption goes here', {
  usertags: { in: [{ user_id: '12345', position: [0.5, 0.5] }] }
});
```

#### Enable / Disable Comments

```javascript
await ig.media.disableComments('3193593212003331660');
await ig.media.enableComments('3193593212003331660');
```

#### Download Media

```javascript
// download by URL
const buffer = await ig.media.downloadByUrl('https://instagram.cdnurl.com/...');

// download by PK (photo or video)
const photo = await ig.media.downloadPhoto('3193593212003331660');
const video = await ig.media.downloadVideo('3193593212003331660');
```

#### oEmbed

```javascript
const oembed = await ig.media.oembed('https://www.instagram.com/p/CxR7Bsejq5M/');
console.log(oembed.title, '-', oembed.author_name);
```

#### Get User Who Posted a Media

```javascript
const user = await ig.media.getUser('3193593212003331660');
```

---

### Reels / Clips

Upload and browse Reels through the REST API.

#### Upload a Reel

```javascript
const result = await ig.clip.upload({
  videoBuffer: fs.readFileSync('./reel.mp4'),
  caption: 'check this out',
  coverImage: fs.readFileSync('./cover.jpg'), // optional
  duration: 15,
  width: 1080,
  height: 1920,
  audisMuted: false,
});
console.log('Reel PK:', result.media?.pk);
```

#### Configure a Video as Reel (after uploading separately)

```javascript
const configured = await ig.clip.configure({
  upload_id: uploadId,
  caption: 'my reel',
  duration: 15,
  width: 1080,
  height: 1920,
});
```

#### Discover Reels / Connected Reels

```javascript
// the explore-style reels feed
const discover = await ig.clip.discoverReels(10);
discover.items.forEach(reel => {
  console.log(reel.media.code, '-', reel.media.caption?.text?.substring(0, 40));
});

// paginate
const more = await ig.clip.discoverReels(10, discover.paging_info?.max_id);

// connected reels (similar reels after watching one)
const connected = await ig.clip.connectedReels(10);
```

#### Download a Reel

```javascript
const reelBuffer = await ig.clip.download('3193593212003331660');

// or from URL
const reelFromUrl = await ig.clip.downloadByUrl('https://instagram.cdnurl.com/...');
```

#### Get Music Info for Reels

```javascript
const music = await ig.clip.musicInfo({ music_canonical_id: '12345' });
```

---

### Stories

#### Get Your Story Feed (Tray)

```javascript
const tray = await ig.story.getFeed();
tray.tray.forEach(reel => {
  console.log(reel.user.username, '- stories:', reel.media_count);
});
```

#### Get Someone's Stories

```javascript
const stories = await ig.story.getUserStories('25025320');
stories.reel?.items.forEach(item => {
  console.log('Type:', item.media_type, 'Taken at:', item.taken_at);
});
```

#### Upload a Photo Story

```javascript
const result = await ig.story.upload({
  file: fs.readFileSync('./story.jpg'),
  caption: 'hello world', // optional
});
console.log('Story ID:', result.media?.pk);
```

#### Upload a Video Story

```javascript
const result = await ig.story.uploadVideo({
  file: fs.readFileSync('./story.mp4'),
  duration: 10,
  width: 1080,
  height: 1920,
});
```

#### Mark Stories as Seen

```javascript
await ig.story.seen([
  { id: 'media_id_1', taken_at: 1700000000, user: { pk: '25025320' } }
]);
```

#### React to a Story

```javascript
await ig.story.react({
  mediaId: '3193593212003331660',
  reelId: '25025320',
  emoji: '🔥'
});
```

---

### Highlights

#### Get User's Highlights

```javascript
const highlights = await ig.highlights.getHighlightsTray('25025320');
highlights.tray.forEach(h => {
  console.log(h.id, '-', h.title);
});
```

#### Get a Specific Highlight

```javascript
const highlight = await ig.highlights.getHighlight('highlight:12345678');
```

#### Create a Highlight

```javascript
await ig.highlights.create('My Trip', ['story_id_1', 'story_id_2'], 'cover_media_id');
```

#### Edit a Highlight

```javascript
await ig.highlights.edit('highlight_id', 'Updated Title', ['new_story_id']);
```

#### Add / Remove Stories from Highlight

```javascript
await ig.highlights.addStories('highlight_id', ['story_id_3', 'story_id_4']);
await ig.highlights.removeStories('highlight_id', ['story_id_1']);
```

#### Update Highlight Cover

```javascript
await ig.highlights.updateCover('highlight_id', 'cover_media_id');
```

#### Delete a Highlight

```javascript
await ig.highlights.delete('highlight_id');
```

---

### Upload & Configure Media

#### Upload a Photo Post

```javascript
const upload = await ig.upload.photo({
  file: fs.readFileSync('./photo.jpg'),
});

const post = await ig.upload.configurePhoto({
  upload_id: upload.upload_id,
  caption: 'sunset vibes',
  usertags: {
    in: [{ user_id: '12345', position: [0.5, 0.5] }]
  }
});
console.log('Posted! PK:', post.media?.pk);
```

#### Upload a Video Post

```javascript
const upload = await ig.upload.video({
  file: fs.readFileSync('./video.mp4'),
  duration: 30,
  width: 1080,
  height: 1920,
});

const post = await ig.upload.configureVideo({
  upload_id: upload.upload_id,
  caption: 'check this clip',
  duration: 30,
  width: 1080,
  height: 1920,
});
```

#### Configure as Reel (Clips)

```javascript
const reel = await ig.upload.configureToClips({
  upload_id: upload.upload_id,
  caption: 'my first reel',
  duration: 15,
  width: 1080,
  height: 1920,
});
```

#### Configure as Story

```javascript
const story = await ig.upload.configureToStory({
  upload_id: upload.upload_id,
});
```

#### Upload a Carousel (Multiple Photos/Videos)

```javascript
const carousel = await ig.feed.uploadCarousel({
  caption: 'summer trip highlights',
  children: [
    { type: 'photo', file: fs.readFileSync('./pic1.jpg') },
    { type: 'photo', file: fs.readFileSync('./pic2.jpg') },
    { type: 'video', file: fs.readFileSync('./vid1.mp4'), duration: 10, width: 1080, height: 1080 },
  ]
});
```

---

### Feed

#### Home Timeline

```javascript
const feed = await ig.timeline.getFeed();
feed.feed_items?.forEach(item => {
  const media = item.media_or_ad;
  if (media) console.log(media.user.username, '-', media.caption?.text?.substring(0, 40));
});
```

#### Hashtag Feed

```javascript
const tagFeed = await ig.feed.getTag('photography');
```

#### Location Feed

```javascript
const locFeed = await ig.feed.getLocation('213385402');
```

#### Liked Posts

```javascript
const liked = await ig.feed.getLiked();
```

#### Saved Posts

```javascript
const saved = await ig.feed.getSaved();
```

#### Reels Tray (Stories of People You Follow)

```javascript
const tray = await ig.feed.reelsTray();
```

#### Explore Feed

```javascript
const explore = await ig.feed.getExploreFeed();
```

#### Reels Feed

```javascript
const reels = await ig.feed.getReelsFeed();
const userReels = await ig.feed.getUserReelsFeed('25025320');
```

#### Reels Media (Bulk)

```javascript
// get stories for multiple users at once
const reelsMedia = await ig.feed.reelsMedia(['25025320', '12345678']);
```

---

### Timeline (Reels)

```javascript
// get reels from your timeline
const reels = await ig.timeline.reels(10);

// explore reels
const exploreReels = await ig.timeline.exploreReels(10);
```

---

### Direct Messages (REST API)

The REST-based DM methods. These work without MQTT — they're regular HTTP requests.

#### Get Inbox

```javascript
const inbox = await ig.direct.getInbox();
inbox.inbox.threads.forEach(t => {
  console.log(t.thread_title || t.users[0]?.username, '- last:', t.last_permanent_item?.text);
});

// paginate
const page2 = await ig.direct.getInbox(inbox.inbox.oldest_cursor, 20);
```

#### Pending Inbox (Message Requests)

```javascript
const pending = await ig.direct.getPendingInbox();
```

#### Get a Thread

```javascript
const thread = await ig.direct.getThread(threadId);
thread.thread.items.forEach(msg => {
  console.log(msg.user_id, ':', msg.text || `[${msg.item_type}]`);
});
```

#### Send Text via REST

There are multiple ways to send a text message via the REST API:

```javascript
// Method 1: By username (auto-resolves user ID and thread)
await ig.direct.send({ to: 'target_username', message: 'hey there!' });

// Method 2: By user ID (skips username lookup)
await ig.direct.sendToUserId('25025320', 'hey there!');

// Method 3: By thread ID (for existing conversations / groups)
await ig.directThread.sendToGroup({ threadId: threadId, message: 'hey there!' });

// Method 4: Low-level broadcast (full control)
// Use threadIds to send to existing threads:
await ig.directThread.broadcast({
  threadIds: [threadId],
  item: 'text',
  form: { text: 'hey there!' },
});

// Or use userIds to send to users directly (creates thread if needed):
await ig.directThread.broadcast({
  userIds: ['25025320'],
  item: 'text',
  form: { text: 'hey there!' },
});
```

#### Send Photo / Video / Link via REST

All convenience methods use `to` (Instagram username) to identify the recipient:

```javascript
await ig.direct.sendImage({
  to: 'target_username',
  imagePath: './photo.jpg',
});

await ig.direct.sendVideo({
  to: 'target_username',
  videoPath: './video.mp4',
});

await ig.direct.sendLink({
  to: 'target_username',
  text: 'check this out',
  urls: ['https://example.com'],
});
```

#### Share Media / Profile / Hashtag / Location

```javascript
await ig.direct.sendMediaShare({ to: 'target_username', mediaId: '3193593212003331660' });
await ig.direct.sendProfile({ to: 'target_username', profileUserId: '25025320' });
await ig.direct.sendHashtag({ to: 'target_username', hashtag: 'photography' });
await ig.direct.sendLocation({ to: 'target_username', locationId: '213385402' });
```

#### Create a Group Thread

```javascript
const group = await ig.direct.createGroupThread(['user_id_1', 'user_id_2'], 'Project Team');
console.log('Thread ID:', group.thread_id);
```

#### Ranked Recipients (Who to Message)

```javascript
const recipients = await ig.direct.rankedRecipients('raven', 'john');
```

#### Get Presence

```javascript
const presence = await ig.direct.getPresence();
```

#### Mark as Seen / Hide Thread

```javascript
await ig.direct.markAsSeen(threadId, itemId);
await ig.direct.hideThread(threadId);
```

#### Send Raven (View-Once) Photo / Video via REST

Send disappearing photos and videos in DMs. These use the REST endpoint, no MQTT needed. The `sendmedia` helpers handle the full flow — upload via rupload + broadcast via `/direct_v2/threads/broadcast/raven_attachment/` — in a single call.

```javascript
const { sendmedia } = require('nodejs-insta-private-api-mqtt');
const fs = require('fs');

// view-once photo (disappears after one view)
const photoBuffer = fs.readFileSync('./secret.jpg');
await sendmedia.sendRavenPhoto(ig, photoBuffer, {
  threadId: threadId,
  ephemeralMediaViewMode: 0   // 0 = view-once, 1 = replayable
});

// replayable video (can replay, still disappears)
const videoBuffer = fs.readFileSync('./secret_clip.mp4');
await sendmedia.sendRavenVideo(ig, videoBuffer, {
  threadId: threadId,
  ephemeralMediaViewMode: 1,
  duration: 8,
  width: 720,
  height: 1280
});
```

---

### Friendship Management

#### Follow / Unfollow

```javascript
await ig.friendship.create('25025320');  // follow
await ig.friendship.destroy('25025320'); // unfollow
```

#### Check Friendship Status

```javascript
const status = await ig.friendship.show('25025320');
console.log('Following:', status.following);
console.log('Followed by:', status.followed_by);
console.log('Blocking:', status.blocking);

// bulk check
const many = await ig.friendship.showMany(['12345', '67890']);
```

#### Approve / Ignore Follow Requests

```javascript
await ig.friendship.approve('25025320');
await ig.friendship.ignore('25025320');

// list pending requests
const pending = await ig.friendship.getPendingRequests();
```

#### Block / Unblock

```javascript
await ig.friendship.block('25025320');
await ig.friendship.unblock('25025320');

const blocked = await ig.friendship.getBlockedUsers();
```

#### Restrict / Unrestrict

```javascript
await ig.friendship.restrict('25025320');
await ig.friendship.unrestrict('25025320');
```

#### Mute / Unmute

```javascript
await ig.friendship.mute('25025320', { muteStories: true, mutePosts: true });
await ig.friendship.unmute('25025320', { unmuteStories: true, unmutePosts: true });
```

#### Close Friends / Besties

```javascript
// add someone to close friends
await ig.friendship.setCloseFriend('25025320', true);
// remove
await ig.friendship.setCloseFriend('25025320', false);

// bulk update close friends list
await ig.friendship.setBesties(['user1', 'user2'], ['user3']); // add, remove
```

#### Favorites

```javascript
await ig.friendship.setFavorite('25025320');
await ig.friendship.unsetFavorite('25025320');

const favorites = await ig.friendship.getFavoriteFriends();
```

#### Remove Follower

```javascript
await ig.friendship.removeFollower('25025320');
```

#### Get Followers / Following

```javascript
const followers = await ig.friendship.getFollowers('25025320');
const following = await ig.friendship.getFollowing('25025320');
const mutual = await ig.friendship.getMutuafFollowers('25025320');
```

---

### Search (FBSearch)

Instagram's unified search endpoint. Covers users, hashtags, places, and music.

#### Top Search (All Types)

```javascript
const results = await ig.fbsearch.topSearch('coffee shop');
console.log('Users:', results.users?.length);
console.log('Places:', results.places?.length);
console.log('Hashtags:', results.hashtags?.length);

// flat version (simpler output)
const flat = await ig.fbsearch.topSearchFlat('coffee', 30);
```

#### Search by Type

```javascript
const users = await ig.fbsearch.searchUsers('johndoe', 20);
const hashtags = await ig.fbsearch.searchHashtags('photography', 20);
const places = await ig.fbsearch.searchPlaces('new york');
const music = await ig.fbsearch.searchMusic('trending');
```

#### Search History

```javascript
const recent = await ig.fbsearch.getRecentSearches();

// clear it
await ig.fbsearch.clearRecentSearches();

// manually add something to recent searches
await ig.fbsearch.registerRecentSearch('25025320', 'user');
```

#### Suggested Searches

```javascript
const suggested = await ig.fbsearch.getSuggestedSearches('users');
```

#### Null State (Default Explore)

```javascript
const nullState = await ig.fbsearch.nullStateDynamic();
```

---

### Explore

#### Topical Explore

```javascript
const explore = await ig.explore.topicalExplore({
  module: 'explore_popular',
  cluster_id: 'explore_all:0',
});

// basic explore
const basic = await ig.explore.explore();
// paginate
const page2 = await ig.explore.explore(basic.next_max_id);
```

#### Report Explore Media

```javascript
await ig.explore.reportExploreMedia('3193593212003331660', 1);
```

#### Mark Explore as Seen

```javascript
await ig.explore.markAsSeen();
```

---

### Notes

Instagram Notes — the little status messages that show up in the DM tab.

```javascript
// get all notes from people you follow
const notes = await ig.note.getNotes();
const followingNotes = await ig.note.getNotesFollowing();

// create a note (audience: 0 = followers, 1 = close friends)
await ig.note.createNote('currently building something cool', 0);

// delete your note
await ig.note.deleteNote('note_id_here');

// mark notes as seen
await ig.note.lastSeenUpdateNote();
```

---

### Insights (Business/Creator Accounts)

Requires a business or creator account.

```javascript
// account-level insights
const accountInsights = await ig.insights.account({
  ig_drop_table: 'is_feed',
  follower_type: 'followers',
  timeframe: 'one_week',
  query_params: JSON.stringify({ access_token: '', id: '' })
});

// insights for a specific post
const mediaInsights = await ig.insights.media('3193593212003331660');

// reel insights
const reelInsights = await ig.insights.reelInsights('3193593212003331660');

// story insights
const storyInsights = await ig.insights.storyInsights('3193593212003331660');

// all media feed insights
const allMedia = await ig.insights.mediaFeedAll({ count: 20 });
```

---

### Notifications

Fine-grained control over push notification settings.

```javascript
// mute all notifications for 8 hours
await ig.notification.muteAll('8_hour');

// disable all notifications
await ig.notification.disableAll();

// control individual notification types
await ig.notification.likes('off');
await ig.notification.comments('off');
await ig.notification.newFollower('off');
await ig.notification.commentLikes('off');
await ig.notification.directShareActivity('off');
await ig.notification.login('off');
await ig.notification.reminders('off');

// and many more: userTagged, firstPost, followRequestAccepted,
// connection, taggedInBio, pendingDirectShare, directGroupRequests,
// fundraiserSupporter, announcements, reportUpdated...
```

---

### Music / Audio Tracks

```javascript
// search for music
const tracks = await ig.track.search('trending pop');

// get track info
const trackInfo = await ig.track.infoById('track_id_here');
const trackByCanonical = await ig.track.infoByCanonicalId('canonical_id');

// download audio
const audioBuffer = await ig.track.downloadByUrl('https://instagram.cdnurl.com/...');
```

---

### Signup (Account Creation)

Programmatic account creation flow.

```javascript
// check if email/username is available
const emailCheck = await ig.signup.checkEmail('user@example.com');
const usernameCheck = await ig.signup.checkUsername('desired_username');

// get signup config
const config = await ig.signup.getSignupConfig();

// check age eligibility
await ig.signup.checkAgeEligibility(1995, 6, 15);

// send verification email and confirm
await ig.signup.sendVerifyEmail('user@example.com');
await ig.signup.checkConfirmationCode('user@example.com', '123456');

// phone-based signup
await ig.signup.sendSignupSmsCode('+1234567890');
await ig.signup.validateSignupSmsCode('+1234567890', '123456');

// get username suggestions
const suggestions = await ig.signup.getSuggestedUsernames('John Doe', 'john@example.com');

// create the account
const newAccount = await ig.signup.accountsCreate({
  username: 'johndoe_2026',
  password: 'securepassword123',
  email: 'john@example.com',
  first_name: 'John',
});
```

---

### Multiple Accounts

```javascript
const family = await ig.multipleAccounts.getAccountFamily();
const featured = await ig.multipleAccounts.getFeaturedAccounts();
const info = await ig.multipleAccounts.getAccountInfo();

// switch to another logged-in account
await ig.multipleAccounts.switchAccount('other_user_id');
```

---

### Fundraiser

```javascript
// get fundraiser info
const info = await ig.fundraiser.standaloneFundraiserInfo('fundraiser_pk');

// create a charity fundraiser
const fundraiser = await ig.fundraiser.createCharityFundraiser({
  title: 'Help Local School',
  description: 'Raising funds for supplies',
  charity_id: 'charity_pk',
  goal_amount: 5000,
});

// donate
await ig.fundraiser.donateFundraiser('fundraiser_pk', 25);
```

---

### Captcha / Challenge Forms

```javascript
// get challenge form (when Instagram shows a captcha)
const form = await ig.captcha.getChallengeForm('/api/v1/challenge/1234/');

// submit reCAPTCHA or hCaptcha response
await ig.captcha.submitRecaptchaResponse('/api/v1/challenge/1234/', 'recaptcha_token');
await ig.captcha.submitHCaptchaResponse('/api/v1/challenge/1234/', 'hcaptcha_token');
```

---

### Share / URL Parsing

```javascript
// decode a share code (from QR codes, NFC tags, etc.)
const info = ig.share.shareInfo('base64_encoded_code');
// returns { type: 'user', pk: '25025320' }

// parse from URL
const fromUrl = ig.share.shareInfoByUrl('https://www.instagram.com/share/abc123');

// extract share code from URL
const code = ig.share.shareCodeFromUrl('https://www.instagram.com/share/abc123');
```

---

### Bloks (Instagram Bloks Engine)

Low-level access to Instagram's Bloks framework. Used internally by some flows.

```javascript
await ig.bloks.action({
  action_name: 'some.action.name',
  params: { key: 'value' }
});

const layout = await ig.bloks.getLayoutData({
  layout_name: 'layout.name',
  params: {}
});

// bloks-based password change
await ig.bloks.changePassword('old_pass', 'new_pass');
```

---

### Complete REST Repository Reference

Here's every repository and what it covers at a glance.

| Repository | Access | What it does |
|------------|--------|--------------|
| `ig.account` | Account management | Login, 2FA, edit profile, change password, privacy |
| `ig.user` | User operations | Info, search, follow, block, mute, get medias/reels/stories |
| `ig.media` | Media operations | Like, comment, pin, delete, save, archive, download |
| `ig.clip` | Reels / Clips | Upload, discover, download reels |
| `ig.story` | Stories | Upload, view, react, highlights |
| `ig.highlights` | Highlights | Create, edit, delete, manage cover |
| `ig.feed` | Content feeds | Timeline, hashtag, location, saved, liked, explore |
| `ig.timeline` | Timeline reels | Reels feed, explore reels |
| `ig.upload` | Upload & configure | Photo/video upload, configure to feed/story/clips |
| `ig.direct` | Direct messages | Inbox, send text/media/links, raven (view-once), group threads |
| `ig.friendship` | Relationships | Follow, block, restrict, close friends, favorites |
| `ig.fbsearch` | Search | Users, hashtags, places, music, search history |
| `ig.explore` | Explore page | Topical explore, report, mark seen |
| `ig.insights` | Analytics | Account, media, reel, story insights |
| `ig.note` | Notes | Create, delete, view notes |
| `ig.notification` | Notification settings | Enable/disable per-type notifications |
| `ig.totp` | 2FA management | TOTP setup, SMS 2FA, backup codes |
| `ig.challenge` | Challenge resolver | Auto-resolve, verify methods, security codes |
| `ig.signup` | Account creation | Email/phone verification, username check, create account |
| `ig.track` | Music / Audio | Search tracks, get info, download |
| `ig.share` | Share codes | Decode QR/NFC share codes, parse URLs |
| `ig.bloks` | Bloks engine | Low-level Instagram UI actions |
| `ig.fundraiser` | Fundraisers | Create, donate, get info |
| `ig.multipleAccounts` | Multi-account | Switch accounts, account family |
| `ig.captcha` | Captcha handling | reCAPTCHA / hCaptcha submission |
| `ig.location` | Locations | Location search and info |
| `ig.hashtag` | Hashtags | Hashtag info and feed |
| `ig.news` | Activity feed | Activity inbox |
| `ig.collection` | Collections | Saved collections management |
| `ig.closeFriends` | Close friends | Close friends list management |

---

### RealtimeClient Events

| Event | Description |
|-------|-------------|
| `connected` | MQTT connected |
| `disconnected` | MQTT disconnected |
| `message` | New message received |
| `message_live` | Live message with parsed data |
| `typing` | Typing indicator |
| `presence` | User presence update |
| `error` | Connection error |
| `warning` | Non-fatal issue (payload errors, etc.) |
| `reconnected` | Successfully reconnected after a drop |
| `reconnect_failed` | All reconnect attempts exhausted |
| `auth_failure` | 3+ consecutive authentication errors (credentials likely expired) |

### Advanced Real-time Events (instagram_mqtt compatible)

These events provide deeper access to Instagram's MQTT protocol. They were added for full compatibility with the instagram_mqtt library.

| Event | Description |
|-------|-------------|
| `realtimeSub` | Raw realtime subscription data (all MQTT messages) |
| `direct` | Direct message events with parsed data |
| `subscription` | Legacy subscription event (backwards compatible) |
| `directTyping` | When someone is typing in a DM thread |
| `appPresence` | User online/offline status updates |
| `directStatus` | DM thread status changes |
| `liveWave` | Instagram Live wave notifications |
| `liveRealtimeComments` | Real-time comments on Instagram Live |
| `liveTypingIndicator` | Typing indicator in Live comments |
| `mediaFeedback` | Media engagement feedback |
| `clientConfigUpdate` | Client configuration updates |

#### Using the realtimeSub Event

The `realtimeSub` event gives you access to all raw MQTT messages. This is useful for debugging or implementing custom message handling:

```javascript
realtime.on('realtimeSub', ({ data, topic }) => {
  console.log('Raw MQTT data received:', data);
  console.log('Topic:', topic);
});
```

#### Using the direct Event

The `direct` event provides parsed direct message updates with automatic JSON parsing of nested values:

```javascript
realtime.on('direct', (data) => {
  console.log('Direct update:', data);
  
  // data.op contains the operation type (e.g., 'add', 'replace', 'remove')
  // data.path contains the affected path
  // data.value contains the parsed message data
  
  if (data.op === 'add' && data.value) {
    console.log('New message:', data.value.text);
  }
});
```

#### Using QueryID-based Events

These events are automatically emitted when Instagram sends specific subscription updates:

```javascript
// Listen for typing indicators
realtime.on('directTyping', (data) => {
  console.log('User is typing:', data);
});

// Listen for presence updates (online/offline status)
realtime.on('appPresence', (data) => {
  console.log('Presence update:', data);
});

// Listen for DM status changes
realtime.on('directStatus', (data) => {
  console.log('Direct status changed:', data);
});

// Listen for Instagram Live comments
realtime.on('liveRealtimeComments', (data) => {
  console.log('Live comment:', data);
});
```

#### Complete Example: Multi-Event Listener

Here's a complete example showing how to listen to multiple events:

```javascript
const { IgApiClient, RealtimeClient, useMultiFileAuthState } = require('nodejs-insta-private-api-mqtt');

async function startAdvancedBot() {
  const ig = new IgApiClient();
  const auth = await useMultiFileAuthState('./auth_info_ig');
  
  ig.state.usePresetDevice('Samsung Galaxy S25 Ultra');
  
  const realtime = new RealtimeClient(ig);

  // Standard message handling
  realtime.on('message_live', (msg) => {
    console.log(`[${msg.username}]: ${msg.text}`);
  });

  // Advanced: Raw MQTT data (useful for debugging)
  realtime.on('realtimeSub', ({ data }) => {
    console.log('[Debug] Raw MQTT:', JSON.stringify(data).substring(0, 200));
  });

  // Direct message updates with parsed data
  realtime.on('direct', (data) => {
    if (data.op === 'add') {
      console.log('[Direct] New item added');
    }
  });

  // Typing indicators
  realtime.on('directTyping', (data) => {
    console.log('[Typing] Someone is typing...');
  });

  // User presence (online/offline)
  realtime.on('appPresence', (data) => {
    console.log('[Presence] User status changed');
  });

  // Login and connect
  if (!auth.hasSession()) {
    await ig.login({
      username: 'your_username',
      password: 'your_password'
    });
    await auth.saveCreds(ig);
  } else {
    await auth.loadCreds(ig);
  }

  await realtime.startRealTimeListener();
  
  console.log('Advanced bot with full MQTT events is running!');
}

startAdvancedBot().catch(console.error);
```

---

## Important Notes

### Media Uploads

Media files (photos, videos) are always uploaded via HTTP rupload first. MQTT only sends metadata/references, never the raw bytes. The `sendPhoto()` and `sendVideo()` methods handle this automatically. Same applies to raven (view-once) media — `sendRavenPhoto()` and `sendRavenVideo()` upload via rupload with a `direct_v2: '1'` flag, then broadcast through the REST endpoint.

### Rate Limiting

Instagram has strict rate limits. Add delays between rapid-fire messages to avoid temporary bans.

### Session Persistence

Always save your session after login to avoid repeated logins which can trigger verification.

---

## February 2026 Update - Stability & Compatibility Overhaul

This update focuses on long-term MQTT stability. If you've been getting random disconnections or rate limit bans, most of that should be gone now. Here's what changed and how to use the new stuff.

### What's New

- **Smart error handling** - errors are now classified (rate limit, auth, network, etc.) and each type gets its own backoff strategy
- **Reconnect manager** - smarter reconnection that knows *why* it disconnected and adjusts accordingly
- **Session persistence helpers** - `IgApiClientExt` with `exportState()` / `importState()` for dead-simple session save/restore
- **Convenience wrappers** - `withRealtime()`, `withFbns()`, `withFbnsAndRealtime()` to set up clients in one line
- **Message ordering** - automatic per-thread message queue so multi-message sends always arrive in order
- **Subscription exports** - `GraphQLSubscriptions`, `SkywalkerSubscriptions`, `QueryIDs` now exported for custom subscription setups
- **Topic listener cleanup** - `listen()` now returns an unsubscribe function
- **FBNS push notifications** - `FbnsClient` fully working out of the box (no extra packages needed)
- **Low-level MQTT access** - `MQTToTClient`, `MQTToTConnection`, `mqttotConnectFlow` exported for advanced use
- **Updated fingerprint** - Instagram version `415.0.0.36.76`, Samsung Galaxy S24 device profile
- **Keepalive rewrite** - from 4 overlapping timers down to 2 + a watchdog, way less suspicious traffic

---

## Intelligent Error Handling

The old error handler just retried everything with the same delay. The new one actually looks at *what* went wrong and reacts differently depending on the error type.

### Error Types

| Type | Triggers On | Base Delay | Max Delay | Multiplier |
|------|-------------|------------|-----------|------------|
| `rate_limit` | "too many requests", "action blocked", 429 | 60s | 10 min | 1.5x |
| `auth_failure` | "login_required", "checkpoint", 401, 403 | 10s | 2 min | 2x |
| `network` | ECONNRESET, ETIMEDOUT, DNS failures | 2s | 1 min | 2x |
| `server` | 500, 502, 503 | 5s | 2 min | 2x |
| `protocol` | Thrift parse errors, CONNACK issues | 5s | 1 min | 2x |

All delays include random jitter (0-2s) to prevent multiple bots from hammering the server at the same time.

### Listening for Error Events

```javascript
const { IgApiClient, RealtimeClient } = require('nodejs-insta-private-api-mqtt');

const ig = new IgApiClient();
const realtime = new RealtimeClient(ig);

// fires after 3 consecutive auth failures - probably time to re-login
realtime.on('auth_failure', ({ count, error }) => {
  console.log(`Auth failed ${count} times: ${error}`);
  console.log('Session is probably expired, need to login again');
  // your re-login logic here
});

// fires when all 15 retry attempts are used up
realtime.on('error', (err) => {
  if (err.message.includes('Max retries')) {
    console.log('Gave up reconnecting. Maybe restart the process.');
  }
});

// non-fatal stuff - good to log but usually not actionable
realtime.on('warning', ({ type, topic, error }) => {
  console.log(`Warning [${type}] on ${topic}: ${error}`);
});
```

### Checking Error Stats

The error handler keeps a rolling history of the last 50 errors. Handy for dashboards or diagnostics:

```javascript
// after connecting...
const stats = realtime.errorHandler.getErrorStats();
console.log('Total errors:', stats.errorCount);
console.log('Can still retry:', stats.canRetry);
console.log('Currently rate limited:', stats.isRateLimited);
console.log('Rate limit expires in:', stats.rateLimitRemainingMs, 'ms');
console.log('Breakdown by type:', stats.typeBreakdown);
// e.g. { network: 2, rate_limit: 1 }
```

---

## Smart Reconnection

The `ReconnectManager` works together with the error handler. When the connection drops, it doesn't just blindly retry - it checks what kind of error caused the disconnect and adjusts the backoff.

- **Rate limit errors**: 3x multiplier (backs off aggressively to avoid making things worse)
- **Auth failures**: 2.5x multiplier (slower, gives time for token refresh)
- **Everything else**: 2x multiplier (standard exponential backoff)

All delays include up to 30% jitter so if you're running multiple bots they don't all reconnect at the exact same second.

```javascript
realtime.on('reconnected', () => {
  console.log('Back online after a disconnect');
});

realtime.on('reconnect_failed', () => {
  console.log('Could not reconnect after all attempts');
  // maybe send yourself a notification, restart the process, etc.
});
```

You don't need to configure any of this - it's all automatic. The RealtimeClient uses the ErrorHandler + ReconnectManager for high-level reconnection, while MQTToTClient has its own low-level reconnect loop for transport-level drops. They work independently but cover different failure scenarios.

---

## Session Persistence with IgApiClientExt

If you're coming from `instagram_mqtt`, you might be used to `withRealtime()` and `exportState()`. We've got those now.

### Basic Usage - exportState / importState

```javascript
const { IgApiClientExt } = require('nodejs-insta-private-api-mqtt');
const fs = require('fs');

const ig = new IgApiClientExt();

// first run - login and save
await ig.login({ username: 'myuser', password: 'mypass' });
const state = await ig.exportState();
fs.writeFileSync('saved_state.json', state);

// next run - restore from file
const ig2 = new IgApiClientExt();
const saved = fs.readFileSync('saved_state.json', 'utf8');
await ig2.importState(saved);
// ig2 is now logged in, no need to call login() again
```

`exportState()` serializes the entire client state (cookies, tokens, device info) through a hook system. You can add your own hooks if you need to persist additional data:

```javascript
ig.addStateHook({
  name: 'myCustomData',
  onExport: async (client) => {
    return { lastSyncTime: Date.now(), someConfig: 'value' };
  },
  onImport: async (data, client) => {
    console.log('Restoring custom data:', data);
    // do whatever you need with the restored data
  }
});
```

### withRealtime() - Attach RealtimeClient in One Line

```javascript
const { IgApiClient, withRealtime } = require('nodejs-insta-private-api-mqtt');

const ig = new IgApiClient();
// this upgrades ig to IgApiClientExt and adds a lazy .realtime property
const client = withRealtime(ig);

await client.login({ username: 'myuser', password: 'mypass' });

// .realtime is created lazily - only when you first access it
client.realtime.on('message_live', (msg) => {
  console.log(`${msg.username}: ${msg.text}`);
});

await client.realtime.startRealTimeListener();

// and since it's an IgApiClientExt, you can export the full state
const state = await client.exportState();
```

**Note:** `withRealtime()` doesn't create the RealtimeClient immediately. It sets up a lazy getter, so the client is only instantiated when you first access `client.realtime`. No surprise connections.

### withFbns() - Push Notifications

Attach FBNS (Facebook Notification Service) for push notifications. The FBNS auth state is automatically included when you call `exportState()`, so you don't need to re-authenticate every time you restart:

```javascript
const { IgApiClient, withFbns } = require('nodejs-insta-private-api-mqtt');

const ig = new IgApiClient();
const client = withFbns(ig);

// client.fbns is now available
// FBNS auth state is automatically included in exportState()
```

### withFbnsAndRealtime() - Everything at Once

```javascript
const { IgApiClient, withFbnsAndRealtime } = require('nodejs-insta-private-api-mqtt');

const ig = new IgApiClient();
const client = withFbnsAndRealtime(ig);

// client.realtime -> RealtimeClient (lazy)
// client.fbns -> FbnsClient (ready to use, no extra packages needed)
// client.exportState() / client.importState() -> full state persistence
```

### Upgrading an Existing IgApiClient

All the `with*` functions work on existing `IgApiClient` instances. They use `Object.setPrototypeOf` internally, so your existing event listeners, state, and references are all preserved - nothing gets copied or lost.

```javascript
const ig = new IgApiClient();
ig.state.usePresetDevice('Samsung Galaxy S25 Ultra');
await ig.login({ username: 'user', password: 'pass' });

// this is safe - ig keeps all its internal state
const upgraded = withRealtime(ig);
// upgraded === ig (same object, just with extra methods now)
```

---

## Automatic Message Ordering (Transactions)

Ever sent 3 messages in a row and they showed up in the wrong order on Instagram? That's because MQTT doesn't guarantee delivery order. This library fixes that automatically.

When RealtimeClient starts up, it wraps `directCommands` methods with per-thread queues (using `p-queue` with `concurrency: 1`). So if you do:

```javascript
await realtime.directCommands.sendText({ threadId: thread, text: 'Hey' });
await realtime.directCommands.sendText({ threadId: thread, text: 'How are you?' });
await realtime.directCommands.sendText({ threadId: thread, text: 'Check this out' });
```

They will **always** arrive in that exact order on Instagram's side, even if some of them take longer to deliver than others. This happens transparently - you don't need to write any extra code.

The queue is per-thread, so messages to different threads can still go out in parallel. Only messages within the same thread are serialized.

**Methods that are queued:** `sendText`, `sendLink`, `sendPhoto`, `sendVideo`, `sendVoice`, `sendLike`, `sendPost`

---

## GraphQL & Skywalker Subscriptions

These are now exported so you can build custom subscription configurations instead of relying on the defaults.

```javascript
const {
  GraphQLSubscriptions,
  SkywalkerSubscriptions,
  QueryIDs
} = require('nodejs-insta-private-api-mqtt');

// GraphQLSubscriptions has factory methods for each subscription type
const directSub = GraphQLSubscriptions.getDirectTypingSubscription('your_user_id');
const presenceSub = GraphQLSubscriptions.getAppPresenceSubscription();

// SkywalkerSubscriptions works the same way
const liveSub = SkywalkerSubscriptions.directSub('your_user_id');

// QueryIDs contains the numeric IDs Instagram uses internally
// useful if you need to match incoming messages to subscription types
console.log(QueryIDs);
```

### Using Custom Subscriptions with connect()

```javascript
const realtime = new RealtimeClient(ig);

await realtime.connect({
  graphQlSubs: [
    GraphQLSubscriptions.getDirectTypingSubscription(ig.state.userId),
    GraphQLSubscriptions.getAppPresenceSubscription(),
  ],
  skywalkerSubs: [
    SkywalkerSubscriptions.directSub(ig.state.userId),
  ],
  irisData: inbox
});
```

---

## Topic Listeners with Cleanup

The low-level `listen()` method on MQTToTClient now returns a function you can call to stop listening. This prevents memory leaks when you only need to listen temporarily.

```javascript
// listen with a topic config object (applies transformer)
const remove = realtime.mqtt.listen(
  { topic: '/ig_message_sync', transformer: myTransformer },
  (data) => {
    console.log('Got transformed data:', data);
  }
);

// or listen to a raw topic string (no transformer, just raw messages)
const removeRaw = realtime.mqtt.listen('/ig_send_message_response', (msg) => {
  console.log('Raw message on topic:', msg.payload);
});

// later, when you're done:
remove();
removeRaw();
```

---

## FBNS Push Notifications (FbnsClient)

`FbnsClient` handles Facebook Notification Service - the push notification system that Instagram uses under the hood. Even when the official app is "in the background", FBNS is what delivers those new follower, like, comment, and DM notifications. This library now has full FBNS support built in - no extra packages needed.

For most DM bot use cases you don't need FBNS because `RealtimeClient` already handles real-time message delivery. But if you want to receive push-style notifications for things like new followers, comments on your posts, story mentions, or live broadcast alerts - FBNS is the way to go. You can also run both at the same time.

### Basic FBNS Setup

```javascript
const { IgApiClient, FbnsClient, useMultiFileAuthState } = require('nodejs-insta-private-api-mqtt');

async function startFbns() {
  const ig = new IgApiClient();
  const auth = await useMultiFileAuthState('./auth_session');

  ig.state.usePresetDevice('Samsung Galaxy S25 Ultra');

  // login or restore session
  if (auth.hasSession()) {
    await auth.loadCreds(ig);
  } else {
    await ig.login({ username: 'your_username', password: 'your_password' });
    await auth.saveCreds(ig);
  }

  // create the FBNS client and wire up events
  const fbns = new FbnsClient(ig);

  fbns.on('push', (notification) => {
    console.log('Got push notification!');
    console.log('Title:', notification.title);
    console.log('Message:', notification.message);
    console.log('Type:', notification.collapseKey);
  });

  fbns.on('error', (err) => {
    console.error('FBNS error:', err.message);
  });

  // connect - this handles everything: TLS handshake, device auth,
  // token registration, and push subscription
  await fbns.connect();
  console.log('FBNS connected and listening for push notifications');

  // keep the process alive
  await new Promise(() => {});
}

startFbns().catch(console.error);
```

That's it. Once `connect()` resolves, you're registered for push notifications and the `push` event will fire whenever Instagram sends one.

### FBNS Events

| Event | Payload | When it fires |
|-------|---------|---------------|
| `push` | `{ title, message, collapseKey, igAction, pushId, pushCategory, badgeCount }` | New push notification received |
| `auth` | `{ clientId, deviceId, userId, deviceSecret }` | Device authenticated with FBNS servers |
| `message` | Raw FBNS message payload | Any FBNS message (low-level) |
| `logging` | Experiment/logging data from Instagram | Instagram sends telemetry config |
| `error` | Error object | Connection or protocol error |
| `warning` | Warning info | Non-fatal issues (empty payloads, etc.) |
| `disconnect` | Disconnect reason string | FBNS connection dropped |

### Push Notification Types (collapseKey values)

The `collapseKey` field tells you what kind of notification it is. Here are the common ones:

| collapseKey | What it means |
|-------------|---------------|
| `direct_v2_message` | New DM received |
| `direct_v2_group` | New group DM |
| `follow` | Someone followed you |
| `like` | Someone liked your post |
| `comment` | Someone commented on your post |
| `mention` | Someone mentioned you |
| `story_mention` | Someone mentioned you in their story |
| `live_broadcast` | Someone you follow went live |
| `story_reshare` | Someone reshared your story |
| `comment_like` | Someone liked your comment |
| `tagged_in_photo` | Someone tagged you in a photo |

### Handling Different Notification Types

```javascript
fbns.on('push', (notification) => {
  switch (notification.collapseKey) {
    case 'direct_v2_message':
      console.log('New DM! Badge:', notification.badgeCount?.direct);
      // notification.igAction contains the thread URL you can parse
      // e.g. "direct_v2?id=34028236...&x=32658200..."
      break;

    case 'follow':
      console.log('New follower!', notification.message);
      break;

    case 'like':
    case 'comment':
      console.log('Engagement:', notification.message);
      break;

    case 'live_broadcast':
      console.log('Someone went live:', notification.message);
      break;

    default:
      console.log(`[${notification.collapseKey}]`, notification.message || notification.title);
  }
});
```

### Running FBNS + Realtime Together

You can run both FBNS (push notifications) and RealtimeClient (DM messaging) side by side. They use different MQTT connections - Realtime connects to `edge-mqtt.facebook.com` for DMs, while FBNS connects to `mqtt-mini.facebook.com` for push notifications.

```javascript
const { IgApiClient, RealtimeClient, FbnsClient, useMultiFileAuthState } = require('nodejs-insta-private-api-mqtt');

async function startBot() {
  const ig = new IgApiClient();
  const auth = await useMultiFileAuthState('./auth_session');

  ig.state.usePresetDevice('Samsung Galaxy S25 Ultra');

  if (auth.hasSession()) {
    await auth.loadCreds(ig);
  } else {
    await ig.login({ username: 'your_username', password: 'your_password' });
    await auth.saveCreds(ig);
  }

  // start realtime for DMs
  const realtime = new RealtimeClient(ig);
  realtime.on('message_live', (msg) => {
    console.log(`DM from ${msg.username}: ${msg.text}`);
  });
  await realtime.startRealTimeListener();

  // start FBNS for push notifications
  const fbns = new FbnsClient(ig);
  fbns.on('push', (notif) => {
    console.log(`Push [${notif.collapseKey}]:`, notif.message || notif.title);
  });
  await fbns.connect();

  console.log('Both Realtime and FBNS are running!');
  await new Promise(() => {});
}

startBot().catch(console.error);
```

### FBNS with Session Persistence (withFbns)

If you're using `IgApiClientExt` for state management, `withFbns()` automatically includes the FBNS auth state in `exportState()` / `importState()`. This means you don't have to re-authenticate with FBNS servers every time you restart.

```javascript
const { IgApiClient, withFbnsAndRealtime } = require('nodejs-insta-private-api-mqtt');
const fs = require('fs');

const ig = new IgApiClient();
const client = withFbnsAndRealtime(ig);

// first run - login and save everything
await client.login({ username: 'user', password: 'pass' });
const state = await client.exportState();
fs.writeFileSync('full_state.json', state);

// next run - restore from file, FBNS auth included
const saved = fs.readFileSync('full_state.json', 'utf8');
await client.importState(saved);

// client.fbns is ready to connect with saved device credentials
client.fbns.on('push', (notif) => console.log('Push:', notif.message));
await client.fbns.connect();
```

### FBNS Connection Options

```javascript
await fbns.connect({
  autoReconnect: true,         // auto-reconnect on disconnect (default: true)
  enableTrace: false,          // enable MQTT packet tracing for debugging
});
```

### Disconnecting FBNS

```javascript
// graceful disconnect
await fbns.disconnect();

// if you need to reconnect later
await fbns.connect();
```

### How FBNS Works Internally

For anyone curious about what happens under the hood:

1. `FbnsClient` creates a TLS connection to `mqtt-mini.facebook.com:443` using Instagram's MQTToT protocol (MQTT over Thrift)
2. The CONNECT packet includes a device auth payload - either fresh credentials or saved ones from a previous session
3. Instagram responds with a CONNACK that contains a `deviceId`, `clientId`, and `deviceSecret` for this device
4. The client then publishes a registration request (FBNS_REG_REQ) with the Instagram package name
5. Instagram responds with a push token (FBNS_REG_RESP)
6. The client registers this token with Instagram's push API
7. From this point on, any push notification targeted at this account gets delivered via the MQTT connection

The whole flow takes about 1-2 seconds. The registration response can arrive very fast (sometimes before `connect()` even returns), so the library sets up the response listener before connecting to avoid any timing issues.

---

## Low-Level MQTToT Access

For advanced users who want to work directly with Instagram's MQTT-over-Thrift protocol:

```javascript
const {
  MQTToTClient,
  MQTToTConnection,
  mqttotConnectFlow,
  INSTAGRAM_VERSION
} = require('nodejs-insta-private-api-mqtt');

console.log('Current Instagram version:', INSTAGRAM_VERSION);
// '415.0.0.36.76'

// MQTToTClient extends mqtts.MqttClient with Instagram-specific behavior:
// - automatic keepalive pinging (every 8 min + jitter)
// - consecutive ping failure detection (3 fails = forced reconnect)
// - reconnect loop with rate limit awareness
// - listen() with cleanup function

// MQTToTConnection is used to build the Thrift connection payload
// that Instagram expects in the CONNECT packet

// mqttotConnectFlow creates the CONNECT/CONNACK handshake flow
// with keepAlive: 60 and proper error handling
```

---

## Keepalive Configuration (February 2026)

The previous version had 4 overlapping timers sending various keepalive signals, which generated a lot of unnecessary traffic. Instagram could potentially flag this as suspicious bot behavior. This has been streamlined:

| Timer | Old Value | New Value | Purpose |
|-------|-----------|-----------|---------|
| Foreground pulse | 15s | 60s + 0-5s jitter | Tells Instagram the app is in foreground |
| GraphQL sync | 45s | 5 min + 0-10s jitter | Refreshes subscription data |
| Traffic watchdog | 60s check / 60s threshold | 60s check / 5 min threshold | Detects dead connections, tries ping before reconnecting |
| MQTT heartbeat | 15s | 4 min + 0-5s jitter | MQTT-level ping to keep the TCP connection alive |
| MQTToT keepalive | 10 min | 8 min + 0-30s jitter | Low-level protocol keepalive |
| Active query | 25s | **Disabled** | Was redundant with the above |

The result is roughly 10x less keepalive traffic, which means less chance of Instagram flagging your connection as automated.

---

## Changelog

### v5.67.0 (February 2026) - Raven (View-Once) Media Sending

**Send disappearing photos and videos in DMs using Instagram's raven protocol:**
- `sendRavenPhoto()` in EnhancedDirectCommands — full upload + REST broadcast flow (accessible via directCommands)
- `sendRavenVideo()` in EnhancedDirectCommands — same flow for video with duration/dimensions
- `broadcastRaven()` in DirectThreadRepository — low-level REST broadcast to `/direct_v2/threads/broadcast/raven_attachment/`
- `sendmedia.sendRavenPhoto()` / `sendmedia.sendRavenVideo()` — standalone helpers that work without MQTT
- Two modes: view-once (`ephemeralMediaViewMode: 0`) and replayable (`ephemeralMediaViewMode: 1`)
- Upload uses rupload with `direct_v2: '1'` flag to mark media as DM content
- Confirmed working endpoint from Instagram's smali decompilation — this is the same endpoint the official app uses

### v5.66.0 (February 2026) - Complete REST API Parity with instagrapi

**32 REST API Repositories — full coverage of every Instagram private endpoint:**

New repositories added:
- `ClipRepository` - Upload, configure, discover, and download Reels/Clips
- `TimelineRepository` - Timeline reels feed and explore reels
- `InsightsRepository` - Account, media, reel, and story insights for business/creator accounts
- `NoteRepository` - Create, delete, and view Instagram Notes
- `NotificationRepository` - Fine-grained per-type notification settings
- `SignupRepository` - Full account creation flow with email/SMS verification
- `TOTPRepository` - TOTP 2FA setup, SMS 2FA, backup codes
- `BloksRepository` - Low-level Bloks engine actions
- `ChallengeRepository` - Auto-resolve challenges, verify methods, security codes
- `ShareRepository` - Decode QR/NFC share codes, parse share URLs
- `TrackRepository` - Music/audio search, info, download
- `ExploreRepository` - Topical explore, report, mark seen
- `FBSearchRepository` - Unified search (users, hashtags, places, music), search history
- `FundraiserRepository` - Create, donate, get fundraiser info
- `MultipleAccountsRepository` - Account family, switch accounts
- `CaptchaRepository` - reCAPTCHA / hCaptcha submission for challenges
- `HighlightsRepository` - Create, edit, delete highlights, manage stories and covers

Enhanced existing repositories:
- `AccountRepository` - Added editProfile, setBiography, setExternalUrl, removeBioLinks, setGender, setPrivate/Public, profilePictureChange/Remove, passwordPublicKeys, sendRecoveryFlowEmail/Sms, encryptPassword
- `UserRepository` - Added getUserMedias/getUserReels/getUserClips with pagination, userIdFromUsername, usernameFromUserId, block/unblock, mute/unmute, removeFollower, getBlockedUsers, getMutualFollowers
- `MediaRepository` - Added pinComment/unpinComment, bulkDeleteComments, replyToComment, likeComment/unlikeComment, save/unsave, archive/unarchive, disableComments/enableComments, commentThreadComments, downloadPhoto/downloadVideo, oembed, static mediaPkFromCode/mediaCodeFromPk/mediaPkFromUrl
- `FriendshipRepository` - Added restrict/unrestrict, setCloseFriend, setBesties, getFavoriteFriends, setFavorite/unsetFavorite, getPendingRequests, getMutuafFollowers, getBlockedUsers
- `FeedRepository` - Added uploadCarousel, reelsMedia, reelsTray, getReelsFeed, getUserReelsFeed, getExploreFeed
- `StoryRepository` - Added createHighlight/editHighlight/deleteHighlight, uploadVideo, configureStoryVideo, react
- `DirectRepository` - Added sendPhoto/sendVideo/sendLink/sendMediaShare/sendProfile/sendHashtag/sendLocation, getPendingInbox, createGroupThread, hideThread
- `UploadRepository` - Added configureToClips, configurePhoto, configureVideo, configureToStory

All 32 repositories registered in client.js and exported from index.js.

### v5.65.0 (February 2026) - Full FBNS Push Notifications

**FbnsClient now fully working out of the box:**
- Fixed critical timing bug where FBNS registration response arrived before the listener was set up, causing a 30s timeout on every connect
- Created built-in `mqtt-shim.js` bridge module so FBNS no longer requires any external MQTT packages
- Added missing shared functions (`createFbnsUserAgent`, `notUndefined`, `listenOnce`) that FBNS depends on
- FBNS connects to `mqtt-mini.facebook.com:443` via MQTToT, handles device auth, token registration, and push delivery
- Receives all push notification types: DMs, follows, likes, comments, story mentions, live broadcasts, and more
- Full event system: `push`, `auth`, `message`, `logging`, `error`, `warning`, `disconnect`
- Works alongside RealtimeClient (different MQTT connections, no conflicts)
- Session persistence via `withFbns()` / `withFbnsAndRealtime()` includes FBNS device auth in `exportState()`
- Auto-reconnect support with configurable options
- Comprehensive README documentation with working code examples

### v5.64.0 (February 2026) - Long-Term Stability

**SessionHealthMonitor** (native in RealtimeClient):
- Periodic session validation via `/api/v1/accounts/current_user/` (every 30min + jitter)
- Auto-relogin when session expires (configurable with credentials)
- Detects: auth errors (401/403), login_required, rate limits (429), network errors
- Smart consecutive failure tracking (2+ failures = session expired)
- After successful relogin: saves credentials + triggers MQTT reconnect
- Events: `health_check`, `session_expired`, `relogin_start`, `relogin_success`, `relogin_failed`, `relogin_challenge`, `relogin_needed`
- Uptime statistics: total runtime, uptime percent, session segments, reconnect count, longest session

**PersistentLogger** (native in RealtimeClient):
- File-based logging with automatic rotation (10MB per file, 5 files max)
- All MQTT events, errors, reconnects, health checks logged to disk
- Configurable log level (debug/info/warn/error)
- Buffer-based flushing (every 30s or 50 lines)
- `getRecentLines(count)` for quick debugging
- Logs survive process restarts for post-mortem analysis

**Integration:**
- `realtime.enableHealthMonitor({ credentials, autoRelogin: true })` - start monitoring
- `realtime.enablePersistentLogger({ logDir: './logs' })` - start file logging
- `realtime.getHealthStats()` - get uptime/session stats
- `realtime.getLoggerStats()` - get logger stats
- Auto-enabled via `startRealTimeListener()` options
- `SessionHealthMonitor` and `PersistentLogger` exported from index

**Usage:**
```js
const realtime = new RealtimeClient(ig);

// Option A: Auto via startRealTimeListener
await realtime.startRealTimeListener({
  credentials: { username: 'user', password: 'pass' },
  enablePersistentLogger: true,
  logDir: './mqtt-logs',
});

// Option B: Manual enable
realtime.enableHealthMonitor({
  credentials: { username: 'user', password: 'pass' },
  autoRelogin: true,
  checkIntervalMs: 30 * 60 * 1000,
});
realtime.enablePersistentLogger({ logDir: './mqtt-logs' });

// Monitor events
realtime.on('health_check', ({ status, stats }) => {
  console.log(`Session ${status}, uptime: ${stats.totalUptimeHuman}`);
});
realtime.on('session_expired', () => console.log('Session expired!'));
realtime.on('relogin_success', () => console.log('Re-logged in!'));

// Get stats anytime
const stats = realtime.getHealthStats();
console.log(`Uptime: ${stats.uptimePercent}%, ${stats.reconnects} reconnects`);
```

### v5.63.0 (February 2026) - Full Protocol Expansion

**14 New MQTT Topics:**
- `/ig_msg_dr` - Delivery receipts (emits `deliveryReceipt`)
- `/ig_conn_update` - Connection status updates (emits `connectionUpdate`)
- `/notify_disconnect` - Server-initiated disconnects (emits `notifyDisconnect`)
- `/t_thread_typing` - Per-thread typing indicators (emits `threadTyping`)
- `/iris_server_reset` - Iris state reset with auto-resubscribe (emits `irisServerReset`)
- `/t_ig_family_navigation_badge` - Badge/notification counts (emits `badgeCount`)
- `/t_entity_presence` - User presence status (emits `entityPresence`)
- `/opened_thread` - Thread open tracking (emits `threadOpened`)
- `/buddy_list` - Online buddy list (emits `buddyList`)
- `/webrtc`, `/webrtc_response`, `/onevc` - Call events (emits `callEvent`)

**GraphQL Live Subscriptions:**
- Live broadcast comments, likes, waves, typing, viewer count
- Media feedback (like/comment/save actions)
- Direct typing via GraphQL
- App-level presence events
- Video call state changes
- Interactivity events for live broadcasts
- Emits: `liveComment`, `liveLikeCount`, `liveWave`, `liveTyping`, `liveViewerCount`, `mediaFeedback`, `directTyping`, `appPresence`, `callStateChange`, `liveInteractivity`, `graphqlEvent`

**Pubsub Event Handler:**
- Direct thread patch operations (emits `direct`)
- Typing indicators via pubsub (emits `directTyping`)
- Duplicate message filtering
- Emits: `pubsubEvent`

**New REST API Repositories:**
- `NewsRepository` - Activity feed inbox, follow requests, mark as seen
- `CollectionRepository` - List, create, edit, delete saved collections; collection feed
- `CloseFriendsRepository` - List, add/remove besties, suggestions

**Enhanced MediaRepository:**
- `replyToComment(mediaId, commentId, text)` - Reply to specific comments
- `likeComment(mediaId, commentId)` / `unlikeComment()` - Comment likes
- `bulkDeleteComments(mediaId, commentIds[])` - Bulk comment deletion
- `save(mediaId, collectionId?)` / `unsave(mediaId)` - Save/unsave media
- `archive(mediaId)` / `unarchive(mediaId)` - Archive/unarchive media
- `disableComments(mediaId)` / `enableComments(mediaId)` - Toggle comments
- `commentThreadComments(mediaId, commentId)` - Get reply thread

**Enhanced UserRepository:**
- `getFriendshipStatuses(userIds[])` - Bulk friendship status check
- `getReelsTrayFeed()` - Stories tray feed
- `getUserTags(userId)` - Tagged photos feed
- `setSelfBio(biography)` - Update own biography
- `report(userId, reason)` - Report user
- `getSuggested()` - Suggested users feed

**Exports:**
- `NewsRepository`, `CollectionRepository`, `CloseFriendsRepository`, `MediaRepository`, `UserRepository` now exported from index

### v5.62.0 (February 2026)
- Intelligent error classification with 5 error types and type-specific backoff
- Smart ReconnectManager with error-type-aware delays
- IgApiClientExt with exportState() / importState() for session persistence
- withRealtime(), withFbns(), withFbnsAndRealtime() convenience wrappers
- Automatic per-thread message ordering via p-queue
- GraphQLSubscriptions, SkywalkerSubscriptions, QueryIDs now exported
- listen() returns unsubscribe function for proper cleanup
- FbnsClient fully functional with built-in mqtt-shim bridge
- MQTToTClient, MQTToTConnection, mqttotConnectFlow exported for advanced use
- INSTAGRAM_VERSION constant exported (415.0.0.36.76)
- Keepalive timers reduced from 4 to 2+1, traffic reduced ~10x
- Instagram version updated to 415.0.0.36.76 with Samsung Galaxy S24 fingerprint
- CONNACK keepAlive increased from 20 to 60 seconds
- clientCapabilities updated from 183 to 439
- Max error retries increased from 5 to 15
- New events: reconnected, reconnect_failed, auth_failure, warning

### v5.61.11
- Full iOS support with 21 device presets
- Full Android support with 12 device presets
- switchPlatform() for easy platform switching

### v5.60.8
- downloadContentFromMessage() - Baileys-style media download
- View-once media extraction support
- downloadMediaBuffer() and extractMediaUrls()

### v5.60.7
- Custom Device Emulation with 12 preset devices
- setCustomDevice() and usePresetDevice() methods

### v5.60.3
- sendPhoto() and sendVideo() for media uploads

### v5.60.2
- useMultiFileAuthState() - Baileys-style session persistence
- connectFromSavedSession() method

### v5.60.0
- Full MQTT integration with EnhancedDirectCommands
- Real-time messaging with <500ms latency

---

## License

MIT

## Support

For issues, bugs, or feature requests: https://github.com/Kunboruto20/nodejs-insta-private-api/issues

Documentation: https://github.com/Kunboruto20/nodejs-insta-private-api


---
## Enhanced Location Usage — Practical Examples (English)

The `EnhancedDirectCommands` class (see `enhanced.direct.commands.js`) implements robust location sending for Instagram Direct by trying **story-with-location-sticker → share story to thread → fallback to link**. Below are ready-to-copy examples showing how to use the location-related methods and payloads exposed by the class.

> These examples assume:
> - `realtime` is an instance of `RealtimeClient`.
> - `realtime.directCommands` is an instance of `EnhancedDirectCommands`.
> - You have a valid `threadId` (target DM thread).
> - `realtime.ig` exists when examples require publishing a story via the private IG client.

### 1) Send a location when you already have a `venue` object (recommended)

```javascript
// venue shape expected by sendLocation:
// { id, name, address, lat, lng, facebook_places_id, external_source }
const venue = {
  id: "213385402",
  name: "McDonald's Unirii",
  address: "Piața Unirii, Bucharest",
  lat: 44.4268,
  lng: 26.1025,
  facebook_places_id: "213385402",
  external_source: "facebook_places"
};

await realtime.directCommands.sendLocation({
  threadId: "340282366841710300949128114477782749726",
  venue,
  text: "Meet me here at 18:00"
});
```

**What happens:**  
1. The method attempts to publish a Story with a location sticker using `realtime.ig.publish.story`.  
2. If the Story publish succeeds and a `storyId` is returned, `sendUserStory` (reel_share) is used to share the story to the thread.  
3. If either step fails, the method falls back to sending a link to `https://www.instagram.com/explore/locations/{placeId}/` via `itemType: 'link'`.

---

### 2) Search for a place (instagram private search) and send it

Use `searchAndSendLocation()` when you only have a search query or coordinates:

```javascript
await realtime.directCommands.searchAndSendLocation({
  threadId: "340282366841710300949128114477782749726",
  query: "Starbucks Piata Unirii",
  lat: 44.4268,
  lng: 26.1025
});
```

This helper calls Instagram's `/fbsearch/places/` private endpoint (via `realtime.ig.request`) and then normalizes the first result into the `venue` shape before calling `sendLocation()`.

---

### 3) Build a location sticker manually & publish story (advanced)

If you want direct control over the sticker object or to publish your own image, you can use `createLocationStickerFromVenue()` and `realtime.ig.publish.story()` directly:

```javascript
const venue = {
  id: "213385402",
  name: "McDonald's Unirii",
  address: "Piața Unirii, Bucharest",
  lat: 44.4268,
  lng: 26.1025,
  facebook_places_id: "213385402"
};

// create sticker compatible with publish.story helpers
const sticker = realtime.directCommands.createLocationStickerFromVenue(venue);

// create a tiny placeholder image (1x1 PNG) or your real photo buffer
const SINGLE_PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=";
const photoBuffer = Buffer.from(SINGLE_PIXEL_PNG_BASE64, 'base64');

// publish story with the sticker (if realtime.ig.publish.story exists)
const publishResult = await realtime.ig.publish.story({
  file: photoBuffer,
  stickers: [sticker]
});

// try to resolve returned story id and then share it
const storyId = publishResult?.media?.pk || publishResult?.item_id || publishResult?.upload_id;
if (storyId) {
  await realtime.directCommands.sendUserStory({
    threadId: "340282366841710300949128114477782749726",
    storyId,
    text: "Location for tonight"
  });
} else {
  // fallback: send explore link manually
  await realtime.directCommands.sendLink({
    threadId: "340282366841710300949128114477782749726",
    link: `https://www.instagram.com/explore/locations/${venue.facebook_places_id || venue.id}/`,
    text: venue.name
  });
}
```

---

### 4) Force sending the explore-location link (explicit fallback)

If you don't want to publish a story and only need the location link in DM:

```javascript
const placeId = "213385402";
await realtime.directCommands.sendLink({
  threadId: "340282366841710300949128114477782749726",
  link: `https://www.instagram.com/explore/locations/${placeId}/`,
  text: "Meet here"
});
```

---

### 5) Error handling & debug tips

```javascript
try {
  await realtime.directCommands.sendLocation({ threadId, venue, text: "See you" });
  console.log("Location sent!");
} catch (err) {
  console.error("Failed to send location:", err);
  // fallback to explicit link if needed
  await realtime.directCommands.sendLink({
    threadId,
    link: `https://www.instagram.com/explore/locations/${venue.facebook_places_id || venue.id}/`,
    text: venue.name || "Location"
  });
}
```

If you need verbose logs, enable debug for the realtime/enhanced module:

```bash
# in your environment (example)
DEBUG="realtime:enhanced-commands" node your_bot.js
# or to see broader realtime logs
DEBUG="realtime:*" node your_bot.js
```

---

### 6) Quick checklist (what the library needs to make story-with-sticker work)

- `realtime.ig` must exist and expose `publish.story(...)` (a private client publish helper).  
- The `venue` must include either `facebook_places_id` or `id`.  
- If `realtime.ig.publish.story` is unavailable or Instagram rejects the sticker, the library **automatically falls back** to sending a DM link to the Explore locations page.

---

## End of Location Examples

These examples are appended to the original README in order to keep the whole original file intact while adding clear, English examples for location flows.

