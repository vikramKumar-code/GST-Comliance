import client, {
  makeIdempotencyKey,
  filingRequestConfig
} from './client';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;
const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;
const EVC_OTP_REGEX = /^[A-Za-z0-9]{4,8}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const NIL_RETURN_TYPES = ['GSTR1', 'GSTR3B'];
const OFFSET_PAYLOAD_KEYS = ['pdcash', 'pditc', 'pdnls'];

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

function validationError(message, code = 'VALIDATION_ERROR') {
  return {
    code,
    message,
    status: 400,
    data: null
  };
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

function assertPeriod(period, { required = true } = {}) {
  const value = String(period ?? '').trim();

  if (!value) {
    if (required) {
      throw validationError('Return period (MMYYYY) is required.');
    }
    return undefined;
  }

  if (!PERIOD_REGEX.test(value)) {
    throw validationError(
      `Invalid return period '${value}'. Period must be in MMYYYY format.`
    );
  }

  return value;
}

function normalizeUsername(username) {
  const value = String(username ?? '').trim();
  return value || undefined;
}

function normalizeExcludedInvoiceIds(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  let raw;

  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === 'string') {
    raw = value.split(',');
  } else {
    raw = [value];
  }

  const seen = new Set();
  const ids = [];

  for (const item of raw) {
    const id = String(item ?? '').trim();

    if (!id) continue;

    if (!OBJECT_ID_REGEX.test(id)) {
      throw validationError(
        `Invalid excluded invoice id '${id}'. excludedInvoiceIds must contain 24-character MongoDB ObjectIds.`
      );
    }

    if (seen.has(id)) continue;

    seen.add(id);
    ids.push(id);
  }

  return ids.length ? ids : undefined;
}

function assertEvcOtp(otp) {
  const value = String(otp ?? '').trim();

  if (!EVC_OTP_REGEX.test(value)) {
    throw validationError(
      'Invalid EVC OTP format. Must be 4 to 8 letters or digits.'
    );
  }

  return value;
}

function assertPan(pan) {
  const value = String(pan ?? '').trim().toUpperCase();

  if (!PAN_REGEX.test(value)) {
    throw validationError(
      'Invalid PAN format. Must be 10 characters, e.g. ABCDE1234F.'
    );
  }

  return value;
}

function normalizeNilReturnType(type) {
  const value = String(type ?? 'GSTR1').trim().toUpperCase();

  if (!NIL_RETURN_TYPES.includes(value)) {
    throw validationError(
      'Nil return can only be filed for GSTR1 or GSTR3B.'
    );
  }

  return value;
}

function normalizeOffsetPayload(payload) {
  if (payload === undefined || payload === null) {
    return undefined;
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw validationError('offsetPayload must be a JSON object.');
  }

  const out = {};

  for (const key of OFFSET_PAYLOAD_KEYS) {
    const val = payload[key];

    if (val === undefined || val === null) continue;

    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      out[key] = val;
      continue;
    }

    if (typeof val === 'object') {
      if (Object.keys(val).length === 0) continue;
      out[key] = val;
      continue;
    }

    out[key] = val;
  }

  return Object.keys(out).length ? out : undefined;
}

function filingConfig(action, period, userId, providedKey) {
  const key =
    providedKey ||
    makeIdempotencyKey(action, period, userId);

  return filingRequestConfig(key);
}

/* -------------------------------------------------------------------------- */
/* Public helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Create a backend-valid idempotency key.
 *
 * IMPORTANT:
 * For retry of the same logical filing/save/offset/nil operation,
 * reuse the same key. Do not generate a new key on retry.
 *
 * Example:
 * const key = createReturnIdempotencyKey('gstr1-file-evc', period, userId);
 * setState({ idempotencyKey: key });
 * await fileGstr1WithEvc({ ..., idempotencyKey: key });
 */
export function createReturnIdempotencyKey(action, period, userId) {
  return makeIdempotencyKey(action, period, userId);
}

/* -------------------------------------------------------------------------- */
/* Read endpoints                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Fetch summary of filed returns and available periods.
 * Period is optional for backend /returns/summary.
 */
export const getReturnsSummary = async (period) => {
  const normalizedPeriod = assertPeriod(period, { required: false });

  return client.get('/returns/summary', {
    params: compact({
      period: normalizedPeriod
    })
  });
};

/**
 * Fetch GSTR-1 sales data for a specific period.
 */
