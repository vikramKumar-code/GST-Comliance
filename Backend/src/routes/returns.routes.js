const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const returnsController = require('../controllers/returns.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');
const { validate, periodQuerySchema, filingBodySchema, nilFileBodySchema } = require('../middleware/validate');

// Strict rate limit for live government filing operations (max 5 attempts per hour per IP)
const filingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: {
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many filing attempts. Please try again after an hour.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// ============================================================================
// READ OPERATIONS (View returns data)
// Roles: OWNER, ADMIN, CA, MEMBER, VIEWER
// ============================================================================

/**
 * GET /api/returns/summary
 * Fetch returns summary (available periods and filing status from RETTRACK)
 */
router.get(
    '/summary',
    auth,
    workspaceRole('OWNER', 'ADMIN', 'CA', 'MEMBER', 'VIEWER'),
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
    workspaceRole('OWNER', 'ADMIN', 'CA', 'MEMBER', 'VIEWER'),
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
    workspaceRole('OWNER', 'ADMIN', 'CA', 'MEMBER', 'VIEWER'),
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
    workspaceRole('OWNER', 'ADMIN', 'CA', 'MEMBER', 'VIEWER'),
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
    workspaceRole('OWNER', 'ADMIN', 'CA', 'MEMBER', 'VIEWER'),
    validate(periodQuerySchema, 'query'),
    returnsController.checkNilEligibility
);

// ============================================================================
// PREPARE OPERATIONS (Synthesize return payloads)
// Roles: OWNER, ADMIN, CA, MEMBER, VIEWER
// ============================================================================

/**
 * POST /api/returns/gstr1/prepare
 * Synthesize GSTR-1 payload from local invoices
 */
router.post(
    '/gstr1/prepare',
    auth,
    workspaceRole('OWNER', 'ADMIN', 'CA', 'MEMBER', 'VIEWER'),
    validate(periodQuerySchema, 'query'),
    returnsController.prepareGstr1
);

/**
 * POST /api/returns/gstr3b/prepare
 * Prepare GSTR-3B payload from invoices and purchase bills
 */
router.post(
    '/gstr3b/prepare',
    auth,
    workspaceRole('OWNER', 'ADMIN', 'CA', 'MEMBER', 'VIEWER'),
    validate(periodQuerySchema, 'query'),
    returnsController.prepareGstr3b
);

// ============================================================================
// WRITE OPERATIONS (Save/Upload returns to GST portal)
// Roles: OWNER, ADMIN, CA only
// ============================================================================

/**
 * POST /api/returns/gstr1/save
 * Save GSTR-1 payload to GST portal (RETSAVE)
 */
router.post(
    '/gstr1/save',
    auth,
    workspaceRole('OWNER', 'ADMIN', 'CA'),
    validate(periodQuerySchema, 'query'),
    returnsController.saveGstr1
);

/**
 * POST /api/returns/generate-summary
 * Trigger Generate Summary (PROCEEDFILE) on GST portal directly from the software
 */
router.post(
    '/generate-summary',
    auth,
    workspaceRole('OWNER', 'ADMIN', 'CA'),
    returnsController.generateSummary
);

/**
 * POST /api/returns/gstr3b/save
 * Save GSTR-3B payload to GST portal (RETSAVE)
 */
router.post(
    '/gstr3b/save',
    auth,
    workspaceRole('OWNER', 'ADMIN', 'CA'),
    validate(periodQuerySchema, 'query'),
    returnsController.saveGstr3b
);

/**
 * POST /api/returns/gstr3b/offset
 * Offset GSTR-3B tax liability against ITC and cash balances (RETOFFSET)
 */
router.post(
    '/gstr3b/offset',
    auth,
    workspaceRole('OWNER', 'ADMIN', 'CA'),
    validate(periodQuerySchema, 'query'),
    returnsController.offsetGstr3b
);

// ============================================================================
// FILING OPERATIONS (Final submission with EVC)
// Roles: OWNER, ADMIN, CA only
// ============================================================================

/**
 * POST /api/returns/gstr1/file-evc
 * File GSTR-1 with EVC verification (RETFILE)
 */
router.post(
    '/gstr1/file-evc',
    auth,
    workspaceRole('OWNER', 'ADMIN', 'CA'),
    filingLimiter,
    validate(filingBodySchema, 'body'),
    returnsController.fileGstr1WithEvc
);

/**
 * POST /api/returns/gstr3b/file-evc
 * File GSTR-3B with EVC verification (RETFILE)
 */
router.post(
    '/gstr3b/file-evc',
    auth,
    workspaceRole('OWNER', 'ADMIN', 'CA'),
    filingLimiter,
    validate(filingBodySchema, 'body'),
    returnsController.fileGstr3bWithEvc
);

/**
 * POST /api/returns/nil-file
 * File Nil return (GSTR-1 or GSTR-3B) with Rule 67A statutory declaration
 */
router.post(
    '/nil-file',
    auth,
    workspaceRole('OWNER', 'ADMIN', 'CA'),
    filingLimiter,
    validate(nilFileBodySchema, 'body'),
    returnsController.fileNilReturn
);

// ============================================================================
// DEVELOPMENT/TESTING OPERATIONS
// Roles: OWNER, ADMIN only
// ============================================================================

/**
 * POST /api/returns/seed-sample-invoices
 * Seed sample invoices for testing/demo purposes (development environment only)
 */
router.post(
    '/seed-sample-invoices',
    auth,
    workspaceRole('OWNER', 'ADMIN'),
    (req, res, next) => {
        if (process.env.NODE_ENV === 'production') {
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
