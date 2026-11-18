/**
 * GSTR-1 Payload Validator
 *
 * Validates generated GSTR-1 RETSAVE payload against official GSTN schema rules.
 *
 * DESIGN RULE:
 * Validator is strictly faithful to the official GSTN RETSAVE request schema.
 * Legacy/third-party JSON must be pre-processed with normalizeGstr1Payload()
 * before passing to validateGstr1Schema().
 */

const ApiError = require('./apiError');
const { isValidGstin } = require('./gstin');

/* -------------------------------------------------------------------------- */
/* Config — env-overridable (tightening only, never loosening)                 */
/* -------------------------------------------------------------------------- */

const parseEnum = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

const DOC_TYP_ENUM = parseEnum(process.env.GSTN_DOC_TYP_ENUM);
const UQC_ENUM = parseEnum(process.env.GSTN_UQC_ENUM);

// HSN net-of-credit-note negatives are allowed by schema definitions/hsnamt and hsnqty.
const HSN_ALLOW_NEGATIVE =
  String(process.env.GSTN_HSN_ALLOW_NEGATIVE || 'true').toLowerCase() === 'true';

// doc_num hard limit per schema definitions.doc_num is 1..12
const SCHEMA_DOC_NUM_MAX = 12;
const ENV_DOC_NUM_MAX = Number(process.env.GSTN_DOC_NUM_MAX || SCHEMA_DOC_NUM_MAX);
const DOC_NUM_MAX = ENV_DOC_NUM_MAX > 0 ? Math.min(SCHEMA_DOC_NUM_MAX, ENV_DOC_NUM_MAX) : SCHEMA_DOC_NUM_MAX;

// GSTR-1 HSN desc documented limit is 30 characters in value-wise/no-HSN variants.
const HSN_DESC_MAX = Number(process.env.GSTN_HSN_DESC_MAX || 30);

/* -------------------------------------------------------------------------- */
/* Numeric bounds from official schema definitions                            */
/* -------------------------------------------------------------------------- */

const NON_EMPTY_COST_MAX = 99999999999.99;
const NON_EMPTY_COST_MIN = 0;

const TXVAL_MAX = 99999999999.99;
const TXVAL_MIN = 0;

const TXVALUE_MAX = 99999999999.99;
// definitions/txvalue has no minimum, so negative net adjustments are possible.
const TXVALUE_MIN = null;

const NON_EMPTY_NIL_MAX = 99999999999.99;
const NON_EMPTY_NIL_MIN = null;

const TOTAL_VALUE_MAX = 9999999999999.99;
const TOTAL_VALUE_MIN = 0;

const HSN_AMT_MAX = 9999999999999.99;
const HSN_AMT_MIN = HSN_ALLOW_NEGATIVE ? -9999999999999.99 : 0;

const HSN_QTY_MAX = 999999999999999.99;
const HSN_QTY_MIN = HSN_ALLOW_NEGATIVE ? -999999999999999.99 : 0;

const NON_EMPTY_COST_AT_MAX = 99999999999.99;
const NON_EMPTY_COST_AT_MIN = -99999999999.99;

const GT_MAX = 999999999999999.99;
const GT_MIN = 0;

const RATE_MAX = 999.99;
const RATE_MAX_NON_EMPTY_RATE = 999.9;
const RATE_MIN = 0;

const DOC_COUNT_MAX = 9999999999;

/* -------------------------------------------------------------------------- */
/* Patterns & Constants                                                       */
/* -------------------------------------------------------------------------- */

// GSTN official pattern for inum:
// 1-16 chars, allowed [a-zA-Z0-9/-], MUST have at least one [a-zA-Z1-9].
const INUM_RE = /^(?=.{1,16}$)(?:[\/0-9-]*[a-zA-Z0-9\/-]*[a-zA-Z1-9][a-zA-Z0-9\/-]*)$/;

const DATE_RE = /^(\d{2})-(\d{2})-(\d{4})$/;
const FP_RE = /^(0[1-9]|1[012])(19|20)\d\d$/;
const HSN_RE = /^[0-9]{2,8}$/;
const UQC_RE = /^[A-Za-z]+$/;
const SBNUM_RE = /^[0-9]{3,7}$/;
const SPCODE_RE = /^[A-Za-z0-9]{1,6}$/;

const ETIN_RE = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}C[0-9A-Za-z]{1}$/;
const SUPECO_ETIN_RE = /^[A-Za-z0-9._\s]{15}$/;

// Domestic states: 01-38, 97 (definitions/state_cd)
const DOMESTIC_POS = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '97'
]);

// Foreign/Export states: 01-38, 96, 97 (definitions/state_cd_foreign)
const FOREIGN_POS = new Set([...DOMESTIC_POS, '96']);

const STANDARD_FLAGS = new Set(['N', 'M', 'U', 'E']);
const DELETION_FLAG = 'D';
const ECOM_FLAGS = new Set(['N', 'E', 'D']);

const ALLOWED_INV_TYP_B2B = ['R', 'DE', 'SEWP', 'SEWOP', 'CBW'];
const ALLOWED_INV_TYP_ECOM = ['R', 'DE', 'SEWP', 'SEWOP'];
const ALLOWED_INV_TYP_URP2B = ['R', 'SEWP', 'SEWOP', 'DE'];

const ALLOWED_NTTY = ['C', 'D', 'R'];
const ALLOWED_NIL_SPLY = ['INTRB2B', 'INTRB2C', 'INTRAB2B', 'INTRAB2C'];
const ALLOWED_CDNUR_TYP = ['B2CL', 'EXPWP', 'EXPWOP'];
const ALLOWED_SPly_TY = ['INTER', 'INTRA'];
const ALLOWED_B2CS_TYP = ['E', 'OE'];
const ALLOWED_EXP_TYP = ['WOPAY', 'WPAY'];

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Allowed itm_det keys per section
const B2B_DET_KEYS = ['rt', 'txval', 'iamt', 'camt', 'samt', 'csamt'];
const B2CL_DET_KEYS = ['rt', 'txval', 'iamt', 'csamt']; // strictly NO camt, samt
const CDNR_DET_KEYS = B2B_DET_KEYS;
const CDNUR_DET_KEYS = B2B_DET_KEYS;
const ECOM_DET_KEYS = B2B_DET_KEYS;

// Allowed keys for save request objects (strictly NO chksum — additionalProperties: false in schema)
const B2B_INV_KEYS = [
  'etin', 'flag', 'inum', 'idt', 'val', 'pos', 'rchrg', 'inv_typ',
  'irngendate', 'irn', 'srctyp', 'itms'
];

const B2BA_INV_KEYS = [...B2B_INV_KEYS, 'oinum', 'oidt'];

const B2CL_REG_KEYS = ['etin', 'flag', 'inum', 'idt', 'val', 'itms'];
const B2CL_DEL_KEYS = ['etin', 'flag', 'inum', 'idt', 'val', 'pos', 'itms'];
const B2CLA_REG_KEYS = [...B2CL_REG_KEYS, 'oinum', 'oidt'];
const B2CLA_DEL_KEYS = [...B2CL_DEL_KEYS, 'oinum', 'oidt'];

const B2CS_KEYS = [
  'typ', 'sply_ty', 'rt', 'etin', 'flag', 'pos',
  'txval', 'iamt', 'camt', 'samt', 'csamt'
];

const B2CSA_KEYS = [
  'typ', 'sply_ty', 'etin', 'flag', 'pos', 'omon', 'itms'
];

const EXP_INV_KEYS = [
  'flag', 'inum', 'idt', 'val', 'sbnum', 'sbdt', 'sbpcode',
  'irngendate', 'irn', 'srctyp', 'itms'
];

const EXPA_INV_KEYS = [...EXP_INV_KEYS, 'oinum', 'oidt'];

const EXP_ITEM_KEYS = ['rt', 'txval', 'iamt', 'csamt'];

const CDNR_NOTE_KEYS = [
  'etin', 'flag', 'val', 'ntty', 'nt_num', 'nt_dt', 'pos', 'rchrg', 'inv_typ',
  'irngendate', 'irn', 'srctyp', 'itms'
];

const CDNRA_NOTE_KEYS = [...CDNR_NOTE_KEYS, 'ont_num', 'ont_dt'];

const CDNUR_NOTE_KEYS = [
  'typ', 'flag', 'pos', 'val', 'ntty', 'nt_num', 'nt_dt',
  'irngendate', 'irn', 'srctyp', 'itms'
];

const CDNURA_NOTE_KEYS = [...CDNUR_NOTE_KEYS, 'ont_num', 'ont_dt'];

const ADVANCE_ITEM_KEYS = ['ad_amt', 'csamt', 'camt', 'samt', 'iamt', 'rt'];

const HSN_ROW_KEYS = [
  'num', 'hsn_sc', 'val', 'txval', 'iamt', 'camt', 'samt', 'csamt',
  'desc', 'uqc', 'qty', 'flag', 'rt'
];

const ECOM_B2B_INVOICE_KEYS = [
  'val', 'itms', 'inv_typ', 'flag', 'pos', 'idt', 'inum', 'sply_ty'
];

const ECOM_B2BA_INVOICE_KEYS = [...ECOM_B2B_INVOICE_KEYS, 'oinum', 'oidt'];

const ECOM_B2C_KEYS = [
  'stin', 'rt', 'flag', 'pos', 'txval', 'sply_ty',
  'csamt', 'samt', 'camt', 'iamt'
];

const ECOM_URP2C_KEYS = [
  'rt', 'flag', 'pos', 'txval', 'sply_ty',
  'csamt', 'samt', 'camt', 'iamt'
];

const ECOM_B2CA_POSITM_KEYS = [
  'stin', 'ostin', 'flag', 'sply_ty', 'omon', 'itms'
];

const ECOM_URP2CA_KEYS = [
  'flag', 'itms', 'pos', 'sply_ty', 'omon'
];

const ECOM_B2C_ITEM_KEYS = [
  'rt', 'txval', 'iamt', 'camt', 'samt', 'csamt'
];

// All 4 official GSTN schema recipient identification patterns (definitions/ctin)
const CTIN_PATTERNS = [
  /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}[Zz1-9A-Ja-j]{1}[0-9A-Za-z]{1}$/, // GSTIN
  /^[0-9]{4}[A-Z]{3}[0-9]{5}[UO]N[A-Z0-9]{1}$/,                                          // UN body
  /^[0-9]{4}[A-Za-z]{3}[0-9]{5}NR[A-Za-z0-9]{1}$/,                                        // NR entity
  /^[0-9]{2}[A-Za-z]{4}[A-Za-z0-9]{1}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}D[A-Za-z0-9]{1}$/    // Diplomatic
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const fail = (msg) => {
  throw ApiError.validationError(msg);
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyKeys(value, allowedKeys, location) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    fail(`GSTR-1 Schema Error (${location}): must be a JSON object.`);
  }

  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((k) => !allowed.has(k));

  if (unexpected) {
    fail(
      `GSTR-1 Schema Error (${location}): '${unexpected}' is not an allowed field. ` +
      `Allowed: ${allowedKeys.join(', ')}`
    );
  }
}

function assertArrayIfPresent(list, location) {
  if (list === undefined) return false;
  if (!Array.isArray(list)) {
    fail(`GSTR-1 Schema Error (${location}): must be an array when present.`);
  }
  return true;
}

function assertNonEmptyArrayIfPresent(list, location) {
  if (list === undefined) return false;

  if (!Array.isArray(list)) {
    fail(`GSTR-1 Schema Error (${location}): must be an array when present.`);
  }

  if (list.length === 0) {
    fail(`GSTR-1 Schema Error (${location}): array must contain at least one item when present.`);
  }

  return true;
}

function assertObjectIfPresent(obj, location) {
  if (obj === undefined) return false;
  if (!isPlainObject(obj)) {
    fail(`GSTR-1 Schema Error (${location}): must be an object when present.`);
  }
  return true;
}

function assertNonEmptyObject(obj, location) {
  if (!isPlainObject(obj)) return;
  if (Object.keys(obj).length === 0) {
    fail(`GSTR-1 Schema Error (${location}): object must contain at least one field when present.`);
  }
}

