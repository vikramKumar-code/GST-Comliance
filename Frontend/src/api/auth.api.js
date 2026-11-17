import client from './client';
import {
  isValidGstin,
  normalizeGstin,
  isValidPan,
  normalizePan,
  isValidOtp,
  normalizeOtp,
  isValidPeriod,
  normalizePeriod,
  normalizeEvcFormType,
  isValidEvcFormType
} from '../utils/validators';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const ROLE_VALUES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function validationError(message, code = 'VALIDATION_ERROR') {
  return {
    code,
    message,
    status: 400,
    data: null
  };
}

function toTrimmedString(value) {
  return String(value ?? '').trim();
}

function compact(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const out = {};

  for (const [key, val] of Object.entries(value)) {
    if (val === undefined || val === null) continue;

    if (typeof val === 'string' && val.trim() === '') continue;

    if (Array.isArray(val) && val.length === 0) continue;

    if (
      typeof val === 'object' &&
      !Array.isArray(val) &&
      Object.keys(val).length === 0
    ) {
      continue;
    }

    out[key] = val;
  }

  return out;
}

function requireString(value, field, { min = 1, max = 500 } = {}) {
  const str = toTrimmedString(value);

  if (!str) {
    throw validationError(`${field} is required.`);
  }

  if (str.length < min) {
    throw validationError(`${field} must be at least ${min} characters.`);
  }

  if (str.length > max) {
    throw validationError(`${field} cannot exceed ${max} characters.`);
  }

  return str;
}

function optionalString(value, max = 500) {
  const str = toTrimmedString(value);
  if (!str) return undefined;

  if (str.length > max) {
    throw validationError(`Field cannot exceed ${max} characters.`);
  }

  return str;
}

