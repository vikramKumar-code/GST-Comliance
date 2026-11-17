const crypto = require('node:crypto');
const axios = require('axios');
const ApiError = require('../../utils/apiError');
const logger = require('../../utils/logger');
const { TaxProGspSession } = require('./taxproGspSession');
const { isValidGstin, isValidPeriod } = require('../../utils/gstin');
const { resolveGstnCatalogError } = require('./gstnErrorCatalog');

// Official TaxPro / GSTN error codes for an expired or invalid taxpayer auth token
const SESSION_ERROR_CODES = [
  'AUTH4038', 'AUTH4033', 'AUTH4042', 'GSP052', 'GSP052A',
  'TEC4002', 'GSP102', 'OTP0008', 'OTP0011', 'RET11407',
  'AUTH158', 'RET13001', 'AUTH403'
];

// Statutory safety: do not fabricate isnil Y unless explicitly enabled.
const TAXPRO_ALLOW_NIL_SUMMARY_FALLBACK =
  String(process.env.TAXPRO_ALLOW_NIL_SUMMARY_FALLBACK || 'false').toLowerCase() === 'true';

/**
 * GSTN success responses do NOT always carry status_cd.
 * Per the GSTN schemas the success bodies are:
 *   Save (GSTR-1 / 3B)  -> { reference_id }
 *   Submit GSTR-1       -> { reference_id }
 *   Proceed to File     -> { reference_id } or { isSync: 'Y' }
 *   File                -> { ack_num }
 *   Offset 3B           -> { message: 'Payment of tax successfully done' }
 *   RETSTATUS           -> { status_cd: 'P' | 'PE' | 'ER' | 'IP' } or TaxPro wrapper status_cd '1'
 * Each operation therefore declares what a successful body looks like.
 */
const SAVE_REF_ALIASES = ['reference_id', 'ref_id'];

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Defensive GSTN Save payload cleaner.
 *
 * Official GSTR-1 Save request schema has additionalProperties: false and does
 * not allow chksum / null / undefined values in the save payload.
 *
 * This does NOT replace schema validation. It only removes clearly illegal
 * legacy artifacts before sending to TaxPro/GSTN.
 */
function cleanSaveValue(value) {
  if (value === undefined || value === null) return undefined;

  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const out = [];

    for (const item of value) {
      const cleaned = cleanSaveValue(item);
      if (cleaned !== undefined) out.push(cleaned);
    }

    return out;
  }

  if (isPlainObject(value)) {
    const out = {};

    for (const [key, val] of Object.entries(value)) {
      // chksum is a summary/response concept, not allowed in Save request schema.
      if (key === 'chksum') continue;

      const cleaned = cleanSaveValue(val);
      if (cleaned !== undefined) out[key] = cleaned;
    }

    return out;
  }

  return value;
}

function safeParseJson(value) {
  if (isPlainObject(value) || Array.isArray(value)) return value;

  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getReferenceId(data, aliases = SAVE_REF_ALIASES) {
  for (const key of aliases) {
    const direct = data?.[key];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();

    const nested = data?.data?.[key];
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }

  return null;
}

function requireReferenceId(data, label, aliases = SAVE_REF_ALIASES) {
  const refId = getReferenceId(data, aliases);

  if (!refId) {
    throw ApiError.providerError(
      `${label}: GSTN response did not include required reference_id. Operation was not confirmed.`,
      502
    );
  }

  return refId;
}

const OK_SHAPE = {
  saveGstr1: (d) => Boolean(getReferenceId(d)),
  saveGstr3b: (d) => Boolean(getReferenceId(d)),
  submitGstr1: (d) => Boolean(getReferenceId(d)),
  proceedToFile: (d) => Boolean(getReferenceId(d) || d?.isSync === 'Y' || d?.data?.isSync === 'Y'),
  fileGstr1: (d) => typeof (d?.ack_num || d?.data?.ack_num) === 'string' && (d?.ack_num || d?.data?.ack_num).trim(),
  fileGstr3b: (d) => typeof (d?.ack_num || d?.data?.ack_num) === 'string' && (d?.ack_num || d?.data?.ack_num).trim(),
  offsetGstr3b: (d) => (
    d?.message === 'Payment of tax successfully done' ||
    d?.data?.message === 'Payment of tax successfully done'
  ),
  trackStatus: (d) => {
    const s = String(d?.data?.status_cd || d?.status_cd || '').toUpperCase();
    return ['P', 'PE', 'ER', 'IP', '1'].includes(s);
  }
};

/**
 * One place to read the provider error code.
 * Works for axios errors AND ApiError objects thrown by checkTaxProResponse.
 */
function getErrCd(e) {
  if (!e) return undefined;
  if (typeof e.errorCd === 'string' && e.errorCd) return e.errorCd;

  let d = e.response?.data;

  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      return undefined;
    }
  }

  if (d && typeof d === 'object') {
    return d.error?.error_cd || d.error_cd || undefined;
  }

  return undefined;
}

/**
 * Mask anything that looks like PAN / GSTIN / numeric secrets before logging.
 */
function maskSensitive(text) {
  if (typeof text !== 'string') return undefined;

  return text
    .replace(/[A-Z]{5}[0-9]{4}[A-Z]/gi, '[PAN]')
    .replace(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]/gi, '[GSTIN]')
    .replace(/\b\d{4,}\b/g, '[NUM]')
    .replace(/TESTPASS|TESTASP|TESTTOKEN/gi, '[REDACTED]')
    .replace(/(password|token|secret|authtoken|auth-token)\s*[:=]?\s*\S+/gi, '$1 [REDACTED]')
    .replace(/(?:aspid|password|authtoken)=[^&\s]+/gi, '$1=[REDACTED]')
    .slice(0, 200);
}

function safeErrorMessage(error) {
  if (!error) return 'unknown';

  const msg = typeof error.message === 'string' ? error.message : '';

  return maskSensitive(msg.replace(/https?:\/\/\S+/gi, '[URL_REDACTED]')) || 'unknown';
}

/**
 * Deterministic retry check: only retry on route/config errors.
 * Never retry on timeouts or 5xx to avoid duplicate mutating requests.
 */
function isSafeConfigRetryError(error) {
  const status = error?.response?.status;
  const code = error?.code;
  const errCd = getErrCd(error);

  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || !error?.response) return false;
  if (typeof status === 'number' && status >= 500) return false;

  return status === 404 || status === 405 || ['GEN5001', 'AUTH143'].includes(errCd);
}

function getValidErrorCd(errorCd) {
  if (typeof errorCd === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(errorCd)) {
    return errorCd;
  }

  return 'invalid';
}

function formatSafeHeaderDiagnostics(headers) {
  const summary = {};

  for (const [key, val] of Object.entries(headers || {})) {
    summary[key] = val !== undefined && val !== null && String(val).length > 0
      ? '[PRESENT]'
      : '[EMPTY]';
  }

  return summary;
}

function mapTaxProErrorCode(errorCd) {
  let err = null;

  if (SESSION_ERROR_CODES.includes(errorCd)) {
    err = ApiError.sessionExpired('Please verify OTP again.');
  } else if (
    errorCd === 'RET2B1023' ||
    errorCd === 'RET2B1007' ||
    errorCd === 'RET13509' ||
    errorCd === 'RT-R3BQ1004' ||
    errorCd === 'RT-3BGV1001' ||
    errorCd === 'RET11408' ||
    errorCd === 'RET11416' ||
    errorCd === 'GTR2B-002'
  ) {
    err = ApiError.dataNotAvailable('Data for this period is not available yet. Try another month.');
  } else if (errorCd === 'OTP0001' || errorCd === 'OTP0005') {
    err = ApiError.invalidGstin('Taxpayer GSTIN not found or invalid on GST portal.');
  } else if (errorCd === 'OTP0007' || errorCd === 'TEC4001') {
    err = ApiError.providerDown('GST Portal Error: GST OTP server is temporarily unavailable. Please retry in a few moments.');
  } else if (errorCd === 'GSP053') {
    err = ApiError.otpInvalid('OTP request has expired or was not found. Please request a new OTP.');
  } else if (errorCd === 'AUTH4037') {
    err = ApiError.validationError('Portal user is not registered with this GSTIN. Please check your portal username and GSTIN.');
  } else if (errorCd === 'AUTH002') {
    err = ApiError.validationError('GST Portal Error (AUTH002): API access is disabled for this GSTIN or GSP is not authorized. Please login to gst.gov.in > My Profile > Manage API Access and enable API access.');
  } else if (errorCd === 'AUTH003') {
    err = ApiError.validationError('GST Portal Error (AUTH003): API access is restricted for this taxpayer status. Please verify GSTIN status on the GST portal.');
  } else if (errorCd === 'OTP0006') {
    err = ApiError.validationError('GST Portal Error (OTP0006): PAN entered does not match the Authorized Signatory registered on the GST portal. For Companies/LLPs, please enter the personal PAN of the designated Director/Partner (4th letter must be "P").');
  } else if (errorCd === 'OTP0010') {
    err = ApiError.validationError('GST Portal Error (OTP0010): Not Authorized Signatory. The PAN entered is not registered as an Authorized Signatory for this GSTIN on the portal. For Companies / LLPs, please enter the personal PAN of the designated Director / Partner (4th letter must be "P").');
  } else if (errorCd === 'RET01203' || errorCd === 'RET2B1013' || errorCd === 'RT-3BGV1003') {
    err = ApiError.validationError('GST Portal Error: The username does not match or is not authorized for this GSTIN on the portal. Please ensure API Access is enabled under My Profile > Manage API Access on gst.gov.in.');
  } else if (['OTP0002', 'OTP0003', 'OTP0004', 'OTP0009', 'GEN5001', 'GEN5007', 'AUTH4035'].includes(errorCd)) {
    err = ApiError.validationError(`GST Portal Error (${errorCd}): Invalid or missing request parameters. Please check entered details.`);
  } else if (errorCd === 'GSTNBadRequest') {
    err = ApiError.validationError('GST Portal Notice (GSTNBadRequest): The government portal rejected the request. Please verify that your GST Return Hub session is active with a valid OTP, the return period is open, and authorized signatory PAN is designated for this GSTIN.');
  } else if (['GSP014', 'GSP018', 'GSP020', 'GSP020A', 'GSP021', 'GSP022', 'GSP023', 'GSP024', 'GSP024A', 'GSP061', 'AUTH001', 'AUT4031', 'AUT4032', 'AUT4033', 'AUT4034', 'RET11402'].includes(errorCd)) {
    err = ApiError.providerAuth('Could not complete the request. Please try again.');
  } else if (errorCd === 'GSP025') {
    err = ApiError.rateLimited('Too many requests. Please wait and try again.');
  } else if (['GSP027', 'GSP030', 'GSP031', 'GSP032', 'GSP099', 'GSP500'].includes(errorCd)) {
    err = ApiError.providerDown('GST service is unavailable. Please try again later.');
  } else if (errorCd === 'AUTH143') {
    err = ApiError.validationError('GST Portal Error (AUTH143): Invalid request parameters. Please verify the return period (MMYYYY) and ensure it is an active open tax period on the GST portal.');
  } else if (errorCd === 'AUTH4041') {
    err = ApiError.providerError('Could not complete the request. Please try again.', 502);
  } else if (errorCd === 'RET13507') {
    err = ApiError.validationError('GST Portal Error (RET13507): EVC signature mismatch. Please retry filing with a fresh EVC OTP.');
  } else if (errorCd === 'RT_FIL_10') {
    err = ApiError.validationError('GST Portal Error (RT_FIL_10): Return must be submitted / proceed-to-file before RETFILE.');
  } else if (errorCd === 'RET09001') {
    err = ApiError.providerError('GST portal summary is still being generated. Please try again in a few moments.', 502);
  } else {
    const catalogMatch = resolveGstnCatalogError(errorCd);

    if (catalogMatch) {
      err = catalogMatch;
    } else if (errorCd) {
      err = ApiError.providerError('Could not complete the request. Please try again.', 502);
    }
  }

  if (err && errorCd) {
    err.errorCd = errorCd;
  }

  return err;
}

/**
 * Handle and map errors from TaxPro upstream calls.
 *
 * SECURITY RULE:
 * - Never log URL, params, request config, request headers or whole axios error object.
 * - Map errors using only error.response?.status, error.code and server-side error_cd.
 * - Never forward raw provider message to the client.
 */
