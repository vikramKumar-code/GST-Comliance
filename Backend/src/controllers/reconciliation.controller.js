const ReconciliationService = require('../services/reconciliation.service');
const AuditLog = require('../models/AuditLog');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const { shouldSimulateDown } = require('../utils/testHooks');
const ApiError = require('../utils/apiError');

// Period validation regex (MMYYYY format)
const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;

/**
 * GET /api/reconciliation/itc?period=MMYYYY
 * Reconciles purchase bills against GSTR-2B inward supplies
 */
exports.getItcReconciliation = async (req, res, next) => {
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
    const result = await ReconciliationService.reconcileItc(workspaceId, period, {
      gstin: req.gstin,
      token: req.gstToken,
      username: req.username,
      workspaceId,
      sessionId: req.session?._id,
      simulateDown
    });

    const durationMs = Date.now() - startTime;

    // ✅ FIX 2 & 3: Audit Log with performance tracking
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      gstin: req.gstin || null,
      action: 'ITC_RECONCILIATION',
      status: 'SUCCESS',
      period,
      metadata: {
        durationMs,
        matchedCount: result.matchedCount || 0,
        unmatchedCount: result.unmatchedCount || 0,
        totalIgcClaimed: result.totalIgcClaimed || 0
      }
    }).catch(() => { });

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    // Log failure with context
    if (req.query.period && req.workspaceId) {
      await AuditLog.create({
        workspaceId: req.workspaceId,
        userId: req.user?._id || req.userId || null,
        gstin: req.gstin || null,
        action: 'ITC_RECONCILIATION',
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
 * GET /api/reconciliation/refund-estimate?period=MMYYYY
 * Calculates estimated GST refund or net cash payable
 */
exports.getRefundEstimate = async (req, res, next) => {
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
    const result = await ReconciliationService.calculateRefundEstimate(workspaceId, period, {
      gstin: req.gstin,
      token: req.gstToken,
      username: req.username,
      workspaceId,
      sessionId: req.session?._id,
      simulateDown
    });

    const durationMs = Date.now() - startTime;

    // ✅ FIX 2 & 3: Audit Log with performance tracking
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      gstin: req.gstin || null,
      action: 'REFUND_ESTIMATE',
      status: 'SUCCESS',
      period,
      metadata: {
        durationMs,
        estimatedRefund: result.estimatedRefund || 0,
        netPayable: result.netPayable || 0
      }
    }).catch(() => { });

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    // Log failure with context
    if (req.query.period && req.workspaceId) {
      await AuditLog.create({
        workspaceId: req.workspaceId,
        userId: req.user?._id || req.userId || null,
        gstin: req.gstin || null,
        action: 'REFUND_ESTIMATE',
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