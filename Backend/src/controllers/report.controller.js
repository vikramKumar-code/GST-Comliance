const ReportService = require('../services/report.service');
const AuditLog = require('../models/AuditLog');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const { shouldSimulateDown } = require('../utils/testHooks');
const ApiError = require('../utils/apiError');

// Validation regexes
const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

/**
 * Helper to validate YYYY-MM-DD date format
 */
function isValidDate(dateStr) {
  if (!DATE_REGEX.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date);
}

/**
 * GET /api/reports/gstr-comparison?period=MMYYYY
 */
exports.getGstrComparison = async (req, res, next) => {
  const startTime = Date.now();
  try {
    const period = req.query.period;

    // ✅ FIX 1: Strict period format validation
    if (!period) {
      throw ApiError.validationError('Period query parameter (MMYYYY) is required.');
    }
    if (!PERIOD_REGEX.test(period)) {
      throw ApiError.validationError('Period must be in MMYYYY format (e.g., 102026 for October 2026).');
    }

    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) {
      throw ApiError.validationError('Active workspace could not be identified.');
    }

    const simulateDown = shouldSimulateDown(req);
    const data = await ReportService.getGstrComparison(workspaceId, period, {
      gstin: req.gstin,
      token: req.gstToken,
      username: req.username,
      workspaceId,
      sessionId: req.session?._id,
      simulateDown
    });

    const durationMs = Date.now() - startTime;

    // ✅ FIX 4: Audit Log with performance tracking
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      gstin: req.gstin || null,
      action: 'REPORT_GSTR_COMPARISON',
      status: 'SUCCESS',
      period,
      metadata: {
        durationMs,
        status: data.status || 'UNKNOWN',
        complianceRisk: data.complianceRisk || 'UNKNOWN'
      }
    }).catch(() => { });

    res.status(200).json({
      success: true,
      ...data
    });
  } catch (error) {
    // Log failure
    if (req.query.period && req.workspaceId) {
      await AuditLog.create({
        workspaceId: req.workspaceId,
        userId: req.user?._id || req.userId || null,
        gstin: req.gstin || null,
        action: 'REPORT_GSTR_COMPARISON',
        status: 'FAILURE',
        period: req.query.period,
        metadata: {
          error: error.message,
          durationMs: Date.now() - startTime
        }
      }).catch(() => { });
    }
    next(error);
  }
};

/**
 * GET /api/reports/sales-register?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
exports.getSalesRegister = async (req, res, next) => {
  const startTime = Date.now();
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) {
      throw ApiError.validationError('Active workspace could not be identified.');
    }

    const { from, to } = req.query;

    // ✅ FIX 2: Strict date format validation
    if (from && !isValidDate(from)) {
      throw ApiError.validationError('Invalid "from" date format. Must be YYYY-MM-DD (e.g., 2026-10-01).');
    }
    if (to && !isValidDate(to)) {
      throw ApiError.validationError('Invalid "to" date format. Must be YYYY-MM-DD (e.g., 2026-10-31).');
    }

    // ✅ FIX 3: Date range validation
    if (from && to && new Date(from) > new Date(to)) {
      throw ApiError.validationError('"from" date cannot be after "to" date.');
    }

    const data = await ReportService.getSalesRegister(workspaceId, from, to);

    const durationMs = Date.now() - startTime;

    // ✅ FIX 4: Audit Log
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      gstin: req.gstin || null,
      action: 'REPORT_SALES_REGISTER',
      status: 'SUCCESS',
      metadata: {
        durationMs,
        dateRange: { from, to },
        totalInvoices: data.summary?.totalInvoices || 0,
        grandTotal: data.summary?.grandTotal || 0
      }
    }).catch(() => { });

    res.status(200).json({
      success: true,
      ...data
    });
  } catch (error) {
    // Log failure
    if (req.workspaceId) {
      await AuditLog.create({
        workspaceId: req.workspaceId,
        userId: req.user?._id || req.userId || null,
        gstin: req.gstin || null,
        action: 'REPORT_SALES_REGISTER',
        status: 'FAILURE',
        metadata: {
          error: error.message,
          durationMs: Date.now() - startTime,
          dateRange: { from: req.query.from, to: req.query.to }
        }
      }).catch(() => { });
    }
    next(error);
  }
};

/**
 * GET /api/reports/purchase-register?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
exports.getPurchaseRegister = async (req, res, next) => {
  const startTime = Date.now();
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) {
      throw ApiError.validationError('Active workspace could not be identified.');
    }

    const { from, to } = req.query;

    // ✅ FIX 2: Strict date format validation
    if (from && !isValidDate(from)) {
      throw ApiError.validationError('Invalid "from" date format. Must be YYYY-MM-DD (e.g., 2026-10-01).');
    }
    if (to && !isValidDate(to)) {
      throw ApiError.validationError('Invalid "to" date format. Must be YYYY-MM-DD (e.g., 2026-10-31).');
    }

    // ✅ FIX 3: Date range validation
    if (from && to && new Date(from) > new Date(to)) {
      throw ApiError.validationError('"from" date cannot be after "to" date.');
    }

    const data = await ReportService.getPurchaseRegister(workspaceId, from, to);

    const durationMs = Date.now() - startTime;

    // ✅ FIX 4: Audit Log
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      gstin: req.gstin || null,
      action: 'REPORT_PURCHASE_REGISTER',
      status: 'SUCCESS',
      metadata: {
        durationMs,
        dateRange: { from, to },
        totalBills: data.summary?.totalBills || 0,
        grandTotal: data.summary?.grandTotal || 0
      }
    }).catch(() => { });

    res.status(200).json({
      success: true,
      ...data
    });
  } catch (error) {
    // Log failure
    if (req.workspaceId) {
      await AuditLog.create({
        workspaceId: req.workspaceId,
        userId: req.user?._id || req.userId || null,
        gstin: req.gstin || null,
        action: 'REPORT_PURCHASE_REGISTER',
        status: 'FAILURE',
        metadata: {
          error: error.message,
          durationMs: Date.now() - startTime,
          dateRange: { from: req.query.from, to: req.query.to }
        }
      }).catch(() => { });
    }
    next(error);
  }
};