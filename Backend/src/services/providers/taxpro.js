const axios = require('axios');
const ApiError = require('../../utils/apiError');
const logger = require('../../utils/logger');
const { TaxProGspSession } = require('./taxproGspSession');
const { isValidGstin, isValidPeriod } = require('../../utils/gstin');

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

function mapTaxProErrorCode(errorCd) {
  if (SESSION_ERROR_CODES.includes(errorCd)) {
    return ApiError.sessionExpired('Please verify OTP again.');
  }
  if (errorCd === 'RET2B1023') {
    return ApiError.dataNotAvailable('Data for this period is not available yet. Try another month.');
  }
  if (['GSP018', 'GSP020', 'GSP020A', 'GSP021', 'GSP022', 'GSP023', 'GSP024', 'GSP024A', 'GSP061'].includes(errorCd)) {
    return ApiError.providerAuth('Could not complete the request. Please try again.');
  }
  if (errorCd === 'GSP025') {
    return ApiError.rateLimited('Too many requests. Please wait and try again.');
  }
  if (['GSP027', 'GSP030', 'GSP031', 'GSP032', 'GSP099', 'GSP500'].includes(errorCd)) {
    return ApiError.providerDown('GST service is unavailable. Please try again later.');
  }
  if (errorCd === 'AUTH4041' || errorCd) {
    return ApiError.providerError('Could not complete the request. Please try again.', 502);
  }
  return null;
}

