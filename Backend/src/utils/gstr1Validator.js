/**
 * GSTR-1 Payload Validator
 * Validates the generated GSTR-1 payload against GSTN schema rules
 * to prevent RET11400 / RET11403 / RET13507 errors before uploading to TaxPro/GSTN.
 *
 * DESIGN RULE: Validator is strictly faithful to the official GSTN RETSAVE request schema
 * (schemas/gstr1.schema.json). Legacy/third-party JSON must be pre-processed with
 * normalizeGstr1Payload() before passing to validateGstr1Schema().
 */

const ApiError = require('./apiError');
const { isValidGstin } = require('./gstin');

/* -------------------------------------------------------------------------- */
/* Config — env-overridable (tightening only, never loosening)                 */
/* -------------------------------------------------------------------------- */

const parseEnum = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const DOC_TYP_ENUM = parseEnum(process.env.GSTN_DOC_TYP_ENUM);
const UQC_ENUM = parseEnum(process.env.GSTN_UQC_ENUM);

// HSN net-of-credit-note negatives (CGST Rule allows net outward adjustments in Table 12)
const HSN_ALLOW_NEGATIVE = String(process.env.GSTN_HSN_ALLOW_NEGATIVE || 'true').toLowerCase() === 'true';

// doc_num hard limit per schema definitions.doc_num is 1..12
const SCHEMA_DOC_NUM_MAX = 12;
const ENV_DOC_NUM_MAX = Number(process.env.GSTN_DOC_NUM_MAX || SCHEMA_DOC_NUM_MAX);
const DOC_NUM_MAX = ENV_DOC_NUM_MAX > 0 ? Math.min(SCHEMA_DOC_NUM_MAX, ENV_DOC_NUM_MAX) : SCHEMA_DOC_NUM_MAX;

// GSTR-1 HSN desc documented limit is 30 characters
const HSN_DESC_MAX = Number(process.env.GSTN_HSN_DESC_MAX || 30);

/* -------------------------------------------------------------------------- */
/* Patterns & Constants                                                       */
/* -------------------------------------------------------------------------- */

// GSTN official pattern for inum: 1-16 chars, allowed [a-zA-Z0-9/-], MUST have at least one [a-zA-Z1-9]
const INUM_RE = /^(?=.{1,16}$)([0\/-]*[a-zA-Z0-9\/-]*[a-zA-Z1-9]+[a-zA-Z0-9\/-]*)$/;
const POS_RE = /^[0-9]{2}$/;
const FP_RE = /^(0[1-9]|1[012])((19|20)\d\d)$/;
const HSN_RE = /^[0-9]{2,8}$/;
const UQC_RE = /^[A-Za-z]+$/;
const SBNUM_RE = /^[0-9]{3,7}$/;
const SPCODE_RE = /^[A-Za-z0-9]{1,6}$/;
const ETIN_RE = /^[0-9]{2}[a-zA-Z]{5}[0-9]{4}[a-zA-Z]{1}[1-9A-Za-z]{1}C[0-9a-zA-Z]{1}$/;

// Domestic states: 01-38, 97 (definitions/state_cd)
const DOMESTIC_POS = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '97'
]);

// Foreign/Export states: 01-38, 96, 97 (definitions/state_cd_foreign)
const FOREIGN_POS = new Set([...DOMESTIC_POS, '96']);

const ALLOWED_INV_TYP = ['R', 'DE', 'SEWP', 'SEWOP', 'CBW'];
const ALLOWED_NIL_SPLY = ['INTRB2B', 'INTRB2C', 'INTRAB2B', 'INTRAB2C'];
const ALLOWED_CDNUR_TYP = ['B2CL', 'EXPWP', 'EXPWOP'];
const ALLOWED_NTTY = ['C', 'D', 'R'];
const VALID_FLAGS = new Set(['N', 'M', 'U', 'E', 'D']);

// Allowed itm_det keys per section
const B2B_DET_KEYS = ['rt', 'txval', 'iamt', 'camt', 'samt', 'csamt'];
const B2CL_DET_KEYS = ['rt', 'txval', 'iamt', 'csamt']; // strictly NO camt, samt
const CDNR_DET_KEYS = ['rt', 'txval', 'iamt', 'camt', 'samt', 'csamt'];
const CDNUR_DET_KEYS = ['rt', 'txval', 'iamt', 'camt', 'samt', 'csamt'];

// Allowed keys for save request objects (strictly NO chksum — additionalProperties: false in schema)
const B2B_INV_KEYS = [
  'etin', 'flag', 'inum', 'idt', 'val', 'pos', 'rchrg', 'inv_typ',
  'irngendate', 'irn', 'srctyp', 'itms'
];

const B2CL_REG_KEYS = ['etin', 'flag', 'inum', 'idt', 'val', 'itms'];
const B2CL_DEL_KEYS = ['etin', 'flag', 'inum', 'idt', 'val', 'pos', 'itms'];

const EXP_INV_KEYS = [
  'flag', 'inum', 'idt', 'val', 'sbnum', 'sbdt', 'sbpcode',
  'irngendate', 'irn', 'srctyp', 'itms'
];

const EXP_ITEM_KEYS = ['rt', 'txval', 'iamt', 'csamt'];

const CDNR_NOTE_KEYS = [
  'etin', 'flag', 'val', 'ntty', 'nt_num', 'nt_dt', 'pos', 'rchrg', 'inv_typ',
  'irngendate', 'irn', 'srctyp', 'itms'
];

const CDNUR_NOTE_KEYS = [
  'typ', 'flag', 'pos', 'val', 'ntty', 'nt_num', 'nt_dt',
  'irngendate', 'irn', 'srctyp', 'itms'
];

const HSN_ROW_KEYS = [
  'num', 'hsn_sc', 'val', 'txval', 'iamt', 'camt', 'samt', 'csamt',
  'desc', 'uqc', 'qty', 'flag', 'rt'
];

// All 4 official GSTN schema recipient identification patterns (definitions/ctin)
const CTIN_PATTERNS = [
  /^[0-9]{2}[a-zA-Z]{5}[0-9]{4}[a-zA-Z]{1}[1-9A-Za-z]{1}[Zz1-9A-Ja-j]{1}[0-9a-zA-Z]{1}$/, // GSTIN
  /^[0-9]{4}[A-Z]{3}[0-9]{5}[UO]{1}N[A-Z0-9]{1}$/,                                          // UN body
  /^[0-9]{4}[a-zA-Z]{3}[0-9]{5}NR[0-9a-zA-Z]{1}$/,                                          // NR entity
  /^[0-9]{2}[a-zA-Z]{4}[a-zA-Z0-9]{1}[0-9]{4}[a-zA-Z]{1}[1-9A-Za-z]{1}D[0-9a-zA-Z]{1}$/    // Diplomatic
];

