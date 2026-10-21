const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { isProduction } = require('../config/env');

/**
 * Centralized Express Error Handling Middleware
 * Guarantees error responses match the project contract:
 * { "success": false, "code": "CODE_NAME", "message": "Reason" }
 */
const errorHandler = (err, req, res, next) => {
  // 1. Handled Operational Errors (ApiError)
  if (err instanceof ApiError) {
    logger.warn(`ApiError [${err.code}] (${err.statusCode}): ${err.message}`);

    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message
    });
  }

  // 2. Body-parser syntax errors (Malformed JSON)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Invalid JSON payload provided.'
    });
  }

  // 3. Unhandled Server Errors (Status 500)
  // Per Section 11 & TAXPRO_ADDENDUM: Errors with status 500 return a generic message; internal details and URLs are not logged.
  logger.error(`Unhandled Server Error: ${err.message}`);

  return res.status(500).json({
    success: false,
    code: 'SERVER_ERROR',
    message: 'An unexpected internal server error occurred. Please try again later.'
  });
};

module.exports = errorHandler;
