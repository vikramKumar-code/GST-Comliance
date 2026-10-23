const ReturnService = require('../services/return.service');
const { shouldSimulateDown } = require('../utils/testHooks');

exports.getSummary = async (req, res, next) => {
  try {
    const simulateDown = shouldSimulateDown(req);
    const summary = await ReturnService.getReturnsSummary(req.gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: req.username,
      workspaceId: req.workspaceId,
      sessionId: req.session._id
    });
    res.status(200).json({
      success: true,
      ...summary
    });
  } catch (error) {
    next(error);
  }
};

exports.getGstr1 = async (req, res, next) => {
  try {
    const simulateDown = shouldSimulateDown(req);
    const data = await ReturnService.getReturn('GSTR1', req.gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: req.username,
      workspaceId: req.workspaceId,
      sessionId: req.session._id
    });
    res.status(200).json({
      success: true,
      ...data
    });
  } catch (error) {
    next(error);
  }
};

exports.getGstr2b = async (req, res, next) => {
  try {
    const simulateDown = shouldSimulateDown(req);
    const data = await ReturnService.getReturn('GSTR2B', req.gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: req.username,
      workspaceId: req.workspaceId,
      sessionId: req.session._id
    });
    res.status(200).json({
      success: true,
      ...data
    });
  } catch (error) {
    next(error);
  }
};

exports.getGstr3b = async (req, res, next) => {
  try {
    const simulateDown = shouldSimulateDown(req);
    const data = await ReturnService.getReturn('GSTR3B', req.gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: req.username,
      workspaceId: req.workspaceId,
      sessionId: req.session._id
    });
    res.status(200).json({
      success: true,
      ...data
    });
  } catch (error) {
    next(error);
  }
};
