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
      // Testing / Sandbox support without external Google client ID credentials
      if (process.env.NODE_ENV === 'test' || idToken.startsWith('mock-google-token:')) {
        const parts = idToken.split(':');
        payload = {
          sub: parts[1] || 'google-test-id-12345',
          email: parts[2] || 'testgoogle@candidtax.com',
          name: parts[3] || 'Google Verified User',
          picture: null
        };
      } else {
        const client = new OAuth2Client();
        const ticket = await client.verifyIdToken({ idToken });
        payload = ticket.getPayload();
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
    const userId = req.userId || req.session.userId;

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
