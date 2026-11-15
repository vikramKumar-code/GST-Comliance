const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/apiError');

/**
 * WARNING: AES-ECB mode is used here because TaxPro GSP API specification requires it.
 * ECB mode is cryptographically weak (no IV, deterministic encryption) but mandated by the legacy API.
 * DO NOT use this pattern for new implementations - use AES-GCM or AES-CBC with IV instead.
 */
function cipherName(key) {
  return `aes-${key.length * 8}-ecb`;
}

function decodeBase64(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw ApiError.validationError(`${label} is missing`);
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw ApiError.validationError(`${label} must be Base64 encoded`);
  }
  const key = Buffer.from(normalized, 'base64');
  if (key.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    key.fill(0);
    throw ApiError.validationError(`${label} must use canonical Base64 encoding`);
  }
  return key;
}

function decodeBase64Key(value, label) {
  const key = decodeBase64(value, label);
  if (![16, 24, 32].includes(key.length)) {
    key.fill(0);
    throw ApiError.validationError(
      `${label} must decode to a 128, 192, or 256-bit AES key. ` +
      `(Note: TaxPro ASP password must be a Base64-encoded AES key string, not plaintext)`
    );
  }
  return key;
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
      throw ApiError.validationError('TaxPro GetKey encrypted key has an invalid length');
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

const IST_OFFSET_MS = 330 * 60 * 1000; // +5:30 in milliseconds

function formatTaxProTimestamp(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const two = (value) => String(value).padStart(2, '0');
  const sixDigitFraction = `${String(ist.getUTCMilliseconds()).padStart(3, '0')}000`;
  return `${two(ist.getUTCDate())}${two(ist.getUTCMonth() + 1)}${ist.getUTCFullYear()}` +
    `${two(ist.getUTCHours())}${two(ist.getUTCMinutes())}${two(ist.getUTCSeconds())}${sixDigitFraction}`;
}

function createSignedContent(aspid, timestamp, privateKeyPath, passphrase) {
  if (!aspid || typeof aspid !== 'string' || !aspid.trim()) {
    throw ApiError.serverError('TAXPRO_ASPID is not configured', 500);
  }
  const cleanAspid = aspid.trim().replace(/^["']|["']$/g, '');
  if (!cleanAspid) {
    throw ApiError.serverError('TAXPRO_ASPID is not configured', 500);
  }
  if (!privateKeyPath || typeof privateKeyPath !== 'string' || !privateKeyPath.trim()) {
    throw ApiError.serverError('TAXPRO_ASP_PRIVATE_KEY_PATH is not configured', 500);
  }

  const cleanPath = privateKeyPath.trim().replace(/^["']|["']$/g, '');
  if (!cleanPath) {
    throw ApiError.serverError('TAXPRO_ASP_PRIVATE_KEY_PATH is not configured', 500);
  }

  let resolvedPath = cleanPath;
  if (!path.isAbsolute(cleanPath)) {
    const cwdCandidate = path.resolve(process.cwd(), cleanPath);
    const rootCandidate = path.resolve(__dirname, '../../..', cleanPath);

    if (fs.existsSync(cwdCandidate)) {
      resolvedPath = cwdCandidate;
      logger.debug(`Resolved private key path relative to CWD: ${resolvedPath}`);
    } else if (fs.existsSync(rootCandidate)) {
      resolvedPath = rootCandidate;
      logger.debug(`Resolved private key path relative to project root: ${resolvedPath}`);
    } else {
      resolvedPath = cwdCandidate; // Will fail with clear error
      logger.warn(`Private key not found at ${cwdCandidate} or ${rootCandidate}`);
    }
  }

  let keyBytes;
  try {
    keyBytes = fs.readFileSync(resolvedPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw ApiError.serverError('TaxPro ASP signing key file not found at configured path', 500);
    }
    if (err.code === 'EACCES') {
      throw ApiError.serverError('TaxPro ASP signing key file permission denied', 500);
    }
    throw ApiError.serverError('TaxPro ASP signing key could not be read', 500);
  }

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey({
      key: keyBytes,
      ...(passphrase ? { passphrase } : {})
    });
  } catch {
    keyBytes.fill(0);
    if (passphrase) {
      throw ApiError.serverError('TaxPro ASP signing key passphrase is incorrect', 500);
    }
    throw ApiError.serverError('TaxPro ASP signing key is not a readable PEM private key', 500);
  }
  keyBytes.fill(0);

  if (privateKey.asymmetricKeyType !== 'rsa') {
    throw ApiError.serverError('TaxPro ASP signing key must be an RSA private key', 500);
  }

  return crypto.sign('RSA-SHA256', Buffer.from(`${cleanAspid}${timestamp}`, 'utf8'), privateKey).toString('base64');
}

// Cache taxpro module to avoid repeated require() calls
let taxproModule = null;
function getTaxProModule() {
  if (!taxproModule) {
    taxproModule = require('./taxpro');
  }
  return taxproModule;
}

class TaxProGspSession {
  constructor(options = {}) {
    const rawAspid = options.aspid !== undefined ? options.aspid : (process.env.TAXPRO_ASPID || '');
    this.aspid = typeof rawAspid === 'string'
      ? rawAspid.trim().replace(/^["']|["']$/g, '')
      : '';
    const rawPassword = options.password !== undefined ? options.password : (process.env.TAXPRO_PASSWORD || '');
    this.password = typeof rawPassword === 'string'
      ? rawPassword.trim().replace(/^["']|["']$/g, '')
      : '';
    const rawPath = options.privateKeyPath !== undefined
      ? options.privateKeyPath
      : (process.env.TAXPRO_ASP_PRIVATE_KEY_PATH || '');
    this.privateKeyPath = typeof rawPath === 'string'
      ? rawPath.trim().replace(/^["']|["']$/g, '')
      : '';
    this.privateKeyPassphrase = options.privateKeyPassphrase !== undefined
      ? options.privateKeyPassphrase
      : (process.env.TAXPRO_ASP_PRIVATE_KEY_PASSPHRASE || '');
    this.httpClient = options.httpClient;
    this.now = options.now || (() => Date.now());
    this.session = null;
    this.refreshPromise = null;
    this.lastFailure = 0;
    this.backoffMs = 1000;

    const rawIp = options.ipUsr !== undefined ? options.ipUsr : (process.env.TAXPRO_GSP_IP_USR || '');
    const cleanIp = typeof rawIp === 'string' ? rawIp.trim().replace(/^["']|["']$/g, '') : '';
    this.extraHeaders = {
      appver: (options.appver || process.env.TAXPRO_APP_VERSION || 'CandidTax/1.0').trim(),
      ...(cleanIp ? { 'ip-usr': cleanIp } : {})
    };
  }

  async getSession() {
    if (this.session && this.session.refreshAt > this.now()) return this.session;

    // Check if we're in backoff period
    if (this.lastFailure && this.now() - this.lastFailure < this.backoffMs) {
      throw ApiError.providerError('GSP session refresh in backoff period', 503);
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshSession()
        .then((session) => {
          this.backoffMs = 1000; // Reset backoff on success
          return session;
        })
        .catch((err) => {
          this.lastFailure = this.now();
          this.backoffMs = Math.min(this.backoffMs * 2, 60000); // Exponential backoff, max 60s
          logger.error('GSP session refresh failed, backing off', {
            backoffMs: this.backoffMs,
            error: err.message
          });
          throw err;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }
    return this.refreshPromise;
  }

  async refreshSession() {
    if (!this.aspid) {
      throw ApiError.serverError('TAXPRO_ASPID is not configured', 500);
    }
    if (!this.password) {
      throw ApiError.serverError('TAXPRO_PASSWORD is not configured', 500);
    }
    if (!this.privateKeyPath) {
      throw ApiError.serverError('TAXPRO_ASP_PRIVATE_KEY_PATH is not configured', 500);
    }
    if (!this.httpClient) {
      throw ApiError.serverError('HTTP client is not configured for GSP session', 500);
    }

    const timestamp = formatTaxProTimestamp(new Date(this.now()));
    // ✅ FIXED: 32 chars, no hyphens for strict GSTN Production validation
    const txn = crypto.randomUUID().replace(/-/g, '');
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
      const { handleTaxProError } = getTaxProModule();
      throw handleTaxProError(error, 'gsp:getKey');
    }

    const { checkTaxProResponse } = getTaxProModule();
    const data = checkTaxProResponse(response.data, 'gsp:getKey');

    if (data.txn !== txn || typeof data.session_id !== 'string' || !data.session_id ||
      !Number.isFinite(Number(data.validity_min)) || Number(data.validity_min) < 5) {
      throw ApiError.providerError('TaxPro GSP session response was incomplete or validity too short.', 502);
    }

    // Log clock skew warning if timestamp differs significantly
    if (data.timestamp) {
      const serverTimeStr = data.timestamp;
      // Parse DDMMYYYYHHmmssSSSSSS format
      const day = parseInt(serverTimeStr.slice(0, 2), 10);
      const month = parseInt(serverTimeStr.slice(2, 4), 10) - 1;
      const year = parseInt(serverTimeStr.slice(4, 8), 10);
      const hours = parseInt(serverTimeStr.slice(8, 10), 10);
      const minutes = parseInt(serverTimeStr.slice(10, 12), 10);
      const seconds = parseInt(serverTimeStr.slice(12, 14), 10);

      // TaxPro returns IST timestamp; convert to epoch ms by subtracting IST offset from UTC components
      const serverTimeMs = Date.UTC(year, month, day, hours, minutes, seconds) - IST_OFFSET_MS;
      const localTime = this.now();
      const skewMs = Math.abs(serverTimeMs - localTime);

      if (skewMs > 5 * 60 * 1000) { // 5 minutes
        logger.warn(`Clock skew detected: ${skewMs}ms difference between local and TaxPro server`, {
          localTime: new Date(localTime).toISOString(),
          serverTime: new Date(serverTimeMs).toISOString()
        });
      }
    }

    let key;
    try {
      key = aesDecryptBase64(data.enc_key, this.password);
      const keyBytes = decodeBase64Key(key, 'TaxPro GSP session key');
      keyBytes.fill(0);
    } catch {
      throw ApiError.providerError('TaxPro GSP session key could not be established.', 502);
    }

    this.session = {
      sessionId: data.session_id,
      key,
      refreshAt: this.now() + (Number(data.validity_min) - 5) * 60 * 1000
    };

    logger.info('GSP session established successfully', {
      sessionId: this.session.sessionId.slice(0, 8) + '...',
      validityMin: data.validity_min,
      refreshAt: new Date(this.session.refreshAt).toISOString()
    });

    return this.session;
  }

  async getHeaders() {
    const session = await this.getSession();
    return {
      ...this.extraHeaders,
      aspid: this.aspid,
      'asp-secret': aesEncryptBase64(this.password, session.key),
      'session-id': session.sessionId,
      txn: crypto.randomUUID().replace(/-/g, ''), // ✅ Already fixed: 32 chars, no hyphens
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