function isValidCtin(val) {
  if (typeof val !== 'string' || val.length !== 15) return false;
  return CTIN_PATTERNS.some((re) => re.test(val));
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const fail = (msg) => { throw ApiError.validationError(msg); };

function assertOnlyKeys(value, allowedKeys, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const unexpected = Object.keys(value).find((k) => !allowedKeys.includes(k));
  if (unexpected) {
    fail(`GSTR-1 Schema Error (${location}): '${unexpected}' is not an allowed field. Allowed: ${allowedKeys.join(', ')}`);
  }
}

function isMultipleOf01(val) {
  const scaled = Math.round(val * 100);
  return Math.abs(val * 100 - scaled) < 1e-7;
}

function assertNumber(
  val,
  field,
  location,
  { allowNegative = false, integer = false, max = null, multipleOf01 = true } = {}
) {
  if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be a valid finite number. Received: ${val}`);
  }

  if (integer) {
    if (!Number.isInteger(val)) {
      fail(`GSTR-1 Schema Error (${location}): '${field}' must be an integer. Received: ${val}`);
    }
    return;
  }

  if (!allowNegative && val < 0) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be >= 0. Received: ${val}`);
  }

  if (max !== null && val > max) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' exceeds maximum ${max}. Received: ${val}`);
  }

  if (multipleOf01 && !isMultipleOf01(val)) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be a multiple of 0.01. Received: ${val}`);
  }
}

function assertOptionalNumber(val, field, location, opts) {
  if (val !== undefined && val !== null) assertNumber(val, field, location, opts);
}

function assertFlag(val, location) {
  if (val === undefined || val === null || val === '') return;
  if (typeof val !== 'string') {
    fail(`GSTR-1 Schema Error (${location}): 'flag' must be a string enum. Received: ${JSON.stringify(val)}`);
  }
  if (!VALID_FLAGS.has(val)) {
    fail(`GSTR-1 Schema Error (${location}): 'flag' must be one of [${Array.from(VALID_FLAGS).join(', ')}]. Received: "${val}"`);
  }
}

function assertDocNumber(val, field, location) {
  if (typeof val !== 'string' || !INUM_RE.test(val)) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be 1-16 chars (alphanumeric, '/' or '-'), no spaces, and must contain at least one alphanumeric character (1-9 or A-Z). Received: "${val}"`);
  }
}

function isGstnDate(str) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(str || '');
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
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be a valid calendar date DD-MM-YYYY with no spaces. Received: "${val}"`);
  }
}

function assertPos(val, location, foreign = false) {
  const s = String(val ?? '');
  const allowed = foreign ? FOREIGN_POS : DOMESTIC_POS;
  if (!POS_RE.test(s) || !allowed.has(s)) {
    fail(`GSTR-1 Schema Error (${location}): invalid Place of Supply '${val}'. Must be a valid GST state code (${foreign ? '01-38, 96, 97' : '01-38, 97'}).`);
  }
}

function assertYesNo(val, field, location) {
  if (val !== 'Y' && val !== 'N') {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be strictly 'Y' or 'N'. Received: ${val}`);
  }
}

function assertString(val, field, location, { maxLen = 100, required = true } = {}) {
  if (val === undefined || val === null || val === '') {
    if (required) fail(`GSTR-1 Schema Error (${location}): '${field}' is mandatory.`);
    return;
  }
  if (typeof val !== 'string') {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be a string. Received: ${typeof val}`);
  }
  if (val !== val.trim()) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' has leading/trailing whitespace.`);
  }
  if (val.length > maxLen) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' exceeds max length ${maxLen} (got ${val.length}).`);
  }
}

function assertNonEmptyString(val, field, location, { maxLen = null } = {}) {
  if (val === undefined || val === null) return;
  if (typeof val !== 'string' || val.trim() === '') {
    fail(`GSTR-1 Schema Error (${location}): '${field}' must be a non-empty string when present.`);
  }
  if (val !== val.trim()) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' has leading/trailing whitespace.`);
  }
  if (maxLen !== null && val.length > maxLen) {
    fail(`GSTR-1 Schema Error (${location}): '${field}' exceeds max length ${maxLen}.`);
  }
}

function assertEtin(val, location) {
  if (val === undefined || val === null) return;
  if (typeof val !== 'string') {
    fail(`GSTR-1 Schema Error (${location}): 'etin' must be a string.`);
  }
  if (val === '') return; // schema definition etinEmptyChck
  if (!ETIN_RE.test(val)) {
    fail(`GSTR-1 Schema Error (${location}): invalid 'etin'. Must be 15 chars e-commerce operator ID. Received: "${val}"`);
  }
}

function assertArrayIfPresent(list, location) {
  if (list === undefined || list === null) return false;
  if (!Array.isArray(list)) {
    fail(`GSTR-1 Schema Error (${location}): must be an array when present.`);
  }
  return true;
}

/**
 * Validates invoice line items with section-specific tax keys.
 * B2CL strictly rejects camt/samt. B2B and CDNR allow all heads.
 * num minimum is 1 for invoices/CDNR, but schema allows 0 for CDNUR.
 */