function isMultipleOf01(val) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return false;

  const s = String(val);

  if (s.includes('e') || s.includes('E')) {
    const scaled = Math.round(val * 100);
    return Math.abs(val * 100 - scaled) < 1e-6;
  }

  if (!s.includes('.')) return true;

  const parts = s.split('.');
  const decimals = parts[1] || '';

  if (decimals.length <= 2) return true;

  return /^0+$/.test(decimals.slice(2));
}

function assertNumber(
  val,
  field,
  location,
  {
    integer = false,
    min = 0,
    max = null,
    multipleOf01 = true
  } = {}
) {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be a valid finite number. Received: ${val}`);
  }

  if (integer) {
    if (!Number.isInteger(val)) {
      fail(`GSTR-1 Schema Error (${location}): '${field}' must be an integer. Received: ${val}`);
    }
    if (min !== null && val < min) {
      fail(`GSTR-1 Schema Error (${location}): '${field}' must be >= ${min}. Received: ${val}`);
    }
    if (max !== null && val > max) {
      fail(`GSTR-1 Schema Error (${location}): '${field}' exceeds maximum ${max}. Received: ${val}`);
    }
    return;
  }

  if (min !== null && val < min) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be >= ${min}. Received: ${val}`);
  }

  if (max !== null && val > max) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' exceeds maximum ${max}. Received: ${val}`);
  }

  if (multipleOf01 && !isMultipleOf01(val)) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be a multiple of 0.01. Received: ${val}`);
  }
}

function assertOptionalNumber(val, field, location, opts) {
  if (val === undefined || val === null) return;
  assertNumber(val, field, location, opts);
}

function assertRate(val, field, location, max = RATE_MAX) {
  assertNumber(val, field, location, { min: RATE_MIN, max, multipleOf01: true });
}

function assertStandardFlag(val, location) {
  if (val === undefined || val === null) return;
  if (typeof val !== 'string') {
    fail(`GSTR-1 Schema Error (${location}): 'flag' must be a string enum.`);
  }
  if (!STANDARD_FLAGS.has(val)) {
    fail(
      `GSTR-1 Schema Error (${location}): regular 'flag' must be one of ` +
      `${Array.from(STANDARD_FLAGS).join(', ')}. Received: "${val}"`
    );
  }
}

function assertDeletionFlag(val, location) {
  if (val !== DELETION_FLAG) {
    fail(`GSTR-1 Schema Error (${location}): deletion variant requires 'flag' = "D". Received: ${val}`);
  }
}

function assertEcomFlag(val, location, { required = false, allowDeletion = true } = {}) {
  if (val === undefined || val === null) {
    if (required) fail(`GSTR-1 Schema Error (${location}): 'flag' is mandatory.`);
    return;
  }

  if (typeof val !== 'string') {
    fail(`GSTR-1 Schema Error (${location}): e-commerce 'flag' must be a string enum.`);
  }

  if (!ECOM_FLAGS.has(val)) {
    fail(
      `GSTR-1 Schema Error (${location}): e-commerce 'flag' must be one of ` +
      `${Array.from(ECOM_FLAGS).join(', ')}. Received: "${val}"`
    );
  }

  if (!allowDeletion && val === DELETION_FLAG) {
    fail(`GSTR-1 Schema Error (${location}): 'flag' = "D" is not allowed in this variant.`);
  }
}

function isGstnDate(str) {
  const m = DATE_RE.exec(String(str || ''));
  if (!m) return false;

  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);

  if (month < 1 || month > 12) return false;
  if (day < 1) return false;

  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [
    31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31
  ][month - 1];

  return day <= daysInMonth;
}

function assertDate(val, field, location) {
  if (typeof val !== 'string' || !isGstnDate(val)) {
    fail(
      `GSTR-1 Schema Error (${location}): '${field}' must be a valid calendar date ` +
      `DD-MM-YYYY with no spaces. Received: "${val}"`
    );
  }
}

function assertInum(val, field, location) {
  if (typeof val !== 'string' || !INUM_RE.test(val)) {
    fail(
      `GSTR-1 Schema Error (${location}): '${field}' must be 1-16 chars ` +
      `(alphanumeric, '/' or '-'), no spaces, and must contain at least one ` +
      `alphanumeric character (1-9 or A-Z). Received: "${val}"`
    );
  }
}

function assertPos(val, location, foreign = false) {
  const s = typeof val === 'string' ? val : String(val ?? '');
  const allowed = foreign ? FOREIGN_POS : DOMESTIC_POS;

  if (!/^[0-9]{2}$/.test(s) || !allowed.has(s)) {
    fail(
      `GSTR-1 Schema Error (${location}): invalid Place of Supply '${val}'. ` +
      `Must be a valid GST state code (${foreign ? '01-38, 96, 97' : '01-38, 97'}).`
    );
  }
}

function assertYesNo(val, field, location) {
  if (val !== 'Y' && val !== 'N') {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be strictly 'Y' or 'N'. Received: ${val}`);
  }
}

function assertString(
  val,
  field,
  location,
  {
    maxLen = null,
    required = true,
    allowEmpty = false,
    minLength = 0
  } = {}
) {
  if (val === undefined || val === null) {
    if (required) fail(`GSTR-1 Schema Error (${location}): '${field}' is mandatory.`);
    return;
  }

  if (typeof val !== 'string') {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be a string. Received: ${typeof val}`);
  }

  if (val === '') {
    if (required) fail(`GSTR-1 Schema Error (${location}): '${field}' cannot be empty.`);
    if (!allowEmpty) fail(`GSTR-1 Schema Error (${location}): '${field}' cannot be empty.`);
    return;
  }

  if (val !== val.trim()) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' has leading/trailing whitespace.`);
  }

  if (maxLen !== null && val.length > maxLen) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' exceeds max length ${maxLen} (got ${val.length}).`);
  }

  if (minLength && val.length < minLength) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must have minimum length ${minLength}.`);
  }
}

function assertNonEmptyString(val, field, location, { maxLen = null } = {}) {
  assertString(val, field, location, {
    required: false,
    allowEmpty: false,
    maxLen
  });
}

function isValidCtin(val) {
  if (typeof val !== 'string' || val.length !== 15) return false;
  return CTIN_PATTERNS.some((re) => re.test(val));
}

function assertCtin(val, location, field = 'ctin') {
  if (!isValidCtin(val)) {
    fail(`GSTR-1 Schema Error (${location}): invalid '${field}': ${val}`);
  }
}

function assertEtin(val, location) {
  if (val === undefined || val === null) return;

  if (typeof val !== 'string') {
    fail(`GSTR-1 Schema Error (${location}): 'etin' must be a string.`);
  }

  if (val === '') return; // schema definition etinEmptyChck

  if (!ETIN_RE.test(val)) {
    fail(
      `GSTR-1 Schema Error (${location}): invalid 'etin'. ` +
      `Must be 15 chars e-commerce operator ID ending with C at position 13. Received: "${val}"`
    );
  }
}

function assertEtinRequired(val, location) {
  if (val === undefined || val === null || val === '') {
    fail(`GSTR-1 Schema Error (${location}): 'etin' is mandatory for this row.`);
  }
  assertEtin(val, location);
}

function assertEtinForbidden(val, location) {
  if (val !== undefined && val !== null) {
    fail(`GSTR-1 Schema Error (${location}): 'etin' is not allowed for this row type.`);
  }
}

function assertSupecoEtin(val, location, field = 'etin') {
  if (typeof val !== 'string' || !SUPECO_ETIN_RE.test(val)) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be exactly 15 chars [A-Za-z0-9._\\s]. Received: "${val}"`);
  }
}

function assertOmon(val, location) {
  if (typeof val !== 'string' || !FP_RE.test(val)) {
    fail(`GSTR-1 Schema Error (${location}): 'omon' must be MMYYYY. Received: "${val}"`);
  }
}

/* -------------------------------------------------------------------------- */
/* Item validators                                                            */
/* -------------------------------------------------------------------------- */

function validateTaxItemDet(det, location, detKeys, opts = {}) {
  const {
    required = true,
    amountMin = NON_EMPTY_COST_MIN,
    amountMax = NON_EMPTY_COST_MAX,
    txvalMin = TXVAL_MIN,
    txvalMax = TXVAL_MAX,
    rateMax = RATE_MAX,
    enforceTaxHead = true
  } = opts;

  assertOnlyKeys(det, detKeys, `${location} itm_det`);
  assertNonEmptyObject(det, `${location} itm_det`);

  if (required) {
    if (det.rt === undefined || det.rt === null) {
      fail(`GSTR-1 Schema Error (${location} itm_det): 'rt' is mandatory.`);
    }
    if (det.txval === undefined || det.txval === null) {
      fail(`GSTR-1 Schema Error (${location} itm_det): 'txval' is mandatory.`);
    }
  }

  if (det.rt !== undefined && det.rt !== null) {
    assertRate(det.rt, 'rt', `${location} itm_det`, rateMax);
  }

  if (det.txval !== undefined && det.txval !== null) {
    assertNumber(det.txval, 'txval', `${location} itm_det`, {
      min: txvalMin,
      max: txvalMax,
      multipleOf01: true
    });
  }

  for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
    if (detKeys.includes(f) && det[f] !== undefined && det[f] !== null) {
      assertNumber(det[f], f, `${location} itm_det`, {
        min: amountMin,
        max: amountMax,
        multipleOf01: true
      });
    }
  }

  if (
    required &&
    enforceTaxHead &&
    typeof det.rt === 'number' &&
    det.rt > 0 &&
    typeof det.txval === 'number' &&
    det.txval > 0
  ) {
    const hasTaxHead = ['iamt', 'camt', 'samt', 'csamt'].some(
      (f) => detKeys.includes(f) && typeof det[f] === 'number'
    );

    if (!hasTaxHead) {
      fail(
        `GSTR-1 Schema Error (${location} itm_det): rt=${det.rt}% with txval>0 ` +
        `requires at least one allowed tax head.`
      );
    }
  }
}

function validateNumItems(itms, location, detKeys, opts = {}) {
  const {
    required = true,
    minNum = 1,
    detOpts = {}
  } = opts;

  if (itms === undefined) {
    if (required) {
      fail(`GSTR-1 Schema Error (${location}): 'itms' is mandatory.`);
    }
    return;
  }

  if (!Array.isArray(itms)) {
    fail(`GSTR-1 Schema Error (${location}): 'itms' must be an array when present.`);
  }

  if (itms.length === 0) {
    fail(`GSTR-1 Schema Error (${location}): 'itms' must contain at least one item when present.`);
  }

  for (let i = 0; i < itms.length; i++) {
    const item = itms[i];
    const loc = `${location} item #${i + 1}`;

    if (!isPlainObject(item)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(item, ['num', 'itm_det'], loc);
    assertNonEmptyObject(item, loc);

    if (required) {
      if (item.num === undefined || item.num === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'num' is mandatory.`);
      }
      assertNumber(item.num, 'num', loc, { integer: true, min: minNum });

      if (item.itm_det === undefined || item.itm_det === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'itm_det' is mandatory.`);
      }
    } else {
      if (item.num !== undefined && item.num !== null) {
        assertNumber(item.num, 'num', loc, { integer: true, min: minNum });
      }
    }

    if (item.itm_det !== undefined && item.itm_det !== null) {
      validateTaxItemDet(item.itm_det, loc, detKeys, {
        required,
        ...detOpts
      });
    }
  }
}

