const rateLimit = require('express-rate-limit');
const ApiError = require('../utils/apiError');
const MongoRateLimitStore = require('../services/mongoRateLimitStore');

/**
 * OTP Request rate limiter
 * Enforces ~5 requests per 10 minutes per IP
 */
const otpLimiter = rateLimit({
  store: new MongoRateLimitStore('otp-request'),
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.rateLimited('Too many OTP attempts from this IP. Please try again after 10 minutes.'));
  }
});

const otpVerifyLimiter = rateLimit({
  store: new MongoRateLimitStore('otp-verify'),
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.rateLimited('Too many OTP verification attempts. Please try again later.'));
  }
});

/**
 * General API rate limiter
 * Enforces 100 requests per 15 minutes per IP
 */
const contactLimiter = rateLimit({
  store: new MongoRateLimitStore('contact'),
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(ApiError.rateLimited('Too many contact messages. Please try again later.'));
  }
});

const apiLimiter = rateLimit({
  store: new MongoRateLimitStore('api'),
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
  otpVerifyLimiter,
  apiLimiter,
  contactLimiter
};
