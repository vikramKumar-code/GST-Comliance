const crypto = require('node:crypto');

const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const Filing = require('../models/Filing');
const Return = require('../models/Return');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { isValidGstin, isValidPeriod } = require('../utils/gstin');
const { encrypt } = require('../utils/crypto');
const logger = require('../utils/logger');
const { isLiveFilingEnabled } = require('../utils/filingMode');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

// IST-aware boundaries (GST_TZ_OFFSET_MIN=330 for India, UTC+05:30)
const TZ_OFFSET_MIN = Number(process.env.GST_TZ_OFFSET_MIN || 330);
const TZ_OFFSET_MS = TZ_OFFSET_MIN * 60 * 1000;

// Conservative policy: Require explicit configuration override to permit Nil GSTR-3B when purchase bills exist.
const NIL_3B_ALLOW_ZERO_ITC_BILLS =
  String(process.env.GST_NIL_3B_ALLOW_ZERO_ITC_BILLS || 'false').toLowerCase() === 'true';

// Optional: include Table 8 nil zeros in Nil GSTR-1 RETSAVE payload.
// Default false because Save schema root required is only gstin + fp.
// Enable only if GSTN/TaxPro sandbox confirms Table 8 zeros are required for nil filing.
const NIL_1_INCLUDE_TABLE8 =
  String(process.env.GST_NIL_1_INCLUDE_TABLE8 || 'false').toLowerCase() === 'true';

// Optional: run full GSTR-1 validator on nil save payload.
// Default false to avoid coupling nil flow to validator patches that may still be incomplete.
// Enable after validator is confirmed schema-faithful.
const NIL_USE_FULL_VALIDATOR =
  String(process.env.GST_NIL_USE_FULL_VALIDATOR || 'false').toLowerCase() === 'true';

// Polling config for nil pre-filing steps.
const NIL_POLL_ATTEMPTS = Math.max(1, Number(process.env.GST_NIL_POLL_ATTEMPTS || 12));
const NIL_POLL_DELAY_MS = Math.max(500, Number(process.env.GST_NIL_POLL_DELAY_MS || 3000));

// After proceed/submit, allow GSTN background summary calculation to settle.
const NIL_SUMMARY_SETTLE_MS = Math.max(0, Number(process.env.GST_NIL_SUMMARY_SETTLE_MS || 2000));

// Statutory safety: require GSTN portal nil confirmation before RETFILE.
// Disable only if provider.fileGstr1/fileGstr3b internally confirms isnil Y and you trust it.
const NIL_REQUIRE_PORTAL_CONFIRMATION =
  String(process.env.GST_NIL_REQUIRE_PORTAL_CONFIRMATION || 'true').toLowerCase() === 'true';

const EXCLUDED_DOCUMENT_STATUSES = [
  'cancelled',
  'Cancelled',
  'canceled',
  'Canceled',
  'draft',
  'Draft',
  'deleted',
  'Deleted',
  'void',
  'Void',
  'rejected',
  'Rejected',
  'on_hold',
  'On Hold',
  'processed_with_errors',
  'Processed With Errors'
];

