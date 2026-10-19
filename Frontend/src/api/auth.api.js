import client from './client';

/**
 * Search taxpayer details by GSTIN
 * @param {string} gstin - 15-character GSTIN
 * @returns {Promise<{ legalName: string, tradeName: string, status: string }>}
 */
export const searchGstin = async (gstin) => {
  return client.post('/gstin/search', { gstin });
};

/**
 * Request OTP for taxpayer verification
 * @param {Object} payload
 * @param {string} payload.gstin - 15-character GSTIN
 * @param {string} payload.username - Taxpayer username
 * @param {boolean} payload.consent - Mandatory taxpayer consent flag (must be true)
 * @returns {Promise<{ message: string }>}
 */
export const requestOtp = async ({ gstin, username, consent }) => {
  return client.post('/auth/otp/request', { gstin, username, consent });
};

/**
 * Verify OTP and establish session cookie
 * @param {Object} payload
 * @param {string} payload.gstin - 15-character GSTIN
 * @param {string} payload.username - Taxpayer username
 * @param {string} payload.otp - 4-8 digit OTP
 * @returns {Promise<{ gstin: string }>}
 */
export const verifyOtp = async ({ gstin, username, otp }) => {
  return client.post('/auth/otp/verify', { gstin, username, otp });
};

/**
 * Check active session and get current user info
 * @returns {Promise<{ gstin: string, expiresAt: string }>}
 */
export const getMe = async () => {
  return client.get('/auth/me');
};

/**
 * Invalidate current session and clear auth cookie
 * @returns {Promise<{ ok: boolean }>}
 */
export const logout = async () => {
  return client.post('/auth/logout');
};
