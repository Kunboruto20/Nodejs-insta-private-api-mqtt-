const Repository = require('../core/repository');

class NewsRepository extends Repository {
  async inbox() {
    const response = await this.client.request.send({
      url: '/api/v1/news/inbox/',
      method: 'GET',
    });
    return response.body;
  }

  async getFollowRequests(maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      url: '/api/v1/news/inbox/',
      method: 'GET',
      qs: { ...qs, filters: 'follow_requests' },
    });
    return response.body;
  }

  async markAsSeen(timestamps = {}) {
    const response = await this.client.request.send({
      url: '/api/v1/news/inbox_seen/',
      method: 'POST',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }
}

module.exports = NewsRepository;
