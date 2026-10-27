/**
 * Utility to recursively sanitize payloads before rendering in the UI or console
 * Strictly masks any OTP, token, password, secret, or provider credentials.
 */

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /auth[-_]?token/i,
  /password/i,
  /secret/i,
  /asp[-_]?id/i,
  /asp[-_]?secret/i,
  /session[-_]?id/i,
  /private[-_]?key/i,
  /enc[-_]?key/i,
  /encrypted[-_]?key/i,
  /otp/i,
  /cookie/i,
  /authorization/i,
];

export function sanitizePayload(data) {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizePayload(item));
  }

  const sanitized = {};
  for (const [key, val] of Object.entries(data)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      sanitized[key] = sanitizePayload(val);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}
