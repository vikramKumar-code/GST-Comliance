'use strict';

const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');

const ApiError = require('../utils/apiError');
const MongoRateLimitStore = require('../services/mongoRateLimitStore');
const { isProduction } = require('../config/env');
const logger = require('../utils/logger');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const NODE_ENV = process.env.NODE_ENV || 'development';
const isDev = NODE_ENV === 'development';
const isTest = NODE_ENV === 'test';

function envInt(name, fallback, min = 1) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const n = Number(raw);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  const value = Math.floor(n);
  return value >= min ? value : fallback;
}

function envBool(name, fallback) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const s = String(raw).trim().toLowerCase();

  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;

  return fallback;
}

/**
 * Master kill-switch.
 *
 * RATE_LIMIT_ENABLED=false
 *   -> all limiters become no-op.
 *
 * Useful for local debugging/load tests, but NOT recommended in production.
 */
const RATE_LIMIT_ENABLED = envBool('RATE_LIMIT_ENABLED', true);

/**
 * Skip rate limiting outside production by default.
 *
 * Set RATE_LIMIT_SKIP_NON_PROD=false if you want staging/test to enforce limits.
 */
const RATE_LIMIT_SKIP_NON_PROD = envBool('RATE_LIMIT_SKIP_NON_PROD', true);

/**
 * Optional debug bypass header.
 *
 * Example:
 *   X-Rate-Limit-Debug: <RATE_LIMIT_DEBUG_HEADER secret>
 *
 * Default empty => disabled.
 * Use only in controlled test environments.
 */
const RATE_LIMIT_DEBUG_HEADER = String(process.env.RATE_LIMIT_DEBUG_HEADER || '').trim();

/**
 * Log denied rate-limit events.
 */
const RATE_LIMIT_LOG_DENIED = envBool('RATE_LIMIT_LOG_DENIED', true);

/* -------------------------------------------------------------------------- */
/* Windows                                                                    */
/* -------------------------------------------------------------------------- */

const WINDOW_10_M = 10 * 60 * 1000;
const WINDOW_15_M = 15 * 60 * 1000;
const WINDOW_30_M = 30 * 60 * 1000;
const WINDOW_60_M = 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

const API_WINDOW_MS = envInt('RATE_LIMIT_API_WINDOW_MS', WINDOW_15_M, 1000);
const API_MAX = envInt('RATE_LIMIT_API_MAX', isProduction ? 2000 : 10000, 1);

const AUTH_WINDOW_MS = envInt('RATE_LIMIT_AUTH_WINDOW_MS', WINDOW_15_M, 1000);
const AUTH_MAX = envInt('RATE_LIMIT_AUTH_MAX', isProduction ? 30 : 500, 1);

const OTP_REQUEST_WINDOW_MS = envInt('RATE_LIMIT_OTP_REQUEST_WINDOW_MS', WINDOW_10_M, 1000);
const OTP_REQUEST_MAX = envInt('RATE_LIMIT_OTP_REQUEST_MAX', isProduction ? 5 : 100, 1);

const OTP_VERIFY_WINDOW_MS = envInt('RATE_LIMIT_OTP_VERIFY_WINDOW_MS', WINDOW_10_M, 1000);
const OTP_VERIFY_MAX = envInt('RATE_LIMIT_OTP_VERIFY_MAX', isProduction ? 10 : 200, 1);

const CONTACT_WINDOW_MS = envInt('RATE_LIMIT_CONTACT_WINDOW_MS', WINDOW_15_M, 1000);
const CONTACT_MAX = envInt('RATE_LIMIT_CONTACT_MAX', isProduction ? 5 : 50, 1);

/**
 * Filing operations are expensive:
 * - payload preparation
 * - GSTN RETSAVE
 * - RETSTATUS polling
 * - RETOFFSET
 * - proceed/submit
 *
 * Keep this tighter than normal API traffic.
 */