function validateFlatItems(itms, location, opts = {}) {
  const {
    required = true,
    allowedKeys,
    requiredKeys = [],
    numberRules = {},
    minItems = required ? 1 : 0
  } = opts;

  if (itms === undefined) {
    if (required) {
      fail(`GSTR-1 Schema Error (${location}): 'itms' is mandatory.`);
    }
    return;
  }

  if (!Array.isArray(itms)) {
    fail(`GSTR-1 Schema Error (${location}): 'itms' must be an array when present.`);
  }

  if (itms.length === 0 || (required && itms.length < minItems)) {
    fail(`GSTR-1 Schema Error (${location}): 'itms' must contain at least ${Math.max(1, minItems)} item(s).`);
  }

  for (let i = 0; i < itms.length; i++) {
    const item = itms[i];
    const loc = `${location} item #${i + 1}`;

    if (!isPlainObject(item)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(item, allowedKeys, loc);
    assertNonEmptyObject(item, loc);

    if (required) {
      for (const key of requiredKeys) {
        if (item[key] === undefined || item[key] === null) {
          fail(`GSTR-1 Schema Error (${loc}): '${key}' is mandatory.`);
        }
      }
    }

    for (const [key, rule] of Object.entries(numberRules)) {
      if (item[key] !== undefined && item[key] !== null) {
        assertNumber(item[key], key, loc, rule);
      }
    }
  }
}

function validateExpItems(itms, location, required = true) {
  validateFlatItems(itms, location, {
    required,
    allowedKeys: EXP_ITEM_KEYS,
    requiredKeys: required ? ['rt', 'txval'] : [],
    numberRules: {
      rt: { min: RATE_MIN, max: RATE_MAX, multipleOf01: true },
      txval: { min: TXVAL_MIN, max: TXVAL_MAX, multipleOf01: true },
      iamt: { min: NON_EMPTY_COST_MIN, max: NON_EMPTY_COST_MAX, multipleOf01: true },
      csamt: { min: NON_EMPTY_COST_MIN, max: NON_EMPTY_COST_MAX, multipleOf01: true }
    }
  });
}

function validateB2CSAItems(itms, location, required = true) {
  validateFlatItems(itms, location, {
    required,
    allowedKeys: ['rt', 'txval', 'iamt', 'camt', 'samt', 'csamt'],
    requiredKeys: required ? ['rt', 'txval'] : [],
    numberRules: {
      rt: { min: RATE_MIN, max: RATE_MAX, multipleOf01: true },
      txval: { min: TXVALUE_MIN, max: TXVALUE_MAX, multipleOf01: true },
      iamt: { min: NON_EMPTY_NIL_MIN, max: NON_EMPTY_NIL_MAX, multipleOf01: true },
      camt: { min: NON_EMPTY_NIL_MIN, max: NON_EMPTY_NIL_MAX, multipleOf01: true },
      samt: { min: NON_EMPTY_NIL_MIN, max: NON_EMPTY_NIL_MAX, multipleOf01: true },
      csamt: { min: NON_EMPTY_NIL_MIN, max: NON_EMPTY_NIL_MAX, multipleOf01: true }
    }
  });
}

function validateAdvanceItems(itms, location, opts = {}) {
  const {
    required = true,
    amountMin = NON_EMPTY_COST_AT_MIN,
    rateMax = RATE_MAX
  } = opts;

  validateFlatItems(itms, location, {
    required,
    allowedKeys: ADVANCE_ITEM_KEYS,
    requiredKeys: required ? ['ad_amt', 'rt'] : [],
    numberRules: {
      ad_amt: { min: amountMin, max: NON_EMPTY_COST_AT_MAX, multipleOf01: true },
      iamt: { min: amountMin, max: NON_EMPTY_COST_AT_MAX, multipleOf01: true },
      camt: { min: amountMin, max: NON_EMPTY_COST_AT_MAX, multipleOf01: true },
      samt: { min: amountMin, max: NON_EMPTY_COST_AT_MAX, multipleOf01: true },
      csamt: { min: amountMin, max: NON_EMPTY_COST_AT_MAX, multipleOf01: true },
      rt: { min: RATE_MIN, max: rateMax, multipleOf01: true }
    }
  });
}

function validateEcomItems(itms, location, required = true, minNum = 1) {
  validateNumItems(itms, location, ECOM_DET_KEYS, {
    required,
    minNum,
    detOpts: {
      amountMin: NON_EMPTY_COST_MIN,
      amountMax: NON_EMPTY_COST_MAX,
      txvalMin: TXVAL_MIN,
      txvalMax: TXVAL_MAX,
      rateMax: RATE_MAX,
      enforceTaxHead: true
    }
  });
}

function validateEcomB2CItems(itms, location, required = true) {
  validateFlatItems(itms, location, {
    required,
    allowedKeys: ECOM_B2C_ITEM_KEYS,
    requiredKeys: required ? ['rt', 'txval'] : [],
    numberRules: {
      rt: { min: RATE_MIN, max: RATE_MAX, multipleOf01: true },
      txval: { min: NON_EMPTY_COST_AT_MIN, max: NON_EMPTY_COST_AT_MAX, multipleOf01: true },
      iamt: { min: NON_EMPTY_COST_AT_MIN, max: NON_EMPTY_COST_AT_MAX, multipleOf01: true },
      camt: { min: NON_EMPTY_COST_AT_MIN, max: NON_EMPTY_COST_AT_MAX, multipleOf01: true },
      samt: { min: NON_EMPTY_COST_AT_MIN, max: NON_EMPTY_COST_AT_MAX, multipleOf01: true },
      csamt: { min: NON_EMPTY_COST_AT_MIN, max: NON_EMPTY_COST_AT_MAX, multipleOf01: true }
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Section validators                                                         */
/* -------------------------------------------------------------------------- */

function validateB2B(list, label = 'Table 4 B2B', amendment = false) {
  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  const invKeys = amendment ? B2BA_INV_KEYS : B2B_INV_KEYS;

  for (let c = 0; c < list.length; c++) {
    const party = list[c];
    const pLoc = `${label} party #${c + 1}`;

    if (!isPlainObject(party)) {
      fail(`GSTR-1 Schema Error (${pLoc}): must be an object.`);
    }

    assertOnlyKeys(party, ['ctin', 'inv'], pLoc);
    assertNonEmptyObject(party, pLoc);
    assertCtin(party.ctin, pLoc);

    if (!Array.isArray(party.inv) || party.inv.length === 0) {
      fail(`GSTR-1 Schema Error (${pLoc}): '${party.ctin}' has no invoices under 'inv'.`);
    }

    for (let i = 0; i < party.inv.length; i++) {
      const inv = party.inv[i];
      const loc = `${label} ${party.ctin} invoice #${i + 1}`;

      if (!isPlainObject(inv)) {
        fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
      }

      assertOnlyKeys(inv, invKeys, loc);
      assertNonEmptyObject(inv, loc);
      assertInum(inv.inum, 'inum', loc);
      assertDate(inv.idt, 'idt', loc);
      assertEtin(inv.etin, loc);
      assertNonEmptyString(inv.irn, 'irn', loc);
      assertNonEmptyString(inv.irngendate, 'irngendate', loc);
      assertNonEmptyString(inv.srctyp, 'srctyp', loc);

      const isDel = inv.flag === DELETION_FLAG;

      if (isDel) {
        assertDeletionFlag(inv.flag, loc);

        if (inv.val !== undefined && inv.val !== null) {
          assertNumber(inv.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });
        }
        if (inv.pos !== undefined && inv.pos !== null) assertPos(inv.pos, loc, true);
        if (inv.rchrg !== undefined && inv.rchrg !== null) assertYesNo(inv.rchrg, 'rchrg', loc);
        if (inv.inv_typ !== undefined && inv.inv_typ !== null) {
          if (!ALLOWED_INV_TYP_B2B.includes(inv.inv_typ)) {
            fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' must be one of ${ALLOWED_INV_TYP_B2B.join(', ')}. Received: ${inv.inv_typ}`);
          }
        }

        if (amendment) {
          if (inv.oinum !== undefined && inv.oinum !== null) assertInum(inv.oinum, 'oinum', loc);
          if (inv.oidt !== undefined && inv.oidt !== null) assertDate(inv.oidt, 'oidt', loc);
        }

        if (inv.itms !== undefined) {
          validateNumItems(inv.itms, loc, B2B_DET_KEYS, {
            required: false,
            minNum: 1,
            detOpts: {
              amountMin: NON_EMPTY_COST_MIN,
              amountMax: NON_EMPTY_COST_MAX,
              txvalMin: TXVAL_MIN,
              txvalMax: TXVAL_MAX
            }
          });
        }

        continue;
      }

      assertStandardFlag(inv.flag, loc);

      if (inv.val === undefined || inv.val === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'val' is mandatory.`);
      }
      assertNumber(inv.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });

      if (inv.pos === undefined || inv.pos === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'pos' is mandatory.`);
      }
      assertPos(inv.pos, loc, true);

      if (inv.rchrg === undefined || inv.rchrg === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'rchrg' is mandatory.`);
      }
      assertYesNo(inv.rchrg, 'rchrg', loc);

      if (inv.inv_typ === undefined || inv.inv_typ === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' is mandatory.`);
      }
      if (!ALLOWED_INV_TYP_B2B.includes(inv.inv_typ)) {
        fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' must be one of ${ALLOWED_INV_TYP_B2B.join(', ')}. Received: ${inv.inv_typ}`);
      }

      if (amendment) {
        if (inv.oinum === undefined || inv.oinum === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'oinum' is mandatory for amendment.`);
        }
        assertInum(inv.oinum, 'oinum', loc);

        if (inv.oidt === undefined || inv.oidt === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'oidt' is mandatory for amendment.`);
        }
        assertDate(inv.oidt, 'oidt', loc);
      }

      validateNumItems(inv.itms, loc, B2B_DET_KEYS, {
        required: true,
        minNum: 1,
        detOpts: {
          amountMin: NON_EMPTY_COST_MIN,
          amountMax: NON_EMPTY_COST_MAX,
          txvalMin: TXVAL_MIN,
          txvalMax: TXVAL_MAX
        }
      });
    }
  }
}

function validateB2CL(list, label = 'Table 5 B2CL', amendment = false) {
  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  for (let i = 0; i < list.length; i++) {
    const group = list[i];
    const gLoc = `${label} group #${i + 1}`;

    if (!isPlainObject(group)) {
      fail(`GSTR-1 Schema Error (${gLoc}): must be an object.`);
    }

    assertOnlyKeys(group, ['pos', 'inv'], gLoc);
    assertNonEmptyObject(group, gLoc);
    assertPos(group.pos, gLoc, false);

    if (!Array.isArray(group.inv) || group.inv.length === 0) {
      fail(`GSTR-1 Schema Error (${gLoc}): 'inv' must be a non-empty array.`);
    }

    for (let j = 0; j < group.inv.length; j++) {
      const inv = group.inv[j];
      const loc = `${gLoc} invoice #${j + 1}`;

      if (!isPlainObject(inv)) {
        fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
      }

      const isDel = inv.flag === DELETION_FLAG;
      const keys = amendment
        ? (isDel ? B2CLA_DEL_KEYS : B2CLA_REG_KEYS)
        : (isDel ? B2CL_DEL_KEYS : B2CL_REG_KEYS);

      assertOnlyKeys(inv, keys, loc);
      assertNonEmptyObject(inv, loc);
      assertInum(inv.inum, 'inum', loc);
      assertDate(inv.idt, 'idt', loc);
      assertEtin(inv.etin, loc);

      if (isDel) {
        assertDeletionFlag(inv.flag, loc);

        if (inv.val !== undefined && inv.val !== null) {
          assertNumber(inv.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });
        }
        if (inv.pos !== undefined && inv.pos !== null) assertPos(inv.pos, loc, false);

        if (amendment) {
          if (inv.oinum !== undefined && inv.oinum !== null) assertInum(inv.oinum, 'oinum', loc);
          if (inv.oidt !== undefined && inv.oidt !== null) assertDate(inv.oidt, 'oidt', loc);
        }

        if (inv.itms !== undefined) {
          validateNumItems(inv.itms, loc, B2CL_DET_KEYS, {
            required: false,
            minNum: 1,
            detOpts: {
              amountMin: NON_EMPTY_COST_MIN,
              amountMax: NON_EMPTY_COST_MAX,
              txvalMin: TXVAL_MIN,
              txvalMax: TXVAL_MAX
            }
          });
        }

        continue;
      }

      assertStandardFlag(inv.flag, loc);

      if (inv.val === undefined || inv.val === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'val' is mandatory.`);
      }
      assertNumber(inv.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });

      if (amendment) {
        if (inv.oinum === undefined || inv.oinum === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'oinum' is mandatory for amendment.`);
        }
        assertInum(inv.oinum, 'oinum', loc);

        if (inv.oidt === undefined || inv.oidt === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'oidt' is mandatory for amendment.`);
        }
        assertDate(inv.oidt, 'oidt', loc);
      }

      validateNumItems(inv.itms, loc, B2CL_DET_KEYS, {
        required: true,
        minNum: 1,
        detOpts: {
          amountMin: NON_EMPTY_COST_MIN,
          amountMax: NON_EMPTY_COST_MAX,
          txvalMin: TXVAL_MIN,
          txvalMax: TXVAL_MAX
        }
      });
    }
  }
}

function validateB2CS(list, label = 'Table 7 B2CS') {
  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const loc = `${label} row #${i + 1}`;

    if (!isPlainObject(row)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(row, B2CS_KEYS, loc);
    assertNonEmptyObject(row, loc);

    if (!ALLOWED_B2CS_TYP.includes(row.typ)) {
      fail(`GSTR-1 Schema Error (${loc}): 'typ' must be 'E' or 'OE'. Received: ${row.typ}`);
    }
    if (!ALLOWED_SPly_TY.includes(row.sply_ty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be 'INTER' or 'INTRA'. Received: ${row.sply_ty}`);
    }

    if (row.typ === 'E') {
      assertEtinRequired(row.etin, loc);
    } else {
      assertEtinForbidden(row.etin, loc);
    }

    const isDel = row.flag === DELETION_FLAG;

    if (isDel) {
      assertDeletionFlag(row.flag, loc);

      if (row.pos !== undefined && row.pos !== null) assertPos(row.pos, loc, false);
      if (row.rt !== undefined && row.rt !== null) assertRate(row.rt, 'rt', loc);
      if (row.txval !== undefined && row.txval !== null) {
        assertNumber(row.txval, 'txval', loc, { min: TXVALUE_MIN, max: TXVALUE_MAX });
      }
      for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
        if (row[f] !== undefined && row[f] !== null) {
          assertNumber(row[f], f, loc, { min: NON_EMPTY_NIL_MIN, max: NON_EMPTY_NIL_MAX });
        }
      }
    } else {
      assertStandardFlag(row.flag, loc);

      if (row.pos === undefined || row.pos === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'pos' is mandatory.`);
      }
      assertPos(row.pos, loc, false);

      if (row.rt === undefined || row.rt === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'rt' is mandatory.`);
      }
      assertRate(row.rt, 'rt', loc);

      if (row.txval === undefined || row.txval === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'txval' is mandatory.`);
      }
      assertNumber(row.txval, 'txval', loc, { min: TXVALUE_MIN, max: TXVALUE_MAX });

      for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
        if (row[f] !== undefined && row[f] !== null) {
          assertNumber(row[f], f, loc, { min: NON_EMPTY_NIL_MIN, max: NON_EMPTY_NIL_MAX });
        }
      }
    }

    // Statutory safeguard: inter-state supplies cannot have CGST/SGST, intra-state cannot have IGST.
    if (row.sply_ty === 'INTER' && (Number(row.camt || 0) !== 0 || Number(row.samt || 0) !== 0)) {
      fail(`GSTR-1 Schema Error (${loc}): INTER supply cannot have non-zero camt/samt. Use iamt.`);
    }
    if (row.sply_ty === 'INTRA' && Number(row.iamt || 0) !== 0) {
      fail(`GSTR-1 Schema Error (${loc}): INTRA supply cannot have non-zero iamt. Use camt/samt.`);
    }
  }
}

