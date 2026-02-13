const Repository = require('../core/repository');

class FundraiserRepository extends Repository {
  async standaloneFundraiserInfo(fundraiserPk) {
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1/fundraiser/${fundraiserPk}/standalone_fundraiser_info/`,
    });
    return response.body;
  }

  async createCharityFundraiser(options = {}) {
    const {
      title = '',
      description = '',
      goalAmount = 0,
      charityId = '',
      endTime = null,
    } = options;

    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/fundraiser/create_fundraiser/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        title,
        description,
        goal_amount: String(goalAmount),
        charity_id: charityId,
        end_time: endTime ? String(endTime) : '',
      }),
    });
    return response.body;
  }

  async donateFundraiser(fundraiserPk, amount) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/fundraiser/${fundraiserPk}/donate/`,
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        amount: String(amount),
      }),
    });
    return response.body;
  }
}

module.exports = FundraiserRepository;
