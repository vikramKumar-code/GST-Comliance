const FinaggMock = require('./finagg.mock');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

/* -------------------------------------------------------------------------- */
/* Config helpers                                                             */
/* -------------------------------------------------------------------------- */

const VALID_PROVIDERS = new Set(['mock', 'taxpro']);
const MOCK_PROVIDER_NAMES = new Set(['mock', 'demo', 'stub', 'fake']);
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'y', 'on']);

function isTruthyEnv(value) {
  return TRUTHY_VALUES.has(String(value || '').trim().toLowerCase());
}

function isProductionRuntime() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function safeLogError(error) {
  if (!error) return 'unknown';

  const msg =
    typeof error === 'string'
      ? error
      : typeof error.message === 'string'
        ? error.message
        : 'unknown';

  return (
    msg
      .replace(/https?:\/\/\S+/gi, '[URL_REDACTED]')
      .replace(
        /(password|token|secret|authtoken|auth-token|OTP|sid|sign|aspid)\s*[:=]\s*\S+/gi,
        '$1=[REDACTED]'
      )
      .slice(0, 220) || 'unknown'
  );
}

/**
 * Strict provider resolution.
 *
 * Rules:
 * - USE_MOCK=true forces mock.
 * - PROVIDER=mock|taxpro explicit.
 * - If unset: production => taxpro, non-production => mock.
 * - Mock in production is blocked unless ALLOW_MOCK_IN_PRODUCTION=true.
 * - Invalid PROVIDER fails closed.
 */
function getProviderName() {
  const useMock = isTruthyEnv(process.env.USE_MOCK);
  const allowMockInProduction = isTruthyEnv(process.env.ALLOW_MOCK_IN_PRODUCTION);
  const configured = String(process.env.PROVIDER || '').trim().toLowerCase();

  let name;

  if (useMock) {
    name = 'mock';
  } else if (configured) {
    name = configured;
  } else {
    name = isProductionRuntime() ? 'taxpro' : 'mock';
  }

  if (!VALID_PROVIDERS.has(name)) {
    throw ApiError.providerError(
      'PROVIDER must be either "mock" or "taxpro".',
      500
    );
  }

  if (name === 'mock' && isProductionRuntime() && !allowMockInProduction) {
    throw ApiError.providerError(
      'Mock GST provider is not allowed in production. Use PROVIDER=taxpro, or set ALLOW_MOCK_IN_PRODUCTION=true only for approved test environments.',
      503
    );
  }

  return name;
}

/**
 * Safe provider name for audit/logging/cache-source tagging.
 * Never throws.
 */
function getProviderNameSafe() {
  try {
    return getProviderName();
  } catch {
    return 'unknown';
  }
}

