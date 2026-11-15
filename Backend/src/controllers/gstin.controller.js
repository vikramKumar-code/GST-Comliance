const mongoose = require('mongoose');
const FinaggService = require('../services/finagg.service');
const GstinCache = require('../models/GstinCache');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { isValidGstin } = require('../utils/gstin');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const logger = require('../utils/logger'); // ✅ FIX 1: Structured logger

// ✅ FIX 5: In-flight dedupe — same GSTIN ke concurrent requests par ek hi paid API call.
// (User double-click ya 2 team members ek saath search karein toh duplicate billing nahi hogi)
const inFlightSearches = new Map();

// ✅ FIX 4: Sanitize GSTN search result to prevent trailing-space contamination
// in downstream invoices, customer records, and GSTR-1 JSON payloads.
function deepTrim(val) {
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val)) return val.map(deepTrim);
  if (val !== null && typeof val === 'object') {
    const copy = {};
    for (const [k, v] of Object.entries(val)) {
      copy[k] = deepTrim(v);
    }
    return copy;
  }
  return val;
}

function sanitizeSearchResult(result) {
  if (!result || typeof result !== 'object') return result;
  const clean = deepTrim(result);

  if (clean.gstin) clean.gstin = clean.gstin.toUpperCase();
  if (clean.status) clean.status = clean.status.toUpperCase();
  if (clean.businessType) clean.businessType = clean.businessType.toUpperCase();

  return clean;
}

exports.search = async (req, res, next) => {
  // ✅ FIX 2: workspaceId OUTER scope me — catch block bhi access kar sake
  let workspaceId = null;

  try {
    // 1. Input Extraction & Validation (Supports both POST body and GET query)
    const rawGstin = req.body?.gstin || req.query?.gstin;
    const gstin = typeof rawGstin === 'string' ? rawGstin.trim().toUpperCase() : '';

    if (!gstin) {
      throw ApiError.validationError('GSTIN is required.');
    }
    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    }

    // Resolve workspace context for audit logging
    workspaceId = await resolveWorkspaceId(req).catch(() => null);

    // 2. Cache-First Strategy (Check MongoDB before hitting paid GSP API)
    if (mongoose.connection?.readyState === 1) {
      try {
        const cached = await GstinCache.findOne({ gstin }).lean();

        // Check if cache exists and is not expired
        // Guard against stale mock cache: If cache contains 'Demo Traders', discard & purge it
        const isMockStale = cached?.result?.tradeName === 'Demo Traders' || cached?.result?.legalName === 'Demo Traders Pvt Ltd';
        if (cached && isMockStale) {
          GstinCache.deleteOne({ gstin }).catch(() => { });
        }

        if (cached && !isMockStale && new Date() < new Date(cached.expiresAt)) {
          // Fire-and-forget hit count increment for analytics
          GstinCache.updateOne({ gstin }, { $inc: { hitCount: 1 } }).catch(() => { });

          // ✅ FIX 6: Cache-hit bhi audit trail me log hoga (compliance completeness)
          AuditLog.create({
            workspaceId,
            userId: req.user?._id || null,
            memberId: req.memberId || req.user?.memberId || null,
            gstin,
            action: 'GSTIN_SEARCH',
            status: 'SUCCESS',
            ipAddress: req.ip || null,
            metadata: { provider: cached.source || 'CACHE', cached: true }
          }).catch(() => { });

          return res.status(200).json({
            success: true,
            source: 'CACHE', // Helpful for frontend debugging
            // ✅ FIX 7: Read par bhi sanitize — deploy ke baad purani (unsanitized)
            // cache entries bhi turant clean serve hongi, 6 ghante wait nahi karna padega
            ...sanitizeSearchResult(cached.result),
            verified: cached.result?.verified !== false
          });
        }
      } catch (cacheErr) {
        // ✅ FIX 1: Structured logger instead of console.warn
        logger.warn('GstinCache read error, falling through to live API', {
          gstin,
          error: cacheErr.message
        });
      }
    }

    // 3. Live API Call (Provider handles TaxPro vs Mock logic internally)
    // ✅ FIX 5: Dedupe — agar isi GSTIN ki request already in-flight hai, wahi promise reuse karo
    let searchPromise = inFlightSearches.get(gstin);
    if (!searchPromise) {
      searchPromise = FinaggService.searchGstin(gstin)
        .finally(() => inFlightSearches.delete(gstin));
      inFlightSearches.set(gstin, searchPromise);
    }
    const rawResult = await searchPromise;

    if (!rawResult || typeof rawResult !== 'object') {
      throw ApiError.providerError('GST provider returned an invalid response for GSTIN search.', 502);
    }

    // ✅ FIX 4: Sanitize before caching/returning (prevents trailing-space contamination)
    const result = sanitizeSearchResult(rawResult);

    // ✅ FIX 3: Cache poisoning guard. Only cache verified, non-empty results.
    // A transient empty/partial GSTN response must NOT be cached for 6 hours.
    const isCacheable = Boolean(result.legalName && result.verified !== false);

    if (isCacheable && mongoose.connection?.readyState === 1) {
      GstinCache.findOneAndUpdate(
        { gstin },
        {
          $set: {
            result,
            expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 hours TTL
            source: FinaggService.getProviderName() || 'UNKNOWN'
          },
          $setOnInsert: { hitCount: 0 }
        },
        { upsert: true, returnDocument: 'after' }
      ).catch((err) => logger.warn('Failed to cache GSTIN search result', { error: err.message }));
    }

    // 4. Audit Log (Fire-and-forget with full context)
    if (mongoose.connection?.readyState === 1) {
      AuditLog.create({
        workspaceId,
        userId: req.user?._id || null,
        memberId: req.memberId || req.user?.memberId || null,
        gstin,
        action: 'GSTIN_SEARCH',
        status: 'SUCCESS',
        ipAddress: req.ip || null,
        metadata: { provider: FinaggService.getProviderName(), cached: false }
      }).catch(() => { });
    }

    // 5. Return Response
    res.status(200).json({
      success: true,
      source: 'LIVE_API',
      ...result,
      // ✅ FIX 8: Provider ki actual verification value respect karein.
      // Pehle hardcoded true tha, jo isCacheable logic se contradict karta tha.
      verified: result.verified !== false
    });

  } catch (error) {
    // Log Failure with context
    const failedGstin = String(req.body?.gstin || req.query?.gstin || '').trim().toUpperCase();

    // ✅ FIX 2: Outer-scope workspaceId use ho raha hai (req.workspaceId undefined ho sakta tha)
    if (failedGstin && mongoose.connection?.readyState === 1) {
      AuditLog.create({
        workspaceId,
        userId: req.user?._id || null,
        memberId: req.memberId || req.user?.memberId || null,
        gstin: failedGstin,
        action: 'GSTIN_SEARCH',
        status: 'FAILURE',
        ipAddress: req.ip || null,
        metadata: { error: error.message, errorCd: error.errorCd || undefined }
      }).catch(() => { });
    }

    next(error);
  }
};