export const getGstr1 = async (period, options = {}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });

  return client.get('/returns/gstr1', {
    params: compact({
      period: normalizedPeriod,
      forceSync: options?.forceSync ? 'true' : undefined
    })
  });
};

/**
 * Fetch GSTR-2B inward supplies / eligible ITC data.
 */
export const getGstr2b = async (period, options = {}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });

  return client.get('/returns/gstr2b', {
    params: compact({
      period: normalizedPeriod,
      forceSync: options?.forceSync ? 'true' : undefined
    })
  });
};

/**
 * Fetch GSTR-3B monthly tax summary & liability data.
 */
export const getGstr3b = async (period, options = {}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });

  return client.get('/returns/gstr3b', {
    params: compact({
      period: normalizedPeriod,
      forceSync: options?.forceSync ? 'true' : undefined
    })
  });
};

/**
 * Fetch aggregate dashboard metrics for a period.
 */
export const getDashboard = async (period) => {
  const normalizedPeriod = assertPeriod(period, { required: true });

  return client.get('/dashboard', {
    params: compact({
      period: normalizedPeriod
    })
  });
};

/**
 * Convenience helper to fetch return by return type.
 */
export const getReturnByType = async (type, period, options = {}) => {
  const normalizedType = String(type || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  switch (normalizedType) {
    case 'gstr1':
      return getGstr1(period, options);
    case 'gstr2b':
      return getGstr2b(period, options);
    case 'gstr3b':
      return getGstr3b(period, options);
    default:
      throw validationError(
        `Unknown return type: ${type}. Expected gstr1, gstr2b, or gstr3b.`
      );
  }
};

/* -------------------------------------------------------------------------- */
/* Local prepare endpoints                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Prepare GSTR-1 payload from workspace invoices for review.
 * Does not upload to GSTN.
 */
export const prepareGstr1 = async (period, excludedInvoiceIds = []) => {
  const normalizedPeriod = assertPeriod(period, { required: true });
  const normalizedExcluded = normalizeExcludedInvoiceIds(excludedInvoiceIds);

  return client.post(
    '/returns/gstr1/prepare',
    compact({
      period: normalizedPeriod,
      excludedInvoiceIds: normalizedExcluded
    })
  );
};

/**
 * Prepare GSTR-3B payload from workspace sales & purchases.
 * Does not upload to GSTN.
 */
export const prepareGstr3b = async (period) => {
  const normalizedPeriod = assertPeriod(period, { required: true });

  return client.post(
    '/returns/gstr3b/prepare',
    compact({
      period: normalizedPeriod
    })
  );
};

/* -------------------------------------------------------------------------- */
/* GSTN save/upload endpoints                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Save / upload GSTR-1 payload to GSTN, or execute safe dry-run.
 *
 * Retry guidance:
 * Pass same idempotencyKey when retrying the same save attempt.
 */
export const saveGstr1 = async (period, excludedInvoiceIds = [], options = {}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });
  const normalizedExcluded = normalizeExcludedInvoiceIds(excludedInvoiceIds);

  const body = compact({
    period: normalizedPeriod,
    excludedInvoiceIds: normalizedExcluded,
    username: normalizeUsername(options.username)
  });

  const config = filingConfig(
    'gstr1-save',
    normalizedPeriod,
    options.userId,
    options.idempotencyKey
  );

  return client.post('/returns/gstr1/save', body, config);
};

/**
 * Trigger GSTR-1 summary generation / portal save flow.
 *
 * Backend currently supports GSTR-1 summary generation only.
 */
export const generateSummary = async (period, options = {}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });

  const returnType = options.returnType
    ? String(options.returnType).trim().toUpperCase()
    : undefined;

  if (returnType && returnType !== 'GSTR1') {
    throw validationError(
      'This endpoint currently generates GSTR-1 summary only.'
    );
  }

  const body = compact({
    period: normalizedPeriod,
    excludedInvoiceIds: normalizeExcludedInvoiceIds(options.excludedInvoiceIds),
    isNil: options.isNil === true ? true : undefined,
    returnType,
    username: normalizeUsername(options.username)
  });

  const config = filingConfig(
    'generate-summary',
    normalizedPeriod,
    options.userId,
    options.idempotencyKey
  );

  return client.post('/returns/generate-summary', body, config);
};

/**
 * Save / upload GSTR-3B payload to GST Portal.
 */
