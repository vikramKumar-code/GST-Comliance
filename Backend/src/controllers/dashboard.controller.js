const ReturnService = require('../services/return.service');
const { shouldSimulateDown } = require('../utils/testHooks');

exports.getDashboard = async (req, res, next) => {
  try {
    const simulateDown = shouldSimulateDown(req);
    const data = await ReturnService.getDashboard(req.gstin, req.query.period, req.gstToken, {
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
