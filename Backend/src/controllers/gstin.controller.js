const mongoose = require('mongoose');
const FinaggService = require('../services/finagg.service');
const GstinCache = require('../models/GstinCache');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { isValidGstin } = require('../utils/gstin');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const logger = require('../utils/logger');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const CACHE_TTL_MS =
  (Number(process.env.GSTIN_CACHE_TTL_HOURS) || 6) * 60 * 60 * 1000;

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_WINDOW = Number(process.env.GSTIN_SEARCH_MAX_PER_MIN) || 30;

const MOCK_SOURCES = new Set(['mock', 'demo', 'stub', 'fake']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Per-process in-flight dedupe.
// Multi-instance deployments (PM2 cluster / Kubernetes) should move this to Redis.
const inFlightSearches = new Map();

// Per-process sliding-window rate limiter.
// Multi-instance deployments should use Redis-backed limiter/middleware.
const rateBuckets = new Map();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeErrorMessage(error) {
  if (!error) return 'unknown';

  const msg = typeof error.message === 'string' ? error.message : '';

  return (
    msg
      .replace(/https?:\/\/\S+/gi, '[URL_REDACTED]')
      .replace(
        /(password|token|secret|authtoken|auth-token|OTP|sid|sign|aspid)\s*[:=]\s*\S+/gi,
        '$1=[REDACTED]'
      )
      .slice(0, 200) || 'unknown'
  );
}

/**
 * Recursively trims strings and removes dangerous prototype-pollution keys.
 */
function deepTrim(val) {
  if (typeof val === 'string') return val.trim();

  if (Array.isArray(val)) {
    return val.map(deepTrim);
  }

  if (isPlainObject(val)) {
    const copy = {};

    for (const [k, v] of Object.entries(val)) {
      const key = typeof k === 'string' ? k.trim() : k;

      if (UNSAFE_KEYS.has(key)) continue;

      copy[key] = deepTrim(v);
    }

    return copy;
  }

  return val;
}

/**
 * Sanitize GSTN search result to prevent trailing-space contamination
 * in downstream invoices, customer records, and GSTR-1 JSON payloads.
 */
function sanitizeSearchResult(result) {
  if (!isPlainObject(result)) return result;

  const clean = deepTrim(result);

  if (clean.gstin) clean.gstin = String(clean.gstin).toUpperCase();
  if (clean.status) clean.status = String(clean.status).toUpperCase();
  if (clean.businessType) clean.businessType = String(clean.businessType).toUpperCase();

  return clean;
}

function makeRateLimitError() {
  const msg = 'Too many GSTIN searches. Please wait a minute and try again.';

  let err;

  if (typeof ApiError.rateLimited === 'function') {
    err = ApiError.rateLimited(msg);
  } else {
    err = ApiError.validationError(msg);
  }

  try {
    if (err && typeof err === 'object') {
      err.statusCode = 429;
      err.code = err.code || 'RATE_LIMITED';
    }
  } catch (_) {
    // Ignore if error object is frozen/sealed.
  }

  return err;
}

function enforceRateLimit(key) {
  const now = Date.now();

  let arr = rateBuckets.get(key);

  if (!arr) {
    arr = [];
    rateBuckets.set(key, arr);
  }

  while (arr.length && now - arr[0] >= RATE_WINDOW_MS) {
    arr.shift();
  }

  if (arr.length >= RATE_MAX_PER_WINDOW) {
    throw makeRateLimitError();
  }

  arr.push(now);

  // Prevent unbounded memory growth under abuse/random keys.
  if (rateBuckets.size > 5000) {
    for (const [bucketKey, timestamps] of rateBuckets.entries()) {
      if (
        !timestamps.length ||
        now - timestamps[timestamps.length - 1] >= RATE_WINDOW_MS
      ) {
        rateBuckets.delete(bucketKey);
      }
    }
  }
}

/**
 * Returns a reason string if cached entry must NOT be served, else null.
 *
 * Prevents:
 * - cross-environment mock cache poisoning
 * - malformed cache entries
 * - GSTIN mismatch
 * - missing registration identity
 * - expired/invalid expiry
 */
function cacheEntryProblem(cached, gstin, providerName) {
  if (!isPlainObject(cached?.result)) {
    return 'INVALID_SHAPE';
  }

  const storedGstin = String(cached.result.gstin || '').toUpperCase();

  if (storedGstin && storedGstin !== gstin) {
    return 'GSTIN_MISMATCH';
  }

  if (!cached.result.legalName && !cached.result.tradeName) {
    return 'MISSING_NAMES';
  }

  const expiresAt = new Date(cached.expiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    return 'INVALID_EXPIRY';
  }

  const src = String(cached.source || '').toLowerCase();
  const live = String(providerName || '').toLowerCase();

  // Mock/demo cache is only acceptable when active provider is also mock/demo.
  if (MOCK_SOURCES.has(src)) {
    if (live && !MOCK_SOURCES.has(live)) {
      return 'MOCK_SOURCE_IN_LIVE';
    }

    return 'LEGACY_MOCK';
  }

  // Legacy migration guard for old mock entries written before `source` existed.
  if (
    cached.result.tradeName === 'Demo Traders' ||
    cached.result.legalName === 'Demo Traders Pvt Ltd'
  ) {
    return 'LEGACY_MOCK';
  }

  return null;
}

async function purgeCache(gstin) {
  try {
    await GstinCache.deleteOne({ gstin });
  } catch (e) {
    logger.debug('Failed to purge GSTIN cache entry', {
      gstin,
      error: safeErrorMessage(e)
    });
  }
}

function writeAudit(entry) {
  if (mongoose.connection?.readyState !== 1) return;

  AuditLog.create(entry).catch((e) => {
    logger.warn('AuditLog write failed', {
      action: entry?.action,
      error: safeErrorMessage(e)
    });
  });
}

function getProviderNameSafe() {
  try {
    if (FinaggService && typeof FinaggService.getProviderName === 'function') {
      return FinaggService.getProviderName() || 'UNKNOWN';
    }
  } catch (_) {
    // ignore
  }

  return 'UNKNOWN';
}

/* -------------------------------------------------------------------------- */
/* Controller                                                                 */
/* -------------------------------------------------------------------------- */

exports.search = async (req, res, next) => {
  // workspaceId OUTER scope me — catch block bhi access kar sake
  let workspaceId = null;

  try {
    // Tenant/user data should not be stored by intermediaries.
    res.setHeader('Cache-Control', 'no-store');

    // 1. Input Extraction & Validation
    // Supports POST body, GET query, and route params.
    const rawGstin =
      req.body?.gstin ||
      req.query?.gstin ||
      req.params?.gstin;

    const gstin =
      typeof rawGstin === 'string'
        ? rawGstin.trim().toUpperCase()
        : '';

    if (!gstin) {
      throw ApiError.validationError('GSTIN is required.');
    }

    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin(
        'Invalid GSTIN format. Must be 15 alphanumeric characters.'
      );
    }

    // Paid GSP API protection: per-user/member/IP sliding window.
    const rateKey = String(
      req.user?._id ||
      req.memberId ||
      req.user?.memberId ||
      req.ip ||
      'anon'
    );

    enforceRateLimit(rateKey);

    // Resolve workspace context for audit logging.
    workspaceId = await resolveWorkspaceId(req).catch((e) => {
      logger.debug('workspaceId resolution skipped for GSTIN search', {
        error: safeErrorMessage(e)
      });

      return null;
    });

    const providerName = getProviderNameSafe();

    // 2. Cache-First Strategy
    if (mongoose.connection?.readyState === 1) {
      try {
        const cached = await GstinCache.findOne({ gstin }).lean();

        if (cached) {
          const problem = cacheEntryProblem(cached, gstin, providerName);

          if (problem) {
            logger.info('Purging unusable GSTIN cache entry', {
              gstin,
              reason: problem
            });

            await purgeCache(gstin);
          } else {
            const expiresAt = new Date(cached.expiresAt);
            const notExpired = new Date() < expiresAt;

            if (notExpired) {
              // Fire-and-forget hit count increment for analytics.
              GstinCache.updateOne(
                { gstin },
                { $inc: { hitCount: 1 } }
              ).catch(() => { });

              const clean = sanitizeSearchResult(cached.result);

              const verified =
                clean.verified !== false &&
                Boolean(clean.legalName || clean.tradeName);

              writeAudit({
                workspaceId,
                userId: req.user?._id || null,
                memberId: req.memberId || req.user?.memberId || null,
                gstin,
                action: 'GSTIN_SEARCH',
                status: 'SUCCESS',
                ipAddress: req.ip || null,
                metadata: {
                  provider: cached.source || 'CACHE',
                  cached: true
                }
              });

              // Controlled keys AFTER spread so cached payload cannot override them.
              return res.status(200).json({
                ...clean,
                success: true,
                source: 'CACHE',
                gstin,
                verified
              });
            }

            // Expired cache: purge to keep collection clean.
            await purgeCache(gstin);
          }
        }
      } catch (cacheErr) {
        logger.warn('GstinCache read error, falling through to live API', {
          gstin,
          error: safeErrorMessage(cacheErr)
        });
      }
    }

    // 3. Live API Call
    if (!FinaggService || typeof FinaggService.searchGstin !== 'function') {
      throw ApiError.providerError(
        'Active GST provider does not support GSTIN search.',
        502
      );
    }

    // Dedupe — agar isi GSTIN ki request already in-flight hai, wahi promise reuse karo.
    let searchPromise = inFlightSearches.get(gstin);

    if (!searchPromise) {
      searchPromise = FinaggService.searchGstin(gstin)
        .finally(() => inFlightSearches.delete(gstin));

      inFlightSearches.set(gstin, searchPromise);
    }

    const rawResult = await searchPromise;

    if (!isPlainObject(rawResult)) {
      throw ApiError.providerError(
        'GST provider returned an invalid response for GSTIN search.',
        502
      );
    }

    const result = sanitizeSearchResult(rawResult);

    // A transient empty/partial GSTN response must NOT be cached or treated as valid.
    if (!result.legalName && !result.tradeName) {
      throw ApiError.providerError(
        'GST portal did not return registration details for this GSTIN.',
        502
      );
    }

    const verified =
      result.verified !== false &&
      Boolean(result.legalName || result.tradeName);

    const isCacheable =
      Boolean(result.legalName || result.tradeName) &&
      result.verified !== false;

    // 4. Cache write — awaited so an immediate concurrent request does not
    //    miss the cache and burn another paid API call.
    if (isCacheable && mongoose.connection?.readyState === 1) {
      try {
        await GstinCache.findOneAndUpdate(
          { gstin },
          {
            $set: {
              result,
              expiresAt: new Date(Date.now() + CACHE_TTL_MS),
              source: providerName
            },
            $setOnInsert: {
              hitCount: 0
            }
          },
          {
            upsert: true,
            new: true
          }
        );
      } catch (cacheErr) {
        logger.warn('Failed to cache GSTIN search result', {
          gstin,
          error: safeErrorMessage(cacheErr)
        });
      }
    }

    // 5. Audit Log
    writeAudit({
      workspaceId,
      userId: req.user?._id || null,
      memberId: req.memberId || req.user?.memberId || null,
      gstin,
      action: 'GSTIN_SEARCH',
      status: 'SUCCESS',
      ipAddress: req.ip || null,
      metadata: {
        provider: providerName,
        cached: false
      }
    });

    // 6. Return Response — controlled keys AFTER spread.
    return res.status(200).json({
      ...result,
      success: true,
      source: 'LIVE_API',
      gstin,
      verified
    });
  } catch (error) {
    // Log Failure with context
    const failedGstin = String(
      req.body?.gstin ||
      req.query?.gstin ||
      req.params?.gstin ||
      ''
    ).trim().toUpperCase();

    if (failedGstin) {
      writeAudit({
        workspaceId,
        userId: req.user?._id || null,
        memberId: req.memberId || req.user?.memberId || null,
        gstin: failedGstin,
        action: 'GSTIN_SEARCH',
        status: 'FAILURE',
        ipAddress: req.ip || null,
        metadata: {
          error: safeErrorMessage(error),
          errorCd: error.errorCd || undefined
        }
      });
    } else {
      logger.debug('GSTIN search rejected before provider call', {
        error: safeErrorMessage(error)
      });
    }

    next(error);
  }
};