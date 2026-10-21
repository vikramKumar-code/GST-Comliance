const axios = require('axios');
const ApiError = require('../../utils/apiError');
const logger = require('../../utils/logger');

// [CONFIRM] from TaxPro docs: add the real error_cd for an expired or invalid token
const SESSION_ERROR_CODES = [];

/**
 * Validate error_cd before logging: must match /^[A-Za-z0-9_-]{1,32}$/ or return 'invalid'
 */
function getValidErrorCd(errorCd) {
  if (typeof errorCd === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(errorCd)) {
    return errorCd;
  }
  return 'invalid';
}

/**
 * Handle and map errors from TaxPro upstream calls
 * SECURITY RULE:
 * - Credentials travel in query params (aspid, password, authtoken)
 * - Never log a URL, params, request config, request headers or whole axios error object
 * - Map errors using only error.response?.status and error.code (plus server-side error_cd)
 * - Never forward raw provider message to the client
 */
function handleTaxProError(error, operation) {
  if (error instanceof ApiError) {
    return error;
  }

  const status = error.response?.status;
  const code = error.code;

  let providerErrorCd = null;
  const responseData = error.response?.data;
  if (responseData && typeof responseData === 'object') {
    providerErrorCd = responseData.error?.error_cd;
  }

  let mappedError;

  if (providerErrorCd && SESSION_ERROR_CODES.includes(providerErrorCd)) {
    mappedError = ApiError.sessionExpired('Please verify OTP again.');
  } else if (providerErrorCd === 'RET2B1023') {
    mappedError = ApiError.dataNotAvailable('Data for this period is not available yet. Try another month.');
  } else if (providerErrorCd === 'AUTH4041') {
    mappedError = ApiError.providerError('Could not complete the request. Please try again.', 502);
  } else if (providerErrorCd) {
    // Any unknown error_cd per TAXPRO_ADDENDUM Section 4
    mappedError = ApiError.providerError('Could not complete the request. Please try again.', 502);
  } else if (status === 429) {
    mappedError = ApiError.rateLimited('Too many requests. Please wait and try again.');
  } else if (status >= 500) {
    mappedError = ApiError.providerDown('GST service is unavailable. Please try again later.');
  } else if (
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ERR_NETWORK' ||
    !error.response
  ) {
    mappedError = ApiError.providerDown('GST service is unavailable. Please try again later.');
  } else if (status === 401 || status === 403) {
    // Upstream 401/403 maps to PROVIDER_AUTH per instructions
    mappedError = ApiError.providerAuth('Could not complete the request. Please try again.');
  } else {
    mappedError = ApiError.providerError('Could not complete the request. Please try again.', 502);
  }

  const errorCdForLog = providerErrorCd ? getValidErrorCd(providerErrorCd) : undefined;

  // Log only safe operational metadata; never credentials, config or raw errors
  logger.error(`TaxPro request failed during [${operation}]`, {
    status,
    code: mappedError.code,
    error_cd: errorCdForLog
  });

  return mappedError;
}

/**
 * Validate TaxPro JSON response body
 * status_cd "1" = success, status_cd "0" = provider error
 */
function checkTaxProResponse(data, operation) {
  if (!data || typeof data !== 'object') {
    logger.error(`TaxPro returned non-object response during [${operation}]`, {
      code: 'PROVIDER_ERROR'
    });
    throw ApiError.providerError('Could not complete the request. Please try again.', 502);
  }

  if (data.status_cd === '0') {
    const errorCd = data.error?.error_cd;
    let mappedError;

    if (errorCd && SESSION_ERROR_CODES.includes(errorCd)) {
      mappedError = ApiError.sessionExpired('Please verify OTP again.');
    } else if (errorCd === 'RET2B1023') {
      mappedError = ApiError.dataNotAvailable('Data for this period is not available yet. Try another month.');
    } else if (errorCd === 'AUTH4041') {
      mappedError = ApiError.providerError('Could not complete the request. Please try again.', 502);
    } else {
      // Unknown error_cd
      mappedError = ApiError.providerError('Could not complete the request. Please try again.', 502);
    }

    logger.error(`TaxPro returned error status_cd:0 during [${operation}]`, {
      status: 200,
      code: mappedError.code,
      error_cd: getValidErrorCd(errorCd)
    });

    throw mappedError;
  }

  if (data.status_cd !== '1') {
    // Do not put data.status_cd into any log message. Log a fixed message plus typeof data.status_cd.
    logger.error(`TaxPro returned unexpected status_cd during [${operation}] (type: ${typeof data.status_cd})`, {
      code: 'PROVIDER_ERROR',
      status_cd_type: typeof data.status_cd
    });
    throw ApiError.providerError('Could not complete the request. Please try again.', 502);
  }

  return data;
}

class TaxProProvider {
  /**
   * @param {Object} options
   * @param {string} [options.baseURL]
   * @param {string} [options.aspid]
   * @param {string} [options.password]
   * @param {Object} [options.httpClient] Injectable HTTP client for offline testing
   */
  constructor(options = {}) {
    this.baseURL = options.baseURL || process.env.TAXPRO_BASE_URL || 'https://gstsandbox.charteredinfo.com';
    this.aspid = options.aspid !== undefined ? options.aspid : (process.env.TAXPRO_ASPID || '');
    this.password = options.password !== undefined ? options.password : (process.env.TAXPRO_PASSWORD || '');

    // Injectable HTTP client for network-free testing
    this.httpClient = options.httpClient || axios.create({
      baseURL: this.baseURL,
      timeout: 20000
    });
  }

