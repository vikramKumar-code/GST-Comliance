const ApiError = require('../utils/apiError');

const workspaceRole = (...allowedRoles) => (req, res, next) => {
  if (!req.workspaceRole || !allowedRoles.includes(req.workspaceRole)) {
    return next(ApiError.forbidden('Your workspace role does not allow this action.'));
  }
  return next();
};

module.exports = workspaceRole;
