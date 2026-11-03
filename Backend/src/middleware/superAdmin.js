const ApiError = require('../utils/apiError');

/**
 * Super Admin Middleware
 * Validates that the authenticated user has platform-level SUPER_ADMIN authority.
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user && !req.session) {
    throw ApiError.sessionExpired('Authentication required.');
  }

  const isSuperAdmin = req.isSuperAdmin || (req.user && (
    (typeof req.user.isSuperAdmin === 'function' && req.user.isSuperAdmin()) ||
    req.user.systemRole === 'SUPER_ADMIN'
  ));

  if (!isSuperAdmin) {
    throw ApiError.forbidden('Access denied. Software Owner / Super Admin platform authority required.');
  }

  next();
};

module.exports = requireSuperAdmin;