function handleTaxProError(error, operation) {
  if (error instanceof ApiError) {
    return error;
  }

  const status = error.response?.status;
  const code = error.code;

  let providerErrorCd = null;
  let providerMessage;
  let responseData = error.response?.data;

  if (typeof responseData === 'string') {
    try {
      responseData = JSON.parse(responseData);
    } catch {
      // responseData remains a string if unparseable
    }
  }

  if (responseData && typeof responseData === 'object') {
    providerErrorCd = responseData.error?.error_cd || responseData.error_cd;
    providerMessage = responseData.error?.message || responseData.message;
  }

  let mappedError;

  if (providerErrorCd) {
    mappedError = mapTaxProErrorCode(providerErrorCd);
  } else if (status === 412) {
    mappedError = ApiError.sessionExpired('Your GST Portal session has expired. Please verify OTP on GST Return Hub.');
    providerErrorCd = 'GSP102';
  } else if (status === 429) {
    mappedError = ApiError.rateLimited('Too many requests. Please wait and try again.');
  } else if (status >= 500) {
    mappedError = ApiError.providerDown('GST service is unavailable. Please try again later.');
  } else if (
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ERR_NETWORK' ||
    !error.response
  ) {
    mappedError = ApiError.providerDown('GST service is unavailable. Please try again later.');
  } else if (status === 401 || status === 403) {
    mappedError = ApiError.providerAuth('Could not complete the request. Please try again.');
  } else {
    mappedError = ApiError.providerError('Could not complete the request. Please try again.', 502);
  }

  if (providerErrorCd && mappedError && !mappedError.errorCd) {
    mappedError.errorCd = providerErrorCd;
  }

  const errorCdForLog = providerErrorCd ? getValidErrorCd(providerErrorCd) : undefined;

  logger.error(`TaxPro request failed during [${operation}]`, {
    status,
    code: mappedError.code,
    net_code: typeof code === 'string' ? code : undefined,
    error_cd: errorCdForLog,
    provider_msg: maskSensitive(providerMessage)
  });

  return mappedError;
}

/**
 * Compute TaxPro EVC HMAC-SHA256 signature supporting standard GSTN & TaxPro encoding modes.
 */
function computeTaxProEvcSignature(
  step1RawResponse,
  pan,
  otp,
  mode = process.env.TAXPRO_EVC_ENCODING || 'double'
) {
  const cleanPan = String(pan || '').trim().toUpperCase();
  const cleanOtp = String(otp || '').trim();
  const rawString = String(step1RawResponse || '');

  const b64_1 = Buffer.from(rawString, 'utf8').toString('base64');
  const b64_2 = Buffer.from(b64_1, 'utf8').toString('base64');

  const keyRaw = `${cleanPan}|${cleanOtp}`;
  const keyB64 = Buffer.from(keyRaw, 'utf8').toString('base64');

  let key;
  let data;

  switch (mode) {
    case 'std':
    case 'single':
      key = keyRaw;
      data = b64_1;
      break;
    case 'raw':
      key = keyRaw;
      data = rawString;
      break;
    case 'double':
      key = keyB64;
      data = b64_2;
      break;
    case 'single_b64key':
      key = keyB64;
      data = b64_1;
      break;
    case 'raw_b64key':
      key = keyB64;
      data = rawString;
      break;
    default:
      logger.warn(`Unknown EVC signature mode '${mode}'. Falling back to standard GSTN 'std' mode.`);
      key = keyRaw;
      data = b64_1;
  }

  const hmac = crypto.createHmac('sha256', key);
  hmac.update(data, 'utf8');

  return hmac.digest('base64');
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

/* -------------------------------------------------------------------------- */
/* GSTR-1 Summary validation                                                  */
/* -------------------------------------------------------------------------- */

const SEC_NM_ENUM = new Set([
  'AT', 'ATA', 'CDNUR', 'B2BA_4A', 'CDNURA', 'B2BA_4B', 'EXP', 'B2BA_6C', 'EXPA',
  'B2BA_SEZWOP', 'B2BA_SEZWP', 'B2B_4A', 'B2B_4B', 'B2B_6C', 'B2B_SEZWOP', 'B2B_SEZWP',
  'B2CL', 'B2CLA', 'B2CS', 'B2CSA', 'HSN', 'NIL', 'TTL_LIAB', 'TXPD', 'TXPDA',
  'DOC_ISSUE', 'CDNR', 'CDNRA', 'B2B', 'B2BA', 'SUPECOM', 'SUPECOMA', 'ECOM', 'ECOMA',
  'ECOM_REG', 'ECOM_DE', 'ECOM_SEZWOP', 'ECOM_SEZWP', 'ECOM_UNREG',
  'ECOMA_REG', 'ECOMA_DE', 'ECOMA_SEZWOP', 'ECOMA_SEZWP', 'ECOMA_UNREG'
]);

function isMultipleOf01(val) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return false;

  const scaled = Math.round(val * 100);
  return Math.abs(val * 100 - scaled) < 1e-8;
}

function assertSummaryNumber(val, field, loc, { allowNegative = false } = {}) {
  if (val === undefined || val === null) return;

  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw ApiError.providerError(`Summary ${loc}: '${field}' must be finite number.`, 502);
  }

  if (!allowNegative && val < 0) {
    throw ApiError.providerError(`Summary ${loc}: '${field}' must be >= 0.`, 502);
  }

  if (!isMultipleOf01(val)) {
    throw ApiError.providerError(`Summary ${loc}: '${field}' must be multiple of 0.01.`, 502);
  }
}

function validateGstr1SummarySection(section, loc) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw ApiError.providerError(`Summary ${loc}: section must be object.`, 502);
  }

  if (section.sec_nm && !SEC_NM_ENUM.has(section.sec_nm)) {
    throw ApiError.providerError(`Summary ${loc}: invalid sec_nm '${section.sec_nm}'.`, 502);
  }

  if (section.chksum !== undefined && typeof section.chksum !== 'string') {
    throw ApiError.providerError(`Summary ${loc}: chksum must be string.`, 502);
  }

  if (section.ttl_rec !== undefined) {
    if (!Number.isInteger(section.ttl_rec) || section.ttl_rec < 0) {
      throw ApiError.providerError(`Summary ${loc}: ttl_rec must be integer >= 0.`, 502);
    }
  }

  for (const key of [
    'ttl_val', 'ttl_igst', 'ttl_sgst', 'ttl_cgst', 'ttl_cess', 'ttl_tax',
    'ttl_expt_amt', 'ttl_ngsup_amt', 'ttl_nilsup_amt', 'ttl_doc_issued',
    'ttl_doc_cancelled', 'net_doc_issued', 'act_tax', 'act_igst', 'act_sgst',
    'act_cgst', 'act_val', 'act_cess'
  ]) {
    assertSummaryNumber(section[key], key, loc, { allowNegative: true });
  }
}

function validateGstr1SummaryResponse(data, gstin, period, isNil = false) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw ApiError.providerError('Invalid GSTR-1 summary response.', 502);
  }

  if (String(data.gstin || '').toUpperCase() !== String(gstin).toUpperCase()) {
    throw ApiError.providerError('Summary GSTIN mismatch.', 502);
  }

  if (String(data.ret_period || '').trim() !== String(period).trim()) {
    throw ApiError.providerError('Summary return period mismatch.', 502);
  }

  const isNilPortal = String(data.isnil || '').toUpperCase() === 'Y';

  if (isNil) {
    if (!isNilPortal) {
      throw ApiError.providerError(
        'GST portal did not explicitly confirm Nil return (isnil: "Y"). Nil filing aborted.',
        502
      );
    }

    return {
      gstin: String(data.gstin).toUpperCase(),
      ret_period: String(data.ret_period).trim(),
      isnil: 'Y'
    };
  }

  if (isNilPortal) {
    throw ApiError.providerError('Cannot file regular return: GST portal records confirm a Nil return.', 502);
  }

  if (typeof data.chksum !== 'string' || !data.chksum.trim()) {
    throw ApiError.providerError('Summary chksum is required for regular return.', 502);
  }

  if (!Array.isArray(data.sec_sum)) {
    throw ApiError.providerError('Summary sec_sum is required for regular return.', 502);
  }

  if (data.smryTyp !== undefined && data.smryTyp !== 'L') {
    throw ApiError.providerError('Summary smryTyp must be "L" when present.', 502);
  }

  if (data.newSumFlag !== undefined && typeof data.newSumFlag !== 'boolean') {
    throw ApiError.providerError('Summary newSumFlag must be boolean when present.', 502);
  }

  data.sec_sum.forEach((section, idx) => {
    validateGstr1SummarySection(section, `sec_sum #${idx + 1}`);
  });

  const body = {
    gstin: String(data.gstin).toUpperCase(),
    ret_period: String(data.ret_period).trim(),
    chksum: data.chksum,
    sec_sum: data.sec_sum
  };

  if (data.smryTyp !== undefined) body.smryTyp = data.smryTyp;
  if (data.newSumFlag !== undefined) body.newSumFlag = data.newSumFlag;

  return body;
}

function buildGstr1RetFileBody(rawSummary, gstin, period, isNil) {
  let summary;

  try {
    summary = typeof rawSummary === 'string' ? JSON.parse(rawSummary) : rawSummary;
  } catch {
    throw ApiError.providerError(
      'TaxPro GSTR-1 RETSUM did not return valid JSON required by the RETFILE schema.',
      502
    );
  }

  const data = summary?.data && typeof summary.data === 'object' ? summary.data : summary;
  const validated = validateGstr1SummaryResponse(data, gstin, period, isNil);

  return JSON.stringify(validated);
}

/* -------------------------------------------------------------------------- */
/* GSTR-3B RETFILE helpers                                                    */
/* -------------------------------------------------------------------------- */

const GSTR3B_FILE_FIELDS = [
  'gstin', 'ret_period', 'sup_details', 'inter_sup', 'eco_dtls',
  'itc_elg', 'inward_sup', 'tx_pmt', 'intr_ltfee', 'liab_breakup'
];

function buildGstr3bRetFileBody(summaryData, gstin, period, isNil) {
  if (isNil) {
    return { gstin, ret_period: period, isnil: 'Y' };
  }

  const src = summaryData?.data && typeof summaryData.data === 'object'
    ? summaryData.data
    : summaryData;

  if (!src || typeof src !== 'object' || Array.isArray(src)) {
    throw ApiError.providerError(
      'GSTR-3B final summary is missing. Cannot build the RETFILE request.',
      502
    );
  }

  if (src.gstin && String(src.gstin).toUpperCase() !== String(gstin).toUpperCase()) {
    throw ApiError.providerError(
      'GSTR-3B final summary does not match the requested GSTIN.',
      502
    );
  }

  const body = {};

  for (const key of GSTR3B_FILE_FIELDS) {
    if (src[key] !== undefined) body[key] = src[key];
  }

  body.gstin = gstin;
  body.ret_period = period;

  if (!body.sup_details || !body.itc_elg) {
    throw ApiError.providerError(
      'GSTR-3B final summary is incomplete (sup_details / itc_elg missing). Filing aborted.',
      502
    );
  }

  return body;
}

/* -------------------------------------------------------------------------- */
/* TaxPro response checker                                                    */
/* -------------------------------------------------------------------------- */