function validateB2CSA(list, label = 'Table 7B B2CSA') {
  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const loc = `${label} row #${i + 1}`;

    if (!isPlainObject(row)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(row, B2CSA_KEYS, loc);
    assertNonEmptyObject(row, loc);

    if (!ALLOWED_B2CS_TYP.includes(row.typ)) {
      fail(`GSTR-1 Schema Error (${loc}): 'typ' must be 'E' or 'OE'. Received: ${row.typ}`);
    }
    if (!ALLOWED_SPly_TY.includes(row.sply_ty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be 'INTER' or 'INTRA'. Received: ${row.sply_ty}`);
    }

    if (row.typ === 'E') {
      assertEtinRequired(row.etin, loc);
    } else {
      assertEtinForbidden(row.etin, loc);
    }

    const isDel = row.flag === DELETION_FLAG;

    if (isDel) {
      assertDeletionFlag(row.flag, loc);

      if (row.pos === undefined || row.pos === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'pos' is mandatory for B2CSA deletion.`);
      }
      assertPos(row.pos, loc, false);

      if (row.omon === undefined || row.omon === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'omon' is mandatory for B2CSA deletion.`);
      }
      assertOmon(row.omon, loc);

      if (row.itms !== undefined) {
        validateB2CSAItems(row.itms, loc, false);
      }

      continue;
    }

    assertStandardFlag(row.flag, loc);

    if (row.pos === undefined || row.pos === null) {
      fail(`GSTR-1 Schema Error (${loc}): 'pos' is mandatory.`);
    }
    assertPos(row.pos, loc, false);

    if (row.omon === undefined || row.omon === null) {
      fail(`GSTR-1 Schema Error (${loc}): 'omon' is mandatory.`);
    }
    assertOmon(row.omon, loc);

    validateB2CSAItems(row.itms, loc, true);
  }
}

function validateCdnr(list, label = 'Table 9B CDNR', amendment = false) {
  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  const noteKeys = amendment ? CDNRA_NOTE_KEYS : CDNR_NOTE_KEYS;

  for (let i = 0; i < list.length; i++) {
    const party = list[i];
    const pLoc = `${label} party #${i + 1}`;

    if (!isPlainObject(party)) {
      fail(`GSTR-1 Schema Error (${pLoc}): must be an object.`);
    }

    assertOnlyKeys(party, ['ctin', 'nt'], pLoc);
    assertNonEmptyObject(party, pLoc);
    assertCtin(party.ctin, pLoc);

    if (!Array.isArray(party.nt) || party.nt.length === 0) {
      fail(`GSTR-1 Schema Error (${pLoc}): 'nt' must be a non-empty array.`);
    }

    for (let j = 0; j < party.nt.length; j++) {
      const note = party.nt[j];
      const loc = `${pLoc} note #${j + 1}`;

      if (!isPlainObject(note)) {
        fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
      }

      assertOnlyKeys(note, noteKeys, loc);
      assertNonEmptyObject(note, loc);
      assertInum(note.nt_num, 'nt_num', loc);
      assertDate(note.nt_dt, 'nt_dt', loc);
      assertEtin(note.etin, loc);
      assertNonEmptyString(note.irn, 'irn', loc);
      assertNonEmptyString(note.irngendate, 'irngendate', loc);
      assertNonEmptyString(note.srctyp, 'srctyp', loc);

      const isDel = note.flag === DELETION_FLAG;

      if (isDel) {
        assertDeletionFlag(note.flag, loc);

        if (note.val !== undefined && note.val !== null) {
          assertNumber(note.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });
        }
        if (note.ntty !== undefined && note.ntty !== null && !ALLOWED_NTTY.includes(note.ntty)) {
          fail(`GSTR-1 Schema Error (${loc}): 'ntty' must be one of ${ALLOWED_NTTY.join(', ')}. Received: ${note.ntty}`);
        }
        if (note.pos !== undefined && note.pos !== null) assertPos(note.pos, loc, true);
        if (note.rchrg !== undefined && note.rchrg !== null) assertYesNo(note.rchrg, 'rchrg', loc);
        if (note.inv_typ !== undefined && note.inv_typ !== null && !ALLOWED_INV_TYP_B2B.includes(note.inv_typ)) {
          fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' must be one of ${ALLOWED_INV_TYP_B2B.join(', ')}. Received: ${note.inv_typ}`);
        }

        if (amendment) {
          if (note.ont_num !== undefined && note.ont_num !== null) assertInum(note.ont_num, 'ont_num', loc);
          if (note.ont_dt !== undefined && note.ont_dt !== null) assertDate(note.ont_dt, 'ont_dt', loc);
        }

        if (note.itms !== undefined) {
          validateNumItems(note.itms, loc, CDNR_DET_KEYS, {
            required: false,
            minNum: 1,
            detOpts: {
              amountMin: NON_EMPTY_COST_MIN,
              amountMax: NON_EMPTY_COST_MAX,
              txvalMin: TXVAL_MIN,
              txvalMax: TXVAL_MAX
            }
          });
        }

        continue;
      }

      assertStandardFlag(note.flag, loc);

      if (note.val === undefined || note.val === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'val' is mandatory.`);
      }
      assertNumber(note.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });

      if (!ALLOWED_NTTY.includes(note.ntty)) {
        fail(`GSTR-1 Schema Error (${loc}): 'ntty' must be one of ${ALLOWED_NTTY.join(', ')}. Received: ${note.ntty}`);
      }

      if (note.pos === undefined || note.pos === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'pos' is mandatory.`);
      }
      assertPos(note.pos, loc, true);

      if (note.rchrg === undefined || note.rchrg === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'rchrg' is mandatory.`);
      }
      assertYesNo(note.rchrg, 'rchrg', loc);

      if (note.inv_typ === undefined || note.inv_typ === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' is mandatory.`);
      }
      if (!ALLOWED_INV_TYP_B2B.includes(note.inv_typ)) {
        fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' must be one of ${ALLOWED_INV_TYP_B2B.join(', ')}. Received: ${note.inv_typ}`);
      }

      if (amendment) {
        if (note.ont_num === undefined || note.ont_num === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'ont_num' is mandatory for amendment.`);
        }
        assertInum(note.ont_num, 'ont_num', loc);

        if (note.ont_dt === undefined || note.ont_dt === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'ont_dt' is mandatory for amendment.`);
        }
        assertDate(note.ont_dt, 'ont_dt', loc);
      }

      validateNumItems(note.itms, loc, CDNR_DET_KEYS, {
        required: true,
        minNum: 1,
        detOpts: {
          amountMin: NON_EMPTY_COST_MIN,
          amountMax: NON_EMPTY_COST_MAX,
          txvalMin: TXVAL_MIN,
          txvalMax: TXVAL_MAX
        }
      });
    }
  }
}

function validateCdnur(list, label = 'Table 9C CDNUR', amendment = false) {
  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  const noteKeys = amendment ? CDNURA_NOTE_KEYS : CDNUR_NOTE_KEYS;

  for (let i = 0; i < list.length; i++) {
    const note = list[i];
    const loc = `${label} note #${i + 1}`;

    if (!isPlainObject(note)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }

    if (Array.isArray(note.nt)) {
      fail(
        `GSTR-1 Schema Error (${loc}): CDNUR must be a flat array of note objects. ` +
        `Grouped format { pos, nt } is not allowed by GSTN schema.`
      );
    }

    assertOnlyKeys(note, noteKeys, loc);
    assertNonEmptyObject(note, loc);
    assertInum(note.nt_num, 'nt_num', loc);
    assertDate(note.nt_dt, 'nt_dt', loc);
    assertNonEmptyString(note.irn, 'irn', loc);
    assertNonEmptyString(note.irngendate, 'irngendate', loc);
    assertNonEmptyString(note.srctyp, 'srctyp', loc);

    if (!note.typ || !ALLOWED_CDNUR_TYP.includes(note.typ)) {
      fail(`GSTR-1 Schema Error (${loc}): 'typ' is mandatory and must be one of ${ALLOWED_CDNUR_TYP.join(', ')}. Received: ${note.typ}`);
    }

    const isDel = note.flag === DELETION_FLAG;

    if (isDel) {
      assertDeletionFlag(note.flag, loc);

      if (note.val !== undefined && note.val !== null) {
        assertNumber(note.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });
      }
      if (note.ntty !== undefined && note.ntty !== null && !ALLOWED_NTTY.includes(note.ntty)) {
        fail(`GSTR-1 Schema Error (${loc}): 'ntty' must be one of ${ALLOWED_NTTY.join(', ')}. Received: ${note.ntty}`);
      }
      if (note.pos !== undefined && note.pos !== null) {
        assertPos(note.pos, loc, false);
      }

      if (amendment) {
        if (note.ont_num !== undefined && note.ont_num !== null) assertInum(note.ont_num, 'ont_num', loc);
        if (note.ont_dt !== undefined && note.ont_dt !== null) assertDate(note.ont_dt, 'ont_dt', loc);
      }

      if (note.itms !== undefined) {
        validateNumItems(note.itms, loc, CDNUR_DET_KEYS, {
          required: false,
          minNum: 1,
          detOpts: {
            amountMin: NON_EMPTY_COST_MIN,
            amountMax: NON_EMPTY_COST_MAX,
            txvalMin: TXVAL_MIN,
            txvalMax: TXVAL_MAX
          }
        });
      }

      continue;
    }

    assertStandardFlag(note.flag, loc);

    if (note.val === undefined || note.val === null) {
      fail(`GSTR-1 Schema Error (${loc}): 'val' is mandatory.`);
    }
    assertNumber(note.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });

    if (!ALLOWED_NTTY.includes(note.ntty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'ntty' must be one of ${ALLOWED_NTTY.join(', ')}. Received: ${note.ntty}`);
    }

    if (note.typ === 'B2CL') {
      if (note.pos === undefined || note.pos === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'pos' is mandatory when typ is B2CL.`);
      }
      assertPos(note.pos, loc, false);
    } else if (note.pos !== undefined && note.pos !== null) {
      fail(`GSTR-1 Schema Error (${loc}): 'pos' is not allowed for export notes (${note.typ}).`);
    }

    if (amendment) {
      if (note.ont_num === undefined || note.ont_num === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'ont_num' is mandatory for amendment.`);
      }
      assertInum(note.ont_num, 'ont_num', loc);

      if (note.ont_dt === undefined || note.ont_dt === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'ont_dt' is mandatory for amendment.`);
      }
      assertDate(note.ont_dt, 'ont_dt', loc);
    }

    validateNumItems(note.itms, loc, CDNUR_DET_KEYS, {
      required: true,
      minNum: 1,
      detOpts: {
        amountMin: NON_EMPTY_COST_MIN,
        amountMax: NON_EMPTY_COST_MAX,
        txvalMin: TXVAL_MIN,
        txvalMax: TXVAL_MAX
      }
    });
  }
}

