const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const auth = require('../middleware/auth');
const { otpLimiter, otpVerifyLimiter } = require('../middleware/rateLimit');
const { validate, requestOtpSchema, verifyOtpSchema } = require('../middleware/validate');

router.post('/otp/request', validate(requestOtpSchema), otpLimiter, authController.requestOtp);
router.post('/otp/verify', validate(verifyOtpSchema), otpVerifyLimiter, authController.verifyOtp);
router.get('/me', auth, authController.getMe);
router.post('/logout', auth, authController.logout);

module.exports = router;
