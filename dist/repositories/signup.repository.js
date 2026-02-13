const Repository = require('../core/repository');

class SignupRepository extends Repository {
  constructor(client) {
    super(client);
    this.waterfallId = this._generateUUID();
  }

  _generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  async signup(options = {}) {
    const {
      username,
      password,
      email,
      phoneNumber = '',
      fullName = '',
      year = null,
      month = null,
      day = null,
    } = options;

    await this.getSignupConfig();

    const checkResult = await this.checkEmail(email);
    if (!checkResult.valid) {
      throw new Error(`Email not valid: ${checkResult.error_title || JSON.stringify(checkResult)}`);
    }
    if (!checkResult.available) {
      throw new Error(`Email not available: ${checkResult.feedback_message || JSON.stringify(checkResult)}`);
    }

    const sendResult = await this.sendVerifyEmail(email);
    if (!sendResult.email_sent) {
      throw new Error(`Failed to send verification email: ${JSON.stringify(sendResult)}`);
    }

    if (year && month && day) {
      const ageCheck = await this.checkAgeEligibility(year, month, day);
      if (!ageCheck.eligible) {
        throw new Error(`Not eligible based on age: ${JSON.stringify(ageCheck)}`);
      }
    }

    return { status: 'verification_sent', email };
  }

  async getSignupConfig() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/consent/get_signup_config/',
      qs: {
        guid: this.client.state.uuid,
        main_account_selected: false,
      },
    });
    return response.body;
  }

  async checkEmail(email) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/users/check_email/',
      form: {
        android_device_id: this.client.state.deviceId,
        login_nonce_map: '{}',
        login_nonces: '[]',
        email,
        qe_id: this._generateUUID(),
        waterfall_id: this.waterfallId,
      },
    });
    return response.body;
  }

  async checkUsername(username) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/users/check_username/',
      form: {
        username,
        _uuid: this.client.state.uuid,
      },
    });
    return response.body;
  }

  async sendVerifyEmail(email) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/send_verify_email/',
      form: {
        phone_id: this.client.state.phoneId,
        device_id: this.client.state.deviceId,
        email,
        waterfall_id: this.waterfallId,
        auto_confirm_only: 'false',
      },
    });
    return response.body;
  }

  async checkConfirmationCode(email, code) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/check_confirmation_code/',
      form: {
        code,
        device_id: this.client.state.deviceId,
        email,
        waterfall_id: this.waterfallId,
      },
    });
    return response.body;
  }

  async checkAgeEligibility(year, month, day) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/consent/check_age_eligibility/',
      form: {
        _uuid: this.client.state.uuid,
        day: String(day),
        month: String(month),
        year: String(year),
      },
    });
    return response.body;
  }

  async accountsCreate(options = {}) {
    const {
      username,
      password,
      email,
      signupCode,
      fullName = '',
      year = null,
      month = null,
      day = null,
    } = options;

    const { encrypted, time } = this.client.account.encryptPassword(password);

    const data = {
      enc_password: `#PWD_INSTAGRAM:4:${time}:${encrypted}`,
      phone_id: this.client.state.phoneId,
      username,
      first_name: fullName,
      day: day ? String(day) : '',
      month: month ? String(month) : '',
      year: year ? String(year) : '',
      device_id: this.client.state.deviceId,
      email,
      signup_code: signupCode || '',
      waterfall_id: this.waterfallId,
      _uuid: this.client.state.uuid,
      force_sign_up_code: '',
      qs_stamp: '',
      has_sms_consent: 'true',
    };

    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/create/',
      form: this.client.request.sign(data),
    });
    return response.body;
  }

  async sendSignupSmsCode(phoneNumber) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/send_signup_sms_code/',
      form: this.client.request.sign({
        phone_id: this.client.state.phoneId,
        phone_number: phoneNumber,
        waterfall_id: this.waterfallId,
        has_whatsapp_installed: '0',
      }),
    });
    return response.body;
  }

  async validateSignupSmsCode(phoneNumber, code) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/validate_signup_sms_code/',
      form: this.client.request.sign({
        phone_id: this.client.state.phoneId,
        phone_number: phoneNumber,
        verification_code: code,
        waterfall_id: this.waterfallId,
      }),
    });
    return response.body;
  }

  async getSuggestedUsernames(name, email) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/username_suggestions/',
      form: {
        name: name || '',
        email: email || '',
        waterfall_id: this.waterfallId,
      },
    });
    return response.body;
  }
}

module.exports = SignupRepository;
