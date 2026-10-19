const rateLimit = require('express-rate-limit');
const ApiError = require('../utils/apiError');

/**
 * OTP Request rate limiter
 * Enforces ~5 requests per 10 minutes per IP
 */
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.rateLimited('Too many OTP attempts from this IP. Please try again after 10 minutes.'));
  }
});

/**
 * General API rate limiter
 * Enforces 100 requests per 15 minutes per IP
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.rateLimited('Too many requests. Please try again later.'));
  }
});

module.exports = {
  otpLimiter,
  apiLimiter
};
