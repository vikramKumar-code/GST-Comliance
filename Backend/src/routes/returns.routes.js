'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');

const returnsController = require('../controllers/returns.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');
const { validate, periodQuerySchema } = require('../middleware/validate');
const MongoRateLimitStore = require('../services/mongoRateLimitStore');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

/* -------------------------------------------------------------------------- */
/* Constants / Config                                                         */
/* -------------------------------------------------------------------------- */

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EVC_OTP_REGEX = /^[A-Za-z0-9]{4,8}$/;
const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9:_-]{8,128}$/;

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

const RATE_LIMIT_ENABLED = envBool('ROUTE_RATE_LIMIT_ENABLED', true);
const RATE_LIMIT_SKIP_NON_PROD = envBool('ROUTE_RATE_LIMIT_SKIP_NON_PROD', true);
const RATE_LIMIT_LOG_DENIED = envBool('ROUTE_RATE_LIMIT_LOG_DENIED', true);

const SAVE_WINDOW_MS = envInt('GST_SAVE_RATE_WINDOW_MS', 15 * 60 * 1000, 1000);
const FILING_WINDOW_MS = envInt('GST_FILING_RATE_WINDOW_MS', 15 * 60 * 1000, 1000);
const EVC_WINDOW_MS = envInt('GST_EVC_RATE_WINDOW_MS', 10 * 60 * 1000, 1000);
const NIL_WINDOW_MS = envInt('GST_NIL_RATE_WINDOW_MS', 15 * 60 * 1000, 1000);
const DEMO_WINDOW_MS = envInt('GST_DEMO_RATE_WINDOW_MS', 60 * 60 * 1000, 1000);

const SAVE_RATE_MAX = envInt('GST_SAVE_RATE_MAX', isProduction ? 20 : 200, 1);
const FILING_RATE_MAX = envInt('GST_FILING_RATE_MAX', isProduction ? 10 : 100, 1);
const EVC_RATE_MAX = envInt('GST_EVC_RATE_MAX', isProduction ? 5 : 50, 1);
const NIL_RATE_MAX = envInt('GST_NIL_RATE_MAX', isProduction ? 5 : 50, 1);
const DEMO_RATE_MAX = envInt('GST_DEMO_RATE_MAX', isProduction ? 3 : 20, 1);

const FILING_TIMEOUT_MS = envInt('GST_FILING_ROUTE_TIMEOUT_MS', 120000, 5000);
const SAVE_TIMEOUT_MS = envInt('GST_SAVE_ROUTE_TIMEOUT_MS', 90000, 5000);

const MAX_EXCLUDED_IDS = envInt('GST_MAX_EXCLUDED_INVOICE_IDS', 5000, 1);

const READ_ROLES = ['OWNER', 'ADMIN', 'CA', 'MEMBER', 'VIEWER'];
const WRITE_ROLES = ['OWNER', 'ADMIN', 'CA'];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function failValidation(req, res, next, message, code = 'VALIDATION_ERROR') {
    if (res.headersSent) {
        return next(ApiError.validationError(message));
    }

    return res.status(400).json({
        success: false,
        code,
        message
    });
}

function hashKey(value) {
    return crypto
        .createHash('sha256')
        .update(String(value || 'anonymous'))
        .digest('hex')
        .slice(0, 32);
}

/**
 * Prefer authenticated identity, but include IP/workspace/GSTIN context.
 *
 * Why not period/type in key?
 * Because attacker could rotate period/type to bypass limiter.
 */
function limiterKeyGenerator(req) {
    const parts = [
        req.user?._id,
        req.member?._id,
        req.memberId,
        req.user?.memberId,
        req.workspaceId,
        req.activeWorkspaceId,
        req.gstin,
        req.ip,
        req.socket?.remoteAddress,
        req.connection?.remoteAddress
    ]
        .filter(Boolean)
        .map(String);

    if (!parts.length) {
        parts.push('anonymous');
    }

    return hashKey(parts.join('|'));
}

function shouldSkipRateLimit(req) {
    if (!RATE_LIMIT_ENABLED) return true;

    // CORS preflight should not consume filing quota.
    if (req.method === 'OPTIONS') return true;

    // Default: skip outside production unless explicitly enabled.
    if (RATE_LIMIT_SKIP_NON_PROD && !isProduction) return true;

    return false;
}