function checkTaxProResponse(data, operation) {
  if (!data || typeof data !== 'object') {
    logger.error(`TaxPro returned non-object response during [${operation}]`, {
      code: 'PROVIDER_ERROR'
    });

    throw ApiError.providerError('Could not complete the request. Please try again.', 502);
  }

  const statusCdRaw = data.status_cd;

  // Accept documented success body even without status_cd, but never if status_cd is explicit 0.
  const shape = OK_SHAPE[operation];

  if (
    shape &&
    shape(data) &&
    String(statusCdRaw ?? '') !== '0' &&
    !data.error?.error_cd
  ) {
    return data;
  }

  const statusCd = statusCdRaw === undefined || statusCdRaw === null
    ? undefined
    : String(statusCdRaw);

  if (statusCd === '0') {
    const errorCd = data.error?.error_cd;
    const mappedError = mapTaxProErrorCode(errorCd) ||
      ApiError.providerError('Could not complete the request. Please try again.', 502);

    logger.error(`TaxPro returned error status_cd:0 during [${operation}]`, {
      status: 200,
      code: mappedError.code,
      error_cd: getValidErrorCd(errorCd),
      provider_msg: maskSensitive(data.error?.message)
    });

    throw mappedError;
  }

  if (statusCd !== '1') {
    const isReadOperation = operation && (
      operation.startsWith('get') ||
      operation.startsWith('gsp:') ||
      operation === 'searchGstin'
    );

    if (
      isReadOperation &&
      (
        (data.gstin && data.lgnm) ||
        Array.isArray(data.EFiledlist) ||
        Array.isArray(data.b2b) ||
        Array.isArray(data.sec_sum) ||
        Array.isArray(data.b2cs) ||
        Array.isArray(data.cdnr) ||
        Array.isArray(data.exp) ||
        Array.isArray(data.hsn) ||
        data.sup_details ||
        data.itc_elg ||
        data.inter_sup ||
        data.inward_sup ||
        data.docdata ||
        data.data ||
        data.itcsumm ||
        Array.isArray(data.itc_categories) ||
        Array.isArray(data.sections) ||
        data.isnil === 'Y' ||
        (!data.error)
      )
    ) {
      return data;
    }

    logger.error(`TaxPro returned unexpected status_cd during [${operation}] (type: ${typeof data.status_cd})`, {
      code: 'PROVIDER_ERROR',
      status_cd_type: typeof data.status_cd,
      keys: Object.keys(data).slice(0, 12)
    });

    throw ApiError.providerError('Could not complete the request. Please try again.', 502);
  }

  return data;
}

const PERIOD_PLACEMENT = 'both';

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

class TaxProProvider {
  /**
   * @param {Object} options
   * @param {string} [options.baseURL]
   * @param {string} [options.aspid]
   * @param {string} [options.password]
   * @param {'legacy'|'current'} [options.apiProfile]
   * @param {'header'|'query'|'both'} [options.periodPlacement]
   * @param {string} [options.gstr1ActionRequired]
   * @param {Object} [options.httpClient] Injectable HTTP client for offline testing
   */
  constructor(options = {}) {
    this.baseURL = options.baseURL || process.env.TAXPRO_BASE_URL || 'https://gstsandbox.charteredinfo.com';

    let providerUrl;

    try {
      providerUrl = new URL(this.baseURL);
    } catch {
      throw new Error('TAXPRO_BASE_URL must be a valid HTTPS URL');
    }

    if (providerUrl.protocol !== 'https:') {
      throw new Error('TAXPRO_BASE_URL must use HTTPS');
    }

    if (
      providerUrl.username ||
      providerUrl.password ||
      providerUrl.port ||
      providerUrl.pathname !== '/' ||
      providerUrl.search ||
      providerUrl.hash
    ) {
      throw new Error('TAXPRO_BASE_URL must be an HTTPS origin without credentials, port, path, query, or fragment');
    }

    if (!['gstsandbox.charteredinfo.com', 'gstapi.charteredinfo.com'].includes(providerUrl.hostname.toLowerCase())) {
      throw new Error('TAXPRO_BASE_URL must use the official TaxPro sandbox or production host');
    }

    this.aspid = options.aspid !== undefined ? options.aspid : (process.env.TAXPRO_ASPID || '');
    this.password = options.password !== undefined ? options.password : (process.env.TAXPRO_PASSWORD || '');

    const rawProfile = (options.apiProfile || process.env.TAXPRO_API_PROFILE || 'legacy').trim().toLowerCase();
    this.apiProfile = rawProfile === 'lagency' ? 'legacy' : rawProfile;

    if (!['legacy', 'current'].includes(this.apiProfile)) {
      throw new Error('TAXPRO_API_PROFILE must be legacy or current');
    }

    this.periodPlacement = (
      options.periodPlacement ||
      process.env.TAXPRO_PERIOD_PLACEMENT ||
      PERIOD_PLACEMENT
    ).trim().toLowerCase();

    if (!['header', 'query', 'both'].includes(this.periodPlacement)) {
      throw new Error('TAXPRO_PERIOD_PLACEMENT must be header, query, or both');
    }

    this.gstr1ActionRequired = (
      options.gstr1ActionRequired !== undefined
        ? options.gstr1ActionRequired
        : (process.env.TAXPRO_GSTR1_ACTION_REQUIRED || '')
    ).trim().toUpperCase();

    // RETFILE can be slow on the GST side; give it its own, longer timeout.
    this.fileTimeoutMs = Number(options.fileTimeoutMs || process.env.TAXPRO_FILE_TIMEOUT_MS) || 60000;

    // What the EVC signature is computed over for GSTR-1:
    // 'raw' = RETSUM raw string, 'body' = RETFILE request body.
    // Empty = profile-based default: current -> body, legacy -> raw.
    const signOver = (
      options.evcSignOver !== undefined
        ? options.evcSignOver
        : (process.env.TAXPRO_EVC_SIGN_OVER || '')
    ).trim().toLowerCase();

    if (!['', 'raw', 'body', 'reconstructed'].includes(signOver)) {
      throw new Error('TAXPRO_EVC_SIGN_OVER must be raw, body, or reconstructed');
    }

    this.evcSignOver = signOver;

    // Injectable HTTP client for network-free testing
    this.httpClient = options.httpClient || axios.create({
      baseURL: this.baseURL,
      timeout: 20000,
      maxRedirects: 0
    });

    this.aspCallerGstin = options.aspCallerGstin || process.env.TAXPRO_ASP_GSTIN || '';
    this.ipUsr = options.ipUsr !== undefined ? options.ipUsr : (process.env.TAXPRO_GSP_IP_USR || '');

    const sessionKey = options.gspSecret || process.env.TAXPRO_GSP_SECRET || this.password;

    this.gspSession = options.gspSession || new TaxProGspSession({
      aspid: this.aspid,
      password: sessionKey,
      privateKeyPath: options.privateKeyPath,
      privateKeyPassphrase: options.privateKeyPassphrase,
      ipUsr: this.ipUsr,
      httpClient: this.httpClient
    });

    this.activeTokens = new Map();
  }

  /* ---------------------------------------------------------------------- */
  /* Token cache                                                            */
  /* ---------------------------------------------------------------------- */

  _setActiveToken(gstin, username, token) {
    const key = `${String(gstin).toUpperCase()}:${String(username).trim()}`;
    const ttlMinutes = Number(process.env.TAXPRO_TOKEN_TTL_MINUTES) || 330;

    this.activeTokens.set(key, {
      token,
      expiresAt: Date.now() + (ttlMinutes * 60 * 1000)
    });

    if (this.activeTokens.size > 1000) {
      const now = Date.now();

      for (const [k, v] of this.activeTokens.entries()) {
        if (v.expiresAt < now) this.activeTokens.delete(k);
      }
    }
  }

  _getActiveToken(gstin, username) {
    const key = `${String(gstin).toUpperCase()}:${String(username).trim()}`;
    const entry = this.activeTokens.get(key);

    if (entry && entry.expiresAt > Date.now()) {
      return entry.token;
    }

    if (entry) this.activeTokens.delete(key);

    return null;
  }

  getAspid() {
    return this.aspid !== undefined ? this.aspid : (process.env.TAXPRO_ASPID || '');
  }

  getPassword() {
    return this.password !== undefined ? this.password : (process.env.TAXPRO_PASSWORD || '');
  }

  getIpUsr() {
    return this.ipUsr !== undefined && this.ipUsr !== ''
      ? this.ipUsr
      : (process.env.TAXPRO_GSP_IP_USR || '');
  }

  getActiveToken(gstin, username) {
    return this._getActiveToken(gstin, username);
  }

  _identity(options = {}, extra = {}) {
    const gstin = String(options.gstin || extra.gstin || '').trim().toUpperCase();

    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin('A valid taxpayer GSTIN is required.');
    }

    const username = typeof options.username === 'string'
      ? options.username.trim()
      : (typeof extra.username === 'string' ? extra.username.trim() : '');

    if (!username && extra.requireUsername !== false) {
      throw ApiError.validationError('GST portal username is required.');
    }

    const token = options.token ||
      options.gstToken ||
      (username ? this._getActiveToken(gstin, username) : null);

