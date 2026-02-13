const Repository = require('../core/repository');
const crypto = require('crypto');

class TOTPRepository extends Repository {
  async generateSeed() {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/generate_two_factor_totp_key/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body.totp_seed;
  }

  async enable(verificationCode) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/enable_totp_two_factor/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        verification_code: verificationCode,
      }),
    });
    return response.body.backup_codes || [];
  }

  async disable() {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/disable_totp_two_factor/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body.status === 'ok';
  }

  generateCode(seed) {
    const secret = this._base32Decode(seed);
    const now = Math.floor(Date.now() / 1000);
    const timeCode = Math.floor(now / 30);
    return this._generateOTP(secret, timeCode);
  }

  _generateOTP(secret, input) {
    if (input < 0) throw new Error('Input must be positive');

    const buffer = Buffer.alloc(8);
    let val = input;
    for (let i = 7; i >= 0; i--) {
      buffer[i] = val & 0xff;
      val = val >> 8;
    }

    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(buffer);
    const hash = hmac.digest();

    const offset = hash[hash.length - 1] & 0x0f;
    const code =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff);

    const otp = (code % 1000000).toString();
    return otp.padStart(6, '0');
  }

  _base32Decode(input) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let str = input.toUpperCase().replace(/=+$/, '');
    const missing = str.length % 8;
    if (missing) str += '='.repeat(8 - missing);
    str = str.replace(/=+$/, '');

    let bits = '';
    for (const char of str) {
      const val = alphabet.indexOf(char);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, '0');
    }

    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.substr(i, 8), 2));
    }
    return Buffer.from(bytes);
  }

  async smsTwoFactorEnable(phoneNumber) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/send_two_factor_enable_sms/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        phone_number: phoneNumber,
      }),
    });
    return response.body;
  }

  async smsTwoFactorConfirm(verificationCode) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/enable_sms_two_factor/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        verification_code: verificationCode,
      }),
    });
    return response.body;
  }

  async disableSmsTwoFactor() {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/disable_sms_two_factor/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async getBackupCodes() {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/regen_backup_codes/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }
}

module.exports = TOTPRepository;
