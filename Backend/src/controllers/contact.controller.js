const mongoose = require('mongoose');
const ContactMessage = require('../models/ContactMessage');
const ApiError = require('../utils/apiError');
const { CONTACT_INTAKE_ENABLED } = require('../config/env');
const rateLimit = require('express-rate-limit');
const MongoRateLimitStore = require('../services/MongoRateLimitStore');

// ✅ FIX 2: Strict rate limiting to prevent spam
const contactRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many submissions. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: new MongoRateLimitStore('contact_form')
});
/**
 * Helper to sanitize string inputs (prevent XSS)
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.trim()
    .replace(/[<>]/g, '') // Remove potential script tags
    .slice(0, 5000); // Enforce max length
}

exports.submit = [
  // ✅ Apply rate limiter as middleware
  contactRateLimiter,

  async (req, res, next) => {
    try {
      if (!CONTACT_INTAKE_ENABLED) {
        return res.status(503).json({
          success: false,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Contact submissions are temporarily unavailable.'
        });
      }

      if (mongoose.connection.readyState !== 1) {
        throw ApiError.serverError('Database connection unavailable.');
      }

      // ✅ FIX 1: Whitelist only allowed fields (prevent mass assignment)
      const { name, email, subject, message } = req.body;

      // Explicit validation
      if (!name || typeof name !== 'string' || !name.trim()) {
        throw ApiError.validationError('Name is required.');
      }
      if (!email || typeof email !== 'string' || !email.trim()) {
        throw ApiError.validationError('Email is required.');
      }
      if (!subject || typeof subject !== 'string' || !subject.trim()) {
        throw ApiError.validationError('Subject is required.');
      }
      if (!message || typeof message !== 'string' || !message.trim()) {
        throw ApiError.validationError('Message is required.');
      }

      // ✅ FIX 3: Capture security metadata
      const ipAddress = req.ip || req.connection.remoteAddress || null;
      const userAgent = req.headers['user-agent'] || null;

      // Optional: Track if logged-in user submitted
      const userId = req.user?._id || null;
      const sourcePage = req.headers.referer || '/contact';

      // ✅ Sanitize and create with ONLY whitelisted fields
      const contactMessage = await ContactMessage.create({
        name: sanitizeString(name).slice(0, 120),
        email: email.trim().toLowerCase().slice(0, 254),
        subject: sanitizeString(subject).slice(0, 200),
        message: sanitizeString(message),
        ipAddress,
        userAgent,
        userId,
        sourcePage,
        status: 'NEW' // Default status
      });

      // Optional: Send email notification to admin here
      // await sendAdminNotification(contactMessage);

      res.status(201).json({
        success: true,
        message: 'Your message has been received. We will get back to you soon.',
        data: {
          id: contactMessage._id,
          createdAt: contactMessage.createdAt
        }
      });
    } catch (error) {
      next(error);
    }
  }
];

/**
 * Admin endpoint to list contact messages (protected route)
 */
exports.list = async (req, res, next) => {
  try {
    const { status = 'NEW', page = 1, limit = 20 } = req.query;

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Math.max(1, Number(limit)));
    const actualLimit = Math.min(100, Math.max(1, Number(limit)));

    const filter = {};
    if (status && status !== 'ALL') {
      filter.status = status;
    }

    const [messages, total] = await Promise.all([
      ContactMessage.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(actualLimit)
        .select('-ipAddress -userAgent') // Don't expose sensitive data in list
        .lean(),
      ContactMessage.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        page: Number(page),
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin endpoint to update message status (mark as read, spam, etc.)
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['NEW', 'READ', 'REPLIED', 'ARCHIVED', 'SPAM'].includes(status)) {
      throw ApiError.validationError('Invalid status value.');
    }

    const message = await ContactMessage.findByIdAndUpdate(
      id,
      {
        status,
        ...(status === 'REPLIED' ? { repliedAt: new Date(), repliedBy: req.user?._id } : {})
      },
      { new: true, runValidators: true }
    );

    if (!message) {
      throw ApiError.notFound('Contact message not found.');
    }

    res.status(200).json({
      success: true,
      data: message,
      message: 'Status updated successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// Export rate limiter for use in routes
exports.contactRateLimiter = contactRateLimiter;