export const saveGstr3b = async (period, options = {}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });

  const body = compact({
    period: normalizedPeriod,
    username: normalizeUsername(options.username)
  });

  const config = filingConfig(
    'gstr3b-save',
    normalizedPeriod,
    options.userId,
    options.idempotencyKey
  );

  return client.post('/returns/gstr3b/save', body, config);
};

/**
 * Offset GSTR-3B liabilities on GST Portal.
 *
 * If offsetPayload is omitted, backend can prepare offset payload from workspace data.
 */
export const offsetGstr3b = async (period, offsetPayload, options = {}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });

  const body = compact({
    period: normalizedPeriod,
    offsetPayload: normalizeOffsetPayload(offsetPayload),
    username: normalizeUsername(options.username)
  });

  const config = filingConfig(
    'gstr3b-offset',
    normalizedPeriod,
    options.userId,
    options.idempotencyKey
  );

  return client.post('/returns/gstr3b/offset', body, config);
};

/* -------------------------------------------------------------------------- */
/* GSTR-1 prepare-filing / file-evc                                           */
/* -------------------------------------------------------------------------- */

/**
 * Prepare GSTR-1 filing on GSTN before asking user for EVC OTP.
 *
 * UI flow:
 * 1) prepareGstr1Filing()
 * 2) request EVC OTP
 * 3) fileGstr1WithEvc({ alreadyPrepared: true })
 */
export const prepareGstr1Filing = async (
  period,
  excludedInvoiceIds = [],
  options = {}
) => {
  const normalizedPeriod = assertPeriod(period, { required: true });
  const normalizedExcluded = normalizeExcludedInvoiceIds(excludedInvoiceIds);

  const body = compact({
    period: normalizedPeriod,
    excludedInvoiceIds: normalizedExcluded
  });

  const config = filingConfig(
    'gstr1-prepare-filing',
    normalizedPeriod,
    options.userId,
    options.idempotencyKey
  );

  return client.post('/returns/gstr1/prepare-filing', body, config);
};

/**
 * File GSTR-1 with EVC.
 *
 * IMPORTANT:
 * If alreadyPrepared = true, do not send changed excludedInvoiceIds.
 * Backend will use exclusions stored during prepare-filing.
 * If user wants to change exclusions, run prepareGstr1Filing() again.
 */
export const fileGstr1WithEvc = async ({
  period,
  otp,
  pan,
  alreadyPrepared = false,
  excludedInvoiceIds = [],
  username,
  userId,
  idempotencyKey
}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });
  const normalizedOtp = assertEvcOtp(otp);
  const normalizedPan = assertPan(pan);
  const normalizedAlreadyPrepared = Boolean(alreadyPrepared);

  const body = compact({
    period: normalizedPeriod,
    otp: normalizedOtp,
    pan: normalizedPan,
    alreadyPrepared: normalizedAlreadyPrepared,
    username: normalizeUsername(username)
  });

  // Only send excludedInvoiceIds when this is not an already-prepared filing.
  if (!normalizedAlreadyPrepared) {
    const normalizedExcluded = normalizeExcludedInvoiceIds(excludedInvoiceIds);
    if (normalizedExcluded) {
      body.excludedInvoiceIds = normalizedExcluded;
    }
  }

  const config = filingConfig(
    'gstr1-file-evc',
    normalizedPeriod,
    userId,
    idempotencyKey
  );

  return client.post('/returns/gstr1/file-evc', body, config);
};

/* -------------------------------------------------------------------------- */
/* GSTR-3B prepare-filing / file-evc                                          */
/* -------------------------------------------------------------------------- */

/**
 * Prepare GSTR-3B filing on GSTN before asking user for EVC OTP.
 *
 * UI flow:
 * 1) prepareGstr3bFiling()
 * 2) request EVC OTP
 * 3) fileGstr3bWithEvc({ alreadyPrepared: true })
 */
export const prepareGstr3bFiling = async (period, options = {}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });

  const body = compact({
    period: normalizedPeriod
  });

  const config = filingConfig(
    'gstr3b-prepare-filing',
    normalizedPeriod,
    options.userId,
    options.idempotencyKey
  );

  return client.post('/returns/gstr3b/prepare-filing', body, config);
};

/**
 * File GSTR-3B with EVC.
 */
