const ApiError = require('../utils/apiError');

const workspaceRole = (...allowedRoles) => (req, res, next) => {
  // Software Owner (Super Admin) has omni-access
  if (req.isSuperAdmin) {
    return next();
  }

  const role = req.workspaceRole || req.membership?.role || 'MEMBER';

  // Automatically treat 'CA' as having Owner/Admin compliance rights
  const effectiveRoles = [...allowedRoles];
  if (allowedRoles.includes('OWNER') || allowedRoles.includes('ADMIN')) {
    effectiveRoles.push('CA');
  }

  if (!effectiveRoles.includes(role)) {
    if (role === 'ACCOUNTANT') {
      return next(
        ApiError.forbidden(
          'Your active workspace role is Accountant (Billing Only). Filing GST returns and statutory OTP authorization requires CA (Chartered Accountant) or Organization Owner authority.'
        )
      );
    }
    return next(ApiError.forbidden(`Your workspace role (${role}) does not allow this action.`));
  }
  return next();
};

module.exports = workspaceRole;
