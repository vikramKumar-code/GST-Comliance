const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const userAuthController = require('../controllers/userAuth.controller');
const auth = require('../middleware/auth');
const { otpLimiter, otpVerifyLimiter } = require('../middleware/rateLimit');
const {
  validate,
  requestOtpSchema,
  verifyOtpSchema,
  evcOtpSchema,
  signupSchema,
  signinSchema,
  googleAuthSchema,
  switchWorkspaceSchema,
  linkGstinSchema,
  switchRoleSchema
} = require('../middleware/validate');

// Taxpayer GSTIN OTP Authentication (Existing)
router.post('/otp/request', validate(requestOtpSchema), otpLimiter, authController.requestOtp);
router.post('/otp/verify', validate(verifyOtpSchema), otpVerifyLimiter, authController.verifyOtp);
router.post('/token/refresh', auth, otpLimiter, authController.refreshToken);
router.post('/otp/evc', auth, validate(evcOtpSchema), otpLimiter, authController.requestEvcOtp);

// Standard User & OAuth 2.0 Authentication
router.post('/signup', validate(signupSchema), userAuthController.signup);
router.post('/register', validate(signupSchema), userAuthController.signup);
router.post('/signin', validate(signinSchema), userAuthController.signin);
router.post('/login', validate(signinSchema), userAuthController.signin);
router.post('/google', validate(googleAuthSchema), userAuthController.googleAuth);

// Authenticated User Context & Workspaces
router.get('/workspaces', auth, userAuthController.getWorkspaces);
router.post('/switch-workspace', auth, validate(switchWorkspaceSchema), userAuthController.switchWorkspace);
router.post('/workspace/link-gstin', auth, validate(linkGstinSchema), userAuthController.linkGstin);
router.post('/workspace/create', auth, userAuthController.createWorkspace);
router.post('/workspace/switch-role', auth, validate(switchRoleSchema), userAuthController.switchRole);

// Current Session Profile
router.get('/me', auth, userAuthController.getMe);

router.post('/logout', auth, authController.logout);


module.exports = router;