export const fileGstr3bWithEvc = async ({
  period,
  otp,
  pan,
  alreadyPrepared = false,
  username,
  userId,
  idempotencyKey
}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });
  const normalizedOtp = assertEvcOtp(otp);
  const normalizedPan = assertPan(pan);

  const body = compact({
    period: normalizedPeriod,
    otp: normalizedOtp,
    pan: normalizedPan,
    alreadyPrepared: Boolean(alreadyPrepared),
    username: normalizeUsername(username)
  });

  const config = filingConfig(
    'gstr3b-file-evc',
    normalizedPeriod,
    userId,
    idempotencyKey
  );

  return client.post('/returns/gstr3b/file-evc', body, config);
};

/* -------------------------------------------------------------------------- */
/* Nil return                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Check eligibility for Nil Return under CGST Rule 67A.
 */
export const checkNilEligibility = async (period, type = 'GSTR1', gstin) => {
  const normalizedPeriod = assertPeriod(period, { required: true });
  const normalizedType = normalizeNilReturnType(type);

  const normalizedGstin = gstin
    ? String(gstin).trim().toUpperCase()
    : undefined;

  return client.get('/returns/nil-eligibility', {
    params: compact({
      period: normalizedPeriod,
      type: normalizedType,
      gstin: normalizedGstin
    })
  });
};

/**
 * File Nil Return under CGST Rule 67A.
 *
 * Statutory requirements enforced at frontend before calling backend:
 * - declarationAccepted must be true
 * - verificationMode must be EVC
 * - OTP and PAN must be valid
 */
export const fileNilReturn = async ({
  period,
  returnType,
  type,
  declarationAccepted,
  verificationMode,
  otp,
  pan,
  username,
  userId,
  idempotencyKey
}) => {
  const normalizedPeriod = assertPeriod(period, { required: true });
  const normalizedReturnType = normalizeNilReturnType(returnType || type);

  if (declarationAccepted !== true) {
    throw validationError(
      'Statutory declaration per CGST Rule 67A must be accepted before filing a Nil return.'
    );
  }

  const normalizedVerificationMode = String(
    verificationMode || 'EVC'
  ).trim().toUpperCase();

  if (normalizedVerificationMode !== 'EVC') {
    throw validationError(
      'Nil return filing currently requires EVC verification. DSC/other modes are not supported by this provider flow.'
    );
  }

  const normalizedOtp = assertEvcOtp(otp);
  const normalizedPan = assertPan(pan);

  const body = compact({
    period: normalizedPeriod,
    returnType: normalizedReturnType,
    declarationAccepted: true,
    verificationMode: 'EVC',
    otp: normalizedOtp,
    pan: normalizedPan,
    username: normalizeUsername(username)
  });

  const config = filingConfig(
    'nil-file',
    `${normalizedReturnType}:${normalizedPeriod}`,
    userId,
    idempotencyKey
  );

  return client.post('/returns/nil-file', body, config);
};

/* -------------------------------------------------------------------------- */
/* Filing status helper                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Check filing transaction status on portal.
 *
 * NOTE:
 * Current backend routes do not expose /returns/filing-status.
 * Previously this function returned COMPLETED on error, which is unsafe.
 *
 * Now:
 * - If endpoint is missing, it returns UNKNOWN/PENDING instead of fake success.
 * - UI should treat UNKNOWN/PENDING as "do not retry filing blindly".
 * - Refresh GST Return Hub / returns summary to confirm actual filed status.
 */
export const checkFilingStatus = async (refId) => {
  try {
    return await client.get('/returns/filing-status', {
      params: compact({ refId })
    });
  } catch (err) {
    if (
      err?.status === 404 ||
      err?.code === 'DATA_NOT_AVAILABLE' ||
      err?.code === 'NOT_FOUND'
    ) {
      return {
        success: false,
        pending: true,
        status: 'UNKNOWN',
        refId: refId || null,
        message:
          'Filing status endpoint is not available. Please refresh GST Return Hub or returns summary before retrying.'
      };
    }

    throw err;
  }
};

/* -------------------------------------------------------------------------- */
/* Demo / testing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Seed sample demo invoices for current workspace & period.
 * Disabled in production unless backend allows it.
 */
export const seedSampleInvoices = async (period) => {
  const normalizedPeriod = assertPeriod(period, { required: false });

  return client.post(
    '/returns/seed-sample-invoices',
    compact({
      period: normalizedPeriod
    })
  );
};