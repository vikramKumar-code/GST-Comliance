const ReturnService = require('../services/return.service');
const { shouldSimulateDown } = require('../utils/testHooks');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const Workspace = require('../models/Workspace');
const ApiError = require('../utils/apiError');

async function resolveContext(req) {
  const workspaceId = await resolveWorkspaceId(req);
  let gstin = req.gstin;
  if (!gstin && workspaceId) {
    const ws = await Workspace.findById(workspaceId).lean();
    if (ws?.gstin) {
      gstin = ws.gstin;
    }
  }
  return { workspaceId: workspaceId || req.workspaceId, gstin };
}

exports.getSummary = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const simulateDown = shouldSimulateDown(req);
    const summary = await ReturnService.getReturnsSummary(gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: req.username,
      workspaceId,
      sessionId: req.session?._id
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
    const { workspaceId, gstin } = await resolveContext(req);
    const simulateDown = shouldSimulateDown(req);
    const data = await ReturnService.getReturn('GSTR1', gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: req.username,
      workspaceId,
      sessionId: req.session?._id
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
    const { workspaceId, gstin } = await resolveContext(req);
    const simulateDown = shouldSimulateDown(req);
    const data = await ReturnService.getReturn('GSTR2B', gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: req.username,
      workspaceId,
      sessionId: req.session?._id
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
    const { workspaceId, gstin } = await resolveContext(req);
    const simulateDown = shouldSimulateDown(req);
    const data = await ReturnService.getReturn('GSTR3B', gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: req.username,
      workspaceId,
      sessionId: req.session?._id
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
    const { workspaceId, gstin } = await resolveContext(req);
    if (!gstin) {
      throw ApiError.validationError('Active workspace does not have a linked GSTIN. Please link your GSTIN in Settings or log in via GSTIN OTP before preparing GSTR-1.');
    }
    const Gstr1Service = require('../services/gstr1.service');
    const result = await Gstr1Service.preparePayload(workspaceId, gstin, req.query.period);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

exports.saveGstr1 = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    if (!gstin) {
      throw ApiError.validationError('Active workspace does not have a linked GSTIN. Please link your GSTIN in Settings or log in via GSTIN OTP before saving GSTR-1.');
    }
    const Gstr1Service = require('../services/gstr1.service');
    const result = await Gstr1Service.savePayload(workspaceId, gstin, req.query.period, {
      username: req.username,
      gstToken: req.gstToken
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

exports.checkNilEligibility = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    if (!gstin) {
      throw ApiError.validationError('Active workspace does not have a linked GSTIN. Please link your GSTIN in Settings or log in via GSTIN OTP before filing a Nil return.');
    }
    const NilReturnService = require('../services/nilReturn.service');
    const result = await NilReturnService.checkEligibility(
      workspaceId,
      gstin,
      req.query.period,
      req.query.type || 'GSTR1'
    );
    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
};

exports.fileNilReturn = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    if (!gstin) {
      throw ApiError.validationError('Active workspace does not have a linked GSTIN. Please link your GSTIN in Settings or log in via GSTIN OTP before filing a Nil return.');
    }
    const NilReturnService = require('../services/nilReturn.service');
    const result = await NilReturnService.fileNilReturn(
      workspaceId,
      gstin,
      req.body.period,
      req.body.returnType || req.body.type || 'GSTR1',
      {
        declarationAccepted: req.body.declarationAccepted,
        verificationMode: req.body.verificationMode,
        memberId: req.member?._id
      }
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

