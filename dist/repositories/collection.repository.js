const Repository = require('../core/repository');

class CollectionRepository extends Repository {
  async list(maxId = null) {
    const qs = { collection_types: '["ALL_MEDIA_AUTO_COLLECTION","MEDIA","PRODUCT_AUTO_COLLECTION"]' };
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      url: '/api/v1/collections/list/',
      method: 'GET',
      qs,
    });
    return response.body;
  }

  async feed(collectionId, maxId = null) {
    const qs = {};
    if (maxId) qs.max_id = maxId;
    const response = await this.client.request.send({
      url: `/api/v1/feed/collection/${collectionId}/`,
      method: 'GET',
      qs,
    });
    return response.body;
  }

  async create(name, mediaIds = []) {
    const response = await this.client.request.send({
      url: '/api/v1/collections/create/',
      method: 'POST',
      form: this.client.request.sign({
        name,
        added_media_ids: JSON.stringify(mediaIds),
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async edit(collectionId, name, addedMediaIds = [], removedMediaIds = []) {
    const response = await this.client.request.send({
      url: `/api/v1/collections/${collectionId}/edit/`,
      method: 'POST',
      form: this.client.request.sign({
        name,
        added_media_ids: JSON.stringify(addedMediaIds),
        removed_media_ids: JSON.stringify(removedMediaIds),
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async delete(collectionId) {
    const response = await this.client.request.send({
      url: `/api/v1/collections/${collectionId}/delete/`,
      method: 'POST',
      form: this.client.request.sign({
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }
}

module.exports = CollectionRepository;