function normalizeEmail(value) {
  return toTrimmedString(value).toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

function requireGstin(value, field = 'GSTIN') {
  const gstin = normalizeGstin(value);

  if (!gstin) {
    throw validationError(`${field} is required.`);
  }

  if (!isValidGstin(gstin)) {
    throw validationError(
      `Invalid ${field}. GSTIN must be 15 alphanumeric characters.`
    );
  }

  return gstin;
}

function optionalGstin(value) {
  const gstin = normalizeGstin(value);
  if (!gstin) return undefined;

  if (!isValidGstin(gstin)) {
    throw validationError(
      'Invalid GSTIN. GSTIN must be 15 alphanumeric characters.'
    );
  }

  return gstin;
}

function requirePan(value) {
  const pan = normalizePan(value);

  if (!pan) {
    throw validationError('PAN is required.');
  }

  if (!isValidPan(pan)) {
    throw validationError(
      'Invalid PAN format. PAN must be 10 characters, e.g. ABCDE1234F.'
    );
  }

  return pan;
}

function requireOtp(value) {
  const otp = normalizeOtp(value);

  if (!otp) {
    throw validationError('OTP is required.');
  }

  if (!isValidOtp(otp)) {
    throw validationError(
      'Invalid OTP format. OTP must be 4 to 8 numeric digits.'
    );
  }

  return otp;
}

function requirePeriod(value, field = 'Return period') {
  const period = normalizePeriod(value);

  if (!period) {
    throw validationError(`${field} is required.`);
  }

  if (!isValidPeriod(period)) {
    throw validationError(
      `Invalid ${field}. Period must be MMYYYY and cannot be in the future.`
    );
  }

  return period;
}

function requireEvcFormType(value) {
  const raw = toTrimmedString(value) || 'R1';
  const formType = normalizeEvcFormType(raw);

  if (!isValidEvcFormType(formType)) {
    throw validationError(
      `Invalid form_type '${raw}'. Expected R1, GSTR1, GSTR-1, R3B, GSTR3B, or GSTR-3B.`
    );
  }

  return formType;
}

function requireRole(value) {
  const role = toTrimmedString(value).toUpperCase();

  if (!ROLE_VALUES.includes(role)) {
    throw validationError(
      `Invalid role '${role}'. Expected one of: ${ROLE_VALUES.join(', ')}.`
    );
  }

  return role;
}

/* -------------------------------------------------------------------------- */
/* GSTIN search                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Search taxpayer details by GSTIN.
 *
 * Backend expects body:
 * {
 *   gstin: string
 * }
 */
export const searchGstin = async (gstin) => {
  const normalizedGstin = requireGstin(gstin);

  return client.post('/gstin/search', {
    gstin: normalizedGstin
  });
};

/* -------------------------------------------------------------------------- */
/* GST portal OTP auth                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Request OTP for taxpayer verification.
 *
 * Backend expects body:
 * {
 *   gstin: string,
 *   username: string,
 *   consent: true
 * }
 */
export const requestOtp = async ({ gstin, username, consent } = {}) => {
  const normalizedGstin = requireGstin(gstin);
  const normalizedUsername = requireString(username, 'Username', { max: 100 });

  if (consent !== true) {
    throw validationError(
      'Taxpayer consent is mandatory to request OTP.'
    );
  }

  const body = compact({
    gstin: normalizedGstin,
    username: normalizedUsername,
    consent: true
  });

  return client.post('/auth/otp/request', body);
};

/**
 * Verify OTP and establish GST portal session.
 *
 * Backend expects body:
 * {
 *   gstin: string,
 *   username: string,
 *   otp: string
 * }
 */
export const verifyOtp = async ({ gstin, username, otp } = {}) => {
  const normalizedGstin = requireGstin(gstin);
  const normalizedUsername = requireString(username, 'Username', { max: 100 });
  const normalizedOtp = requireOtp(otp);

  const body = compact({
    gstin: normalizedGstin,
    username: normalizedUsername,
    otp: normalizedOtp
  });

  return client.post('/auth/otp/verify', body);
};

/**
 * Request EVC OTP for electronic return verification.
 *
 * Backend expects body:
 * {
 *   gstin?: string,
 *   pan: string,
 *   form_type: 'R1' | 'R3B' | ... ,
 *   period: 'MMYYYY',
 *   username?: string
 * }
 *
 * NOTE:
 * - period is required for EVC OTP request in updated backend schema.
 * - gstin is optional because backend may resolve trusted GSTIN from workspace/session.
 *   If provided, it must be valid.
 */
export const requestEvcOtp = async ({
  gstin,
  pan,
  form_type,
  period,
  username
} = {}) => {
  const normalizedPan = requirePan(pan);
  const normalizedFormType = requireEvcFormType(form_type);
  const normalizedPeriod = requirePeriod(period, 'EVC return period');

  const normalizedGstin = gstin ? optionalGstin(gstin) : undefined;
  const normalizedUsername = optionalString(username, 100);

  const body = compact({
    gstin: normalizedGstin,
    pan: normalizedPan,
    form_type: normalizedFormType,
    period: normalizedPeriod,
    username: normalizedUsername
  });

  return client.post('/auth/otp/evc', body);
};

/* -------------------------------------------------------------------------- */
/* Session / user                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Check active session and get current user/workspace info.
 */
export const getMe = async () => {
  return client.get('/auth/me');
};

/**
 * Register a new user.
 *
 * Backend expects body:
 * {
 *   name: string,
 *   email: string,
 *   password: string
 * }
 */
export const signup = async ({ name, email, password } = {}) => {
  const normalizedName = requireString(name, 'Name', { min: 2, max: 100 });
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw validationError('Email is required.');
  }

  if (!isValidEmail(normalizedEmail)) {
    throw validationError('Invalid email address.');
  }

  const normalizedPassword = toTrimmedString(password);

  if (!normalizedPassword) {
    throw validationError('Password is required.');
  }

  if (normalizedPassword.length < 8) {
    throw validationError('Password must be at least 8 characters long.');
  }

  if (normalizedPassword.length > 128) {
    throw validationError('Password cannot exceed 128 characters.');
  }

  const body = compact({
    name: normalizedName,
    email: normalizedEmail,
    password: normalizedPassword
  });

  return client.post('/auth/signup', body);
};

/**
 * Log in an existing user.
 *
 * Backend expects body:
 * {
 *   email: string,
 *   password: string
 * }
 */