const ACTIVE_STATUS_LIST = String(process.env.GST_ACTIVE_DOCUMENT_STATUSES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FINALIZED_STATUS_QUERY = ACTIVE_STATUS_LIST.length
  ? {
    $regex: new RegExp(
      `^(${ACTIVE_STATUS_LIST.map(escapeRegex).join('|')})$`,
      'i'
    )
  }
  : {
    $not: new RegExp(
      `^(${EXCLUDED_DOCUMENT_STATUSES.map(escapeRegex).join('|')})$`,
      'i'
    )
  };

const ACTIVE_STATUS_SET = new Set(ACTIVE_STATUS_LIST.map((s) => s.toLowerCase()));
const EXCLUDED_STATUS_SET = new Set(EXCLUDED_DOCUMENT_STATUSES.map((s) => s.toLowerCase()));
const CANCELLED_STATUS_SET = new Set(['cancelled', 'canceled', 'void', 'deleted']);

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EVC_OTP_REGEX = /^[A-Za-z0-9]{4,8}$/;

const NIL_GSTR1_ALLOWED_ROOT_KEYS = new Set(['gstin', 'fp', 'nil']);
const NIL_SUPPLY_TYPES = new Set(['INTRB2B', 'INTRB2C', 'INTRAB2B', 'INTRAB2C']);

const CONFIRMED_FILED_FILTER = {
  status: 'Filed',
  arn: { $exists: true, $nin: [null, ''] }
};

const GSTR1_NIL_SUMMARY_METHODS = [
  'getGstr1Summary',
  'getGstr1RetSum',
  'fetchGstr1Summary',
  'getReturnSummary',
  'getSummary'
];

const GSTR3B_NIL_SUMMARY_METHODS = [
  'getGstr3bRetSum',
  'getGstr3bSummary',
  'getReturnSummary',
  'getSummary'
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const round2 = (v) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

function positiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

// Credit notes decrease outward turnover for aggregate display.
function signOfInvoice(inv) {
  const type = String(inv?.documentType || inv?.invoiceType || '').toUpperCase();
  return type.includes('CREDIT') ? -1 : 1;
}

/**
 * Canonical JSON stringify with sorted object keys.
 * Used for stable payload hashing across prepare-filing and file-evc.
 */
function canonicalJsonStringify(value) {
  const seen = new WeakSet();

  return JSON.stringify(value, function replacer(key, val) {
    if (val === undefined) return undefined;

    if (typeof val === 'object' && val !== null) {
      if (Array.isArray(val)) return val;

      if (seen.has(val)) return '[Circular]';
      seen.add(val);

      const sorted = {};

      for (const k of Object.keys(val).sort()) {
        if (val[k] !== undefined) {
          sorted[k] = val[k];
        }
      }

      return sorted;
    }

    return val;
  });
}

function hashPayload(payload) {
  return crypto
    .createHash('sha256')
    .update(canonicalJsonStringify(payload ?? null))
    .digest('hex');
}

function getReferenceId(res) {
  const id = res?.reference_id || res?.ref_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

// Format filing date in Indian Standard Time (DD/MM/YYYY)
function formatGstnDate(d = new Date()) {
  const local = new Date(d.getTime() + TZ_OFFSET_MS);
  const day = String(local.getUTCDate()).padStart(2, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const year = local.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

// Month range boundary aligned with Indian Standard Time
function periodRangeIST(period) {
  const month = parseInt(period.slice(0, 2), 10);
  const year = parseInt(period.slice(2), 10);
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - TZ_OFFSET_MS),
    endDate: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - TZ_OFFSET_MS - 1)
  };
}

function safeErrorMessage(error) {
  if (!error) return 'unknown';

  const msg = typeof error.message === 'string' ? error.message : '';

  return (
    msg
      .replace(/https?:\/\/\S+/gi, '[URL_REDACTED]')
      .replace(
        /(password|token|secret|authtoken|auth-token|OTP|sid|sign|aspid|arn|reference_id)\s*[:=]\s*\S+/gi,
        '$1=[REDACTED]'
      )
      .slice(0, 220) || 'unknown'
  );
}

function isIndeterminateFilingError(err) {
  if (!err) return false;

  // Explicit provider marker for unknown RETFILE outcome.
  if (err.pendingVerification) return true;

  // Real network-level uncertainty.
  const code = err.code;
  if (
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ERR_NETWORK'
  ) {
    return true;
  }

  // Upstream 5xx may mean request reached GSTN but response was lost.
  const status = err.response?.status;
  if (typeof status === 'number' && status >= 500) {
    return true;
  }

  // Do NOT treat local ApiError.statusCode >= 500 as indeterminate.
  // Example: provider nil-confirmation failure is deterministic, not unknown filing.
  return false;
}

/**
 * AuditLog compatibility helper.
 * Copies metadata/details depending on model schema and drops unknown top-level fields.
 */
async function writeAudit(entry) {
  try {
    const paths = AuditLog.schema?.paths || {};
    const payload = { ...entry };

    if (paths.details && !payload.details && payload.metadata) {
      payload.details = typeof payload.metadata === 'string'
        ? payload.metadata
        : JSON.stringify(payload.metadata);
    }

    if (paths.details && payload.details && typeof payload.details !== 'string') {
      payload.details = JSON.stringify(payload.details);
    }

    if (paths.metadata && !payload.metadata && payload.details) {
      payload.metadata = payload.details;
    }

    if (Object.keys(paths).length > 0) {
      for (const key of Object.keys(payload)) {
        if (!paths[key]) delete payload[key];
      }
    }

    await AuditLog.create(payload);
  } catch (e) {
    logger.error('AuditLog write failed', {
      action: entry?.action,
      reason: safeErrorMessage(e)
    });
  }
}

/**
 * Strict GSTN async processing tracker.
 *
 * Throws on:
 * - missing reference_id
 * - provider cannot track status
 * - PE / ER processing status
 * - polling timeout
 */
async function waitForProcessing(
  provider,
  refId,
  authCtx,
  label,
  maxAttempts = NIL_POLL_ATTEMPTS,
  delayMs = NIL_POLL_DELAY_MS
) {
  if (!refId || typeof refId !== 'string' || !refId.trim()) {
    throw ApiError.providerError(
      `${label}: reference_id missing. Processing was not confirmed.`,
      502
    );
  }

  if (typeof provider.trackStatus !== 'function') {
    throw ApiError.providerError(
      `${label}: active GST provider cannot track processing status.`,
      502
    );
  }

  const cleanRefId = refId.trim();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let res;

    try {
      res = await provider.trackStatus(cleanRefId, authCtx);
    } catch (trackErr) {
      logger.debug(`${label} status tracking poll note`, {
        attempt,
        error_cd: trackErr?.errorCd,
        message: safeErrorMessage(trackErr)
      });

      if (attempt >= maxAttempts) {
        throw ApiError.providerError(
          `${label}: GST portal processing status could not be confirmed.`,
          502
        );
      }

      await sleep(delayMs);
      continue;
    }

    const status = String(res?.status_cd || '').toUpperCase();

    logger.info(`${label} status poll ${attempt}/${maxAttempts}`, { status });

    if (status === 'P') {
      return res;
    }

    if (status === 'PE' || status === 'ER') {
      const err = ApiError.validationError(
        `${label}: GST portal reported processing errors. Please review the error report and correct the data.`
      );
      err.errorCd = status === 'PE' ? 'PROCESSED_WITH_ERRORS' : 'PROCESSING_ERROR';
      err.errorReport = res?.error_report || null;
      throw err;
    }

    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  throw ApiError.providerError(
    `${label}: GST portal is still processing. Please try again after some time.`,
    504
  );
}

function getModelPaths(model) {
  return model?.schema?.paths || {};
}

function invoiceGstinScopeMissing() {
  const paths = getModelPaths(Invoice);
  return !paths.supplierGstin && !paths.gstin;
}

function billGstinScopeMissing() {
  const paths = getModelPaths(Bill);
  return !paths.gstin && !paths.buyerGstin && !paths.recipientGstin;
}

function buildInvoiceFilter(workspaceId, gstin, startDate, endDate) {
  const filter = {
    workspaceId,
    invoiceDate: { $gte: startDate, $lte: endDate },
    status: FINALIZED_STATUS_QUERY
  };

  const paths = getModelPaths(Invoice);

  // Prefer explicit supplier GSTIN if present.
  if (paths.supplierGstin) {
    filter.supplierGstin = gstin;
  } else if (paths.gstin) {
    filter.gstin = gstin;
  }

  return filter;
}

function buildBillFilter(workspaceId, gstin, startDate, endDate) {
  const filter = {
    workspaceId,
    billDate: { $gte: startDate, $lte: endDate },
    status: FINALIZED_STATUS_QUERY
  };

  const paths = getModelPaths(Bill);

  // For purchase bills, workspace GSTIN is usually the buyer/recipient GSTIN.
  // Do not filter by supplierGstin because that is the vendor GSTIN.
  if (paths.gstin) {
    filter.gstin = gstin;
  } else if (paths.buyerGstin) {
    filter.buyerGstin = gstin;
  } else if (paths.recipientGstin) {
    filter.recipientGstin = gstin;
  }

  return filter;
}

function isEligibleItcBill(b) {
  return !(
    b?.itcEligible === false ||
    b?.itcIneligible === true ||
    String(b?.blockedCredit || '').toUpperCase() === 'Y'
  );
}

function isMultipleOf01(val) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return false;
  const scaled = Math.round(val * 100);
  return Math.abs(val * 100 - scaled) < 1e-8;
}

function buildNilGstr1SavePayload(gstin, period) {
  const payload = {
    gstin: String(gstin).toUpperCase(),
    fp: String(period).trim()
  };

  // Do NOT send gt / cur_gt by default.
  // Nil return means current period outward supplies are nil,
  // not that previous/current FY gross turnover is zero.

  if (NIL_1_INCLUDE_TABLE8) {
    payload.nil = {
      inv: [
        { sply_ty: 'INTRB2B', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
        { sply_ty: 'INTRB2C', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
        { sply_ty: 'INTRAB2B', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
        { sply_ty: 'INTRAB2C', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 }
      ]
    };
  }

  return payload;
}

function validateNilGstr1SavePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw ApiError.validationError('Nil GSTR-1 save payload must be a valid JSON object.');
  }

  const extraRoot = Object.keys(payload).find((k) => !NIL_GSTR1_ALLOWED_ROOT_KEYS.has(k));
  if (extraRoot) {
    throw ApiError.validationError(
      `Nil GSTR-1 save payload has disallowed field '${extraRoot}'.`
    );
  }

  if (!isValidGstin(payload.gstin)) {
    throw ApiError.invalidGstin('Nil GSTR-1 save payload has invalid GSTIN.');
  }

  if (!isValidPeriod(payload.fp)) {
    throw ApiError.validationError('Nil GSTR-1 save payload has invalid financial period. Must be MMYYYY.');
  }

  // Explicitly block accidental gross-turnover disclosure in nil payload.
  if (payload.gt !== undefined || payload.cur_gt !== undefined) {
    throw ApiError.validationError(
      'Nil GSTR-1 save payload must not include gt or cur_gt unless trusted FY turnover is explicitly supplied by a compliant source.'
    );
  }

  if (payload.nil !== undefined) {
    if (!payload.nil || typeof payload.nil !== 'object' || Array.isArray(payload.nil)) {
      throw ApiError.validationError('Nil GSTR-1 payload.nil must be an object.');
    }

    const nilExtra = Object.keys(payload.nil).find((k) => !['flag', 'inv'].includes(k));
    if (nilExtra) {
      throw ApiError.validationError(`Nil GSTR-1 payload.nil has disallowed field '${nilExtra}'.`);
    }

    if (!Array.isArray(payload.nil.inv) || payload.nil.inv.length === 0) {
      throw ApiError.validationError('Nil GSTR-1 payload.nil.inv must be a non-empty array.');
    }

    for (const row of payload.nil.inv) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw ApiError.validationError('Nil GSTR-1 payload.nil.inv row must be an object.');
      }

      const rowExtra = Object.keys(row).find(
        (k) => !['sply_ty', 'nil_amt', 'expt_amt', 'ngsup_amt'].includes(k)
      );
      if (rowExtra) {
        throw ApiError.validationError(`Nil GSTR-1 payload.nil.inv row has disallowed field '${rowExtra}'.`);
      }

      if (!NIL_SUPPLY_TYPES.has(row.sply_ty)) {
        throw ApiError.validationError(
          `Nil GSTR-1 payload.nil.inv row has invalid sply_ty '${row.sply_ty}'.`
        );
      }

      for (const key of ['nil_amt', 'expt_amt', 'ngsup_amt']) {
        const val = row[key];

        if (typeof val !== 'number' || !Number.isFinite(val)) {
          throw ApiError.validationError(
            `Nil GSTR-1 payload.nil.inv row '${key}' must be a finite number.`
          );
        }

        if (val !== 0) {
          throw ApiError.validationError(
            `Nil GSTR-1 payload.nil.inv row '${key}' must be 0 for nil return.`
          );
        }

        if (!isMultipleOf01(val)) {
          throw ApiError.validationError(
            `Nil GSTR-1 payload.nil.inv row '${key}' must be a multiple of 0.01.`
          );
        }
      }
    }
  }

  // Optional full validator. Disabled by default to avoid coupling nil flow
  // to validator patches that may still be incomplete.
  if (NIL_USE_FULL_VALIDATOR) {
    try {
      const validator = require('../utils/gstr1Validator');

      if (validator && typeof validator.normalizeAndValidateGstr1Payload === 'function') {
        validator.normalizeAndValidateGstr1Payload(payload);
      } else if (validator && typeof validator.validateGstr1Schema === 'function') {
        const normalized =
          typeof validator.normalizeGstr1Payload === 'function'
            ? validator.normalizeGstr1Payload(payload)
            : payload;

        validator.validateGstr1Schema(normalized);
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;

      logger.warn('Full GSTR-1 validator could not run for nil payload', {
        message: safeErrorMessage(err)
      });

      throw ApiError.providerError(
        'Nil GSTR-1 payload full schema validation failed due validator configuration error.',
        502
      );
    }
  }
}

/**
 * Unwrap common provider response wrappers.
 * GSTN/TaxPro providers often return { data }, { result }, { response: { data } }, etc.
 */
function unwrapProviderResponse(res) {
  let cur = res;

  for (let i = 0; i < 5 && isPlainObject(cur); i += 1) {
    if (isPlainObject(cur.data)) {
      cur = cur.data;
      continue;
    }

    if (isPlainObject(cur.result)) {
      cur = cur.result;
      continue;
    }

    if (isPlainObject(cur.results)) {
      cur = cur.results;
      continue;
    }

    if (isPlainObject(cur.response?.data)) {
      cur = cur.response.data;
      continue;
    }

    if (isPlainObject(cur.payload)) {
      cur = cur.payload;
      continue;
    }

    break;
  }

  return cur;
}

function extractRawFromProviderResponse(res) {
  if (typeof res === 'string') return res;
  if (!isPlainObject(res)) return undefined;

  if (typeof res.raw === 'string') return res.raw;
  if (typeof res.data === 'string') return res.data;
  if (typeof res.result === 'string') return res.result;
  if (typeof res.response?.data === 'string') return res.response.data;

  return undefined;
}

function extractDataFromProviderResponse(res) {
  if (isPlainObject(res?.data) && !Array.isArray(res.data)) return res.data;
  if (isPlainObject(res?.result)) return res.result;
  if (isPlainObject(res?.results)) return res.results;
  if (isPlainObject(res?.response?.data)) return res.response.data;

  const raw = extractRawFromProviderResponse(res);

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        return parsed.data && isPlainObject(parsed.data) ? parsed.data : parsed;
      }
    } catch {
      // Not JSON, ignore.
    }
  }

  return isPlainObject(res) ? res : undefined;
}

