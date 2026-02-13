const Repository = require('../core/repository');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

class UserRepository extends Repository {
  constructor(client) {
    super(client);
    this._usersCache = {};
    this._usernamesCache = {};
  }

  async infoByUsername(username) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/users/${username}/usernameinfo/`,
    });
    return response.body.user;
  }

  async info(userId) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/users/${userId}/info/`,
    });
    return response.body.user;
  }

  async infoV1(userId, fromModule = 'self_profile') {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/users/${userId}/info/`,
      qs: { from_module: fromModule },
    });
    return response.body.user;
  }

  async userIdFromUsername(username) {
    const user = await this.infoByUsername(username.toLowerCase());
    return String(user.pk);
  }

  async usernameFromUserId(userId) {
    const user = await this.info(userId);
    return user.username;
  }

  async search(query, count = 50) {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/users/search/',
      qs: { q: query, count },
    });
    return response.body.users;
  }

  async searchExact(username) {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/users/search/',
      qs: {
        q: username,
        count: 1,
        search_surface: 'user_search_page',
      },
    });
    const users = response.body.users || [];
    return users.find(u => u.username === username) || null;
  }

  async follow(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/create/${userId}/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        user_id: userId,
      }),
    });
    return response.body;
  }

  async unfollow(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/destroy/${userId}/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        user_id: userId,
      }),
    });
    return response.body;
  }

  async getFollowers(userId, amount = 200, maxId = null) {
    return this._paginateUsers(`/api/v1/friendships/${userId}/followers/`, amount, maxId);
  }

  async getFollowing(userId, amount = 200, maxId = null) {
    return this._paginateUsers(`/api/v1/friendships/${userId}/following/`, amount, maxId);
  }

  async _paginateUsers(endpoint, amount = 200, startMaxId = null) {
    const allUsers = [];
    let nextMaxId = startMaxId;
    while (allUsers.length < amount) {
      const qs = {};
      if (nextMaxId) qs.max_id = nextMaxId;
      const response = await this.client.request.send({
        method: 'GET',
        url: endpoint,
        qs,
      });
      const body = response.body;
      const users = body.users || [];
      allUsers.push(...users);
      if (!body.next_max_id) break;
      nextMaxId = body.next_max_id;
    }
    return { users: allUsers.slice(0, amount), nextMaxId };
  }

  async getFriendshipStatuses(userIds) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/friendships/show_many/',
      form: this.client.request.sign({
        user_ids: Array.isArray(userIds) ? userIds.join(',') : userIds,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async friendshipShow(userId) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/friendships/show/${userId}/`,
    });
    return response.body;
  }

  async getReelsTrayFeed() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/feed/reels_tray/',
    });
    return response.body;
  }

  async getUserTags(userId, maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/usertags/${userId}/feed/`,
      qs,
    });
    return response.body;
  }

  async getUserMedias(userId, amount = 50, maxId = null) {
    const allItems = [];
    let nextMaxId = maxId;
    while (allItems.length < amount) {
      const qs = { count: Math.min(amount - allItems.length, 33) };
      if (nextMaxId) qs.max_id = nextMaxId;
      const response = await this.client.request.send({
        method: 'GET',
        url: `/api/v1/feed/user/${userId}/`,
        qs,
      });
      const body = response.body;
      allItems.push(...(body.items || []));
      if (!body.more_available || !body.next_max_id) break;
      nextMaxId = body.next_max_id;
    }
    return allItems.slice(0, amount);
  }

  async getUserReels(userId, amount = 50, maxId = null) {
    const allItems = [];
    let nextMaxId = maxId;
    while (allItems.length < amount) {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/clips/user/',
        form: {
          target_user_id: userId,
          page_size: Math.min(amount - allItems.length, 12),
          max_id: nextMaxId || '',
        },
      });
      const body = response.body;
      for (const item of (body.items || [])) {
        allItems.push(item.media || item);
      }
      const pagingInfo = body.paging_info || {};
      if (!pagingInfo.more_available) break;
      nextMaxId = pagingInfo.max_id || '';
    }
    return allItems.slice(0, amount);
  }

  async getUserClips(userId, amount = 50, maxId = null) {
    return this.getUserReels(userId, amount, maxId);
  }

  async getUserStories(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/feed/user/${userId}/story/`,
      form: {
        supported_capabilities_new: JSON.stringify(this.client.state.constants.SUPPORTED_CAPABILITIES),
      },
    });
    return response.body;
  }

  async setSelfBio(biography) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/set_biography/',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        raw_text: biography,
      }),
    });
    return response.body;
  }

  async report(userId, reason = 1) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/users/${userId}/flag_user/`,
      form: this.client.request.sign({
        reason_id: reason,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async getSuggested() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/discover/ayml/',
    });
    return response.body;
  }

  async block(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/block/${userId}/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        user_id: userId,
      }),
    });
    return response.body;
  }

  async unblock(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/unblock/${userId}/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        user_id: userId,
      }),
    });
    return response.body;
  }

  async mute(userId, { muteStories = false, mutePosts = false } = {}) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/mute_posts_or_story_from_follow/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        target_posts_author_id: mutePosts ? userId : '',
        target_reel_author_id: muteStories ? userId : '',
      }),
    });
    return response.body;
  }

  async unmute(userId, { unmuteStories = false, unmutePosts = false } = {}) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/unmute_posts_or_story_from_follow/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        target_posts_author_id: unmutePosts ? userId : '',
        target_reel_author_id: unmuteStories ? userId : '',
      }),
    });
    return response.body;
  }

  async removeFollower(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/remove_follower/${userId}/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        user_id: userId,
      }),
    });
    return response.body;
  }

  async getBlockedUsers() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/users/blocked_list/',
    });
    return response.body;
  }

  async getMutualFollowers(userId) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/friendships/${userId}/mutual_followers/`,
    });
    return response.body;
  }

  static mediaPkFromCode(code) {
    let pk = BigInt(0);
    for (let i = 0; i < code.length; i++) {
      const idx = ALPHABET.indexOf(code[i]);
      if (idx === -1) continue;
      pk = pk * BigInt(64) + BigInt(idx);
    }
    return pk.toString();
  }

  static mediaCodeFromPk(pk) {
    let id = BigInt(pk);
    let code = '';
    while (id > BigInt(0)) {
      const remainder = Number(id % BigInt(64));
      code = ALPHABET[remainder] + code;
      id = id / BigInt(64);
    }
    return code;
  }
}

module.exports = UserRepository;