/**
 * Create rate-limit store safely.
 *
 * If Mongo-backed store fails to initialize, fall back to in-memory store
 * instead of crashing the app.
 *
 * WARNING:
 * In multi-process/cluster production, in-memory fallback is inaccurate.
 * Ensure MongoRateLimitStore or Redis store is healthy.
 */
function createStore(storeName) {
    try {
        return new MongoRateLimitStore(storeName);
    } catch (err) {
        logger.error('Route rate limit store initialization failed; falling back to in-memory store', {
            store: storeName,
            message: err?.message || 'unknown'
        });

        // undefined => express-rate-limit default memory store
        return undefined;
    }
}

function makeLimiter({ storeName, windowMs, max, message }) {
    return rateLimit({
        store: createStore(storeName),
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        validate: false,
        keyGenerator: limiterKeyGenerator,
        skip: shouldSkipRateLimit,
        handler: (req, res, next, options) => {
            if (RATE_LIMIT_LOG_DENIED) {
                const rl = req.rateLimit || {};
                const reset = rl.resetTime || options?.resetTime;

                logger.warn('Route rate limit exceeded', {
                    store: storeName,
                    requestId: req.requestId || null,
                    method: req.method,
                    path: req.path,
                    key: limiterKeyGenerator(req),
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

const saveLimiter = makeLimiter({
    storeName: 'gst-save',
    windowMs: SAVE_WINDOW_MS,
    max: SAVE_RATE_MAX,
    message: 'Too many GST save/upload/offset attempts. Please try again after some time.'
});

const filingLimiter = makeLimiter({
    storeName: 'gst-filing-prepare',
    windowMs: FILING_WINDOW_MS,
    max: FILING_RATE_MAX,
    message: 'Too many GST filing preparation attempts. Please try again after some time.'
});

const evcLimiter = makeLimiter({
    storeName: 'gst-evc-file',
    windowMs: EVC_WINDOW_MS,
    max: EVC_RATE_MAX,
    message: 'Too many EVC filing attempts. Please wait before requesting a new OTP and trying again.'
});

const nilFilingLimiter = makeLimiter({
    storeName: 'gst-nil-file',
    windowMs: NIL_WINDOW_MS,
    max: NIL_RATE_MAX,
    message: 'Too many nil return filing attempts. Please wait before trying again.'
});

const demoSeedLimiter = makeLimiter({
    storeName: 'gst-demo-seed',
    windowMs: DEMO_WINDOW_MS,
    max: DEMO_RATE_MAX,
    message: 'Too many demo seeding attempts. Please try again later.'
});

function requestTimeout(ms) {
    return (req, res, next) => {
        try {
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Request-Timeout-Ms', String(ms));

            if (typeof req.setTimeout === 'function') {
                req.setTimeout(ms);
            }

            if (typeof res.setTimeout === 'function') {
                res.setTimeout(ms);
            }
        } catch (_) {
            // Some serverless/embedded runtimes may not expose setTimeout.
        }

        next();
    };
}

const filingTimeout = requestTimeout(FILING_TIMEOUT_MS);
const saveTimeout = requestTimeout(SAVE_TIMEOUT_MS);

/**
 * Reads idempotency key from header or body.
 * Controller can read req.idempotencyKey or req.body.idempotencyKey.
 */
function attachIdempotencyKey(req, res, next) {
    const headerKey = req.get('X-Idempotency-Key');
    const bodyKey = req.body?.idempotencyKey;

    const raw =
        typeof headerKey === 'string' && headerKey.trim()
            ? headerKey.trim()
            : typeof bodyKey === 'string'
                ? bodyKey.trim()
                : '';

    if (!raw) {
        req.idempotencyKey = null;
        return next();
    }

    if (raw.length > 128 || !IDEMPOTENCY_KEY_REGEX.test(raw)) {
        return failValidation(
            req,
            res,
            next,
            'Invalid idempotency key. Must be 8-128 chars using letters, digits, colon, underscore or hyphen.'
        );
    }

    req.idempotencyKey = raw;

    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        req.body.idempotencyKey = raw;
    }

    next();
}

function normalizePeriod(value) {
    const period = String(value || '').trim();
    return PERIOD_REGEX.test(period) ? period : null;
}

/**
 * Validates period from query or body and normalizes it back.
 * Controllers may read req.query.period or req.body.period.
 */
function requirePeriod(required = true) {
    return (req, res, next) => {
        const rawQuery = req.query?.period;
        const rawBody = req.body?.period;

        if (rawQuery !== undefined && rawQuery !== null && rawQuery !== '') {
            if (!PERIOD_REGEX.test(String(rawQuery).trim())) {
                return failValidation(req, res, next, 'query.period must be a valid return period (MMYYYY).');
            }
        }

        if (rawBody !== undefined && rawBody !== null && rawBody !== '') {
            if (!PERIOD_REGEX.test(String(rawBody).trim())) {
                return failValidation(req, res, next, 'body.period must be a valid return period (MMYYYY).');
            }
        }

        const period = normalizePeriod(rawQuery) || normalizePeriod(rawBody);

        if (!period) {
            if (required) {
                return failValidation(req, res, next, 'A valid return period (MMYYYY) is required.');
            }

            return next();
        }

        if (req.query && typeof req.query === 'object') {
            req.query.period = period;
        }

        if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
            req.body.period = period;
        }

        req.period = period;
        next();
    };
}

function normalizeExcludedIds(value) {
    if (value === undefined || value === null) {
        return { ok: true, ids: [] };
    }

    let rawArr;

    if (Array.isArray(value)) {
        rawArr = value;
    } else if (typeof value === 'string') {
        rawArr = value.split(',');
    } else {
        rawArr = [value];
    }

    if (rawArr.length > MAX_EXCLUDED_IDS) {
        return {
            ok: false,
            error: `excludedInvoiceIds cannot contain more than ${MAX_EXCLUDED_IDS} entries.`
        };
    }

    const seen = new Set();
    const ids = [];

    for (const item of rawArr) {
        const id = String(item ?? '').trim();

        if (!id) continue;

        if (!OBJECT_ID_REGEX.test(id)) {
            return {
                ok: false,
                error: 'excludedInvoiceIds must contain valid MongoDB ObjectId strings (24 hex characters).'
            };
        }

        if (seen.has(id)) continue;

        seen.add(id);
        ids.push(id);
    }

    return { ok: true, ids };
}

function validateExcludedInvoiceIds(req, res, next) {
    const value =
        req.body?.excludedInvoiceIds ??
        req.query?.excludedInvoiceIds;

    if (value === undefined || value === null) {
        return next();
    }

    const normalized = normalizeExcludedIds(value);

    if (!normalized.ok) {
        return failValidation(req, res, next, normalized.error);
    }

    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        req.body.excludedInvoiceIds = normalized.ids;
    }

    if (
        req.query &&
        typeof req.query === 'object' &&
        Object.prototype.hasOwnProperty.call(req.query, 'excludedInvoiceIds')
    ) {
        req.query.excludedInvoiceIds = normalized.ids;
    }

    req.excludedInvoiceIds = normalized.ids;
    next();
}

/**
 * Reject unexpected top-level body fields.
 * This is route-level hygiene inspired by GSTN JSON schema additionalProperties:false.
 * It does not replace service/provider schema validation.
 */
function restrictBodyKeys(allowedKeys) {
    const allowed = new Set(allowedKeys);

    return (req, res, next) => {
        const body = req.body;

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return next();
        }

        const extra = Object.keys(body).filter((key) => !allowed.has(key));

        if (extra.length > 0) {
            return failValidation(
                req,
                res,
                next,
                `Unexpected body field(s): ${extra.join(', ')}.`
            );
        }

        next();
    };
}

function validateFilingBody(req, res, next) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        req.body = {};
    }

    const period = normalizePeriod(req.body.period);

    if (!period) {
        return failValidation(req, res, next, 'A valid return period (MMYYYY) is required.');
    }

    const otp = String(req.body.otp || '').trim();

    if (!EVC_OTP_REGEX.test(otp)) {
        return failValidation(
            req,
            res,
            next,
            'Invalid EVC OTP format. Must be 4 to 8 letters or digits.'
        );
    }

    const pan = String(req.body.pan || '').trim().toUpperCase();

    if (!PAN_REGEX.test(pan)) {
        return failValidation(
            req,
            res,
            next,
            'A valid authorised signatory PAN is required to file with EVC.'
        );
    }

    if (
        req.body.alreadyPrepared !== undefined &&
        typeof req.body.alreadyPrepared !== 'boolean'
    ) {
        return failValidation(req, res, next, 'alreadyPrepared must be a boolean.');
    }

    if (req.body.excludedInvoiceIds !== undefined) {
        const excluded = normalizeExcludedIds(req.body.excludedInvoiceIds);

        if (!excluded.ok) {
            return failValidation(req, res, next, excluded.error);
        }

        req.body.excludedInvoiceIds = excluded.ids;
    }

    req.body.period = period;
    req.body.otp = otp;
    req.body.pan = pan;

    next();
}

function validateNilBody(req, res, next) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        req.body = {};
    }

    const period = normalizePeriod(req.body.period);

    if (!period) {
        return failValidation(req, res, next, 'A valid return period (MMYYYY) is required.');
    }

    const returnTypeRaw = req.body.returnType ? String(req.body.returnType).trim().toUpperCase() : null;
    const typeRaw = req.body.type ? String(req.body.type).trim().toUpperCase() : null;

    if (returnTypeRaw && typeRaw && returnTypeRaw !== typeRaw) {
        return failValidation(
            req,
            res,
            next,
            'returnType and type must match when both are provided.'
        );
    }

    const returnType = returnTypeRaw || typeRaw || 'GSTR1';

    if (!['GSTR1', 'GSTR3B'].includes(returnType)) {
        return failValidation(
            req,
            res,
            next,
            'Nil return can only be filed for GSTR1 or GSTR3B.'
        );
    }

    if (req.body.declarationAccepted !== true) {
        return failValidation(
            req,
            res,
            next,
            'Statutory declaration per CGST Rule 67A must be accepted before filing a Nil return.'
        );
    }

    const verificationMode = String(
        req.body.verificationMode || 'EVC'
    ).trim().toUpperCase();

    if (verificationMode !== 'EVC') {
        return failValidation(
            req,
            res,
            next,
            'Nil return filing currently requires EVC verification. DSC/other modes are not supported by this provider flow.'
        );
    }

    const otp = String(req.body.otp || '').trim();

    if (!EVC_OTP_REGEX.test(otp)) {
        return failValidation(
            req,
            res,
            next,
            'Invalid EVC OTP format. Must be 4 to 8 letters or digits.'
        );
    }

    const pan = String(req.body.pan || '').trim().toUpperCase();

    if (!PAN_REGEX.test(pan)) {
        return failValidation(
            req,
            res,
            next,
            'A valid authorised signatory PAN is required to file a Nil return with EVC.'
        );
    }

    req.body.period = period;
    req.body.returnType = returnType;
    req.body.type = returnType;
    req.body.declarationAccepted = true;
    req.body.verificationMode = 'EVC';
    req.body.otp = otp;
    req.body.pan = pan;

    next();
}

