const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { JWT_SECRET, isProduction } = require('../config/env');
const Session = require('../models/Session');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const ApiError = require('../utils/apiError');
const { decrypt } = require('../utils/crypto');
const logger = require('../utils/logger');

// ✅ FIX 1: Fail fast if JWT_SECRET is not configured
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  const errorMsg = 'CRITICAL: JWT_SECRET must be configured and at least 32 characters long';
  if (isProduction) {
    throw new Error(errorMsg);
  } else {
    logger.warn(errorMsg + '. Using insecure fallback for development.');
  }
}

// ✅ FIX 3: Simple in-memory LRU cache for sessions (5 second TTL)
const sessionCache = new Map();
const CACHE_TTL = 5000; // 5 seconds
const MAX_CACHE_SIZE = 1000;

function getCachedSession(sessionId) {
  const cached = sessionCache.get(sessionId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  sessionCache.delete(sessionId);
  return null;
}

function setCachedSession(sessionId, data) {
  // Cleanup if cache is too large
  if (sessionCache.size >= MAX_CACHE_SIZE) {
    const now = Date.now();
    for (const [key, val] of sessionCache.entries()) {
      if (now - val.timestamp >= CACHE_TTL) {
        sessionCache.delete(key);
      }
    }
    // If still too large, clear oldest entries
    if (sessionCache.size >= MAX_CACHE_SIZE) {
      const entries = Array.from(sessionCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, MAX_CACHE_SIZE / 2);
      toDelete.forEach(([key]) => sessionCache.delete(key));
    }
  }
  sessionCache.set(sessionId, { data, timestamp: Date.now() });
}

/**
 * Authentication middleware
 * Validates the httpOnly JWT cookie ('sid'), extracts the session ID,
 * verifies session validity against MongoDB, and checks TTL expiration.
 */
const auth = async (req, res, next) => {
  // ✅ FIX 4: Generate unique request ID for audit trail
  req.requestId = crypto.randomUUID();

  try {
    const token = req.cookies?.sid || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw ApiError.sessionExpired('Authentication required. No session cookie or token found.');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      logger.warn(`JWT verification failed for request ${req.requestId}`, {
        error: err.message,
        ip: req.ip
      });
      throw ApiError.sessionExpired('Invalid or expired session token.');
    }

    const sessionId = decoded.sessionId || decoded.id || decoded.sid;
    if (!sessionId) {
      throw ApiError.sessionExpired('Session token malformed.');
    }

    // ✅ FIX 3: Check cache first
    let session = getCachedSession(sessionId);
    if (!session) {
      session = await Session.findById(sessionId);
      if (session) {
        setCachedSession(sessionId, session);
      }
    }

    if (!session) {
      throw ApiError.sessionExpired('Session not found or has been revoked.');
    }

    // Always check in code because MongoDB TTL cleanup runs only periodically (~once per minute)
    if (session.isExpired()) {
      await Session.findByIdAndDelete(sessionId).catch(() => { });
      sessionCache.delete(sessionId); // Invalidate cache
      throw ApiError.sessionExpired('Session has expired. Please verify OTP again.');
    }

    let membership = null;
    let workspace = null;
    if (session.workspaceId || session.memberId) {
      if (!session.workspaceId || !session.memberId) {
        throw ApiError.sessionExpired('Workspace access is unavailable. Please verify OTP again.');
      }
      const [foundWorkspace, activeMembership] = await Promise.all([
        Workspace.findById(session.workspaceId),
        WorkspaceMember.findOne({
          _id: session.memberId,
          workspaceId: session.workspaceId,
          status: 'ACTIVE'
        })
      ]);
      if (!foundWorkspace || !activeMembership) {
        throw ApiError.sessionExpired('Workspace access is unavailable. Please verify OTP again.');
      }

      if (foundWorkspace.status === 'SUSPENDED') {
        throw ApiError.forbidden('This client workspace has been suspended by the platform administrator.');
      }

      workspace = foundWorkspace;
      membership = activeMembership;
    }

    // Attach active session, user, and taxpayer context to the request object
    const targetUserId = session.userId || membership?.userId || null;
    let user = null;
    if (targetUserId) {
      user = await User.findById(targetUserId).catch(() => null);
    }

    if (user && user.status === 'BLOCKED') {
      throw ApiError.forbidden('Your account has been suspended by the platform administrator.');
    }

    const isSuperAdmin = user
      ? typeof user.isSuperAdmin === 'function'
        ? user.isSuperAdmin()
        : user.systemRole === 'SUPER_ADMIN'
      : false;

    req.session = session;
    req.user = user;
    req.userId = targetUserId || user?._id || null;
    req.gstin = workspace?.gstin || session.gstin || null;
    req.username = workspace?.gstPortalSession?.username || session.username || null;
    req.workspaceId = workspace?._id || session.workspaceId || null;
    req.workspace = workspace;
    req.isSuperAdmin = isSuperAdmin;

    req.membership = membership;
    // Legacy sessions remain scoped to their verified GSTIN and keep read access.
    req.workspaceRole = membership?.subRole === 'CA' && membership.role === 'MEMBER'
      ? 'CA'
      : (membership?.role || 'MEMBER');

    const tokenEnc = session.gstTokenEnc || workspace?.gstPortalSession?.gstTokenEnc;
    if (tokenEnc) {
      try {
        req.gstToken = decrypt(tokenEnc);
      } catch (decryptError) {
        // ✅ FIX 2: Log decryption failure for debugging
        logger.error(`GST token decryption failed for session ${sessionId}`, {
          requestId: req.requestId,
          error: decryptError.message,
          workspaceId: workspace?._id,
          gstin: workspace?.gstin || session.gstin
        });
        req.gstToken = null;
        // Note: We don't throw here because some endpoints might not require GST token
        // But downstream code should check if gstToken is null when needed
      }
    }

    next();
  } catch (error) {
    // Attach request ID to error for correlation
    error.requestId = req.requestId;
    next(error);
  }
};

module.exports = auth;