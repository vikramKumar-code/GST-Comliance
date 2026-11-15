const crypto = require('crypto');
const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const User = require('../models/User');
const { TENANT_IDENTITY_SECRET, isProduction } = require('../config/env');
const ApiError = require('../utils/apiError');
const { isValidGstin } = require('../utils/gstin');

class TenantService {
  static async ensureWorkspace(gstin) {
    if (!gstin || typeof gstin !== 'string') {
      throw ApiError.validationError('Valid GSTIN is required to ensure workspace.');
    }
    const normalizedGstin = gstin.trim().toUpperCase();

    // Strict GSTIN validation before DB operation
    if (!isValidGstin(normalizedGstin)) {
      throw ApiError.invalidGstin('Invalid GSTIN format provided for workspace creation.');
    }

    try {
      return await Workspace.findOneAndUpdate(
        { gstin: normalizedGstin },
        { $setOnInsert: { gstin: normalizedGstin, status: 'ACTIVE' } },
        { upsert: true, new: true } // ✅ FIX 2: Removed deprecated setDefaultsOnInsert
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      // Race condition fallback (two requests tried to create same workspace simultaneously)
      return Workspace.findOne({ gstin: normalizedGstin });
    }
  }

  static _identityHash(gstin, username) {
    // ✅ FIX 1: Strict Secret Validation for Production
    if (!TENANT_IDENTITY_SECRET) {
      if (isProduction) {
        throw new Error('CRITICAL: TENANT_IDENTITY_SECRET is missing in production environment.');
      }
      console.warn('[TenantService] TENANT_IDENTITY_SECRET is missing. Using insecure fallback for dev.');
    }

    // ✅ FIX 3: Defensive String Conversion
    const normGstin = String(gstin || '').trim().toUpperCase();
    const normUser = String(username || '').trim();

    if (!normGstin || !normUser) {
      throw ApiError.validationError('GSTIN and Username are required to generate identity hash.');
    }

    // Null byte separator prevents collision attacks (e.g. "AB"+"CD" vs "ABC"+"D")
    const identity = `${normGstin}\u0000${normUser}`;
    const secret = TENANT_IDENTITY_SECRET || 'insecure-dev-secret-do-not-use-in-prod';
    return crypto.createHmac('sha256', secret).update(identity).digest('hex');
  }

  static async ensureMembership(gstin, username) {
    const workspace = await TenantService.ensureWorkspace(gstin);
    if (!workspace) {
      throw ApiError.serverError('Failed to resolve workspace for GSTIN.');
    }

    const identityHash = TenantService._identityHash(gstin, username);
    let user;

    try {
      user = await User.findOneAndUpdate(
        { identityHash },
        { $setOnInsert: { identityHash, systemRole: 'USER', status: 'ACTIVE' } },
        { upsert: true, new: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      user = await User.findOne({ identityHash });
    }

    if (!user) {
      throw ApiError.serverError('Failed to resolve or create user identity.');
    }

    let membership = await WorkspaceMember.findOne({ workspaceId: workspace._id, userId: user._id });

    if (!membership) {
      // The first verified GSTN login claims the owner seat atomically; later logins are members.
      const claimedWorkspace = await Workspace.findOneAndUpdate(
        { _id: workspace._id, ownerUserId: null },
        { $set: { ownerUserId: user._id } },
        { new: true }
      );

      const alreadyOwner = claimedWorkspace || await Workspace.exists({
        _id: workspace._id,
        ownerUserId: user._id
      });

      const role = alreadyOwner ? 'OWNER' : 'MEMBER';

      try {
        membership = await WorkspaceMember.create({
          workspaceId: workspace._id,
          userId: user._id,
          role,
          status: 'ACTIVE' // Explicitly set status
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        // Race condition fallback
        membership = await WorkspaceMember.findOne({ workspaceId: workspace._id, userId: user._id });
      }
    }

    // Final access checks with specific error messages
    if (!membership || membership.status !== 'ACTIVE') {
      throw ApiError.forbidden('Your membership in this workspace is inactive. Please contact the owner.');
    }

    if (workspace.status !== 'ACTIVE') {
      throw ApiError.forbidden(`This workspace is currently ${workspace.status.toLowerCase()}. Access denied.`);
    }

    return { workspace, user, membership };
  }
}

module.exports = TenantService;