const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const Session = require('../models/Session');
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

    // Attach active session and taxpayer context to the request object
    req.session = session;
    req.gstin = session.gstin;
    req.username = session.username;
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
