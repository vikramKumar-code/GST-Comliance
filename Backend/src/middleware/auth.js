const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const Session = require('../models/Session');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const ApiError = require('../utils/apiError');
const { decrypt } = require('../utils/crypto');

/**
 * Authentication middleware
 * Validates the httpOnly JWT cookie ('sid'), extracts the session ID,
 * verifies session validity against MongoDB, and checks TTL expiration.
 */
const auth = async (req, res, next) => {
  try {
    const token = req.cookies?.sid;
    if (!token) {
      throw ApiError.sessionExpired('Authentication required. No session cookie found.');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      throw ApiError.sessionExpired('Invalid or expired session token.');
    }

    const sessionId = decoded.sessionId || decoded.id || decoded.sid;
    if (!sessionId) {
      throw ApiError.sessionExpired('Session token malformed.');
    }

    const session = await Session.findById(sessionId);
    if (!session) {
      throw ApiError.sessionExpired('Session not found or has been revoked.');
    }

    // Always check in code because MongoDB TTL cleanup runs only periodically (~once per minute)
    if (session.isExpired()) {
      await Session.findByIdAndDelete(sessionId).catch(() => {});
      throw ApiError.sessionExpired('Session has expired. Please verify OTP again.');
    }

    let membership = null;
    if (session.workspaceId || session.memberId) {
      if (!session.workspaceId || !session.memberId) {
        throw ApiError.sessionExpired('Workspace access is unavailable. Please verify OTP again.');
      }
      const [workspace, activeMembership] = await Promise.all([
        Workspace.findOne({ _id: session.workspaceId, gstin: session.gstin, status: 'ACTIVE' }),
        WorkspaceMember.findOne({
          _id: session.memberId,
          workspaceId: session.workspaceId,
          status: 'ACTIVE'
        })
      ]);
      if (!workspace || !activeMembership) {
        throw ApiError.sessionExpired('Workspace access is unavailable. Please verify OTP again.');
      }
      membership = activeMembership;
    }

    // Attach active session, user, and taxpayer context to the request object
    let user = null;
    if (session.userId) {
      user = await User.findById(session.userId).catch(() => null);
    }

    req.session = session;
    req.user = user;
    req.userId = session.userId || user?._id || null;
    req.gstin = session.gstin;
    req.username = session.username;
    req.workspaceId = session.workspaceId || null;
    req.membership = membership;
    // Legacy sessions remain scoped to their verified GSTIN and keep read access.
    req.workspaceRole = membership?.role || 'MEMBER';
    if (session.gstTokenEnc) {
      try {
        req.gstToken = decrypt(session.gstTokenEnc);
      } catch {
        req.gstToken = null;
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = auth;