function validateExp(list, label = 'Table 6A EXP', amendment = false) {
  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  const invKeys = amendment ? EXPA_INV_KEYS : EXP_INV_KEYS;

  for (let i = 0; i < list.length; i++) {
    const group = list[i];
    const gLoc = `${label} group #${i + 1}`;

    if (!isPlainObject(group)) {
      fail(`GSTR-1 Schema Error (${gLoc}): must be an object.`);
    }

    assertOnlyKeys(group, ['exp_typ', 'inv'], gLoc);
    assertNonEmptyObject(group, gLoc);

    if (!ALLOWED_EXP_TYP.includes(group.exp_typ)) {
      fail(`GSTR-1 Schema Error (${gLoc}): 'exp_typ' must be 'WOPAY' or 'WPAY'. Received: ${group.exp_typ}`);
    }

    if (!Array.isArray(group.inv) || group.inv.length === 0) {
      fail(`GSTR-1 Schema Error (${gLoc}): 'inv' must be a non-empty array.`);
    }

    for (let j = 0; j < group.inv.length; j++) {
      const inv = group.inv[j];
      const loc = `${gLoc} invoice #${j + 1}`;

      if (!isPlainObject(inv)) {
        fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
      }

      assertOnlyKeys(inv, invKeys, loc);
      assertNonEmptyObject(inv, loc);
      assertInum(inv.inum, 'inum', loc);
      assertDate(inv.idt, 'idt', loc);
      assertNonEmptyString(inv.irn, 'irn', loc);
      assertNonEmptyString(inv.irngendate, 'irngendate', loc);
      assertNonEmptyString(inv.srctyp, 'srctyp', loc);

      if (inv.sbdt !== undefined && inv.sbdt !== null) assertDate(inv.sbdt, 'sbdt', loc);

      if (inv.sbnum !== undefined && inv.sbnum !== null) {
        const sbnum = String(inv.sbnum);
        if (!SBNUM_RE.test(sbnum)) {
          fail(`GSTR-1 Schema Error (${loc}): 'sbnum' must be 3-7 digits. Received: "${inv.sbnum}"`);
        }
      }

      if (inv.sbpcode !== undefined && inv.sbpcode !== null) {
        const sbpcode = String(inv.sbpcode);
        if (!SPCODE_RE.test(sbpcode)) {
          fail(`GSTR-1 Schema Error (${loc}): 'sbpcode' must be 1-6 alphanumeric characters. Received: "${inv.sbpcode}"`);
        }
      }

      const isDel = inv.flag === DELETION_FLAG;

      if (isDel) {
        assertDeletionFlag(inv.flag, loc);

        if (inv.val !== undefined && inv.val !== null) {
          assertNumber(inv.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });
        }

        if (amendment) {
          if (inv.oinum !== undefined && inv.oinum !== null) assertInum(inv.oinum, 'oinum', loc);
          if (inv.oidt !== undefined && inv.oidt !== null) assertDate(inv.oidt, 'oidt', loc);
        }

        if (inv.itms !== undefined) {
          validateExpItems(inv.itms, loc, false);
        }

        continue;
      }

      assertStandardFlag(inv.flag, loc);

      if (inv.val === undefined || inv.val === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'val' is mandatory.`);
      }
      assertNumber(inv.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });

      if (amendment) {
        if (inv.oinum === undefined || inv.oinum === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'oinum' is mandatory for amendment.`);
        }
        assertInum(inv.oinum, 'oinum', loc);

        if (inv.oidt === undefined || inv.oidt === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'oidt' is mandatory for amendment.`);
        }
        assertDate(inv.oidt, 'oidt', loc);
      }

      validateExpItems(inv.itms, loc, true);
    }
  }
}

function validateAdvanceSection(list, label, opts = {}) {
  const {
    amendment = false,
    deletionRequiresPos = false,
    amountMin = NON_EMPTY_COST_AT_MIN,
    rateMax = RATE_MAX
  } = opts;

  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const loc = `${label} row #${i + 1}`;

    if (!isPlainObject(entry)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(entry, ['flag', 'pos', 'sply_ty', 'omon', 'itms'], loc);
    assertNonEmptyObject(entry, loc);

    const isDel = entry.flag === DELETION_FLAG;

    if (isDel) {
      assertDeletionFlag(entry.flag, loc);

      if (entry.sply_ty !== undefined && entry.sply_ty !== null) {
        if (!ALLOWED_SPly_TY.includes(entry.sply_ty)) {
          fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be 'INTER' or 'INTRA'. Received: ${entry.sply_ty}`);
        }
      }

      if (deletionRequiresPos) {
        if (entry.pos === undefined || entry.pos === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'pos' is mandatory for this deletion variant.`);
        }
      }

      if (entry.pos !== undefined && entry.pos !== null) {
        assertPos(entry.pos, loc, false);
      }

      if (entry.omon !== undefined && entry.omon !== null) {
        assertOmon(entry.omon, loc);
      }

      if (entry.itms !== undefined) {
        validateAdvanceItems(entry.itms, loc, {
          required: false,
          amountMin,
          rateMax
        });
      }

      continue;
    }

    assertStandardFlag(entry.flag, loc);

    if (!ALLOWED_SPly_TY.includes(entry.sply_ty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be 'INTER' or 'INTRA'. Received: ${entry.sply_ty}`);
    }

    if (entry.pos === undefined || entry.pos === null) {
      fail(`GSTR-1 Schema Error (${loc}): 'pos' is mandatory.`);
    }
    assertPos(entry.pos, loc, false);

    if (amendment) {
      if (entry.omon === undefined || entry.omon === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'omon' is mandatory for amendment.`);
      }
      assertOmon(entry.omon, loc);
    }

    validateAdvanceItems(entry.itms, loc, {
      required: true,
      amountMin,
      rateMax
    });
  }
}

function validateSupeco(obj, label = 'Table 9A SUPECO', amendment = false) {
  if (obj === undefined) return;
  assertObjectIfPresent(obj, label);
  assertNonEmptyObject(obj, label);

  const keys = amendment ? ['clttxa', 'paytxa'] : ['clttx', 'paytx'];
  assertOnlyKeys(obj, keys, label);

  const itemKeys = amendment
    ? ['oetin', 'etin', 'suppval', 'igst', 'cgst', 'sgst', 'cess', 'flag', 'omon']
    : ['etin', 'suppval', 'igst', 'cgst', 'sgst', 'cess', 'flag'];

  const arrays = amendment ? [obj.clttxa, obj.paytxa] : [obj.clttx, obj.paytx];
  const arrayNames = amendment ? ['clttxa', 'paytxa'] : ['clttx', 'paytx'];

  for (let a = 0; a < arrays.length; a++) {
    const list = arrays[a];
    const arrLabel = `${label}.${arrayNames[a]}`;

    if (!assertNonEmptyArrayIfPresent(list, arrLabel)) continue;

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const loc = `${arrLabel} item #${i + 1}`;

      if (!isPlainObject(item)) {
        fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
      }

      assertOnlyKeys(item, itemKeys, loc);
      assertNonEmptyObject(item, loc);

      if (amendment) {
        if (item.oetin === undefined || item.oetin === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'oetin' is mandatory.`);
        }
        assertSupecoEtin(item.oetin, loc, 'oetin');
      }

      if (item.etin === undefined || item.etin === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'etin' is mandatory.`);
      }
      assertSupecoEtin(item.etin, loc, 'etin');

      for (const f of ['suppval', 'igst', 'cgst', 'sgst']) {
        if (item[f] === undefined || item[f] === null) {
          fail(`GSTR-1 Schema Error (${loc}): '${f}' is mandatory.`);
        }
        assertNumber(item[f], f, loc, {
          min: NON_EMPTY_COST_AT_MIN,
          max: NON_EMPTY_COST_AT_MAX
        });
      }

      if (item.cess !== undefined && item.cess !== null) {
        assertNumber(item.cess, 'cess', loc, {
          min: NON_EMPTY_COST_AT_MIN,
          max: NON_EMPTY_COST_AT_MAX
        });
      }

      assertEcomFlag(item.flag, loc, { required: false, allowDeletion: true });

      if (amendment) {
        if (item.omon === undefined || item.omon === null) {
          fail(`GSTR-1 Schema Error (${loc}): 'omon' is mandatory.`);
        }
        assertOmon(item.omon, loc);
      }
    }
  }
}

