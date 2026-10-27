const Joi = require('joi');
const ApiError = require('../utils/apiError');
const { GSTIN_REGEX, OTP_REGEX, isValidPeriod } = require('../utils/gstin');

// Custom Joi validator for non-future MMYYYY period
const periodValidator = (value, helpers) => {
  if (!isValidPeriod(value)) {
    return helpers.error('period.invalid');
  }
  return value;
};

// 1. GSTIN Search Schema
const searchGstinSchema = Joi.object({
  gstin: Joi.string()
    .trim()
    .uppercase()
    .pattern(GSTIN_REGEX)
    .required()
    .messages({
      'string.pattern.base': 'Invalid GSTIN format. Must be 15 alphanumeric characters.',
      'string.empty': 'GSTIN is required.',
      'any.required': 'GSTIN is required.'
    })
});

// 2. OTP Request Schema
const requestOtpSchema = Joi.object({
  gstin: Joi.string()
    .trim()
    .uppercase()
    .pattern(GSTIN_REGEX)
    .required()
    .messages({
      'string.pattern.base': 'Invalid GSTIN format.',
      'any.required': 'GSTIN is required.'
    }),
  username: Joi.string()
    .trim()
    .min(1)
    .required()
    .messages({
      'string.empty': 'Username is required.',
      'any.required': 'Username is required.'
    }),
  consent: Joi.boolean()
    .valid(true)
    .required()
    .messages({
      'any.only': 'Taxpayer consent is mandatory to request OTP.',
      'any.required': 'Taxpayer consent is mandatory.'
    })
});

// 3. OTP Verify Schema
const verifyOtpSchema = Joi.object({
  gstin: Joi.string()
    .trim()
    .uppercase()
    .pattern(GSTIN_REGEX)
    .required()
    .messages({
      'string.pattern.base': 'Invalid GSTIN format.',
      'any.required': 'GSTIN is required.'
    }),
  username: Joi.string()
    .trim()
    .min(1)
    .required()
    .messages({
      'string.empty': 'Username is required.',
      'any.required': 'Username is required.'
    }),
  otp: Joi.string()
    .trim()
    .pattern(OTP_REGEX)
    .required()
    .messages({
      'string.pattern.base': 'OTP must be 4 to 8 digits.',
      'any.required': 'OTP is required.'
    })
});

// 4. EVC OTP Schema
const evcOtpSchema = Joi.object({
  pan: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .required()
    .messages({
      'string.pattern.base': 'Invalid PAN format. Must be 10 characters (e.g. ABCDE1234F).',
      'any.required': 'PAN is required for EVC OTP.'
    }),
  form_type: Joi.string()
    .trim()
    .min(1)
    .max(10)
    .required()
    .messages({
      'string.empty': 'form_type is required.',
      'any.required': 'form_type is required.'
    })
});

// 5. Period Query Schema for returns & dashboard
const periodQuerySchema = Joi.object({
  period: Joi.string()
    .trim()
    .custom(periodValidator, 'Period validation')
    .required()
    .messages({
      'period.invalid': 'Invalid period. Must be MMYYYY, month 01-12, and cannot be in the future.',
      'any.required': 'Tax period (MMYYYY) is required.'
    })
});

// 6. Contact Schema
const contactSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  email: Joi.string().trim().email().max(254).required(),
  subject: Joi.string().trim().min(1).max(200).required(),
  message: Joi.string().trim().min(1).max(5000).required()
});

// 7. User Signup Schema
const signupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'Name is required.',
    'any.required': 'Name is required.'
  }),
  email: Joi.string().trim().lowercase().email().max(254).required().messages({
    'string.email': 'Invalid email address.',
    'string.empty': 'Email is required.',
    'any.required': 'Email is required.'
  }),
  password: Joi.string().min(8).max(128).required().messages({
    'string.min': 'Password must be at least 8 characters long.',
    'string.empty': 'Password is required.',
    'any.required': 'Password is required.'
  })
});

// 8. User Signin Schema
const signinSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required().messages({
    'string.email': 'Invalid email address.',
    'string.empty': 'Email is required.',
    'any.required': 'Email is required.'
  }),
  password: Joi.string().required().messages({
    'string.empty': 'Password is required.',
    'any.required': 'Password is required.'
  })
});

// 9. Google OAuth Schema
const googleAuthSchema = Joi.object({
  idToken: Joi.string().trim().required().messages({
    'string.empty': 'Google ID token is required.',
    'any.required': 'Google ID token is required.'
  })
});

// 10. Switch Workspace Schema
const switchWorkspaceSchema = Joi.object({
  workspaceId: Joi.string().trim().required().messages({
    'string.empty': 'Workspace ID is required.',
    'any.required': 'Workspace ID is required.'
  })
});

/**
 * Generic Joi validation middleware generator
 * @param {Joi.ObjectSchema} schema - The Joi schema to validate against
 * @param {'body'|'query'|'params'} property - Request property to inspect
 */
const validate = (schema, property = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[property], {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const errorDetails = error.details.map((d) => d.message).join('; ');
    const isGstinError = error.details.some((d) => d.path.includes('gstin'));

    if (isGstinError) {
      return next(ApiError.invalidGstin(errorDetails));
    }
    return next(ApiError.validationError(errorDetails));
  }

  req[property] = value;
  next();
};

module.exports = {
  validate,
  searchGstinSchema,
  requestOtpSchema,
  verifyOtpSchema,
  evcOtpSchema,
  periodQuerySchema,
  contactSchema,
  signupSchema,
  signinSchema,
  googleAuthSchema,
  switchWorkspaceSchema
};
