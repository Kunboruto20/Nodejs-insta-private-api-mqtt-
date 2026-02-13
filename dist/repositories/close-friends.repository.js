const Repository = require('../core/repository');

class CloseFriendsRepository extends Repository {
  async list() {
    const response = await this.client.request.send({
      url: '/api/v1/friendships/besties/',
      method: 'GET',
    });
    return response.body;
  }

  async setBesties(addUserIds = [], removeUserIds = []) {
    const response = await this.client.request.send({
      url: '/api/v1/friendships/set_besties/',
      method: 'POST',
      form: this.client.request.sign({
        add: JSON.stringify(addUserIds),
        remove: JSON.stringify(removeUserIds),
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async add(userId) {
    return this.setBesties([userId], []);
  }

  async remove(userId) {
    return this.setBesties([], [userId]);
  }

  async suggestions(maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      url: '/api/v1/friendships/bestie_suggestions/',
      method: 'GET',
      qs,
    });
    return response.body;
  }
}

module.exports = CloseFriendsRepository;