    return { gstin, username, token };
  }

  _requireAsp() {
    const aspid = this.getAspid();
    const password = this.getPassword();

    if (!aspid || !password) {
      throw ApiError.providerError(
        'TaxPro ASP credentials (TAXPRO_ASPID, TAXPRO_PASSWORD) are not configured.',
        500
      );
    }

    return { aspid, password };
  }

  getCurrentGstr3bHeaders(gstin, username, token) {
    const ipUsr = this.getIpUsr();

    if (!ipUsr) {
      logger.error('TaxPro GSTR-3B request failed: TAXPRO_GSP_IP_USR is required for current profile');
      throw ApiError.providerError('TAXPRO_GSP_IP_USR is required for TaxPro return requests.', 500);
    }

    return {
      username,
      'auth-token': token || '',
      'state-cd': gstin.slice(0, 2),
      'ip-usr': ipUsr,
      txn: crypto.randomUUID().replace(/-/g, ''),
      api_version: '7.1',
      userrole: 'GSTR3B',
      rtn_typ: 'GSTR3B',
      'Content-Type': 'application/json'
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Public GSTIN search                                                    */
  /* ---------------------------------------------------------------------- */

  async searchGstin(gstin) {
    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    }

    if (!isValidGstin(this.aspCallerGstin)) {
      throw ApiError.providerError('TaxPro taxpayer search is not configured.', 502);
    }

    const response = await this.requestGspPublicApi('/commonapi/v1.1/search', {
      action: 'TP',
      gstin: this.aspCallerGstin,
      searchgstin: gstin
    }, 'gsp:searchTaxpayer');

    if (
      typeof response.gstin !== 'string' ||
      response.gstin.toUpperCase() !== gstin.toUpperCase() ||
      typeof response.lgnm !== 'string' ||
      !response.lgnm.trim()
    ) {
      throw ApiError.providerError('TaxPro taxpayer-search response shape is not recognized.', 502);
    }

    return {
      gstin: gstin.toUpperCase(),
      legalName: response.lgnm,
      tradeName: typeof response.tradeNam === 'string' ? response.tradeNam : (response.tradeName || null),
      status: typeof response.sts === 'string' ? response.sts : null,
      businessType: typeof response.ctb === 'string' ? response.ctb : null,
      registeredDate: typeof response.rgdt === 'string' ? response.rgdt : null,
      natureOfBusiness: typeof response.nba === 'string' || Array.isArray(response.nba) ? response.nba : null,
      verified: true
    };
  }

  async requestGspPublicApi(path, params, operation) {
    let headers;

    try {
      headers = await this.gspSession.getHeaders();
    } catch (error) {
      if (error instanceof ApiError) throw error;

      const safeReason = error && typeof error.message === 'string'
        ? error.message
        : 'TaxPro GSP signing-key configuration is invalid.';

      logger.error(`TaxPro GSP signing-key error during [${operation}]`, {
        code: 'PROVIDER_ERROR',
        reason: safeReason
      });

      throw ApiError.providerError('TaxPro GSP signing-key configuration is invalid.', 502);
    }

    try {
      const targetGstin = params?.gstin || this.aspCallerGstin;

      const gspHeaders = {
        ...headers,
        ...(targetGstin ? { gstin: targetGstin, GSTIN: targetGstin } : {}),
        ...(this.password ? { password: this.password } : {})
      };

      const response = await this.httpClient.get(path, { params, headers: gspHeaders });

      return checkTaxProResponse(response.data, operation);
    } catch (error) {
      throw handleTaxProError(error, operation);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Auth / OTP / EVC OTP                                                   */
  /* ---------------------------------------------------------------------- */

  async requestOtp(gstin, username) {
    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    }

    if (!username || typeof username !== 'string' || !username.trim()) {
      throw ApiError.validationError('Username is required.');
    }

    const { aspid, password } = this._requireAsp();
    const path = '/taxpayerapi/dec/v1.0/authenticate';

    const params = {
      action: 'OTPREQUEST',
      gstin: gstin.toUpperCase(),
      username: username.trim()
    };

    const headers = { aspid, password };

    try {
      const response = await this.httpClient.get(path, { params, headers });
      const data = checkTaxProResponse(response.data, 'requestOtp');

      return {
        status_cd: data.status_cd,
        message: 'OTP has been dispatched successfully to the registered mobile/email on GST portal.'
      };
    } catch (error) {
      throw handleTaxProError(error, 'requestOtp');
    }
  }

  async verifyOtp(gstin, username, otp) {
    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    }

    if (!username || typeof username !== 'string' || !username.trim()) {
      throw ApiError.validationError('Username is required.');
    }

    if (!otp || typeof otp !== 'string' || !/^[0-9]{4,8}$/.test(otp.trim())) {
      throw ApiError.validationError('OTP must be 4 to 8 digits.');
    }

    const { aspid, password } = this._requireAsp();
    const path = '/taxpayerapi/dec/v1.0/authenticate';

    const params = {
      action: 'AUTHTOKEN',
      gstin: gstin.toUpperCase(),
      username: username.trim(),
      OTP: otp.trim()
    };

    const headers = { aspid, password };

    try {
      const response = await this.httpClient.get(path, { params, headers });
      const data = checkTaxProResponse(response.data, 'verifyOtp');

      if (typeof data.auth_token !== 'string' || !data.auth_token.trim()) {
        throw ApiError.providerError('Could not complete the request. Please try again.', 502);
      }

      this._setActiveToken(gstin, username, data.auth_token);

      return {
        token: data.auth_token
      };
    } catch (error) {
      const errorCd = getErrCd(error);
      const cachedToken = this._getActiveToken(gstin, username);

      if (errorCd === 'AUTH403' && cachedToken) {
        try {
          const refreshed = await this.refreshToken(gstin, username, cachedToken);

          if (refreshed?.token) {
            this._setActiveToken(gstin, username, refreshed.token);
            return { token: refreshed.token };
          }
        } catch {
          logger.warn('TaxPro AUTH403: refresh failed, reusing cached token');
          return { token: cachedToken };
        }
      }

      throw handleTaxProError(error, 'verifyOtp');
    }
  }

  async refreshToken(gstin, username, token) {
    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    }

    if (!username || typeof username !== 'string' || !username.trim()) {
      throw ApiError.validationError('Username is required.');
    }

    if (!token || typeof token !== 'string' || !token.trim()) {
      throw ApiError.validationError('Auth token is required to refresh session.');
    }

    const { aspid, password } = this._requireAsp();
    const cleanToken = token.trim();
    const path = '/taxpayerapi/dec/v1.0/authenticate';

    const params = {
      action: 'REFRESHTOKEN',
      gstin: gstin.toUpperCase(),
      username: username.trim(),
      authtoken: cleanToken
    };

    const headers = {
      aspid,
      password,
      'auth-token': cleanToken,
      AuthToken: cleanToken
    };

    try {
      const response = await this.httpClient.get(path, { params, headers });
      const data = checkTaxProResponse(response.data, 'refreshToken');

      if (typeof data.auth_token !== 'string' || !data.auth_token.trim()) {
        throw ApiError.providerError('Could not complete the request. Please try again.', 502);
      }

      this._setActiveToken(gstin, username, data.auth_token);

      return {
        token: data.auth_token
      };
    } catch (error) {
      throw handleTaxProError(error, 'refreshToken');
    }
  }

  async requestEvcOtp(gstin, username, pan, formType, token, period) {
    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    }

    if (!username || typeof username !== 'string' || !username.trim()) {
      throw ApiError.validationError('Username is required.');
    }

    if (!pan || typeof pan !== 'string' || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.trim().toUpperCase())) {
      throw ApiError.validationError('Invalid PAN format. Must be 10 characters (e.g. ABCDE1234F).');
    }

    if (!formType || typeof formType !== 'string' || !formType.trim()) {
      throw ApiError.validationError('Form type is required for EVC OTP.');
    }

    if (!token || typeof token !== 'string' || !token.trim()) {
      throw ApiError.validationError('Auth token is required for EVC OTP request.');
    }

    const { aspid, password } = this._requireAsp();

    const cleanToken = token.trim();
    const cleanGstin = gstin.trim().toUpperCase();
    const cleanUser = username.trim();
    const cleanPan = pan.trim().toUpperCase();
    const cleanPeriod = (period || '').trim();
    const ipUsr = this.getIpUsr();

    const isCurrentGstr1 = this.apiProfile === 'current' &&
      cleanPeriod &&
      (formType.trim().toUpperCase() === 'R1' || formType.trim().toUpperCase() === 'GSTR1');

    if (this.apiProfile === 'current' && formType.trim().toUpperCase() === 'R1' && !isValidPeriod(period)) {
      throw ApiError.validationError('Return period (MMYYYY) is required for GSTR-1 EVC OTP.');
    }

    let lastError = null;

    if (isCurrentGstr1) {
      try {
        const params = {
          action: 'EVCOTP',
          aspid,
          pan: cleanPan,
          gstin: cleanGstin,
          username: cleanUser,
          authtoken: cleanToken,
          ret_periode: cleanPeriod,
          form_type: formType.trim().toUpperCase()
        };

        const response = await this.httpClient.get('/taxpayerapi/dec/v4.1/returns/gstr1', {
          params,
          headers: { password }
        });

        const data = checkTaxProResponse(response.data, 'requestEvcOtp');

        return {
          status_cd: data.status_cd,
          message: 'EVC OTP has been dispatched successfully to the registered mobile/email on GST portal.',
          token: cleanToken
        };
      } catch (error) {
        const errCd = getErrCd(error);

        if (
          errCd &&
          [
            'OTP0001', 'OTP0005', 'OTP0006', 'OTP0010',
            'AUTH002', 'AUTH003', 'AUTH4037', 'AUTH4038',
            'AUTH4033', 'EVC_REJECTED'
          ].includes(errCd)
        ) {
          throw handleTaxProError(error, 'requestEvcOtp');
        }

        logger.warn('GSTR-1 v4.1 EVCOTP route rejected upstream, falling back to universal authenticate endpoint', {
          error: safeErrorMessage(error),
          error_cd: errCd
        });

        lastError = error;
      }
    }

    const formTypeUpper = formType.trim().toUpperCase();

    const candidateTypes = isCurrentGstr1
      ? ['R1', 'GSTR1', 'GSTR-1']
      : (formTypeUpper === 'R3B' || formTypeUpper === 'GSTR3B' || formTypeUpper === 'GSTR-3B')
        ? ['R3B', 'GSTR3B', 'GSTR-3B']
        : [formTypeUpper];

    for (const cand of candidateTypes) {
      try {
        const authParams = {
          action: 'EVCOTP',
          gstin: cleanGstin,
          username: cleanUser,
          pan: cleanPan,
          form_type: cand
        };

        if (cleanPeriod) {
          authParams.ret_period = cleanPeriod;
        }

        if (this.apiProfile !== 'current') {
          authParams.aspid = aspid;
          authParams.authtoken = cleanToken;
        }

        const headers = {
          aspid,
          password,
          'auth-token': cleanToken,
          authtoken: cleanToken,
          ...(ipUsr ? { 'ip-usr': ipUsr } : {}),
          txn: crypto.randomUUID().replace(/-/g, '')
        };

        const response = await this.httpClient.get('/taxpayerapi/dec/v1.0/authenticate', {
          params: authParams,
          headers
        });

        const data = checkTaxProResponse(response.data, 'requestEvcOtp');

        return {
          status_cd: data.status_cd,
          message: 'EVC OTP has been dispatched successfully to the registered mobile/email on GST portal.',
          token: cleanToken
        };
      } catch (authErr) {
        lastError = authErr;

        logger.debug(`EVCOTP authenticate with form_type=${cand} failed`, {
          error_cd: getValidErrorCd(getErrCd(authErr))
        });

        const errCd = getErrCd(authErr);

        if (
          errCd &&
          [
            'OTP0001', 'OTP0005', 'OTP0006', 'OTP0010',
            'AUTH002', 'AUTH003', 'AUTH4037', 'AUTH4038',
            'AUTH4033', 'GSP052', 'GSP053', 'GEN5001'
          ].includes(errCd)
        ) {
          break;
        }

        const status = authErr?.response?.status;
        const isRouteError = status === 404 || status === 405 || errCd === 'GEN5001';

        if (!isRouteError) {
          break;
        }
      }
    }

    const errorCd = getErrCd(lastError);

    if (SESSION_ERROR_CODES.includes(errorCd) && cleanToken && cleanUser) {
      try {
        logger.info('TaxPro session token expired during EVCOTP. Attempting silent auto-refresh...', {
          error_cd: getValidErrorCd(errorCd)
        });

        const refreshRes = await this.refreshToken(cleanGstin, cleanUser, cleanToken);

        if (refreshRes?.token && refreshRes.token !== cleanToken) {
          this._setActiveToken(cleanGstin, cleanUser, refreshRes.token);
          return await this.requestEvcOtp(cleanGstin, cleanUser, cleanPan, formType, refreshRes.token, cleanPeriod);
        }
      } catch {
        // Fall through to error handler
      }
    }

    throw handleTaxProError(lastError, 'requestEvcOtp');
  }

  /* ---------------------------------------------------------------------- */
  /* Return tracking                                                        */
  /* ---------------------------------------------------------------------- */

  async getReturnsSummary(gstin, period, gstToken) {
    if (!isValidPeriod(period)) {
      throw ApiError.validationError('Return tracking requires a valid MMYYYY period.');
    }

    const month = Number(period.slice(0, 2));
    const year = Number(period.slice(2));
    const startYear = month >= 4 ? year : year - 1;
    const financialYear = `${startYear}-${String(startYear + 1).slice(-2)}`;

    const response = await this.requestGspPublicApi('/commonapi/v1.0/returns', {
      action: 'RETTRACK',
      gstin: gstin.toUpperCase(),
      fy: financialYear
    }, 'gsp:trackReturns');

    if (Array.isArray(response.EFiledlist)) {
      const filings = response.EFiledlist.map((item) => ({
        type: String(item.rtntype || '').toUpperCase(),
        arn: String(item.arn || ''),
        period: String(item.ret_prd || ''),
        date: String(item.dof || ''),
        status: String(item.status || 'Filed'),
        mode: String(item.mof || 'ONLINE')
      }));

      const periodMap = new Map();

      for (const f of filings) {
        if (!periodMap.has(f.period)) {
          periodMap.set(f.period, {
            period: f.period,
            financialYear,
            gstr1: 'NOT_FILED',
            gstr2b: 'GENERATED',
            gstr3b: 'NOT_FILED'
          });
        }

        const record = periodMap.get(f.period);

        if (f.type === 'GSTR1') record.gstr1 = f.status.toUpperCase();
        if (f.type === 'GSTR3B') record.gstr3b = f.status.toUpperCase();
      }

      return {
        gstin: gstin.toUpperCase(),
        financialYear,
        availablePeriods: Array.from(periodMap.values()),
        filings
      };
    }

    throw ApiError.providerError(
      `TaxPro return-tracking response received for ${financialYear}, but its mapper requires a sanitized provider sample.`,
      502
    );
  }

  async findFiledArn(gstin, period, returnType = 'GSTR1') {
    try {
      const summary = await this.getReturnsSummary(gstin, period);
      const hit = (summary.filings || []).find((f) =>
        f.type === String(returnType).toUpperCase() && f.period === period && f.arn
      );

      return hit ? hit.arn : null;
    } catch (err) {
      logger.warn('findFiledArn could not confirm filing status', {
        error_cd: getValidErrorCd(getErrCd(err))
      });

      return null;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Raw return fetch                                                       */
  /* ---------------------------------------------------------------------- */

  async getReturn(type, gstin, period, token, username = '') {
    if (!token || typeof token !== 'string' || !token.trim()) {
      throw ApiError.sessionExpired('Please verify OTP again to fetch live GST returns.');
    }

    const normType = (type || '').toUpperCase();

    let path;
    let action;
    let extraParams = {};

    const sendHeaderPeriod = this.periodPlacement === 'header' || this.periodPlacement === 'both';
    const sendQueryPeriod = this.periodPlacement === 'query' || this.periodPlacement === 'both';

    switch (normType) {
      case 'GSTR1':
        path = this.apiProfile === 'current'
          ? '/taxpayerapi/dec/v4.1/returns/gstr1'
          : '/taxpayerapi/dec/v2.0/returns/gstr1';
        action = 'B2B';
        extraParams = {};

        if (this.apiProfile === 'current') {
          if (sendQueryPeriod) extraParams.ret_period = period;
        } else {
          extraParams.ret_period = period;
        }

        break;

      case 'GSTR3B':
        path = this.apiProfile === 'current'
          ? '/taxpayerapi/dec/v7.1/returns/gstr3b'
          : '/taxpayerapi/dec/v0.3/returns/gstr3b';
        action = 'RETSUM';
        extraParams = {};

        if (this.apiProfile === 'current') {
          if (sendQueryPeriod) extraParams.ret_period = period;
        } else {
          extraParams.ret_period = period;
        }

        break;

      case 'GSTR2B':
        path = this.apiProfile === 'current'
          ? '/taxpayerapi/dec/v4.2/returns/gstr2b'
          : '/taxpayerapi/dec/v1.0/returns/gstr2b';
        action = 'GET2B';
        extraParams = {};

        if (this.apiProfile === 'current') {
          if (sendQueryPeriod) {
            extraParams.ret_period = period;
            extraParams.rtnprd = period;
          }
        } else {
          extraParams.ret_period = period;
          extraParams.rtnprd = period;
        }

        break;

      case 'GSTR2A':
        path = '/taxpayerapi/dec/v1.0/returns/gstr2a';
        action = 'B2B';
        extraParams = { ret_period: period };
        break;

      default:
        throw ApiError.validationError(`Unsupported return type: ${type}`);
    }

    const params = this.apiProfile === 'current'
      ? {
        action,
        gstin,
        ...(normType === 'GSTR1' ? { username: username || '' } : {}),
        ...extraParams
      }
      : {
        action,
        gstin,
        username: username || '',
        ...extraParams
      };

    const headers = this.apiProfile === 'current' && normType === 'GSTR3B'
      ? this.getCurrentGstr3bHeaders(gstin, username, token)
      : {
        aspid: this.getAspid(),
        password: this.getPassword(),
        'auth-token': token
      };

    const safeTxn = crypto.randomUUID().replace(/-/g, '').toLowerCase();

    if (this.apiProfile === 'current') {
      const stateCd = typeof gstin === 'string' && gstin.length >= 2 ? gstin.slice(0, 2) : '';
      const ipUsr = this.getIpUsr();

      if (!ipUsr) {
        logger.error('TaxPro return request failed: TAXPRO_GSP_IP_USR is required for current profile');
        throw ApiError.providerError('TAXPRO_GSP_IP_USR is required for TaxPro return requests.', 500);
      }

      if (normType !== 'GSTR3B') {
        Object.assign(headers, {
          gstin,
          username: username || '',
          'state-cd': stateCd,
          txn: safeTxn,
          'ip-usr': ipUsr
        });

        if (sendHeaderPeriod) {
          headers.ret_period = period;
        }
      }
    } else {
      Object.assign(headers, {
        txn: safeTxn
      });
    }

    try {
      logger.debug(`[TXN DEBUG] normType: ${normType} | txn: ${headers.txn} | Length: ${headers.txn?.length} | HasHyphen: ${headers.txn?.includes('-')}`);

      const response = await this.httpClient.get(path, { params, headers });
      const data = checkTaxProResponse(response.data, `getReturn:${normType}`);

      return data;
    } catch (error) {
      const errorCd = getErrCd(error);

      if (SESSION_ERROR_CODES.includes(errorCd) && token && username) {
        try {
          logger.info('TaxPro session token expired. Attempting silent auto-refresh...', {
            error_cd: getValidErrorCd(errorCd)
          });

          const refreshRes = await this.refreshToken(gstin, username, token);

          if (refreshRes?.token) {
            headers['auth-token'] = refreshRes.token;
            this._setActiveToken(gstin, username, refreshRes.token);

            const retryRes = await this.httpClient.get(path, { params, headers });
            return checkTaxProResponse(retryRes.data, `getReturn:${normType}:retry`);
          }
        } catch {
          // Fall through to standard error handler
        }
      }

      if (normType === 'GSTR1' && action === 'B2B') {
        if (errorCd === 'RET13509' || errorCd === 'RET13510' || errorCd === 'RET09001') {
          try {
            const sumParams = { ...params, action: 'RETSUM' };

            logger.debug(`TaxPro GSTR-1 B2B empty (${errorCd}); attempting RETSUM`);

            const sumRes = await this.httpClient.get(path, { params: sumParams, headers });
            const sumData = checkTaxProResponse(sumRes.data, `getReturn:${normType}:RETSUM`);

            return sumData;
          } catch (sumErr) {
            try {
              if (token && typeof this.getGstr1RetSum === 'function') {
                const verifiedSumRaw = await this.getGstr1RetSum(gstin, period, username, token);
                const parsed = safeParseJson(verifiedSumRaw);

                if (parsed) {
                  const checked = checkTaxProResponse(parsed, `getReturn:${normType}:RETSUM`);
                  return checked?.data && typeof checked.data === 'object' ? checked.data : checked;
                }

                return { raw: verifiedSumRaw };
              }
            } catch {
              // fall through to clean empty shape
            }

            const sumErrorCd = getErrCd(sumErr);

            if (sumErrorCd === 'RET13509' || sumErrorCd === 'RET13510') {
              return { uiOnly: true, empty: true, gstin, fp: period, b2b: [], sec_sum: [] };
            }
          }
        }
      }

      if (normType === 'GSTR3B') {
        try {
          if (token && typeof this.getGstr3bRetSum === 'function') {
            const sum3b = await this.getGstr3bRetSum(gstin, period, { username, token });
            return sum3b;
          }
        } catch {
          // fall through to standard error handler
        }
      }

      throw handleTaxProError(error, `getReturn:${normType}`);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* GSTR-1 Save / Submit / Proceed / Status                                */
  /* ---------------------------------------------------------------------- */

  async saveGstr1(payload, options = {}) {
    const gstin = options.gstin || payload?.gstin;
    const username = typeof options.username === 'string' ? options.username.trim() : '';
    const period = options.period || payload?.fp;

    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin('A valid taxpayer GSTIN is required to save GSTR-1.');
    }

    if (!username) {
      throw ApiError.validationError('GST portal username is required to save GSTR-1.');
    }

    if (!isValidPeriod(period)) {
      throw ApiError.validationError('A valid MMYYYY return period is required to save GSTR-1.');
    }

    const cleaned = cleanSaveValue(payload);

    if (!isPlainObject(cleaned) || Object.keys(cleaned).length === 0) {
      throw ApiError.validationError('GSTR-1 payload must be a valid non-empty JSON object.');
    }

    if (cleaned.gstin && String(cleaned.gstin).toUpperCase() !== String(gstin).toUpperCase()) {
      throw ApiError.validationError('GSTR-1 payload GSTIN does not match request GSTIN.');
    }

    if (cleaned.fp && String(cleaned.fp).trim() !== String(period).trim()) {
      throw ApiError.validationError('GSTR-1 payload financial period does not match request period.');
    }

    const token = options.token ||
      options.gstToken ||
      this._getActiveToken(gstin, username.trim());

    if (!token || typeof token !== 'string' || !token.trim()) {
      throw ApiError.sessionExpired(
        'A current GST Portal auth token is required to save GSTR-1. Please verify OTP again.'
      );
    }

    const path = this.apiProfile === 'current'
      ? '/taxpayerapi/dec/v4.1/returns/gstr1'
      : '/taxpayerapi/dec/v2.0/returns/gstr1';

    const params = this.apiProfile === 'current'
      ? { action: 'RETSAVE', gstin, ret_period: period }
      : {
        action: 'RETSAVE',
        aspid: this.getAspid(),
        gstin,
        username,
        authtoken: token || '',
        ret_period: period
      };

    const headers = {
      aspid: this.getAspid(),
      password: this.getPassword(),
      'auth-token': token || '',
      authtoken: token || '',
      gstin: gstin.toUpperCase(),
      ret_period: period,
      rtn_typ: 'GSTR1',
      userrole: 'GSTR1',
      api_version: this.apiProfile === 'current' ? '4.1' : '2.1',
      'state-cd': gstin.slice(0, 2),
      'Content-Type': 'application/json'
    };

    try {
      logger.debug(`TaxPro GSTR-1 RETSAVE dispatched for period ${period}`);

      const response = await this.httpClient.put(path, cleaned, { params, headers });
      const data = checkTaxProResponse(response.data, 'saveGstr1');
      const refId = requireReferenceId(data, 'TaxPro RETSAVE');

      return {
        success: true,
        reference_id: refId,
        ref_id: refId,
        data
      };
    } catch (error) {
      throw handleTaxProError(error, 'saveGstr1');
    }
  }

  async trackStatus(refId, options = {}) {
    const resolvedRefId = typeof refId === 'string' ? refId : (refId?.reference_id || refId?.ref_id);
    const effectiveRefId = resolvedRefId || options.reference_id || options.ref_id;

    if (!effectiveRefId) {
      throw ApiError.validationError('A reference id is required to track the return status.');
    }

    const { gstin, username, token } = this._identity(options);

    if (!token) {
      throw ApiError.sessionExpired('A current GST Portal auth token is required to track status.');
    }

    const path = '/taxpayerapi/dec/v1.1/returns';

    const params = {
      action: 'RETSTATUS',
      gstin,
      username,
      ref_id: effectiveRefId,
      reference_id: effectiveRefId,
      ...(options.isSync ? { isSync: options.isSync } : {})
    };

    if (this.apiProfile !== 'current') {
      params.aspid = this.getAspid();
      params.authtoken = token;
    }

    const cleanGstin = gstin ? String(gstin).trim().toUpperCase() : '';
    const stateCd = cleanGstin.length >= 2 ? cleanGstin.slice(0, 2) : '';
    const safeTxn = crypto.randomUUID().replace(/-/g, '').toLowerCase();

    const headers = {
      aspid: this.getAspid(),
      password: this.getPassword(),
      'auth-token': token,
      authtoken: token,
      'state-cd': stateCd,
      gstin: cleanGstin,
      txn: safeTxn
    };

    try {
      logger.debug('TaxPro RETSTATUS dispatched');

      const response = await this.httpClient.get(path, { params, headers });
      const data = checkTaxProResponse(response.data, 'trackStatus');

      const innerData = data?.data && typeof data.data === 'object' ? data.data : data;

      const nestedStatus = String(innerData?.status_cd || '').toUpperCase();
      const topLevelStatus = String(data?.status_cd || '').toUpperCase();

      let statusCd = 'IP';

      if (nestedStatus === 'PE' || nestedStatus === 'ER' || nestedStatus === '0') {
        statusCd = nestedStatus === 'PE' ? 'PE' : 'ER';
      } else if (topLevelStatus === 'PE' || topLevelStatus === 'ER' || topLevelStatus === '0') {
        statusCd = topLevelStatus === 'PE' ? 'PE' : 'ER';
      } else if (innerData?.error_report || data?.error_report || innerData?.error?.error_cd || data?.error?.error_cd) {
        statusCd = 'ER';
      } else if (
        nestedStatus === 'P' ||
        topLevelStatus === 'P' ||
        nestedStatus === '1' ||
        topLevelStatus === '1'
      ) {
        statusCd = 'P';
      } else if (nestedStatus === 'IP' || topLevelStatus === 'IP') {
        statusCd = 'IP';
      }

      return {
        success: true,
        status_cd: statusCd,
        form_typ: innerData?.form_typ || data?.form_typ || 'GSTR1',
        error_report: innerData?.error_report || data?.error_report || null,
        error_cd: innerData?.error?.error_cd || data?.error?.error_cd || innerData?.error_cd || data?.error_cd || null,
        data
      };
    } catch (error) {
      throw handleTaxProError(error, 'trackStatus');
    }
  }

  async proceedToFile(period, options = {}) {
    const { gstin, username, token } = this._identity(options);

    if (!isValidPeriod(period)) {
      throw ApiError.validationError('A valid MMYYYY return period is required to proceed with filing.');
    }

    if (!token || typeof token !== 'string' || !token.trim()) {
      throw ApiError.sessionExpired('A current GST Portal auth token is required to proceed with filing.');
    }

    const rtnTyp = (options.returnType || 'GSTR1').toUpperCase();
    const cleanGstin = gstin.trim().toUpperCase();
    const cleanPeriod = period.trim();
    const cleanToken = token.trim();
    const stateCd = cleanGstin.slice(0, 2);

    const candidateConfigs = [
      {
        path: '/taxpayerapi/dec/v1.0/returns/gstr',
        action: 'PROCEEDFILE',
        apiVersion: '1.0'
      },
      {
        path: '/taxpayerapi/dec/v1.1/returns/gstrptf',
        action: 'RETNEWPTF',
        apiVersion: '1.1'
      },
      {
        path: '/taxpayerapi/dec/v1.1/returns/gstr',
        action: 'PROCEEDFILE',
        apiVersion: '1.1'
      }
    ];

    const body = {
      gstin: cleanGstin,
      ret_period: cleanPeriod,
      ...(options.form_no ? { form_no: options.form_no, FormNo: options.form_no } : {}),
      ...(options.isNil === true ? { isNil: 'Y' } : {}),
      ...(options.payload ? { jGSTR: options.payload } : {})
    };

    let lastError = null;

    for (const config of candidateConfigs) {
      const safeTxn = crypto.randomUUID().replace(/-/g, '').toLowerCase();
      const path = config.path;

      const params = {
        action: config.action,
        gstin: cleanGstin,
        username,
        ret_period: cleanPeriod,
        form_no: rtnTyp
      };

      if (this.apiProfile !== 'current') {
        params.aspid = this.getAspid();
        params.authtoken = cleanToken;
      }

      const headers = {
        aspid: this.getAspid(),
        password: this.getPassword(),
        'auth-token': cleanToken,
        authtoken: cleanToken,
        gstin: cleanGstin,
        ret_period: cleanPeriod,
        rtn_typ: rtnTyp,
        userrole: rtnTyp,
        api_version: config.apiVersion,
        'state-cd': stateCd,
        txn: safeTxn,
        'Content-Type': 'application/json'
      };

      try {
        logger.debug(
          `TaxPro PROCEEDFILE dispatched via ${path} (action: ${config.action}, period: ${cleanPeriod}, FormNo: ${rtnTyp}, isNil: ${Boolean(options.isNil)})`
        );

        const response = await this.httpClient.post(path, body, { params, headers });
        const data = checkTaxProResponse(response.data, 'proceedToFile');

        const refId = getReferenceId(data);
        const isSync = data?.isSync || data?.data?.isSync || (data?.status_cd === '1' && !refId ? 'Y' : undefined);

        return {
          success: true,
          reference_id: refId,
          ref_id: refId,
          isSync: isSync === 'Y' ? 'Y' : undefined,
          data
        };
      } catch (error) {
        lastError = error;

        logger.debug(`proceedToFile via ${path} (${config.action}) note: ${safeErrorMessage(error)}`);

        if (!isSafeConfigRetryError(error)) break;
      }
    }

    throw handleTaxProError(lastError, 'proceedToFile');
  }

  async submitGstr1(period, options = {}) {
    const { gstin, username, token } = this._identity(options);

    if (!isValidPeriod(period)) {
      throw ApiError.validationError('A valid MMYYYY return period is required to submit GSTR-1.');
    }

    if (!token || typeof token !== 'string' || !token.trim()) {
      throw ApiError.sessionExpired('A current GST Portal auth token is required to submit GSTR-1.');
    }

    const cleanPeriod = period.trim();
    const stateCd = gstin.slice(0, 2);
    const safeTxn = crypto.randomUUID().replace(/-/g, '').toLowerCase();

    const path = this.apiProfile === 'current'
      ? '/taxpayerapi/dec/v4.1/returns/gstr1'
      : '/taxpayerapi/dec/v2.0/returns/gstr1';

    const baseParams = {
      gstin: gstin.toUpperCase(),
      username,
      ret_period: cleanPeriod,
      ...(this.apiProfile === 'current'
        ? {}
        : {
          aspid: this.getAspid(),
          authtoken: token
        })
    };

    const candidateParams = [
      { action: 'RETSUBMIT', ...baseParams },
      { ...baseParams }
    ];

    const requestBody = {
      gstin: gstin.toUpperCase(),
      ret_period: cleanPeriod
    };

    // Official Submit request schema allows generate_summary only as "Y".
    if (options.generate_summary !== undefined && options.generate_summary !== null) {
      const gen = String(options.generate_summary).trim().toUpperCase();

      if (gen !== 'Y') {
        throw ApiError.validationError('generate_summary must be "Y" when provided.');
      }

      requestBody.generate_summary = 'Y';
    } else {
      requestBody.generate_summary = 'Y';
    }

    const headers = {
      aspid: this.getAspid(),
      password: this.getPassword(),
      'auth-token': token,
      authtoken: token,
      gstin: gstin.toUpperCase(),
      ret_period: cleanPeriod,
      rtn_typ: 'GSTR1',
      userrole: 'GSTR1',
      api_version: this.apiProfile === 'current' ? '4.1' : '2.1',
      'state-cd': stateCd,
      txn: safeTxn,
      'Content-Type': 'application/json'
    };

    let lastError = null;

    for (const params of candidateParams) {
      try {
        logger.debug(`TaxPro GSTR-1 Submit dispatched for period ${cleanPeriod} (action: ${params.action || 'none'})`);

        const response = await this.httpClient.post(path, requestBody, { params, headers });
        const data = checkTaxProResponse(response.data, 'submitGstr1');
        const refId = requireReferenceId(data, 'GSTR-1 submit');

        return {
          success: true,
          reference_id: refId,
          ref_id: refId,
          data
        };
      } catch (err) {
        lastError = err;

        logger.debug(`submitGstr1 attempt (action: ${params.action || 'none'}) returned: ${safeErrorMessage(err)}`);

        if (!isSafeConfigRetryError(err)) break;
      }
    }

    if (typeof this.proceedToFile === 'function') {
      try {
        logger.info(
          `Direct submit unconfirmed; invoking proceedToFile fallback for [${gstin} - ${cleanPeriod}] (isNil: ${Boolean(options.isNil)})...`
        );

        const procRes = await this.proceedToFile(cleanPeriod, {
          gstin,
          username,
          token,
          isNil: options.isNil
        });

        const fallbackRefId = procRes?.reference_id || procRes?.ref_id || null;

        if (!fallbackRefId && procRes?.isSync !== 'Y') {
          throw ApiError.providerError(
            'GSTR-1 submit fallback did not return reference_id and was not synchronous. Submit was not confirmed.',
            502
          );
        }

        return {
          success: true,
          reference_id: fallbackRefId,
          ref_id: fallbackRefId,
          isSync: procRes?.isSync,
          data: procRes?.data
        };
      } catch (procErr) {
        logger.debug(`proceedToFile fallback after submit error note: ${safeErrorMessage(procErr)}`);
      }
    }

    throw handleTaxProError(lastError, 'submitGstr1');
  }

  /* ---------------------------------------------------------------------- */
  /* GSTR-1 RETSUM                                                          */
  /* ---------------------------------------------------------------------- */

  async _getGstr1RetSumRaw(gstin, period, username, token, isNil = false) {
    if (!isValidGstin(gstin)) {
      throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    }

    if (!isValidPeriod(period)) {
      throw ApiError.validationError('Return period must be MMYYYY format.');
    }

    if (!username || typeof username !== 'string' || !username.trim()) {
      throw ApiError.validationError('Username is required.');
    }

    if (!token || typeof token !== 'string' || !token.trim()) {
      throw ApiError.validationError('Auth token is required for GSTR-1 summary.');
    }

    const { aspid, password } = this._requireAsp();

    const cleanToken = token.trim();
    const cleanGstin = gstin.trim().toUpperCase();
    const cleanUser = username.trim();
    const cleanPeriod = period.trim();
    const stateCd = cleanGstin.slice(0, 2);

    const path = this.apiProfile === 'current'
      ? '/taxpayerapi/dec/v4.1/returns/gstr1'
      : '/taxpayerapi/dec/v2.0/returns/gstr1';

    const params = {
      action: 'RETSUM',
      gstin: cleanGstin,
      username: cleanUser,
      ret_period: cleanPeriod,
      ...(this.apiProfile === 'current'
        ? { smrytyp: 'L' }
        : {
          aspid,
          authtoken: cleanToken
        })
    };

    const safeTxn = crypto.randomUUID().replace(/-/g, '').toLowerCase();

    const headers = {
      aspid,
      password,
      'auth-token': cleanToken,
      authtoken: cleanToken,
      gstin: cleanGstin,
      ret_period: cleanPeriod,
      'state-cd': stateCd,
      userrole: 'GSTR1',
      rtn_typ: 'GSTR1',
      api_version: this.apiProfile === 'current' ? '4.1' : '2.1',
      txn: safeTxn,
      'Content-Type': 'application/json'
    };

    try {
      logger.debug(`TaxPro GSTR-1 RETSUM dispatched via ${path} for period ${cleanPeriod}`);

      const response = await this.httpClient.get(path, {
        params,
        headers,
        responseType: 'text',
        timeout: this.fileTimeoutMs
      });

      const rawBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

      try {
        const parsed = JSON.parse(rawBody);

        if (parsed && (String(parsed.status_cd) === '0' || parsed.error?.error_cd)) {
          checkTaxProResponse(parsed, 'getGstr1RetSum');
        }
      } catch (parseErr) {
        if (parseErr instanceof ApiError) throw parseErr;
      }

      return rawBody;
    } catch (error) {
      const errorCd = getErrCd(error);

      if (errorCd === 'RET09001') {
        logger.info(
          `GST portal summary generation in progress (RET09001) for [${cleanGstin} - ${cleanPeriod}]. Waiting 4 seconds for GSTN to calculate summary and retrying...`
        );

        try {
          await new Promise((resolve) => setTimeout(resolve, 4000));

          const retryRes = await this.httpClient.get(path, {
            params,
            headers,
            responseType: 'text',
            timeout: this.fileTimeoutMs
          });

          const retryRaw = typeof retryRes.data === 'string' ? retryRes.data : JSON.stringify(retryRes.data);

          try {
            const parsed = JSON.parse(retryRaw);

            if (parsed && (String(parsed.status_cd) === '0' || parsed.error?.error_cd)) {
              checkTaxProResponse(parsed, 'getGstr1RetSum');
            }
          } catch (pErr) {
            if (pErr instanceof ApiError) throw pErr;
          }

          return retryRaw;
        } catch {
          // Fall through to standard error handler if retry also fails
        }
      }

      if (SESSION_ERROR_CODES.includes(errorCd) && cleanToken && cleanUser) {
        try {
          logger.info('TaxPro session token expired during RETSUM. Attempting silent auto-refresh...', {
            error_cd: getValidErrorCd(errorCd)
          });

          const refreshRes = await this.refreshToken(cleanGstin, cleanUser, cleanToken);

          if (refreshRes?.token) {
            headers['auth-token'] = refreshRes.token;
            headers.authtoken = refreshRes.token;
            this._setActiveToken(cleanGstin, cleanUser, refreshRes.token);

            const retryRes = await this.httpClient.get(path, {
              params,
              headers,
              responseType: 'text',
              timeout: this.fileTimeoutMs
            });

            return typeof retryRes.data === 'string' ? retryRes.data : JSON.stringify(retryRes.data);
          }
        } catch {
          // Fall through to standard error handler
        }
      }

      throw handleTaxProError(error, 'getGstr1RetSum');
    }
  }

  /**
   * Backward-compatible raw RETSUM.
   * Supports both positional and options-based calls.
   */
  async getGstr1RetSum(gstin, period, usernameOrOptions, token, isNil) {
    if (usernameOrOptions && typeof usernameOrOptions === 'object' && !Array.isArray(usernameOrOptions)) {
      const opts = usernameOrOptions;

      return this._getGstr1RetSumRaw(
        gstin,
        period,
        opts.username || '',
        opts.token || opts.gstToken,
        opts.isNil === true
      );
    }

    return this._getGstr1RetSumRaw(gstin, period, usernameOrOptions, token, isNil === true);
  }

  /**
   * Parsed GSTR-1 summary for nil confirmation / UI / validation.
   * Returns validated summary object, not raw string.
   */
  async getGstr1Summary(gstin, period, options = {}) {
    const opts = options || {};

    const username = typeof opts === 'string' ? '' : (opts.username || '');
    const token = typeof opts === 'string' ? '' : (opts.token || opts.gstToken);
    const isNil = typeof opts === 'object' && opts.isNil === true;

    const raw = await this._getGstr1RetSumRaw(gstin, period, username, token, isNil);
    const parsed = safeParseJson(raw);

    if (!parsed) {
      throw ApiError.providerError('TaxPro GSTR-1 RETSUM did not return valid JSON.', 502);
    }

    const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;

    return validateGstr1SummaryResponse(data, gstin, period, isNil);
  }

  async fetchGstr1Summary(gstin, period, options = {}) {
    return this.getGstr1Summary(gstin, period, options);
  }

  /* ---------------------------------------------------------------------- */
  /* GSTR-1 RETFILE                                                         */
  /* ---------------------------------------------------------------------- */

  async fileGstr1(period, options = {}) {
    const { gstin, username, token: initialToken } = this._identity(options);
    let token = initialToken;

    const cleanPan = options.pan ? String(options.pan).trim().toUpperCase() : '';
    const cleanOtp = options.otp ? String(options.otp).trim() : '';

    if (!isValidPeriod(period)) {
      throw ApiError.validationError('A valid MMYYYY return period is required to file GSTR-1.');
    }

    if (!cleanPan || !cleanOtp) {
      throw ApiError.validationError('PAN and EVC OTP are required to file GSTR-1 with the configured RETFILE schema.');
    }

    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleanPan) || !/^[A-Za-z0-9]{4,8}$/.test(cleanOtp)) {
      throw ApiError.validationError('Invalid PAN or EVC OTP format for GSTR-1 filing.');
    }

    const { aspid, password } = this._requireAsp();

    if (!token) {
      throw ApiError.sessionExpired('Auth token is required to file GSTR-1. Please verify OTP again.');
    }

    try {
      let step1Raw = options.step1Response;

      if (!step1Raw) {
        try {
          step1Raw = await this.getGstr1RetSum(gstin, period, username, token, options.isNil === true);

          const refreshedToken = this._getActiveToken(gstin, username);
          if (refreshedToken) {
            token = refreshedToken;
          }
        } catch (sumErr) {
          if (options.isNil === true && TAXPRO_ALLOW_NIL_SUMMARY_FALLBACK) {
            logger.info(
              `Nil GSTR-1 summary call note: ${sumErr.message}. Falling back to canonical Nil payload for RETFILE because TAXPRO_ALLOW_NIL_SUMMARY_FALLBACK=true.`
            );

            step1Raw = JSON.stringify({
              status_cd: '1',
              gstin: gstin.toUpperCase(),
              ret_period: period,
              isnil: 'Y'
            });
          } else {
            throw sumErr;
          }
        }
      }

      const rawString = typeof step1Raw === 'string' ? step1Raw : JSON.stringify(step1Raw);

      const path = this.apiProfile === 'current'
        ? '/taxpayerapi/dec/v4.1/returns/gstr1'
        : '/taxpayerapi/dec/v2.0/returns/gstr1';

      const isNilReturn = options.isNil === true;

      let requestBody;
      let signedString;

      if (isNilReturn) {
        requestBody = buildGstr1RetFileBody(rawString, gstin, period, true);
        signedString = requestBody;
      } else {
        const validatedBody = buildGstr1RetFileBody(rawString, gstin, period, false);

        let hasWrapper = false;

        try {
          const parsed = JSON.parse(rawString);

          if (parsed && (
            parsed.status_cd !== undefined ||
            parsed.data !== undefined ||
            parsed.isnil !== undefined
          )) {
            hasWrapper = true;
          }
        } catch {
          // ignore parse issue; rawString already validated by buildGstr1RetFileBody
        }

        const effectiveSignOver = this.evcSignOver || (this.apiProfile === 'current' ? 'body' : 'raw');

        if (effectiveSignOver === 'body' || effectiveSignOver === 'reconstructed' || hasWrapper) {
          requestBody = validatedBody;
          signedString = validatedBody;
        } else {
          requestBody = rawString;
          signedString = rawString;
        }
      }

      const sid = `${cleanPan}|${cleanOtp}`;
      const stateCd = gstin.slice(0, 2);

      logger.debug('TaxPro RETFILE fingerprint', {
        profile: this.apiProfile,
        isNil: isNilReturn,
        bodyHash: shortHash(requestBody),
        signedHash: shortHash(signedString),
        bodyEqualsRaw: requestBody === rawString
      });

      const safeTxn = crypto.randomUUID().replace(/-/g, '').toLowerCase();
      const ipUsr = this.getIpUsr();

      const headers = this.apiProfile === 'current' ? {
        aspid,
        password,
        'auth-token': token || '',
        authtoken: token || '',
        gstin,
        username,
        ret_period: period,
        'state-cd': stateCd,
        api_version: '4.1',
        userrole: 'GSTR1',
        rtn_typ: 'GSTR1',
        txn: safeTxn,
        ...(ipUsr ? { 'ip-usr': ipUsr } : {}),
        'Content-Type': 'application/json'
      } : {
        'state-cd': stateCd,
        gstin,
        ret_period: period,
        api_version: '2.1',
        userrole: 'GSTR1',
        rtn_typ: 'GSTR1',
        password,
        aspid,
        'auth-token': token || '',
        'Content-Type': 'application/json'
      };

      const envMode = process.env.TAXPRO_EVC_ENCODING || process.env.TAXPRO_EVC_SIGN_MODE;

      const candidateModes = options.evcMode
        ? [options.evcMode]
        : (envMode ? [envMode] : ['double', 'std', 'raw', 'single_b64key', 'raw_b64key']);

      let lastError;
      let hasAutoSubmitted = false;

      for (let modeIdx = 0; modeIdx < candidateModes.length; modeIdx++) {
        const mode = candidateModes[modeIdx];
        const sign = computeTaxProEvcSignature(signedString, cleanPan, cleanOtp, mode);

        const params = this.apiProfile === 'current'
          ? {
            action: 'RETFILE',
            gstin,
            ret_period: period,
            st: options.mode || 'EVC',
            sid,
            sign
          }
          : {
            action: 'RETFILE',
            aspid,
            gstin,
            username,
            ret_period: period,
            authtoken: token || '',
            st: options.mode || 'EVC',
            sid,
            sign
          };

        logger.debug(`TaxPro GSTR-1 RETFILE EVC dispatched (mode: ${mode}, period: ${period}, Nil: ${isNilReturn})`);

        try {
          const httpMethod = this.apiProfile === 'current' ? 'put' : 'post';

          const response = await this.httpClient[httpMethod](path, requestBody, {
            params,
            headers,
            timeout: this.fileTimeoutMs,
            transformRequest: [(data) => data]
          });

          const data = checkTaxProResponse(response.data, 'fileGstr1');

          const ackNum = (
            typeof (data?.ack_num || data?.data?.ack_num) === 'string'
              ? (data?.ack_num || data?.data?.ack_num)
              : ''
          ).trim();

          if (!ackNum) {
            const unconfirmed = ApiError.providerError(
              'TaxPro RETFILE response did not include the required acknowledgement number. Filing was not confirmed.',
              502
            );

            unconfirmed.pendingVerification = true;
            throw unconfirmed;
          }

          return {
            success: true,
            arn: ackNum,
            ack_num: ackNum,
            data
          };
        } catch (postErr) {
          const mapped = handleTaxProError(postErr, 'fileGstr1:EVC');
          lastError = mapped;

          if (mapped.errorCd === 'RT_FIL_10' && !hasAutoSubmitted) {
            hasAutoSubmitted = true;

            logger.info(
              `GST portal requires GSTR-1 submit step (RT_FIL_10) for [${gstin} - ${period}]. Auto-submitting return before filing...`
            );

            try {
              const activeToken = this._getActiveToken(gstin, username) || token;

              const subRes = await this.submitGstr1(period, {
                gstin,
                username,
                token: activeToken,
                isNil: options.isNil
              });

              logger.info(`Auto-submit succeeded (ref: ${subRes?.reference_id || 'OK'}). Waiting 2s for GSTN to freeze summary...`);
              await new Promise((resolve) => setTimeout(resolve, 2000));

              modeIdx--;
              continue;
            } catch (subErr) {
              logger.warn(`Auto-submit after RT_FIL_10 failed: ${safeErrorMessage(subErr)}`);
            }
          }

          if (mapped.errorCd === 'RET13507' && modeIdx < candidateModes.length - 1) {
            logger.warn(
              `TaxPro RETFILE mode [${mode}] resulted in RET13507 (Mismatch of signed data). Seamlessly trying mode [${candidateModes[modeIdx + 1]}]...`
            );

            continue;
          }

          const netCode = postErr?.code;
          const status = postErr?.response?.status;

          const unknownOutcome =
            netCode === 'ECONNABORTED' ||
            netCode === 'ETIMEDOUT' ||
            (typeof status === 'number' && status >= 500);

          if (unknownOutcome || postErr?.pendingVerification) {
            mapped.pendingVerification = true;
          }

          throw mapped;
        }
      }

      throw lastError;
    } catch (evcErr) {
      const mapped = handleTaxProError(evcErr, 'fileGstr1:EVC');

      const netCode = evcErr?.code;
      const status = evcErr?.response?.status;

      const unknownOutcome =
        netCode === 'ECONNABORTED' ||
        netCode === 'ETIMEDOUT' ||
        (typeof status === 'number' && status >= 500);

      if (unknownOutcome || evcErr?.pendingVerification) {
        mapped.pendingVerification = true;
      }

      throw mapped;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* GSTR-3B Save / Summary / Offset / File                                 */
  /* ---------------------------------------------------------------------- */

  async saveGstr3b(payload, options = {}) {
    const { gstin, username, token } = this._identity(options, { gstin: payload?.gstin });
    const period = options.period || payload?.ret_period;

    if (!isValidPeriod(period)) {
      throw ApiError.validationError('A valid MMYYYY return period is required to save GSTR-3B.');
    }

    if (!token) {
      throw ApiError.sessionExpired('A current GST Portal auth token is required to save GSTR-3B. Please verify OTP again.');
    }

    const path = this.apiProfile === 'current'
      ? '/taxpayerapi/dec/v7.1/returns/gstr3b'
      : '/taxpayerapi/dec/v0.3/returns/gstr3b';

    const params = this.apiProfile === 'current'
      ? { action: 'RETSAVE', gstin, ret_period: period }
      : {
        action: 'RETSAVE',
        aspid: this.getAspid(),
        gstin,
        username,
        authtoken: token,
        ret_period: period
      };

    const apiVersion = this.apiProfile === 'current' ? '7.1' : '0.3';

    const headers = this.apiProfile === 'current'
      ? this.getCurrentGstr3bHeaders(gstin, username, token)
      : {
        aspid: this.getAspid(),
        password: this.getPassword(),
        'auth-token': token,
        gstin,
        ret_period: period,
        rtn_typ: 'GSTR3B',
        userrole: 'GSTR3B',
        api_version: apiVersion,
        'state-cd': gstin.slice(0, 2),
        'Content-Type': 'application/json'
      };

    try {
      logger.debug(`TaxPro GSTR-3B RETSAVE dispatched for period ${period}`);

      const response = await this.httpClient.post(path, payload, { params, headers });
      const data = checkTaxProResponse(response.data, 'saveGstr3b');
      const refId = requireReferenceId(data, 'TaxPro GSTR-3B RETSAVE');

      return {
        success: true,
        reference_id: refId,
        ref_id: refId,
        data
      };
    } catch (error) {
      throw handleTaxProError(error, 'saveGstr3b');
    }
  }

  async getGstr3bRetSum(gstin, period, options = {}) {
    const { gstin: cleanGstin, username: cleanUser, token: cleanToken } = this._identity(options, { gstin });
    const cleanPeriod = (period || '').trim();

    if (!isValidPeriod(cleanPeriod)) {
      throw ApiError.validationError('A valid MMYYYY return period is required for the GSTR-3B summary.');
    }

    const isFinal = options.final === 'Y' || options.final === true;

    const path = this.apiProfile === 'current'
      ? '/taxpayerapi/dec/v7.1/returns/gstr3b'
      : '/taxpayerapi/dec/v0.3/returns/gstr3b';

    const params = this.apiProfile === 'current'
      ? {
        action: 'RETSUM',
        gstin: cleanGstin,
        ret_period: cleanPeriod,
        ...(isFinal ? { final: 'Y' } : {})
      }
      : {
        action: 'RETSUM',
        aspid: this.getAspid(),
        password: this.getPassword(),
        gstin: cleanGstin,
        username: cleanUser,
        ret_period: cleanPeriod,
        authtoken: cleanToken || '',
        ...(isFinal ? { final: 'Y' } : {})
      };

    const apiVersion = this.apiProfile === 'current' ? '7.1' : '0.3';

    const headers = this.apiProfile === 'current'
      ? this.getCurrentGstr3bHeaders(cleanGstin, cleanUser, cleanToken)
      : {
        'state-cd': cleanGstin.slice(0, 2),
        gstin: cleanGstin,
        ret_period: cleanPeriod,
        api_version: apiVersion,
        userrole: 'GSTR3B',
        rtn_typ: 'GSTR3B',
        password: this.getPassword(),
        aspid: this.getAspid(),
        'auth-token': cleanToken || ''
      };

    try {
      if (options.raw) {
        const response = await this.httpClient.get(path, {
          params,
          headers,
          responseType: 'text',
          timeout: this.fileTimeoutMs
        });

        const rawBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

        let parsed;

        try {
          parsed = JSON.parse(rawBody);
        } catch {
          throw ApiError.providerError('TaxPro GSTR-3B RETSUM did not return valid JSON.', 502);
        }

        const checked = checkTaxProResponse(parsed, 'getGstr3bRetSum');
        const inner = checked?.data && typeof checked.data === 'object' ? checked.data : checked;

        return { raw: rawBody, data: inner };
      }

      const response = await this.httpClient.get(path, { params, headers });

      return checkTaxProResponse(response.data, 'getGstr3bRetSum');
    } catch (error) {
      throw handleTaxProError(error, 'getGstr3bRetSum');
    }
  }

  async offsetGstr3b(period, options = {}) {
    const { gstin, username, token } = this._identity(options);

    if (!isValidPeriod(period)) {
      throw ApiError.validationError('A valid MMYYYY return period is required to offset GSTR-3B liability.');
    }

    if (!token) {
      throw ApiError.sessionExpired('A current GST Portal auth token is required to offset liability. Please verify OTP again.');
    }

    const body = options.body && typeof options.body === 'object' ? options.body : null;

    const hasPaymentDetails = body && ['pdcash', 'pditc', 'pdnls'].some((key) => {
      const v = body[key];
      return Array.isArray(v) ? v.length > 0 : (v && typeof v === 'object' && Object.keys(v).length > 0);
    });

    if (!hasPaymentDetails) {
      throw ApiError.validationError('Offset payload (pdcash / pditc / pdnls) is required to offset GSTR-3B liability.');
    }

    const path = this.apiProfile === 'current'
      ? '/taxpayerapi/dec/v7.1/returns/gstr3b'
      : '/taxpayerapi/dec/v0.3/returns/gstr3b';

    const params = this.apiProfile === 'current'
      ? { action: 'RETOFFSET', gstin, ret_period: period }
      : {
        action: 'RETOFFSET',
        aspid: this.getAspid(),
        gstin,
        username,
        authtoken: token,
        ret_period: period
      };

    const apiVersion = this.apiProfile === 'current' ? '7.1' : '0.3';

    const headers = this.apiProfile === 'current'
      ? this.getCurrentGstr3bHeaders(gstin, username, token)
      : {
        aspid: this.getAspid(),
        password: this.getPassword(),
        'auth-token': token,
        gstin,
        ret_period: period,
        rtn_typ: 'GSTR3B',
        userrole: 'GSTR3B',
        api_version: apiVersion,
        'state-cd': gstin.slice(0, 2),
        'Content-Type': 'application/json'
      };

    const payload = { ...body, gstin, ret_period: period };

    try {
      logger.debug(`TaxPro GSTR-3B RETOFFSET dispatched for period ${period}`);

      const response = await this.httpClient.post(path, payload, { params, headers });
      const data = checkTaxProResponse(response.data, 'offsetGstr3b');

      if (data.message !== 'Payment of tax successfully done') {
        throw ApiError.providerError('GSTR-3B liability offset was not confirmed by the GST portal.', 502);
      }

      return {
        success: true,
        message: data.message,
        data
      };
    } catch (error) {
      throw handleTaxProError(error, 'offsetGstr3b');
    }
  }

  async fileGstr3b(period, options = {}) {
    const { gstin, username, token } = this._identity(options);

    const cleanPan = options.pan ? String(options.pan).trim().toUpperCase() : '';
    const cleanOtp = options.otp ? String(options.otp).trim() : '';

    if (!isValidPeriod(period)) {
      throw ApiError.validationError('A valid MMYYYY return period is required to file GSTR-3B.');
    }

    if (!cleanPan || !cleanOtp) {
      throw ApiError.validationError('PAN and EVC OTP are required to file GSTR-3B.');
    }

    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleanPan) || !/^[A-Za-z0-9]{4,8}$/.test(cleanOtp)) {
      throw ApiError.validationError('Invalid PAN or EVC OTP format for GSTR-3B filing.');
    }

    if (!token) {
      throw ApiError.sessionExpired('Auth token is required to file GSTR-3B. Please verify OTP again.');
    }

    const path = this.apiProfile === 'current'
      ? '/taxpayerapi/dec/v7.1/returns/gstr3b'
      : '/taxpayerapi/dec/v0.3/returns/gstr3b';

    let summaryRaw = options.finalSummaryRaw;
    let summaryData = options.finalSummaryData;

    if (!summaryRaw || !summaryData || Object.keys(summaryData).length === 0) {
      const res = await this.getGstr3bRetSum(gstin, period, {
        username,
        gstToken: token,
        final: 'Y',
        raw: true
      });

      summaryRaw = res.raw;
      summaryData = res.data;
    }

    const isNilReturn = options.isNil === true;
    const payload = buildGstr3bRetFileBody(summaryData, gstin, period, isNilReturn);
    const requestBody = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const signOver = isNilReturn
      ? 'body'
      : (this.evcSignOver || (this.apiProfile === 'current' ? 'body' : 'raw'));

    const signedString = signOver === 'body' ? requestBody : summaryRaw;

    const params = this.apiProfile === 'current'
      ? { action: 'RETFILE', gstin, ret_period: period }
      : {
        action: 'RETFILE',
        aspid: this.getAspid(),
        gstin,
        username,
        authtoken: token,
        ret_period: period
      };

    params.st = options.mode || 'EVC';
    params.sid = `${cleanPan}|${cleanOtp}`;

    const apiVersion = this.apiProfile === 'current' ? '7.1' : '0.3';

    const headers = this.apiProfile === 'current'
      ? this.getCurrentGstr3bHeaders(gstin, username, token)
      : {
        aspid: this.getAspid(),
        password: this.getPassword(),
        'auth-token': token,
        gstin,
        ret_period: period,
        rtn_typ: 'GSTR3B',
        userrole: 'GSTR3B',
        api_version: apiVersion,
        'state-cd': gstin.slice(0, 2),
        'Content-Type': 'application/json'
      };

    const envMode = process.env.TAXPRO_EVC_ENCODING || process.env.TAXPRO_EVC_SIGN_MODE;

    const candidateModes = options.evcMode
      ? [options.evcMode]
      : (envMode ? [envMode] : ['double', 'std', 'raw', 'single_b64key', 'raw_b64key']);

    let lastError;

    for (let modeIdx = 0; modeIdx < candidateModes.length; modeIdx++) {
      const mode = candidateModes[modeIdx];
      const sign = computeTaxProEvcSignature(signedString, cleanPan, cleanOtp, mode);

      params.sign = sign;

      try {
        logger.debug(`TaxPro GSTR-3B RETFILE dispatched for period ${period} (mode: ${mode}, Nil: ${isNilReturn})`);

        const response = await this.httpClient.post(path, requestBody, {
          params,
          headers,
          timeout: this.fileTimeoutMs,
          transformRequest: [(data) => data]
        });

        const data = checkTaxProResponse(response.data, 'fileGstr3b');

        const ackNum = (
          typeof (data?.ack_num || data?.data?.ack_num) === 'string'
            ? (data?.ack_num || data?.data?.ack_num)
            : ''
        ).trim();

        if (!ackNum) {
          const unconfirmed = ApiError.providerError(
            'TaxPro RETFILE response did not include the required acknowledgement number. Filing was not confirmed.',
            502
          );

          unconfirmed.pendingVerification = true;
          throw unconfirmed;
        }

        return {
          success: true,
          arn: ackNum,
          ack_num: ackNum,
          data
        };
      } catch (error) {
        lastError = error;

        const mapped = handleTaxProError(error, 'fileGstr3b');

        if (mapped.errorCd === 'RET13507' && modeIdx < candidateModes.length - 1) {
          logger.warn(`TaxPro GSTR-3B RETFILE signature mismatch with mode '${mode}', trying next candidate mode...`);
          continue;
        }

        const netCode = error?.code;
        const status = error?.response?.status;

        if (
          netCode === 'ECONNABORTED' ||
          netCode === 'ETIMEDOUT' ||
          (typeof status === 'number' && status >= 500) ||
          error?.pendingVerification
        ) {
          mapped.pendingVerification = true;
        }

        throw mapped;
      }
    }

    const finalMapped = handleTaxProError(lastError, 'fileGstr3b');
    throw finalMapped;
  }

  /* ---------------------------------------------------------------------- */
  /* File details                                                           */
  /* ---------------------------------------------------------------------- */

  async getFileDetails(period, options = {}) {
    const { gstin, token } = this._identity(options, { requireUsername: false });

    const path = '/taxpayerapi/dec/v1.1/returns';

    const params = {
      action: 'FILEDET',
      aspid: this.getAspid(),
      password: this.getPassword(),
      gstin,
      ret_period: period,
      token: token || ''
    };

    const headers = {
      aspid: this.getAspid(),
      password: this.getPassword(),
      'auth-token': token || ''
    };

    try {
      logger.debug(`TaxPro FILEDET dispatched for period ${period}`);

      const response = await this.httpClient.get(path, { params, headers });
      const data = checkTaxProResponse(response.data, 'getFileDetails');

      return { success: true, data };
    } catch (error) {
      throw handleTaxProError(error, 'getFileDetails');
    }
  }
}

