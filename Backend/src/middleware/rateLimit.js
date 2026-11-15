const rateLimit = require('express-rate-limit');
const ApiError = require('../utils/apiError');
const MongoRateLimitStore = require('../services/mongoRateLimitStore');
const { isProduction } = require('../config/env');

const isDev = process.env.NODE_ENV === 'development';

/**
 * OTP Request rate limiter
 * Enforces ~5 requests per 10 minutes per IP in production/test
 */
const otpLimiter = rateLimit({
  store: new MongoRateLimitStore('otp-request'),
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: isDev ? 100 : 5, // Limit each IP to 5 requests per windowMs (100 in dev)
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skip: (req) => isDev,
  handler: (req, res, next) => {
    next(ApiError.rateLimited('Too many OTP attempts from this IP. Please try again after 10 minutes.'));
  }
});

const otpVerifyLimiter = rateLimit({
  store: new MongoRateLimitStore('otp-verify'),
  windowMs: 10 * 60 * 1000,
  max: isDev ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skip: (req) => isDev,
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
  validate: false,
  handler: (req, res, next) => {
    next(ApiError.rateLimited('Too many contact messages. Please try again later.'));
  }
});

const apiLimiter = rateLimit({
  store: new MongoRateLimitStore('api'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 2000 : 10000, // Generous limit for data-rich accounting SPA
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skip: (req) => !isProduction, // Do not rate limit local development and testing
  handler: (req, res, next) => {
    next(ApiError.rateLimited('Too many requests. Please try again later.'));
  }
});

/**
 * Authentication credential limiter
 * Limits login and registration attempts
 */
const authLimiter = rateLimit({
  store: new MongoRateLimitStore('auth-credentials'),
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 30 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skip: (req) => !isProduction,
  handler: (req, res, next) => {
    next(ApiError.rateLimited('Too many authentication attempts from this IP. Please try again after 15 minutes.'));
  }
});

module.exports = {
  otpLimiter,
  otpVerifyLimiter,
  apiLimiter,
  contactLimiter,
  authLimiter
};
