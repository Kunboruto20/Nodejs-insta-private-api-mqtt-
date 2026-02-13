const Repository = require('../core/repository');

class TimelineRepository extends Repository {
  async reels(amount = 10, lastMediaPk = 0) {
    return this._reelsTimelineMedia('clips/connected/', amount, lastMediaPk);
  }

  async exploreReels(amount = 10, lastMediaPk = 0) {
    return this._reelsTimelineMedia('clips/discover/', amount, lastMediaPk);
  }

  async _reelsTimelineMedia(endpoint, amount = 10, lastMediaPk = 0) {
    const totalItems = [];
    let nextMaxId = '';
    while (totalItems.length < amount) {
      try {
        const response = await this.client.request.send({
          method: 'POST',
          url: `/api/v1/${endpoint}`,
          form: { max_id: nextMaxId },
        });
        const body = response.body;
        for (const item of (body.items || [])) {
          const media = item.media || item;
          if (lastMediaPk && String(media.pk) === String(lastMediaPk)) {
            return totalItems;
          }
          totalItems.push(media);
        }
        const pagingInfo = body.paging_info || {};
        if (!pagingInfo.more_available) return totalItems;
        nextMaxId = pagingInfo.max_id || '';
      } catch (e) {
        return totalItems;
      }
    }
    return totalItems.slice(0, amount);
  }

  async getFeed(maxId = '', options = {}) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/feed/timeline/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        is_prefetch: '0',
        feed_view_info: '[]',
        seen_posts: '',
        phone_id: this.client.state.phoneId,
        battery_level: String(Math.floor(Math.random() * 50) + 50),
        timezone_offset: String(this.client.state.timezoneOffset),
        max_id: maxId,
        ...options,
      }),
    });
    return response.body;
  }
}

module.exports = TimelineRepository;