const defaultTaxProInstance = new TaxProProvider();

defaultTaxProInstance.TaxProProvider = TaxProProvider;
defaultTaxProInstance.SESSION_ERROR_CODES = SESSION_ERROR_CODES;
defaultTaxProInstance.PERIOD_PLACEMENT = PERIOD_PLACEMENT;
defaultTaxProInstance.OK_SHAPE = OK_SHAPE;
defaultTaxProInstance.checkTaxProResponse = checkTaxProResponse;
defaultTaxProInstance.mapTaxProErrorCode = mapTaxProErrorCode;
defaultTaxProInstance.handleTaxProError = handleTaxProError;
defaultTaxProInstance.getErrCd = getErrCd;
defaultTaxProInstance.formatSafeHeaderDiagnostics = formatSafeHeaderDiagnostics;
defaultTaxProInstance.computeTaxProEvcSignature = computeTaxProEvcSignature;
defaultTaxProInstance.buildGstr1RetFileBody = buildGstr1RetFileBody;
defaultTaxProInstance.buildGstr3bRetFileBody = buildGstr3bRetFileBody;
defaultTaxProInstance.cleanSaveValue = cleanSaveValue;
defaultTaxProInstance.validateGstr1SummaryResponse = validateGstr1SummaryResponse;

module.exports = defaultTaxProInstance;
module.exports.TaxProProvider = TaxProProvider;
module.exports.SESSION_ERROR_CODES = SESSION_ERROR_CODES;
module.exports.PERIOD_PLACEMENT = PERIOD_PLACEMENT;
module.exports.OK_SHAPE = OK_SHAPE;
module.exports.checkTaxProResponse = checkTaxProResponse;
module.exports.mapTaxProErrorCode = mapTaxProErrorCode;
module.exports.handleTaxProError = handleTaxProError;
module.exports.getErrCd = getErrCd;
module.exports.formatSafeHeaderDiagnostics = formatSafeHeaderDiagnostics;
module.exports.computeTaxProEvcSignature = computeTaxProEvcSignature;
module.exports.buildGstr3bRetFileBody = buildGstr3bRetFileBody;