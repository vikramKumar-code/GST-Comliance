const crypto = require('node:crypto');
const fs = require('node:fs');

function decodeBase64(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing`);
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`${label} must be Base64 encoded`);
  }
  const key = Buffer.from(normalized, 'base64');
  if (key.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    key.fill(0);
    throw new Error(`${label} must use canonical Base64 encoding`);
  }
  return key;
}

function decodeBase64Key(value, label) {
  const key = decodeBase64(value, label);
  if (![16, 24, 32].includes(key.length)) {
    key.fill(0);
    throw new Error(`${label} must decode to a 128, 192, or 256-bit AES key`);
  }
  return key;
}

function cipherName(key) {
  return `aes-${key.length * 8}-ecb`;
}

function aesEncryptBase64(payloadBase64, keyBase64) {
  const payload = decodeBase64Key(payloadBase64, 'TaxPro ASP password');
  let key;
  try {
    key = decodeBase64Key(keyBase64, 'TaxPro GSP session key');
    const cipher = crypto.createCipheriv(cipherName(key), key, null);
    return Buffer.concat([cipher.update(payload), cipher.final()]).toString('base64');
  } finally {
    payload.fill(0);
    if (key) key.fill(0);
  }
}

function aesDecryptBase64(ciphertextBase64, keyBase64) {
  const key = decodeBase64Key(keyBase64, 'TaxPro ASP password');
  let ciphertext;
  let plaintext;
  try {
    ciphertext = decodeBase64(ciphertextBase64, 'TaxPro GetKey encrypted key');
    if (!ciphertext.length || ciphertext.length % 16 !== 0) {
      throw new Error('TaxPro GetKey encrypted key has an invalid length');
    }
    const decipher = crypto.createDecipheriv(cipherName(key), key, null);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('base64');
  } finally {
    key.fill(0);
    if (ciphertext) ciphertext.fill(0);
    if (plaintext) plaintext.fill(0);
  }
}

function formatTaxProTimestamp(date = new Date()) {
  const two = (value) => String(value).padStart(2, '0');
  const sixDigitFraction = `${String(date.getMilliseconds()).padStart(3, '0')}000`;
  return `${two(date.getDate())}${two(date.getMonth() + 1)}${date.getFullYear()}` +
    `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}${sixDigitFraction}`;
}

function createSignedContent(aspid, timestamp, privateKeyPath, passphrase) {
  let keyBytes;
  try {
    keyBytes = fs.readFileSync(privateKeyPath);
  } catch {
    throw new Error('TaxPro ASP signing key could not be read');
  }

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey({
      key: keyBytes,
      ...(passphrase ? { passphrase } : {})
    });
  } catch {
    keyBytes.fill(0);
    throw new Error('TaxPro ASP signing key is not a readable PEM private key');
  }
  keyBytes.fill(0);
  if (privateKey.asymmetricKeyType !== 'rsa') {
    throw new Error('TaxPro ASP signing key must be RSA');
  }

  return crypto.sign('RSA-SHA256', Buffer.from(`${aspid}${timestamp}`, 'utf8'), privateKey).toString('base64');
}

class TaxProGspSession {
  constructor(options = {}) {
    this.aspid = options.aspid || process.env.TAXPRO_ASPID || '';
    this.password = options.password || process.env.TAXPRO_PASSWORD || '';
    this.privateKeyPath = options.privateKeyPath || process.env.TAXPRO_ASP_PRIVATE_KEY_PATH || '';
    this.privateKeyPassphrase = options.privateKeyPassphrase || process.env.TAXPRO_ASP_PRIVATE_KEY_PASSPHRASE || '';
    this.httpClient = options.httpClient;
    this.now = options.now || (() => Date.now());
    this.session = null;
    this.refreshPromise = null;
    this.extraHeaders = {
      appver: options.appver || process.env.TAXPRO_APP_VERSION || 'CandidTax/1.0',
      ...(options.ipUsr || process.env.TAXPRO_GSP_IP_USR
        ? { 'ip-usr': options.ipUsr || process.env.TAXPRO_GSP_IP_USR }
        : {})
    };
  }

  async getSession() {
    if (this.session && this.session.refreshAt > this.now()) return this.session;
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshSession().finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }

  async refreshSession() {
    if (!this.aspid || !this.password || !this.privateKeyPath || !this.httpClient) {
      throw new Error('TaxPro ASP credentials, registered signing key, and HTTP client are required for GSP APIs');
    }
    const timestamp = formatTaxProTimestamp(new Date(this.now()));
    const txn = crypto.randomUUID();
    const body = {
      timestamp,
      signed_content: createSignedContent(this.aspid, timestamp, this.privateKeyPath, this.privateKeyPassphrase),
      filler1: '',
      filler2: ''
    };

    let response;
    try {
      response = await this.httpClient.post('/aspapi/v1.0/getKey', body, {
        headers: { ...this.extraHeaders, aspid: this.aspid, txn, 'Content-Type': 'application/json; charset=utf-8' }
      });
    } catch (error) {
      const { handleTaxProError } = require('./taxpro');
      throw handleTaxProError(error, 'gsp:getKey');
    }

    const { checkTaxProResponse } = require('./taxpro');
    const data = checkTaxProResponse(response.data, 'gsp:getKey');
    if (data.txn !== txn || typeof data.session_id !== 'string' || !data.session_id ||
        !Number.isFinite(Number(data.validity_min)) || Number(data.validity_min) <= 5) {
      const ApiError = require('../../utils/apiError');
      throw ApiError.providerError('TaxPro GSP session response was incomplete or mismatched.', 502);
    }

    let key;
    try {
      key = aesDecryptBase64(data.enc_key, this.password);
      const keyBytes = decodeBase64Key(key, 'TaxPro GSP session key');
      keyBytes.fill(0);
    } catch {
      const ApiError = require('../../utils/apiError');
      throw ApiError.providerError('TaxPro GSP session key could not be established.', 502);
    }

    this.session = {
      sessionId: data.session_id,
      key,
      refreshAt: this.now() + (Number(data.validity_min) - 5) * 60 * 1000
    };
    return this.session;
  }

  async getHeaders() {
    const session = await this.getSession();
    return {
      ...this.extraHeaders,
      aspid: this.aspid,
      'asp-secret': aesEncryptBase64(this.password, session.key),
      'session-id': session.sessionId,
      txn: crypto.randomUUID(),
      'Content-Type': 'application/json; charset=utf-8'
    };
  }
}

module.exports = {
  TaxProGspSession,
  aesEncryptBase64,
  aesDecryptBase64,
  createSignedContent,
  formatTaxProTimestamp
};
