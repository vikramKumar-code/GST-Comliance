const jwt = require('jsonwebtoken');
const Session = require('../models/Session');
const { encrypt, decrypt } = require('../utils/crypto');
const { JWT_SECRET, SESSION_HOURS } = require('../config/env');
const ApiError = require('../utils/apiError');

class SessionService {
  /**
   * Create an authenticated session, encrypt GST token, and generate JWT cookie payload
   */
  static async createSession(gstin, username, gstToken, tenant = {}) {
    const gstTokenEnc = encrypt(gstToken);
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);

    const session = await Session.create({
      gstin: gstin.toUpperCase(),
      username,
      workspaceId: tenant.workspaceId || null,
      memberId: tenant.memberId || null,
      gstTokenEnc,
      authType: 'GSTIN_OTP',
      expiresAt
    });

    const token = jwt.sign(
      {
        sessionId: session._id
      },
      JWT_SECRET,
      { expiresIn: `${SESSION_HOURS}h` }
    );

    return { session, token };
  }

  /**
   * Create a standard user session (Email/Password or OAuth 2.0)
   */
  static async createUserSession(user, workspace = null, membership = null, options = {}) {
    const sessionHours = options.sessionHours || 24;
    const expiresAt = new Date(Date.now() + sessionHours * 3600 * 1000);

    const session = await Session.create({
      userId: user._id,
      username: user.name || user.email,
      workspaceId: workspace?._id || null,
      memberId: membership?._id || null,
      gstin: workspace?.gstin || null,
      gstTokenEnc: options.gstToken ? encrypt(options.gstToken) : null,
      authType: 'USER_AUTH',
      expiresAt
    });

    const token = jwt.sign(
      {
        sessionId: session._id,
        userId: user._id
      },
      JWT_SECRET,
      { expiresIn: `${sessionHours}h` }
    );

    return { session, token };
  }

  /**
   * Retrieve active session and decrypt GST token (if present)
   */
  static async getSessionWithToken(sessionId) {
    const session = await Session.findById(sessionId);
    if (!session || session.isExpired()) {
      if (session) {
        await Session.findByIdAndDelete(sessionId).catch(() => {});
      }
      throw ApiError.sessionExpired('Session has expired. Please verify OTP or log in again.');
    }

    const gstToken = session.gstTokenEnc ? decrypt(session.gstTokenEnc) : null;
    return { session, gstToken };
  }

  /**
   * Update an active session with a newly refreshed GST token
   */
  static async updateSessionToken(sessionId, newGstToken) {
    if (!sessionId || !newGstToken) return null;
    const gstTokenEnc = encrypt(newGstToken);
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
    return Session.findByIdAndUpdate(
      sessionId,
      {
        gstTokenEnc,
        expiresAt
      },
      { new: true }
    );
  }

  /**
   * Destroy an existing session
   */
  static async destroySession(sessionId) {
    if (!sessionId) return;
    await Session.findByIdAndDelete(sessionId);
  }
}

module.exports = SessionService;