function validateNilEligibilityQuery(req, res, next) {
    const type = String(req.query?.type || req.body?.type || 'GSTR1').trim().toUpperCase();

    if (!['GSTR1', 'GSTR3B'].includes(type)) {
        return failValidation(
            req,
            res,
            next,
            'Nil eligibility type must be GSTR1 or GSTR3B.'
        );
    }

    if (req.query && typeof req.query === 'object') {
        req.query.type = type;
    }

    next();
}

/* -------------------------------------------------------------------------- */
/* Read endpoints                                                             */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/returns/summary
 * Fetch returns summary (available periods and filing status from RETTRACK)
 */
router.get(
    '/summary',
    auth,
    workspaceRole(...READ_ROLES),
    validate(periodQuerySchema, 'query'),
    returnsController.getSummary
);

/**
 * GET /api/returns/gstr1
 * Fetch GSTR-1 return data for a specific period
 */
router.get(
    '/gstr1',
    auth,
    workspaceRole(...READ_ROLES),
    validate(periodQuerySchema, 'query'),
    returnsController.getGstr1
);

/**
 * GET /api/returns/gstr2b
 * Fetch GSTR-2B (auto-populated ITC statement) data
 */
router.get(
    '/gstr2b',
    auth,
    workspaceRole(...READ_ROLES),
    validate(periodQuerySchema, 'query'),
    returnsController.getGstr2b
);

