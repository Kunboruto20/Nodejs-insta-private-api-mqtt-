const Repository = require('../core/repository');

class ChallengeRepository extends Repository {
  async resolve(challengeUrl, options = {}) {
    const { securityCode, choice } = options;

    if (choice !== undefined) {
      return this.selectVerifyMethod(challengeUrl, choice);
    }

    if (securityCode) {
      return this.sendSecurityCode(challengeUrl, securityCode);
    }

    return this.getChallengePage(challengeUrl);
  }

  async getChallengePage(challengeUrl) {
    const url = challengeUrl.startsWith('/') ? challengeUrl : `/${challengeUrl}`;
    const response = await this.client.request.send({
      method: 'GET',
      url: `/api/v1${url}`,
      qs: {
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
      },
    });
    return response.body;
  }

  async selectVerifyMethod(challengeUrl, choice = 1) {
    const url = challengeUrl.startsWith('/') ? challengeUrl : `/${challengeUrl}`;
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1${url}`,
      form: this.client.request.sign({
        choice: String(choice),
        _uuid: this.client.state.uuid,
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
      }),
    });
    return response.body;
  }

  async sendSecurityCode(challengeUrl, securityCode) {
    const url = challengeUrl.startsWith('/') ? challengeUrl : `/${challengeUrl}`;
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1${url}`,
      form: this.client.request.sign({
        security_code: String(securityCode),
        _uuid: this.client.state.uuid,
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
      }),
    });
    return response.body;
  }

  async replayChallenge(challengeUrl) {
    const url = challengeUrl.startsWith('/') ? challengeUrl : `/${challengeUrl}`;
    const replayUrl = url.replace(/\/$/, '') + '/replay/';
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1${replayUrl}`,
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
      }),
    });
    return response.body;
  }

  async resetChallenge(challengeUrl) {
    const url = challengeUrl.startsWith('/') ? challengeUrl : `/${challengeUrl}`;
    const resetUrl = url.replace(/\/$/, '') + '/reset/';
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1${resetUrl}`,
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
      }),
    });
    return response.body;
  }

  async auto(challengeUrl) {
    const step1 = await this.getChallengePage(challengeUrl);
    if (step1.step_name === 'select_verify_method') {
      const choice = step1.step_data?.choice || '1';
      return this.selectVerifyMethod(challengeUrl, choice);
    }
    return step1;
  }

  async submitPhoneNumber(challengeUrl, phoneNumber) {
    const url = challengeUrl.startsWith('/') ? challengeUrl : `/${challengeUrl}`;
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1${url}`,
      form: this.client.request.sign({
        phone_number: phoneNumber,
        _uuid: this.client.state.uuid,
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
      }),
    });
    return response.body;
  }

  async submitDelta(challengeUrl, securityCode) {
    return this.sendSecurityCode(challengeUrl, securityCode);
  }
}

module.exports = ChallengeRepository;