function validateEcomB2BInvoice(inv, loc, opts = {}) {
  const { amendment = false, invTypAllowed = ALLOWED_INV_TYP_ECOM } = opts;

  if (!isPlainObject(inv)) {
    fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
  }

  const keys = amendment ? ECOM_B2BA_INVOICE_KEYS : ECOM_B2B_INVOICE_KEYS;
  assertOnlyKeys(inv, keys, loc);
  assertNonEmptyObject(inv, loc);

  assertInum(inv.inum, 'inum', loc);
  assertDate(inv.idt, 'idt', loc);
  assertEcomFlag(inv.flag, loc, { required: true, allowDeletion: true });

  const isDel = inv.flag === DELETION_FLAG;

  if (isDel) {
    assertDeletionFlag(inv.flag, loc);

    if (inv.val !== undefined && inv.val !== null) {
      assertNumber(inv.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });
    }
    if (inv.pos !== undefined && inv.pos !== null) assertPos(inv.pos, loc, true);
    if (inv.inv_typ !== undefined && inv.inv_typ !== null && !invTypAllowed.includes(inv.inv_typ)) {
      fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' must be one of ${invTypAllowed.join(', ')}. Received: ${inv.inv_typ}`);
    }
    if (inv.sply_ty !== undefined && inv.sply_ty !== null && !ALLOWED_SPly_TY.includes(inv.sply_ty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be 'INTER' or 'INTRA'. Received: ${inv.sply_ty}`);
    }

    if (amendment) {
      if (inv.oinum !== undefined && inv.oinum !== null) assertInum(inv.oinum, 'oinum', loc);
      if (inv.oidt !== undefined && inv.oidt !== null) assertDate(inv.oidt, 'oidt', loc);
    }

    if (inv.itms !== undefined) {
      validateEcomItems(inv.itms, loc, false, 1);
    }

    return;
  }

  // Regular e-commerce invoice variant
  assertEcomFlag(inv.flag, loc, { required: true, allowDeletion: false });

  if (inv.val === undefined || inv.val === null) {
    fail(`GSTR-1 Schema Error (${loc}): 'val' is mandatory.`);
  }
  assertNumber(inv.val, 'val', loc, { min: TOTAL_VALUE_MIN, max: TOTAL_VALUE_MAX });

  if (inv.pos === undefined || inv.pos === null) {
    fail(`GSTR-1 Schema Error (${loc}): 'pos' is mandatory.`);
  }
  assertPos(inv.pos, loc, true);

  if (inv.inv_typ === undefined || inv.inv_typ === null) {
    fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' is mandatory.`);
  }
  if (!invTypAllowed.includes(inv.inv_typ)) {
    fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' must be one of ${invTypAllowed.join(', ')}. Received: ${inv.inv_typ}`);
  }

  if (inv.sply_ty === undefined || inv.sply_ty === null) {
    fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' is mandatory.`);
  }
  if (!ALLOWED_SPly_TY.includes(inv.sply_ty)) {
    fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be 'INTER' or 'INTRA'. Received: ${inv.sply_ty}`);
  }

  if (amendment) {
    if (inv.oinum === undefined || inv.oinum === null) {
      fail(`GSTR-1 Schema Error (${loc}): 'oinum' is mandatory for amendment.`);
    }
    assertInum(inv.oinum, 'oinum', loc);

    if (inv.oidt === undefined || inv.oidt === null) {
      fail(`GSTR-1 Schema Error (${loc}): 'oidt' is mandatory for amendment.`);
    }
    assertDate(inv.oidt, 'oidt', loc);
  }

  validateEcomItems(inv.itms, loc, true, 1);
}

function validateEcomB2BParty(list, label, opts = {}) {
  const {
    amendment = false,
    partyKeys,
    partyRequiredKeys,
    invTypAllowed = ALLOWED_INV_TYP_ECOM
  } = opts;

  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  for (let i = 0; i < list.length; i++) {
    const party = list[i];
    const pLoc = `${label} party #${i + 1}`;

    if (!isPlainObject(party)) {
      fail(`GSTR-1 Schema Error (${pLoc}): must be an object.`);
    }

    assertOnlyKeys(party, partyKeys, pLoc);
    assertNonEmptyObject(party, pLoc);

    for (const key of partyRequiredKeys) {
      if (party[key] === undefined || party[key] === null) {
        fail(`GSTR-1 Schema Error (${pLoc}): '${key}' is mandatory.`);
      }
    }

    assertCtin(party.rtin, pLoc, 'rtin');
    if (party.stin !== undefined) assertCtin(party.stin, pLoc, 'stin');

    if (!Array.isArray(party.inv)) {
      fail(`GSTR-1 Schema Error (${pLoc}): 'inv' must be an array.`);
    }

    if (party.inv.length === 0) {
      fail(`GSTR-1 Schema Error (${pLoc}): 'inv' must contain at least one invoice.`);
    }

    for (let j = 0; j < party.inv.length; j++) {
      const inv = party.inv[j];
      validateEcomB2BInvoice(inv, `${pLoc} invoice #${j + 1}`, {
        amendment,
        invTypAllowed
      });
    }
  }
}

