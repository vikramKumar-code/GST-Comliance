import axios from 'axios';

/* -------------------------------------------------------------------------- */
/* Base URL config                                                            */
/* -------------------------------------------------------------------------- */

const rawBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:4000';

export const BACKEND_BASE_URL = rawBaseUrl.replace(/\/api\/?$/, '');
export const API_BASE_URL = `${BACKEND_BASE_URL}/api`;

/* -------------------------------------------------------------------------- */
/* Timeout config                                                             */
/* -------------------------------------------------------------------------- */

function toPositiveNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * General API timeout.
 * Keep this reasonable for normal CRUD/list APIs.
 */
export const DEFAULT_TIMEOUT_MS = toPositiveNumber(
  import.meta.env.VITE_API_TIMEOUT_MS,
  90000
);

/**
 * GST filing/save/offset/nil timeout.
 * Must be greater than backend GST_FILING_ROUTE_TIMEOUT_MS.
 *
 * Backend default filing timeout is commonly 120000 ms.
 * Frontend default is kept 180000 ms for safety.
 */
export const FILING_TIMEOUT_MS = toPositiveNumber(
  import.meta.env.VITE_GST_FILING_TIMEOUT_MS,
  180000
);

/**
 * Upload/import timeout.
 * Excel/CSV bulk imports can be heavier than normal JSON APIs.
 */
export const UPLOAD_TIMEOUT_MS = toPositiveNumber(
  import.meta.env.VITE_UPLOAD_TIMEOUT_MS,
  180000
);

/* -------------------------------------------------------------------------- */
/* Friendly error messages                                                    */
/* -------------------------------------------------------------------------- */

