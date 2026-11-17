const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { isValidGstin, isValidPeriod } = require('../utils/gstin');
const { isLiveFilingEnabled } = require('../utils/filingMode');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

// IST-aware month boundaries (GST_TZ_OFFSET_MIN=330 for India, UTC+05:30)
const TZ_OFFSET_MIN = Number(process.env.GST_TZ_OFFSET_MIN || 330);
const TZ_OFFSET_MS = TZ_OFFSET_MIN * 60 * 1000;

// Allowlist-based finalized status. If env is not set, fallback to exclusion list.
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
  : { $nin: EXCLUDED_DOCUMENT_STATUSES };

const ACTIVE_STATUS_SET = new Set(ACTIVE_STATUS_LIST.map((s) => s.toLowerCase()));
const EXCLUDED_STATUS_SET = new Set(EXCLUDED_DOCUMENT_STATUSES.map((s) => s.toLowerCase()));

// Some GSTN sandboxes allow negative summary values due to credit notes.
// Default is conservative: block negative statutory payload values.
const ALLOW_NEGATIVE_3B_VALUES =
  String(process.env.GST_3B_ALLOW_NEGATIVE_VALUES || 'false').toLowerCase() === 'true';

// Negative ITC buckets are usually data-quality issues. Default: clamp to 0 with warning.
const CLAMP_NEGATIVE_ITC =
  String(process.env.GST_3B_CLAMP_NEGATIVE_ITC || 'true').toLowerCase() === 'true';

const GSTIN_REGEX = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}[Zz1-9A-Ja-j]{1}[0-9A-Za-z]{1}$/;

const UIN_REGEX = new RegExp(
  '^(' +
  '[0-9]{4}[A-Za-z]{3}[0-9]{5}[UO]N[A-Za-z0-9]|' +
  '[0-9]{4}[A-Za-z]{3}[0-9]{5}NR[A-Za-z0-9]|' +
  '[0-9]{2}[A-Za-z]{4}[A-Za-z0-9]{1}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}D[0-9A-Za-z]' +
  ')$'
);

const STATE_CD_REGEX = /^(0[1-9]|[12][0-9]|3[0-8]|9[67])$/;

/* -------------------------------------------------------------------------- */
/* GSTR-3B schema constants                                                   */
/* -------------------------------------------------------------------------- */

const GSTR3B_ROOT_KEYS = [
  'gstin',
  'ret_period',
  'sup_details',
  'inter_sup',
  'eco_dtls',
  'itc_elg',
  'inward_sup',
  'tx_pmt',
  'intr_ltfee',
  'liab_breakup'
];

const SUP_DETAILS_KEYS = [
  'osup_det',
  'osup_zero',
  'osup_nil_exmp',
  'isup_rev',
  'osup_nongst'
];

const OSUP_DET_KEYS = ['txval', 'iamt', 'camt', 'samt', 'csamt'];
const OSUP_ZERO_KEYS = ['txval', 'iamt', 'csamt'];
const OSUP_NIL_EXMP_KEYS = ['txval'];
const ISUP_REV_KEYS = ['txval', 'iamt', 'camt', 'samt', 'csamt'];
const OSUP_NONGST_KEYS = ['txval'];

const INTER_SUP_KEYS = ['comp_details', 'uin_details', 'unreg_details'];
const INTER_ROW_KEYS = ['pos', 'txval', 'iamt', 'csamt'];

const ITC_ELG_KEYS = ['itc_avl', 'itc_rev', 'itc_inelg', 'itc_net'];
const ITC_AMOUNT_KEYS = ['iamt', 'camt', 'samt', 'csamt'];

const ITC_AVL_TYPES = ['IMPG', 'IMPS', 'ISRC', 'ISD', 'OTH'];
const ITC_REV_TYPES = ['RUL', 'OTH'];
const ITC_INELG_TYPES = ['RUL', 'OTH'];

const TX_PMT_KEYS = [
  'trans_typ',
  'trans_desc',
  'liab_ldg_id',
  'igst',
  'cgst',
  'sgst',
  'cess'
];

const TX_HEAD_KEYS = ['tx', 'intr', 'fee'];
const TX_LEDGER_IDS = new Set([30002, 30003]);

const INWARD_SUP_KEYS = ['isup_details'];
const INTR_LTFEE_KEYS = ['intr_details'];
const INTR_DETAIL_KEYS = ['iamt', 'camt', 'samt', 'csamt'];

const OFFSET_ROOT_KEYS = ['pdcash', 'pditc', 'pdnls'];

const PDCASH_KEYS = [
  'liab_ldg_id',
  'trans_typ',
  'ipd',
  'cpd',
  'spd',
  'cspd',
  'i_intrpd',
  'c_intrpd',
  's_intrpd',
  'cs_intrpd',
  'c_lfeepd',
  's_lfeepd'
];

const PDITC_KEYS = [
  'liab_ldg_id',
  'trans_typ',
  'i_pdi',
  'i_pdc',
  'i_pds',
  'c_pdi',
  'c_pdc',
  's_pdi',
  's_pds',
  'cs_pdcs'
];

const PDNLS_KEYS = PDCASH_KEYS;

const MAX_3B_AMOUNT = 9999999999999.99;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function safeErrorMessage(error) {
  if (!error) return 'unknown';

  const msg = typeof error.message === 'string' ? error.message : '';

  return msg
    .replace(/https?:\/\/\S+/gi, '[URL_REDACTED]')
    .replace(
      /(password|token|secret|authtoken|auth-token|OTP|sid|sign|aspid)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]'
    )
    .slice(0, 220) || 'unknown';
}

