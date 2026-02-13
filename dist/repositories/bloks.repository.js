const Repository = require('../core/repository');

class BloksRepository extends Repository {
  async action(params = {}) {
    const {
      actionName,
      actionParams = {},
      extraData = {},
    } = params;

    let userId;
    try { userId = this.client.state.cookieUserId; } catch { userId = '0'; }

    const data = {
      _uuid: this.client.state.uuid,
      _uid: userId,
      action: actionName,
      bk_client_context: JSON.stringify({
        bloks_version: this.client.state.bloksVersionId,
        styles_id: 'instagram',
      }),
      params: JSON.stringify(actionParams),
      ...extraData,
    };

    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/bloks/apps/com.bloks.www.bloks.caa.login.async.send_login_request/',
      form: this.client.request.sign(data),
    });
    return response.body;
  }

  async changePassword(oldPassword, newPassword) {
    const oldEnc = this.client.account.encryptPassword(oldPassword);
    const newEnc = this.client.account.encryptPassword(newPassword);

    let userId;
    try { userId = this.client.state.cookieUserId; } catch { userId = '0'; }

    const data = {
      _uuid: this.client.state.uuid,
      _uid: userId,
      enc_old_password: `#PWD_INSTAGRAM:4:${oldEnc.time}:${oldEnc.encrypted}`,
      enc_new_password1: `#PWD_INSTAGRAM:4:${newEnc.time}:${newEnc.encrypted}`,
      enc_new_password2: `#PWD_INSTAGRAM:4:${newEnc.time}:${newEnc.encrypted}`,
    };

    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/bloks/apps/com.instagram.challenge.navigation.take_challenge/',
      form: this.client.request.sign(data),
    });
    return response.body;
  }

  async getLayoutData(params = {}) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/bloks/get_layout/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        ...params,
      }),
    });
    return response.body;
  }
}

module.exports = BloksRepository;
