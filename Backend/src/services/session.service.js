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
   * Retrieve active session and decrypt GST token
   */
  static async getSessionWithToken(sessionId) {
    const session = await Session.findById(sessionId);
    if (!session || session.isExpired()) {
      if (session) {
        await Session.findByIdAndDelete(sessionId).catch(() => {});
      }
      throw ApiError.sessionExpired('Session has expired. Please verify OTP again.');
    }

    const gstToken = decrypt(session.gstTokenEnc);
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
