const FinaggMock = require('./finagg.mock');
const taxProProvider = require('./providers/taxpro');

/**
 * Determine the active GST provider based on environment variables
 * Per docs/TAXPRO_ADDENDUM.md:
 * - PROVIDER=mock | taxpro
 * - USE_MOCK=true forces mock
 */
function getProviderName() {
  if (process.env.USE_MOCK === 'true') {
    return 'mock';
  }
  const prov = (process.env.PROVIDER || 'mock').trim().toLowerCase();
  if (!['mock', 'taxpro'].includes(prov)) {
    // Fail closed: a typo must never silently route real-looking workflows to mock data.
    throw new Error('PROVIDER must be either "mock" or "taxpro"');
  }
  return prov;
}

function getProvider() {
  const name = getProviderName();
  if (name === 'taxpro') {
    return taxProProvider;
  }
  return FinaggMock;
}

class FinaggService {
  static getProviderName() {
    return getProviderName();
  }

  static getProvider() {
    return getProvider();
  }

  /**
   * Search taxpayer business details by GSTIN
   */
  static async searchGstin(gstin) {
    return getProvider().searchGstin(gstin);
  }

  /**
   * Request OTP from GST System
   */
  static async requestOtp(gstin, username) {
    return getProvider().requestOtp(gstin, username);
  }

  /**
   * Verify OTP and get GST session token
   * Returns { token: response.auth_token }
   */
  static async verifyOtp(gstin, username, otp) {
    const res = await getProvider().verifyOtp(gstin, username, otp);
    return {
      token: res.token || res.auth_token
    };
  }

  /**
   * Refresh GST session auth token
   * Returns { token: response.auth_token }
   */
  static async refreshToken(gstin, username, token) {
    const res = await getProvider().refreshToken(gstin, username, token);
    return {
      token: res.token || res.auth_token
    };
  }

  /**
   * Request EVC OTP for electronic verification / return filing
   */
  static async requestEvcOtp(gstin, username, pan, formType, token) {
    return getProvider().requestEvcOtp(gstin, username, pan, formType, token);
  }

  /**
   * Fetch returns filing summary
   */
  static async getReturnsSummary(gstin, period, gstToken, username, options) {
    const provider = getProvider();
    if (getProviderName() === 'taxpro') {
      return provider.getReturnsSummary(gstin, period, gstToken, username);
    }
    const opt = (typeof gstToken === 'object' && gstToken !== null)
      ? gstToken
      : ((typeof username === 'object' && username !== null) ? username : options);
    return provider.getReturnsSummary(gstin, period, opt);
  }

  /**
   * Fetch return data (GSTR-1, GSTR-2B, GSTR-3B)
   */
  static async getReturn(type, gstin, period, gstToken, username, options) {
    const provider = getProvider();
    if (getProviderName() === 'taxpro') {
      return provider.getReturn(type, gstin, period, gstToken, username, options);
    }
    const opt = (typeof gstToken === 'object' && gstToken !== null)
      ? gstToken
      : ((typeof username === 'object' && username !== null) ? username : options);
    return provider.getReturn(type, gstin, period, opt);
  }
}

module.exports = FinaggService;
