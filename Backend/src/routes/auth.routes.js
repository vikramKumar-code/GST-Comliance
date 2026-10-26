const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const auth = require('../middleware/auth');
const { otpLimiter, otpVerifyLimiter } = require('../middleware/rateLimit');
const { validate, requestOtpSchema, verifyOtpSchema, evcOtpSchema } = require('../middleware/validate');

router.post('/otp/request', validate(requestOtpSchema), otpLimiter, authController.requestOtp);
router.post('/otp/verify', validate(verifyOtpSchema), otpVerifyLimiter, authController.verifyOtp);
router.post('/token/refresh', auth, otpLimiter, authController.refreshToken);
router.post('/otp/evc', auth, validate(evcOtpSchema), otpLimiter, authController.requestEvcOtp);
router.get('/me', auth, authController.getMe);
router.post('/logout', auth, authController.logout);

module.exports = router;
