const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const Session = require('../models/Session');
const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const AuditLog = require('../models/AuditLog');
const SessionService = require('../services/session.service');
const ApiError = require('../utils/apiError');
const { isProduction } = require('../config/env');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CA_MEMBER_PERMISSIONS = [
  'INVOICE_MANAGE',
  'BILL_MANAGE',
  'REPORT_VIEW',
  'GSTR_VIEW',
  'GSTR_FILE'
];

async function ensureUserId(req) {
  let userId = req.userId || req.session?.userId || req.membership?.userId;
  if (!userId && req.session) {
    const user = await User.create({
      name: req.username || (req.gstin ? `Taxpayer (${req.gstin.slice(0, 5)})` : 'User'),
      authProvider: 'GSTIN_OTP'
    });
    userId = user._id;
    req.session.userId = user._id;
    await req.session.save();
  }
  return userId;
}

/**
 * Resolves or auto-provisions a default workspace and owner membership for user
 */
async function getOrCreateUserWorkspace(user) {
  let membership = await WorkspaceMember.findOne({
    userId: user._id,
    status: 'ACTIVE'
  });
  let workspace = null;
  if (membership) {
    workspace = await Workspace.findById(membership.workspaceId);
  }
  if (!workspace) {
    workspace = await Workspace.create({
      name: `${user.name || 'User'}'s Organization`,
      ownerUserId: user._id,
      status: 'ACTIVE'
    });
    membership = await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId: user._id,
      role: 'CA',
      subRole: 'CA',
      status: 'ACTIVE'
    });
  }
  return { workspace, membership };
}

/**
 * Register new user with Email and Password
 * POST /api/auth/register
 */
exports.signup = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const cleanEmail = email.trim().toLowerCase();

    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      throw ApiError.validationError('An account with this email already exists.');
    }

    const hashedPassword = await User.hashPassword(password);
    const user = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword,
      authProvider: 'LOCAL',
      isEmailVerified: false
    });

    const { workspace, membership } = await getOrCreateUserWorkspace(user);
    const { token } = await SessionService.createUserSession(user, workspace, membership);

    res.cookie('sid', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 24 * 3600 * 1000
    });

    await AuditLog.create({
      workspaceId: workspace?._id || null,
      action: 'USER_SIGNUP',
      status: 'SUCCESS'
    }).catch(() => {});

    const isSuper = typeof user.isSuperAdmin === 'function'
      ? user.isSuperAdmin()
      : user.systemRole === 'SUPER_ADMIN';

    if (isSuper && user.systemRole !== 'SUPER_ADMIN') {
      user.systemRole = 'SUPER_ADMIN';
      await user.save();
    }

    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        authProvider: user.authProvider,
        systemRole: isSuper ? 'SUPER_ADMIN' : (user.systemRole || 'USER'),
        isSuperAdmin: isSuper
      },
      isSuperAdmin: isSuper,
      currentWorkspace: workspace ? { id: workspace._id, name: workspace.name, gstin: workspace.gstin } : null
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login user with Email and Password
 * POST /api/auth/login
 */
exports.signin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: cleanEmail }).select('+password');
    if (!user || !user.password) {
      throw ApiError.validationError('Invalid email or password.');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw ApiError.validationError('Invalid email or password.');
    }

    const { workspace, membership } = await getOrCreateUserWorkspace(user);
    const { token } = await SessionService.createUserSession(user, workspace, membership);

    res.cookie('sid', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 24 * 3600 * 1000
    });

    await AuditLog.create({
      workspaceId: workspace?._id || null,
      action: 'USER_LOGIN',
      status: 'SUCCESS'
    }).catch(() => {});

    const isSuper = typeof user.isSuperAdmin === 'function'
      ? user.isSuperAdmin()
      : user.systemRole === 'SUPER_ADMIN';

    if (isSuper && user.systemRole !== 'SUPER_ADMIN') {
      user.systemRole = 'SUPER_ADMIN';
      await user.save();
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        authProvider: user.authProvider,
        systemRole: isSuper ? 'SUPER_ADMIN' : (user.systemRole || 'USER'),
        isSuperAdmin: isSuper
      },
      isSuperAdmin: isSuper,
      currentWorkspace: workspace ? { id: workspace._id, name: workspace.name, gstin: workspace.gstin } : null
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Google OAuth 2.0 Sign-In / Sign-Up
 * POST /api/auth/google
 */