function fail(message) {
  throw ApiError.validationError(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function round2(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;

  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function fmt(v) {
  return round2(v);
}

function posNum(v) {
  return Math.abs(round2(v));
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

function normalizeAmount(
  value,
  label,
  {
    allowNegative = false,
    clampNegative = false,
    warnings = null,
    min = null,
    max = null,
    multipleOf01 = true
  } = {}
) {
  let n = round2(value);

  if (!Number.isFinite(n)) {
    fail(`${label} must be a finite number. Received: ${value}`);
  }

  if (multipleOf01 && !isMultipleOf01(n)) {
    fail(`${label} must be a multiple of 0.01. Received: ${n}`);
  }

  if (min !== null && n < min) {
    fail(`${label} must be >= ${min}. Received: ${n}`);
  }

  if (max !== null && n > max) {
    fail(`${label} exceeds maximum ${max}. Received: ${n}`);
  }

  if (n < 0) {
    if (allowNegative) return n;

    if (clampNegative) {
      if (warnings) {
        warnings.push(`${label} was negative (${n}); clamped to 0.`);
      }
      return 0;
    }

    fail(
      `${label} is negative (${n}). Negative GSTR-3B values are blocked by default. ` +
      'Adjust credit/debit notes or set GST_3B_ALLOW_NEGATIVE_VALUES=true only after confirming GSTN sandbox accepts negative values.'
    );
  }

  return n;
}

function money(value, label, opts = {}) {
  return normalizeAmount(value, label, {
    allowNegative: opts.allowNegative ?? ALLOW_NEGATIVE_3B_VALUES,
    ...opts
  });
}

function nonNegative(value) {
  return Math.max(0, round2(value));
}

function assertOnlyKeys(value, allowedKeys, location) {
  if (value === undefined || value === null) return;

  if (!isPlainObject(value)) {
    fail(`GSTR-3B Schema Error (${location}): must be a JSON object.`);
  }

  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((k) => !allowed.has(k));

  if (unexpected) {
    fail(
      `GSTR-3B Schema Error (${location}): '${unexpected}' is not an allowed field. ` +
      `Allowed: ${allowedKeys.join(', ')}`
    );
  }
}

function assertArrayIfPresent(list, location) {
  if (list === undefined) return false;

  if (!Array.isArray(list)) {
    fail(`GSTR-3B Schema Error (${location}): must be an array when present.`);
  }

  return true;
}

function assertObjectIfPresent(obj, location) {
  if (obj === undefined) return false;

  if (!isPlainObject(obj)) {
    fail(`GSTR-3B Schema Error (${location}): must be an object when present.`);
  }

  return true;
}

function assertPayloadNumber(
  val,
  field,
  location,
  {
    required = true,
    allowNegative = ALLOW_NEGATIVE_3B_VALUES,
    integer = false,
    max = MAX_3B_AMOUNT
  } = {}
) {
  if (val === undefined || val === null) {
    if (required) {
      fail(`GSTR-3B Schema Error (${location}): '${field}' is mandatory.`);
    }
    return;
  }

  if (typeof val !== 'number' || !Number.isFinite(val)) {
    fail(`GSTR-3B Schema Error (${location}): '${field}' must be a finite number. Received: ${val}`);
  }

  if (integer && !Number.isInteger(val)) {
    fail(`GSTR-3B Schema Error (${location}): '${field}' must be an integer. Received: ${val}`);
  }

  if (!integer && !isMultipleOf01(val)) {
    fail(`GSTR-3B Schema Error (${location}): '${field}' must be a multiple of 0.01. Received: ${val}`);
  }

  if (!allowNegative && val < 0) {
    fail(`GSTR-3B Schema Error (${location}): '${field}' must be >= 0. Received: ${val}`);
  }

  if (max !== null && val > max) {
    fail(`GSTR-3B Schema Error (${location}): '${field}' exceeds maximum ${max}. Received: ${val}`);
  }
}

function assertPos(val, location) {
  const s = typeof val === 'string' ? val : String(val ?? '');

  if (!STATE_CD_REGEX.test(s)) {
    fail(`GSTR-3B Schema Error (${location}): invalid Place of Supply '${val}'.`);
  }
}

function periodRangeIST(period) {
  const month = parseInt(period.slice(0, 2), 10);
  const year = parseInt(period.slice(2), 10);

  return {
    startDate: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - TZ_OFFSET_MS),
    endDate: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - TZ_OFFSET_MS - 1)
  };
}

function isFinalizedStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return false;

  if (ACTIVE_STATUS_SET.size) {
    return ACTIVE_STATUS_SET.has(s);
  }

  return !EXCLUDED_STATUS_SET.has(s);
}

function isFinalizedDoc(doc) {
  return isFinalizedStatus(doc?.status);
}

// Sales: credit note reduces outward supply; debit note increases it.
function signOfInvoice(inv) {
  const type = String(inv?.documentType || inv?.invoiceType || '').toUpperCase();
  return type.includes('CREDIT') ? -1 : 1;
}

// Purchases: credit note reduces ITC/liability; debit note increases it.
function signOfBill(b) {
  const type = String(b?.documentType || b?.billType || '').toUpperCase();
  return type.includes('CREDIT') ? -1 : 1;
}

function getModelPaths(model) {
  return model?.schema?.paths || {};
}

function buildInvoiceFilter(workspaceId, gstin, range) {
  const filter = {
    workspaceId,
    invoiceDate: { $gte: range.startDate, $lte: range.endDate },
    status: FINALIZED_STATUS_QUERY
  };

  const paths = getModelPaths(Invoice);

  if (paths.supplierGstin) {
    filter.supplierGstin = gstin;
  } else if (paths.gstin) {
    filter.gstin = gstin;
  }

  return filter;
}

function buildBillFilter(workspaceId, gstin, range) {
  const filter = {
    workspaceId,
    billDate: { $gte: range.startDate, $lte: range.endDate },
    status: FINALIZED_STATUS_QUERY
  };

  const paths = getModelPaths(Bill);

  // For purchase bills, workspace GSTIN is usually buyer/recipient GSTIN.
  // Do not filter by supplierGstin because that is vendor GSTIN.
  if (paths.gstin) {
    filter.gstin = gstin;
  } else if (paths.buyerGstin) {
    filter.buyerGstin = gstin;
  } else if (paths.recipientGstin) {
    filter.recipientGstin = gstin;
  }

  return filter;
}

function getInvoiceTaxable(inv) {
  return Number(inv?.subTotal ?? inv?.totalTaxable ?? inv?.taxableValue ?? 0);
}

function getInvoiceIgst(inv) {
  return Number(inv?.totalIgst ?? inv?.igstAmount ?? inv?.igst ?? 0);
}

function getInvoiceCgst(inv) {
  return Number(inv?.totalCgst ?? inv?.cgstAmount ?? inv?.cgst ?? 0);
}

function getInvoiceSgst(inv) {
  return Number(inv?.totalSgst ?? inv?.sgstAmount ?? inv?.sgst ?? 0);
}

function getInvoiceCess(inv) {
  return Number(inv?.totalCess ?? inv?.cessAmount ?? inv?.cess ?? 0);
}

function getBillTaxable(b) {
  return Number(b?.subTotal ?? b?.taxableAmount ?? b?.totalTaxable ?? 0);
}

function getBillIgst(b) {
  return Number(b?.totalIgst ?? b?.igstAmount ?? b?.igst ?? 0);
}

function getBillCgst(b) {
  return Number(b?.totalCgst ?? b?.cgstAmount ?? b?.cgst ?? 0);
}

function getBillSgst(b) {
  return Number(b?.totalSgst ?? b?.sgstAmount ?? b?.sgst ?? 0);
}

function getBillCess(b) {
  return Number(b?.totalCess ?? b?.cessAmount ?? b?.cess ?? 0);
}

function isZeroRatedSupply(inv) {
  const flags = [inv?.isExport, inv?.isSez, inv?.zeroRated].some(Boolean);
  const type = String(inv?.exportType || inv?.supplyType || inv?.category || '').toUpperCase();

  return flags || ['WPAY', 'WOPAY', 'EXPORT', 'SEZ', 'ZERO_RATED'].includes(type);
}

function getPos(inv, supplierState) {
  let pos = inv?.pos ? String(inv.pos).trim().padStart(2, '0') : '';

  if (!pos) {
    const ctin = String(inv?.customerGstin || inv?.buyerGstin || '').trim().toUpperCase();
    if (GSTIN_REGEX.test(ctin) || UIN_REGEX.test(ctin)) {
      pos = ctin.slice(0, 2);
    }
  }

  if (!pos || !STATE_CD_REGEX.test(pos) || pos === supplierState) return null;
  return pos;
}

function getCustomerClass(inv) {
  const ctin = String(inv?.customerGstin || inv?.buyerGstin || '').trim().toUpperCase();
  const type = String(inv?.customerType || inv?.partyType || inv?.buyerType || '').toUpperCase();

  if (!ctin || ctin === 'URP' || type.includes('UNREG')) return 'UNREG';
  if (UIN_REGEX.test(ctin) || type.includes('UIN') || type.includes('GOVT') || type.includes('GOVERN') || inv?.isUin) return 'UIN';
  if (type.includes('COMP') || inv?.isCompositionDealer) return 'COMP';
  if (isValidGstin(ctin)) return 'REG';

  return 'UNREG';
}

function emptyItcBucket() {
  return { iamt: 0, camt: 0, samt: 0, csamt: 0 };
}

function addItc(target, ty, vals) {
  if (!target[ty]) target[ty] = emptyItcBucket();

  target[ty].iamt += Number(vals.iamt || 0);
  target[ty].camt += Number(vals.camt || 0);
  target[ty].samt += Number(vals.samt || 0);
  target[ty].csamt += Number(vals.csamt || 0);
}

function getItcCategory(b) {
  if (b?.isReverseCharge) return 'ISRC';

  const cat = String(b?.itcCategory || b?.taxCategory || b?.billCategory || '').toUpperCase();

  if (['IMPG', 'IMPORT_GOODS', 'GOODS_IMPORT'].includes(cat) || b?.isImportGoods) return 'IMPG';
  if (['IMPS', 'IMPORT_SERVICE', 'SERVICE_IMPORT'].includes(cat) || b?.isImportServices || b?.isImportService) return 'IMPS';
  if (['ISD'].includes(cat) || b?.isIsd) return 'ISD';

  return 'OTH';
}

function isIneligibleBill(b) {
  return (
    b?.itcEligible === false ||
    b?.itcIneligible === true ||
    String(b?.blockedCredit || '').toUpperCase() === 'Y'
  );
}

function isReversalBill(b) {
  return (
    b?.itcReversal === true ||
    String(b?.reversalType || '').toUpperCase() === 'RUL'
  );
}

function isRuleBlockedBill(b) {
  return (
    String(b?.blockedReason || b?.ineligibleReason || '').toUpperCase().includes('RULE') ||
    b?.blockedByRule === true
  );
}

function addToInterMap(map, pos, vals) {
  if (!pos) return;

  const current = map.get(pos) || { txval: 0, iamt: 0, csamt: 0 };

  current.txval += Number(vals.txval || 0);
  current.iamt += Number(vals.iamt || 0);
  current.csamt += Number(vals.csamt || 0);

  map.set(pos, current);
}

function interMapToArray(map, warnings) {
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([pos, data]) => ({
      pos,
      txval: money(data.txval, `Table 3.2 taxable value for POS ${pos}`, { warnings }),
      iamt: money(data.iamt, `Table 3.2 IGST for POS ${pos}`, { warnings }),
      csamt: money(data.csamt, `Table 3.2 cess for POS ${pos}`, { warnings })
    }));
}

function hasPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function objectHasPositiveAmount(obj, ignoreKeys = new Set(['liab_ldg_id', 'trans_typ', 'trans_desc'])) {
  if (!obj || typeof obj !== 'object') return false;

  return Object.entries(obj).some(([key, val]) => {
    if (ignoreKeys.has(key)) return false;
    if (val && typeof val === 'object') return objectHasPositiveAmount(val, ignoreKeys);
    return hasPositiveNumber(val);
  });
}

function hasOffsetPaymentDetails(body) {
  if (!body || typeof body !== 'object') return false;

  const pdcashHasAmount =
    Array.isArray(body.pdcash) &&
    body.pdcash.some((entry) => objectHasPositiveAmount(entry));

  const pditcHasAmount =
    body.pditc && typeof body.pditc === 'object' &&
    objectHasPositiveAmount(body.pditc);

  const pdnlsHasAmount =
    Array.isArray(body.pdnls) &&
    body.pdnls.some((entry) => objectHasPositiveAmount(entry));

  return pdcashHasAmount || pditcHasAmount || pdnlsHasAmount;
}