/**
 * GET /api/returns/gstr3b
 * Fetch GSTR-3B return data
 */
router.get(
    '/gstr3b',
    auth,
    workspaceRole(...READ_ROLES),
    validate(periodQuerySchema, 'query'),
    returnsController.getGstr3b
);

/**
 * GET /api/returns/nil-eligibility
 * Check if workspace is eligible for Nil return filing under CGST Rule 67A
 */
router.get(
    '/nil-eligibility',
    auth,
    workspaceRole(...READ_ROLES),
    validate(periodQuerySchema, 'query'),
    validateNilEligibilityQuery,
    returnsController.checkNilEligibility
);

/* -------------------------------------------------------------------------- */
/* Local prepare endpoints (no GSTN write)                                    */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/returns/gstr1/prepare
 * Synthesize GSTR-1 payload from local invoices.
 * Does not upload to GSTN.
 */
router.post(
    '/gstr1/prepare',
    auth,
    workspaceRole(...READ_ROLES),
    requirePeriod(true),
    restrictBodyKeys(['period', 'excludedInvoiceIds']),
    validateExcludedInvoiceIds,
    returnsController.prepareGstr1
);

/**
 * POST /api/returns/gstr3b/prepare
 * Prepare GSTR-3B payload from invoices and purchase bills.
 * Does not upload to GSTN.
 */