  getAspid() {
    return this.aspid !== undefined && this.aspid !== '' ? this.aspid : (process.env.TAXPRO_ASPID || '');
  }

  getPassword() {
    return this.password !== undefined && this.password !== '' ? this.password : (process.env.TAXPRO_PASSWORD || '');
  }

  /**
   * Search taxpayer business details by GSTIN
   * Not provided by TaxPro GSP
   */
  async searchGstin(gstin) {
    // [CONFIRM] from TaxPro docs: GSTIN search is not provided by TaxPro GSP
    // TODO: ask TaxPro for taxpayer search API endpoint
    throw ApiError.providerError('Taxpayer search is not supported by TaxPro provider', 502);
  }

  /**
   * Request OTP from GST System via TaxPro
   * GET /taxpayerapi/dec/v1.0/authenticate action=OTPREQUEST
   */
  async requestOtp(gstin, username) {
    const path = '/taxpayerapi/dec/v1.0/authenticate';
    const params = {
      action: 'OTPREQUEST',
      aspid: this.getAspid(),
      password: this.getPassword(),
      gstin,
      username
    };

    try {
      const response = await this.httpClient.get(path, { params });
      const data = checkTaxProResponse(response.data, 'requestOtp');
      return {
        status_cd: data.status_cd,
        message: 'OTP has been dispatched successfully to the registered mobile/email on GST portal.'
      };
    } catch (error) {
      throw handleTaxProError(error, 'requestOtp');
    }
  }

  /**
   * Verify OTP and get GST auth token via TaxPro
   * GET /taxpayerapi/dec/v1.0/authenticate action=AUTHTOKEN
   * Returns { token: response.auth_token }. Never store sek.
   */
  async verifyOtp(gstin, username, otp) {
    const path = '/taxpayerapi/dec/v1.0/authenticate';
    const params = {
      action: 'AUTHTOKEN',
      aspid: this.getAspid(),
      password: this.getPassword(),
      gstin,
      username,
      otp
    };

    try {
      const response = await this.httpClient.get(path, { params });
      const data = checkTaxProResponse(response.data, 'verifyOtp');
      // Per Task 6 item 3: verifyOtp returns { token: response.auth_token }. Never store sek.
      return {
        token: data.auth_token
      };
    } catch (error) {
      throw handleTaxProError(error, 'verifyOtp');
    }
  }

  /**
   * Fetch returns summary
   * Not provided by TaxPro GSP
   */
  async getReturnsSummary(gstin, period, gstToken) {
    // [CONFIRM] from TaxPro docs: Returns summary is not provided by TaxPro GSP
    // TODO: ask TaxPro for returns summary API endpoint
    throw ApiError.providerError('Returns summary is not supported by TaxPro provider', 502);
  }

  /**
   * Fetch raw return payload for GSTR1, GSTR2B, or GSTR3B
   * Uses axios "params" only.
   */
  async getReturn(type, gstin, period, token, username = '') {
    const normType = (type || '').toUpperCase();
    let path;
    let action;
    let extraParams = {};

    switch (normType) {
      case 'GSTR1':
        // [CONFIRM] from TaxPro docs: GSTR-1 endpoint version and action
        path = '/taxpayerapi/dec/v2.1/returns/gstr1';
        action = 'B2B';
        extraParams = {
          authtoken: token,
          ret_period: period
        };
        break;

      case 'GSTR3B':
        // [CONFIRM] from TaxPro docs: GSTR-3B endpoint version and action
        path = '/taxpayerapi/dec/v0.3/returns/gstr3b';
        action = 'RETSUM';
        extraParams = {
          authtoken: token,
          ret_period: period
        };
        break;

      case 'GSTR2B':
        path = '/taxpayerapi/dec/v1.0/returns/gstr2b';
        action = 'GET2B';
        extraParams = {
          authtoken: token,
          ret_period: period,
          rtnprd: period // ret_period and rtnprd same value
        };
        break;

      case 'GSTR2A':
        // [CONFIRM] from TaxPro docs: GSTR-2A endpoint version and action
        path = '/taxpayerapi/dec/v1.0/returns/gstr2a';
        action = 'B2B';
        extraParams = {
          authtoken: token,
          ret_period: period
        };
        break;

      default:
        throw ApiError.validationError(`Unsupported return type: ${type}`);
    }

    const params = {
      action,
      aspid: this.getAspid(),
      password: this.getPassword(),
      gstin,
      username: username || '',
      ...extraParams
    };

    try {
      const response = await this.httpClient.get(path, { params });
      const data = checkTaxProResponse(response.data, `getReturn:${normType}`);
      return data;
    } catch (error) {
      throw handleTaxProError(error, `getReturn:${normType}`);
    }
  }
}

const defaultTaxProInstance = new TaxProProvider();
defaultTaxProInstance.TaxProProvider = TaxProProvider;
defaultTaxProInstance.SESSION_ERROR_CODES = SESSION_ERROR_CODES;

module.exports = defaultTaxProInstance;
module.exports.TaxProProvider = TaxProProvider;
module.exports.SESSION_ERROR_CODES = SESSION_ERROR_CODES;
