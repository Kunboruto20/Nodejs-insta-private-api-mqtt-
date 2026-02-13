const Repository = require('../core/repository');

class MultipleAccountsRepository extends Repository {
  async getFeaturedAccounts() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/multiple_accounts/get_featured_accounts/',
    });
    return response.body;
  }

  async getAccountFamily() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/multiple_accounts/get_account_family/',
    });
    return response.body;
  }

  async getAccountInfo() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/multiple_accounts/get_account_info/',
    });
    return response.body;
  }

  async switchAccount(userId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/multiple_accounts/switch_account/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        user_id: userId,
      }),
    });
    return response.body;
  }
}

module.exports = MultipleAccountsRepository;