function isMockProviderName(name) {
  return MOCK_PROVIDER_NAMES.has(String(name || '').trim().toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* Lazy TaxPro loader                                                         */
/* -------------------------------------------------------------------------- */

let cachedTaxProProvider = null;
let cachedTaxProError = null;

/**
 * TaxPro is loaded lazily so mock-only environments do not crash due to
 * invalid/missing TAXPRO_* configuration.
 */
function loadTaxProProvider() {
  if (cachedTaxProProvider) {
    return cachedTaxProProvider;
  }

  if (cachedTaxProError) {
    throw cachedTaxProError;
  }

  try {
    const taxProModule = require('./providers/taxpro');

    /**
     * taxpro.js exports a default provider instance and also attaches
     * TaxProProvider class/helpers on the same export.
     */
    const provider = taxProModule?.default || taxProModule;

    if (!provider || typeof provider !== 'object') {
      throw new Error('TaxPro provider module did not export a provider instance.');
    }

    cachedTaxProProvider = provider;
    return provider;
  } catch (err) {
    const mapped = ApiError.providerError(
      'TaxPro provider could not be initialized. Check TAXPRO_* environment configuration.',
      500
    );

    mapped.cause = err;
    cachedTaxProError = mapped;

    logger.error('TaxPro provider initialization failed', {
      error: safeLogError(err)
    });

    throw mapped;
  }
}

function getProvider() {
  const name = getProviderName();

  if (name === 'taxpro') {
    return loadTaxProProvider();
  }

  return FinaggMock;
}

/* -------------------------------------------------------------------------- */
/* Provider capability helpers                                                */
/* -------------------------------------------------------------------------- */

function requireProviderMethod(provider, method, label) {
  if (!provider || typeof provider[method] !== 'function') {
    throw ApiError.providerError(
      `Active GST provider does not support ${label || method}.`,
      502
    );
  }

  return provider[method].bind(provider);
}

/**
 * Normalize flexible auth arguments.
 *
 * Supports old styles:
 * - (token, username, options)
 * - (options)
 * - (token, options)
 */
function normalizeAuthContext(gstToken, username, options) {
  let token = null;
  let user = '';
  let opts = {};

  if (gstToken && typeof gstToken === 'object' && !Array.isArray(gstToken)) {
    opts = gstToken;
  } else if (gstToken !== undefined && gstToken !== null) {
    token = String(gstToken).trim();
  }

  if (username && typeof username === 'object' && !Array.isArray(username)) {
    opts = { ...opts, ...username };
  } else if (username !== undefined && username !== null) {
    user = String(username).trim();
  }

  if (options && typeof options === 'object' && !Array.isArray(options)) {
    opts = { ...opts, ...options };
  }

  token =
    token ||
    opts.token ||
    opts.gstToken ||
    opts.authToken ||
    opts.auth_token ||
    null;

  user =
    user ||
    opts.username ||
    opts.user ||
    '';

  return {
    token: token ? String(token).trim() : null,
    username: user,
    options: opts
  };
}

function buildAuthOptions(auth) {
  const opts = { ...(auth.options || {}) };

  if (auth.token && !opts.token) opts.token = auth.token;
  if (auth.token && !opts.gstToken) opts.gstToken = auth.token;
  if (auth.username && !opts.username) opts.username = auth.username;

  return opts;
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

class FinaggService {
  static getProviderName() {
    return getProviderName();
  }

  static getProviderNameSafe() {
    return getProviderNameSafe();
  }

  static getProvider() {
    return getProvider();
  }

  static isMockProvider() {
    return isMockProviderName(getProviderName());
  }

  static isMockProviderSafe() {
    return isMockProviderName(getProviderNameSafe());
  }

  /**
   * Assert that active provider supports all required methods.
   * Useful before long filing pipelines.
   */
  static assertProviderSupports(methods, label) {
    const provider = getProvider();

    for (const method of methods) {
      requireProviderMethod(provider, method, label);
    }

    return provider;
  }

  /**
   * Lightweight capability snapshot for diagnostics/support.
   * Does not throw on invalid provider config.
   */
  static getProviderCapabilities() {
    try {
      const provider = getProvider();
      const methods = [];

      for (const key of Object.keys(provider || {})) {
        if (typeof provider[key] === 'function') {
          methods.push(key);
        }
      }

      return {
        name: getProviderNameSafe(),
        methods
      };
    } catch (err) {
      return {
        name: 'unknown',
        methods: [],
        error: safeLogError(err)
      };
    }
  }

  /* ---------------------------------------------------------------------- */
  /* GSTIN search / auth                                                    */
  /* ---------------------------------------------------------------------- */

  static async searchGstin(gstin) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'searchGstin', 'GSTIN search');

    return fn(gstin);
  }

  static async requestOtp(gstin, username) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'requestOtp', 'OTP request');

    return fn(gstin, username);
  }

  static async verifyOtp(gstin, username, otp) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'verifyOtp', 'OTP verification');

    const res = await fn(gstin, username, otp);

    return {
      token: res?.token || res?.auth_token || null
    };
  }

  static async refreshToken(gstin, username, token) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'refreshToken', 'session token refresh');

    const res = await fn(gstin, username, token);

    return {
      token: res?.token || res?.auth_token || null
    };
  }

  static async requestEvcOtp(gstin, username, pan, formType, token, period) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'requestEvcOtp', 'EVC OTP request');

    const auth = normalizeAuthContext(token, username, {});

    return fn(
      gstin,
      auth.username || username,
      pan,
      formType,
      auth.token || token,
      period
    );
  }

  /**
   * Latest token known to active provider process, if provider supports it.
   * Returns null if not available.
   */
  static getActiveToken(gstin, username) {
    const provider = getProvider();

    if (typeof provider.getActiveToken === 'function') {
      try {
        return provider.getActiveToken(gstin, username);
      } catch (err) {
        logger.warn('Provider getActiveToken failed', {
          error: safeLogError(err)
        });
      }
    }

    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Return read APIs                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Backward-compatible signature:
   * getReturnsSummary(gstin, period, gstToken, username, options)
   *
   * Also supports:
   * getReturnsSummary(gstin, period, options)
   */
  static async getReturnsSummary(gstin, period, gstToken, username, options) {
    const provider = getProvider();
    const name = getProviderName();
    const fn = requireProviderMethod(provider, 'getReturnsSummary', 'return tracking');

    const auth = normalizeAuthContext(gstToken, username, options);

    if (name === 'taxpro') {
      /**
       * TaxPro current signature:
       * getReturnsSummary(gstin, period, gstToken)
       *
       * It currently uses GSP public API signing and does not require taxpayer
       * token for RETTRACK, but we keep passing token/options for future-proofing.
       */
      return fn(gstin, period, auth.token || buildAuthOptions(auth));
    }

    return fn(gstin, period, buildAuthOptions(auth));
  }

  /**
   * Backward-compatible signature:
   * getReturn(type, gstin, period, gstToken, username, options)
   *
   * Also supports:
   * getReturn(type, gstin, period, options)
   */
  static async getReturn(type, gstin, period, gstToken, username, options) {
    const provider = getProvider();
    const name = getProviderName();
    const fn = requireProviderMethod(provider, 'getReturn', 'return fetch');

    const auth = normalizeAuthContext(gstToken, username, options);

    if (name === 'taxpro') {
      /**
       * TaxPro signature:
       * getReturn(type, gstin, period, token, username)
       */
      return fn(
        type,
        gstin,
        period,
        auth.token,
        auth.username || auth.options?.username || ''
      );
    }

    return fn(type, gstin, period, buildAuthOptions(auth));
  }

  /* ---------------------------------------------------------------------- */
  /* GSTR-1 filing passthroughs                                             */
  /* ---------------------------------------------------------------------- */

  static async saveGstr1(payload, options = {}) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'saveGstr1', 'GSTR-1 save');

    return fn(payload, options);
  }

  static async trackStatus(refId, options = {}) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'trackStatus', 'GSTN status tracking');

    return fn(refId, options);
  }

  static async proceedToFile(period, options = {}) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'proceedToFile', 'GSTR-1 proceed to file');

    return fn(period, options);
  }

  static async submitGstr1(period, options = {}) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'submitGstr1', 'GSTR-1 submit');

    return fn(period, options);
  }

  static async fileGstr1(period, options = {}) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'fileGstr1', 'GSTR-1 RETFILE');

    return fn(period, options);
  }

  /**
   * Flexible GSTR-1 RETSUM wrapper.
   *
   * Supports:
   * - getGstr1RetSum(gstin, period, username, token, isNil)
   * - getGstr1RetSum(gstin, period, options)
   */
  static async getGstr1RetSum(gstin, period, usernameOrOptions, token, isNil) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'getGstr1RetSum', 'GSTR-1 summary');

    if (usernameOrOptions && typeof usernameOrOptions === 'object') {
      return fn(gstin, period, usernameOrOptions);
    }

    return fn(gstin, period, usernameOrOptions, token, isNil);
  }

  /**
   * Parsed GSTR-1 summary helper for nil confirmation / validation.
   *
   * Prefers provider.getGstr1Summary / fetchGstr1Summary.
   * Falls back to getGstr1RetSum + JSON parse if only raw summary is available.
   */
  static async getGstr1Summary(gstin, period, options = {}) {
    const provider = getProvider();

    const parsedMethod = ['getGstr1Summary', 'fetchGstr1Summary'].find(
      (method) => typeof provider[method] === 'function'
    );

    if (parsedMethod) {
      return provider[parsedMethod](gstin, period, options);
    }

    if (typeof provider.getGstr1RetSum === 'function') {
      const raw = await provider.getGstr1RetSum(
        gstin,
        period,
        options.username || '',
        options.token || options.gstToken,
        options.isNil === true
      );

      let parsed;

      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        throw ApiError.providerError(
          'GSTR-1 summary response was not valid JSON.',
          502
        );
      }

      return parsed?.data && typeof parsed.data === 'object'
        ? parsed.data
        : parsed;
    }

    throw ApiError.providerError(
      'Active GST provider does not support GSTR-1 summary confirmation.',
      502
    );
  }

  static hasGstr1SummaryConfirmation() {
    try {
      const provider = getProvider();

      return (
        typeof provider.getGstr1Summary === 'function' ||
        typeof provider.fetchGstr1Summary === 'function' ||
        typeof provider.getGstr1RetSum === 'function'
      );
    } catch {
      return false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* GSTR-3B filing passthroughs                                            */
  /* ---------------------------------------------------------------------- */

  static async saveGstr3b(payload, options = {}) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'saveGstr3b', 'GSTR-3B save');

    return fn(payload, options);
  }

  static async getGstr3bRetSum(gstin, period, options = {}) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'getGstr3bRetSum', 'GSTR-3B summary');

    return fn(gstin, period, options);
  }

  static async offsetGstr3b(period, options = {}) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'offsetGstr3b', 'GSTR-3B liability offset');

    return fn(period, options);
  }

  static async fileGstr3b(period, options = {}) {
    const provider = getProvider();
    const fn = requireProviderMethod(provider, 'fileGstr3b', 'GSTR-3B RETFILE');

    return fn(period, options);
  }

  /* ---------------------------------------------------------------------- */
  /* Filing recovery                                                        */
  /* ---------------------------------------------------------------------- */

  /**
   * Safe ARN recovery after indeterminate RETFILE.
   * Returns null if provider cannot confirm or method is unavailable.
   */
  static async findFiledArn(gstin, period, returnType = 'GSTR1') {
    const provider = getProvider();

    if (typeof provider.findFiledArn !== 'function') {
      return null;
    }

    try {
      return await provider.findFiledArn(gstin, period, returnType);
    } catch (err) {
      logger.warn('Provider findFiledArn failed', {
        gstin,
        period,
        returnType,
        error: safeLogError(err)
      });

      return null;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports = FinaggService;

// Also expose helpers for tests/diagnostics.
module.exports.getProviderName = getProviderName;
module.exports.getProviderNameSafe = getProviderNameSafe;
module.exports.getProvider = getProvider;
module.exports.isMockProviderName = isMockProviderName;