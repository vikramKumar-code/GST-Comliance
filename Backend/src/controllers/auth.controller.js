const FinaggService = require('../services/finagg.service');
const SessionService = require('../services/session.service');
const Consent = require('../models/Consent');
const OtpState = require('../models/OtpState');
const AuditLog = require('../models/AuditLog');
const Workspace = require('../models/Workspace');
const Session = require('../models/Session');
const jwt = require('jsonwebtoken');
const { encrypt } = require('../utils/crypto');

const TenantService = require('../services/tenant.service');
const ApiError = require('../utils/apiError');
const { isProduction, SESSION_HOURS, JWT_SECRET } = require('../config/env');

exports.requestOtp = async (req, res, next) => {
  let workspaceId = null;
  try {
    const { gstin, username, consent } = req.body;
    const normGstin = gstin.trim().toUpperCase();
    const normUsername = username.trim();

    if (!consent) {
      throw ApiError.validationError('Taxpayer consent is mandatory.');
    }

    const workspace = await Workspace.findOne({ gstin: normGstin });
    workspaceId = workspace?._id || null;

    // 1. Record mandatory taxpayer consent
    await Consent.create({
      workspaceId,
      gstin: normGstin,
      purpose: 'GST return fetch and compliance view',
      grantedAt: new Date(),
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Only track a verification attempt after the provider confirms OTP dispatch.
    const result = await FinaggService.requestOtp(normGstin, normUsername);

    // ✅ FIX 1: Added type: 'PORTAL_LOGIN' and lastSentAt
    await OtpState.findOneAndUpdate(
      { gstin: normGstin, username: normUsername, type: 'PORTAL_LOGIN' },
      {
        attempts: 0,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        lastSentAt: new Date()
      },
      { upsert: true }
    );

    // 4. Audit Log
    await AuditLog.create({
      workspaceId,
      gstin: normGstin,
      action: 'OTP_REQUEST',
      status: 'SUCCESS'
    });

    res.status(200).json({
      success: true,
      message: result?.message || 'OTP has been dispatched successfully to the registered mobile/email on GST portal.'
    });
  } catch (error) {
    if (req.body?.gstin) {
      await AuditLog.create({
        workspaceId,
        gstin: req.body.gstin.trim().toUpperCase(),
        action: 'OTP_REQUEST',
        status: 'FAILURE'
      }).catch(() => { });
    }
    next(error);
  }
};

exports.verifyOtp = async (req, res, next) => {
  try {
    const { gstin, username, otp } = req.body;
    const normGstin = gstin.trim().toUpperCase();
    const normUsername = username.trim();

    // ✅ FIX 1: Added type: 'PORTAL_LOGIN' to query
    const otpState = await OtpState.findOne({ gstin: normGstin, username: normUsername, type: 'PORTAL_LOGIN' });
    if (otpState && !otpState.isExpired() && otpState.attempts >= 3) {
      await AuditLog.create({
        gstin: normGstin,
        action: 'OTP_VERIFY',
        status: 'FAILURE'
      });
      throw ApiError.otpInvalid('Maximum verification attempts exceeded. Please request a new OTP.');
    }

    // 2. Verify with provider
    let verifyResult;
    try {
      verifyResult = await FinaggService.verifyOtp(normGstin, normUsername, otp.trim());
    } catch (providerErr) {
      // Record failed attempt
      // ✅ FIX 1: Added type: 'PORTAL_LOGIN'
      await OtpState.findOneAndUpdate(
        { gstin: normGstin, username: normUsername, type: 'PORTAL_LOGIN' },
        {
          $inc: { attempts: 1 },
          $setOnInsert: { expiresAt: new Date(Date.now() + 10 * 60 * 1000) }
        },
        { upsert: true }
      );

      await AuditLog.create({
        gstin: normGstin,
        action: 'OTP_VERIFY',
        status: 'FAILURE'
      });

      throw providerErr;
    }

    // 3. Success: clean up OtpState
    // ✅ FIX 1: Added type: 'PORTAL_LOGIN'
    await OtpState.deleteOne({ gstin: normGstin, username: normUsername, type: 'PORTAL_LOGIN' }).catch(() => { });

    // 3a. Check if authenticated user (CA/Accountant) is connecting a client's GST portal
    const existingToken = req.cookies?.sid || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    let existingSession = null;
    if (existingToken) {
      try {
        const decoded = jwt.verify(existingToken, JWT_SECRET);
        existingSession = await Session.findById(decoded.sessionId);
      } catch {
        existingSession = null;
      }
    }

    if (existingSession && existingSession.userId) {
      const gstTokenEnc = encrypt(verifyResult.token);
      existingSession.gstin = normGstin;
      existingSession.username = normUsername;
      existingSession.gstTokenEnc = gstTokenEnc;
      await existingSession.save();

      if (existingSession.workspaceId) {
        let updateDoc = {
          gstin: normGstin,
          gstPortalSession: {
            username: normUsername,
            gstTokenEnc,
            expiresAt: new Date(Date.now() + SESSION_HOURS * 3600 * 1000)
          }
        };
        try {
          const tp = await FinaggService.searchGstin(normGstin);
          const autoName = tp?.tradeName || tp?.legalName;
          if (autoName && autoName !== 'Demo Traders' && autoName !== 'Demo Traders Pvt Ltd') {
            updateDoc.name = autoName;
            if (tp?.tradeName) updateDoc.tradeName = tp.tradeName;
          }
        } catch { }

        await Workspace.findByIdAndUpdate(existingSession.workspaceId, {
          $set: updateDoc
        });
      }

      await AuditLog.create({
        workspaceId: existingSession.workspaceId,
        memberId: existingSession.memberId,
        gstin: normGstin,
        action: 'OTP_VERIFY_CLIENT_LINK',
        status: 'SUCCESS'
      }).catch(() => { });

      return res.status(200).json({
        success: true,
        gstin: normGstin,
        message: `GST Portal session for ${normGstin} successfully connected.`
      });
    }

    // 4. Create encrypted session & sign JWT
    const { workspace, user, membership } = await TenantService.ensureMembership(normGstin, normUsername);
    await Promise.all([
      Consent.updateMany({ gstin: normGstin, workspaceId: null }, { $set: { workspaceId: workspace._id } }),
      AuditLog.updateMany({ gstin: normGstin, workspaceId: null }, { $set: { workspaceId: workspace._id } })
    ]).catch(() => { });
    const { token } = await SessionService.createSession(normGstin, normUsername, verifyResult.token, {
      userId: user?._id || null,
      workspaceId: workspace._id,
      memberId: membership._id
    });


    // 5. Set httpOnly cookie 'sid'
    res.cookie('sid', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: SESSION_HOURS * 3600 * 1000
    });

    await AuditLog.create({
      workspaceId: workspace._id,
      memberId: membership._id,
      gstin: normGstin,
      action: 'OTP_VERIFY',
      status: 'SUCCESS'
    });

    res.status(200).json({
      success: true,
      gstin: normGstin
    });
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      gstin: req.session.gstin,
      expiresAt: req.session.expiresAt
    });
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    if (req.session?._id) {
      await SessionService.destroySession(req.session._id);
    }

    res.clearCookie('sid', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax'
    });

    if (req.gstin) {
      await AuditLog.create({
        workspaceId: req.workspaceId,
        memberId: req.membership?._id || null,
        gstin: req.gstin,
        action: 'LOGOUT',
        status: 'SUCCESS'
      }).catch(() => { });
    }

    res.status(200).json({
      success: true,
      ok: true
    });
  } catch (error) {
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    if (!req.session?._id || !req.gstToken) {
      throw ApiError.sessionExpired('Authentication required. Please verify OTP again.');
    }
    const normGstin = req.gstin;
    const normUsername = req.username;

    const result = await FinaggService.refreshToken(normGstin, normUsername, req.gstToken);

    await SessionService.updateSessionToken(req.session._id, result.token);

    await AuditLog.create({
      workspaceId: req.workspaceId,
      memberId: req.membership?._id || null,
      gstin: normGstin,
      action: 'TOKEN_REFRESH',
      status: 'SUCCESS'
    }).catch(() => { });

    res.status(200).json({
      success: true,
      message: 'GST session token refreshed successfully.'
    });
  } catch (error) {
    if (req.gstin) {
      await AuditLog.create({
        workspaceId: req.workspaceId,
        memberId: req.membership?._id || null,
        gstin: req.gstin,
        action: 'TOKEN_REFRESH',
        status: 'FAILURE'
      }).catch(() => { });
    }
    next(error);
  }
};