exports.googleAuth = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    let payload;

    if (GOOGLE_CLIENT_ID) {
      const client = new OAuth2Client(GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } else {
      // Testing support strictly when NODE_ENV === 'test'
      if (process.env.NODE_ENV === 'test' && idToken.startsWith('mock-google-token:')) {
        const parts = idToken.split(':');
        payload = {
          sub: parts[1] || 'google-test-id-12345',
          email: parts[2] || 'testgoogle@candidtax.com',
          name: parts[3] || 'Google Verified User',
          picture: null
        };
      } else {
        throw ApiError.serverError('Google OAuth is not configured on this server.');
      }
    }

    if (!payload || !payload.email) {
      throw ApiError.validationError('Unable to extract verified user profile from Google token.');
    }

    const cleanEmail = payload.email.trim().toLowerCase();
    const googleId = payload.sub;

    let user = await User.findOne({
      $or: [
        { googleId },
        { email: cleanEmail }
      ]
    });

    if (!user) {
      user = await User.create({
        name: payload.name || cleanEmail.split('@')[0],
        email: cleanEmail,
        googleId,
        avatar: payload.picture || null,
        authProvider: 'GOOGLE',
        isEmailVerified: true
      });
    } else {
      if (!user.googleId) {
        user.googleId = googleId;
      }
      if (payload.picture && !user.avatar) {
        user.avatar = payload.picture;
      }
      await user.save();
    }

    const { workspace, membership } = await getOrCreateUserWorkspace(user);
    const { token } = await SessionService.createUserSession(user, workspace, membership);

    res.cookie('sid', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 24 * 3600 * 1000
    });

    await AuditLog.create({
      workspaceId: workspace?._id || null,
      action: 'USER_GOOGLE_AUTH',
      status: 'SUCCESS'
    }).catch(() => {});

    const isSuper = typeof user.isSuperAdmin === 'function'
      ? user.isSuperAdmin()
      : user.systemRole === 'SUPER_ADMIN';

    if (isSuper && user.systemRole !== 'SUPER_ADMIN') {
      user.systemRole = 'SUPER_ADMIN';
      await user.save();
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        authProvider: user.authProvider,
        systemRole: isSuper ? 'SUPER_ADMIN' : (user.systemRole || 'USER'),
        isSuperAdmin: isSuper
      },
      isSuperAdmin: isSuper,
      currentWorkspace: workspace ? { id: workspace._id, name: workspace.name, gstin: workspace.gstin } : null
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all workspaces accessible by the authenticated user
 * GET /api/auth/workspaces
 */
