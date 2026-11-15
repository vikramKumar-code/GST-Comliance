const ApiError = require('../utils/apiError');
const AuditLog = require('../models/AuditLog'); // ✅ Added for Security Logging

/**
 * Role Guard Middleware
 * Restricts endpoints based on workspace role (OWNER, CA, ACCOUNTANT, VIEWER).
 *
 * @param {string[]} allowedRoles Array of allowed roles (e.g. ['OWNER', 'CA'])
 * @param {string} customErrorMessage Custom error message if forbidden
 */
const requireWorkspaceRole = (allowedRoles = ['OWNER', 'CA'], customErrorMessage = null) => {
  return async (req, res, next) => {
    try {
      // ✅ FIX 3: Robust Super Admin Check (Supports both property and User model method)
      const isSuperAdmin = req.isSuperAdmin === true ||
        (req.user && typeof req.user.isSuperAdmin === 'function' && req.user.isSuperAdmin());

      if (isSuperAdmin) {
        return next();
      }

      // ✅ FIX 1: Case-Insensitive Role Resolution
      let currentRole = 'NONE';

      if (req.membership && req.membership.role) {
        currentRole = String(req.membership.role).toUpperCase();
      } else if (req.workspaceRole) {
        currentRole = String(req.workspaceRole).toUpperCase();
      } else if (req.session && req.session.gstin && req.workspace && req.workspace.gstin === req.session.gstin) {
        // Fallback: If user has a valid session for this specific workspace GSTIN, treat as OWNER
        // This handles direct GSTIN logins where a formal WorkspaceMember record might be missing/broken
        currentRole = 'OWNER';
      }

      // Normalize allowed roles to uppercase for safe comparison
      const normalizedAllowed = allowedRoles.map(r => String(r).toUpperCase());

      // 3. Authorization Check
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
          throw ApiError.forbidden(
            customErrorMessage || 'Accountants are restricted from this action. CA or Owner authority is required.'
          );
        }
        if (currentRole === 'VIEWER') {
          throw ApiError.forbidden(
            customErrorMessage || 'Viewers have read-only access and cannot perform this action.'
          );
        }

        throw ApiError.forbidden(
          customErrorMessage || `Access denied. Required role: ${normalizedAllowed.join(' or ')}. Your current role: ${currentRole}`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  requireWorkspaceRole
};