const FinaggService = require('../services/finagg.service');
const SessionService = require('../services/session.service');
const Consent = require('../models/Consent');
const OtpState = require('../models/OtpState');
const AuditLog = require('../models/AuditLog');
const Workspace = require('../models/Workspace');
const TenantService = require('../services/tenant.service');
const ApiError = require('../utils/apiError');
const { isProduction, SESSION_HOURS } = require('../config/env');

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

    // 2. Initialize / reset OtpState with 0 attempts and 10m TTL
    await OtpState.findOneAndUpdate(
      { gstin: normGstin, username: normUsername },
      {
        attempts: 0,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      },
      { upsert: true }
    );

    // 3. Dispatch OTP via provider
    const result = await FinaggService.requestOtp(normGstin, normUsername);

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
      }).catch(() => {});
    }
    next(error);
  }
};

exports.verifyOtp = async (req, res, next) => {
  try {
    const { gstin, username, otp } = req.body;
    const normGstin = gstin.trim().toUpperCase();
    const normUsername = username.trim();

    // 1. Check existing OtpState attempts limit (Max 3 attempts)
    const otpState = await OtpState.findOne({ gstin: normGstin, username: normUsername });
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
      await OtpState.findOneAndUpdate(
        { gstin: normGstin, username: normUsername },
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
    await OtpState.deleteOne({ gstin: normGstin, username: normUsername }).catch(() => {});

    // 4. Create encrypted session & sign JWT
    const { workspace, membership } = await TenantService.ensureMembership(normGstin, normUsername);
    await Promise.all([
      Consent.updateMany({ gstin: normGstin, workspaceId: null }, { $set: { workspaceId: workspace._id } }),
      AuditLog.updateMany({ gstin: normGstin, workspaceId: null }, { $set: { workspaceId: workspace._id } })
    ]).catch(() => {});
    const { token } = await SessionService.createSession(normGstin, normUsername, verifyResult.token, {
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
      }).catch(() => {});
    }

    res.status(200).json({
      success: true,
      ok: true
    });
  } catch (error) {
    next(error);
  }
};
