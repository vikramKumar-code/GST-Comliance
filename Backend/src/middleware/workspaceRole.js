const ApiError = require('../utils/apiError');
const AuditLog = require('../models/AuditLog'); // ✅ Added for Security Logging

const workspaceRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      // ✅ FIX 3: Robust Super Admin Check
      const isSuperAdmin = req.isSuperAdmin === true ||
        (req.user && typeof req.user.isSuperAdmin === 'function' && req.user.isSuperAdmin()) ||
        (req.user && req.user.systemRole === 'SUPER_ADMIN');

      if (isSuperAdmin) {
        return next();
      }

      // ✅ FIX 1: Case-Insensitive Role Resolution & Fallback
      let currentRole = 'NONE';

      if (req.membership && req.membership.role) {
        currentRole = String(req.membership.role).toUpperCase();
      } else if (req.workspaceRole) {
        currentRole = String(req.workspaceRole).toUpperCase();
      } else if (req.session && req.session.gstin && req.workspace && req.workspace.gstin === req.session.gstin) {
        // Fallback: Direct GSTIN login without WorkspaceMember record -> treat as OWNER
        currentRole = 'OWNER';
      }

      // Normalize allowed roles to uppercase for safe comparison
      const normalizedAllowed = allowedRoles.map(r => String(r).toUpperCase());

      // Authorization Check
      if (!normalizedAllowed.includes(currentRole)) {

        // ✅ FIX 2: Security Audit Log for Unauthorized Attempts
        AuditLog.create({
          workspaceId: req.workspaceId || req.workspace?._id,
          userId: req.user?._id || null,
          gstin: req.gstin || req.session?.gstin || null,
          action: 'ACCESS_DENIED',
          status: 'FAILURE',
          ipAddress: req.ip,
          metadata: {
            attemptedRole: currentRole,
            requiredRoles: normalizedAllowed,
            endpoint: req.originalUrl
          }
        }).catch(() => { });

        // User-friendly error messages
        if (currentRole === 'ACCOUNTANT' && !normalizedAllowed.includes('ACCOUNTANT')) {
          return next(ApiError.forbidden(
            'Your active workspace role is Accountant (Billing Only). Filing GST returns and statutory OTP authorization requires CA (Chartered Accountant) or Organization Owner authority.'
          ));
        }

        if (currentRole === 'VIEWER') {
          return next(ApiError.forbidden(
            'Your active workspace role is Viewer (Read Only). Modification or filing is prohibited.'
          ));
        }

        return next(ApiError.forbidden(
          `Your workspace role (${currentRole}) does not allow this action. Required: ${normalizedAllowed.join(' or ')}.`
        ));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = workspaceRole;