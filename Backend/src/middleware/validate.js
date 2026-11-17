'use strict';

const Joi = require('joi');
const ApiError = require('../utils/apiError');
const gstinUtils = require('../utils/gstin');

const {
  GSTIN_REGEX,
  OTP_REGEX,
  isValidPeriod
} = gstinUtils;

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EVC_OTP_REGEX = /^[A-Za-z0-9]{4,8}$/;
const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9:_-]{8,128}$/;

const DEFAULT_GSTIN_REGEX =
  /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}[Zz1-9A-Ja-j]{1}[0-9A-Za-z]{1}$/;

const DEFAULT_OTP_REGEX = /^[0-9]{4,8}$/;

const MAX_EXCLUDED_IDS =
  Number(process.env.GST_MAX_EXCLUDED_INVOICE_IDS) || 5000;

const TZ_OFFSET_MS =
  Number(process.env.GST_TZ_OFFSET_MIN || 330) * 60 * 1000;

/**
 * By default, only schemas explicitly marked .meta({ strict: true }) reject unknown body keys.
 * Set GST_VALIDATE_STRICT_BODY=true if you want all POST bodies to be strict.
 */
const DEFAULT_STRICT_BODY =
  String(process.env.GST_VALIDATE_STRICT_BODY || 'false').toLowerCase() === 'true';

const EVC_FORM_TYPES = [
  'R1',
  'GSTR1',
  'GSTR-1',
  'R3B',
  'GSTR3B',
  'GSTR-3B'
];

const NIL_RETURN_TYPES = ['GSTR1', 'GSTR3B'];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toRegExp(value, fallback) {
  if (value instanceof RegExp) return value;

  if (typeof value === 'string') {
    try {
      return new RegExp(value);
    } catch (_) {
      return fallback;
    }
  }

  return fallback;
}

const GSTIN_PATTERN = toRegExp(GSTIN_REGEX, DEFAULT_GSTIN_REGEX);
const OTP_PATTERN = toRegExp(OTP_REGEX, DEFAULT_OTP_REGEX);

/* -------------------------------------------------------------------------- */
/* Period helpers                                                             */
/* -------------------------------------------------------------------------- */

