const crypto = require('crypto');
const { DATA_ENCRYPTION_KEY, isProduction } = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM

function getEncryptionKey() {
  if (DATA_ENCRYPTION_KEY && DATA_ENCRYPTION_KEY.length === 64) {
    return Buffer.from(DATA_ENCRYPTION_KEY, 'hex');
  }
  if (isProduction) {
    throw new Error('DATA_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) in production');
  }
  // Safe deterministic 32-byte key derived for local dev/testing if not configured
  return crypto.createHash('sha256').update(DATA_ENCRYPTION_KEY || 'gst-dev-encryption-key-fallback').digest();
}

/**
 * Encrypt plain text or JSON object with AES-256-GCM.
 * Returns formatted string: ivHex:authTagHex:ciphertextHex
 */
function encrypt(plainData) {
  if (plainData === null || plainData === undefined) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const text = typeof plainData === 'object' ? JSON.stringify(plainData) : String(plainData);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt cipher string formatted as ivHex:authTagHex:ciphertextHex with AES-256-GCM.
 * Optionally parses JSON.
 */
function decrypt(cipherString, parseJson = false) {
  if (!cipherString) return null;
  const key = getEncryptionKey();
  const parts = cipherString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivHex, tagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  if (parseJson) {
    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  }

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt
};
