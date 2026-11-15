const ApiError = require('../utils/apiError');
const AuditLog = require('../models/AuditLog'); // ✅ Added for Security Logging

/**
 * Super Admin Middleware
 * Validates that the authenticated user has platform-level SUPER_ADMIN authority.
 */
const requireSuperAdmin = async (req, res, next) => {
  try {
    // 1. Strict Authentication Check
    // We rely on req.user being populated by the auth middleware
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required. Please log in.'));
    }

    // 2. Robust Super Admin Verification
    let isSuperAdmin = false;

    // Check if explicitly set by previous middleware
    if (req.isSuperAdmin === true) {
      isSuperAdmin = true;
    }
    // Check User model method (Best Practice)
    else if (typeof req.user.isSuperAdmin === 'function' && req.user.isSuperAdmin()) {
      isSuperAdmin = true;
    }
    // Fallback to direct property check
    else if (req.user.systemRole === 'SUPER_ADMIN') {
      isSuperAdmin = true;
    }

    // 3. Enforce Access Control
    if (!isSuperAdmin) {
      // ✅ SECURITY FIX: Log unauthorized Super Admin access attempts
      if (AuditLog.db?.readyState === 1) {
        await AuditLog.create({
          userId: req.user._id,
          userEmail: req.user.email,
          userName: req.user.name,
          workspaceId: req.workspaceId || null,
          gstin: req.gstin || null,
          action: 'UNAUTHORIZED_SUPER_ADMIN_ACCESS',
          status: 'FAILURE',
          ipAddress: req.ip,
          metadata: {
            attemptedUrl: req.originalUrl,
            userRole: req.user.systemRole || 'USER',
            message: 'Non-admin user attempted to access Super Admin restricted endpoint.'
          }
        }).catch((err) => {
          console.error('Failed to log unauthorized super admin access:', err.message);
        });
      }

      throw ApiError.forbidden(
        'Access Denied: This area is restricted to Platform Super Administrators (Software Owners) only.'
      );
    }

    // 4. Grant Access
    next();
  } catch (error) {
    // Ensure all errors (including ApiError) are passed to Express error handler
    next(error);
  }
};

module.exports = requireSuperAdmin;