export const signin = async ({ email, password } = {}) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw validationError('Email is required.');
  }

  if (!isValidEmail(normalizedEmail)) {
    throw validationError('Invalid email address.');
  }

  const normalizedPassword = toTrimmedString(password);

  if (!normalizedPassword) {
    throw validationError('Password is required.');
  }

  const body = compact({
    email: normalizedEmail,
    password: normalizedPassword
  });

  return client.post('/auth/signin', body);
};

/**
 * Authenticate with Google OAuth 2.0 credential token.
 *
 * Backend expects body:
 * {
 *   idToken: string
 * }
 */
export const googleAuth = async (idToken) => {
  const normalizedIdToken = requireString(idToken, 'Google ID token', {
    max: 5000
  });

  return client.post('/auth/google', {
    idToken: normalizedIdToken
  });
};

/**
 * Logout and invalidate current session.
 */
export const logout = async () => {
  return client.post('/auth/logout');
};

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * List all workspaces/GSTINs accessible by authenticated user.
 */
export const getWorkspaces = async () => {
  return client.get('/auth/workspaces');
};

/**
 * Switch active session context to another workspace.
 *
 * Backend expects body:
 * {
 *   workspaceId: string
 * }
 */
export const switchWorkspace = async (workspaceId) => {
  const normalizedWorkspaceId = requireString(workspaceId, 'Workspace ID', {
    max: 128
  });

  return client.post('/auth/switch-workspace', {
    workspaceId: normalizedWorkspaceId
  });
};

/**
 * Link or update GSTIN for active organization workspace.
 *
 * Backend expects body:
 * {
 *   gstin: string,
 *   name?: string
 * }
 */
export const linkGstin = async ({ gstin, name } = {}) => {
  const normalizedGstin = requireGstin(gstin);
  const normalizedName = optionalString(name, 100);

  const body = compact({
    gstin: normalizedGstin,
    name: normalizedName
  });

  return client.post('/auth/workspace/link-gstin', body);
};

/**
 * Create a new workspace/organization.
 *
 * Backend likely expects at least:
 * {
 *   name: string,
 *   gstin?: string
 * }
 *
 * Additional workspace profile fields can be passed through if backend supports them.
 */
export const createWorkspace = async (payload = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw validationError('Workspace payload must be a JSON object.');
  }

  const normalizedName = requireString(payload.name, 'Organization name', {
    min: 1,
    max: 200
  });

  const normalizedGstin = payload.gstin
    ? optionalGstin(payload.gstin)
    : undefined;

  const body = compact({
    ...payload,
    name: normalizedName,
    gstin: normalizedGstin
  });

  // Remove obviously unsafe/unwanted keys if accidentally present.
  delete body._id;
  delete body.id;
  delete body.workspaceId;
  delete body.userId;
  delete body.memberId;
  delete body.role;
  delete body.token;
  delete body.gstToken;
  delete body.sessionToken;
  delete body.password;
  delete body.secret;
  delete body.consent;
  delete body.debug;

  return client.post('/auth/workspace/create', body);
};

/**
 * Update active workspace/organization details.
 *
 * Backend expects partial payload. At least one valid field should be present.
 */
export const updateWorkspace = async (payload = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw validationError('Workspace update payload must be a JSON object.');
  }

  const body = compact({ ...payload });

  if (Object.keys(body).length === 0) {
    throw validationError('Workspace update payload cannot be empty.');
  }

  if (body.gstin) {
    body.gstin = optionalGstin(body.gstin);
  }

  if (body.name !== undefined) {
    body.name = optionalString(body.name, 200);
  }

  // Remove obviously unsafe/unwanted keys if accidentally present.
  delete body._id;
  delete body.id;
  delete body.workspaceId;
  delete body.userId;
  delete body.memberId;
  delete body.token;
  delete body.gstToken;
  delete body.sessionToken;
  delete body.password;
  delete body.secret;
  delete body.consent;
  delete body.debug;

  if (Object.keys(body).length === 0) {
    throw validationError('No valid workspace fields left to update.');
  }

  return client.put('/auth/workspace', body);
};

/**
 * Switch or update active member role.
 *
 * Backend expects body:
 * {
 *   role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
 * }
 */
export const switchRole = async (role) => {
  const normalizedRole = requireRole(role);

  return client.post('/auth/workspace/switch-role', {
    role: normalizedRole
  });
};