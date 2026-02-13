const Repository = require('../core/repository');

class FriendshipRepository extends Repository {
  async create(userId) {
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

  async destroy(userId) {
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

  async show(userId) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/friendships/show/${userId}/`,
    });
    return response.body;
  }

  async showMany(userIds) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/friendships/show_many/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        user_ids: Array.isArray(userIds) ? userIds.join(',') : userIds,
      }),
    });
    return response.body;
  }

  async approve(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/approve/${userId}/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        user_id: userId,
      }),
    });
    return response.body;
  }

  async ignore(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/ignore/${userId}/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        user_id: userId,
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

  async mute(userId, options = {}) {
    const form = {
      _uid: this.client.state.cookieUserId,
      _uuid: this.client.state.uuid,
      user_id: userId,
    };
    if (options.muteStories) form.target_reel_author_id = userId;
    if (options.mutePosts) form.target_posts_author_id = userId;

    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/friendships/mute_posts_or_story_from_follow/',
      form: this.client.request.sign(form),
    });
    return response.body;
  }

  async unmute(userId, options = {}) {
    const form = {
      _uid: this.client.state.cookieUserId,
      _uuid: this.client.state.uuid,
      user_id: userId,
    };
    if (options.unmuteStories) form.target_reel_author_id = userId;
    if (options.unmutePosts) form.target_posts_author_id = userId;

    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/friendships/unmute_posts_or_story_from_follow/',
      form: this.client.request.sign(form),
    });
    return response.body;
  }

  async getPendingRequests() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/friendships/pending/',
    });
    return response.body;
  }

  async getFollowers(userId, maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/friendships/${userId}/followers/`,
      qs,
    });
    return response.body;
  }

  async getFollowing(userId, maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/friendships/${userId}/following/`,
      qs,
    });
    return response.body;
  }

  async getMutuafFollowers(userId) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/friendships/${userId}/mutual_followers/`,
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

  async restrict(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/restrict_action/restrict/',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        target_user_id: userId,
      }),
    });
    return response.body;
  }

  async unrestrict(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/restrict_action/unrestrict/',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        target_user_id: userId,
      }),
    });
    return response.body;
  }

  async setCloseFriend(userId, add = true) {
    if (add) {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/friendships/set_besties/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          _uid: this.client.state.cookieUserId,
          add: JSON.stringify([userId]),
          remove: JSON.stringify([]),
        }),
      });
      return response.body;
    } else {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/friendships/set_besties/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          _uid: this.client.state.cookieUserId,
          add: JSON.stringify([]),
          remove: JSON.stringify([userId]),
        }),
      });
      return response.body;
    }
  }

  async setBesties(addUserIds = [], removeUserIds = []) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/friendships/set_besties/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        _uid: this.client.state.cookieUserId,
        add: JSON.stringify(addUserIds),
        remove: JSON.stringify(removeUserIds),
      }),
    });
    return response.body;
  }

  async getFavoriteFriends() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/friendships/favorites/',
    });
    return response.body;
  }

  async setFavorite(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/favorite/${userId}/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async unsetFavorite(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/friendships/unfavorite/${userId}/`,
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }
}

module.exports = FriendshipRepository;