const FRIENDLY_ERROR_MESSAGES = {
  INVALID_GSTIN: 'Taxpayer GSTIN not found or invalid format.',
  VALIDATION_ERROR: 'Invalid input parameters. Please check your entries.',
  OTP_INVALID: 'Invalid or expired OTP. Please check and try again.',
  SESSION_EXPIRED: 'Please verify OTP again.',
  DATA_NOT_AVAILABLE: 'Data for this period is not available yet. Try another month.',
  RATE_LIMITED: 'Too many requests. Please wait and try again.',
  PROVIDER_AUTH:
    'The GST service could not authorize this request. Check that the GST portal username belongs to this GSTIN and that API access is enabled for the GSTIN.',
  PROVIDER_ERROR:
    'The GST service could not complete this request on the government portal. Please verify return status or try again in a few moments.',
  PROVIDER_DOWN: 'GST service is unavailable. Please try again later.',
  SERVER_ERROR: 'Internal server error. Please try again later.',
  REQUEST_TIMEOUT:
    'The GST portal or server took too long to respond. Please check filing status before retrying.',
  TIMEOUT: 'Request timed out. Please try again.',
  NETWORK_ERROR: 'Network connection failed. Please try again.',
  REQUEST_CANCELED: 'Request was canceled.'
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Generate a request id compatible with backend X-Request-Id.
 */
export function newRequestId() {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generate backend-valid idempotency key.
 *
 * Backend regex:
 * /^[A-Za-z0-9:_-]{8,128}$/
 *
 * Usage:
 * makeIdempotencyKey('gstr1-file', period, userId)
 */
export function makeIdempotencyKey(prefix, ...parts) {
  const safePart = (value) =>
    String(value ?? '')
      .trim()
      .replace(/[^A-Za-z0-9:_-]/g, '')
      .slice(0, 40);

  const segments = [safePart(prefix), ...parts.map(safePart)].filter(Boolean);

  if (!segments.length) {
    segments.push('gst');
  }

  const uniqueSuffix = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  let key = [...segments, uniqueSuffix].join(':');

  if (key.length < 8) {
    key = `${key}:${uniqueSuffix}`;
  }

  if (key.length > 128) {
    key = key.slice(0, 128);
  }

  return key;
}

/**
 * Extract rate-limit metadata from response headers.
 */
function getRateLimitInfo(headers = {}) {
  const getHeader = (name) => {
    const lower = String(name).toLowerCase();
    return (
      headers?.[lower] ??
      headers?.[name] ??
      headers?.get?.(lower) ??
      headers?.get?.(name) ??
      undefined
    );
  };

  const retryAfterRaw = getHeader('retry-after');
  const limitRaw =
    getHeader('ratelimit-limit') ??
    getHeader('x-ratelimit-limit');
  const remainingRaw =
    getHeader('ratelimit-remaining') ??
    getHeader('x-ratelimit-remaining');
  const resetRaw =
    getHeader('ratelimit-reset') ??
    getHeader('x-ratelimit-reset');

  const toNumberOrNull = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  return {
    retryAfterSeconds: toNumberOrNull(retryAfterRaw),
    limit: toNumberOrNull(limitRaw),
    remaining: toNumberOrNull(remainingRaw),
    resetUnixSeconds: toNumberOrNull(resetRaw)
  };
}

/**
 * URL patterns that should use longer filing timeout.
 */
const FILING_URL_RE =
  /\/returns\/(?:gstr1|gstr3b)\/(?:prepare-filing|file-evc)|\/returns\/nil-file|\/returns\/(?:gstr1|gstr3b)\/(?:save|offset)|\/returns\/generate-summary/i;

const UPLOAD_URL_RE =
  /\/(?:invoices|bills|items)\/import|\/(?:upload|excel)|\/imports?\//i;

function resolveRequestTimeout(config) {
  if (config?.timeout !== undefined && config.timeout !== null) {
    return config.timeout;
  }

  const url = String(config?.url || '');

  if (FILING_URL_RE.test(url)) {
    return FILING_TIMEOUT_MS;
  }

  if (UPLOAD_URL_RE.test(url)) {
    return UPLOAD_TIMEOUT_MS;
  }

  return DEFAULT_TIMEOUT_MS;
}

function mapProviderErrorMessage(errorData, fallbackMessage) {
  const providerMessage = errorData?.message;
  const genericProviderMessage =
    'Could not complete the request. Please try again.';

  const errCd = errorData?.error_cd || errorData?.errorCd;

  if (errCd === 'AUTH4038' || errCd === 'GSP052A' || errCd === 'GSP102') {
    return 'GST Portal Error (GSP102): AuthToken expired or not found on government portal. Please reconnect your session on GST Return Hub.';
  }

  if (errCd === 'AUTH4033') {
    return 'GST Portal Notice (AUTH4033): OTP session has expired or is invalid on government portal. Please click "Resend OTP" to request a fresh OTP.';
  }

  if (errCd === 'OTP0010') {
    return 'GST Portal Error (OTP0010): Not Authorized Signatory. Please enter personal PAN of the designated Director / Partner (4th letter must be "P").';
  }

  if (errCd === 'RET11406' || errCd === 'RET11404') {
    return 'GST Portal Notice: Return summary calculation is in progress on the government portal. Please wait 1-2 minutes and retry.';
  }

  if (errCd === 'RETFILE01' || errCd === 'RET11407') {
    return 'GST Portal Error: Invalid EVC OTP entered. Please check the 6-digit code received on your mobile and try again.';
  }

  if (errCd === 'RETFILE02') {
    return 'GST Portal Error: EVC OTP has expired. Please request a fresh EVC OTP.';
  }

  if (errCd === 'RET01202') {
    return 'GST Portal Notice: Previous tax period return is pending on GST portal. Please file earlier periods first.';
  }

  if (errCd === 'GSP101') {
    return 'GST Portal Error (GSP101): Request payload rejected by GST System. Please verify return parameters.';
  }

  if (errCd === 'AUTH4037') {
    return 'GST Portal Error (AUTH4037): API Access is not enabled for this username. Please enable API Access under My Profile > Manage API Access on gst.gov.in.';
  }

  if (errCd === 'GSP500' || errCd === 'SYS500') {
    return 'GST Portal Notice: Government GST Portal is undergoing maintenance. Please retry in a few moments.';
  }

  if (errCd === 'GSTNBadRequest') {
    return 'GST Portal Notice (GSTNBadRequest): The government portal rejected the request. Please verify that the return period is open, the return summary has been generated on the portal, and the designated signatory PAN is registered for this GSTIN.';
  }

  if (errCd) {
    return providerMessage && providerMessage !== genericProviderMessage
      ? providerMessage
      : `GST Portal Notice (${errCd}): The government portal could not complete this request.`;
  }

  if (providerMessage && providerMessage !== genericProviderMessage) {
    return providerMessage;
  }

  return (
    fallbackMessage ||
    'GST Portal Notice: The government GST service could not complete this request. Please verify return status or reconnect session.'
  );
}

/* -------------------------------------------------------------------------- */
/* Axios client                                                               */
/* -------------------------------------------------------------------------- */

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: DEFAULT_TIMEOUT_MS
});

