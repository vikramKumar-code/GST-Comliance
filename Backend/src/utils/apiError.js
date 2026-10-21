class ApiError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }

  static invalidGstin(message = 'Invalid GSTIN format or not found') {
    return new ApiError('INVALID_GSTIN', message, 400);
  }

  static validationError(message = 'Invalid request parameters') {
    return new ApiError('VALIDATION_ERROR', message, 400);
  }

  static otpInvalid(message = 'Wrong or expired OTP') {
    return new ApiError('OTP_INVALID', message, 400);
  }

  static sessionExpired(message = 'Please verify OTP again') {
    return new ApiError('SESSION_EXPIRED', message, 401);
  }

  static rateLimited(message = 'Too many requests, please try again later') {
    return new ApiError('RATE_LIMITED', message, 429);
  }

  static providerAuth(message = 'Failed to authenticate with GST provider') {
    return new ApiError('PROVIDER_AUTH', message, 502);
  }

  static providerDown(message = 'GST system or provider temporarily unavailable') {
    return new ApiError('PROVIDER_DOWN', message, 503);
  }

  static providerError(message = 'Could not complete the request. Please try again.', statusCode = 502) {
    return new ApiError('PROVIDER_ERROR', message, statusCode);
  }

  static dataNotAvailable(message = 'Data for this period is not available yet. Try another month.') {
    return new ApiError('DATA_NOT_AVAILABLE', message, 404);
  }

  static serverError(message = 'Internal server error') {
    return new ApiError('SERVER_ERROR', message, 500);
  }
}

module.exports = ApiError;