router.post(
    '/gstr3b/prepare',
    auth,
    workspaceRole(...READ_ROLES),
    requirePeriod(true),
    restrictBodyKeys(['period']),
    returnsController.prepareGstr3b
);

/* -------------------------------------------------------------------------- */
/* GSTN save/upload endpoints                                                 */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/returns/gstr1/save
 * Save GSTR-1 payload to GST portal (RETSAVE).
 *
 * Official Save response schema requires reference_id.
 * Provider/service must enforce that.
 */
router.post(
    '/gstr1/save',
    auth,
    workspaceRole(...WRITE_ROLES),
    saveTimeout,
    saveLimiter,
    attachIdempotencyKey,
    restrictBodyKeys([
        'period',
        'excludedInvoiceIds',
        'username',
        'idempotencyKey'
    ]),
    requirePeriod(true),
    validateExcludedInvoiceIds,
    returnsController.saveGstr1
);

/**
 * POST /api/returns/generate-summary
 * Trigger GSTR-1 save/summary generation from local invoices.
 *
 * This is a portal write operation, not merely a local calculation.
 */
router.post(
    '/generate-summary',
    auth,
    workspaceRole(...WRITE_ROLES),
    saveTimeout,
    saveLimiter,
    attachIdempotencyKey,
    restrictBodyKeys([
        'period',
        'excludedInvoiceIds',
        'isNil',
        'returnType',
        'username',
        'idempotencyKey'
    ]),
    requirePeriod(true),
    validateExcludedInvoiceIds,
    returnsController.generateSummary
);

/**
 * POST /api/returns/gstr3b/save
 * Save GSTR-3B payload to GST portal (RETSAVE).
 */
router.post(
    '/gstr3b/save',
    auth,
    workspaceRole(...WRITE_ROLES),
    saveTimeout,
    saveLimiter,
    attachIdempotencyKey,
    restrictBodyKeys([
        'period',
        'username',
        'idempotencyKey'
    ]),
    requirePeriod(true),
    returnsController.saveGstr3b
);

/**
 * POST /api/returns/gstr3b/offset
 * Offset GSTR-3B tax liability against ITC and cash balances (RETOFFSET).
 */
router.post(
    '/gstr3b/offset',
    auth,
    workspaceRole(...WRITE_ROLES),
    saveTimeout,
    saveLimiter,
    attachIdempotencyKey,
    restrictBodyKeys([
        'period',
        'offsetPayload',
        'username',
        'idempotencyKey'
    ]),
    requirePeriod(true),
    returnsController.offsetGstr3b
);

/* -------------------------------------------------------------------------- */
/* GSTR-1 prepare-filing / file-evc                                           */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/returns/gstr1/prepare-filing
 *
 * Runs Save -> poll -> pre-file step BEFORE asking user for EVC OTP.
 * Persists Filing status ReadyToEVC with payloadHash + referenceId.
 *
 * UI flow:
 *   1) POST /returns/gstr1/prepare-filing
 *   2) request EVC OTP
 *   3) POST /returns/gstr1/file-evc with alreadyPrepared=true
 */