/* -------------------------------------------------------------------------- */
/* Request interceptor                                                        */
/* -------------------------------------------------------------------------- */

client.interceptors.request.use(
  (config) => {
    config.headers = config.headers || {};

    // 1. X-Request-Id
    if (!config.headers['X-Request-Id']) {
      config.headers['X-Request-Id'] = newRequestId();
    }

    // 2. Optional X-Idempotency-Key from custom axios config.
    //
    // Usage:
    // client.post('/returns/gstr1/file-evc', body, {
    //   idempotencyKey: makeIdempotencyKey('gstr1-file', period, userId)
    // });
    if (config.idempotencyKey && !config.headers['X-Idempotency-Key']) {
      config.headers['X-Idempotency-Key'] = String(config.idempotencyKey).trim();
    }

    // 3. Resolve timeout automatically for filing/upload endpoints.
    config.timeout = resolveRequestTimeout(config);

    // 4. Avoid sending Content-Type on body-less requests.
    const method = String(config.method || 'get').toLowerCase();
    if (['get', 'delete', 'head'].includes(method)) {
      delete config.headers['Content-Type'];
    }

    return config;
  },
  (error) => Promise.reject(error)
);

/* -------------------------------------------------------------------------- */
/* Response interceptor                                                       */
/* -------------------------------------------------------------------------- */

