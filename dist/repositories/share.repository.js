const Repository = require('../core/repository');

class ShareRepository extends Repository {
  shareInfo(code) {
    let decoded;
    if (Buffer.isBuffer(code)) {
      decoded = code.toString('utf8').replace(/\x1d/g, '');
    } else {
      try {
        decoded = Buffer.from(code, 'base64').toString('utf8').replace(/\x1d/g, '');
      } catch {
        decoded = String(code);
      }
    }
    const parts = decoded.split(':');
    return { type: parts[0], pk: parts[1] || '' };
  }

  shareInfoByUrl(url) {
    const code = this.shareCodeFromUrl(url);
    return this.shareInfo(code);
  }

  shareCodeFromUrl(url) {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(p => p.length > 0);
      return parts[parts.length - 1];
    } catch {
      return url;
    }
  }
}

module.exports = ShareRepository;
