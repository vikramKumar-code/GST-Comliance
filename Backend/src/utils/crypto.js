const crypto = require('crypto');
const { DATA_ENCRYPTION_KEY, isProduction } = require('../config/env');
const ApiError = require('./apiError'); // ✅ Added for proper error handling

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const VERSION = 'v1'; // ✅ Added for future algorithm migration support

// ✅ FIX 1: Cache encryption key at module load time (Performance optimization)
let cachedKey = null;

function getEncryptionKey() {
  if (cachedKey) return cachedKey;

  if (DATA_ENCRYPTION_KEY && DATA_ENCRYPTION_KEY.length === 64) {
    cachedKey = Buffer.from(DATA_ENCRYPTION_KEY, 'hex');
    return cachedKey;
  }

  if (isProduction) {
    throw new Error('DATA_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) in production');
  }

  // Safe deterministic 32-byte key derived for local dev/testing if not configured
  cachedKey = crypto.createHash('sha256').update(DATA_ENCRYPTION_KEY || 'gst-dev-encryption-key-fallback').digest();
  return cachedKey;
}

/**
 * Encrypt plain text or JSON object with AES-256-GCM.
 * Returns formatted string: v1:ivHex:authTagHex:ciphertextHex
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

  // ✅ FIX 3: Added version prefix for future algorithm migration
  return `${VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt cipher string formatted as v1:ivHex:authTagHex:ciphertextHex with AES-256-GCM.
 * Optionally parses JSON.
 */
function decrypt(cipherString, parseJson = false) {
  if (!cipherString) return null;

  const key = getEncryptionKey();
  const parts = cipherString.split(':');

  let ivHex, tagHex, encryptedHex;
  if (parts.length === 4) {
    const [version, iv, tag, enc] = parts;
    if (version !== VERSION) {
      throw ApiError.serverError(`Unsupported encryption version: ${version}. Current: ${VERSION}`);
    }
    ivHex = iv;
    tagHex = tag;
    encryptedHex = enc;
  } else if (parts.length === 3) {
    // Legacy format without version prefix (backward compatibility with existing records)
    [ivHex, tagHex, encryptedHex] = parts;
  } else {
    throw ApiError.serverError('Invalid encrypted data format. Expected: version:iv:tag:ciphertext or iv:tag:ciphertext');
  }

  try {
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
  } catch (cryptoError) {
    // ✅ FIX 2: Wrap crypto errors in ApiError for proper handling
    throw ApiError.serverError('Decryption failed: Data may be corrupted or tampered with.');
  }
}

/**
 * Utility: Check if a string is already encrypted (has version prefix)
 */
function isEncrypted(value) {
  if (typeof value !== 'string') return false;
  return value.startsWith(`${VERSION}:`);
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted
};