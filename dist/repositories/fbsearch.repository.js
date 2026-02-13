const Repository = require('../core/repository');

class FBSearchRepository extends Repository {
  async topSearch(query, options = {}) {
    const {
      searchSurface = 'top_search_page',
      count = 30,
    } = options;

    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/fbsearch/topsearch_flat/',
      qs: {
        query,
        search_surface: searchSurface,
        timezone_offset: String(this.client.state.timezoneOffset),
        count,
        rank_token: this.client.state.uuid,
      },
    });
    return response.body;
  }

  async topSearchFlat(query, count = 30) {
    return this.topSearch(query, { count });
  }

  async searchPlaces(query, options = {}) {
    const { lat, lng, count = 30 } = options;
    const qs = {
      search_query: query,
      count,
      rank_token: this.client.state.uuid,
    };
    if (lat && lng) {
      qs.latitude = lat;
      qs.longitude = lng;
    }
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/fbsearch/places/',
      qs,
    });
    return response.body;
  }

  async searchUsers(query, count = 30) {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/users/search/',
      qs: {
        q: query,
        count,
        rank_token: this.client.state.uuid,
      },
    });
    return response.body;
  }

  async searchHashtags(query, count = 30) {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/tags/search/',
      qs: {
        q: query,
        count,
        rank_token: this.client.state.uuid,
      },
    });
    return response.body;
  }

  async searchMusic(query, options = {}) {
    const { count = 30 } = options;
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/music/audio_global_search/',
      qs: {
        query,
        browse_session_id: this.client.state.uuid,
        count,
      },
    });
    return response.body;
  }

  async getRecentSearches() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/fbsearch/recent_searches/',
    });
    return response.body;
  }

  async clearRecentSearches() {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/fbsearch/clear_search_history/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async getSuggestedSearches(searchType = 'users') {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/fbsearch/suggested_searches/',
      qs: { type: searchType },
    });
    return response.body;
  }

  async registerRecentSearch(entityId, entityType = 'user') {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/fbsearch/register_recent_search_click/',
      form: this.client.request.sign({
        entity_id: entityId,
        entity_type: entityType,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async nullStateDynamic() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/fbsearch/nullstate_dynamic_sections/',
      qs: {
        type: 'blended',
      },
    });
    return response.body;
  }
}

module.exports = FBSearchRepository;