function assertItems(itms, location, detKeys = B2B_DET_KEYS, minNum = 1) {
  if (!Array.isArray(itms) || itms.length === 0) {
    fail(`GSTR-1 Schema Error (${location}): 'itms' must be a non-empty array.`);
  }
  for (let i = 0; i < itms.length; i++) {
    const item = itms[i];
    const loc = `${location} item #${i + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }
    assertOnlyKeys(item, ['num', 'itm_det'], loc);
    assertNumber(item.num, 'num', loc, { integer: true });
    if (item.num < minNum) fail(`GSTR-1 Schema Error (${loc}): 'num' must be >= ${minNum}.`);

    if (!item.itm_det || typeof item.itm_det !== 'object' || Array.isArray(item.itm_det)) {
      fail(`GSTR-1 Schema Error (${loc}): 'itm_det' object is mandatory.`);
    }
    const det = item.itm_det;
    const dLoc = `${loc} itm_det`;
    assertOnlyKeys(det, detKeys, dLoc);

    assertNumber(det.rt, 'rt', dLoc);
    if (det.rt < 0 || det.rt > 999.99) {
      fail(`GSTR-1 Schema Error (${dLoc}): 'rt' must be between 0 and 999.99. Received: ${det.rt}`);
    }
    assertNumber(det.txval, 'txval', dLoc, { max: 99999999999.99 });
    for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
      if (detKeys.includes(f)) {
        assertOptionalNumber(det[f], f, dLoc, { max: 99999999999.99 });
      }
    }

    const hasTaxHead = ['iamt', 'camt', 'samt'].some((f) => detKeys.includes(f) && typeof det[f] === 'number');
    if (det.rt > 0 && det.txval > 0 && !hasTaxHead) {
      fail(`GSTR-1 Schema Error (${dLoc}): rt=${det.rt}% with txval>0 requires at least one allowed tax head.`);
    }
  }
}

/**
 * Validates optional items in deletion variants (flag: 'D') without blanket skipping.
 * Fields are optional, but if present, they must adhere to schema types and bounds.
 */
function validateItemsOptional(itms, location, detKeys = B2B_DET_KEYS, minNum = 1) {
  if (!Array.isArray(itms)) {
    fail(`GSTR-1 Schema Error (${location}): 'itms' must be an array when present.`);
  }
  for (let i = 0; i < itms.length; i++) {
    const item = itms[i];
    const loc = `${location} item #${i + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }
    assertOnlyKeys(item, ['num', 'itm_det'], loc);
    if (item.num !== undefined) {
      assertNumber(item.num, 'num', loc, { integer: true });
      if (item.num < minNum) fail(`GSTR-1 Schema Error (${loc}): 'num' must be >= ${minNum}.`);
    }
    if (item.itm_det !== undefined) {
      if (typeof item.itm_det !== 'object' || Array.isArray(item.itm_det)) {
        fail(`GSTR-1 Schema Error (${loc}): 'itm_det' must be an object when present.`);
      }
      const det = item.itm_det;
      const dLoc = `${loc} itm_det`;
      assertOnlyKeys(det, detKeys, dLoc);
      if (det.rt !== undefined) {
        assertNumber(det.rt, 'rt', dLoc);
        if (det.rt < 0 || det.rt > 999.99) {
          fail(`GSTR-1 Schema Error (${dLoc}): 'rt' must be between 0 and 999.99. Received: ${det.rt}`);
        }
      }
      if (det.txval !== undefined) {
        assertNumber(det.txval, 'txval', dLoc, { max: 99999999999.99 });
      }
      for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
        if (detKeys.includes(f) && det[f] !== undefined) {
          assertNumber(det[f], f, dLoc, { max: 99999999999.99 });
        }
      }
    }
  }
}

/**
 * Table 6A EXP items are flat objects: { rt, txval, iamt, csamt }
 * (NO 'num' and NO 'itm_det', additionalProperties: false).
 */
function validateExpItems(itms, location) {
  if (!Array.isArray(itms) || itms.length === 0) {
    fail(`GSTR-1 Schema Error (${location}): 'itms' must be a non-empty array.`);
  }
  for (let i = 0; i < itms.length; i++) {
    const item = itms[i];
    const loc = `${location} item #${i + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }
    assertOnlyKeys(item, EXP_ITEM_KEYS, loc);
    assertNumber(item.rt, 'rt', loc);
    if (item.rt < 0 || item.rt > 999.99) {
      fail(`GSTR-1 Schema Error (${loc}): 'rt' must be between 0 and 999.99. Received: ${item.rt}`);
    }
    assertNumber(item.txval, 'txval', loc, { max: 99999999999.99 });
    assertOptionalNumber(item.iamt, 'iamt', loc, { max: 99999999999.99 });
    assertOptionalNumber(item.csamt, 'csamt', loc, { max: 99999999999.99 });
  }
}

function validateExpItemsOptional(itms, location) {
  if (!Array.isArray(itms)) {
    fail(`GSTR-1 Schema Error (${location}): 'itms' must be an array when present.`);
  }
  for (let i = 0; i < itms.length; i++) {
    const item = itms[i];
    const loc = `${location} item #${i + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(`GSTR-1 Schema Error (${loc}): must be an object.`);
    }
    assertOnlyKeys(item, EXP_ITEM_KEYS, loc);
    if (item.rt !== undefined) {
      assertNumber(item.rt, 'rt', loc);
      if (item.rt < 0 || item.rt > 999.99) {
        fail(`GSTR-1 Schema Error (${loc}): 'rt' must be between 0 and 999.99. Received: ${item.rt}`);
      }
    }
    if (item.txval !== undefined) assertNumber(item.txval, 'txval', loc, { max: 99999999999.99 });
    if (item.iamt !== undefined) assertNumber(item.iamt, 'iamt', loc, { max: 99999999999.99 });
    if (item.csamt !== undefined) assertNumber(item.csamt, 'csamt', loc, { max: 99999999999.99 });
  }
}

/* -------------------------------------------------------------------------- */
/* Section Validators                                                         */
/* -------------------------------------------------------------------------- */

function validateB2B(list, label = 'Table 4 B2B') {
  if (!assertArrayIfPresent(list, label)) return;
  for (let c = 0; c < list.length; c++) {
    const party = list[c];
    const pLoc = `${label} party #${c + 1}`;
    assertOnlyKeys(party, ['ctin', 'inv'], pLoc);
    if (!party.ctin || !isValidCtin(party.ctin)) {
      fail(`GSTR-1 Schema Error (${pLoc}): recipient 'ctin' is invalid: ${party.ctin}`);
    }
    if (!Array.isArray(party.inv) || party.inv.length === 0) {
      fail(`GSTR-1 Schema Error (${pLoc}): '${party.ctin}' has no invoices under 'inv'.`);
    }
    for (let i = 0; i < party.inv.length; i++) {
      const inv = party.inv[i];
      const loc = `${label} ${party.ctin} invoice #${i + 1}`;
      assertOnlyKeys(inv, B2B_INV_KEYS, loc);
      assertDocNumber(inv.inum, 'inum', loc);
      assertDate(inv.idt, 'idt', loc);
      assertFlag(inv.flag, loc);
      assertEtin(inv.etin, loc);
      assertNonEmptyString(inv.irn, 'irn', loc);
      assertNonEmptyString(inv.irngendate, 'irngendate', loc);
      assertNonEmptyString(inv.srctyp, 'srctyp', loc);

      // Deletion variant: optional fields validated if present
      if (inv.flag === 'D') {
        if (inv.val !== undefined) assertNumber(inv.val, 'val', loc, { max: 9999999999999.99 });
        if (inv.pos !== undefined) assertPos(inv.pos, loc, true);
        if (inv.rchrg !== undefined) assertYesNo(inv.rchrg, 'rchrg', loc);
        if (inv.inv_typ !== undefined && !ALLOWED_INV_TYP.includes(inv.inv_typ)) {
          fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' must be one of ${ALLOWED_INV_TYP.join(', ')}. Received: ${inv.inv_typ}`);
        }
        if (inv.itms !== undefined) validateItemsOptional(inv.itms, loc, B2B_DET_KEYS);
        continue;
      }

      assertNumber(inv.val, 'val', loc, { max: 9999999999999.99 });
      assertPos(inv.pos, loc, true); // Foreign POS 96 allowed for SEZ/foreign
      assertYesNo(inv.rchrg, 'rchrg', loc);
      if (!ALLOWED_INV_TYP.includes(inv.inv_typ)) {
        fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' must be one of ${ALLOWED_INV_TYP.join(', ')}. Received: ${inv.inv_typ}`);
      }
      assertItems(inv.itms, loc, B2B_DET_KEYS);
    }
  }
}

