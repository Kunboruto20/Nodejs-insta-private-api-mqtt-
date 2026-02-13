const Repository = require('../core/repository');

class TrackRepository extends Repository {
  async downloadByUrl(url) {
    const axios = require('axios');
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  }

  async infoByCanonicalId(musicCanonicalId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/clips/music/',
      form: {
        tab_type: 'clips',
        referrer_media_id: '',
        _uuid: this.client.state.uuid,
        music_canonical_id: String(musicCanonicalId),
      },
    });
    const body = response.body;
    const trackData = body?.metadata?.music_info?.music_asset_info;
    return trackData || body;
  }

  async infoById(trackId, maxId = '') {
    const data = {
      audio_cluster_id: trackId,
      original_sound_audio_asset_id: trackId,
    };
    if (maxId) data.max_id = maxId;
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/clips/music/',
      form: data,
    });
    return response.body;
  }

  async search(query) {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/music/audio_global_search/',
      qs: {
        query,
        browse_session_id: this.client.state.uuid,
      },
    });
    return response.body;
  }
}

module.exports = TrackRepository;