router.post(
    '/gstr1/prepare-filing',
    auth,
    workspaceRole(...WRITE_ROLES),
    filingTimeout,
    filingLimiter,
    attachIdempotencyKey,
    restrictBodyKeys([
        'period',
        'excludedInvoiceIds',
        'idempotencyKey'
    ]),
    requirePeriod(true),
    validateExcludedInvoiceIds,
    returnsController.prepareGstr1Filing
);

/**
 * POST /api/returns/gstr1/file-evc
 * File GSTR-1 with EVC verification (RETFILE).
 */
router.post(
    '/gstr1/file-evc',
    auth,
    workspaceRole(...WRITE_ROLES),
    filingTimeout,
    evcLimiter,
    attachIdempotencyKey,
    restrictBodyKeys([
        'period',
        'otp',
        'pan',
        'excludedInvoiceIds',
        'alreadyPrepared',
        'username',
        'idempotencyKey'
    ]),
    validateFilingBody,
    returnsController.fileGstr1WithEvc
);

/* -------------------------------------------------------------------------- */
/* GSTR-3B prepare-filing / file-evc                                          */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/returns/gstr3b/prepare-filing
 *
 * Runs Save -> poll -> Offset BEFORE asking user for EVC OTP.
 * Persists Filing status ReadyToEVC with payloadHash + referenceId.
 *
 * UI flow:
 *   1) POST /returns/gstr3b/prepare-filing
 *   2) request EVC OTP
 *   3) POST /returns/gstr3b/file-evc with alreadyPrepared=true
 */
router.post(
    '/gstr3b/prepare-filing',
    auth,
    workspaceRole(...WRITE_ROLES),
    filingTimeout,
    filingLimiter,
    attachIdempotencyKey,
    restrictBodyKeys([
        'period',
        'idempotencyKey'
    ]),
    requirePeriod(true),
    returnsController.prepareGstr3bFiling
);

/**
 * POST /api/returns/gstr3b/file-evc
 * File GSTR-3B with EVC verification (RETFILE).
 */
router.post(
    '/gstr3b/file-evc',
    auth,
    workspaceRole(...WRITE_ROLES),
    filingTimeout,
    evcLimiter,
    attachIdempotencyKey,
    restrictBodyKeys([
        'period',
        'otp',
        'pan',
        'alreadyPrepared',
        'username',
        'idempotencyKey'
    ]),
    validateFilingBody,
    returnsController.fileGstr3bWithEvc
);

/* -------------------------------------------------------------------------- */
/* Nil return                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/returns/nil-file
 * File Nil return (GSTR-1 or GSTR-3B) with Rule 67A statutory declaration.
 */
router.post(
    '/nil-file',
    auth,
    workspaceRole(...WRITE_ROLES),
    filingTimeout,
    nilFilingLimiter,
    attachIdempotencyKey,
    restrictBodyKeys([
        'period',
        'returnType',
        'type',
        'declarationAccepted',
        'verificationMode',
        'otp',
        'pan',
        'username',
        'idempotencyKey'
    ]),
    validateNilBody,
    returnsController.fileNilReturn
);

/* -------------------------------------------------------------------------- */
/* Development/testing endpoints                                              */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/returns/seed-sample-invoices
 * Seed sample invoices for testing/demo purposes.
 * Disabled in production unless ALLOW_DEMO_SEED=true.
 */
router.post(
    '/seed-sample-invoices',
    auth,
    workspaceRole('OWNER', 'ADMIN'),
    demoSeedLimiter,
    restrictBodyKeys(['period']),
    requirePeriod(false),
    (req, res, next) => {
        if (
            process.env.NODE_ENV === 'production' &&
            String(process.env.ALLOW_DEMO_SEED || '').toLowerCase() !== 'true'
        ) {
            if (res.headersSent) {
                return next(ApiError.validationError('Sample data seeding is disabled in production environment.'));
            }

            return res.status(403).json({
                success: false,
                code: 'FORBIDDEN',
                message: 'Sample data seeding is disabled in production environment.'
            });
        }

        next();
    },
    returnsController.seedSampleInvoices
);

module.exports = router;