function validateB2CL(list, label = 'Table 5 B2CL') {
  if (!assertArrayIfPresent(list, label)) return;
  for (let i = 0; i < list.length; i++) {
    const group = list[i];
    const gLoc = `${label} group #${i + 1}`;
    assertOnlyKeys(group, ['pos', 'inv'], gLoc);
    assertPos(group.pos, gLoc, false); // Domestic POS strictly enforced (01-38, 97)
    if (!Array.isArray(group.inv) || group.inv.length === 0) {
      fail(`GSTR-1 Schema Error (${gLoc}): 'inv' must be a non-empty array.`);
    }
    for (let j = 0; j < group.inv.length; j++) {
      const inv = group.inv[j];
      const loc = `${gLoc} invoice #${j + 1}`;
      const isDeletion = inv.flag === 'D';

      // Schema: pos is allowed ONLY in deletion variant (B2CL_DEL_KEYS)
      assertOnlyKeys(inv, isDeletion ? B2CL_DEL_KEYS : B2CL_REG_KEYS, loc);
      assertDocNumber(inv.inum, 'inum', loc);
      assertDate(inv.idt, 'idt', loc);
      assertFlag(inv.flag, loc);
      assertEtin(inv.etin, loc);

      if (isDeletion) {
        if (inv.val !== undefined) assertNumber(inv.val, 'val', loc, { max: 9999999999999.99 });
        if (inv.pos !== undefined) assertPos(inv.pos, loc, false);
        if (inv.itms !== undefined) validateItemsOptional(inv.itms, loc, B2CL_DET_KEYS);
        continue;
      }

      assertNumber(inv.val, 'val', loc, { max: 9999999999999.99 });
      assertItems(inv.itms, loc, B2CL_DET_KEYS); // strictly NO camt/samt
    }
  }
}