/**
 * Handle and map errors from TaxPro upstream calls
 * SECURITY RULE:
 * - ASP credentials and taxpayer auth tokens travel in headers where supported
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

  if (providerErrorCd) {
    mappedError = mapTaxProErrorCode(providerErrorCd);
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
    const mappedError = mapTaxProErrorCode(errorCd) ||
      ApiError.providerError('Could not complete the request. Please try again.', 502);

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
   * @param {'legacy'|'current'} [options.apiProfile]
   * @param {string} [options.gstr1ActionRequired]
   * @param {Object} [options.httpClient] Injectable HTTP client for offline testing
   */
  constructor(options = {}) {
    this.baseURL = options.baseURL || process.env.TAXPRO_BASE_URL || 'https://gstsandbox.charteredinfo.com';
    let providerUrl;
    try {
      providerUrl = new URL(this.baseURL);
    } catch {
      throw new Error('TAXPRO_BASE_URL must be a valid HTTPS URL');
    }
    if (providerUrl.protocol !== 'https:') {
      throw new Error('TAXPRO_BASE_URL must use HTTPS');
    }
    if (providerUrl.username || providerUrl.password || providerUrl.port || providerUrl.pathname !== '/' ||
        providerUrl.search || providerUrl.hash) {
      throw new Error('TAXPRO_BASE_URL must be an HTTPS origin without credentials, port, path, query, or fragment');
    }
    if (!['gstsandbox.charteredinfo.com', 'gstapi.charteredinfo.com'].includes(providerUrl.hostname.toLowerCase())) {
      throw new Error('TAXPRO_BASE_URL must use the official TaxPro sandbox or production host');
    }
    this.aspid = options.aspid !== undefined ? options.aspid : (process.env.TAXPRO_ASPID || '');
    this.password = options.password !== undefined ? options.password : (process.env.TAXPRO_PASSWORD || '');
    this.apiProfile = (options.apiProfile || process.env.TAXPRO_API_PROFILE || 'legacy').trim().toLowerCase();
    if (!['legacy', 'current'].includes(this.apiProfile)) {
      throw new Error('TAXPRO_API_PROFILE must be legacy or current');
    }
    this.gstr1ActionRequired = (options.gstr1ActionRequired || process.env.TAXPRO_GSTR1_ACTION_REQUIRED || '').trim().toUpperCase();

    // Injectable HTTP client for network-free testing
    this.httpClient = options.httpClient || axios.create({
      baseURL: this.baseURL,
      timeout: 20000,
      maxRedirects: 0
    });
    this.aspCallerGstin = options.aspCallerGstin || process.env.TAXPRO_ASP_GSTIN || '';
    this.gspSession = options.gspSession || new TaxProGspSession({
      aspid: this.aspid,
      password: this.password,
      privateKeyPath: options.privateKeyPath,
      privateKeyPassphrase: options.privateKeyPassphrase,
      httpClient: this.httpClient
    });
  }

  getAspid() {
    return this.aspid !== undefined && this.aspid !== '' ? this.aspid : (process.env.TAXPRO_ASPID || '');
  }

  getPassword() {
    return this.password !== undefined && this.password !== '' ? this.password : (process.env.TAXPRO_PASSWORD || '');
  }

  /**
   * Search taxpayer business details by GSTIN.
   * TaxPro documents this public API, but it requires the ASP GSP-session signing flow.
   */
  async searchGstin(gstin) {
    if (!isValidGstin(gstin)) throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    if (!isValidGstin(this.aspCallerGstin)) {
      throw ApiError.providerError('TaxPro taxpayer search is not configured.', 502);
    }
    const response = await this.requestGspPublicApi('/commonapi/v1.1/search', {
      action: 'TP',
      gstin: this.aspCallerGstin,
      searchgstin: gstin
    }, 'gsp:searchTaxpayer');

    // The provider documents these fields but not the response envelope. Accept the
    // documented flat object and fail closed on an unverified wrapper shape.
    if (typeof response.gstin !== 'string' || response.gstin.toUpperCase() !== gstin.toUpperCase() ||
        typeof response.lgnm !== 'string' || !response.lgnm.trim()) {
      throw ApiError.providerError('TaxPro taxpayer-search response shape is not recognized.', 502);
    }
    return {
      gstin: gstin.toUpperCase(),
      legalName: response.lgnm,
      tradeName: null,
      status: typeof response.sts === 'string' ? response.sts : null,
      businessType: typeof response.ctb === 'string' ? response.ctb : null,
      registeredDate: typeof response.rgdt === 'string' ? response.rgdt : null,
      natureOfBusiness: typeof response.nba === 'string' || Array.isArray(response.nba) ? response.nba : null,
      verified: true
    };
  }

  async requestGspPublicApi(path, params, operation) {
    let headers;
    try {
      headers = await this.gspSession.getHeaders();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw ApiError.providerError('TaxPro GSP signing-key configuration is invalid.', 502);
    }
    try {
      const response = await this.httpClient.get(path, { params, headers });
      return checkTaxProResponse(response.data, operation);
    } catch (error) {
      throw handleTaxProError(error, operation);
    }
  }

  /**
   * Request OTP from GST System via TaxPro
   * GET /taxpayerapi/dec/v1.0/authenticate action=OTPREQUEST
   */
  async requestOtp(gstin, username) {
    const path = '/taxpayerapi/dec/v1.0/authenticate';
    const params = {
      action: 'OTPREQUEST',
      gstin,
      username
    };
    const headers = { aspid: this.getAspid(), password: this.getPassword() };

    try {
      const response = await this.httpClient.get(path, { params, headers });
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
      gstin,
      username,
      OTP: otp
    };
    const headers = { aspid: this.getAspid(), password: this.getPassword() };

    try {
      const response = await this.httpClient.get(path, { params, headers });
      const data = checkTaxProResponse(response.data, 'verifyOtp');
      if (typeof data.auth_token !== 'string' || !data.auth_token.trim()) {
        throw ApiError.providerError('Could not complete the request. Please try again.', 502);
      }
      // Per Task 6 item 3: verifyOtp returns { token: response.auth_token }. Never store sek.
      return {
        token: data.auth_token
      };
    } catch (error) {
      throw handleTaxProError(error, 'verifyOtp');
    }
  }

  /**
   * Fetch filed-return tracking data.
   * TaxPro documents RETTRACK; it requires the ASP GSP-session signing flow.
   */
  async getReturnsSummary(gstin, period, gstToken) {
    // TaxPro requires a financial year rather than a monthly period for RETTRACK.
    // A response mapper remains gated on a real sandbox sample of this API's wrapper.
    if (!isValidPeriod(period)) {
      throw ApiError.validationError('Return tracking requires a valid MMYYYY period.');
    }
    const month = Number(period.slice(0, 2));
    const year = Number(period.slice(2));
    const startYear = month >= 4 ? year : year - 1;
    const financialYear = `${startYear}-${String(startYear + 1).slice(-2)}`;
    const response = await this.requestGspPublicApi('/commonapi/v1.0/returns', {
      action: 'RETTRACK',
      gstin: gstin.toUpperCase(),
      fy: financialYear
    }, 'gsp:trackReturns');
    throw ApiError.providerError(
      `TaxPro return-tracking response received for ${financialYear}, but its mapper requires a sanitized provider sample.`,
      502
    );
  }

  /**
   * Fetch raw return payload for GSTR1, GSTR2B, or GSTR3B.
   * The TaxPro email confirms the legacy routes. Current routes use documented
   * common headers (including ret_prd) and endpoint-specific query parameters.
   * Uses headers for ASP credentials and taxpayer auth token to avoid putting them in URLs.
   */
  async getReturn(type, gstin, period, token, username = '') {
    const normType = (type || '').toUpperCase();
    let path;
    let action;
    let extraParams = {};

    switch (normType) {
      case 'GSTR1':
        path = this.apiProfile === 'current'
          ? '/taxpayerapi/dec/v4.1/returns/gstr1'
          : '/taxpayerapi/dec/v2.1/returns/gstr1';
        action = 'B2B';
        extraParams = {};
        if (this.apiProfile === 'current') {
          if (!['Y', 'N'].includes(this.gstr1ActionRequired)) {
            throw ApiError.providerError('Current TaxPro GSTR-1 action_required has not been confirmed.', 502);
          }
          extraParams.action_required = this.gstr1ActionRequired;
        } else {
          extraParams.ret_period = period;
        }
        break;

      case 'GSTR3B':
        path = this.apiProfile === 'current'
          ? '/taxpayerapi/dec/v7.0/returns/gstr3b'
          : '/taxpayerapi/dec/v0.3/returns/gstr3b';
        action = 'RETSUM';
        extraParams = {};
        if (this.apiProfile !== 'current') {
          extraParams.ret_period = period;
        }
        break;

      case 'GSTR2B':
        path = this.apiProfile === 'current'
          ? '/taxpayerapi/dec/v4.2/returns/gstr2b'
          : '/taxpayerapi/dec/v1.0/returns/gstr2b';
        action = 'GET2B';
        extraParams = {};
        if (this.apiProfile !== 'current') {
          extraParams.ret_period = period;
          extraParams.rtnprd = period;
        }
        break;

      case 'GSTR2A':
        // [CONFIRM] from TaxPro docs: GSTR-2A endpoint version and action
        path = '/taxpayerapi/dec/v1.0/returns/gstr2a';
        action = 'B2B';
        extraParams = {
          ret_period: period
        };
        break;

      default:
        throw ApiError.validationError(`Unsupported return type: ${type}`);
    }

    const params = this.apiProfile === 'current'
      ? { action, ...extraParams }
      : { action, gstin, username: username || '', ...extraParams };
    const headers = {
      aspid: this.getAspid(),
      password: this.getPassword(),
      authtoken: token
    };
    if (this.apiProfile === 'current') {
      Object.assign(headers, { gstin, username: username || '', ret_prd: period });
    }

    try {
      const response = await this.httpClient.get(path, { params, headers });
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
module.exports.checkTaxProResponse = checkTaxProResponse;
module.exports.mapTaxProErrorCode = mapTaxProErrorCode;
module.exports.handleTaxProError = handleTaxProError;
