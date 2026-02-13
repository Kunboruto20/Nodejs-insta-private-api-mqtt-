const Repository = require('../core/repository');

class InsightsRepository extends Repository {
  async mediaFeedAll(options = {}) {
    const {
      selectedDomain = 'ACCOUNT',
      timeframe = 'TWO_WEEKS',
      dataOrdering = 'REACH_COUNT',
      count = 15,
      maxId = '',
    } = options;

    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/insights/media_feed_all/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        selected_domain: selectedDomain,
        timeframe,
        data_ordering: dataOrdering,
        count: String(count),
        max_id: maxId,
      }),
    });
    return response.body;
  }

  async account(options = {}) {
    const {
      dayRange = 7,
    } = options;

    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/insights/account_organic_insights/',
      qs: {
        show_promotions_in_landing_page: 'true',
        first: '0',
        timezone_offset: String(this.client.state.timezoneOffset),
        day_range: String(dayRange),
      },
    });
    return response.body;
  }

  async media(mediaPk) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/insights/media_organic_insights/${mediaPk}/`,
      qs: {
        ig_sig_key_version: this.client.state.signatureVersion,
      },
    });
    return response.body;
  }

  async reelInsights(mediaPk) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/insights/media_organic_insights/${mediaPk}/`,
      qs: {
        ig_sig_key_version: this.client.state.signatureVersion,
        surface: 'clips',
      },
    });
    return response.body;
  }

  async storyInsights(mediaPk) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/insights/media_organic_insights/${mediaPk}/`,
      qs: {
        ig_sig_key_version: this.client.state.signatureVersion,
        surface: 'story',
      },
    });
    return response.body;
  }
}

module.exports = InsightsRepository;