function normalizeItcBucket(bucket, label, warnings) {
  const out = emptyItcBucket();

  for (const key of ITC_AMOUNT_KEYS) {
    out[key] = normalizeAmount(bucket?.[key] || 0, `${label}.${key}`, {
      allowNegative: ALLOW_NEGATIVE_3B_VALUES,
      clampNegative: CLAMP_NEGATIVE_ITC && !ALLOW_NEGATIVE_3B_VALUES,
      warnings
    });
  }

  return out;
}

function sumItcBucket(bucket) {
  return {
    iamt: round2(bucket.iamt || 0),
    camt: round2(bucket.camt || 0),
    samt: round2(bucket.samt || 0),
    csamt: round2(bucket.csamt || 0)
  };
}

function subtractItcBuckets(a, b) {
  return {
    iamt: round2((a.iamt || 0) - (b.iamt || 0)),
    camt: round2((a.camt || 0) - (b.camt || 0)),
    samt: round2((a.samt || 0) - (b.samt || 0)),
    csamt: round2((a.csamt || 0) - (b.csamt || 0))
  };
}

function clampItcBucketNegative(bucket, label, warnings) {
  const out = emptyItcBucket();

  for (const key of ITC_AMOUNT_KEYS) {
    let v = round2(bucket[key]);

    if (v < 0) {
      if (ALLOW_NEGATIVE_3B_VALUES) {
        out[key] = v;
      } else {
        warnings.push(`${label}.${key} net ITC became negative (${v}); clamped to 0.`);
        out[key] = 0;
      }
    } else {
      out[key] = v;
    }
  }

  return out;
}

function totalItcHead(bucket, head) {
  return round2(bucket[head] || 0);
}

function totalItcAll(bucket) {
  return round2(
    (bucket.iamt || 0) +
    (bucket.camt || 0) +
    (bucket.samt || 0) +
    (bucket.csamt || 0)
  );
}

