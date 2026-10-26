const crypto = require('node:crypto');
const axios = require('axios');
const ApiError = require('../../utils/apiError');
const logger = require('../../utils/logger');
const { TaxProGspSession } = require('./taxproGspSession');
const { isValidGstin, isValidPeriod } = require('../../utils/gstin');

// Official TaxPro / GSTN error codes for an expired or invalid taxpayer auth token
const SESSION_ERROR_CODES = ['AUTH4038', 'GSP052', 'GSP052A', 'TEC4002'];

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
 * Safe header diagnostics: reports header names and presence only.
 * Never log secrets, passwords, auth tokens, OTPs, or private keys.
 */
function formatSafeHeaderDiagnostics(headers) {
  const summary = {};
  for (const [key, val] of Object.entries(headers || {})) {
    summary[key] = val !== undefined && val !== null && String(val).length > 0 ? '[PRESENT]' : '[EMPTY]';
  }
  return summary;
}

function mapTaxProErrorCode(errorCd) {
  if (SESSION_ERROR_CODES.includes(errorCd)) {
    return ApiError.sessionExpired('Please verify OTP again.');
  }
  if (errorCd === 'RET2B1023') {
    return ApiError.dataNotAvailable('Data for this period is not available yet. Try another month.');
  }
  if (errorCd === 'GSP053') {
    return ApiError.otpInvalid('OTP request has expired or was not found. Please request a new OTP.');
  }
  if (errorCd === 'AUTH4037') {
    return ApiError.validationError('Portal user is not registered with this GSTIN. Please check your portal username and GSTIN.');
  }
  if (['GSP014', 'GSP018', 'GSP020', 'GSP020A', 'GSP021', 'GSP022', 'GSP023', 'GSP024', 'GSP024A', 'GSP061'].includes(errorCd)) {
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

const PERIOD_PLACEMENT = 'both';

class TaxProProvider {
  /**
   * @param {Object} options
   * @param {string} [options.baseURL]
   * @param {string} [options.aspid]
   * @param {string} [options.password]
   * @param {'legacy'|'current'} [options.apiProfile]
   * @param {'header'|'query'|'both'} [options.periodPlacement]
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
    this.periodPlacement = (options.periodPlacement || process.env.TAXPRO_PERIOD_PLACEMENT || PERIOD_PLACEMENT).trim().toLowerCase();
    if (!['header', 'query', 'both'].includes(this.periodPlacement)) {
      throw new Error('TAXPRO_PERIOD_PLACEMENT must be header, query, or both');
    }
    this.gstr1ActionRequired = (options.gstr1ActionRequired || process.env.TAXPRO_GSTR1_ACTION_REQUIRED || '').trim().toUpperCase();

    // Injectable HTTP client for network-free testing
    this.httpClient = options.httpClient || axios.create({
      baseURL: this.baseURL,
      timeout: 20000,
      maxRedirects: 0
    });
    this.aspCallerGstin = options.aspCallerGstin || process.env.TAXPRO_ASP_GSTIN || '';
    this.ipUsr = options.ipUsr !== undefined ? options.ipUsr : (process.env.TAXPRO_GSP_IP_USR || '');
    this.gspSession = options.gspSession || new TaxProGspSession({
      aspid: this.aspid,
      password: this.password,
      privateKeyPath: options.privateKeyPath,
      privateKeyPassphrase: options.privateKeyPassphrase,
      ipUsr: this.ipUsr,
      httpClient: this.httpClient
    });
  }

  getAspid() {
    return this.aspid !== undefined ? this.aspid : (process.env.TAXPRO_ASPID || '');
  }

  getPassword() {
    return this.password !== undefined ? this.password : (process.env.TAXPRO_PASSWORD || '');
  }

  getIpUsr() {
    return this.ipUsr !== undefined && this.ipUsr !== '' ? this.ipUsr : (process.env.TAXPRO_GSP_IP_USR || '');
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
      const safeReason = error && typeof error.message === 'string'
        ? error.message
        : 'TaxPro GSP signing-key configuration is invalid.';
      logger.error(`TaxPro GSP signing-key error during [${operation}]`, {
        code: 'PROVIDER_ERROR',
        reason: safeReason
      });
      throw ApiError.providerError(`TaxPro GSP signing-key configuration is invalid: ${safeReason}`, 502);
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
    if (!isValidGstin(gstin)) throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw ApiError.validationError('Username is required.');
    }
    const aspid = this.getAspid();
    const password = this.getPassword();
    if (!aspid || !password) {
      throw ApiError.providerError('TaxPro ASP credentials (TAXPRO_ASPID, TAXPRO_PASSWORD) are not configured.', 500);
    }
    const path = '/taxpayerapi/dec/v1.0/authenticate';
    const params = {
      action: 'OTPREQUEST',
      gstin: gstin.toUpperCase(),
      username: username.trim()
    };
    const headers = { aspid, password };

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
    if (!isValidGstin(gstin)) throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw ApiError.validationError('Username is required.');
    }
    if (!otp || typeof otp !== 'string' || !/^[0-9]{4,8}$/.test(otp.trim())) {
      throw ApiError.validationError('OTP must be 4 to 8 digits.');
    }
    const aspid = this.getAspid();
    const password = this.getPassword();
    if (!aspid || !password) {
      throw ApiError.providerError('TaxPro ASP credentials (TAXPRO_ASPID, TAXPRO_PASSWORD) are not configured.', 500);
    }
    const path = '/taxpayerapi/dec/v1.0/authenticate';
    const params = {
      action: 'AUTHTOKEN',
      gstin: gstin.toUpperCase(),
      username: username.trim(),
      OTP: otp.trim()
    };
    const headers = { aspid, password };

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
   * Refresh GST AuthToken via TaxPro
   * GET /taxpayerapi/dec/v1.0/authenticate action=REFRESHTOKEN
   * Query params: action=REFRESHTOKEN, gstin, username
   * Headers: aspid, password, auth-token / AuthToken
   * Returns { token: response.auth_token }. Never store sek.
   */
  async refreshToken(gstin, username, token) {
    if (!isValidGstin(gstin)) throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw ApiError.validationError('Username is required.');
    }
    if (!token || typeof token !== 'string' || !token.trim()) {
      throw ApiError.validationError('Auth token is required to refresh session.');
    }
    const aspid = this.getAspid();
    const password = this.getPassword();
    if (!aspid || !password) {
      throw ApiError.providerError('TaxPro ASP credentials (TAXPRO_ASPID, TAXPRO_PASSWORD) are not configured.', 500);
    }
    const path = '/taxpayerapi/dec/v1.0/authenticate';
    const params = {
      action: 'REFRESHTOKEN',
      gstin: gstin.toUpperCase(),
      username: username.trim()
    };
    const cleanToken = token.trim();
    const headers = {
      aspid,
      password,
      'auth-token': cleanToken,
      AuthToken: cleanToken
    };

    try {
      const response = await this.httpClient.get(path, { params, headers });
      const data = checkTaxProResponse(response.data, 'refreshToken');
      if (typeof data.auth_token !== 'string' || !data.auth_token.trim()) {
        throw ApiError.providerError('Could not complete the request. Please try again.', 502);
      }
      return {
        token: data.auth_token
      };
    } catch (error) {
      throw handleTaxProError(error, 'refreshToken');
    }
  }

  /**
   * Request EVC OTP for electronic verification / return filing via TaxPro
   * GET /taxpayerapi/dec/v1.0/authenticate action=EVCOTP
   * Query params: action=EVCOTP, gstin, username, pan, form_type
   * Headers: aspid, password, auth-token / authtoken
   */
  async requestEvcOtp(gstin, username, pan, formType, token) {
    if (!isValidGstin(gstin)) throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw ApiError.validationError('Username is required.');
    }
    if (!pan || typeof pan !== 'string' || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.trim().toUpperCase())) {
      throw ApiError.validationError('Invalid PAN format. Must be 10 characters (e.g. ABCDE1234F).');
    }
    if (!formType || typeof formType !== 'string' || !formType.trim()) {
      throw ApiError.validationError('Form type is required for EVC OTP.');
    }
    if (!token || typeof token !== 'string' || !token.trim()) {
      throw ApiError.validationError('Auth token is required for EVC OTP request.');
    }
    const aspid = this.getAspid();
    const password = this.getPassword();
    if (!aspid || !password) {
      throw ApiError.providerError('TaxPro ASP credentials (TAXPRO_ASPID, TAXPRO_PASSWORD) are not configured.', 500);
    }
    const path = '/taxpayerapi/dec/v1.0/authenticate';
    const params = {
      action: 'EVCOTP',
      gstin: gstin.toUpperCase(),
      username: username.trim(),
      pan: pan.trim().toUpperCase(),
      form_type: formType.trim().toUpperCase()
    };
    const cleanToken = token.trim();
    const headers = {
      aspid,
      password,
      'auth-token': cleanToken,
      authtoken: cleanToken
    };

    try {
      const response = await this.httpClient.get(path, { params, headers });
      const data = checkTaxProResponse(response.data, 'requestEvcOtp');
      return {
        status_cd: data.status_cd,
        message: 'EVC OTP has been dispatched successfully to the registered mobile/email on GST portal.'
      };
    } catch (error) {
      throw handleTaxProError(error, 'requestEvcOtp');
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

    const sendHeaderPeriod = this.periodPlacement === 'header' || this.periodPlacement === 'both';
    const sendQueryPeriod = this.periodPlacement === 'query' || this.periodPlacement === 'both';

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
          if (sendQueryPeriod) {
            extraParams.ret_period = period;
          }
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
        if (this.apiProfile === 'current') {
          if (sendQueryPeriod) {
            extraParams.ret_period = period;
          }
        } else {
          extraParams.ret_period = period;
        }
        break;

      case 'GSTR2B':
        // TaxPro GSTR-2B v4.2 GET2B endpoint.
        // Optional parameters: 'typ' (section/type) and 'file_num' (chunking/pagination) are documented
        // in TaxPro UCL docs but omitted here until supported values and pagination thresholds are confirmed.
        // Companion APIs: GEN2B (PUT /taxpayerapi/dec/v4.1/returns/gstr2b) and GENSTS2B
        // (GET /taxpayerapi/dec/v4.1/returns/gstr2b) provide on-demand generation and tracking (e.g. on RET2B1023),
        // but remain unintegrated pending provider confirmation on parameter placement (query vs JSON body).
        path = this.apiProfile === 'current'
          ? '/taxpayerapi/dec/v4.2/returns/gstr2b'
          : '/taxpayerapi/dec/v1.0/returns/gstr2b';
        action = 'GET2B';
        extraParams = {};
        if (this.apiProfile === 'current') {
          if (sendQueryPeriod) {
            extraParams.ret_period = period;
            extraParams.rtnprd = period;
          }
        } else {
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
      ? { action, gstin, ...extraParams }
      : { action, gstin, username: username || '', ...extraParams };
    const headers = {
      aspid: this.getAspid(),
      password: this.getPassword(),
      'auth-token': token
    };
    if (this.apiProfile === 'current') {
      const stateCd = typeof gstin === 'string' && gstin.length >= 2 ? gstin.slice(0, 2) : '';
      const ipUsr = this.getIpUsr();
      if (!ipUsr) {
        logger.error('TaxPro return request failed: TAXPRO_GSP_IP_USR is required for current profile');
        throw ApiError.providerError('TAXPRO_GSP_IP_USR is required for TaxPro return requests.', 500);
      }
      Object.assign(headers, {
        gstin,
        username: username || '',
        'state-cd': stateCd,
        txn: crypto.randomUUID(),
        'ip-usr': ipUsr
      });
      if (sendHeaderPeriod) {
        headers.ret_period = period;
      }
    }

    try {
      logger.debug(`TaxPro return request dispatched for [${normType}]`);
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
defaultTaxProInstance.PERIOD_PLACEMENT = PERIOD_PLACEMENT;

module.exports = defaultTaxProInstance;
module.exports.TaxProProvider = TaxProProvider;
module.exports.SESSION_ERROR_CODES = SESSION_ERROR_CODES;
module.exports.PERIOD_PLACEMENT = PERIOD_PLACEMENT;
module.exports.checkTaxProResponse = checkTaxProResponse;
module.exports.mapTaxProErrorCode = mapTaxProErrorCode;
module.exports.handleTaxProError = handleTaxProError;
module.exports.formatSafeHeaderDiagnostics = formatSafeHeaderDiagnostics;
