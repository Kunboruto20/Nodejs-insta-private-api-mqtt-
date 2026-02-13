const Repository = require('../core/repository');

const MUTE_ALL_VALUES = ['cancel', '15_minutes', '1_hour', '2_hour', '4_hour', '8_hour'];
const SETTING_VALUES = ['off', 'following_only', 'everyone'];

class NotificationRepository extends Repository {
  async changeSettings(contentType, settingValue) {
    let userId;
    try { userId = this.client.state.cookieUserId; } catch { userId = '0'; }
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/notifications/change_notification_settings/',
      form: this.client.request.sign({
        content_type: contentType,
        setting_value: settingValue,
        _uid: userId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async muteAll(settingValue = '8_hour') {
    if (!MUTE_ALL_VALUES.includes(settingValue)) {
      throw new Error(`Unsupported mute value: ${settingValue}. Must be one of: ${MUTE_ALL_VALUES.join(', ')}`);
    }
    return this.changeSettings('mute_all', settingValue);
  }

  async likes(settingValue = 'off') { return this._assertAndSet('likes', settingValue); }
  async likeAndCommentOnPhotoUserTagged(v = 'off') { return this._assertAndSet('like_and_comment_on_photo_user_tagged', v); }
  async userTagged(v = 'off') { return this._assertAndSet('user_tagged', v); }
  async comments(v = 'off') { return this._assertAndSet('comments', v); }
  async commentLikes(v = 'off') { return this._assertAndSet('comment_likes', v); }
  async firstPost(v = 'off') { return this._assertAndSet('first_post', v); }
  async newFollower(v = 'off') { return this._assertAndSet('new_follower', v); }
  async followRequestAccepted(v = 'off') { return this._assertAndSet('follow_request_accepted', v); }
  async connection(v = 'off') { return this._assertAndSet('connection', v); }
  async taggedInBio(v = 'off') { return this._assertAndSet('tagged_in_bio', v); }
  async pendingDirectShare(v = 'off') { return this._assertAndSet('pending_direct_share', v); }
  async directShareActivity(v = 'off') { return this._assertAndSet('direct_share_activity', v); }
  async directGroupRequests(v = 'off') { return this._assertAndSet('direct_group_requests', v); }
  async videoCall(v = 'off') { return this._assertAndSet('video_call', v); }
  async rooms(v = 'off') { return this._assertAndSet('rooms', v); }
  async liveBroadcast(v = 'off') { return this._assertAndSet('live_broadcast', v); }
  async felixUploadResult(v = 'off') { return this._assertAndSet('felix_upload_result', v); }
  async viewCount(v = 'off') { return this._assertAndSet('view_count', v); }
  async fundraiserCreator(v = 'off') { return this._assertAndSet('fundraiser_creator', v); }
  async fundraiserSupporter(v = 'off') { return this._assertAndSet('fundraiser_supporter', v); }
  async reminders(v = 'off') { return this._assertAndSet('reminders', v); }
  async announcements(v = 'off') { return this._assertAndSet('announcements', v); }
  async reportUpdated(v = 'off') { return this._assertAndSet('report_updated', v); }
  async login(v = 'off') { return this._assertAndSet('login_notification', v); }

  async disableAll() {
    const methods = [
      'likes', 'likeAndCommentOnPhotoUserTagged', 'userTagged', 'comments',
      'commentLikes', 'firstPost', 'newFollower', 'followRequestAccepted',
      'connection', 'taggedInBio', 'pendingDirectShare', 'directShareActivity',
      'directGroupRequests', 'videoCall', 'rooms', 'liveBroadcast',
      'felixUploadResult', 'viewCount', 'fundraiserCreator', 'fundraiserSupporter',
      'reminders', 'announcements', 'reportUpdated', 'login',
    ];
    const results = [];
    for (const method of methods) {
      results.push(await this[method]('off'));
    }
    return results.every(r => r?.status === 'ok');
  }

  _assertAndSet(contentType, settingValue) {
    if (!SETTING_VALUES.includes(settingValue)) {
      throw new Error(`Unsupported setting value: ${settingValue}. Must be one of: ${SETTING_VALUES.join(', ')}`);
    }
    return this.changeSettings(contentType, settingValue);
  }
}

module.exports = NotificationRepository;