/**
 * Detect GSTN nil summary confirmation.
 *
 * Official GSTR-1 Summary nil variant:
 * {
 *   gstin: "...",
 *   ret_period: "MMYYYY",
 *   isnil: "Y"
 * }
 */
function getNilSummaryValue(obj, depth = 0) {
  if (!isPlainObject(obj) || depth > 6) return undefined;

  const nilKeys = ['isnil', 'isNil', 'nil_return', 'nilReturn'];

  for (const key of nilKeys) {
    const val = obj[key];

    if (val === true) return 'Y';
    if (val === false) return 'N';

    if (typeof val === 'string') {
      const s = val.trim().toUpperCase();
      if (s === 'Y' || s === 'YES' || s === 'TRUE') return 'Y';
      if (s === 'N' || s === 'NO' || s === 'FALSE') return 'N';
    }
  }

  const nestedKeys = ['data', 'result', 'summary', 'return_summary', 'ret_sum', 'payload'];

  for (const key of nestedKeys) {
    const nested = obj[key];
    if (isPlainObject(nested)) {
      const found = getNilSummaryValue(nested, depth + 1);
      if (found) return found;
    }
  }

  return undefined;
}

function looksLikeNonNilSummary(summary) {
  if (!isPlainObject(summary)) return false;

  // Normal GSTR-1 summary has sec_sum array and chksum.
  if (Array.isArray(summary.sec_sum) && summary.sec_sum.length > 0) return true;

  // Common non-nil indicators.
  if (positiveNumber(summary.ttl_liab)) return true;
  if (positiveNumber(summary.ttl_tax)) return true;
  if (positiveNumber(summary.ttl_val)) return true;

  // GSTR-3B specific indicators: Table 3.1 outward taxable supplies or taxes
  if (summary.sup_details?.osup_det) {
    const o = summary.sup_details.osup_det;
    if (positiveNumber(o.txval) || positiveNumber(o.iamt) || positiveNumber(o.camt) || positiveNumber(o.samt)) {
      return true;
    }
  }

  // GSTR-3B Table 4: Eligible ITC
  if (Array.isArray(summary.itc_elg?.itc_avl)) {
    const hasItc = summary.itc_elg.itc_avl.some((item) =>
      positiveNumber(item.iamt) || positiveNumber(item.camt) || positiveNumber(item.samt)
    );
    if (hasItc) return true;
  }

  return false;
}

