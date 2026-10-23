const { NODE_ENV } = require('../config/env');

const SENSITIVE_KEYS = [
  'otp', 'token', 'gsttoken', 'gsttokenenc', 'password', 'dataenc', 'authorization',
  'aspid', 'asp-secret', 'gstin', 'pan', 'username', 'email', 'phone', 'mobile',
  'session', 'signature', 'sek', 'rek', 'certificate', 'privatekey', 'legalname', 'trdnm', 'lgnm'
];

function redactSensitive(data) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(redactSensitive);

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.some(sensitive => key.toLowerCase().includes(sensitive))) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = redactSensitive(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

const logger = {
  info: (message, meta) => {
    const timestamp = new Date().toISOString();
    if (meta) {
      console.log(`[INFO] [${timestamp}] ${message}`, redactSensitive(meta));
    } else {
      console.log(`[INFO] [${timestamp}] ${message}`);
    }
  },
  warn: (message, meta) => {
    const timestamp = new Date().toISOString();
    if (meta) {
      console.warn(`[WARN] [${timestamp}] ${message}`, redactSensitive(meta));
    } else {
      console.warn(`[WARN] [${timestamp}] ${message}`);
    }
  },
  error: (message, meta) => {
    const timestamp = new Date().toISOString();
    if (meta) {
      console.error(`[ERROR] [${timestamp}] ${message}`, redactSensitive(meta));
    } else {
      console.error(`[ERROR] [${timestamp}] ${message}`);
    }
  },
  debug: (message, meta) => {
    if (NODE_ENV !== 'production') {
      const timestamp = new Date().toISOString();
      if (meta) {
        console.debug(`[DEBUG] [${timestamp}] ${message}`, redactSensitive(meta));
      } else {
        console.debug(`[DEBUG] [${timestamp}] ${message}`);
      }
    }
  }
};

module.exports = logger;
