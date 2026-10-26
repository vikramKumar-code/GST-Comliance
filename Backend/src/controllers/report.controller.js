const ReportService = require('../services/report.service');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const { shouldSimulateDown } = require('../utils/testHooks');
const ApiError = require('../utils/apiError');

/**
 * GET /api/reports/gstr-comparison?period=MMYYYY
 */
exports.getGstrComparison = async (req, res, next) => {
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
    const data = await ReportService.getGstrComparison(workspaceId, period, {
      gstin: req.gstin,
      token: req.gstToken,
      username: req.username,
      workspaceId,
      sessionId: req.session?._id,
      simulateDown
    });

    res.status(200).json({
      success: true,
      ...data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/reports/sales-register?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
exports.getSalesRegister = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) {
      throw ApiError.validationError('Active workspace could not be identified.');
    }

    const data = await ReportService.getSalesRegister(
      workspaceId,
      req.query.from,
      req.query.to
    );

    res.status(200).json({
      success: true,
      ...data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/reports/purchase-register?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
exports.getPurchaseRegister = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) {
      throw ApiError.validationError('Active workspace could not be identified.');
    }

    const data = await ReportService.getPurchaseRegister(
      workspaceId,
      req.query.from,
      req.query.to
    );

    res.status(200).json({
      success: true,
      ...data
    });
  } catch (error) {
    next(error);
  }
};
