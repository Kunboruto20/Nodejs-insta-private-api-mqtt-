const Repository = require('../core/repository');

class ExploreRepository extends Repository {
  async topicalExplore(options = {}) {
    const {
      clusterId = 'explore_all:0',
      maxId = '',
      module = 'explore_popular',
    } = options;

    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/discover/topical_explore/',
      qs: {
        is_prefetch: false,
        omit_cover_media: true,
        use_sectional_payload: true,
        timezone_offset: String(this.client.state.timezoneOffset),
        session_id: this.client.state.clientSessionId,
        include_fixed_destinations: true,
        cluster_id: clusterId,
        max_id: maxId,
        module,
      },
    });
    return response.body;
  }

  async explore(maxId = '') {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/discover/explore/',
      qs: {
        is_prefetch: false,
        is_from_promote: false,
        timezone_offset: String(this.client.state.timezoneOffset),
        session_id: this.client.state.clientSessionId,
        max_id: maxId,
      },
    });
    return response.body;
  }

  async reportExploreMedia(mediaPk, reason = 1) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/media/${mediaPk}/flag_media/`,
      form: this.client.request.sign({
        reason_id: String(reason),
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async markAsSeen(options = {}) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/discover/mark_su_seen/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        ...options,
      }),
    });
    return response.body;
  }
}

module.exports = ExploreRepository;