function currentIstPeriod() {
  const d = new Date(Date.now() + TZ_OFFSET_MS);
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${month}${year}`;
}

function isFuturePeriod(value) {
  const period = String(value || '').trim();

  if (!PERIOD_REGEX.test(period)) return false;

  const month = Number(period.slice(0, 2));
  const year = Number(period.slice(2));

  const current = currentIstPeriod();
  const currentMonth = Number(current.slice(0, 2));
  const currentYear = Number(current.slice(2));

  if (year > currentYear) return true;
  if (year === currentYear && month > currentMonth) return true;

  return false;
}

function validatePeriodValue(value, helpers, { required }) {
  const period = String(value ?? '').trim();

  if (!period) {
    return required
      ? helpers.error('period.required')
      : undefined;
  }

  if (!PERIOD_REGEX.test(period)) {
    return helpers.error('period.invalid');
  }

  if (typeof isValidPeriod === 'function' && !isValidPeriod(period)) {
    return helpers.error('period.invalid');
  }

  if (isFuturePeriod(period)) {
    return helpers.error('period.future');
  }

  return period;
}

/* -------------------------------------------------------------------------- */
/* Reusable field schemas                                                     */
/* -------------------------------------------------------------------------- */

const optionalPeriodField = Joi.string()
  .trim()
  .custom((value, helpers) => validatePeriodValue(value, helpers, { required: false }), 'optionalPeriod')
  .optional()
  .messages({
    'period.invalid': 'Invalid period. Must be MMYYYY with month 01-12 and year 19xx/20xx.',
    'period.future': 'Return period cannot be in the future.'
  });

const requiredPeriodField = Joi.string()
  .trim()
  .custom((value, helpers) => validatePeriodValue(value, helpers, { required: true }), 'requiredPeriod')
  .required()
  .messages({
    'period.required': 'Tax period (MMYYYY) is required.',
    'period.invalid': 'Invalid period. Must be MMYYYY with month 01-12 and year 19xx/20xx.',
    'period.future': 'Return period cannot be in the future.'
  });

const gstinField = Joi.string()
  .trim()
  .uppercase()
  .custom((value, helpers) => {
    const gstin = String(value ?? '').trim();

    if (!gstin) return undefined;

    if (!GSTIN_PATTERN.test(gstin)) {
      return helpers.error('gstin.invalid');
    }

    return gstin;
  }, 'optionalGstin')
  .optional()
  .messages({
    'gstin.invalid': 'Invalid GSTIN format. Must be 15 alphanumeric characters.'
  });

const requiredGstinField = Joi.string()
  .trim()
  .uppercase()
  .pattern(GSTIN_PATTERN)
  .required()
  .messages({
    'string.pattern.base': 'Invalid GSTIN format. Must be 15 alphanumeric characters.',
    'string.empty': 'GSTIN is required.',
    'any.required': 'GSTIN is required.'
  });

const usernameField = Joi.string()
  .trim()
  .max(100)
  .custom((value) => {
    const username = String(value ?? '').trim();
    return username || undefined;
  }, 'optionalUsername')
  .optional();

const panField = Joi.string()
  .trim()
  .uppercase()
  .pattern(PAN_REGEX)
  .required()
  .messages({
    'string.pattern.base': 'Invalid PAN format. Must be 10 characters (e.g. ABCDE1234F).',
    'string.empty': 'PAN is required.',
    'any.required': 'PAN is required.'
  });

const evcOtpField = Joi.string()
  .trim()
  .pattern(EVC_OTP_REGEX)
  .required()
  .messages({
    'string.pattern.base': 'Invalid EVC OTP format. Must be 4 to 8 letters or digits.',
    'string.empty': 'EVC OTP is required.',
    'any.required': 'EVC OTP is required.'
  });

const idempotencyKeyField = Joi.any()
  .custom((value, helpers) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const key = String(value).trim();

    if (!IDEMPOTENCY_KEY_REGEX.test(key)) {
      return helpers.error('idempotencyKey.invalid');
    }

    return key;
  }, 'idempotencyKey')
  .optional()
  .messages({
    'idempotencyKey.invalid':
      'Invalid idempotency key. Must be 8-128 chars using letters, digits, colon, underscore or hyphen.'
  });

const excludedInvoiceIdsField = Joi.any()
  .custom((value, helpers) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    let raw;

    if (Array.isArray(value)) {
      raw = value;
    } else if (typeof value === 'string') {
      raw = value.split(',');
    } else {
      return helpers.error('excludedInvoiceIds.type');
    }

    const ids = raw
      .map((x) => String(x ?? '').trim())
      .filter(Boolean);

    if (ids.length > MAX_EXCLUDED_IDS) {
      return helpers.error('excludedInvoiceIds.max');
    }

    for (const id of ids) {
      if (!OBJECT_ID_REGEX.test(id)) {
        return helpers.error('excludedInvoiceIds.item');
      }
    }

    return ids;
  }, 'excludedInvoiceIds')
  .optional()
  .messages({
    'excludedInvoiceIds.type':
      'excludedInvoiceIds must be an array or comma-separated string of ObjectIds.',
    'excludedInvoiceIds.max':
      `excludedInvoiceIds cannot contain more than ${MAX_EXCLUDED_IDS} entries.`,
    'excludedInvoiceIds.item':
      'excludedInvoiceIds must contain valid MongoDB ObjectId strings (24 hex characters).'
  });

const offsetPayloadField = Joi.any()
  .custom((value, helpers) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (!isPlainObject(value)) {
      return helpers.error('offsetPayload.type');
    }

    const allowed = new Set(['pdcash', 'pditc', 'pdnls']);

    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        return helpers.error('offsetPayload.unknown', { key });
      }
    }

    if (value.pdcash !== undefined) {
      if (!Array.isArray(value.pdcash) || value.pdcash.length === 0) {
        return helpers.error('offsetPayload.pdcash');
      }
    }

    if (value.pdnls !== undefined) {
      if (!Array.isArray(value.pdnls) || value.pdnls.length === 0) {
        return helpers.error('offsetPayload.pdnls');
      }
    }

    if (value.pditc !== undefined) {
      if (!isPlainObject(value.pditc) || Object.keys(value.pditc).length === 0) {
        return helpers.error('offsetPayload.pditc');
      }
    }

    const hasAnyPayload =
      value.pdcash !== undefined ||
      value.pditc !== undefined ||
      value.pdnls !== undefined;

    if (!hasAnyPayload) {
      return helpers.error('offsetPayload.empty');
    }

    return value;
  }, 'offsetPayload')
  .optional()
  .messages({
    'offsetPayload.type': 'offsetPayload must be a JSON object.',
    'offsetPayload.unknown': 'offsetPayload contains unsupported field "{{#key}}".',
    'offsetPayload.pdcash': 'offsetPayload.pdcash must be a non-empty array when present.',
    'offsetPayload.pdnls': 'offsetPayload.pdnls must be a non-empty array when present.',
    'offsetPayload.pditc': 'offsetPayload.pditc must be a non-empty object when present.',
    'offsetPayload.empty': 'offsetPayload must contain at least one of pdcash, pditc, or pdnls.'
  });

/* -------------------------------------------------------------------------- */
/* 1. GSTIN Search Schema                                                     */
/* -------------------------------------------------------------------------- */

const searchGstinSchema = Joi.object({
  gstin: requiredGstinField
});

/* -------------------------------------------------------------------------- */
/* 2. OTP Request Schema                                                      */
/* -------------------------------------------------------------------------- */

const requestOtpSchema = Joi.object({
  gstin: requiredGstinField,
  username: Joi.string()
    .trim()
    .min(1)
    .max(100)
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

/* -------------------------------------------------------------------------- */
/* 3. OTP Verify Schema                                                       */
/* -------------------------------------------------------------------------- */

const verifyOtpSchema = Joi.object({
  gstin: requiredGstinField,
  username: Joi.string()
    .trim()
    .min(1)
    .max(100)
    .required()
    .messages({
      'string.empty': 'Username is required.',
      'any.required': 'Username is required.'
    }),
  otp: Joi.string()
    .trim()
    .pattern(OTP_PATTERN)
    .required()
    .messages({
      'string.pattern.base': 'OTP must be 4 to 8 digits.',
      'string.empty': 'OTP is required.',
      'any.required': 'OTP is required.'
    })
});

/* -------------------------------------------------------------------------- */
/* 4. EVC OTP Schema                                                          */
/* -------------------------------------------------------------------------- */

const evcOtpSchema = Joi.object({
  gstin: gstinField,
  username: usernameField,
  pan: panField,
  form_type: Joi.string()
    .trim()
    .uppercase()
    .valid(...EVC_FORM_TYPES)
    .required()
    .messages({
      'any.only': `form_type must be one of: ${EVC_FORM_TYPES.join(', ')}.`,
      'any.required': 'form_type is required.'
    }),
  period: requiredPeriodField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 5. Period Query/Body Schemas                                               */
/* -------------------------------------------------------------------------- */

/**
 * Optional period query schema.
 * Use for endpoints where period may be omitted, e.g. /returns/summary.
 */
const periodQuerySchema = Joi.object({
  period: optionalPeriodField
});

/**
 * Required period query schema.
 * Use for endpoints where period is mandatory, e.g. /returns/gstr1, /returns/gstr3b.
 */
const requiredPeriodQuerySchema = Joi.object({
  period: requiredPeriodField
});

/**
 * Required period body schema.
 */
const periodBodySchema = Joi.object({
  period: requiredPeriodField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 6. Contact Schema                                                          */
/* -------------------------------------------------------------------------- */

const contactSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  email: Joi.string().trim().email().max(254).required(),
  subject: Joi.string().trim().min(1).max(200).required(),
  message: Joi.string().trim().min(1).max(5000).required()
});

/* -------------------------------------------------------------------------- */
/* 7. User Signup Schema                                                      */
/* -------------------------------------------------------------------------- */

const signupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'Name is required.',
    'any.required': 'Name is required.'
  }),
  email: Joi.string()
    .trim()
    .lowercase()
    .email()
    .max(254)
    .required()
    .messages({
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

/* -------------------------------------------------------------------------- */
/* 8. User Signin Schema                                                      */
/* -------------------------------------------------------------------------- */

const signinSchema = Joi.object({
  email: Joi.string()
    .trim()
    .lowercase()
    .email()
    .required()
    .messages({
      'string.email': 'Invalid email address.',
      'string.empty': 'Email is required.',
      'any.required': 'Email is required.'
    }),
  password: Joi.string().required().messages({
    'string.empty': 'Password is required.',
    'any.required': 'Password is required.'
  })
});

/* -------------------------------------------------------------------------- */
/* 9. Google OAuth Schema                                                     */
/* -------------------------------------------------------------------------- */

const googleAuthSchema = Joi.object({
  idToken: Joi.string().trim().required().messages({
    'string.empty': 'Google ID token is required.',
    'any.required': 'Google ID token is required.'
  })
});

/* -------------------------------------------------------------------------- */
/* 10. Switch Workspace Schema                                                */
/* -------------------------------------------------------------------------- */

const switchWorkspaceSchema = Joi.object({
  workspaceId: Joi.string().trim().required().messages({
    'string.empty': 'Workspace ID is required.',
    'any.required': 'Workspace ID is required.'
  })
});

/* -------------------------------------------------------------------------- */
/* 11. Link GSTIN to Workspace Schema                                         */
/* -------------------------------------------------------------------------- */

const linkGstinSchema = Joi.object({
  gstin: requiredGstinField,
  name: Joi.string().trim().max(100).optional().allow('')
});

/* -------------------------------------------------------------------------- */
/* 12. Switch Member Role Schema                                              */
/* -------------------------------------------------------------------------- */

const switchRoleSchema = Joi.object({
  role: Joi.string()
    .valid('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')
    .required()
    .messages({
      'any.only': 'Role must be OWNER, ADMIN, MEMBER, or VIEWER.',
      'any.required': 'Role is required.'
    })
});

/* -------------------------------------------------------------------------- */
/* 13. GSTR-1 Local Prepare Schema                                            */
/* -------------------------------------------------------------------------- */

const prepareGstr1BodySchema = Joi.object({
  period: requiredPeriodField,
  excludedInvoiceIds: excludedInvoiceIdsField,
  idempotencyKey: idempotencyKeyField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 14. GSTR-3B Local Prepare Schema                                           */
/* -------------------------------------------------------------------------- */

const prepareGstr3bBodySchema = Joi.object({
  period: requiredPeriodField,
  idempotencyKey: idempotencyKeyField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 15. GSTR-1 Save Schema                                                     */
/* -------------------------------------------------------------------------- */

const saveGstr1BodySchema = Joi.object({
  period: requiredPeriodField,
  excludedInvoiceIds: excludedInvoiceIdsField,
  username: usernameField,
  idempotencyKey: idempotencyKeyField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 16. GSTR-3B Save Schema                                                    */
/* -------------------------------------------------------------------------- */

const saveGstr3bBodySchema = Joi.object({
  period: requiredPeriodField,
  username: usernameField,
  idempotencyKey: idempotencyKeyField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 17. GSTR-3B Offset Schema                                                  */
/* -------------------------------------------------------------------------- */

const offsetGstr3bBodySchema = Joi.object({
  period: requiredPeriodField,
  offsetPayload: offsetPayloadField,
  username: usernameField,
  idempotencyKey: idempotencyKeyField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 18. Generate Summary Schema                                                */
/* -------------------------------------------------------------------------- */

const generateSummaryBodySchema = Joi.object({
  period: requiredPeriodField,
  excludedInvoiceIds: excludedInvoiceIdsField,
  isNil: Joi.boolean().optional(),
  returnType: Joi.string()
    .trim()
    .uppercase()
    .valid('GSTR1')
    .optional()
    .default('GSTR1'),
  username: usernameField,
  idempotencyKey: idempotencyKeyField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 19. GSTR-1 Prepare Filing Schema                                           */
/* -------------------------------------------------------------------------- */

const prepareGstr1FilingBodySchema = Joi.object({
  period: requiredPeriodField,
  excludedInvoiceIds: excludedInvoiceIdsField,
  idempotencyKey: idempotencyKeyField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 20. GSTR-3B Prepare Filing Schema                                          */
/* -------------------------------------------------------------------------- */

const prepareGstr3bFilingBodySchema = Joi.object({
  period: requiredPeriodField,
  idempotencyKey: idempotencyKeyField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 21. Regular Return Filing Body Schema                                      */
/* -------------------------------------------------------------------------- */

/**
 * Used by:
 * - POST /api/returns/gstr1/file-evc
 * - POST /api/returns/gstr3b/file-evc
 *
 * Strict schema:
 * - unknown body keys are rejected
 * - excludedInvoiceIds must be valid ObjectId(s)
 * - period cannot be future
 * - EVC OTP + PAN mandatory
 *
 * NOTE:
 * This schema intentionally does NOT allow body.gstin by default.
 * GSTIN should come from trusted workspace/session context.
 * If you want to allow client-sent GSTIN for mismatch validation,
 * add gstinField here AND add 'gstin' to route restrictBodyKeys allowlist.
 */
const filingBodySchema = Joi.object({
  period: requiredPeriodField,
  pan: panField,
  otp: evcOtpField,
  excludedInvoiceIds: excludedInvoiceIdsField,
  alreadyPrepared: Joi.boolean().optional(),
  username: usernameField,
  idempotencyKey: idempotencyKeyField
}).meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* 22. Nil Return Filing Body Schema                                          */
/* -------------------------------------------------------------------------- */

/**
 * Used by:
 * - POST /api/returns/nil-file
 *
 * Statutory constraints:
 * - declarationAccepted must be true
 * - current provider flow supports EVC only
 * - returnType/type must be GSTR1 or GSTR3B
 * - if both omitted, defaults to GSTR1
 */
const nilFileBodySchema = Joi.object({
  period: requiredPeriodField,
  returnType: Joi.string()
    .trim()
    .uppercase()
    .valid(...NIL_RETURN_TYPES)
    .optional(),
  type: Joi.string()
    .trim()
    .uppercase()
    .valid(...NIL_RETURN_TYPES)
    .optional(),
  declarationAccepted: Joi.boolean()
    .valid(true)
    .required()
    .messages({
      'any.only':
        'Statutory declaration per CGST Rule 67A must be accepted before filing a Nil return.',
      'any.required':
        'Statutory declaration per CGST Rule 67A must be accepted before filing a Nil return.'
    }),
  verificationMode: Joi.string()
    .trim()
    .uppercase()
    .valid('EVC')
    .optional()
    .default('EVC')
    .messages({
      'any.only':
        'Nil return filing currently requires EVC verification. DSC/other modes are not supported by this provider flow.'
    }),
  otp: evcOtpField,
  pan: panField,
  username: usernameField,
  idempotencyKey: idempotencyKeyField
})
  .custom((value, helpers) => {
    const requestedReturnType = String(value.returnType || '').trim().toUpperCase();
    const requestedType = String(value.type || '').trim().toUpperCase();

    const resolved = requestedReturnType || requestedType || 'GSTR1';

    if (!NIL_RETURN_TYPES.includes(resolved)) {
      return helpers.error('nil.returnType.invalid');
    }

    if (
      requestedReturnType &&
      requestedType &&
      requestedReturnType !== requestedType
    ) {
      return helpers.error('nil.returnType.mismatch');
    }

    value.returnType = resolved;
    value.type = resolved;

    if (value.verificationMode) {
      value.verificationMode = String(value.verificationMode).trim().toUpperCase();
    }

    return value;
  }, 'nilFileBodyNormalization')
  .messages({
    'nil.returnType.invalid': 'Nil return can only be filed for GSTR1 or GSTR3B.',
    'nil.returnType.mismatch': 'returnType and type must match.'
  })
  .meta({ strict: true });

/* -------------------------------------------------------------------------- */
/* Middleware                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Generic Joi validation middleware generator.
 *
 * Behaviour:
 * - Schemas marked .meta({ strict: true }) reject unknown keys.
 * - Other schemas allow unknown keys by default and preserve them.
 * - Set GST_VALIDATE_STRICT_BODY=true to make all body validation strict.
 * - Use validateLoose() if you want unknown keys stripped.
 *
 * @param {Joi.ObjectSchema} schema
 * @param {'body'|'query'|'params'} property
 * @param {Object} options
 */
const validate = (schema, property = 'body', options = {}) => {
  return (req, res, next) => {
    if (!schema) return next();

    let meta = {};

    try {
      if (typeof schema.meta === 'function') {
        meta = schema.meta() || {};
      }
    } catch (_) {
      meta = {};
    }

    const {
      strict: explicitStrict,
      stripUnknown: explicitStripUnknown,
      allowUnknown: explicitAllowUnknown,
      ...joiOptions
    } = options;

    const strict =
      explicitStrict !== undefined
        ? explicitStrict
        : meta.strict !== undefined
          ? meta.strict
          : property === 'body' && DEFAULT_STRICT_BODY;

    /**
     * Important:
     * By default we do NOT strip unknown query/body keys.
     * This prevents accidental removal of controller-needed params like:
     * - forceSync
     * - type
     * - excludedInvoiceIds when not schema-declared
     *
     * Strict schemas reject unknown keys.
     * Use validateLoose() for explicit stripping.
     */
    const validateOptions = {
      abortEarly: false,
      allowUnknown: explicitAllowUnknown !== undefined
        ? explicitAllowUnknown
        : !strict,
      stripUnknown: explicitStripUnknown !== undefined
        ? explicitStripUnknown
        : false,
      ...joiOptions
    };

    const input = req[property] ?? {};

    const { error, value } = schema.validate(input, validateOptions);

    if (error) {
      const details = (error.details || []).slice(0, 10).map((detail) => {
        const path =
          Array.isArray(detail.path) && detail.path.length
            ? detail.path.join('.')
            : detail.type || 'validation';

        return `${path}: ${detail.message}`;
      });

      const errorDetails = details.join('; ') || 'Validation failed.';

      const isGstinError = (error.details || []).some((detail) => {
        const pathHasGstin =
          Array.isArray(detail.path) && detail.path.includes('gstin');

        const messageHasGstin = /gstin/i.test(detail.message || '');

        return pathHasGstin || messageHasGstin;
      });

      const apiError = isGstinError
        ? ApiError.invalidGstin(errorDetails)
        : ApiError.validationError(errorDetails);

      apiError.validationDetails = error.details || [];

      return next(apiError);
    }

    if (property === 'query') {
      try {
        Object.defineProperty(req, 'query', {
          value,
          writable: true,
          enumerable: true,
          configurable: true
        });
      } catch {
        if (req.query && typeof req.query === 'object' && typeof value === 'object') {
          for (const key of Object.keys(req.query)) {
            if (!(key in value)) delete req.query[key];
          }
          Object.assign(req.query, value);
        } else {
          req.query = value;
        }
      }
    } else {
      try {
        req[property] = value;
      } catch {
        Object.defineProperty(req, property, {
          value,
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
    }
    next();
  };
};

/**
 * Loose validator for legacy/non-statistical endpoints.
 * Unknown keys are stripped instead of rejected.
 */
const validateLoose = (schema, property = 'body') =>
  validate(schema, property, {
    strict: false,
    stripUnknown: true,
    allowUnknown: true
  });

/**
 * Strict validator. Unknown keys are rejected.
 */
const validateStrict = (schema, property = 'body') =>
  validate(schema, property, {
    strict: true,
    stripUnknown: false,
    allowUnknown: false
  });

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports = {
  validate,
  validateLoose,
  validateStrict,

  // Field schemas
  optionalPeriodField,
  requiredPeriodField,
  gstinField,
  requiredGstinField,
  usernameField,
  panField,
  evcOtpField,
  idempotencyKeyField,
  excludedInvoiceIdsField,
  offsetPayloadField,

  // General schemas
  searchGstinSchema,
  requestOtpSchema,
  verifyOtpSchema,
  evcOtpSchema,
  contactSchema,
  signupSchema,
  signinSchema,
  googleAuthSchema,
  switchWorkspaceSchema,
  linkGstinSchema,
  switchRoleSchema,

  // Period schemas
  periodQuerySchema,
  requiredPeriodQuerySchema,
  periodBodySchema,

  // Return flow schemas
  prepareGstr1BodySchema,
  prepareGstr3bBodySchema,
  saveGstr1BodySchema,
  saveGstr3bBodySchema,
  offsetGstr3bBodySchema,
  generateSummaryBodySchema,
  prepareGstr1FilingBodySchema,
  prepareGstr3bFilingBodySchema,
  filingBodySchema,
  nilFileBodySchema
};