const ReconciliationService = require('../services/reconciliation.service');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const { shouldSimulateDown } = require('../utils/testHooks');
const ApiError = require('../utils/apiError');

/**
 * GET /api/reconciliation/itc?period=MMYYYY
 * Reconciles purchase bills against GSTR-2B inward supplies
 */
exports.getItcReconciliation = async (req, res, next) => {
  try {
    const period = req.query.period;
    if (!period) {
      throw ApiError.validationError('Period query parameter (MMYYYY) is required.');
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

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/reconciliation/refund-estimate?period=MMYYYY
 * Calculates estimated GST refund or net cash payable
 */
exports.getRefundEstimate = async (req, res, next) => {
  try {
    const period = req.query.period;
    if (!period) {
      throw ApiError.validationError('Period query parameter (MMYYYY) is required.');
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

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
};