async function writeAudit(entry) {
  try {
    await AuditLog.create(entry);
  } catch (e) {
    logger.error('AuditLog write failed in GSTR-3B service', {
      action: entry?.action,
      reason: safeErrorMessage(e)
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Validators                                                                 */
/* -------------------------------------------------------------------------- */

function validateGstr3bSupDetails(supDetails) {
  assertObjectIfPresent(supDetails, 'sup_details');
  assertOnlyKeys(supDetails, SUP_DETAILS_KEYS, 'sup_details');

  const osupDet = supDetails.osup_det;
  assertObjectIfPresent(osupDet, 'sup_details.osup_det');
  assertOnlyKeys(osupDet, OSUP_DET_KEYS, 'sup_details.osup_det');

  for (const key of OSUP_DET_KEYS) {
    assertPayloadNumber(osupDet[key], key, 'sup_details.osup_det');
  }

  const osupZero = supDetails.osup_zero;
  assertObjectIfPresent(osupZero, 'sup_details.osup_zero');
  assertOnlyKeys(osupZero, OSUP_ZERO_KEYS, 'sup_details.osup_zero');

  for (const key of OSUP_ZERO_KEYS) {
    assertPayloadNumber(osupZero[key], key, 'sup_details.osup_zero');
  }

  const osupNil = supDetails.osup_nil_exmp;
  assertObjectIfPresent(osupNil, 'sup_details.osup_nil_exmp');
  assertOnlyKeys(osupNil, OSUP_NIL_EXMP_KEYS, 'sup_details.osup_nil_exmp');
  assertPayloadNumber(osupNil.txval, 'txval', 'sup_details.osup_nil_exmp');

  const isupRev = supDetails.isup_rev;
  assertObjectIfPresent(isupRev, 'sup_details.isup_rev');
  assertOnlyKeys(isupRev, ISUP_REV_KEYS, 'sup_details.isup_rev');

  for (const key of ISUP_REV_KEYS) {
    assertPayloadNumber(isupRev[key], key, 'sup_details.isup_rev');
  }

  const osupNonGst = supDetails.osup_nongst;
  assertObjectIfPresent(osupNonGst, 'sup_details.osup_nongst');
  assertOnlyKeys(osupNonGst, OSUP_NONGST_KEYS, 'sup_details.osup_nongst');
  assertPayloadNumber(osupNonGst.txval, 'txval', 'sup_details.osup_nongst');
}

function validateInterSup(interSup) {
  if (interSup === undefined) return;

  assertObjectIfPresent(interSup, 'inter_sup');
  assertOnlyKeys(interSup, INTER_SUP_KEYS, 'inter_sup');

  for (const key of INTER_SUP_KEYS) {
    const list = interSup[key];
    if (list === undefined) continue;

    if (!assertArrayIfPresent(list, `inter_sup.${key}`)) continue;

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const loc = `inter_sup.${key} row #${i + 1}`;

      if (!isPlainObject(row)) {
        fail(`GSTR-3B Schema Error (${loc}): must be an object.`);
      }

      assertOnlyKeys(row, INTER_ROW_KEYS, loc);
      assertPos(row.pos, loc);

      for (const field of ['txval', 'iamt', 'csamt']) {
        assertPayloadNumber(row[field], field, loc);
      }
    }
  }
}

function validateItcElg(itcElg) {
  assertObjectIfPresent(itcElg, 'itc_elg');
  assertOnlyKeys(itcElg, ITC_ELG_KEYS, 'itc_elg');

  const availList = itcElg.itc_avl;
  if (!Array.isArray(availList) || availList.length === 0) {
    fail('GSTR-3B Schema Error (itc_elg.itc_avl): must be a non-empty array.');
  }

  const availMap = new Map();

  for (let i = 0; i < availList.length; i++) {
    const row = availList[i];
    const loc = `itc_elg.itc_avl row #${i + 1}`;

    if (!isPlainObject(row)) {
      fail(`GSTR-3B Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(row, ['ty', ...ITC_AMOUNT_KEYS], loc);

    if (!ITC_AVL_TYPES.includes(row.ty)) {
      fail(`GSTR-3B Schema Error (${loc}): invalid itc_avl ty '${row.ty}'.`);
    }

    if (availMap.has(row.ty)) {
      fail(`GSTR-3B Schema Error (${loc}): duplicate itc_avl ty '${row.ty}'.`);
    }

    availMap.set(row.ty, row);

    for (const key of ITC_AMOUNT_KEYS) {
      assertPayloadNumber(row[key], key, loc);
    }
  }

  for (const ty of ITC_AVL_TYPES) {
    if (!availMap.has(ty)) {
      fail(`GSTR-3B Schema Error (itc_elg.itc_avl): missing mandatory ty '${ty}'.`);
    }
  }

  const revList = itcElg.itc_rev;
  if (!Array.isArray(revList) || revList.length === 0) {
    fail('GSTR-3B Schema Error (itc_elg.itc_rev): must be a non-empty array.');
  }

  const revMap = new Map();

  for (let i = 0; i < revList.length; i++) {
    const row = revList[i];
    const loc = `itc_elg.itc_rev row #${i + 1}`;

    if (!isPlainObject(row)) {
      fail(`GSTR-3B Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(row, ['ty', ...ITC_AMOUNT_KEYS], loc);

    if (!ITC_REV_TYPES.includes(row.ty)) {
      fail(`GSTR-3B Schema Error (${loc}): invalid itc_rev ty '${row.ty}'.`);
    }

    if (revMap.has(row.ty)) {
      fail(`GSTR-3B Schema Error (${loc}): duplicate itc_rev ty '${row.ty}'.`);
    }

    revMap.set(row.ty, row);

    for (const key of ITC_AMOUNT_KEYS) {
      assertPayloadNumber(row[key], key, loc);
    }
  }

  for (const ty of ITC_REV_TYPES) {
    if (!revMap.has(ty)) {
      fail(`GSTR-3B Schema Error (itc_elg.itc_rev): missing mandatory ty '${ty}'.`);
    }
  }

  const inelgList = itcElg.itc_inelg;
  if (!Array.isArray(inelgList) || inelgList.length === 0) {
    fail('GSTR-3B Schema Error (itc_elg.itc_inelg): must be a non-empty array.');
  }

  const inelgMap = new Map();

  for (let i = 0; i < inelgList.length; i++) {
    const row = inelgList[i];
    const loc = `itc_elg.itc_inelg row #${i + 1}`;

    if (!isPlainObject(row)) {
      fail(`GSTR-3B Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(row, ['ty', ...ITC_AMOUNT_KEYS], loc);

    if (!ITC_INELG_TYPES.includes(row.ty)) {
      fail(`GSTR-3B Schema Error (${loc}): invalid itc_inelg ty '${row.ty}'.`);
    }

    if (inelgMap.has(row.ty)) {
      fail(`GSTR-3B Schema Error (${loc}): duplicate itc_inelg ty '${row.ty}'.`);
    }

    inelgMap.set(row.ty, row);

    for (const key of ITC_AMOUNT_KEYS) {
      assertPayloadNumber(row[key], key, loc);
    }
  }

  for (const ty of ITC_INELG_TYPES) {
    if (!inelgMap.has(ty)) {
      fail(`GSTR-3B Schema Error (itc_elg.itc_inelg): missing mandatory ty '${ty}'.`);
    }
  }

  const net = itcElg.itc_net;
  assertObjectIfPresent(net, 'itc_elg.itc_net');
  assertOnlyKeys(net, ITC_AMOUNT_KEYS, 'itc_elg.itc_net');

  for (const key of ITC_AMOUNT_KEYS) {
    assertPayloadNumber(net[key], key, 'itc_elg.itc_net');
  }

  // Statutory consistency: net ITC = available - reversed, floored at 0.
  for (const head of ITC_AMOUNT_KEYS) {
    const gross = round2(
      Array.from(availMap.values()).reduce((sum, row) => sum + Number(row[head] || 0), 0)
    );

    const reversed = round2(
      Array.from(revMap.values()).reduce((sum, row) => sum + Number(row[head] || 0), 0)
    );

    const expected = Math.max(0, round2(gross - reversed));
    const actual = round2(net[head]);

    if (Math.abs(actual - expected) > 0.005) {
      fail(
        `GSTR-3B Schema Error (itc_elg.itc_net.${head}): expected ${expected} ` +
        `(available ${gross} - reversed ${reversed}), received ${actual}.`
      );
    }
  }
}

function validateTxPmt(txPmt) {
  if (txPmt === undefined) return;

  if (!assertArrayIfPresent(txPmt, 'tx_pmt')) return;

  for (let i = 0; i < txPmt.length; i++) {
    const row = txPmt[i];
    const loc = `tx_pmt row #${i + 1}`;

    if (!isPlainObject(row)) {
      fail(`GSTR-3B Schema Error (${loc}): must be an object.`);
    }

    assertOnlyKeys(row, TX_PMT_KEYS, loc);

    const ledger = Number(row.liab_ldg_id);
    const trans = Number(row.trans_typ);

    if (!TX_LEDGER_IDS.has(ledger) || !TX_LEDGER_IDS.has(trans)) {
      fail(`GSTR-3B Schema Error (${loc}): liab_ldg_id/trans_typ must be 30002 or 30003.`);
    }

    if (ledger !== trans) {
      fail(`GSTR-3B Schema Error (${loc}): liab_ldg_id and trans_typ must match.`);
    }

    for (const head of ['igst', 'cgst', 'sgst', 'cess']) {
      const obj = row[head];
      const headLoc = `${loc}.${head}`;

      if (!isPlainObject(obj)) {
        fail(`GSTR-3B Schema Error (${headLoc}): must be an object.`);
      }

      assertOnlyKeys(obj, TX_HEAD_KEYS, headLoc);

      for (const key of TX_HEAD_KEYS) {
        assertPayloadNumber(obj[key], key, headLoc);
      }
    }
  }
}

function validateIntrLtfee(intrLtfee) {
  if (intrLtfee === undefined) return;

  assertObjectIfPresent(intrLtfee, 'intr_ltfee');
  assertOnlyKeys(intrLtfee, INTR_LTFEE_KEYS, 'intr_ltfee');

  const details = intrLtfee.intr_details;
  assertObjectIfPresent(details, 'intr_ltfee.intr_details');
  assertOnlyKeys(details, INTR_DETAIL_KEYS, 'intr_ltfee.intr_details');

  for (const key of INTR_DETAIL_KEYS) {
    assertPayloadNumber(details[key], key, 'intr_ltfee.intr_details');
  }
}

function validateInwardSup(inwardSup) {
  if (inwardSup === undefined) return;

  assertObjectIfPresent(inwardSup, 'inward_sup');
  assertOnlyKeys(inwardSup, INWARD_SUP_KEYS, 'inward_sup');

  if (inwardSup.isup_details !== undefined) {
    assertArrayIfPresent(inwardSup.isup_details, 'inward_sup.isup_details');
  }
}

function validateGstr3bPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Invalid GSTR-3B payload: must be a valid JSON object.');
  }

  assertOnlyKeys(payload, GSTR3B_ROOT_KEYS, 'GSTR-3B root');

  if (!payload.gstin || !isValidGstin(payload.gstin)) {
    fail(`Invalid GSTR-3B payload: 'gstin' must be a valid 15-character GSTIN. Received: ${payload.gstin}`);
  }

  if (!payload.ret_period || !isValidPeriod(payload.ret_period)) {
    fail(`Invalid GSTR-3B payload: 'ret_period' must be MMYYYY. Received: ${payload.ret_period}`);
  }

  validateGstr3bSupDetails(payload.sup_details);
  validateInterSup(payload.inter_sup);
  validateItcElg(payload.itc_elg);
  validateInwardSup(payload.inward_sup);
  validateTxPmt(payload.tx_pmt);
  validateIntrLtfee(payload.intr_ltfee);

  if (payload.eco_dtls !== undefined) {
    assertObjectIfPresent(payload.eco_dtls, 'eco_dtls');
  }

  if (payload.liab_breakup !== undefined) {
    assertObjectIfPresent(payload.liab_breakup, 'liab_breakup');
  }

  return true;
}

function validateOffsetPdcashEntry(row, loc) {
  if (!isPlainObject(row)) {
    fail(`GSTR-3B Offset Error (${loc}): must be an object.`);
  }

  assertOnlyKeys(row, PDCASH_KEYS, loc);

  const ledger = Number(row.liab_ldg_id);
  const trans = Number(row.trans_typ);

  if (!TX_LEDGER_IDS.has(ledger) || !TX_LEDGER_IDS.has(trans)) {
    fail(`GSTR-3B Offset Error (${loc}): liab_ldg_id/trans_typ must be 30002 or 30003.`);
  }

  if (ledger !== trans) {
    fail(`GSTR-3B Offset Error (${loc}): liab_ldg_id and trans_typ must match.`);
  }

  for (const key of [
    'ipd',
    'cpd',
    'spd',
    'cspd',
    'i_intrpd',
    'c_intrpd',
    's_intrpd',
    'cs_intrpd',
    'c_lfeepd',
    's_lfeepd'
  ]) {
    assertPayloadNumber(row[key], key, loc, { required: true });
  }
}

function validateOffsetPditc(pditc) {
  if (pditc === undefined) return;

  assertObjectIfPresent(pditc, 'pditc');
  assertOnlyKeys(pditc, PDITC_KEYS, 'pditc');

  const ledger = Number(pditc.liab_ldg_id);
  const trans = Number(pditc.trans_typ);

  if (ledger !== 30002 || trans !== 30002) {
    fail('GSTR-3B Offset Error (pditc): liab_ldg_id/trans_typ must be 30002.');
  }

  for (const key of [
    'i_pdi',
    'i_pdc',
    'i_pds',
    'c_pdi',
    'c_pdc',
    's_pdi',
    's_pds',
    'cs_pdcs'
  ]) {
    assertPayloadNumber(pditc[key], key, 'pditc', { required: true });
  }
}

function validateGstr3bOffsetPayload(body) {
  if (body === undefined || body === null) return true;

  if (!isPlainObject(body)) {
    fail('Invalid GSTR-3B offset payload: must be a valid JSON object.');
  }

  assertOnlyKeys(body, OFFSET_ROOT_KEYS, 'GSTR-3B offset root');

  if (body.pdcash !== undefined) {
    if (!Array.isArray(body.pdcash) || body.pdcash.length === 0) {
      fail('GSTR-3B Offset Error (pdcash): must be a non-empty array when present.');
    }

    for (let i = 0; i < body.pdcash.length; i++) {
      validateOffsetPdcashEntry(body.pdcash[i], `pdcash row #${i + 1}`);
    }
  }

  if (body.pditc !== undefined) {
    validateOffsetPditc(body.pditc);
  }

  if (body.pdnls !== undefined) {
    if (!Array.isArray(body.pdnls) || body.pdnls.length === 0) {
      fail('GSTR-3B Offset Error (pdnls): must be a non-empty array when present.');
    }

    for (let i = 0; i < body.pdnls.length; i++) {
      validateOffsetPdcashEntry(body.pdnls[i], `pdnls row #${i + 1}`);
    }
  }

  if (!hasOffsetPaymentDetails(body)) {
    fail('GSTR-3B Offset Error: offset payload must contain at least one positive payment/ITC utilization amount.');
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

class Gstr3bService {
  /**
   * Prepares GSTR-3B return payload, RETOFFSET payload, and financial summary.
   * Enforces Section 49(4) of the CGST Act (RCM liability is strictly 100% payable in cash).
   */
  static async preparePayload(workspaceId, gstin, period) {
    if (!workspaceId) throw ApiError.validationError('Active workspaceId is required to prepare GSTR-3B.');

    const normGstin = (gstin || '').trim().toUpperCase();
    if (!isValidGstin(normGstin)) throw ApiError.invalidGstin('Invalid GSTIN format.');
    if (!isValidPeriod(period)) throw ApiError.validationError('Invalid return period format. Must be MMYYYY.');

    const { startDate, endDate } = periodRangeIST(period);
    const supplierState = normGstin.slice(0, 2);

    const warnings = [];

    const invoicePaths = getModelPaths(Invoice);
    const billPaths = getModelPaths(Bill);

    if (!invoicePaths.gstin && !invoicePaths.supplierGstin) {
      warnings.push('Invoice model does not expose gstin/supplierGstin field. Workspace-level invoice filter may include multiple GSTINs if present.');
    }

    if (!billPaths.gstin && !billPaths.buyerGstin && !billPaths.recipientGstin) {
      warnings.push('Bill model does not expose buyer/recipient GSTIN field. Workspace-level bill filter may include multiple GSTINs if present.');
    }

    // 1. Fetch Outward Sales Invoices
    const invoices = await Invoice.find(
      buildInvoiceFilter(workspaceId, normGstin, { startDate, endDate })
    ).lean();

    const activeInvoices = invoices.filter(isFinalizedDoc);

    // Table 3.1 Outward Buckets
    let sup31a_txval = 0;
    let sup31a_iamt = 0;
    let sup31a_camt = 0;
    let sup31a_samt = 0;
    let sup31a_csamt = 0;

    let sup31b_txval = 0;
    let sup31b_iamt = 0;
    let sup31b_csamt = 0;

    let sup31c_txval = 0;
    let sup31e_txval = 0;

    // Table 3.2 buckets
    const interStateComp = new Map();
    const interStateUin = new Map();
    const interStateUnreg = new Map();

    activeInvoices.forEach((inv) => {
      const sign = signOfInvoice(inv);
      const zeroRated = isZeroRatedSupply(inv);

      let invoiceTaxableTxval = 0;
      let invoiceTaxableIamt = 0;
      let invoiceTaxableCsamt = 0;

      if (zeroRated) {
        const txval = sign * posNum(getInvoiceTaxable(inv));
        const iamt = sign * posNum(getInvoiceIgst(inv));
        const csamt = sign * posNum(getInvoiceCess(inv));

        sup31b_txval += txval;
        sup31b_iamt += iamt;
        sup31b_csamt += csamt;

        // Zero-rated exports/SEZ are not reported in Table 3.2 unreg/comp/UIN buckets here.
        return;
      }

      if (Array.isArray(inv.lineItems) && inv.lineItems.length > 0) {
        inv.lineItems.forEach((item) => {
          const pref = String(item.taxPreference || item.taxType || item.itemType || '').toUpperCase();
          const itemTxval = sign * posNum(item.taxableAmount ?? item.amount ?? item.taxableValue ?? 0);

          if (pref === 'EXEMPT' || pref === 'NIL' || pref === 'NIL_RATED') {
            sup31c_txval += itemTxval;
            return;
          }

          if (pref === 'NON_GST' || pref === 'NONGST' || pref === 'NON_GST_SUPPLY') {
            sup31e_txval += itemTxval;
            return;
          }

          const itemIamt = sign * posNum(item.igstAmount ?? item.igst ?? 0);
          const itemCamt = sign * posNum(item.cgstAmount ?? item.cgst ?? 0);
          const itemSamt = sign * posNum(item.sgstAmount ?? item.sgst ?? 0);
          const itemCsamt = sign * posNum(item.cessAmount ?? item.cess ?? 0);

          sup31a_txval += itemTxval;
          sup31a_iamt += itemIamt;
          sup31a_camt += itemCamt;
          sup31a_samt += itemSamt;
          sup31a_csamt += itemCsamt;

          invoiceTaxableTxval += itemTxval;
          invoiceTaxableIamt += itemIamt;
          invoiceTaxableCsamt += itemCsamt;
        });
      } else {
        const txval = sign * posNum(getInvoiceTaxable(inv));
        const iamt = sign * posNum(getInvoiceIgst(inv));
        const camt = sign * posNum(getInvoiceCgst(inv));
        const samt = sign * posNum(getInvoiceSgst(inv));
        const csamt = sign * posNum(getInvoiceCess(inv));

        sup31a_txval += txval;
        sup31a_iamt += iamt;
        sup31a_camt += camt;
        sup31a_samt += samt;
        sup31a_csamt += csamt;

        invoiceTaxableTxval = txval;
        invoiceTaxableIamt = iamt;
        invoiceTaxableCsamt = csamt;
      }

      // Table 3.2: Inter-state supplies to special categories
      const pos = getPos(inv, supplierState);
      if (!pos) return;

      if (invoiceTaxableTxval === 0 && invoiceTaxableIamt === 0) return;

      const customerClass = getCustomerClass(inv);
      const vals = {
        txval: invoiceTaxableTxval,
        iamt: invoiceTaxableIamt,
        csamt: invoiceTaxableCsamt
      };

      if (customerClass === 'COMP') {
        addToInterMap(interStateComp, pos, vals);
      } else if (customerClass === 'UIN') {
        addToInterMap(interStateUin, pos, vals);
      } else if (customerClass === 'UNREG') {
        addToInterMap(interStateUnreg, pos, vals);
      }
      // Regular registered interstate B2B is reported in GSTR-1, not forced into 3.2 buckets.
    });

    // 2. Fetch Inward Purchase Bills (Eligible ITC & RCM)
    const bills = await Bill.find(
      buildBillFilter(workspaceId, normGstin, { startDate, endDate })
    ).lean();

    const activeBills = bills.filter(isFinalizedDoc);

    const itcAvail = {
      IMPG: emptyItcBucket(),
      IMPS: emptyItcBucket(),
      ISRC: emptyItcBucket(),
      ISD: emptyItcBucket(),
      OTH: emptyItcBucket()
    };

    const itcRev = {
      RUL: emptyItcBucket(),
      OTH: emptyItcBucket()
    };

    const itcInelg = {
      RUL: emptyItcBucket(),
      OTH: emptyItcBucket()
    };

    let sup31d_txval = 0;
    let sup31d_iamt = 0;
    let sup31d_camt = 0;
    let sup31d_samt = 0;
    let sup31d_csamt = 0;

    activeBills.forEach((b) => {
      const sign = signOfBill(b);

      const txvalRaw = posNum(getBillTaxable(b));
      const iamtRaw = posNum(getBillIgst(b));
      const camtRaw = posNum(getBillCgst(b));
      const samtRaw = posNum(getBillSgst(b));
      const csamtRaw = posNum(getBillCess(b));

      const signedTxval = sign * txvalRaw;
      const signedIamt = sign * iamtRaw;
      const signedCamt = sign * camtRaw;
      const signedSamt = sign * samtRaw;
      const signedCsamt = sign * csamtRaw;

      const absVals = {
        iamt: iamtRaw,
        camt: camtRaw,
        samt: samtRaw,
        csamt: csamtRaw
      };

      // RCM liability is reported in Table 3.1(d). Credit notes reduce it.
      if (b.isReverseCharge) {
        sup31d_txval += signedTxval;
        sup31d_iamt += signedIamt;
        sup31d_camt += signedCamt;
        sup31d_samt += signedSamt;
        sup31d_csamt += signedCsamt;
      }

      if (isReversalBill(b)) {
        const ty = isRuleBlockedBill(b) ? 'RUL' : 'OTH';
        addItc(itcRev, ty, absVals);
        return;
      }

      if (isIneligibleBill(b)) {
        const ty = isRuleBlockedBill(b) ? 'RUL' : 'OTH';

        if (sign < 0) {
          warnings.push(
            `Ineligible purchase credit note ignored for ITC ineligible bucket: ${b?.billNumber || b?._id || 'unknown'}.`
          );
          return;
        }

        addItc(itcInelg, ty, absVals);
        return;
      }

      // Eligible purchase credit note should reduce net ITC, but GSTN Table 4
      // generally expects positive ITC available and positive ITC reversed.
      if (sign < 0) {
        addItc(itcRev, 'OTH', absVals);
        warnings.push(
          `Purchase credit note ${b?.billNumber || b?._id || 'unknown'} was treated as ITC reversal instead of negative ITC available.`
        );
        return;
      }

      if (b.isReverseCharge) {
        addItc(itcAvail, 'ISRC', absVals);
        return;
      }

      addItc(itcAvail, getItcCategory(b), absVals);
    });

    // Validate / normalize outward buckets
    sup31a_txval = money(sup31a_txval, 'Table 3.1(a) taxable value', { warnings });
    sup31a_iamt = money(sup31a_iamt, 'Table 3.1(a) IGST', { warnings });
    sup31a_camt = money(sup31a_camt, 'Table 3.1(a) CGST', { warnings });
    sup31a_samt = money(sup31a_samt, 'Table 3.1(a) SGST', { warnings });
    sup31a_csamt = money(sup31a_csamt, 'Table 3.1(a) Cess', { warnings });

    sup31b_txval = money(sup31b_txval, 'Table 3.1(b) taxable value', { warnings });
    sup31b_iamt = money(sup31b_iamt, 'Table 3.1(b) IGST', { warnings });
    sup31b_csamt = money(sup31b_csamt, 'Table 3.1(b) Cess', { warnings });

    sup31c_txval = money(sup31c_txval, 'Table 3.1(c) nil/exempt value', { warnings });
    sup31e_txval = money(sup31e_txval, 'Table 3.1(e) non-GST value', { warnings });

    sup31d_txval = money(sup31d_txval, 'Table 3.1(d) RCM taxable value', { warnings });
    sup31d_iamt = money(sup31d_iamt, 'Table 3.1(d) RCM IGST', { warnings });
    sup31d_camt = money(sup31d_camt, 'Table 3.1(d) RCM CGST', { warnings });
    sup31d_samt = money(sup31d_samt, 'Table 3.1(d) RCM SGST', { warnings });
    sup31d_csamt = money(sup31d_csamt, 'Table 3.1(d) RCM Cess', { warnings });

    // Normalize ITC buckets. Negative buckets are clamped to 0 by default.
    const itcAvailNorm = {
      IMPG: normalizeItcBucket(itcAvail.IMPG, 'ITC available IMPG', warnings),
      IMPS: normalizeItcBucket(itcAvail.IMPS, 'ITC available IMPS', warnings),
      ISRC: normalizeItcBucket(itcAvail.ISRC, 'ITC available ISRC', warnings),
      ISD: normalizeItcBucket(itcAvail.ISD, 'ITC available ISD', warnings),
      OTH: normalizeItcBucket(itcAvail.OTH, 'ITC available OTH', warnings)
    };

    const itcRevNorm = {
      RUL: normalizeItcBucket(itcRev.RUL, 'ITC reversed RUL', warnings),
      OTH: normalizeItcBucket(itcRev.OTH, 'ITC reversed OTH', warnings)
    };

    const itcInelgNorm = {
      RUL: normalizeItcBucket(itcInelg.RUL, 'ITC ineligible RUL', warnings),
      OTH: normalizeItcBucket(itcInelg.OTH, 'ITC ineligible OTH', warnings)
    };

    // Gross available ITC
    const grossItcIgst = round2(
      itcAvailNorm.IMPG.iamt +
      itcAvailNorm.IMPS.iamt +
      itcAvailNorm.ISRC.iamt +
      itcAvailNorm.ISD.iamt +
      itcAvailNorm.OTH.iamt
    );

    const grossItcCgst = round2(
      itcAvailNorm.IMPG.camt +
      itcAvailNorm.IMPS.camt +
      itcAvailNorm.ISRC.camt +
      itcAvailNorm.ISD.camt +
      itcAvailNorm.OTH.camt
    );

    const grossItcSgst = round2(
      itcAvailNorm.IMPG.samt +
      itcAvailNorm.IMPS.samt +
      itcAvailNorm.ISRC.samt +
      itcAvailNorm.ISD.samt +
      itcAvailNorm.OTH.samt
    );

    const grossItcCess = round2(
      itcAvailNorm.IMPG.csamt +
      itcAvailNorm.IMPS.csamt +
      itcAvailNorm.ISRC.csamt +
      itcAvailNorm.ISD.csamt +
      itcAvailNorm.OTH.csamt
    );

    // Reversed ITC
    const reversedItcIgst = round2(itcRevNorm.RUL.iamt + itcRevNorm.OTH.iamt);
    const reversedItcCgst = round2(itcRevNorm.RUL.camt + itcRevNorm.OTH.camt);
    const reversedItcSgst = round2(itcRevNorm.RUL.samt + itcRevNorm.OTH.samt);
    const reversedItcCess = round2(itcRevNorm.RUL.csamt + itcRevNorm.OTH.csamt);

    // Net ITC available = gross available - reversed, floored at 0.
    const netItcRaw = {
      iamt: round2(grossItcIgst - reversedItcIgst),
      camt: round2(grossItcCgst - reversedItcCgst),
      samt: round2(grossItcSgst - reversedItcSgst),
      csamt: round2(grossItcCess - reversedItcCess)
    };

    const netItc = clampItcBucketNegative(netItcRaw, 'Net ITC', warnings);

    const totalItcIgst = netItc.iamt;
    const totalItcCgst = netItc.camt;
    const totalItcSgst = netItc.samt;
    const totalItcCess = netItc.csamt;

    // Outward Liability (Table 3.1a + Table 3.1b) — can be offset by ITC
    const outwardLiabIgst = nonNegative(sup31a_iamt + sup31b_iamt);
    const outwardLiabCgst = nonNegative(sup31a_camt);
    const outwardLiabSgst = nonNegative(sup31a_samt);
    const outwardLiabCess = nonNegative(sup31a_csamt + sup31b_csamt);

    // RCM Liability (Table 3.1d) — strictly 100% Cash under Section 49(4)
    const rcmLiabIgst = nonNegative(sup31d_iamt);
    const rcmLiabCgst = nonNegative(sup31d_camt);
    const rcmLiabSgst = nonNegative(sup31d_samt);
    const rcmLiabCess = nonNegative(sup31d_csamt);

    // 3. Statutory ITC Cross-Utilization Order under CGST Rule 88A
    // Note: ITC only offsets Outward Liability (Ledger 30002). It NEVER touches RCM (Ledger 30003).
    let remItcIgst = totalItcIgst;
    let remItcCgst = totalItcCgst;
    let remItcSgst = totalItcSgst;
    let remItcCess = totalItcCess;

    let balLiabIgst = outwardLiabIgst;
    let balLiabCgst = outwardLiabCgst;
    let balLiabSgst = outwardLiabSgst;
    let balLiabCess = outwardLiabCess;

    // Step 1: IGST ITC fully against IGST liability
    const igstForIgst = Math.min(balLiabIgst, remItcIgst);
    balLiabIgst = round2(balLiabIgst - igstForIgst);
    remItcIgst = round2(remItcIgst - igstForIgst);

    // Step 2 & 3: Remaining IGST ITC against CGST, then SGST
    const igstForCgst = Math.min(balLiabCgst, remItcIgst);
    balLiabCgst = round2(balLiabCgst - igstForCgst);
    remItcIgst = round2(remItcIgst - igstForCgst);

    const igstForSgst = Math.min(balLiabSgst, remItcIgst);
    balLiabSgst = round2(balLiabSgst - igstForSgst);
    remItcIgst = round2(remItcIgst - igstForSgst);

    // Step 4: CGST ITC against CGST liability
    const cgstForCgst = Math.min(balLiabCgst, remItcCgst);
    balLiabCgst = round2(balLiabCgst - cgstForCgst);
    remItcCgst = round2(remItcCgst - cgstForCgst);

    // Step 5: SGST ITC against SGST liability
    const sgstForSgst = Math.min(balLiabSgst, remItcSgst);
    balLiabSgst = round2(balLiabSgst - sgstForSgst);
    remItcSgst = round2(remItcSgst - sgstForSgst);

    // Step 6 & 7: Remaining CGST & SGST ITC against IGST liability
    let cgstForIgst = 0;
    let sgstForIgst = 0;

    if (balLiabIgst > 0) {
      const halfLiab = round2(balLiabIgst / 2);
      const equalPortion = Math.min(remItcCgst, remItcSgst, halfLiab);

      if (equalPortion > 0) {
        cgstForIgst += equalPortion;
        sgstForIgst += equalPortion;
        balLiabIgst = round2(balLiabIgst - (equalPortion * 2));
        remItcCgst = round2(remItcCgst - equalPortion);
        remItcSgst = round2(remItcSgst - equalPortion);
      }

      if (balLiabIgst > 0) {
        if (remItcCgst > 0) {
          const extraCgst = Math.min(balLiabIgst, remItcCgst);
          cgstForIgst += extraCgst;
          balLiabIgst = round2(balLiabIgst - extraCgst);
          remItcCgst = round2(remItcCgst - extraCgst);
        } else if (remItcSgst > 0) {
          const extraSgst = Math.min(balLiabIgst, remItcSgst);
          sgstForIgst += extraSgst;
          balLiabIgst = round2(balLiabIgst - extraSgst);
          remItcSgst = round2(remItcSgst - extraSgst);
        }
      }
    }

    // Step 8: Cess ITC against Cess liability
    const cessForCess = Math.min(balLiabCess, remItcCess);
    balLiabCess = round2(balLiabCess - cessForCess);
    remItcCess = round2(remItcCess - cessForCess);

    const netCashOutwardIgst = nonNegative(balLiabIgst);
    const netCashOutwardCgst = nonNegative(balLiabCgst);
    const netCashOutwardSgst = nonNegative(balLiabSgst);
    const netCashOutwardCess = nonNegative(balLiabCess);

    const totalNetCashPayable = round2(
      netCashOutwardIgst +
      netCashOutwardCgst +
      netCashOutwardSgst +
      netCashOutwardCess +
      rcmLiabIgst +
      rcmLiabCgst +
      rcmLiabSgst +
      rcmLiabCess
    );

    const hasOutwardActivity = activeInvoices.length > 0;
    const hasInwardActivity = activeBills.length > 0;

    const hasOutwardLiability =
      outwardLiabIgst > 0 ||
      outwardLiabCgst > 0 ||
      outwardLiabSgst > 0 ||
      outwardLiabCess > 0;

    const hasRcmLiability =
      rcmLiabIgst > 0 ||
      rcmLiabCgst > 0 ||
      rcmLiabSgst > 0 ||
      rcmLiabCess > 0;

    const isNilReturn =
      !hasOutwardActivity &&
      !hasInwardActivity &&
      !hasOutwardLiability &&
      !hasRcmLiability &&
      grossItcIgst === 0 &&
      grossItcCgst === 0 &&
      grossItcSgst === 0 &&
      grossItcCess === 0 &&
      reversedItcIgst === 0 &&
      reversedItcCgst === 0 &&
      reversedItcSgst === 0 &&
      reversedItcCess === 0 &&
      itcInelgNorm.RUL.iamt === 0 &&
      itcInelgNorm.RUL.camt === 0 &&
      itcInelgNorm.RUL.samt === 0 &&
      itcInelgNorm.RUL.csamt === 0 &&
      itcInelgNorm.OTH.iamt === 0 &&
      itcInelgNorm.OTH.camt === 0 &&
      itcInelgNorm.OTH.samt === 0 &&
      itcInelgNorm.OTH.csamt === 0;

    const summary = {
      outwardTaxable: fmt(sup31a_txval + sup31b_txval),
      outwardTax: fmt(outwardLiabIgst + outwardLiabCgst + outwardLiabSgst + outwardLiabCess),
      salesIgst: fmt(outwardLiabIgst),
      salesCgst: fmt(outwardLiabCgst),
      salesSgst: fmt(outwardLiabSgst),
      salesCess: fmt(outwardLiabCess),

      rcmTaxable: fmt(sup31d_txval),
      rcmLiability: fmt(rcmLiabIgst + rcmLiabCgst + rcmLiabSgst + rcmLiabCess),
      rcmIgst: fmt(rcmLiabIgst),
      rcmCgst: fmt(rcmLiabCgst),
      rcmSgst: fmt(rcmLiabSgst),
      rcmCess: fmt(rcmLiabCess),

      grossItc: fmt(grossItcIgst + grossItcCgst + grossItcSgst + grossItcCess),
      itcReversal: fmt(reversedItcIgst + reversedItcCgst + reversedItcSgst + reversedItcCess),
      itcIneligible: fmt(
        itcInelgNorm.RUL.iamt + itcInelgNorm.RUL.camt + itcInelgNorm.RUL.samt + itcInelgNorm.RUL.csamt +
        itcInelgNorm.OTH.iamt + itcInelgNorm.OTH.camt + itcInelgNorm.OTH.samt + itcInelgNorm.OTH.csamt
      ),

      eligibleItc: fmt(totalItcIgst + totalItcCgst + totalItcSgst + totalItcCess),
      itcIgst: fmt(totalItcIgst),
      itcCgst: fmt(totalItcCgst),
      itcSgst: fmt(totalItcSgst),
      itcCess: fmt(totalItcCess),

      netCashPayable: fmt(totalNetCashPayable),
      netCashOutward: fmt(netCashOutwardIgst + netCashOutwardCgst + netCashOutwardSgst + netCashOutwardCess),
      netCashRcm: fmt(rcmLiabIgst + rcmLiabCgst + rcmLiabSgst + rcmLiabCess),

      invoicesCount: activeInvoices.length,
      billsCount: activeBills.length,
      isNil: isNilReturn
    };

    warnings.push('Interest, late fee, cash ledger balance, and past ITC reversals are not verified from external ledgers in this service.');
    warnings.push('RCM ITC is assumed claimable only after RCM cash liability is paid. Verify cash ledger before filing.');

    if (ALLOW_NEGATIVE_3B_VALUES) {
      warnings.push('GST_3B_ALLOW_NEGATIVE_VALUES=true is enabled. Negative GSTR-3B summary values will be sent if present.');
    }

    if (isNilReturn) {
      return {
        isNil: true,
        payload: null,
        offsetPayload: null,
        summary,
        warnings
      };
    }

    // 4. Official GSTN GSTR-3B JSON structure
    const payload = {
      gstin: normGstin,
      ret_period: period,
      sup_details: {
        osup_det: {
          txval: sup31a_txval,
          iamt: sup31a_iamt,
          camt: sup31a_camt,
          samt: sup31a_samt,
          csamt: sup31a_csamt
        },
        osup_zero: {
          txval: sup31b_txval,
          iamt: sup31b_iamt,
          csamt: sup31b_csamt
        },
        osup_nil_exmp: {
          txval: sup31c_txval
        },
        isup_rev: {
          txval: sup31d_txval,
          iamt: sup31d_iamt,
          camt: sup31d_camt,
          samt: sup31d_samt,
          csamt: sup31d_csamt
        },
        osup_nongst: {
          txval: sup31e_txval
        }
      },
      inter_sup: {
        comp_details: interMapToArray(interStateComp, warnings),
        uin_details: interMapToArray(interStateUin, warnings),
        unreg_details: interMapToArray(interStateUnreg, warnings)
      },
      itc_elg: {
        itc_avl: [
          {
            ty: 'IMPG',
            iamt: itcAvailNorm.IMPG.iamt,
            camt: itcAvailNorm.IMPG.camt,
            samt: itcAvailNorm.IMPG.samt,
            csamt: itcAvailNorm.IMPG.csamt
          },
          {
            ty: 'IMPS',
            iamt: itcAvailNorm.IMPS.iamt,
            camt: itcAvailNorm.IMPS.camt,
            samt: itcAvailNorm.IMPS.samt,
            csamt: itcAvailNorm.IMPS.csamt
          },
          {
            ty: 'ISRC',
            iamt: itcAvailNorm.ISRC.iamt,
            camt: itcAvailNorm.ISRC.camt,
            samt: itcAvailNorm.ISRC.samt,
            csamt: itcAvailNorm.ISRC.csamt
          },
          {
            ty: 'ISD',
            iamt: itcAvailNorm.ISD.iamt,
            camt: itcAvailNorm.ISD.camt,
            samt: itcAvailNorm.ISD.samt,
            csamt: itcAvailNorm.ISD.csamt
          },
          {
            ty: 'OTH',
            iamt: itcAvailNorm.OTH.iamt,
            camt: itcAvailNorm.OTH.camt,
            samt: itcAvailNorm.OTH.samt,
            csamt: itcAvailNorm.OTH.csamt
          }
        ],
        itc_rev: [
          {
            ty: 'RUL',
            iamt: itcRevNorm.RUL.iamt,
            camt: itcRevNorm.RUL.camt,
            samt: itcRevNorm.RUL.samt,
            csamt: itcRevNorm.RUL.csamt
          },
          {
            ty: 'OTH',
            iamt: itcRevNorm.OTH.iamt,
            camt: itcRevNorm.OTH.camt,
            samt: itcRevNorm.OTH.samt,
            csamt: itcRevNorm.OTH.csamt
          }
        ],
        itc_net: {
          iamt: netItc.iamt,
          camt: netItc.camt,
          samt: netItc.samt,
          csamt: netItc.csamt
        },
        itc_inelg: [
          {
            ty: 'RUL',
            iamt: itcInelgNorm.RUL.iamt,
            camt: itcInelgNorm.RUL.camt,
            samt: itcInelgNorm.RUL.samt,
            csamt: itcInelgNorm.RUL.csamt
          },
          {
            ty: 'OTH',
            iamt: itcInelgNorm.OTH.iamt,
            camt: itcInelgNorm.OTH.camt,
            samt: itcInelgNorm.OTH.samt,
            csamt: itcInelgNorm.OTH.csamt
          }
        ]
      },
      inward_sup: {
        isup_details: []
      },
      intr_ltfee: {
        intr_details: {
          iamt: 0,
          camt: 0,
          samt: 0,
          csamt: 0
        }
      }
    };

    // Table 6 / tx_pmt: net tax payable after ITC utilization.
    // RCM is always cash.
    const txPmt = [];

    if (hasOutwardActivity || hasOutwardLiability || totalItcAll(netItc) > 0) {
      txPmt.push({
        trans_typ: 30002,
        trans_desc: 'Other than reverse charge',
        liab_ldg_id: 30002,
        igst: {
          tx: fmt(netCashOutwardIgst),
          intr: 0,
          fee: 0
        },
        cgst: {
          tx: fmt(netCashOutwardCgst),
          intr: 0,
          fee: 0
        },
        sgst: {
          tx: fmt(netCashOutwardSgst),
          intr: 0,
          fee: 0
        },
        cess: {
          tx: fmt(netCashOutwardCess),
          intr: 0,
          fee: 0
        }
      });
    }

    if (hasRcmLiability) {
      txPmt.push({
        trans_typ: 30003,
        trans_desc: 'Reverse charge',
        liab_ldg_id: 30003,
        igst: {
          tx: fmt(rcmLiabIgst),
          intr: 0,
          fee: 0
        },
        cgst: {
          tx: fmt(rcmLiabCgst),
          intr: 0,
          fee: 0
        },
        sgst: {
          tx: fmt(rcmLiabSgst),
          intr: 0,
          fee: 0
        },
        cess: {
          tx: fmt(rcmLiabCess),
          intr: 0,
          fee: 0
        }
      });
    }

    if (txPmt.length > 0) {
      payload.tx_pmt = txPmt;
    }

    // 5. Official GSTN GSTR-3B RETOFFSET structure
    const pdcash = [];

    const hasOutwardCash =
      netCashOutwardIgst > 0 ||
      netCashOutwardCgst > 0 ||
      netCashOutwardSgst > 0 ||
      netCashOutwardCess > 0;

    if (hasOutwardCash) {
      pdcash.push({
        liab_ldg_id: 30002,
        trans_typ: 30002,
        ipd: fmt(netCashOutwardIgst),
        cpd: fmt(netCashOutwardCgst),
        spd: fmt(netCashOutwardSgst),
        cspd: fmt(netCashOutwardCess),
        i_intrpd: 0,
        c_intrpd: 0,
        s_intrpd: 0,
        cs_intrpd: 0,
        c_lfeepd: 0,
        s_lfeepd: 0
      });
    }

    const hasRcmCash =
      rcmLiabIgst > 0 ||
      rcmLiabCgst > 0 ||
      rcmLiabSgst > 0 ||
      rcmLiabCess > 0;

    if (hasRcmCash) {
      pdcash.push({
        liab_ldg_id: 30003,
        trans_typ: 30003,
        ipd: fmt(rcmLiabIgst),
        cpd: fmt(rcmLiabCgst),
        spd: fmt(rcmLiabSgst),
        cspd: fmt(rcmLiabCess),
        i_intrpd: 0,
        c_intrpd: 0,
        s_intrpd: 0,
        cs_intrpd: 0,
        c_lfeepd: 0,
        s_lfeepd: 0
      });
    }

    const hasItcUtilization =
      igstForIgst > 0 ||
      igstForCgst > 0 ||
      igstForSgst > 0 ||
      cgstForCgst > 0 ||
      cgstForIgst > 0 ||
      sgstForSgst > 0 ||
      sgstForIgst > 0 ||
      cessForCess > 0;

    const pditc = hasItcUtilization
      ? {
        liab_ldg_id: 30002,
        trans_typ: 30002,
        i_pdi: fmt(igstForIgst),
        i_pdc: fmt(cgstForIgst),
        i_pds: fmt(sgstForIgst),
        c_pdi: fmt(igstForCgst),
        c_pdc: fmt(cgstForCgst),
        s_pdi: fmt(igstForSgst),
        s_pds: fmt(sgstForSgst),
        cs_pdcs: fmt(cessForCess)
      }
      : null;

    const offsetPayload =
      pdcash.length || pditc
        ? {
          ...(pdcash.length ? { pdcash } : {}),
          ...(pditc ? { pditc } : {})
        }
        : null;

    // Validate before returning. Controller hashes this payload, so it must be stable.
    validateGstr3bPayload(payload);

    if (offsetPayload) {
      validateGstr3bOffsetPayload(offsetPayload);
    }

    return {
      isNil: false,
      payload,
      offsetPayload,
      summary,
      warnings
    };
  }

  static async savePayload(workspaceId, gstin, period, options = {}) {
    if (!workspaceId) throw ApiError.validationError('Active workspaceId is required to save GSTR-3B.');

    const normGstin = (gstin || '').trim().toUpperCase();
    if (!isValidGstin(normGstin)) throw ApiError.invalidGstin('Invalid GSTIN format.');
    if (!isValidPeriod(period)) throw ApiError.validationError('Invalid return period format. Must be MMYYYY.');

    const prepared = await this.preparePayload(workspaceId, normGstin, period);

    if (prepared.isNil) {
      await writeAudit({
        workspaceId,
        memberId: options.memberId || null,
        action: 'GSTR3B_NIL_SAVE_SKIPPED',
        details: {
          gstin: normGstin,
          period,
          summary: prepared.summary
        },
        status: 'SUCCESS'
      });

      return {
        success: true,
        nil: true,
        saved: false,
        message: 'Nil GSTR-3B does not require regular RETSAVE through this service. Use NilReturnService for portal-confirmed nil filing.',
        summary: prepared.summary,
        warnings: prepared.warnings
      };
    }

    const isLive = isLiveFilingEnabled();

    if (!isLive) {
      await writeAudit({
        workspaceId,
        memberId: options.memberId || null,
        action: 'GSTR3B_SAVE_DRY_RUN',
        details: {
          gstin: normGstin,
          period,
          ref_id: 'DRY-RUN',
          summary: prepared.summary
        },
        status: 'SUCCESS'
      });

      return {
        success: true,
        dryRun: true,
        message: 'GSTR-3B payload prepared in dry-run mode. Live portal upload is disabled outside production.',
        summary: prepared.summary,
        payload: prepared.payload,
        offsetPayload: prepared.offsetPayload,
        warnings: prepared.warnings
      };
    }

    const FinaggService = require('./finagg.service');
    const provider = FinaggService.getProvider();

    if (!provider || typeof provider.saveGstr3b !== 'function') {
      throw ApiError.providerError('Active GST provider does not support GSTR-3B RETSAVE.', 502);
    }

    const saveResult = await provider.saveGstr3b(prepared.payload, {
      gstin: normGstin,
      period,
      username: options.username,
      token: options.gstToken || options.token,
      gstToken: options.gstToken || options.token
    });

    const refId = saveResult?.reference_id || saveResult?.ref_id;

    if (!refId) {
      throw ApiError.providerError(
        'GSTR-3B RETSAVE did not return required reference_id. Save was not confirmed.',
        502
      );
    }

    await writeAudit({
      workspaceId,
      memberId: options.memberId || null,
      action: 'GSTR3B_SAVE_LIVE',
      details: {
        gstin: normGstin,
        period,
        ref_id: refId,
        summary: prepared.summary
      },
      status: 'SUCCESS'
    });

    return {
      success: true,
      ref_id: refId,
      reference_id: refId,
      summary: prepared.summary,
      payload: prepared.payload,
      offsetPayload: prepared.offsetPayload,
      warnings: prepared.warnings
    };
  }

  static async offsetLiabilities(workspaceId, gstin, period, options = {}) {
    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError('Live GSTR-3B liability offset is disabled outside production.', 503);
    }

    const normGstin = (gstin || '').trim().toUpperCase();
    if (!isValidGstin(normGstin)) throw ApiError.invalidGstin('Invalid GSTIN format.');
    if (!isValidPeriod(period)) throw ApiError.validationError('Invalid return period format. Must be MMYYYY.');

    let prepared = null;
    let body = options.body;

    if (!body && workspaceId) {
      prepared = await this.preparePayload(workspaceId, normGstin, period);

      if (prepared.isNil || !prepared.offsetPayload) {
        return {
          success: true,
          skipped: true,
          message: 'No GSTR-3B liability or ITC utilization requires offset.',
          summary: prepared.summary,
          warnings: prepared.warnings
        };
      }

      body = prepared.offsetPayload;
    }

    if (!body) {
      throw ApiError.validationError('Offset payload is required to offset GSTR-3B liabilities.');
    }

    validateGstr3bOffsetPayload(body);

    if (!hasOffsetPaymentDetails(body)) {
      if (options.body) {
        throw ApiError.validationError('Offset payload must contain non-zero pdcash / pditc / pdnls amounts.');
      }

      return {
        success: true,
        skipped: true,
        message: 'No non-zero offset amounts detected. Offset skipped.',
        summary: prepared?.summary || null
      };
    }

    const FinaggService = require('./finagg.service');
    const provider = FinaggService.getProvider();

    if (!provider || typeof provider.offsetGstr3b !== 'function') {
      throw ApiError.providerError('Active GST provider does not support GSTR-3B liability offset.', 502);
    }

    const offsetResult = await provider.offsetGstr3b(period, {
      gstin: normGstin,
      username: options.username,
      token: options.gstToken || options.token,
      gstToken: options.gstToken || options.token,
      body
    });

    if (workspaceId) {
      await writeAudit({
        workspaceId,
        memberId: options.memberId || null,
        action: 'GSTR3B_OFFSET_LIABILITIES',
        details: {
          gstin: normGstin,
          period,
          netCashPayable: prepared?.summary?.netCashPayable ?? options.summary?.netCashPayable ?? null,
          offsetResult: {
            success: offsetResult?.success,
            message: offsetResult?.message
          }
        },
        status: 'SUCCESS'
      });
    }

    return offsetResult;
  }

  static validatePayload(payload) {
    return validateGstr3bPayload(payload);
  }

  static validateOffsetPayload(body) {
    return validateGstr3bOffsetPayload(body);
  }
}

module.exports = Gstr3bService;