function getNilGstr1PreFileStep(provider) {
  const configured = String(
    process.env.GST_NIL_GSTR1_PRE_FILE_STEP ||
    process.env.TAXPRO_GSTR1_PRE_FILE_STEP ||
    ''
  ).trim().toLowerCase();

  if (['none', 'proceed', 'retsubmit'].includes(configured)) {
    return configured;
  }

  // Nil filing needs a portal summary. Prefer explicit pre-file generation
  // unless provider has no proceed/submit capability.
  if (
    typeof provider?.proceedToFile === 'function' ||
    typeof provider?.submitGstr1 === 'function'
  ) {
    return 'proceed';
  }

  return 'none';
}

async function callNilSummaryMethod(provider, methodName, normType, authCtx, period, opts) {
  const gstin = authCtx.gstin;

  const attempts = [];

  if (methodName === 'getReturnSummary' || methodName === 'getSummary') {
    attempts.push(() => provider[methodName](normType, gstin, period, opts));
  }

  if (methodName === 'getGstr3bRetSum') {
    attempts.push(() => provider[methodName](gstin, period, { ...opts, final: 'Y' }));
  }

  attempts.push(() => provider[methodName](gstin, period, opts));
  attempts.push(() => provider[methodName](gstin, period, authCtx.username, authCtx.token, true));
  attempts.push(() => provider[methodName](period, opts));

  let lastError = null;

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`${methodName} failed`);
}

/**
 * Confirm GSTN portal nil summary before RETFILE.
 *
 * If provider does not expose a summary method and NIL_REQUIRE_PORTAL_CONFIRMATION=true,
 * filing is aborted. This is intentional statutory safety behaviour.
 */
