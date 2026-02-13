const Repository = require('../core/repository');

class CaptchaRepository extends Repository {
  async getChallengeForm(apiPath) {
    const url = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    const response = await this.client.request.send({
      method: 'GET',
      url,
      qs: {
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
      },
    });
    return response.body;
  }

  async submitRecaptchaResponse(apiPath, gRecaptchaResponse) {
    const url = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    const response = await this.client.request.send({
      method: 'POST',
      url,
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        g_recaptcha_response: gRecaptchaResponse,
      }),
    });
    return response.body;
  }

  async submitHCaptchaResponse(apiPath, hCaptchaResponse) {
    const url = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    const response = await this.client.request.send({
      method: 'POST',
      url,
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        h_captcha_response: hCaptchaResponse,
      }),
    });
    return response.body;
  }
}

module.exports = CaptchaRepository;
