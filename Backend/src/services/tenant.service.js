const crypto = require('crypto');
const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const User = require('../models/User');
const { TENANT_IDENTITY_SECRET } = require('../config/env');
const ApiError = require('../utils/apiError');

class TenantService {
  static async ensureWorkspace(gstin) {
    const normalizedGstin = gstin.trim().toUpperCase();
    try {
      return await Workspace.findOneAndUpdate(
        { gstin: normalizedGstin },
        { $setOnInsert: { gstin: normalizedGstin } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      return Workspace.findOne({ gstin: normalizedGstin });
    }
  }

  static _identityHash(gstin, username) {
    const identity = `${gstin.trim().toUpperCase()}\u0000${username.trim()}`;
    return crypto.createHmac('sha256', TENANT_IDENTITY_SECRET).update(identity).digest('hex');
  }

  static async ensureMembership(gstin, username) {
    const workspace = await TenantService.ensureWorkspace(gstin);
    const identityHash = TenantService._identityHash(gstin, username);
    let user;
    try {
      user = await User.findOneAndUpdate(
        { identityHash },
        { $setOnInsert: { identityHash } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      user = await User.findOne({ identityHash });
    }

    let membership = await WorkspaceMember.findOne({ workspaceId: workspace._id, userId: user._id });
    if (!membership) {
      // The first verified GSTN login claims the owner seat atomically; later logins are read-only members.
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
          role
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        membership = await WorkspaceMember.findOne({ workspaceId: workspace._id, userId: user._id });
      }
    }

    if (!membership || membership.status !== 'ACTIVE' || workspace.status !== 'ACTIVE') {
      throw ApiError.sessionExpired('Workspace access is unavailable. Please contact your workspace owner.');
    }

    return { workspace, user, membership };
  }
}

module.exports = TenantService;