const FILING_WINDOW_MS = envInt('RATE_LIMIT_FILING_WINDOW_MS', WINDOW_15_M, 1000);
const FILING_MAX = envInt('RATE_LIMIT_FILING_MAX', isProduction ? 20 : 200, 1);

/**
 * EVC filing endpoints consume actual OTPs and trigger RETFILE.
 * This should be very tight.
 */
const EVC_WINDOW_MS = envInt('RATE_LIMIT_EVC_WINDOW_MS', WINDOW_10_M, 1000);
const EVC_MAX = envInt('RATE_LIMIT_EVC_MAX', isProduction ? 5 : 50, 1);

/**
 * Nil filing is statutory and should not be spammed.
 */
const NIL_FILING_WINDOW_MS = envInt('RATE_LIMIT_NIL_FILING_WINDOW_MS', WINDOW_15_M, 1000);
const NIL_FILING_MAX = envInt('RATE_LIMIT_NIL_FILING_MAX', isProduction ? 5 : 50, 1);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function hashKey(value) {
  return crypto
    .createHash('sha256')
    .update(String(value ?? ''))
    .digest('hex')
    .slice(0, 32);
}

function clientIp(req) {
  return (
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

/**
 * Rate-limit bucket key.
 *
 * We intentionally use IP-only hashed key for security-sensitive endpoints.
 * Including user/workspace/gstin/period in the key can allow bypass by
 * rotating those values from the same IP.
 */
function ipKey(req) {
  return `ip:${hashKey(clientIp(req))}`;
}

function shouldSkip(req) {
  if (!RATE_LIMIT_ENABLED) return true;

  // Preflight and internal health checks should not consume quota.
  if (req.method === 'OPTIONS') return true;

  const path = req.path || '';
  if (path === '/health' || path.endsWith('/health')) return true;

  // Optional controlled debug bypass.
  if (
    RATE_LIMIT_DEBUG_HEADER &&
    req.get('x-rate-limit-debug') === RATE_LIMIT_DEBUG_HEADER
  ) {
    return true;
  }

  // Default: skip outside production.
  if (RATE_LIMIT_SKIP_NON_PROD && !isProduction) return true;

  return false;
}

/**
 * Create rate-limit store safely.
 *
 * If MongoDB-backed store fails to initialize, fall back to express-rate-limit
 * default in-memory store instead of crashing the app.
 *
 * WARNING:
 * In multi-process/cluster production, in-memory fallback is inaccurate.
 * Ensure MongoRateLimitStore or Redis store is healthy.
 */
function createStore(storeName) {
  try {
    return new MongoRateLimitStore(storeName);
  } catch (err) {
    logger.error('Rate limit store initialization failed; falling back to in-memory store', {
      store: storeName,
      message: err?.message || 'unknown'
    });

    // undefined => express-rate-limit uses its default memory store.
    return undefined;
  }
}

function makeLimiter({
  storeName,
  windowMs,
  max,
  message,
  skip
}) {
  return rateLimit({
    store: createStore(storeName),
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: ipKey,
    skip: skip || shouldSkip,
    handler: (req, res, next, options) => {
      if (RATE_LIMIT_LOG_DENIED) {
        const rl = req.rateLimit || {};
        const reset = rl.resetTime || options?.resetTime;

        logger.warn('Rate limit exceeded', {
          store: storeName,
          requestId: req.requestId || null,
          method: req.method,
          path: req.path,
          ipKey: ipKey(req),
          limit: options?.limit ?? max,
          used: rl.totalHits ?? options?.used ?? null,
          remaining: rl.remaining ?? options?.remaining ?? null,
          resetTime: reset instanceof Date ? reset.toISOString() : reset || null
        });
      }

      next(ApiError.rateLimited(message));
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Limiters                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * OTP request limiter.
 *
 * Protects endpoints that send OTP to mobile/email.
 * Default production: 5 requests / 10 minutes / IP.
 */
const otpLimiter = makeLimiter({
  storeName: 'otp-request',
  windowMs: OTP_REQUEST_WINDOW_MS,
  max: OTP_REQUEST_MAX,
  message:
    'Too many OTP requests from this IP. Please try again after 10 minutes.'
});

/**
 * OTP verify limiter.
 *
 * Protects OTP verification endpoints.
 * Default production: 10 attempts / 10 minutes / IP.
 */
const otpVerifyLimiter = makeLimiter({
  storeName: 'otp-verify',
  windowMs: OTP_VERIFY_WINDOW_MS,
  max: OTP_VERIFY_MAX,
  message:
    'Too many OTP verification attempts. Please try again later.'
});

/**
 * Contact/public form limiter.
 *
 * Default production: 5 submissions / 15 minutes / IP.
 */
const contactLimiter = makeLimiter({
  storeName: 'contact',
  windowMs: CONTACT_WINDOW_MS,
  max: CONTACT_MAX,
  message:
    'Too many contact messages. Please try again later.'
});

/**
 * General API limiter.
 *
 * Applied to /api in app.js.
 * Default production: 2000 requests / 15 minutes / IP.
 */
const apiLimiter = makeLimiter({
  storeName: 'api',
  windowMs: API_WINDOW_MS,
  max: API_MAX,
  message:
    'Too many requests. Please try again later.'
});

/**
 * Authentication credential limiter.
 *
 * Protects login/register/password flows.
 * Default production: 30 attempts / 15 minutes / IP.
 */
const authLimiter = makeLimiter({
  storeName: 'auth-credentials',
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX,
  message:
    'Too many authentication attempts from this IP. Please try again after 15 minutes.'
});

/**
 * GST filing operation limiter.
 *
 * Use on:
 * - GSTR-1 prepare-filing
 * - GSTR-1 save
 * - GSTR-3B prepare-filing
 * - GSTR-3B save
 * - GSTR-3B offset
 * - summary generation
 *
 * These calls can trigger GSTN RETSAVE/RETOFFSET/RETSTATUS polling and are
 * expensive. Keep tighter than normal API traffic.
 *
 * Default production: 20 operations / 15 minutes / IP.
 */
const filingLimiter = makeLimiter({
  storeName: 'gst-filing',
  windowMs: FILING_WINDOW_MS,
  max: FILING_MAX,
  message:
    'Too many GST filing/save/offset requests. Please wait before trying again.'
});

/**
 * EVC filing limiter.
 *
 * Use on:
 * - GSTR-1 file with EVC
 * - GSTR-3B file with EVC
 *
 * This consumes actual EVC OTP and triggers RETFILE.
 * Default production: 5 attempts / 10 minutes / IP.
 */
const evcLimiter = makeLimiter({
  storeName: 'gst-evc-file',
  windowMs: EVC_WINDOW_MS,
  max: EVC_MAX,
  message:
    'Too many EVC filing attempts. Please wait before requesting a new OTP and trying again.'
});

/**
 * Nil filing limiter.
 *
 * Use on:
 * - Nil GSTR-1 file
 * - Nil GSTR-3B file
 *
 * Statutory nil filing should not be spammed.
 * Default production: 5 attempts / 15 minutes / IP.
 */
const nilFilingLimiter = makeLimiter({
  storeName: 'gst-nil-file',
  windowMs: NIL_FILING_WINDOW_MS,
  max: NIL_FILING_MAX,
  message:
    'Too many nil return filing attempts. Please wait before trying again.'
});

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports = {
  // Existing exports
  otpLimiter,
  otpVerifyLimiter,
  apiLimiter,
  contactLimiter,
  authLimiter,

  // New filing-specific exports
  filingLimiter,
  evcLimiter,
  nilFilingLimiter,

  // Useful for tests/diagnostics
  shouldSkip,
  ipKey,
  RATE_LIMIT_ENABLED,
  RATE_LIMIT_SKIP_NON_PROD
};