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

exports.prepareGstr1 = async (req, res, next) => {
  try {
    const { resolveWorkspaceId } = require('../utils/workspaceHelper');
    const Gstr1Service = require('../services/gstr1.service');
    const workspaceId = await resolveWorkspaceId(req);
    const result = await Gstr1Service.preparePayload(workspaceId, req.gstin, req.query.period);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

exports.saveGstr1 = async (req, res, next) => {
  try {
    const { resolveWorkspaceId } = require('../utils/workspaceHelper');
    const Gstr1Service = require('../services/gstr1.service');
    const workspaceId = await resolveWorkspaceId(req);
    const result = await Gstr1Service.savePayload(workspaceId, req.gstin, req.query.period, {
      username: req.username,
      gstToken: req.gstToken
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
