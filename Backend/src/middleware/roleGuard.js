const ApiError = require('../utils/apiError');

/**
 * Role Guard Middleware
 * Restricts endpoints based on workspace role (OWNER, CA, ACCOUNTANT, VIEWER).
 *
 * @param {string[]} allowedRoles Array of allowed roles (e.g. ['OWNER', 'CA'])
 * @param {string} customErrorMessage Custom error message if forbidden
 */
const requireWorkspaceRole = (allowedRoles = ['OWNER', 'CA'], customErrorMessage = null) => {
  return (req, res, next) => {
    // Super Admins bypass workspace-level role restrictions
    if (req.isSuperAdmin) {
      return next();
    }

    const currentRole = req.workspaceRole || req.membership?.role || 'MEMBER';

    if (!allowedRoles.includes(currentRole)) {
      if (currentRole === 'ACCOUNTANT' && !allowedRoles.includes('ACCOUNTANT')) {
        throw ApiError.forbidden(
          customErrorMessage ||
            'Your active workspace role is Accountant (Billing Only). Filing GST returns and statutory OTP authorization requires CA (Chartered Accountant) or Organization Owner authority.'
        );
      }

      if (currentRole === 'VIEWER') {
        throw ApiError.forbidden(
          customErrorMessage || 'Your active workspace role is Viewer (Read Only). Modification is prohibited.'
        );
      }

      throw ApiError.forbidden(
        customErrorMessage || `Action forbidden for role "${currentRole}". Required: ${allowedRoles.join(', ')}`
      );
    }

    next();
  };
};

module.exports = {
  requireWorkspaceRole
};