function validateEcomB2CParty(list, label, { requireStin = false } = {}) {
  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  const keys = requireStin ? ECOM_B2C_KEYS : ECOM_URP2C_KEYS;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const loc = `${label} row #${i + 1}`;

    if (!isPlainObject(item)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(item, keys, loc);
    assertNonEmptyObject(item, loc);

    if (requireStin) {
      if (item.stin === undefined || item.stin === null) {
        fail(`GSTR-1 Schema Error (${loc}): 'stin' is mandatory.`);
      }
      assertCtin(item.stin, loc, 'stin');
    }

    if (item.rt === undefined || item.rt === null) {
      fail(`GSTR-1 Schema Error (${loc}): 'rt' is mandatory.`);
    }
    assertRate(item.rt, 'rt', loc);

    assertEcomFlag(item.flag, loc, { required: true, allowDeletion: true });

    if (item.pos === undefined || item.pos === null) {
      fail(`GSTR-1 Schema Error (${loc}): 'pos' is mandatory.`);
    }
    assertPos(item.pos, loc, false);

    if (item.txval === undefined || item.txval === null) {
      fail(`GSTR-1 Schema Error (${loc}): 'txval' is mandatory.`);
    }
    assertNumber(item.txval, 'txval', loc, {
      min: NON_EMPTY_COST_AT_MIN,
      max: NON_EMPTY_COST_AT_MAX
    });

    if (!ALLOWED_SPly_TY.includes(item.sply_ty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be 'INTER' or 'INTRA'. Received: ${item.sply_ty}`);
    }

    for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
      if (item[f] !== undefined && item[f] !== null) {
        assertNumber(item[f], f, loc, {
          min: NON_EMPTY_COST_AT_MIN,
          max: NON_EMPTY_COST_AT_MAX
        });
      }
    }
  }
}

function validateEcom(obj, label = 'Table 9A ECOM') {
  if (obj === undefined) return;
  assertObjectIfPresent(obj, label);
  assertNonEmptyObject(obj, label);

  assertOnlyKeys(obj, ['b2b', 'b2c', 'urp2b', 'urp2c'], label);

  validateEcomB2BParty(obj.b2b, `${label}.b2b`, {
    amendment: false,
    partyKeys: ['inv', 'rtin', 'stin'],
    partyRequiredKeys: ['inv', 'rtin', 'stin'],
    invTypAllowed: ALLOWED_INV_TYP_ECOM
  });

  validateEcomB2CParty(obj.b2c, `${label}.b2c`, { requireStin: true });

  validateEcomB2BParty(obj.urp2b, `${label}.urp2b`, {
    amendment: false,
    partyKeys: ['inv', 'rtin'],
    partyRequiredKeys: ['inv', 'rtin'],
    invTypAllowed: ALLOWED_INV_TYP_URP2B
  });

  validateEcomB2CParty(obj.urp2c, `${label}.urp2c`, { requireStin: false });
}

function validateEcomB2CAItem(item, loc) {
  if (!isPlainObject(item)) {
    fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
  }

  assertOnlyKeys(item, ECOM_B2CA_POSITM_KEYS, loc);
  assertNonEmptyObject(item, loc);

  for (const key of ['stin', 'ostin', 'flag', 'sply_ty', 'omon', 'itms']) {
    if (item[key] === undefined || item[key] === null) {
      fail(`GSTR-1 Schema Error (${loc}): '${key}' is mandatory.`);
    }
  }

  assertCtin(item.stin, loc, 'stin');
  assertCtin(item.ostin, loc, 'ostin');
  assertEcomFlag(item.flag, loc, { required: true, allowDeletion: true });

  if (!ALLOWED_SPly_TY.includes(item.sply_ty)) {
    fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be 'INTER' or 'INTRA'. Received: ${item.sply_ty}`);
  }

  assertOmon(item.omon, loc);
  validateEcomB2CItems(item.itms, loc, true);
}

function validateEcomB2CA(list, label) {
  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  for (let i = 0; i < list.length; i++) {
    const group = list[i];
    const gLoc = `${label} group #${i + 1}`;

    if (!isPlainObject(group)) {
      fail(`GSTR-1 Schema Error (${gLoc}): must be an object.`);
    }

    assertOnlyKeys(group, ['pos', 'posItms'], gLoc);
    assertNonEmptyObject(group, gLoc);

    if (group.pos === undefined || group.pos === null) {
      fail(`GSTR-1 Schema Error (${gLoc}): 'pos' is mandatory.`);
    }
    assertPos(group.pos, gLoc, false);

    if (!Array.isArray(group.posItms)) {
      fail(`GSTR-1 Schema Error (${gLoc}): 'posItms' must be an array.`);
    }

    if (group.posItms.length === 0) {
      fail(`GSTR-1 Schema Error (${gLoc}): 'posItms' must contain at least one item.`);
    }

    for (let j = 0; j < group.posItms.length; j++) {
      validateEcomB2CAItem(group.posItms[j], `${gLoc} posItm #${j + 1}`);
    }
  }
}

function validateEcomUrp2CA(list, label) {
  if (!assertNonEmptyArrayIfPresent(list, label)) return;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const loc = `${label} row #${i + 1}`;

    if (!isPlainObject(item)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(item, ECOM_URP2CA_KEYS, loc);
    assertNonEmptyObject(item, loc);

    for (const key of ['flag', 'pos', 'sply_ty', 'omon', 'itms']) {
      if (item[key] === undefined || item[key] === null) {
        fail(`GSTR-1 Schema Error (${loc}): '${key}' is mandatory.`);
      }
    }

    assertEcomFlag(item.flag, loc, { required: true, allowDeletion: true });
    assertPos(item.pos, loc, false);

    if (!ALLOWED_SPly_TY.includes(item.sply_ty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be 'INTER' or 'INTRA'. Received: ${item.sply_ty}`);
    }

    assertOmon(item.omon, loc);
    validateEcomB2CItems(item.itms, loc, true);
  }
}

function validateEcoma(obj, label = 'Table 9A ECOMA') {
  if (obj === undefined) return;
  assertObjectIfPresent(obj, label);
  assertNonEmptyObject(obj, label);

  assertOnlyKeys(obj, ['b2ba', 'b2ca', 'urp2ba', 'urp2ca'], label);

  validateEcomB2BParty(obj.b2ba, `${label}.b2ba`, {
    amendment: true,
    partyKeys: ['inv', 'rtin', 'stin'],
    partyRequiredKeys: ['inv', 'rtin', 'stin'],
    invTypAllowed: ALLOWED_INV_TYP_ECOM
  });

  validateEcomB2CA(obj.b2ca, `${label}.b2ca`);

  validateEcomB2BParty(obj.urp2ba, `${label}.urp2ba`, {
    amendment: true,
    partyKeys: ['inv', 'rtin'],
    partyRequiredKeys: ['inv', 'rtin'],
    invTypAllowed: ALLOWED_INV_TYP_URP2B
  });

  validateEcomUrp2CA(obj.urp2ca, `${label}.urp2ca`);
}

function validateNil(nil) {
  if (nil === undefined) return;
  assertObjectIfPresent(nil, 'Table 8 Nil');
  assertNonEmptyObject(nil, 'Table 8 Nil');

  assertOnlyKeys(nil, ['flag', 'inv'], 'Table 8 Nil');

  let isDeletion = false;
  if (nil.flag !== undefined && nil.flag !== null) {
    if (nil.flag === DELETION_FLAG) {
      isDeletion = true;
    } else {
      assertStandardFlag(nil.flag, 'Table 8 Nil');
    }
  }

  if (nil.inv === undefined) {
    if (!isDeletion) {
      fail("GSTR-1 Schema Error (Table 8 Nil): regular nil section must contain 'inv'.");
    }
    return;
  }

  if (!assertNonEmptyArrayIfPresent(nil.inv, 'Table 8 Nil.inv')) return;

  for (let i = 0; i < nil.inv.length; i++) {
    const row = nil.inv[i];
    const loc = `Table 8 Nil row #${i + 1}`;

    if (!isPlainObject(row)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(row, ['sply_ty', 'nil_amt', 'expt_amt', 'ngsup_amt'], loc);
    assertNonEmptyObject(row, loc);

    if (isDeletion) {
      if (row.sply_ty !== undefined && row.sply_ty !== null) {
        if (!ALLOWED_NIL_SPLY.includes(row.sply_ty)) {
          fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be one of ${ALLOWED_NIL_SPLY.join(', ')}. Received: ${row.sply_ty}`);
        }
      }

      for (const f of ['nil_amt', 'expt_amt', 'ngsup_amt']) {
        if (row[f] !== undefined && row[f] !== null) {
          assertNumber(row[f], f, loc, {
            min: NON_EMPTY_NIL_MIN,
            max: NON_EMPTY_NIL_MAX
          });
        }
      }

      continue;
    }

    if (!ALLOWED_NIL_SPLY.includes(row.sply_ty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be one of ${ALLOWED_NIL_SPLY.join(', ')}. Received: ${row.sply_ty}`);
    }

    for (const f of ['nil_amt', 'expt_amt', 'ngsup_amt']) {
      if (row[f] === undefined || row[f] === null) {
        fail(`GSTR-1 Schema Error (${loc}): '${f}' is mandatory.`);
      }
      assertNumber(row[f], f, loc, {
        min: NON_EMPTY_NIL_MIN,
        max: NON_EMPTY_NIL_MAX
      });
    }
  }
}

function validateHsnRegularRow(h, loc) {
  assertOnlyKeys(h, HSN_ROW_KEYS, loc);
  assertNonEmptyObject(h, loc);

  if (h.num === undefined || h.num === null) {
    fail(`GSTR-1 Schema Error (${loc}): 'num' is mandatory.`);
  }
  assertNumber(h.num, 'num', loc, { integer: true, min: 1 });

  if (h.uqc === undefined || h.uqc === null) {
    fail(`GSTR-1 Schema Error (${loc}): 'uqc' is mandatory.`);
  }
  assertString(h.uqc, 'uqc', loc, { required: true, allowEmpty: false, maxLen: 30 });
  if (!UQC_RE.test(String(h.uqc))) {
    fail(`GSTR-1 Schema Error (${loc}): 'uqc' must contain only alphabetic characters (A-Z/a-z). Received: "${h.uqc}"`);
  }
  if (UQC_ENUM.length && !UQC_ENUM.includes(h.uqc)) {
    fail(`GSTR-1 Schema Error (${loc}): 'uqc' must be one of [${UQC_ENUM.join(', ')}]. Received: ${h.uqc}`);
  }

  if (h.qty === undefined || h.qty === null) {
    fail(`GSTR-1 Schema Error (${loc}): 'qty' is mandatory.`);
  }
  assertNumber(h.qty, 'qty', loc, {
    min: HSN_QTY_MIN,
    max: HSN_QTY_MAX
  });

  if (h.txval === undefined || h.txval === null) {
    fail(`GSTR-1 Schema Error (${loc}): 'txval' is mandatory.`);
  }
  assertNumber(h.txval, 'txval', loc, {
    min: HSN_AMT_MIN,
    max: HSN_AMT_MAX
  });

  for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
    if (h[f] !== undefined && h[f] !== null) {
      assertNumber(h[f], f, loc, {
        min: HSN_AMT_MIN,
        max: HSN_AMT_MAX
      });
    }
  }

  assertStandardFlag(h.flag, loc);

  const code = h.hsn_sc;
  const codeStr = typeof code === 'string' ? code : '';
  const hasCode = code !== undefined && code !== null && codeStr !== '';
  const validHsnCode = HSN_RE.test(codeStr);

  const hasRt = h.rt !== undefined && h.rt !== null;
  const hasVal = h.val !== undefined && h.val !== null;
  const hasDesc = h.desc !== undefined && h.desc !== null;
  const descNonEmpty = hasDesc && String(h.desc).trim() !== '';

  // Variant 1: Rate-wise HSN
  if (validHsnCode && hasRt) {
    assertRate(h.rt, 'rt', loc);

    if (hasVal) {
      assertNumber(h.val, 'val', loc, { min: 0, max: 0 });
    }

    if (hasDesc) {
      assertString(h.desc, 'desc', loc, {
        required: false,
        allowEmpty: false,
        maxLen: null
      });
    }

    return;
  }

  // Variant 2: Value-wise HSN
  if (validHsnCode && !hasRt && hasVal) {
    assertNumber(h.val, 'val', loc, {
      min: HSN_ALLOW_NEGATIVE ? -HSN_AMT_MAX : 0,
      max: HSN_AMT_MAX
    });

    if (hasDesc) {
      assertString(h.desc, 'desc', loc, {
        required: false,
        allowEmpty: false,
        maxLen: HSN_DESC_MAX
      });
    }

    return;
  }

  // Variant 3: No-HSN / description-wise. hsn_sc may be empty or valid HSN.
  if ((codeStr === '' || validHsnCode) && !hasRt && hasVal && descNonEmpty) {
    assertString(h.desc, 'desc', loc, {
      required: true,
      allowEmpty: false,
      maxLen: HSN_DESC_MAX,
      minLength: 1
    });

    assertNumber(h.val, 'val', loc, {
      min: HSN_ALLOW_NEGATIVE ? -HSN_AMT_MAX : 0,
      max: HSN_AMT_MAX
    });

    return;
  }

  fail(
    `GSTR-1 Schema Error (${loc}): HSN row must match one GSTN variant: ` +
    `rate-wise (hsn_sc 2-8 digits + rt, val absent or 0), ` +
    `value-wise (hsn_sc 2-8 digits + val, no rt), or ` +
    `no-HSN/description-wise (empty/valid hsn_sc + desc + val, no rt).`
  );
}

function validateHsn(hsn) {
  if (hsn === undefined) return;
  assertObjectIfPresent(hsn, 'Table 12 HSN');
  assertNonEmptyObject(hsn, 'Table 12 HSN');

  assertOnlyKeys(hsn, ['flag', 'data', 'hsn_b2b', 'hsn_b2c'], 'Table 12 HSN');

  let isDeletion = false;
  if (hsn.flag !== undefined && hsn.flag !== null) {
    if (hsn.flag === DELETION_FLAG) {
      isDeletion = true;
    } else {
      assertStandardFlag(hsn.flag, 'Table 12 HSN');
    }
  }

  const arraysToCheck = [
    { key: 'data', list: hsn.data },
    { key: 'hsn_b2b', list: hsn.hsn_b2b },
    { key: 'hsn_b2c', list: hsn.hsn_b2c }
  ].filter((entry) => entry.list !== undefined);

  if (arraysToCheck.length === 0) {
    if (!isDeletion) {
      fail("GSTR-1 Schema Error (Table 12 HSN): regular HSN must contain 'hsn_b2b', 'hsn_b2c', or 'data'.");
    }
    return;
  }

  for (const { key, list } of arraysToCheck) {
    if (!assertNonEmptyArrayIfPresent(list, `Table 12 HSN.${key}`)) continue;

    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      const loc = `Table 12 HSN.${key} row #${i + 1}`;

      if (!isPlainObject(h)) {
        fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
      }

      assertOnlyKeys(h, HSN_ROW_KEYS, loc);
      assertNonEmptyObject(h, loc);

      if (isDeletion) {
        assertDeletionFlag(h.flag, loc);

        if (h.num !== undefined && h.num !== null) {
          assertNumber(h.num, 'num', loc, { integer: true, min: 1 });
        }

        if (h.hsn_sc !== undefined && h.hsn_sc !== null && h.hsn_sc !== '') {
          if (!HSN_RE.test(String(h.hsn_sc))) {
            fail(`GSTR-1 Schema Error (${loc}): 'hsn_sc' must be 2-8 digits or empty. Received: "${h.hsn_sc}"`);
          }
        }

        if (h.uqc !== undefined && h.uqc !== null) {
          assertString(h.uqc, 'uqc', loc, { required: false, allowEmpty: false, maxLen: 30 });
          if (!UQC_RE.test(String(h.uqc))) {
            fail(`GSTR-1 Schema Error (${loc}): 'uqc' must contain only alphabetic characters. Received: "${h.uqc}"`);
          }
        }

        if (h.qty !== undefined && h.qty !== null) {
          assertNumber(h.qty, 'qty', loc, { min: HSN_QTY_MIN, max: HSN_QTY_MAX });
        }

        if (h.txval !== undefined && h.txval !== null) {
          assertNumber(h.txval, 'txval', loc, { min: HSN_AMT_MIN, max: HSN_AMT_MAX });
        }

        if (h.val !== undefined && h.val !== null) {
          assertNumber(h.val, 'val', loc, {
            min: HSN_ALLOW_NEGATIVE ? -HSN_AMT_MAX : 0,
            max: HSN_AMT_MAX
          });
        }

        if (h.rt !== undefined && h.rt !== null) {
          assertRate(h.rt, 'rt', loc);
        }

        for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
          if (h[f] !== undefined && h[f] !== null) {
            assertNumber(h[f], f, loc, { min: HSN_AMT_MIN, max: HSN_AMT_MAX });
          }
        }

        if (h.desc !== undefined && h.desc !== null) {
          assertString(h.desc, 'desc', loc, {
            required: false,
            allowEmpty: false,
            maxLen: null
          });
        }

        continue;
      }

      validateHsnRegularRow(h, loc);
    }
  }
}

function validateDocIssue(docIssue) {
  if (docIssue === undefined) return;
  assertObjectIfPresent(docIssue, 'Table 13 DOCISS');
  assertNonEmptyObject(docIssue, 'Table 13 DOCISS');

  assertOnlyKeys(docIssue, ['flag', 'doc_det'], 'Table 13 DOCISS');

  let isDeletion = false;
  if (docIssue.flag !== undefined && docIssue.flag !== null) {
    if (docIssue.flag === DELETION_FLAG) {
      isDeletion = true;
    } else {
      assertStandardFlag(docIssue.flag, 'Table 13 DOCISS');
    }
  }

  if (docIssue.doc_det === undefined) {
    if (!isDeletion) {
      fail("GSTR-1 Schema Error (Table 13 DOCISS): regular doc_issue must contain 'doc_det'.");
    }
    return;
  }

  if (!assertNonEmptyArrayIfPresent(docIssue.doc_det, 'Table 13 DOCISS.doc_det')) return;

  for (let i = 0; i < docIssue.doc_det.length; i++) {
    const detail = docIssue.doc_det[i];
    const dLoc = `Table 13 detail #${i + 1}`;

    if (!isPlainObject(detail)) {
      fail(`GSTR-1 Schema Error (${dLoc}): must be an object.`);
    }

    assertOnlyKeys(detail, ['doc_num', 'doc_typ', 'docs'], dLoc);
    assertNonEmptyObject(detail, dLoc);

    if (isDeletion) {
      if (detail.doc_num !== undefined && detail.doc_num !== null) {
        assertNumber(detail.doc_num, 'doc_num', dLoc, { integer: true, min: 1, max: DOC_NUM_MAX });
      }

      if (detail.doc_typ !== undefined && detail.doc_typ !== null) {
        assertString(detail.doc_typ, 'doc_typ', dLoc, {
          required: false,
          allowEmpty: false,
          maxLen: null
        });
      }

      if (detail.docs !== undefined) {
        if (!assertNonEmptyArrayIfPresent(detail.docs, `${dLoc}.docs`)) continue;

        for (let j = 0; j < detail.docs.length; j++) {
          const doc = detail.docs[j];
          const loc = `${dLoc} document #${j + 1}`;

          if (!isPlainObject(doc)) {
            fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
          }

          assertOnlyKeys(doc, ['cancel', 'from', 'net_issue', 'num', 'to', 'totnum'], loc);
          assertNonEmptyObject(doc, loc);

          if (doc.num !== undefined && doc.num !== null) {
            assertNumber(doc.num, 'num', loc, { integer: true, min: 1 });
          }
          if (doc.totnum !== undefined && doc.totnum !== null) {
            assertNumber(doc.totnum, 'totnum', loc, { integer: true, min: 0, max: DOC_COUNT_MAX });
          }
          if (doc.cancel !== undefined && doc.cancel !== null) {
            assertNumber(doc.cancel, 'cancel', loc, { integer: true, min: 0, max: DOC_COUNT_MAX });
          }
          if (doc.net_issue !== undefined && doc.net_issue !== null) {
            assertNumber(doc.net_issue, 'net_issue', loc, { integer: true, min: 0, max: DOC_COUNT_MAX });
          }
          if (doc.from !== undefined && doc.from !== null) assertInum(doc.from, 'from', loc);
          if (doc.to !== undefined && doc.to !== null) assertInum(doc.to, 'to', loc);

          if (
            doc.totnum !== undefined &&
            doc.cancel !== undefined &&
            doc.net_issue !== undefined &&
            doc.totnum - doc.cancel !== doc.net_issue
          ) {
            fail(
              `GSTR-1 Schema Error (${loc}): document arithmetic invalid — totnum(${doc.totnum}) − cancel(${doc.cancel}) ` +
              `must equal net_issue(${doc.net_issue}).`
            );
          }
        }
      }

      continue;
    }

    if (detail.doc_num === undefined || detail.doc_num === null) {
      fail(`GSTR-1 Schema Error (${dLoc}): 'doc_num' is mandatory.`);
    }
    assertNumber(detail.doc_num, 'doc_num', dLoc, { integer: true, min: 1, max: DOC_NUM_MAX });

    if (detail.doc_typ !== undefined && detail.doc_typ !== null) {
      assertString(detail.doc_typ, 'doc_typ', dLoc, {
        required: false,
        allowEmpty: false,
        maxLen: null
      });
      if (DOC_TYP_ENUM.length && !DOC_TYP_ENUM.includes(detail.doc_typ)) {
        fail(`GSTR-1 Schema Error (${dLoc}): 'doc_typ' must be one of [${DOC_TYP_ENUM.join(', ')}]. Received: "${detail.doc_typ}"`);
      }
    }

    if (detail.docs === undefined || detail.docs === null) {
      fail(`GSTR-1 Schema Error (${dLoc}): 'docs' is mandatory.`);
    }
    if (!assertNonEmptyArrayIfPresent(detail.docs, `${dLoc}.docs`)) continue;

    for (let j = 0; j < detail.docs.length; j++) {
      const doc = detail.docs[j];
      const loc = `${dLoc} document #${j + 1}`;

      if (!isPlainObject(doc)) {
        fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
      }

      assertOnlyKeys(doc, ['cancel', 'from', 'net_issue', 'num', 'to', 'totnum'], loc);
      assertNonEmptyObject(doc, loc);

      for (const key of ['num', 'to', 'totnum', 'from', 'net_issue', 'cancel']) {
        if (doc[key] === undefined || doc[key] === null) {
          fail(`GSTR-1 Schema Error (${loc}): '${key}' is mandatory.`);
        }
      }

      assertNumber(doc.num, 'num', loc, { integer: true, min: 1 });
      assertNumber(doc.totnum, 'totnum', loc, { integer: true, min: 0, max: DOC_COUNT_MAX });
      assertNumber(doc.cancel, 'cancel', loc, { integer: true, min: 0, max: DOC_COUNT_MAX });
      assertNumber(doc.net_issue, 'net_issue', loc, { integer: true, min: 0, max: DOC_COUNT_MAX });

      assertInum(doc.from, 'from', loc);
      assertInum(doc.to, 'to', loc);

      if (doc.totnum - doc.cancel !== doc.net_issue) {
        fail(
          `GSTR-1 Schema Error (${loc}): document arithmetic invalid — totnum(${doc.totnum}) − cancel(${doc.cancel}) ` +
          `must equal net_issue(${doc.net_issue}).`
        );
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Normalizer — legacy / third-party JSON pre-processor                       */
/* -------------------------------------------------------------------------- */

function stripIllegalChksum(node, { pruneEmpty = true } = {}) {
  if (Array.isArray(node)) {
    const out = [];

    for (const item of node) {
      const cleaned = stripIllegalChksum(item, { pruneEmpty });
      if (cleaned !== undefined) out.push(cleaned);
    }

    if (pruneEmpty && out.length === 0) return undefined;
    return out;
  }

  if (isPlainObject(node)) {
    const out = {};

    for (const [key, value] of Object.entries(node)) {
      if (key === 'chksum') continue;
      if (UNSAFE_KEYS.has(key)) continue;

      const cleaned = stripIllegalChksum(value, { pruneEmpty });
      if (cleaned !== undefined) out[key] = cleaned;
    }

    if (pruneEmpty && Object.keys(out).length === 0) return undefined;
    return out;
  }

  return node;
}

function flattenCdnurLike(list) {
  if (!Array.isArray(list)) return list;

  const out = [];

  for (const item of list) {
    if (isPlainObject(item) && Array.isArray(item.nt)) {
      for (const nt of item.nt) {
        out.push({
          ...nt,
          typ: nt.typ || item.typ,
          pos: nt.pos || item.pos
        });
      }
    } else {
      out.push(item);
    }
  }

  return out;
}

/**
 * Normalizes legacy or third-party GSTR-1 JSON into official GSTN schema shape:
 * - Recursively removes illegal 'chksum' properties from save payload
 * - Removes null/undefined values
 * - Removes empty strings
 * - Removes empty arrays/objects by default
 * - Normalizes doc_issue 'canc' → 'cancel'
 * - Normalizes hsn_b2b / hsn_b2c → 'data' array and deletes legacy keys
 * - Normalizes user_desc → desc and deletes user_desc
 * - Flattens grouped cdnur / cdnura into flat note arrays
 * - Normalizes flag strings to uppercase
 * - Trims strings and object keys
 * - Drops prototype-pollution keys
 */
function normalizeGstr1Payload(payload, {
  trimStrings = true,
  removeEmptyCollections = true
} = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;

  const walk = (node) => {
    if (node === undefined || node === null) return undefined;

    if (typeof node === 'string') {
      const s = trimStrings ? node.trim() : node;
      return s === '' ? undefined : s;
    }

    if (Array.isArray(node)) {
      const arr = [];

      for (const item of node) {
        const v = walk(item);
        if (v !== undefined) arr.push(v);
      }

      if (removeEmptyCollections && arr.length === 0) return undefined;
      return arr;
    }

    if (isPlainObject(node)) {
      const out = {};

      for (const [rawKey, rawVal] of Object.entries(node)) {
        const key = trimStrings ? String(rawKey).trim() : rawKey;

        if (UNSAFE_KEYS.has(key) || key === '') continue;

        const value = walk(rawVal);
        if (value === undefined) continue;

        if (key === 'flag' && typeof value === 'string') {
          out[key] = value.trim().toUpperCase();
        } else {
          out[key] = value;
        }
      }

      if (removeEmptyCollections && Object.keys(out).length === 0) return undefined;
      return out;
    }

    return node;
  };

  let p = stripIllegalChksum(walk(payload), { pruneEmpty: removeEmptyCollections });

  if (!isPlainObject(p)) p = {};

  // Flatten grouped CDNUR / CDNURA if present.
  if (Array.isArray(p.cdnur)) {
    p.cdnur = flattenCdnurLike(p.cdnur);
  }
  if (Array.isArray(p.cdnura)) {
    p.cdnura = flattenCdnurLike(p.cdnura);
  }

  // canc → cancel
  const detList = p.doc_issue?.doc_det;
  if (Array.isArray(detList)) {
    for (const det of detList) {
      if (!Array.isArray(det?.docs)) continue;
      for (const doc of det.docs) {
        if (!isPlainObject(doc)) continue;
        if (doc.canc !== undefined) {
          if (doc.cancel === undefined) doc.cancel = doc.canc;
          delete doc.canc;
        }
      }
    }
  }

  // Preserve post-May-2025 bifurcated hsn_b2b / hsn_b2c arrays (and pre-May-2025 hsn.data)
  if (isPlainObject(p.hsn)) {
    for (const hsnKey of ['hsn_b2b', 'hsn_b2c', 'data']) {
      if (Array.isArray(p.hsn[hsnKey])) {
        p.hsn[hsnKey] = p.hsn[hsnKey].map((row, idx) => {
          const r = isPlainObject(row) ? { ...row } : row;
          if (isPlainObject(r)) {
            r.num = idx + 1;
            if (r.user_desc !== undefined && !r.desc) {
              r.desc = r.user_desc;
            }
            delete r.user_desc;
          }
          return r;
        });
      }
    }
  }

  // Final prune after structural normalization.
  p = stripIllegalChksum(p, { pruneEmpty: removeEmptyCollections });

  return isPlainObject(p) ? p : {};
}

/* -------------------------------------------------------------------------- */
/* Main Entry                                                                 */
/* -------------------------------------------------------------------------- */

function validateGstr1Schema(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Invalid GSTR-1 payload: must be a valid JSON object.');
  }

  assertOnlyKeys(payload, [
    'gstin', 'fp', 'gt', 'cur_gt', 'hash', 'version',
    'b2b', 'b2ba', 'b2cl', 'b2cla', 'b2cs', 'b2csa',
    'cdnr', 'cdnra', 'cdnur', 'cdnura',
    'nil', 'exp', 'expa',
    'at', 'ata', 'txpd', 'txpda',
    'supeco', 'supecoa', 'ecom', 'ecoma',
    'hsn', 'doc_issue'
  ], 'root');

  assertNonEmptyObject(payload, 'root');

  if (!payload.gstin || !isValidGstin(payload.gstin)) {
    fail(`Invalid GSTR-1 payload: 'gstin' must be a valid 15-character GSTIN. Received: ${payload.gstin}`);
  }

  if (typeof payload.fp !== 'string' || !FP_RE.test(payload.fp)) {
    fail(`Invalid GSTR-1 payload: 'fp' must be MMYYYY (e.g. "102026"). Received: ${payload.fp}`);
  }

  // gt and cur_gt: optional in root schema (required is only ['gstin', 'fp'])
  assertOptionalNumber(payload.gt, 'gt', 'root', {
    min: GT_MIN,
    max: GT_MAX,
    multipleOf01: true
  });

  assertOptionalNumber(payload.cur_gt, 'cur_gt', 'root', {
    min: GT_MIN,
    max: GT_MAX,
    multipleOf01: true
  });

  if (payload.version !== undefined) {
    assertString(payload.version, 'version', 'root', {
      required: false,
      allowEmpty: false,
      maxLen: null
    });
  }

  if (payload.hash !== undefined) {
    assertString(payload.hash, 'hash', 'root', {
      required: false,
      allowEmpty: false,
      maxLen: null
    });
  }

  validateB2B(payload.b2b, 'Table 4 B2B', false);
  validateB2B(payload.b2ba, 'Table 4B B2BA', true);

  validateB2CL(payload.b2cl, 'Table 5 B2CL', false);
  validateB2CL(payload.b2cla, 'Table 5B B2CLA', true);

  validateB2CS(payload.b2cs, 'Table 7 B2CS');
  validateB2CSA(payload.b2csa, 'Table 7B B2CSA');

  validateNil(payload.nil);

  validateCdnr(payload.cdnr, 'Table 9B CDNR', false);
  validateCdnr(payload.cdnra, 'Table 9BB CDNRA', true);

  validateCdnur(payload.cdnur, 'Table 9C CDNUR', false);
  validateCdnur(payload.cdnura, 'Table 9CC CDNURA', true);

  validateExp(payload.exp, 'Table 6A EXP', false);
  validateExp(payload.expa, 'Table 6AA EXPA', true);

  validateAdvanceSection(payload.at, 'Table 5A AT', {
    amendment: false,
    deletionRequiresPos: false,
    amountMin: NON_EMPTY_COST_AT_MIN,
    rateMax: RATE_MAX
  });

  validateAdvanceSection(payload.ata, 'Table 5AA ATA', {
    amendment: true,
    deletionRequiresPos: true,
    amountMin: NON_EMPTY_COST_AT_MIN,
    rateMax: RATE_MAX_NON_EMPTY_RATE
  });

  validateAdvanceSection(payload.txpd, 'Table 6 TXPD', {
    amendment: false,
    deletionRequiresPos: false,
    amountMin: NON_EMPTY_COST_MIN,
    rateMax: RATE_MAX
  });

  validateAdvanceSection(payload.txpda, 'Table 6A TXPDA', {
    amendment: true,
    deletionRequiresPos: true,
    amountMin: NON_EMPTY_COST_MIN,
    rateMax: RATE_MAX_NON_EMPTY_RATE
  });

  validateSupeco(payload.supeco, 'Table 9A SUPECO', false);
  validateSupeco(payload.supecoa, 'Table 9AA SUPECOMA', true);

  validateEcom(payload.ecom, 'Table 9A ECOM');
  validateEcoma(payload.ecoma, 'Table 9AA ECOMA');

  validateHsn(payload.hsn);
  validateDocIssue(payload.doc_issue);

  return true;
}

/**
 * Convenience helper: normalize then validate.
 * Preferred entry point for controllers/services.
 */
function normalizeAndValidateGstr1Payload(payload, options = {}) {
  const normalized = normalizeGstr1Payload(payload, options);
  validateGstr1Schema(normalized);
  return normalized;
}

// Deprecated: kept for backward compatibility with existing imports.
class Gstr1ValidationError extends Error {
  constructor(message, path) {
    super(message);
    this.name = 'Gstr1ValidationError';
    this.path = path;
  }
}

module.exports = {
  validateGstr1Schema,
  normalizeGstr1Payload,
  normalizeAndValidateGstr1Payload,
  Gstr1ValidationError
};