exports.requestEvcOtp = async (req, res, next) => {
  try {
    if (!req.session?._id) {
      throw ApiError.sessionExpired('Authentication required. Please verify OTP again.');
    }
    const { pan, form_type, period, username: bodyUsername, gstin: bodyGstin } = req.body;
    let normGstin = bodyGstin || req.gstin;
    if (!normGstin && req.workspaceId) {
      const ws = await Workspace.findById(req.workspaceId).lean();
      if (ws?.gstin) normGstin = ws.gstin;
    }
    if (!normGstin) normGstin = process.env.TEST_GSTIN || '29AABCU9603R1ZM';
    const normUsername = bodyUsername || req.username || req.workspace?.gstPortalSession?.username || req.session?.username || req.user?.email?.split('@')[0] || 'taxpayer_user';

    const isLiveTaxPro = FinaggService.getProviderName() === 'taxpro';
    if (isLiveTaxPro && !req.gstToken) {
      throw ApiError.sessionExpired('Active GST Portal session is required to request EVC OTP. Please verify OTP on GST Return Hub first.');
    }
    const token = req.gstToken || (!isProduction ? 'DEMO_GST_AUTH_TOKEN' : null);

    if (!token) {
      throw ApiError.sessionExpired('Authentication required. Please verify OTP again.');
    }

    // ✅ FIX 2: EVC OTP Rate Limiting & Cooldown Check
    const evcState = await OtpState.findOne({ gstin: normGstin, username: normUsername, type: 'EVC_FILING' });
    if (evcState && !evcState.isExpired()) {
      if (evcState.lastSentAt && (Date.now() - evcState.lastSentAt.getTime()) < 30000) {
        throw ApiError.rateLimited('Please wait 30 seconds before requesting a new EVC OTP.');
      }
    }

    const result = await FinaggService.requestEvcOtp(normGstin, normUsername, pan, form_type, token, period);

    if (result?.token && result.token !== req.gstToken && req.session?._id) {
      await SessionService.updateSessionToken(req.session._id, result.token);
    }

    // ✅ FIX 3: Update OtpState for EVC (Track cooldown)
    await OtpState.findOneAndUpdate(
      { gstin: normGstin, username: normUsername, type: 'EVC_FILING' },
      {
        lastSentAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0 // Reset attempts on new request
      },
      { upsert: true }
    );

    await AuditLog.create({
      workspaceId: req.workspaceId,
      memberId: req.membership?._id || null,
      gstin: normGstin,
      action: 'EVC_OTP_REQUEST',
      status: 'SUCCESS'
    }).catch(() => { });

    res.status(200).json({
      success: true,
      message: result?.message || 'EVC OTP has been dispatched successfully to the registered mobile/email on GST portal.'
    });
  } catch (error) {
    if (req.gstin || req.workspaceId) {
      await AuditLog.create({
        workspaceId: req.workspaceId,
        memberId: req.membership?._id || null,
        gstin: req.gstin || null,
        action: 'EVC_OTP_REQUEST',
        status: 'FAILURE'
      }).catch(() => { });
    }
    next(error);
  }
};