function validateB2CS(list, label = 'Table 7 B2CS') {
  if (!assertArrayIfPresent(list, label)) return;
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const loc = `${label} row #${i + 1}`;
    assertOnlyKeys(row, ['typ', 'sply_ty', 'rt', 'etin', 'flag', 'pos', 'txval', 'iamt', 'camt', 'samt', 'csamt'], loc);

    if (!['E', 'OE'].includes(row.typ)) {
      fail(`GSTR-1 Schema Error (${loc}): 'typ' must be 'E' or 'OE'. Received: ${row.typ}`);
    }
    if (!['INTER', 'INTRA'].includes(row.sply_ty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be 'INTER' or 'INTRA'. Received: ${row.sply_ty}`);
    }
    assertFlag(row.flag, loc);
    assertEtin(row.etin, loc);

    const isDeletion = row.flag === 'D';
    if (isDeletion) {
      if (row.pos !== undefined) assertPos(row.pos, loc, false);
      if (row.rt !== undefined) {
        assertNumber(row.rt, 'rt', loc);
        if (row.rt < 0 || row.rt > 999.99) {
          fail(`GSTR-1 Schema Error (${loc}): 'rt' must be between 0 and 999.99. Received: ${row.rt}`);
        }
      }
      if (row.txval !== undefined) {
        assertNumber(row.txval, 'txval', loc, { allowNegative: true, max: 99999999999.99 });
      }
      for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
        if (row[f] !== undefined) {
          assertNumber(row[f], f, loc, { allowNegative: true, max: 99999999999.99 });
        }
      }
      continue;
    }

    // Regular B2CS variant
    assertPos(row.pos, loc, false); // Domestic POS strictly enforced (01-38, 97)
    assertNumber(row.rt, 'rt', loc);
    if (row.rt < 0 || row.rt > 999.99) {
      fail(`GSTR-1 Schema Error (${loc}): 'rt' must be between 0 and 999.99. Received: ${row.rt}`);
    }
    // Net credit note adjustments in B2CS allow negative values per schema definition txvalue
    assertNumber(row.txval, 'txval', loc, { allowNegative: true, max: 99999999999.99 });
    for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
      assertOptionalNumber(row[f], f, loc, { allowNegative: true, max: 99999999999.99 });
    }

    // Cross-tax integrity check (statutory safeguard against head contamination)
    if (row.sply_ty === 'INTER' && (Number(row.camt || 0) > 0 || Number(row.samt || 0) > 0)) {
      fail(`GSTR-1 Schema Error (${loc}): INTER supply cannot have camt/samt. Use iamt.`);
    }
    if (row.sply_ty === 'INTRA' && Number(row.iamt || 0) > 0) {
      fail(`GSTR-1 Schema Error (${loc}): INTRA supply cannot have iamt. Use camt/samt.`);
    }
  }
}

function validateNil(nil) {
  if (!nil) return;
  assertOnlyKeys(nil, ['flag', 'inv'], 'Table 8 Nil'); // NO chksum allowed
  assertFlag(nil.flag, 'Table 8 Nil');

  if (!Array.isArray(nil.inv)) {
    fail("GSTR-1 Schema Error (Table 8 Nil): 'inv' must be an array.");
  }

  const isDeletion = nil.flag === 'D';

  // Regular nil requires minItems 1 unless deletion flag 'D' is present
  if (!isDeletion && nil.inv.length === 0) {
    fail("GSTR-1 Schema Error (Table 8 Nil): regular nil section must contain at least one row.");
  }

  for (let i = 0; i < nil.inv.length; i++) {
    const row = nil.inv[i];
    const loc = `Table 8 Nil row #${i + 1}`;
    assertOnlyKeys(row, ['sply_ty', 'nil_amt', 'expt_amt', 'ngsup_amt'], loc);
    if (!ALLOWED_NIL_SPLY.includes(row.sply_ty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'sply_ty' must be one of ${ALLOWED_NIL_SPLY.join(', ')}. Received: ${row.sply_ty}`);
    }

    if (isDeletion) {
      assertOptionalNumber(row.nil_amt, 'nil_amt', loc, { allowNegative: true, max: 99999999999.99 });
      assertOptionalNumber(row.expt_amt, 'expt_amt', loc, { allowNegative: true, max: 99999999999.99 });
      assertOptionalNumber(row.ngsup_amt, 'ngsup_amt', loc, { allowNegative: true, max: 99999999999.99 });
      continue;
    }

    // All 3 amounts are mandatory numbers in regular schema (nonEmptyNil)
    assertNumber(row.nil_amt, 'nil_amt', loc, { allowNegative: true, max: 99999999999.99 });
    assertNumber(row.expt_amt, 'expt_amt', loc, { allowNegative: true, max: 99999999999.99 });
    assertNumber(row.ngsup_amt, 'ngsup_amt', loc, { allowNegative: true, max: 99999999999.99 });
  }
}

function validateCdnr(list, label = 'Table 9B CDNR') {
  if (!assertArrayIfPresent(list, label)) return;
  for (let i = 0; i < list.length; i++) {
    const party = list[i];
    const pLoc = `${label} group #${i + 1}`;
    assertOnlyKeys(party, ['ctin', 'nt'], pLoc);
    if (!party.ctin || !isValidCtin(party.ctin)) {
      fail(`GSTR-1 Schema Error (${pLoc}): invalid 'ctin': ${party.ctin}`);
    }
    if (!Array.isArray(party.nt) || party.nt.length === 0) {
      fail(`GSTR-1 Schema Error (${pLoc}): 'nt' must be a non-empty array.`);
    }
    for (let j = 0; j < party.nt.length; j++) {
      const note = party.nt[j];
      const loc = `${pLoc} note #${j + 1}`;
      assertOnlyKeys(note, CDNR_NOTE_KEYS, loc);
      assertDocNumber(note.nt_num, 'nt_num', loc);
      assertDate(note.nt_dt, 'nt_dt', loc);
      assertFlag(note.flag, loc);
      assertEtin(note.etin, loc);
      assertNonEmptyString(note.irn, 'irn', loc);
      assertNonEmptyString(note.irngendate, 'irngendate', loc);
      assertNonEmptyString(note.srctyp, 'srctyp', loc);

      // Deletion variant
      if (note.flag === 'D') {
        if (note.val !== undefined) assertNumber(note.val, 'val', loc, { max: 9999999999999.99 });
        if (note.ntty !== undefined && !ALLOWED_NTTY.includes(note.ntty)) {
          fail(`GSTR-1 Schema Error (${loc}): 'ntty' must be one of [${ALLOWED_NTTY.join(', ')}]. Received: ${note.ntty}`);
        }
        if (note.pos !== undefined) assertPos(note.pos, loc, true);
        if (note.rchrg !== undefined) assertYesNo(note.rchrg, 'rchrg', loc);
        if (note.inv_typ !== undefined && !ALLOWED_INV_TYP.includes(note.inv_typ)) {
          fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' must be one of ${ALLOWED_INV_TYP.join(', ')}. Received: ${note.inv_typ}`);
        }
        if (note.itms !== undefined) validateItemsOptional(note.itms, loc, CDNR_DET_KEYS);
        continue;
      }

      if (!ALLOWED_NTTY.includes(note.ntty)) {
        fail(`GSTR-1 Schema Error (${loc}): 'ntty' must be one of [${ALLOWED_NTTY.join(', ')}]. Received: ${note.ntty}`);
      }
      assertNumber(note.val, 'val', loc, { max: 9999999999999.99 });
      assertPos(note.pos, loc, true); // Foreign POS 96 allowed
      assertYesNo(note.rchrg, 'rchrg', loc);
      if (!ALLOWED_INV_TYP.includes(note.inv_typ)) {
        fail(`GSTR-1 Schema Error (${loc}): 'inv_typ' must be one of ${ALLOWED_INV_TYP.join(', ')}. Received: ${note.inv_typ}`);
      }
      assertItems(note.itms, loc, CDNR_DET_KEYS);
    }
  }
}

function validateCdnurNote(note, loc) {
  assertOnlyKeys(note, CDNUR_NOTE_KEYS, loc);

  // 'typ' is strictly mandatory per schema required list (both regular and deletion)
  if (!note.typ || !ALLOWED_CDNUR_TYP.includes(note.typ)) {
    fail(`GSTR-1 Schema Error (${loc}): 'typ' is mandatory and must be one of ${ALLOWED_CDNUR_TYP.join(', ')}. Received: ${note.typ}`);
  }

  assertDocNumber(note.nt_num, 'nt_num', loc);
  assertDate(note.nt_dt, 'nt_dt', loc);
  assertFlag(note.flag, loc);
  assertNonEmptyString(note.irn, 'irn', loc);
  assertNonEmptyString(note.irngendate, 'irngendate', loc);
  assertNonEmptyString(note.srctyp, 'srctyp', loc);

  // Deletion variant
  if (note.flag === 'D') {
    if (note.val !== undefined) assertNumber(note.val, 'val', loc, { max: 9999999999999.99 });
    if (note.ntty !== undefined && !ALLOWED_NTTY.includes(note.ntty)) {
      fail(`GSTR-1 Schema Error (${loc}): 'ntty' must be one of [${ALLOWED_NTTY.join(', ')}]. Received: ${note.ntty}`);
    }
    if (note.typ === 'B2CL') {
      if (note.pos !== undefined) assertPos(note.pos, loc, false);
    } else if (note.pos !== undefined) {
      fail(`GSTR-1 Schema Error (${loc}): 'pos' is not allowed for export notes (${note.typ}).`);
    }
    if (note.itms !== undefined) validateItemsOptional(note.itms, loc, CDNUR_DET_KEYS, 0);
    return;
  }

  if (!ALLOWED_NTTY.includes(note.ntty)) {
    fail(`GSTR-1 Schema Error (${loc}): 'ntty' must be one of [${ALLOWED_NTTY.join(', ')}]. Received: ${note.ntty}`);
  }
  assertNumber(note.val, 'val', loc, { max: 9999999999999.99 });

  if (note.typ === 'B2CL') {
    assertPos(note.pos, loc, false); // Domestic POS required for B2CL
  } else if (note.pos !== undefined) {
    fail(`GSTR-1 Schema Error (${loc}): 'pos' is not allowed for export notes (${note.typ}).`);
  }

  // CDNUR schema definitions/itms allows minimum: 0 for serial no
  assertItems(note.itms, loc, CDNUR_DET_KEYS, 0);
}

function validateCdnur(list, label = 'Table 9C CDNUR') {
  if (!assertArrayIfPresent(list, label)) return;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const loc = `${label} note #${i + 1}`;
    if (item && Array.isArray(item.nt)) {
      fail(`GSTR-1 Schema Error (${loc}): CDNUR must be a flat array of note objects. Grouped format { pos, nt } is not allowed by GSTN schema.`);
    }
    validateCdnurNote(item, loc);
  }
}

function validateNotes(list, { unregistered = false, label }) {
  if (unregistered) {
    return validateCdnur(list, label);
  }
  return validateCdnr(list, label);
}

function validateExp(list, label = 'Table 6A EXP') {
  if (!assertArrayIfPresent(list, label)) return;
  for (let i = 0; i < list.length; i++) {
    const group = list[i];
    const gLoc = `${label} group #${i + 1}`;
    assertOnlyKeys(group, ['exp_typ', 'inv'], gLoc);
    if (!['WOPAY', 'WPAY'].includes(group.exp_typ)) {
      fail(`GSTR-1 Schema Error (${gLoc}): 'exp_typ' must be 'WOPAY' or 'WPAY'. Received: ${group.exp_typ}`);
    }
    if (!Array.isArray(group.inv) || group.inv.length === 0) {
      fail(`GSTR-1 Schema Error (${gLoc}): 'inv' must be a non-empty array.`);
    }
    for (let j = 0; j < group.inv.length; j++) {
      const inv = group.inv[j];
      const loc = `${gLoc} invoice #${j + 1}`;
      assertOnlyKeys(inv, EXP_INV_KEYS, loc);
      assertDocNumber(inv.inum, 'inum', loc);
      assertDate(inv.idt, 'idt', loc);
      assertFlag(inv.flag, loc);
      assertNonEmptyString(inv.irn, 'irn', loc);
      assertNonEmptyString(inv.irngendate, 'irngendate', loc);
      assertNonEmptyString(inv.srctyp, 'srctyp', loc);

      if (inv.sbdt !== undefined) assertDate(inv.sbdt, 'sbdt', loc);
      if (inv.sbnum !== undefined) {
        const sbnum = String(inv.sbnum);
        if (sbnum !== '' && !SBNUM_RE.test(sbnum)) {
          fail(`GSTR-1 Schema Error (${loc}): 'sbnum' must be empty or 3-7 digits. Received: "${inv.sbnum}"`);
        }
      }
      if (inv.sbpcode !== undefined) {
        const sbpcode = String(inv.sbpcode);
        if (!SPCODE_RE.test(sbpcode)) {
          fail(`GSTR-1 Schema Error (${loc}): 'sbpcode' must be 1-6 alphanumeric characters. Received: "${inv.sbpcode}"`);
        }
      }

      // Deletion variant
      if (inv.flag === 'D') {
        if (inv.val !== undefined) assertNumber(inv.val, 'val', loc, { max: 9999999999999.99 });
        if (inv.itms !== undefined) validateExpItemsOptional(inv.itms, loc);
        continue;
      }

      assertNumber(inv.val, 'val', loc, { max: 9999999999999.99 });
      validateExpItems(inv.itms, loc);
    }
  }
}

/**
 * Validates Table 12 HSN Summary rows according to official GSTN schema variants:
 * Variant 1 (Rate-wise): hsn_sc (2-8 digits), rt (0-999.99), val absent or 0.
 * Variant 2 (Value-wise): hsn_sc (2-8 digits), val present, rt absent.
 * Variant 3 (No HSN): hsn_sc empty string, desc mandatory, val present, rt absent.
 */
function validateHsnRow(h, loc) {
  assertOnlyKeys(h, HSN_ROW_KEYS, loc);

  assertNumber(h.num, 'num', loc, { integer: true });
  if (h.num < 1) fail(`GSTR-1 Schema Error (${loc}): 'num' must be >= 1.`);

  assertString(h.uqc, 'uqc', loc, { maxLen: 30 });
  if (!UQC_RE.test(String(h.uqc))) {
    fail(`GSTR-1 Schema Error (${loc}): 'uqc' must contain only alphabetic characters (A-Z/a-z). Received: "${h.uqc}"`);
  }
  if (UQC_ENUM.length && !UQC_ENUM.includes(h.uqc)) {
    fail(`GSTR-1 Schema Error (${loc}): 'uqc' must be one of [${UQC_ENUM.join(', ')}]. Received: ${h.uqc}`);
  }

  const numOpts = { allowNegative: HSN_ALLOW_NEGATIVE, max: 9999999999999.99 };
  assertNumber(h.txval, 'txval', loc, numOpts);
  assertNumber(h.qty, 'qty', loc, { allowNegative: HSN_ALLOW_NEGATIVE, max: 1000000000000000 });

  for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
    assertOptionalNumber(h[f], f, loc, numOpts);
  }
  assertFlag(h.flag, loc);

  const code = String(h.hsn_sc ?? '');
  const hasRt = h.rt !== undefined && h.rt !== null;
  const hasVal = h.val !== undefined && h.val !== null;

  if (hasRt) {
    assertNumber(h.rt, 'rt', loc);
    if (h.rt < 0 || h.rt > 999.99) {
      fail(`GSTR-1 Schema Error (${loc}): 'rt' must be between 0 and 999.99. Received: ${h.rt}`);
    }
  }

  // Variant 1: Rate-wise HSN (val absent or strictly 0)
  if (HSN_RE.test(code) && hasRt) {
    if (hasVal) {
      assertNumber(h.val, 'val', loc, { allowNegative: false, max: 0 });
    }
    if (h.desc !== undefined) {
      assertString(h.desc, 'desc', loc, { maxLen: HSN_DESC_MAX, required: false });
    }
    return;
  }

  // Variant 2: Value-wise HSN
  if (HSN_RE.test(code) && !hasRt && hasVal) {
    assertNumber(h.val, 'val', loc, numOpts);
    if (h.desc !== undefined) {
      assertString(h.desc, 'desc', loc, { maxLen: HSN_DESC_MAX, required: false });
    }
    return;
  }

  // Variant 3: No HSN code
  if (code === '' && !hasRt && hasVal) {
    if (!h.desc) {
      fail(`GSTR-1 Schema Error (${loc}): 'desc' is mandatory when 'hsn_sc' is empty.`);
    }
    assertString(h.desc, 'desc', loc, { maxLen: HSN_DESC_MAX });
    assertNumber(h.val, 'val', loc, numOpts);
    return;
  }

  fail(
    `GSTR-1 Schema Error (${loc}): HSN row must match one GSTN variant: ` +
    `rate-wise (hsn_sc 2-8 digits + rt, val absent or 0), ` +
    `value-wise (hsn_sc 2-8 digits + val, no rt), or ` +
    `no-HSN (empty hsn_sc + desc + val, no rt).`
  );
}

function validateHsn(hsn) {
  if (!hsn) return;
  // Strict schema: only 'flag' and 'data' allowed in modern GSTR-1 RETSAVE payload
  assertOnlyKeys(hsn, ['flag', 'data'], 'Table 12 HSN');
  assertFlag(hsn.flag, 'Table 12 HSN');

  if (!Array.isArray(hsn.data)) {
    fail("GSTR-1 Schema Error (Table 12 HSN): must contain 'data' array.");
  }

  const isDeletion = hsn.flag === 'D';

  for (let i = 0; i < hsn.data.length; i++) {
    const h = hsn.data[i];
    const loc = `Table 12 HSN row #${i + 1}`;
    assertOnlyKeys(h, HSN_ROW_KEYS, loc);

    if (isDeletion) {
      if (h.num !== undefined) {
        assertNumber(h.num, 'num', loc, { integer: true });
        if (h.num < 1) fail(`GSTR-1 Schema Error (${loc}): 'num' must be >= 1.`);
      }
      if (h.hsn_sc !== undefined && h.hsn_sc !== '') {
        if (!HSN_RE.test(String(h.hsn_sc))) {
          fail(`GSTR-1 Schema Error (${loc}): 'hsn_sc' must be 2-8 digits or empty. Received: "${h.hsn_sc}"`);
        }
      }
      if (h.uqc !== undefined) {
        assertString(h.uqc, 'uqc', loc, { maxLen: 30 });
        if (!UQC_RE.test(String(h.uqc))) {
          fail(`GSTR-1 Schema Error (${loc}): 'uqc' must contain only alphabetic characters. Received: "${h.uqc}"`);
        }
      }
      if (h.qty !== undefined) {
        assertNumber(h.qty, 'qty', loc, { allowNegative: HSN_ALLOW_NEGATIVE, max: 1000000000000000 });
      }
      if (h.txval !== undefined) {
        assertNumber(h.txval, 'txval', loc, { allowNegative: HSN_ALLOW_NEGATIVE, max: 9999999999999.99 });
      }
      if (h.val !== undefined) {
        assertNumber(h.val, 'val', loc, { allowNegative: HSN_ALLOW_NEGATIVE, max: 9999999999999.99 });
      }
      if (h.rt !== undefined) {
        assertNumber(h.rt, 'rt', loc);
        if (h.rt < 0 || h.rt > 999.99) {
          fail(`GSTR-1 Schema Error (${loc}): 'rt' must be between 0 and 999.99. Received: ${h.rt}`);
        }
      }
      for (const f of ['iamt', 'camt', 'samt', 'csamt']) {
        if (h[f] !== undefined) {
          assertNumber(h[f], f, loc, { allowNegative: HSN_ALLOW_NEGATIVE, max: 9999999999999.99 });
        }
      }
      if (h.desc !== undefined) {
        assertString(h.desc, 'desc', loc, { maxLen: HSN_DESC_MAX, required: false });
      }
      assertFlag(h.flag, loc);
      continue;
    }

    validateHsnRow(h, loc);
  }
}

function validateDocIssue(docIssue) {
  if (!docIssue) return;
  assertOnlyKeys(docIssue, ['flag', 'doc_det'], 'Table 13 DOCISS');
  assertFlag(docIssue.flag, 'Table 13 DOCISS');

  const isDeletion = docIssue.flag === 'D';

  if (!Array.isArray(docIssue.doc_det)) {
    if (isDeletion) return;
    fail("GSTR-1 Schema Error (Table 13 DOCISS): 'doc_det' must be an array.");
  }

  // Schema-tightening business rule: regular filings should have at least 1 section
  if (!isDeletion && docIssue.doc_det.length === 0) {
    fail("GSTR-1 Schema Error (Table 13 DOCISS): regular doc_issue must contain at least one doc_det.");
  }

  for (let i = 0; i < docIssue.doc_det.length; i++) {
    const detail = docIssue.doc_det[i];
    const dLoc = `Table 13 detail #${i + 1}`;
    assertOnlyKeys(detail, ['doc_num', 'doc_typ', 'docs'], dLoc);

    if (detail.doc_num !== undefined || !isDeletion) {
      assertNumber(detail.doc_num, 'doc_num', dLoc, { integer: true });
      if (detail.doc_num < 1) fail(`GSTR-1 Schema Error (${dLoc}): 'doc_num' must be >= 1.`);
      if (detail.doc_num > DOC_NUM_MAX) {
        fail(`GSTR-1 Schema Error (${dLoc}): 'doc_num' must be <= ${DOC_NUM_MAX}.`);
      }
    }

    if (detail.doc_typ !== undefined) {
      assertNonEmptyString(detail.doc_typ, 'doc_typ', dLoc, { maxLen: 50 });
      if (DOC_TYP_ENUM.length && !DOC_TYP_ENUM.includes(detail.doc_typ)) {
        fail(`GSTR-1 Schema Error (${dLoc}): 'doc_typ' must be one of [${DOC_TYP_ENUM.join(', ')}]. Received: "${detail.doc_typ}"`);
      }
    }

    if (!Array.isArray(detail.docs)) {
      if (isDeletion) continue;
      fail(`GSTR-1 Schema Error (${dLoc}): 'docs' must be an array.`);
    }

    if (!isDeletion && detail.docs.length === 0) {
      fail(`GSTR-1 Schema Error (${dLoc}): regular doc_issue 'docs' must contain at least one document.`);
    }

    for (let j = 0; j < detail.docs.length; j++) {
      const doc = detail.docs[j];
      const loc = `${dLoc} document #${j + 1}`;
      // Strictly 'cancel' — 'canc' is not in GSTN schema
      assertOnlyKeys(doc, ['cancel', 'from', 'net_issue', 'num', 'to', 'totnum'], loc);

      if (isDeletion) {
        if (doc.num !== undefined) {
          assertNumber(doc.num, 'num', loc, { integer: true });
          if (doc.num < 1) fail(`GSTR-1 Schema Error (${loc}): 'num' must be >= 1.`);
        }
        if (doc.totnum !== undefined) {
          assertNumber(doc.totnum, 'totnum', loc, { integer: true, max: 9999999999 });
        }
        if (doc.cancel !== undefined) {
          assertNumber(doc.cancel, 'cancel', loc, { integer: true, max: 9999999999 });
        }
        if (doc.net_issue !== undefined) {
          assertNumber(doc.net_issue, 'net_issue', loc, { integer: true, max: 9999999999 });
        }
        if (doc.from !== undefined) assertDocNumber(doc.from, 'from', loc);
        if (doc.to !== undefined) assertDocNumber(doc.to, 'to', loc);

        if (
          doc.totnum !== undefined &&
          doc.cancel !== undefined &&
          doc.net_issue !== undefined &&
          doc.totnum - doc.cancel !== doc.net_issue
        ) {
          fail(
            `GSTR-1 Schema Error (${loc}): document arithmetic invalid — totnum(${doc.totnum}) − cancel(${doc.cancel}) `
            + `must equal net_issue(${doc.net_issue}).`
          );
        }
        continue;
      }

      assertNumber(doc.num, 'num', loc, { integer: true });
      if (doc.num < 1) fail(`GSTR-1 Schema Error (${loc}): 'num' must be >= 1.`);

      assertNumber(doc.totnum, 'totnum', loc, { integer: true, max: 9999999999 });
      assertNumber(doc.cancel, 'cancel', loc, { integer: true, max: 9999999999 });
      assertNumber(doc.net_issue, 'net_issue', loc, { integer: true, max: 9999999999 });

      assertDocNumber(doc.from, 'from', loc);
      assertDocNumber(doc.to, 'to', loc);

      if (doc.totnum - doc.cancel !== doc.net_issue) {
        fail(
          `GSTR-1 Schema Error (${loc}): document arithmetic invalid — totnum(${doc.totnum}) − cancel(${doc.cancel}) `
          + `must equal net_issue(${doc.net_issue}).`
        );
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Normalizer — legacy / third-party JSON pre-processor                       */
/* -------------------------------------------------------------------------- */

function stripIllegalChksum(node) {
  if (Array.isArray(node)) {
    return node.map(stripIllegalChksum);
  }
  if (node && typeof node === 'object') {
    delete node.chksum;
    for (const key of Object.keys(node)) {
      node[key] = stripIllegalChksum(node[key]);
    }
  }
  return node;
}

/**
 * Normalizes legacy or third-party GSTR-1 JSON into official GSTN schema shape:
 * - Recursively removes illegal 'chksum' properties from save payload
 * - Normalizes doc_issue 'canc' → 'cancel'
 * - Normalizes hsn_b2b / hsn_b2c → 'data' array and deletes legacy keys
 * - Normalizes user_desc → desc and deletes user_desc
 * - Normalizes flag strings to uppercase
 * - Trims strings and object keys
 */
function normalizeGstr1Payload(payload, { trimStrings = true } = {}) {
  if (!payload || typeof payload !== 'object') return payload;

  const walk = (node) => {
    if (typeof node === 'string') return trimStrings ? node.trim() : node;
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        const key = trimStrings ? k.trim() : k;
        let value = walk(v);
        if (key === 'flag' && typeof value === 'string') {
          value = value.trim().toUpperCase();
        }
        out[key] = value;
      }
      return out;
    }
    return node;
  };

  const p = stripIllegalChksum(walk(payload));

  // canc → cancel
  const detList = p.doc_issue?.doc_det;
  if (Array.isArray(detList)) {
    for (const det of detList) {
      if (!Array.isArray(det?.docs)) continue;
      for (const doc of det.docs) {
        if (!doc || typeof doc !== 'object') continue;
        if (doc.canc !== undefined) {
          if (doc.cancel === undefined) doc.cancel = doc.canc;
          delete doc.canc;
        }
      }
    }
  }

  // hsn_b2b / hsn_b2c → data array and delete legacy keys
  if (p.hsn && typeof p.hsn === 'object') {
    if (!Array.isArray(p.hsn.data) && (Array.isArray(p.hsn.hsn_b2b) || Array.isArray(p.hsn.hsn_b2c))) {
      const combined = [...(p.hsn.hsn_b2b || []), ...(p.hsn.hsn_b2c || [])];
      p.hsn.data = combined.map((row, idx) => {
        const r = { ...row, num: idx + 1 };
        if (r.user_desc !== undefined && !r.desc) {
          r.desc = r.user_desc;
        }
        delete r.user_desc;
        return r;
      });
    }
    delete p.hsn.hsn_b2b;
    delete p.hsn.hsn_b2c;
  }

  return p;
}

/* -------------------------------------------------------------------------- */
/* Main Entry                                                                 */
/* -------------------------------------------------------------------------- */

function validateGstr1Schema(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Invalid GSTR-1 payload: must be a valid JSON object.');
  }

  assertOnlyKeys(payload, [
    'gstin', 'fp', 'gt', 'cur_gt', 'hash', 'version', 'b2b', 'b2ba', 'b2cl',
    'b2cla', 'b2cs', 'b2csa', 'cdnr', 'cdnra', 'cdnur', 'cdnura', 'nil', 'exp',
    'expa', 'at', 'ata', 'txpd', 'txpda', 'supeco', 'supecoa', 'ecom', 'ecoma',
    'hsn', 'doc_issue',
  ], 'root');

  if (!payload.gstin || !isValidGstin(payload.gstin)) {
    fail(`Invalid GSTR-1 payload: 'gstin' must be a valid 15-character GSTIN. Received: ${payload.gstin}`);
  }
  if (typeof payload.fp !== 'string' || !FP_RE.test(payload.fp)) {
    fail(`Invalid GSTR-1 payload: 'fp' must be MMYYYY (e.g. "102026"). Received: ${payload.fp}`);
  }

  // gt and cur_gt: optional in root schema (required is only ['gstin', 'fp'])
  // If present: non-negative finite numbers up to 1000000000000000, multipleOf 0.01
  assertOptionalNumber(payload.gt, 'gt', 'root', { allowNegative: false, max: 1000000000000000, multipleOf01: true });
  assertOptionalNumber(payload.cur_gt, 'cur_gt', 'root', { allowNegative: false, max: 1000000000000000, multipleOf01: true });

  if (payload.version !== undefined) assertString(payload.version, 'version', 'root', { maxLen: 20, required: false });
  if (payload.hash !== undefined) assertString(payload.hash, 'hash', 'root', { maxLen: 128, required: false });

  // Regular sections with array type checking when present
  validateB2B(payload.b2b, 'Table 4 B2B');
  validateB2CL(payload.b2cl, 'Table 5 B2CL');
  validateB2CS(payload.b2cs, 'Table 7 B2CS');
  validateNil(payload.nil);
  validateNotes(payload.cdnr, { label: 'Table 9B CDNR' });
  validateNotes(payload.cdnur, { unregistered: true, label: 'Table 9C CDNUR' });
  validateExp(payload.exp, 'Table 6A EXP');

  // Amendment sections safety guard
  const UNSUPPORTED_AMENDMENT_KEYS = ['b2ba', 'b2cla', 'b2csa', 'cdnra', 'cdnura', 'expa'];
  for (const key of UNSUPPORTED_AMENDMENT_KEYS) {
    if (payload[key] !== undefined) {
      fail(`GSTR-1 Schema Error (root): amendment section '${key}' is present but not supported in regular filing. Use amendment-specific workflow.`);
    }
  }

  // Advance / tax-payment arrays guard
  for (const key of ['at', 'ata', 'txpd', 'txpda']) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) {
      fail(`GSTR-1 Schema Error (root): '${key}' must be an array when present.`);
    }
  }

  // E-commerce objects guard (supeco, supecoa, ecom, ecoma are objects in schema, not arrays)
  for (const key of ['supeco', 'supecoa', 'ecom', 'ecoma']) {
    if (payload[key] !== undefined) {
      if (typeof payload[key] !== 'object' || Array.isArray(payload[key])) {
        fail(`GSTR-1 Schema Error (root): '${key}' must be an object when present.`);
      }
    }
  }

  validateHsn(payload.hsn);
  validateDocIssue(payload.doc_issue);

  return true;
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
  Gstr1ValidationError,
};