client.interceptors.response.use(
  (response) => {
    const data = response.data;
    const requestId =
      response.headers?.['x-request-id'] ||
      response.config?.headers?.['X-Request-Id'] ||
      null;

    /**
     * Attach requestId to response body when possible.
     * This helps UI show trace id in error/info toasts.
     */
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (!data.requestId && requestId) {
        data.requestId = requestId;
      }

      /**
       * Backend may return 202 for pending/unconfirmed filing.
       * Ensure UI can reliably detect it.
       */
      if (response.status === 202) {
        data.pending = data.pending ?? true;
        data.success = data.success ?? false;
      }
    }

    return data;
  },

  (error) => {
    const config = error.config || {};
    const response = error.response;
    const status = response?.status;
    const errorData = response?.data || {};

    const requestId =
      config.headers?.['X-Request-Id'] ||
      response?.headers?.['x-request-id'] ||
      null;

    const rateLimit = getRateLimitInfo(response?.headers);

    let code = errorData?.code;
    let message = errorData?.message;

    /* ---------------------------------------------------------------------- */
    /* Canceled / timeout / network                                           */
    /* ---------------------------------------------------------------------- */

    if (error.code === 'ERR_CANCELED') {
      code = code || 'REQUEST_CANCELED';
      message = message || FRIENDLY_ERROR_MESSAGES.REQUEST_CANCELED;
    } else if (
      status === 504 ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT'
    ) {
      code = code || 'REQUEST_TIMEOUT';
      message =
        message ||
        errorData?.message ||
        FRIENDLY_ERROR_MESSAGES.REQUEST_TIMEOUT;
    }

    /* ---------------------------------------------------------------------- */
    /* Infer code from status if backend did not send one                     */
    /* ---------------------------------------------------------------------- */

    if (!code) {
      if (status === 401) {
        code = 'SESSION_EXPIRED';
      } else if (status === 404) {
        code = 'DATA_NOT_AVAILABLE';
      } else if (status === 429) {
        code = 'RATE_LIMITED';
      } else if (status === 502) {
        code = 'PROVIDER_AUTH';
      } else if (status === 503) {
        code = 'PROVIDER_DOWN';
      } else if (status === 504) {
        code = 'REQUEST_TIMEOUT';
      } else if (status >= 500) {
        code = 'SERVER_ERROR';
      } else if (status >= 400) {
        code = 'VALIDATION_ERROR';
      } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        code = 'REQUEST_TIMEOUT';
      } else {
        code = 'NETWORK_ERROR';
      }
    }

    /* ---------------------------------------------------------------------- */
    /* Human-friendly messages                                                */
    /* ---------------------------------------------------------------------- */

    if (code === 'RATE_LIMITED') {
      const retryAfter = rateLimit.retryAfterSeconds;

      message =
        retryAfter && retryAfter > 0
          ? `Too many requests. Please try again after ${retryAfter} seconds.`
          : errorData?.message || FRIENDLY_ERROR_MESSAGES.RATE_LIMITED;
    } else if (code === 'REQUEST_TIMEOUT') {
      message =
        errorData?.message ||
        FRIENDLY_ERROR_MESSAGES.REQUEST_TIMEOUT;
    } else if (
      code === 'PROVIDER_AUTH' ||
      code === 'PROVIDER_ERROR' ||
      errorData?.error_cd ||
      errorData?.errorCd
    ) {
      message = mapProviderErrorMessage(errorData, message);
    } else if (code === 'PROVIDER_DOWN') {
      message =
        errorData?.message || FRIENDLY_ERROR_MESSAGES.PROVIDER_DOWN;
    } else if (!message) {
      message =
        FRIENDLY_ERROR_MESSAGES[code] ||
        error.message ||
        'An unexpected error occurred.';
    }

    /* ---------------------------------------------------------------------- */
    /* Session redirect                                                       */
    /* ---------------------------------------------------------------------- */

    if (
      code === 'SESSION_EXPIRED' &&
      typeof config.url === 'string' &&
      config.url.includes('/auth/me')
    ) {
      const publicPaths = ['/login', '/otp', '/', '/privacy', '/terms'];

      if (
        typeof window !== 'undefined' &&
        !publicPaths.includes(window.location.pathname)
      ) {
        window.location.href = '/login';
      }
    }

    /* ---------------------------------------------------------------------- */
    /* Normalized rejection object                                            */
    /* ---------------------------------------------------------------------- */

    return Promise.reject({
      code,
      message,
      status: status ?? null,
      data: errorData,
      requestId,
      rateLimit,
      validationDetails: errorData?.validationDetails || null,
      errorCd: errorData?.error_cd || errorData?.errorCd || null,
      pending: false
    });
  }
);

/* -------------------------------------------------------------------------- */
/* Convenience helpers for callers                                            */
/* -------------------------------------------------------------------------- */

/**
 * Use this for filing/save/offset/nil requests:
 *
 * client.post('/returns/gstr1/file-evc', body, filingRequestConfig(key));
 */
export function filingRequestConfig(idempotencyKey) {
  return {
    timeout: FILING_TIMEOUT_MS,
    idempotencyKey: idempotencyKey || makeIdempotencyKey('gst-filing')
  };
}

/**
 * Use this for upload/import requests:
 *
 * client.post('/invoices/import', formData, uploadRequestConfig());
 */
export function uploadRequestConfig() {
  return {
    timeout: UPLOAD_TIMEOUT_MS
  };
}

/**
 * Helper to detect pending/unconfirmed filing from a successful 202 response.
 *
 * Example:
 * const res = await returnsApi.fileGstr1WithEvc(...);
 * if (isPendingFilingResponse(res)) { ... }
 */
export function isPendingFilingResponse(response) {
  return Boolean(
    response &&
    typeof response === 'object' &&
    (response.pending === true || response.status === 'PENDING')
  );
}

export default client;