exports.getWorkspaces = async (req, res, next) => {
  try {
    const userId = req.userId || req.session.userId;
    if (!userId) {
      return res.status(200).json({
        success: true,
        workspaces: req.workspaceId ? [{
          id: req.workspaceId,
          gstin: req.gstin,
          role: req.workspaceRole || 'OWNER',
          isCurrent: true
        }] : []
      });
    }

    const memberships = await WorkspaceMember.find({
      userId,
      status: 'ACTIVE'
    });

    const workspaceIds = memberships.map((m) => m.workspaceId);
    const workspaces = await Workspace.find({
      _id: { $in: workspaceIds },
      status: 'ACTIVE'
    });

    const result = workspaces.map((w) => {
      const m = memberships.find((mem) => mem.workspaceId.toString() === w._id.toString());
      return {
        id: w._id,
        name: w.name || (w.gstin ? `GSTIN: ${w.gstin}` : 'Organization'),
        tradeName: w.tradeName || '',
        address: w.address || '',
        stateCode: w.stateCode || (w.gstin ? w.gstin.slice(0, 2) : ''),
        stateName: w.stateName || '',
        pincode: w.pincode || '',
        phone: w.phone || '',
        gstin: w.gstin || null,
        role: m?.subRole === 'CA' && m.role === 'MEMBER' ? 'CA' : (m?.role || 'MEMBER'),
        isCurrent: req.workspaceId ? req.workspaceId.toString() === w._id.toString() : false
      };
    });

    res.status(200).json({
      success: true,
      workspaces: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Switch active session to a different workspace
 * POST /api/auth/switch-workspace
 */
exports.switchWorkspace = async (req, res, next) => {
  try {
    const { workspaceId } = req.body;
    const userId = await ensureUserId(req);

    if (!userId) {
      throw ApiError.validationError('Workspace switching requires an authenticated user account.');
    }

    const membership = await WorkspaceMember.findOne({
      userId,
      workspaceId,
      status: 'ACTIVE'
    });

    if (!membership) {
      throw ApiError.forbidden('You do not have active access to this workspace.');
    }

    const workspace = await Workspace.findOne({
      _id: workspaceId,
      status: 'ACTIVE'
    });


    if (!workspace) {
      throw ApiError.notFound('Workspace not found or inactive.');
    }

    req.session.workspaceId = workspace._id;
    req.session.memberId = membership._id;
    req.session.gstin = workspace.gstin;
    if (workspace.gstPortalSession?.gstTokenEnc && (!workspace.gstPortalSession.expiresAt || new Date() < new Date(workspace.gstPortalSession.expiresAt))) {
      req.session.gstTokenEnc = workspace.gstPortalSession.gstTokenEnc;
      req.session.username = workspace.gstPortalSession.username || req.session.username;
    } else {
      req.session.gstTokenEnc = null;
    }
    await req.session.save();

    await AuditLog.create({
      workspaceId: workspace._id,
      memberId: membership._id,
      gstin: workspace.gstin,
      action: 'SWITCH_WORKSPACE',
      status: 'SUCCESS'
    }).catch(() => {});

    const hasPortalSession = Boolean(
      workspace.gstPortalSession?.gstTokenEnc &&
      (!workspace.gstPortalSession.expiresAt || new Date() < new Date(workspace.gstPortalSession.expiresAt))
    );

    res.status(200).json({
      success: true,
      currentWorkspace: {
        id: workspace._id,
        name: workspace.name,
        gstin: workspace.gstin,
        hasPortalSession,
        portalUsername: workspace.gstPortalSession?.username || null,
        role: membership.subRole === 'CA' && membership.role === 'MEMBER' ? 'CA' : membership.role
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current authenticated user profile and active workspace context
 * GET /api/auth/me
 */
exports.getMe = async (req, res, next) => {
  try {
    let currentWorkspace = null;
    if (req.workspaceId) {
      currentWorkspace = await Workspace.findById(req.workspaceId).lean();
    }

    const hasPortalSession = Boolean(
      currentWorkspace?.gstPortalSession?.gstTokenEnc &&
      (!currentWorkspace?.gstPortalSession?.expiresAt || new Date() < new Date(currentWorkspace?.gstPortalSession?.expiresAt))
    );

    const resolvedName = req.user?.name && !req.user.name.startsWith('Taxpayer')
      ? req.user.name
      : currentWorkspace?.name || (req.gstin ? `GSTIN ${req.gstin}` : 'User');

    res.status(200).json({
      success: true,
      user: {
        id: req.user?._id || req.session?.userId || null,
        name: resolvedName,
        email: req.user?.email || null,
        avatar: req.user?.avatar || null,
        authProvider: req.user?.authProvider || req.session?.authType || 'GSTIN_OTP',
        systemRole: req.user?.systemRole || (req.isSuperAdmin ? 'SUPER_ADMIN' : 'USER'),
        isSuperAdmin: Boolean(req.isSuperAdmin)
      },
      currentWorkspace: currentWorkspace ? {
        id: currentWorkspace._id,
        name: currentWorkspace.name,
        tradeName: currentWorkspace.tradeName || '',
        address: currentWorkspace.address || '',
        stateCode: currentWorkspace.stateCode || (currentWorkspace.gstin ? currentWorkspace.gstin.slice(0, 2) : ''),
        stateName: currentWorkspace.stateName || '',
        pincode: currentWorkspace.pincode || '',
        phone: currentWorkspace.phone || '',
        gstin: currentWorkspace.gstin,
        hasPortalSession,
        portalUsername: currentWorkspace.gstPortalSession?.username || null,
        status: currentWorkspace.status || 'ACTIVE',
        subscription: currentWorkspace.subscription || { plan: 'FREE', status: 'ACTIVE' },
        limits: currentWorkspace.limits || { maxClients: 1, maxInvoicesPerMonth: 50 },
        role: req.membership?.subRole === 'CA' && req.membership.role === 'MEMBER'
          ? 'CA'
          : (req.workspaceRole || 'OWNER'),
        permissions: req.membership?.permissions || ['ALL']
      } : null,
      hasPortalSession,
      portalUsername: currentWorkspace?.gstPortalSession?.username || null,
      workspaceName: currentWorkspace?.name || null,
      gstin: req.gstin || currentWorkspace?.gstin || null,
      workspaceId: req.workspaceId || null,
      workspaceRole: req.membership?.subRole === 'CA' && req.membership.role === 'MEMBER'
        ? 'CA'
        : (req.workspaceRole || 'OWNER'),
      permissions: req.membership?.permissions || ['ALL'],
      isSuperAdmin: Boolean(req.isSuperAdmin),
      expiresAt: req.session?.expiresAt || null
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update active workspace profile and link/update registered GSTIN
 * POST /api/auth/workspace/link-gstin
 */
exports.linkGstin = async (req, res, next) => {
  try {
    const { gstin, name } = req.body;
    const workspaceId = req.workspaceId;
    const userId = req.userId || req.session?.userId;

    if (!workspaceId) {
      throw ApiError.validationError('No active workspace session found.');
    }

    if (req.workspaceRole && req.workspaceRole !== 'OWNER' && req.workspaceRole !== 'ADMIN') {
      throw ApiError.forbidden('Only workspace Owner or Admin can link or modify the organization GSTIN.');
    }

    const normGstin = gstin.trim().toUpperCase();

    // Check if another workspace already uses this GSTIN
    const conflict = await Workspace.findOne({
      gstin: normGstin,
      _id: { $ne: workspaceId }
    });
    if (conflict) {
      throw ApiError.conflict(`GSTIN ${normGstin} is already linked to another workspace (${conflict.name}).`);
    }

    const updateFields = { gstin: normGstin };
    if (name && typeof name === 'string' && name.trim()) {
      updateFields.name = name.trim();
    } else {
      try {
        const FinaggService = require('../services/finagg.service');
        const tp = await FinaggService.searchGstin(normGstin);
        const autoName = tp?.tradeName || tp?.legalName;
        if (autoName && autoName !== 'Demo Traders' && autoName !== 'Demo Traders Pvt Ltd') {
          updateFields.name = autoName;
          if (tp?.tradeName) updateFields.tradeName = tp.tradeName;
        }
      } catch {}
    }

    const updatedWorkspace = await Workspace.findByIdAndUpdate(
      workspaceId,
      { $set: updateFields },
      { new: true }
    );

    if (req.session) {
      req.session.gstin = normGstin;
      await req.session.save();
    }

    await AuditLog.create({
      workspaceId,
      userId,
      gstin: normGstin,
      action: 'LINK_GSTIN',
      status: 'SUCCESS'
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: `GSTIN ${normGstin} linked to organization successfully.`,
      workspace: {
        id: updatedWorkspace._id,
        name: updatedWorkspace.name,
        gstin: updatedWorkspace.gstin,
        role: req.workspaceRole || 'OWNER'
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new workspace/organization for user
 * POST /api/auth/workspace/create
 */
exports.createWorkspace = async (req, res, next) => {
  try {
    const { name, gstin, tradeName, address, stateCode, stateName, pincode, phone } = req.body;
    const userId = await ensureUserId(req);

    if (!userId) {
      throw ApiError.validationError('Workspace creation requires an authenticated user account.');
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw ApiError.validationError('Organization name is required.');
    }


    let normGstin = undefined;
    if (gstin && typeof gstin === 'string' && gstin.trim()) {
      normGstin = gstin.trim().toUpperCase();
      const { isValidGstin } = require('../utils/gstin');
      if (!isValidGstin(normGstin)) {
        throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
      }
      const existing = await Workspace.findOne({ gstin: normGstin });
      if (existing) {
        let membership = await WorkspaceMember.findOne({
          workspaceId: existing._id,
          userId,
          status: 'ACTIVE'
        });
        if (!membership) {
          membership = await WorkspaceMember.create({
            workspaceId: existing._id,
            userId,
            role: 'CA',
            subRole: 'CA',
            status: 'ACTIVE'
          });
        }

        if (
          name &&
          typeof name === 'string' &&
          name.trim() &&
          (existing.name.startsWith('Taxpayer') || existing.name === 'My Organization')
        ) {
          existing.name = name.trim();
        }
        if (tradeName) existing.tradeName = String(tradeName).trim();
        if (address) existing.address = String(address).trim();
        if (stateCode) existing.stateCode = String(stateCode).trim().slice(0, 2);
        if (stateName) existing.stateName = String(stateName).trim();
        if (pincode) existing.pincode = String(pincode).trim().slice(0, 6);
        if (phone) existing.phone = String(phone).trim();
        await existing.save();

        if (req.session) {
          req.session.workspaceId = existing._id;
          req.session.memberId = membership._id;
          req.session.gstin = existing.gstin;
          await req.session.save();
        }

        await AuditLog.create({
          workspaceId: existing._id,
          userId,
          action: 'LINK_CLIENT_WORKSPACE',
          status: 'SUCCESS'
        }).catch(() => {});

        return res.status(200).json({
          success: true,
          message: `Organization "${existing.name}" connected and switched successfully.`,
          workspace: {
            id: existing._id,
            name: existing.name,
            tradeName: existing.tradeName,
            address: existing.address,
            stateCode: existing.stateCode,
            stateName: existing.stateName,
            gstin: existing.gstin,
            role: membership.role
          }
        });
      }
    }

    let derivedStateCode = stateCode ? String(stateCode).trim().slice(0, 2) : '';
    if (!derivedStateCode && normGstin && normGstin.length >= 2) {
      derivedStateCode = normGstin.slice(0, 2);
    }

    const workspace = await Workspace.create({
      name: name.trim(),
      tradeName: tradeName ? String(tradeName).trim() : '',
      address: address ? String(address).trim() : '',
      stateCode: derivedStateCode,
      stateName: stateName ? String(stateName).trim() : '',
      pincode: pincode ? String(pincode).trim().slice(0, 6) : '',
      phone: phone ? String(phone).trim() : '',
      gstin: normGstin,
      ownerUserId: userId,
      status: 'ACTIVE'
    });

    const membership = await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId,
      role: 'CA',
      subRole: 'CA',
      status: 'ACTIVE'
    });

    // Auto-switch to newly created workspace
    if (req.session) {
      req.session.workspaceId = workspace._id;
      req.session.memberId = membership._id;
      req.session.gstin = workspace.gstin;
      await req.session.save();
    }

    await AuditLog.create({
      workspaceId: workspace._id,
      userId,
      action: 'CREATE_WORKSPACE',
      status: 'SUCCESS'
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: `Organization "${workspace.name}" created successfully.`,
      workspace: {
        id: workspace._id,
        name: workspace.name,
        tradeName: workspace.tradeName,
        address: workspace.address,
        stateCode: workspace.stateCode,
        stateName: workspace.stateName,
        gstin: workspace.gstin,
        role: 'OWNER'
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update organization/client workspace details (Name, Trade Name, Address, State Code, GSTIN, etc.)
 * PUT /api/auth/workspace
 */
exports.updateWorkspace = async (req, res, next) => {
  try {
    const workspaceId = req.body.workspaceId || req.params.id || req.workspaceId;
    if (!workspaceId) {
      throw ApiError.validationError('Workspace ID is required.');
    }

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      throw ApiError.notFound('Workspace not found.');
    }

    const { name, tradeName, gstin, address, stateCode, stateName, pincode, phone } = req.body;

    if (name !== undefined && typeof name === 'string' && name.trim()) {
      workspace.name = name.trim();
    }
    if (tradeName !== undefined) {
      workspace.tradeName = String(tradeName).trim();
    }
    if (address !== undefined) {
      workspace.address = String(address).trim();
    }
    if (stateCode !== undefined) {
      workspace.stateCode = String(stateCode).trim().slice(0, 2);
    }
    if (stateName !== undefined) {
      workspace.stateName = String(stateName).trim();
    }
    if (pincode !== undefined) {
      workspace.pincode = String(pincode).trim().slice(0, 6);
    }
    if (phone !== undefined) {
      workspace.phone = String(phone).trim();
    }

    if (gstin !== undefined) {
      const cleanGstin = String(gstin).trim().toUpperCase();
      if (cleanGstin) {
        const { isValidGstin } = require('../utils/gstin');
        if (!isValidGstin(cleanGstin)) {
          throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
        }
        workspace.gstin = cleanGstin;
        if (!workspace.stateCode) {
          workspace.stateCode = cleanGstin.slice(0, 2);
        }
        if (req.session && req.workspaceId && req.workspaceId.toString() === workspace._id.toString()) {
          req.session.gstin = cleanGstin;
        }
      } else {
        workspace.gstin = undefined;
      }
    }

    await workspace.save();
    if (req.session) await req.session.save();

    await AuditLog.create({
      workspaceId: workspace._id,
      userId: req.userId || null,
      gstin: workspace.gstin || null,
      action: 'UPDATE_WORKSPACE_DETAILS',
      status: 'SUCCESS'
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: `Client workspace "${workspace.name}" updated successfully.`,
      workspace: {
        id: workspace._id,
        name: workspace.name,
        tradeName: workspace.tradeName,
        address: workspace.address,
        stateCode: workspace.stateCode,
        stateName: workspace.stateName,
        pincode: workspace.pincode,
        phone: workspace.phone,
        gstin: workspace.gstin,
      }
    });
  } catch (error) {
    next(error);
  }
};



/**
 * Switch or update active member role
 * POST /api/auth/workspace/switch-role
 */
exports.switchRole = async (req, res, next) => {
  try {
    throw ApiError.forbidden(
      'Role changes via UI or API are disabled for security. Workspace roles are strictly managed directly in the MongoDB database.'
    );
  } catch (error) {
    next(error);
  }
};
