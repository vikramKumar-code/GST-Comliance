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
      role: 'OWNER',
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

    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        authProvider: user.authProvider
      },
      currentWorkspace: workspace ? { id: workspace._id, gstin: workspace.gstin } : null
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

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        authProvider: user.authProvider
      },
      currentWorkspace: workspace ? { id: workspace._id, gstin: workspace.gstin } : null
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

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        authProvider: user.authProvider
      },
      currentWorkspace: workspace ? { id: workspace._id, gstin: workspace.gstin } : null
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
        gstin: w.gstin || null,
        role: m?.role || 'MEMBER',
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
    await req.session.save();

    await AuditLog.create({
      workspaceId: workspace._id,
      memberId: membership._id,
      gstin: workspace.gstin,
      action: 'SWITCH_WORKSPACE',
      status: 'SUCCESS'
    }).catch(() => {});

    res.status(200).json({
      success: true,
      currentWorkspace: {
        id: workspace._id,
        gstin: workspace.gstin,
        role: membership.role
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
    res.status(200).json({
      success: true,
      user: req.user ? {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        avatar: req.user.avatar,
        authProvider: req.user.authProvider
      } : null,
      gstin: req.gstin || null,
      workspaceId: req.workspaceId || null,
      workspaceRole: req.workspaceRole || null,
      expiresAt: req.session.expiresAt
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
    const { name, gstin } = req.body;
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
        throw ApiError.conflict('A workspace with this GSTIN already exists.');
      }
    }

    const workspace = await Workspace.create({
      name: name.trim(),
      gstin: normGstin,
      ownerUserId: userId,
      status: 'ACTIVE'
    });

    const membership = await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId,
      role: 'OWNER',
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
        gstin: workspace.gstin,
        role: 'OWNER'
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



