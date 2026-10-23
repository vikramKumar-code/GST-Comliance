const mongoose = require('mongoose');
const ContactMessage = require('../models/ContactMessage');
const ApiError = require('../utils/apiError');
const { CONTACT_INTAKE_ENABLED } = require('../config/env');

exports.submit = async (req, res, next) => {
  try {
    if (!CONTACT_INTAKE_ENABLED) {
      return res.status(503).json({
        success: false,
        code: 'SERVER_ERROR',
        message: 'Contact submissions are temporarily unavailable.'
      });
    }

    if (mongoose.connection.readyState !== 1) {
      throw ApiError.serverError();
    }

    await ContactMessage.create(req.body);
    res.status(201).json({ success: true, message: 'Your message has been received.' });
  } catch (error) {
    next(error);
  }
};
