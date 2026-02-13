const Repository = require('../core/repository');
const crypto = require('crypto');

class AccountRepository extends Repository {
  constructor(client) {
    super(client);
    this.maxRetries = 3;
  }

  async requestWithRetry(requestFn, retries = 0) {
    try {
      const result = await requestFn();
      return result;
    } catch (error) {
      const shouldRetry =
        (error.data?.error_type === 'server_error' ||
         error.data?.error_type === 'rate_limited') &&
        retries < this.maxRetries;
      if (shouldRetry) {
        const delay = 1000 * (retries + 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.requestWithRetry(requestFn, retries + 1);
      }
      throw error;
    }
  }

  async login(credentialsOrUsername, passwordArg) {
    let username, password;
    if (typeof credentialsOrUsername === 'object' && credentialsOrUsername !== null) {
      username = credentialsOrUsername.username;
      password = credentialsOrUsername.password;
    } else {
      username = credentialsOrUsername;
      password = passwordArg;
    }
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    if (!this.client.state.passwordEncryptionPubKey) {
      await this.syncLoginExperiments();
    }

    const { encrypted, time } = this.encryptPassword(password);

    return this.requestWithRetry(async () => {
      const countryCode = this.client.state.countryCode || 1;
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/login/',
        form: this.client.request.sign({
          jazoest: AccountRepository.createJazoest(this.client.state.phoneId),
          country_codes: JSON.stringify([{ country_code: String(countryCode), source: ['default'] }]),
          phone_id: this.client.state.phoneId,
          enc_password: `#PWD_INSTAGRAM:4:${time}:${encrypted}`,
          username,
          adid: this.client.state.adid,
          guid: this.client.state.uuid,
          device_id: this.client.state.deviceId,
          google_tokens: '[]',
          login_attempt_count: '0',
        }),
      });

      const body = response.body;

      if (body.two_factor_required) {
        const err = new Error('Two factor authentication required');
        err.name = 'IgLoginTwoFactorRequiredError';
        err.twoFactorInfo = body.two_factor_info;
        throw err;
      }
      if (body.error_type === 'bad_password') {
        const err = new Error('Bad password');
        err.name = 'IgLoginBadPasswordError';
        throw err;
      }
      if (body.error_type === 'invalid_user') {
        const err = new Error('Invalid user');
        err.name = 'IgLoginInvalidUserError';
        throw err;
      }
      if (body.message === 'challenge_required') {
        const err = new Error('Challenge required');
        err.name = 'IgCheckpointError';
        err.challengeInfo = body.challenge;
        throw err;
      }

      return body.logged_in_user;
    });
  }

  async twoFactorLogin(username, verificationCode, twoFactorIdentifier, verificationMethod = '1') {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/two_factor_login/',
        form: this.client.request.sign({
          username,
          verification_code: verificationCode,
          two_factor_identifier: twoFactorIdentifier,
          verification_method: verificationMethod,
          trust_this_device: '1',
          guid: this.client.state.uuid,
          device_id: this.client.state.deviceId,
          phone_id: this.client.state.phoneId,
        }),
      });
      return response.body;
    });
  }

  async logout() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/logout/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
        }),
      });
      return response.body;
    });
  }

  async currentUser() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'GET',
        url: '/api/v1/accounts/current_user/',
        qs: { edit: true },
      });
      return response.body;
    });
  }

  async accountInfo() {
    return this.currentUser();
  }

  async editProfile({ externalUrl, phoneNumber, username, fullName, biography, email } = {}) {
    return this.requestWithRetry(async () => {
      const current = await this.currentUser();
      const user = current.user || current;
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/edit_profile/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          external_url: externalUrl !== undefined ? externalUrl : (user.external_url || ''),
          phone_number: phoneNumber !== undefined ? phoneNumber : (user.phone_number || ''),
          username: username !== undefined ? username : user.username,
          full_name: fullName !== undefined ? fullName : (user.full_name || ''),
          biography: biography !== undefined ? biography : (user.biography || ''),
          email: email !== undefined ? email : (user.email || ''),
        }),
      });
      return response.body;
    });
  }

  async setBiography(biography) {
    return this.editProfile({ biography });
  }

  async setExternalUrl(url) {
    return this.editProfile({ externalUrl: url });
  }

  async removeBioLinks() {
    return this.editProfile({ externalUrl: '' });
  }

  async setGender(gender) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/set_gender/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          gender,
        }),
      });
      return response.body;
    });
  }

  async setPrivate() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/set_private/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
        }),
      });
      return response.body;
    });
  }

  async setPublic() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/set_public/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
        }),
      });
      return response.body;
    });
  }

  async changePassword(oldPassword, newPassword) {
    const oldEnc = this.encryptPassword(oldPassword);
    const newEnc = this.encryptPassword(newPassword);
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/change_password/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          enc_old_password: `#PWD_INSTAGRAM:4:${oldEnc.time}:${oldEnc.encrypted}`,
          enc_new_password1: `#PWD_INSTAGRAM:4:${newEnc.time}:${newEnc.encrypted}`,
          enc_new_password2: `#PWD_INSTAGRAM:4:${newEnc.time}:${newEnc.encrypted}`,
        }),
      });
      return response.body;
    });
  }

  async sendConfirmEmail() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/send_confirm_email/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          send_source: 'edit_profile',
        }),
      });
      return response.body;
    });
  }

  async sendConfirmPhoneNumber(phoneNumber) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/send_confirm_phone_number/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          phone_number: phoneNumber,
        }),
      });
      return response.body;
    });
  }

  async profilePictureChange(uploadId) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/change_profile_picture/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          use_fbuploader: 'true',
          upload_id: uploadId,
        }),
      });
      return response.body;
    });
  }

  async profilePictureRemove() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/remove_profile_picture/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
        }),
      });
      return response.body;
    });
  }

  async newsInbox() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'GET',
        url: '/api/v1/news/inbox/',
      });
      return response.body;
    });
  }

  async syncLoginExperiments() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/qe/sync/',
        form: this.client.request.sign({
          id: this.client.state.uuid,
          server_config_retrieval: '1',
          experiments: this.client.state.constants.LOGIN_EXPERIMENTS,
        }),
      });
      return response.body;
    });
  }

  async syncPostLoginExperiments() {
    let userId;
    try { userId = this.client.state.cookieUserId; } catch { userId = '0'; }
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/qe/sync/',
        form: this.client.request.sign({
          id: userId,
          _uid: userId,
          _uuid: this.client.state.uuid,
          server_config_retrieval: '1',
          experiments: this.client.state.constants.EXPERIMENTS,
        }),
      });
      return response.body;
    });
  }

  async syncLauncher(preLogin = true) {
    const data = {
      id: this.client.state.uuid,
      server_config_retrieval: '1',
    };
    if (!preLogin) {
      try {
        data._uid = this.client.state.cookieUserId;
        data._uuid = this.client.state.uuid;
      } catch {}
    }
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/launcher/sync/',
        form: this.client.request.sign(data),
      });
      return response.body;
    });
  }

  async syncDeviceFeatures() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/devices/sync/',
        form: this.client.request.sign({
          id: this.client.state.uuid,
          server_config_retrieval: '1',
        }),
      });
      return response.body;
    });
  }

  async getPrefillCandidates() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/get_prefill_candidates/',
        form: this.client.request.sign({
          android_device_id: this.client.state.deviceId,
          phone_id: this.client.state.phoneId,
          usages: '["account_recovery_omnibox"]',
          device_id: this.client.state.uuid,
        }),
      });
      return response.body;
    });
  }

  async contactPointPrefill(usage = 'prefill') {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/contact_point_prefill/',
        form: this.client.request.sign({
          phone_id: this.client.state.phoneId,
          usage,
        }),
      });
      return response.body;
    });
  }

  async getZrToken(params = {}) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'GET',
        url: '/api/v1/zr/token/result/',
        qs: {
          device_id: this.client.state.deviceId,
          custom_device_id: this.client.state.uuid,
          fetch_reason: 'token_expired',
          token_hash: '',
          ...params,
        },
      });
      return response.body;
    });
  }

  async getConsentSignupConfig() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'GET',
        url: '/api/v1/consent/get_signup_config/',
        qs: {
          guid: this.client.state.uuid,
          main_account_selected: false,
        },
      });
      return response.body;
    });
  }

  async sendRecoveryFlowEmail(query) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: '/api/v1/accounts/send_recovery_flow_email/',
        method: 'POST',
        form: this.client.request.sign({
          adid: '',
          guid: this.client.state.uuid,
          device_id: this.client.state.deviceId,
          query,
        }),
      });
      return response.body;
    });
  }

  async sendRecoveryFlowSms(query) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        url: '/api/v1/accounts/send_recovery_flow_sms/',
        method: 'POST',
        form: this.client.request.sign({
          adid: '',
          guid: this.client.state.uuid,
          device_id: this.client.state.deviceId,
          query,
        }),
      });
      return response.body;
    });
  }

  static createJazoest(input) {
    const buf = Buffer.from(input, 'ascii');
    let sum = 0;
    for (let i = 0; i < buf.byteLength; i++) {
      sum += buf.readUInt8(i);
    }
    return `2${sum}`;
  }

  encryptPassword(password) {
    if (!this.client.state.passwordEncryptionPubKey) {
      return { time: Math.floor(Date.now() / 1000).toString(), encrypted: password };
    }

    const randKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const rsaEncrypted = crypto.publicEncrypt({
      key: Buffer.from(this.client.state.passwordEncryptionPubKey, 'base64').toString(),
      padding: crypto.constants.RSA_PKCS1_PADDING,
    }, randKey);

    const cipher = crypto.createCipheriv('aes-256-gcm', randKey, iv);
    const time = Math.floor(Date.now() / 1000).toString();
    cipher.setAAD(Buffer.from(time));

    const aesEncrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    const sizeBuffer = Buffer.alloc(2, 0);
    sizeBuffer.writeInt16LE(rsaEncrypted.byteLength, 0);
    const authTag = cipher.getAuthTag();

    return {
      time,
      encrypted: Buffer.concat([
        Buffer.from([1, this.client.state.passwordEncryptionKeyId || 0]),
        iv,
        sizeBuffer,
        rsaEncrypted,
        authTag,
        aesEncrypted
      ]).toString('base64')
    };
  }

  async passwordPublicKeys() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/qe/sync/',
    });
    const headers = response.headers || {};
    const keyId = parseInt(headers['ig-set-password-encryption-key-id'] || '0');
    const pubKey = headers['ig-set-password-encryption-pub-key'] || '';
    return { keyId, pubKey };
  }

  async setPresenceDisabled(disabled = true) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/set_presence_disabled/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          disabled: disabled ? '1' : '0',
        }),
      });
      return response.body;
    });
  }

  async getCommentFilter() {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'GET',
        url: '/api/v1/accounts/get_comment_filter/',
      });
      return response.body;
    });
  }

  async setCommentFilter(configValue = 0) {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/set_comment_filter/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          config_value: String(configValue),
        }),
      });
      return response.body;
    });
  }

  async pushPreferences(preferences = 'default') {
    return this.requestWithRetry(async () => {
      const response = await this.client.request.send({
        method: 'POST',
        url: '/api/v1/push/register/',
        form: this.client.request.sign({
          _uuid: this.client.state.uuid,
          device_type: 'android_mqtt',
          is_main_push_channel: 'true',
          phone_id: this.client.state.phoneId,
          device_token: '',
          guid: this.client.state.uuid,
          users: preferences,
        }),
      });
      return response.body;
    });
  }
}

module.exports = AccountRepository;