async function fetchNilSummary(provider, normType, authCtx, period, label) {
  if (!NIL_REQUIRE_PORTAL_CONFIRMATION) {
    return {
      confirmed: false,
      skipped: true,
      message: 'GST_NIL_REQUIRE_PORTAL_CONFIRMATION=false. Provider-only nil confirmation trusted.'
    };
  }

  const methods = normType === 'GSTR1'
    ? GSTR1_NIL_SUMMARY_METHODS
    : GSTR3B_NIL_SUMMARY_METHODS;

  const attempted = [];
  let lastError = null;

  for (const methodName of methods) {
    if (typeof provider[methodName] !== 'function') continue;

    attempted.push(methodName);

    try {
      const opts = {
        ...authCtx,
        gstin: authCtx.gstin,
        period,
        ret_period: period,
        isNil: true,
        raw: true
      };

      const res = await callNilSummaryMethod(
        provider,
        methodName,
        normType,
        authCtx,
        period,
        opts
      );

      const raw = extractRawFromProviderResponse(res);
      const data = extractDataFromProviderResponse(res);
      const summary = unwrapProviderResponse(data || res);
      const nilValue = getNilSummaryValue(summary);

      if (nilValue === 'Y') {
        return {
          confirmed: true,
          skipped: false,
          method: methodName,
          summary,
          raw,
          data
        };
      }

      if (nilValue === 'N') {
        throw ApiError.validationError(
          `${label}: GSTN summary explicitly indicates this is not a nil return (isnil: "N"). Filing aborted.`
        );
      }

      if (looksLikeNonNilSummary(summary)) {
        throw ApiError.validationError(
          `${label}: GSTN summary contains non-nil outward/inward data. Nil return filing aborted.`
        );
      }

      // For GSTR-3B: Pre-filing RETSUM response from GSTN does not include isnil: "Y".
      // If the summary does not indicate non-nil transactions (no outward liabilities, no tax),
      // accept it as confirmed nil summary.
      if (normType === 'GSTR3B' && !looksLikeNonNilSummary(summary)) {
        return {
          confirmed: true,
          skipped: false,
          method: methodName,
          summary,
          raw,
          data
        };
      }

      lastError = new Error(`${label}: isnil Y not found in summary response from ${methodName}.`);
      logger.warn(`${label}: summary method did not return isnil Y`, {
        method: methodName,
        responseKeys: Object.keys(summary || {})
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;

      lastError = err;
      logger.warn(`${label}: summary method failed`, {
        method: methodName,
        error: safeErrorMessage(err)
      });
    }
  }

  if (!attempted.length) {
    throw ApiError.providerError(
      `${label}: active GST provider cannot confirm nil summary. ` +
      'Set GST_NIL_REQUIRE_PORTAL_CONFIRMATION=false only if provider.file... internally confirms isnil Y.',
      502
    );
  }

  throw ApiError.providerError(
    `${label}: nil summary confirmation failed. ${safeErrorMessage(lastError)}`,
    502
  );
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

class NilReturnService {
  /**
   * Check eligibility for Nil Return under CGST Rule 67A.
   *
   * IMPORTANT:
   * This is a LOCAL eligibility gate. It does not replace GSTN portal nil confirmation.
   * The provider/file step must still receive explicit isnil: "Y" from GSTN summary.
   */
  static async checkEligibility(workspaceId, gstin, period, returnType = 'GSTR1') {
    if (!workspaceId) throw ApiError.validationError('Workspace ID is required.');

    const normGstin = (gstin || '').trim().toUpperCase();
    if (!isValidGstin(normGstin)) throw ApiError.invalidGstin('Invalid GSTIN format.');
    if (!isValidPeriod(period)) throw ApiError.validationError('Invalid tax period format. Must be MMYYYY.');

    const normType = (returnType || 'GSTR1').toUpperCase();
    if (!['GSTR1', 'GSTR3B'].includes(normType)) {
      throw ApiError.validationError('Nil return can only be filed for GSTR1 or GSTR3B per CGST Rule 67A.');
    }

    const { startDate, endDate } = periodRangeIST(period);
    const warnings = [];

    if (invoiceGstinScopeMissing()) {
      warnings.push(
        'Invoice model does not expose gstin/supplierGstin field. Local nil eligibility may include multiple GSTINs if workspace contains them.'
      );
    }

    if (billGstinScopeMissing()) {
      warnings.push(
        'Bill model does not expose buyer/recipient GSTIN field. Local nil eligibility may include multiple GSTINs if workspace contains them.'
      );
    }

    // Only confirmed filed record blocks eligibility.
    const existingFiling = await Filing.findOne({
      workspaceId,
      type: normType,
      period,
      ...CONFIRMED_FILED_FILTER
    }).lean();

    if (existingFiling) {
      return {
        alreadyFiled: true,
        arn: existingFiling.arn,
        filingDate: existingFiling.filingDate,
        dateStr: existingFiling.dateStr,
        status: existingFiling.status,
        isNil: existingFiling.isNil,
        mode: existingFiling.mode,
        eligible: false,
        portalConfirmationRequired: true,
        localEligibilityOnly: true,
        warnings,
        message: `${normType} for period ${period} has already been filed with ARN ${existingFiling.arn}.`
      };
    }

    const invoices = await Invoice.find(
      buildInvoiceFilter(workspaceId, normGstin, startDate, endDate)
    ).lean();

    const bills = await Bill.find(
      buildBillFilter(workspaceId, normGstin, startDate, endDate)
    ).lean();

    const activeInvoicesCount = invoices.length;
    const activeBillsCount = bills.length;

    // Apply negative sign for credit notes in outward turnover summary.
    let totalTaxableSales = 0;
    let totalOutwardTax = 0;

    for (const inv of invoices) {
      const sign = signOfInvoice(inv);
      totalTaxableSales += sign * Number(inv.subTotal ?? inv.totalTaxable ?? 0);
      totalOutwardTax += sign * (
        Number(inv.totalIgst || 0) +
        Number(inv.totalCgst || 0) +
        Number(inv.totalSgst || 0) +
        Number(inv.totalCess || 0)
      );
    }

    let totalItc = 0;
    let hasRcmLiability = false;

    for (const b of bills) {
      if (b.isReverseCharge) hasRcmLiability = true;

      // Only eligible ITC counts (Section 17(5) blocked credits excluded).
      if (isEligibleItcBill(b)) {
        const sign = signOfInvoice(b); // same credit-note convention for bills

        // Include cess in eligible ITC computation.
        totalItc += sign * (
          Number(b.totalCgst || 0) +
          Number(b.totalSgst || 0) +
          Number(b.totalIgst || 0) +
          Number(b.totalCess || 0)
        );
      }
    }

    totalItc = round2(totalItc);
    const hasPositiveItc = totalItc > 0;

    // GSTR-1 Nil: no outward supplies allowed.
    // Credit notes also count as outward adjustments.
    //
    // GSTR-3B Nil: no outward supplies + no RCM liability + no ITC claimed.
    // Conservative policy also blocks nil if purchase bills exist unless override is set.
    const hasBusinessActivity = normType === 'GSTR1'
      ? activeInvoicesCount > 0
      : (
        activeInvoicesCount > 0 ||
        hasPositiveItc ||
        hasRcmLiability ||
        (!NIL_3B_ALLOW_ZERO_ITC_BILLS && activeBillsCount > 0)
      );

    if (activeInvoicesCount > 0) {
      warnings.push(
        `You have ${activeInvoicesCount} active sales document(s) totaling Rs. ${round2(totalTaxableSales).toLocaleString('en-IN')} ` +
        `(outward tax Rs. ${round2(totalOutwardTax).toLocaleString('en-IN')}) in this period.`
      );
    }

    if (normType === 'GSTR3B') {
      if (activeBillsCount > 0 && hasPositiveItc) {
        warnings.push(
          `You have ${activeBillsCount} purchase bill(s) with Rs. ${totalItc.toLocaleString('en-IN')} eligible ITC in this period.`
        );
      }

      if (hasRcmLiability) {
        warnings.push('You have inward supplies liable to Reverse Charge (RCM) in this period.');
      }

      // Informational notice when bills exist with zero ITC.
      if (activeBillsCount > 0 && !hasPositiveItc && !hasRcmLiability && !NIL_3B_ALLOW_ZERO_ITC_BILLS) {
        warnings.push(
          `${activeBillsCount} purchase bill(s) recorded with no eligible ITC and no RCM. ` +
          'Nil GSTR-3B may be permissible — confirm with your tax advisor before enabling GST_NIL_3B_ALLOW_ZERO_ITC_BILLS=true.'
        );
      }
    }

    if (normType === 'GSTR1') {
      warnings.push(
        'Local eligibility currently checks Invoice records only. Advances, e-commerce outward supplies, document issue details, and other GSTR-1 tables must be confirmed by GSTN portal nil summary before filing.'
      );
    }

    if (normType === 'GSTR3B') {
      warnings.push(
        'Local eligibility does not verify cash ledger liability, interest, or late fee. GSTN portal nil confirmation is mandatory before filing.'
      );
    }

    return {
      alreadyFiled: false,
      eligible: !hasBusinessActivity,
      hasBusinessActivity,
      activeInvoicesCount,
      activeBillsCount,
      totalTaxableSales: round2(totalTaxableSales),
      totalOutwardTax: round2(totalOutwardTax),
      totalItc,
      hasRcmLiability,
      warnings,
      portalConfirmationRequired: true,
      localEligibilityOnly: true,
      policy: {
        timezoneOffsetMinutes: TZ_OFFSET_MIN,
        nil3bAllowsZeroItcBills: NIL_3B_ALLOW_ZERO_ITC_BILLS,
        nil1IncludeTable8: NIL_1_INCLUDE_TABLE8,
        nilUseFullValidator: NIL_USE_FULL_VALIDATOR,
        nilRequirePortalConfirmation: NIL_REQUIRE_PORTAL_CONFIRMATION
      },
      ruleReference: 'Central Goods and Services Tax (CGST) Rules, 2017 - Rule 67A (Filing of Nil Return)',
      criteria: [
        'No outward supply of goods or services made (including nil rated, exempted, and non-GST supplies)',
        'No inward supplies liable to reverse charge (RCM)',
        'No Input Tax Credit (ITC) to be availed / claimed',
        'No tax liability, interest, late fees, or other penalty payable'
      ]
    };
  }

  /**
   * File Nil Return for GSTR-1 or GSTR-3B under CGST Rule 67A.
   */
  static async fileNilReturn(workspaceId, gstin, period, returnType = 'GSTR1', options = {}) {
    if (!workspaceId) throw ApiError.validationError('Workspace ID is required.');

    const normGstin = (gstin || '').trim().toUpperCase();
    if (!isValidGstin(normGstin)) throw ApiError.invalidGstin('Invalid GSTIN format.');
    if (!isValidPeriod(period)) throw ApiError.validationError('Invalid tax period format.');

    const normType = (returnType || 'GSTR1').toUpperCase();
    if (!['GSTR1', 'GSTR3B'].includes(normType)) {
      throw ApiError.validationError('Nil return can only be filed for GSTR1 or GSTR-3B.');
    }

    if (!options.declarationAccepted) {
      throw ApiError.validationError(
        'Statutory declaration per CGST Rule 67A must be accepted before filing a Nil return.'
      );
    }

    // Current provider flow supports EVC only.
    if (options.verificationMode !== 'EVC') {
      throw ApiError.validationError(
        'Nil return filing currently requires EVC verification. DSC/other modes are not supported by this provider flow.'
      );
    }

    const cleanUsername = typeof options.username === 'string' ? options.username.trim() : '';
    if (!cleanUsername) {
      throw ApiError.validationError('GST portal username is required to file a Nil return.');
    }

    const cleanOtp = typeof options.otp === 'string' ? options.otp.trim() : '';
    if (!EVC_OTP_REGEX.test(cleanOtp)) {
      throw ApiError.validationError('Invalid EVC OTP format. Must be 4 to 8 letters or digits.');
    }

    const cleanPan = typeof options.pan === 'string' ? options.pan.trim().toUpperCase() : '';
    if (!PAN_REGEX.test(cleanPan)) {
      throw ApiError.validationError(
        'A valid authorised signatory PAN is required to file a Nil return with EVC.'
      );
    }

    const idempotencyKey = options.idempotencyKey || null;

    /* ------------------------------------------------------------------ */
    /* Mandatory server-side eligibility gate per CGST Rule 67A           */
    /* Prevents direct API bypass of statutory zero-transaction rules     */
    /* ------------------------------------------------------------------ */
    const eligibility = await NilReturnService.checkEligibility(workspaceId, normGstin, period, normType);

    if (eligibility.alreadyFiled) {
      throw ApiError.validationError(
        `${normType} for period ${period} is already filed with ARN: ${eligibility.arn}. Duplicate filing is prohibited.`
      );
    }

    if (!eligibility.eligible) {
      throw ApiError.validationError(
        `Nil ${normType} cannot be filed for ${period} — business activity exists in this period. ` +
        (eligibility.warnings || []).join(' ')
      );
    }

    // Additional local guard against in-progress/draft filing races.
    const existingAny = await Filing.findOne({
      workspaceId,
      type: normType,
      period
    }).lean();

    if (existingAny?.status === 'Filed' && existingAny.arn) {
      throw ApiError.validationError(
        `${normType} for period ${period} is already filed with ARN: ${existingAny.arn}.`
      );
    }

    if (['InProgress', 'ReadyToEVC', 'SUBMITTED', 'Submitted'].includes(existingAny?.status)) {
      throw ApiError.validationError(
        `A filing for ${normType} ${period} is already in progress. Please wait for it to finish.`
      );
    }

    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError(
        'Live nil-return filing is disabled outside production. No return was filed.',
        503
      );
    }

    const FinaggService = require('./finagg.service');
    const provider = FinaggService.getProvider();
    const providerName = FinaggService.getProviderNameSafe();

    if (!provider) {
      throw ApiError.providerError('No live GST provider is available. Nil return was not filed.', 502);
    }

    let cleanToken = options.gstToken || options.token;

    if (!cleanToken && typeof provider.getActiveToken === 'function') {
      cleanToken = provider.getActiveToken(normGstin, cleanUsername);
    }

    if (!cleanToken || typeof cleanToken !== 'string' || !cleanToken.trim()) {
      throw ApiError.validationError(
        'Active GST Portal session token is required to file on the Government Portal. Please verify OTP on the GST Return Hub first.'
      );
    }

    cleanToken = cleanToken.trim();

    const authCtx = {
      gstin: normGstin,
      username: cleanUsername,
      token: cleanToken,
      gstToken: cleanToken
    };

    let arn;
    let saveRef = null;
    let fileRef = null;
    let nilSavePayload = null;
    let portalConfirmation = { confirmed: false, skipped: false };

    const filingDate = new Date();
    const dateStr = formatGstnDate(filingDate);
    const mode = 'NIL_EVC';

    try {
      if (normType === 'GSTR1') {
        if (
          typeof provider.saveGstr1 !== 'function' ||
          typeof provider.fileGstr1 !== 'function' ||
          typeof provider.trackStatus !== 'function'
        ) {
          throw ApiError.providerError(
            'Active GST provider does not support the complete Nil GSTR-1 filing flow.',
            502
          );
        }

        /* -------------------------------------------------------------- */
        /* Step 1: Save minimal nil payload                               */
        /* Do NOT fabricate isnil. GSTN RETSUM must confirm isnil: "Y".   */
        /* -------------------------------------------------------------- */
        nilSavePayload = buildNilGstr1SavePayload(normGstin, period);
        validateNilGstr1SavePayload(nilSavePayload);

        logger.info(`Nil GSTR-1 RETSAVE initiated for [${normGstin} - ${period}]...`);

        const saveRes = await provider.saveGstr1(nilSavePayload, {
          ...authCtx,
          period,
          ret_period: period,
          idempotencyKey
        });

        saveRef = getReferenceId(saveRes);

        if (!saveRef) {
          throw ApiError.providerError(
            'Nil GSTR-1 RETSAVE did not return required reference_id. Save was not confirmed.',
            502
          );
        }

        await waitForProcessing(provider, saveRef, authCtx, 'Nil GSTR-1 RETSAVE');

        /* -------------------------------------------------------------- */
        /* Step 2: Proceed to file / generate summary                     */
        /* Fallback to submit only if proceed is unavailable or fails.    */
        /* At least one pre-file confirmation is mandatory unless step=none. */
        /* -------------------------------------------------------------- */
        const preFileStep = getNilGstr1PreFileStep(provider);
        let preFileConfirmed = preFileStep === 'none';
        let proceedError = null;

        if (preFileStep === 'proceed' && typeof provider.proceedToFile === 'function') {
          try {
            logger.info(`Nil GSTR-1 ProceedToFile initiated for [${normGstin} - ${period}]...`);

            const procRes = await provider.proceedToFile(period, {
              ...authCtx,
              period,
              ret_period: period,
              isNil: true,
              returnType: 'GSTR1',
              idempotencyKey
            });

            const procRef = getReferenceId(procRes);

            if (!procRef && procRes?.isSync !== 'Y') {
              throw ApiError.providerError(
                'Nil GSTR-1 proceed-to-file was not confirmed by GST portal. Filing aborted.',
                502
              );
            }

            if (procRef && procRes?.isSync !== 'Y') {
              await waitForProcessing(provider, procRef, authCtx, 'Nil GSTR-1 ProceedToFile', 10, 3000);
            }

            preFileConfirmed = true;
          } catch (procErr) {
            proceedError = procErr;
            logger.warn('Nil GSTR-1 proceedToFile failed; trying submit fallback if available', {
              error_cd: procErr?.errorCd,
              message: safeErrorMessage(procErr)
            });
          }
        }

        if (
          !preFileConfirmed &&
          (preFileStep === 'retsubmit' || preFileStep === 'proceed') &&
          typeof provider.submitGstr1 === 'function'
        ) {
          logger.info(`Nil GSTR-1 Submit fallback initiated for [${normGstin} - ${period}]...`);

          const submitRes = await provider.submitGstr1(period, {
            ...authCtx,
            period,
            ret_period: period,
            gstin: normGstin,
            isNil: true,
            generate_summary: 'Y',
            idempotencyKey
          });

          const subRef = getReferenceId(submitRes);

          if (!subRef) {
            throw ApiError.providerError(
              'Nil GSTR-1 submit did not return required reference_id. Submit was not confirmed.',
              502
            );
          }

          await waitForProcessing(provider, subRef, authCtx, 'Nil GSTR-1 Submit', 10, 3000);
          preFileConfirmed = true;
        }

        if (!preFileConfirmed && preFileStep !== 'none') {
          throw proceedError || ApiError.providerError(
            'Nil GSTR-1 pre-filing (proceed/submit) could not be confirmed. Filing aborted.',
            502
          );
        }

        // Brief pause to allow GST portal summary background calculation to settle.
        await sleep(NIL_SUMMARY_SETTLE_MS);

        /* -------------------------------------------------------------- */
        /* Step 3: Confirm GSTN nil summary                               */
        /* Official GSTR-1 Summary nil variant requires isnil: "Y".       */
        /* -------------------------------------------------------------- */
        portalConfirmation = await fetchNilSummary(
          provider,
          'GSTR1',
          authCtx,
          period,
          'Nil GSTR-1 RETSUM'
        );

        /* -------------------------------------------------------------- */
        /* Step 4: RETFILE with EVC                                       */
        /* -------------------------------------------------------------- */
        logger.info(`Nil GSTR-1 RETFILE initiated with EVC OTP for [${normGstin} - ${period}]...`);

        const fileRes = await provider.fileGstr1(period, {
          ...authCtx,
          period,
          ret_period: period,
          gstin: normGstin,
          otp: cleanOtp,
          pan: cleanPan,
          mode: 'EVC',
          isNil: true,
          portalConfirmed: portalConfirmation.confirmed,
          finalSummaryData: portalConfirmation.data || portalConfirmation.summary,
          finalSummaryRaw: portalConfirmation.raw,
          idempotencyKey
        });

        arn = fileRes?.arn;
        fileRef = getReferenceId(fileRes);

        if (!arn) {
          throw ApiError.providerError(
            'GST provider did not return an ARN for Nil GSTR-1. Filing was not confirmed.',
            502
          );
        }

        logger.info(`Live Nil GSTR-1 filed successfully with official GSTN ARN: ${arn}`);
      } else if (normType === 'GSTR3B') {
        if (typeof provider.fileGstr3b !== 'function') {
          throw ApiError.providerError(
            'Active GST provider does not support Nil GSTR-3B filing.',
            502
          );
        }

        /*
         * GSTR-3B nil filing relies on portal-confirmed nil summary.
         * Do not fabricate save/offset payload without an official GSTR-3B nil schema.
         * provider.fileGstr3b() should fetch final summary and reject unless isnil: "Y".
         */
        portalConfirmation = await fetchNilSummary(
          provider,
          'GSTR3B',
          authCtx,
          period,
          'Nil GSTR-3B RETSUM'
        );

        logger.info(`Nil GSTR-3B RETFILE initiated with EVC OTP for [${normGstin} - ${period}]...`);

        const fileRes = await provider.fileGstr3b(period, {
          ...authCtx,
          period,
          ret_period: period,
          gstin: normGstin,
          otp: cleanOtp,
          pan: cleanPan,
          mode: 'EVC',
          isNil: true,
          portalConfirmed: portalConfirmation.confirmed,
          finalSummaryData: portalConfirmation.data || portalConfirmation.summary,
          finalSummaryRaw: portalConfirmation.raw,
          idempotencyKey
        });

        arn = fileRes?.arn;
        fileRef = getReferenceId(fileRes);

        if (!arn) {
          throw ApiError.providerError(
            'GST provider did not return an ARN for Nil GSTR-3B. Filing was not confirmed.',
            502
          );
        }

        logger.info(`Live Nil GSTR-3B filed successfully with official GSTN ARN: ${arn}`);
      } else {
        throw ApiError.providerError(`Active GST provider does not support Nil ${normType} filing.`, 502);
      }
    } catch (err) {
      const outcomeUnknown = isIndeterminateFilingError(err);

      if (outcomeUnknown) {
        let filedArn = null;

        if (typeof provider.findFiledArn === 'function') {
          try {
            filedArn = await provider.findFiledArn(normGstin, period, normType);
          } catch (recoveryErr) {
            logger.warn('Nil return ARN recovery failed', {
              gstin: normGstin,
              period,
              type: normType,
              error: safeErrorMessage(recoveryErr)
            });
          }
        }

        if (filedArn) {
          logger.info(`Nil return was confirmed filed on GST portal. Recovered official ARN: ${filedArn}`);
          arn = filedArn;

          // If portal already shows filed, treat nil confirmation as implicitly confirmed.
          portalConfirmation = {
            confirmed: true,
            skipped: false,
            recoveredFromPortal: true
          };
        } else {
          await writeAudit({
            workspaceId,
            memberId: options.memberId || null,
            gstin: normGstin,
            action: `${normType}_NIL_FILE`,
            period,
            status: 'FAILED',
            metadata: {
              arn: null,
              mode,
              provider: providerName,
              errorCd: err?.errorCd,
              code: err?.code,
              outcome: 'UNCONFIRMED',
              idempotencyKey,
              message: safeErrorMessage(err)
            }
          });

          throw err;
        }
      } else {
        await writeAudit({
          workspaceId,
          memberId: options.memberId || null,
          gstin: normGstin,
          action: `${normType}_NIL_FILE`,
          period,
          status: 'FAILED',
          metadata: {
            arn: arn || null,
            mode,
            provider: providerName,
            errorCd: err?.errorCd,
            code: err?.code,
            idempotencyKey,
            message: safeErrorMessage(err)
          }
        });

        throw err;
      }
    }

    if (!arn) {
      throw ApiError.providerError('GST provider did not confirm Nil return filing with an ARN.', 502);
    }

    /* ------------------------------------------------------------------ */
    /* 1. Permanent Filing record                                          */
    /* Return filed successfully on GST portal — handle DB failure safely */
    /* ------------------------------------------------------------------ */
    let recordPersisted = true;

    const payloadHash = normType === 'GSTR1' && nilSavePayload
      ? hashPayload(nilSavePayload)
      : hashPayload({
        type: normType,
        period,
        gstin: normGstin,
        isNil: true
      });

    const filingPayload = {
      workspaceId,
      gstin: normGstin,
      type: normType,
      period,
      arn,
      status: 'Filed',
      mode,
      isNil: true,
      filingDate,
      dateStr,
      declarationAccepted: true,
      referenceId: saveRef || fileRef || null,
      providerRefs: {
        saveReferenceId: saveRef || null,
        fileReferenceId: fileRef || null
      },
      payloadHash,
      idempotencyKey,
      notes:
        'Nil return filed under CGST Rule 67A. ' +
        `Portal nil confirmation: ${portalConfirmation.confirmed
          ? 'YES'
          : portalConfirmation.skipped
            ? 'SKIPPED_BY_CONFIG'
            : 'NOT_CONFIRMED'
        }.`,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      summary: {
        taxable: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        cess: 0,
        totalTax: 0,
        rcmTax: 0,
        eligibleItc: 0,
        netCashPayable: 0
      }
    };

    try {
      const existing = await Filing.findOne({
        workspaceId,
        type: normType,
        period
      }).lean();

      if (existing?.status === 'Filed' && existing.arn) {
        if (existing.arn !== arn) {
          logger.error('Nil return ARN mismatch between GSTN response and existing local filing record', {
            workspaceId,
            gstin: normGstin,
            type: normType,
            period,
            localArn: existing.arn,
            portalArn: arn
          });
        }

        // Prefer existing local ARN to avoid local state split-brain.
        arn = existing.arn;
      } else {
        await Filing.findOneAndUpdate(
          {
            workspaceId,
            type: normType,
            period
          },
          {
            $set: filingPayload
          },
          {
            upsert: true,
            new: true,
            runValidators: true,
            setDefaultsOnInsert: true
          }
        );
      }
    } catch (e) {
      if (e?.code === 11000) {
        logger.warn('Filing record race detected — re-reading existing record', {
          gstin: normGstin,
          type: normType,
          period
        });

        const dup = await Filing.findOne({
          workspaceId,
          type: normType,
          period
        }).lean().catch(() => null);

        if (dup?.status === 'Filed' && dup.arn) {
          arn = dup.arn;
        } else {
          try {
            await Filing.findOneAndUpdate(
              {
                workspaceId,
                type: normType,
                period
              },
              {
                $set: filingPayload
              },
              {
                new: true,
                runValidators: true
              }
            );
          } catch (forceErr) {
            recordPersisted = false;
            logger.error('CRITICAL: Nil return filed at GSTN but Filing record could not be force-updated', {
              arn,
              gstin: normGstin,
              type: normType,
              period,
              error: safeErrorMessage(forceErr)
            });
          }

          const after = await Filing.findOne({
            workspaceId,
            type: normType,
            period
          }).lean().catch(() => null);

          if (after?.status === 'Filed' && after.arn) {
            arn = after.arn;
          } else {
            recordPersisted = false;
          }
        }
      } else {
        recordPersisted = false;

        logger.error('CRITICAL: Nil return filed at GSTN but Filing record could not be saved', {
          arn,
          gstin: normGstin,
          type: normType,
          period,
          error: safeErrorMessage(e)
        });

        await writeAudit({
          workspaceId,
          memberId: options.memberId || null,
          gstin: normGstin,
          action: `${normType}_NIL_FILED_RECORD_FAILED`,
          period,
          status: 'FAILURE',
          metadata: {
            arn,
            provider: providerName,
            idempotencyKey,
            error: safeErrorMessage(e)
          }
        });
      }
    }

    /* ------------------------------------------------------------------ */
    /* 2. Encrypted Return cache                                           */
    /* Cache failure must not invalidate a successfully filed return.      */
    /* ------------------------------------------------------------------ */
    const nilReturnData = {
      type: normType,
      period,
      rows: [
        {
          label: normType === 'GSTR1'
            ? 'Table 4-13: Nil Outward Supplies (CGST Rule 67A)'
            : 'Table 3.1 & 4: Nil Outward Liability & Nil ITC (CGST Rule 67A)',
          section: 'NIL',
          taxable: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0,
          nilValue: 0
        }
      ],
      totals: {
        taxable: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        cess: 0
      },
      isNil: true,
      arn,
      status: 'FILED',
      filingStatus: 'Filed',
      filingMode: mode,
      filingDate: filingDate.toISOString(),
      fetchedAt: filingDate.toISOString(),
      portalConfirmation: {
        confirmed: Boolean(portalConfirmation.confirmed),
        skipped: Boolean(portalConfirmation.skipped),
        recoveredFromPortal: Boolean(portalConfirmation.recoveredFromPortal)
      }
    };

    try {
      const dataEnc = encrypt(nilReturnData);

      await Return.findOneAndUpdate(
        {
          workspaceId,
          gstin: normGstin,
          type: normType,
          period
        },
        {
          $set: {
            dataEnc,
            fetchedAt: filingDate
          }
        },
        {
          upsert: true
        }
      );
    } catch (cacheErr) {
      logger.warn('Failed to update Nil return cache', {
        arn,
        period,
        type: normType,
        error: safeErrorMessage(cacheErr)
      });
    }

    /* ------------------------------------------------------------------ */
    /* 3. Audit Log                                                        */
    /* ------------------------------------------------------------------ */
    await writeAudit({
      workspaceId,
      memberId: options.memberId || null,
      gstin: normGstin,
      action: `${normType}_NIL_FILED`,
      period,
      status: 'SUCCESS',
      metadata: {
        arn,
        mode,
        provider: providerName,
        recordPersisted,
        saveReferenceId: saveRef,
        fileReferenceId: fileRef,
        idempotencyKey,
        portalConfirmation: {
          confirmed: Boolean(portalConfirmation.confirmed),
          skipped: Boolean(portalConfirmation.skipped),
          recoveredFromPortal: Boolean(portalConfirmation.recoveredFromPortal)
        },
        eligibilitySnapshotAtStart: {
          activeInvoicesCount: eligibility.activeInvoicesCount,
          activeBillsCount: eligibility.activeBillsCount,
          totalItc: eligibility.totalItc,
          hasRcmLiability: eligibility.hasRcmLiability
        }
      }
    });

    logger.info(`Nil return filed successfully: ${normType} for ${normGstin} period ${period} [ARN: ${arn}]`);

    return {
      success: true,
      isNil: true,
      arn,
      type: normType,
      period,
      gstin: normGstin,
      filingDate: filingDate.toISOString(),
      dateStr,
      mode,
      status: 'Filed',
      recordPersisted,
      portalConfirmationRequired: true,
      portalConfirmation: {
        confirmed: Boolean(portalConfirmation.confirmed),
        skipped: Boolean(portalConfirmation.skipped),
        recoveredFromPortal: Boolean(portalConfirmation.recoveredFromPortal)
      },
      message: recordPersisted
        ? `Nil ${normType} return for ${period} has been filed successfully under CGST Rule 67A!`
        : `Nil ${normType} for ${period} was FILED at GSTN (ARN ${arn}), but the local record could not be saved. Please contact support — DO NOT file again.`,
      acknowledgement: {
        arn,
        gstin: normGstin,
        returnType: normType,
        period,
        status: 'FILED',
        mode,
        filedAt: dateStr,
        legalNotice: 'Acknowledged electronically under Central Goods and Services Tax Rules, 2017'
      }
    };
  }
}

module.exports = NilReturnService;    