const Invoice = require('../models/Invoice');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { isValidGstin, isValidPeriod } = require('../utils/gstin');
const { isLiveFilingEnabled } = require('../utils/filingMode');
const {
  validateGstr1Schema,
  normalizeGstr1Payload
} = require('../utils/gstr1Validator');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const TZ_OFFSET_MIN = Number(process.env.GST_TZ_OFFSET_MIN || 330);
const TZ_OFFSET_MS = TZ_OFFSET_MIN * 60 * 1000;

// GSTN doc_issue uses descriptive strings for document types.
// Override via env if your validator/GSTN sandbox expects short codes.
const DOC_TYP_LABELS = {
  INV: process.env.GSTN_DOC_TYP_INV || 'Invoices for outward supply',
  CN: process.env.GSTN_DOC_TYP_CN || 'Credit Note',
  DN: process.env.GSTN_DOC_TYP_DN || 'Debit Note'
};

// doc_num is normally fixed by document nature:
// 1 = Invoices, 2 = Credit Notes, 3 = Debit Notes.
const DOC_NUM_BY_TYPE = {
  INV: 1,
  CN: 2,
  DN: 3
};

const DEFAULT_UQC = process.env.GSTN_DEFAULT_UQC || 'PCS';

// Statutory B2CL threshold: inter-state supplies to unregistered persons
// where invoice value exceeds Rs. 5,00,000.
const B2CL_THRESHOLD = (() => {
  const n = Number(process.env.GST_GSTR1_B2CL_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? n : 500000;
})();

// If true, excluded invoices are reported as cancelled in Table 13 so that
// net_issue matches the invoices actually included in the filing payload.
const TREAT_EXCLUDED_AS_CANCELLED_DEFAULT =
  String(process.env.GST_GSTR1_TREAT_EXCLUDED_AS_CANCELLED || 'true').toLowerCase() === 'true';

// By default, do NOT silently rewrite invoice numbers. Invalid invoice numbers block filing.
const SANITIZE_INUM =
  String(process.env.GST_GSTR1_SANITIZE_INUM || 'false').toLowerCase() === 'true';

const EXCLUDED_DOCUMENT_STATUSES = [
  'cancelled',
  'canceled',
  'Cancelled',
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

const ACTIVE_STATUS_SET = new Set(ACTIVE_STATUS_LIST.map((s) => s.toLowerCase()));
const EXCLUDED_STATUS_SET = new Set(EXCLUDED_DOCUMENT_STATUSES.map((s) => s.toLowerCase()));
const CANCELLED_STATUS_SET = new Set(['cancelled', 'canceled', 'void', 'deleted']);
const DRAFT_STATUS_SET = new Set(['draft']);

const KNOWN_ZERO_PREFS = new Set(['NIL', 'EXEMPT', 'NON_GST']);

// GSTN source type values commonly accepted for invoice/credit/debit/export documents.
const VALID_SRCTYP = new Set(['I', 'B', 'R', 'P', 'E', 'M']);

/* -------------------------------------------------------------------------- */
/* Patterns                                                                   */
/* -------------------------------------------------------------------------- */

// Official GSTN inum pattern:
// 1-16 chars, allowed [a-zA-Z0-9/-], must contain at least one [a-zA-Z1-9].
const GSTN_INUM_REGEX = /^(?=.{1,16}$)(?:[\/0-9-]*[a-zA-Z0-9\/-]*[a-zA-Z1-9]+[a-zA-Z0-9\/-]*)$/;

const DATE_RE = /^(\d{2})-(\d{2})-(\d{4})$/;
const HSN_RE = /^[0-9]{2,8}$/;
const UQC_RE = /^[A-Za-z]+$/;
const SBNUM_RE = /^[0-9]{3,7}$/;
const SPCODE_RE = /^[A-Za-z0-9]{1,6}$/;

const ETIN_RE = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}C[0-9A-Za-z]{1}$/;

// All official GSTN ctin patterns: GSTIN, UN body, NR entity, Diplomatic ID.
const CTIN_PATTERNS = [
  /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}[Zz1-9A-Ja-j]{1}[0-9A-Za-z]{1}$/,
  /^[0-9]{4}[A-Z]{3}[0-9]{5}[UO]N[A-Z0-9]{1}$/,
  /^[0-9]{4}[A-Za-z]{3}[0-9]{5}NR[A-Za-z0-9]{1}$/,
  /^[0-9]{2}[A-Za-z]{4}[A-Za-z0-9]{1}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}D[A-Za-z0-9]{1}$/
];

const VALID_STATE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '96', '97'
]);

const VALID_STATE_DOMESTIC = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '97'
]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(v) {
  const n = num(v, 0);
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function absAmount(v) {
  return round2(Math.abs(num(v, 0)));
}

function inferRate(tax, taxable) {
  const t = absAmount(tax);
  const val = absAmount(taxable);

  if (t <= 0 || val <= 0) return 0;

  return Math.min(999.99, round2((t / val) * 100));
}

function statusKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isDraftStatus(doc) {
  return DRAFT_STATUS_SET.has(statusKey(doc?.status));
}

function isCancelledStatus(doc) {
  return CANCELLED_STATUS_SET.has(statusKey(doc?.status));
}

function isFinalizedStatus(doc) {
  const s = statusKey(doc?.status);
  if (!s) return false;

  if (ACTIVE_STATUS_SET.size) {
    return ACTIVE_STATUS_SET.has(s);
  }

  return !EXCLUDED_STATUS_SET.has(s);
}

function isIssuedStatus(doc) {
  return isFinalizedStatus(doc) || isCancelledStatus(doc);
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

function formatFromDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;

  const local = new Date(d.getTime() + TZ_OFFSET_MS);
  const day = String(local.getUTCDate()).padStart(2, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const year = local.getUTCFullYear();
  const formatted = `${day}-${month}-${year}`;

  return isGstnDate(formatted) ? formatted : null;
}

function formatGstnDateStrict(dateVal) {
  if (dateVal === undefined || dateVal === null || dateVal === '') return null;

  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();

    if (DATE_RE.test(trimmed) && isGstnDate(trimmed)) {
      return trimmed;
    }

    const d = new Date(trimmed);
    return formatFromDate(d);
  }

  if (dateVal instanceof Date) {
    return formatFromDate(dateVal);
  }

  const d = new Date(dateVal);
  return formatFromDate(d);
}

function isValidCtin(val) {
  if (typeof val !== 'string' || val.length !== 15) return false;
  return CTIN_PATTERNS.some((re) => re.test(val));
}

function getCtin(inv) {
  return String(inv?.customerGstin || inv?.buyerGstin || inv?.recipientGstin || '')
    .trim()
    .toUpperCase();
}

function getValidEtin(inv) {
  const raw = String(inv?.ecomOperatorGstin || inv?.etin || '').trim().toUpperCase();
  return ETIN_RE.test(raw) ? raw : '';
}

function isEcommerceSupply(inv) {
  if (getValidEtin(inv)) return true;

  const flag = inv?.isEcommerce;
  return flag === true || String(flag).trim().toLowerCase() === 'true';
}

function toGstr1Inum(raw) {
  let v = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!v) return null;

  if (SANITIZE_INUM) {
    v = v.replace(/[^A-Za-z0-9/\-]/g, '').slice(0, 16);
  }

  return GSTN_INUM_REGEX.test(v) ? v : null;
}

function sanitizePos(raw, fallback = '01') {
  if (raw && typeof raw === 'string') {
    const match = raw.trim().match(/^([0-9]{2})/);
    if (match && VALID_STATE_CODES.has(match[1])) return match[1];
  }

  const cleanFallback = String(fallback || '01').trim().slice(0, 2);
  return VALID_STATE_CODES.has(cleanFallback) ? cleanFallback : '01';
}

function sanitizePosDomestic(raw, fallback = '01') {
  if (raw && typeof raw === 'string') {
    const match = raw.trim().match(/^([0-9]{2})/);
    if (match && VALID_STATE_DOMESTIC.has(match[1])) return match[1];
  }

  const cleanFallback = String(fallback || '01').trim().slice(0, 2);
  return VALID_STATE_DOMESTIC.has(cleanFallback) ? cleanFallback : '01';
}

function sanitizeRate(raw, fallback = 0) {
  if (raw === null || raw === undefined || raw === '') return fallback;

  const n = typeof raw === 'string'
    ? parseFloat(raw.replace(/[^0-9.]/g, ''))
    : Number(raw);

  if (!Number.isFinite(n) || Number.isNaN(n) || n < 0) return fallback;
  if (n > 999.99) return 999.99;

  return round2(n);
}

function toHsnCode(raw) {
  const v = String(raw ?? '').trim().replace(/[^0-9]/g, '');
  return HSN_RE.test(v) ? v : null;
}

function cleanUqc(raw, fallback = 'OTH') {
  let v = String(raw ?? '').trim().replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!v) v = fallback;
  if (v.length > 30) v = v.slice(0, 30);
  return v || 'OTH';
}

function normalizeExportType(raw) {
  if (!raw) return null;

  const s = String(raw).trim().toUpperCase();

  if (['WPAY', 'WP', 'WITH_PAY', 'WITH_PAYMENT', 'PAY', 'EXPWP'].includes(s)) return 'WPAY';
  if (['WOPAY', 'WOP', 'WITHOUT_PAY', 'WITHOUT_PAYMENT', 'NOPAY', 'EXPWOP'].includes(s)) return 'WOPAY';

  return null;
}

function deriveCdnurExportTyp(raw, totalIgst = 0) {
  const norm = normalizeExportType(raw);
  if (norm === 'WPAY') return 'EXPWP';
  if (norm === 'WOPAY') return 'EXPWOP';

  return absAmount(totalIgst) > 0 ? 'EXPWP' : 'EXPWOP';
}

function isExportSupply(inv, pos) {
  const ctin = getCtin(inv);

  // Registered/UID/Diplomatic recipients are not direct Table 6A exports.
  // SEZ supplies with valid ctin are reported in B2B with inv_typ SEWP/SEWOP.
  if (isValidCtin(ctin)) return false;

  if (pos === '96') return true;

  const exportFlag = inv?.isExport;
  if (exportFlag === true || String(exportFlag).trim().toLowerCase() === 'true') return true;

  if (normalizeExportType(inv?.exportType) !== null) return true;

  return false;
}

function deriveInvTyp(inv, pos, supplierStateCode, hasCtin, totalIgst) {
  const t = String(inv?.invoiceType || inv?.exportType || '').toUpperCase();

  if (['SEWP', 'SEZWP'].includes(t)) return 'SEWP';
  if (['SEWOP', 'SEZWOP'].includes(t)) return 'SEWOP';
  if (['DE', 'DEEMED', 'DEEMED_EXPORT'].includes(t)) return 'DE';
  if (t === 'CBW') return 'CBW';

  const igstPaid = absAmount(totalIgst) > 0;

  // Registered recipient but foreign/SEZ POS => SEZ supply, not Table 6A export.
  if (pos === '96' && pos !== supplierStateCode && hasCtin) {
    return igstPaid ? 'SEWP' : 'SEWOP';
  }

  // Explicit export flag but registered GSTIN/UID recipient => SEZ-like B2B.
  if (
    (inv?.isExport === true || String(inv?.isExport).trim().toLowerCase() === 'true') &&
    hasCtin
  ) {
    return igstPaid ? 'SEWP' : 'SEWOP';
  }

  return 'R';
}

function docTypeOf(inv) {
  const t = String(inv?.documentType || inv?.invoiceType || '').toUpperCase();

  if (t.includes('CREDIT')) return 'CN';
  if (t.includes('DEBIT')) return 'DN';

  return 'INV';
}

function isNoteDoc(inv) {
  const t = String(inv?.documentType || inv?.invoiceType || '').toUpperCase();
  return t.includes('CREDIT') || t.includes('DEBIT');
}

function signOf(inv) {
  return docTypeOf(inv) === 'CN' ? -1 : 1;
}

function getRchrg(inv) {
  return (
    inv?.isReverseCharge === true ||
    String(inv?.isReverseCharge).trim().toUpperCase() === 'Y'
  )
    ? 'Y'
    : 'N';
}

function resolveTaxPreference(item, inv) {
  const raw =
    item?.taxPreference ||
    item?.taxType ||
    item?.supplyType ||
    inv?.taxPreference ||
    inv?.supplyType ||
    inv?.category ||
    '';

  const s = String(raw).trim().toUpperCase().replace(/[\s-]+/g, '_');

  if (['NIL', 'NIL_RATED', 'ZERO_RATED_NIL'].includes(s)) return 'NIL';
  if (['EXEMPT', 'EXEMPTED'].includes(s)) return 'EXEMPT';
  if (['NON_GST', 'NONGST', 'NON_GST_SUPPLY'].includes(s)) return 'NON_GST';

  return s;
}

function getItemEffectiveRate(item) {
  let rt = sanitizeRate(item?.gstRate);

  if (rt === 0) {
    const taxable = absAmount(item?.taxableAmount ?? item?.amount);
    const igst = absAmount(item?.igstAmount ?? item?.igst);
    const cgst = absAmount(item?.cgstAmount ?? item?.cgst);
    const sgst = absAmount(item?.sgstAmount ?? item?.sgst);

    const tax = igst + cgst + sgst;

    if (tax > 0 && taxable > 0) {
      rt = inferRate(tax, taxable);
    }
  }

  return rt;
}

function normalizeItmDet(item, ctx = {}) {
  const taxable = absAmount(item?.taxableAmount ?? item?.amount);
  const igst = absAmount(item?.igstAmount ?? item?.igst);
  const cgst = absAmount(item?.cgstAmount ?? item?.cgst);
  const sgst = absAmount(item?.sgstAmount ?? item?.sgst);
  const cess = absAmount(item?.cessAmount ?? item?.cess);

  const rt = getItemEffectiveRate(item);

  if (ctx.export || ctx.interState) {
    const iamt = round2(igst + cgst + sgst);
    const det = { rt, txval: taxable };

    if (iamt > 0) det.iamt = iamt;
    if (cess > 0) det.csamt = cess;

    // If rate is positive but no tax/cess exists, treat as zero-rated/exempt
    // to avoid schema/business mismatch.
    if (rt > 0 && taxable > 0 && !det.iamt && !det.csamt) {
      det.rt = 0;
    }

    return det;
  }

  let camt = cgst;
  let samt = sgst;

  if (camt === 0 && samt === 0 && igst > 0) {
    camt = round2(igst / 2);
    samt = round2(igst - camt);
  } else if (igst > 0) {
    const total = round2(igst + camt + samt);
    camt = round2(total / 2);
    samt = round2(total - camt);
  }

  const det = { rt, txval: taxable };

  if (camt > 0) det.camt = camt;
  if (samt > 0) det.samt = samt;
  if (cess > 0) det.csamt = cess;

  if (rt > 0 && taxable > 0 && !det.camt && !det.samt && !det.csamt) {
    det.rt = 0;
  }

  return det;
}

function buildItms(lineItems, ctx = {}) {
  const items = Array.isArray(lineItems) ? lineItems : [];

  const itms = items.map((item, idx) => ({
    num: idx + 1,
    itm_det: normalizeItmDet(item, ctx)
  }));

  if (!itms.length) {
    itms.push({
      num: 1,
      itm_det: { rt: 0, txval: 0 }
    });
  }

  return itms;
}

function buildExpItms(lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];

  const itms = items.map((item) => normalizeItmDet(item, { export: true }));

  if (!itms.length) {
    itms.push({ rt: 0, txval: 0 });
  }

  return itms;
}

function buildSyntheticLineItem(inv) {
  const taxable = absAmount(inv?.subTotal ?? inv?.totalTaxable);
  const igst = absAmount(inv?.totalIgst);
  const cgst = absAmount(inv?.totalCgst);
  const sgst = absAmount(inv?.totalSgst);
  const cess = absAmount(inv?.totalCess);
  const gstTax = igst + cgst + sgst;

  return {
    taxableAmount: taxable,
    igstAmount: igst,
    cgstAmount: cgst,
    sgstAmount: sgst,
    cessAmount: cess,
    gstRate: inferRate(gstTax, taxable),
    hsnSac: inv?.hsnSac || inv?.hsnCode || inv?.sacCode || '',
    unit: inv?.uqc || inv?.unit || '',
    quantity: inv?.quantity || 0,
    name: inv?.description || inv?.customerName || inv?.invoiceNumber || 'Supply',
    taxPreference: inv?.taxPreference || inv?.supplyType || inv?.category || ''
  };
}

function getEffectiveLineItems(inv) {
  if (Array.isArray(inv?.lineItems) && inv.lineItems.length > 0) {
    return { items: inv.lineItems, synthesized: false };
  }

  return { items: [buildSyntheticLineItem(inv)], synthesized: true };
}

function addOptionalString(obj, key, val) {
  if (val === undefined || val === null) return;

  const s = String(val).trim();
  if (s) obj[key] = s;
}

function cleanShippingBillNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';

  if (SBNUM_RE.test(s)) return s;

  const digits = s.replace(/[^0-9]/g, '');
  return SBNUM_RE.test(digits) ? digits : '';
}

function cleanPortCode(raw) {
  const s = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return SPCODE_RE.test(s) ? s : '';
}

function sortInvoiceList(list) {
  list.sort((a, b) => {
    const da = String(a?.idt || a?.nt_dt || '');
    const db = String(b?.idt || b?.nt_dt || '');
    const na = String(a?.inum || a?.nt_num || '');
    const nb = String(b?.inum || b?.nt_num || '');

    return da.localeCompare(db) || naturalSortStrings(na, nb);
  });
}

function naturalSortStrings(a, b) {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function normalizeExcludedIds(value) {
  if (!value) return new Set();

  let arr = [];

  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === 'string') {
    arr = value.split(',');
  } else {
    arr = [value];
  }

  return new Set(
    arr
      .map((x) => String(x ?? '').trim())
      .filter(Boolean)
  );
}

function addIrnFields(target, inv, idt, location, sectionDetails, warnings) {
  const irn = String(inv?.irn || '').trim();

  if (irn) {
    target.irn = irn;
  } else {
    sectionDetails.missingIrn.push({
      location,
      invoiceNumber: inv?.invoiceNumber || null,
      reference: target.inum || target.nt_num || null
    });
  }

  const rawIrnDate = inv?.irnGenDate || inv?.irngendate;
  const irngendate = formatGstnDateStrict(rawIrnDate) || idt;

  if (irngendate) {
    target.irngendate = irngendate;

    if (!rawIrnDate) {
      warnings.push(
        `${location}: IRN generation date missing; defaulted to invoice date ${idt}.`
      );
    }
  }

  let srctyp = String(inv?.sourceType || inv?.srctyp || 'I').trim().toUpperCase();
  if (!VALID_SRCTYP.has(srctyp)) srctyp = 'I';

  target.srctyp = srctyp;
}

async function writeAudit(entry) {
  try {
    await AuditLog.create(entry);
  } catch (e) {
    logger.warn('AuditLog write failed in GSTR-1 service', {
      action: entry?.action,
      error: safeErrorMessage(e)
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

class Gstr1Service {
  static async preparePayload(workspaceId, gstin, period, options = {}) {
    if (!workspaceId) throw ApiError.validationError('Active workspaceId is required to prepare GSTR-1.');

    const normGstin = (gstin || '').trim().toUpperCase();
    if (!isValidGstin(normGstin)) throw ApiError.invalidGstin('Invalid GSTIN format.');
    if (!isValidPeriod(period)) throw ApiError.validationError('Invalid return period format. Must be MMYYYY.');

    const month = parseInt(period.slice(0, 2), 10);
    const year = parseInt(period.slice(2), 10);

    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - TZ_OFFSET_MS);
    const endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - TZ_OFFSET_MS - 1);

    const excludedIds = normalizeExcludedIds(options.excludedInvoiceIds);

    const treatExcludedAsCancelled =
      options.treatExcludedAsCancelled === undefined
        ? TREAT_EXCLUDED_AS_CANCELLED_DEFAULT
        : Boolean(options.treatExcludedAsCancelled);

    const b2clThreshold = B2CL_THRESHOLD;
    const warnings = [];

    let supplierStateCode = normGstin.slice(0, 2);
    if (!VALID_STATE_CODES.has(supplierStateCode)) {
      warnings.push(
        `Supplier GSTIN state code '${supplierStateCode}' is not a valid GSTN state code. Falling back to '01' for POS classification.`
      );
      supplierStateCode = '01';
    }

    const invoicePaths = Invoice.schema?.paths || {};
    const filter = {
      workspaceId,
      invoiceDate: { $gte: startDate, $lte: endDate }
    };

    if (invoicePaths.supplierGstin) {
      filter.supplierGstin = normGstin;
    } else if (invoicePaths.gstin) {
      filter.gstin = normGstin;
    } else {
      warnings.push(
        'Invoice model does not expose gstin/supplierGstin field. Workspace-level invoice filter may include multiple GSTINs if present.'
      );
    }

    const allInvoices = await Invoice
      .find(filter)
      .sort({ invoiceDate: 1, invoiceNumber: 1 })
      .lean();

    const activeInvoices = allInvoices.filter(isFinalizedStatus);
    const cancelledCount = allInvoices.filter(isCancelledStatus).length;
    const excludedActiveCount = activeInvoices.filter((inv) => excludedIds.has(String(inv._id))).length;

    const sectionDetails = {
      b2b: [],
      b2cl: [],
      b2cs: [],
      exp: [],
      cdnr: [],
      cdnur: [],
      intraUnregNotes: [],
      unclassifiedZeroRate: [],
      invalidHsn: [],
      invalidInvoiceNumbers: [],
      invalidDates: [],
      missingIrn: [],
      hsn: [],
      docIssue: null,
      docIssueList: [],
      docSeries: [],
      synthesizedLineItemsCount: 0,
      warnings
    };

    const b2bMap = new Map();
    const b2clMap = new Map();
    const b2csMap = new Map();
    const expMap = new Map();
    const cdnrMap = new Map();
    const cdnurFlat = [];
    const hsnMap = new Map();

    const nilBuckets = {
      INTRB2B: { sply_ty: 'INTRB2B', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
      INTRB2C: { sply_ty: 'INTRB2C', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
      INTRAB2B: { sply_ty: 'INTRAB2B', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
      INTRAB2C: { sply_ty: 'INTRAB2C', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 }
    };

    let hasNilSupplies = false;
    const validIncludedInvoices = [];

    for (const inv of activeInvoices) {
      const invIdStr = String(inv._id);
      const isExcluded = excludedIds.has(invIdStr);

      const inum = toGstr1Inum(inv.invoiceNumber);
      if (!inum) {
        if (!isExcluded) {
          sectionDetails.invalidInvoiceNumbers.push({
            _id: inv._id,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate
          });
        }
        continue;
      }

      const idt = formatGstnDateStrict(inv.invoiceDate);
      if (!idt) {
        if (!isExcluded) {
          sectionDetails.invalidDates.push({
            _id: inv._id,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate
          });
        }
        continue;
      }

      const ctin = getCtin(inv);
      const hasCtin = isValidCtin(ctin);

      const fallbackPos = hasCtin ? ctin.slice(0, 2) : supplierStateCode;
      const pos = sanitizePos(inv.placeOfSupply || inv.pos, fallbackPos);
      const isInterState = pos !== supplierStateCode;

      const isNote = isNoteDoc(inv);
      const isExport = !isNote && isExportSupply(inv, pos);
      const isB2B = !isExport && hasCtin;

      const grandTotalVal = absAmount(inv.grandTotal);
      const taxableVal = absAmount(inv.subTotal ?? inv.totalTaxable);
      const totalIgst = absAmount(inv.totalIgst);
      const totalCgst = absAmount(inv.totalCgst);
      const totalSgst = absAmount(inv.totalSgst);
      const totalCess = absAmount(inv.totalCess);
      const thresholdValue = grandTotalVal;

      const { items: lineItems, synthesized } = getEffectiveLineItems(inv);
      if (synthesized) sectionDetails.synthesizedLineItemsCount += 1;

      const detail = {
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        inum,
        invoiceDate: inv.invoiceDate,
        dateFormatted: idt,
        customerName: inv.customerName,
        customerGstin: ctin,
        placeOfSupply: inv.placeOfSupply || pos,
        pos,
        grandTotal: grandTotalVal,
        taxableAmount: taxableVal,
        igst: totalIgst,
        cgst: totalCgst,
        sgst: totalSgst,
        cess: totalCess,
        lineItemsCount: lineItems.length,
        documentType: inv.documentType || inv.invoiceType || 'INVOICE',
        isExcluded
      };

      sectionDetails.docIssueList.push(detail);

      if (!isExcluded) {
        validIncludedInvoices.push({
          sign: signOf(inv),
          taxable: taxableVal,
          igst: totalIgst,
          cgst: totalCgst,
          sgst: totalSgst,
          cess: totalCess,
          grandTotal: grandTotalVal
        });
      }

      // Unclassified zero-rate outward supplies (non-export, non-note).
      if (!isExcluded && !isExport && !isNote) {
        const hasUnclassifiedZero = lineItems.some((item) => {
          const det = normalizeItmDet(item, { interState: isInterState });

          return det.rt === 0 &&
            round2(det.csamt || 0) === 0 &&
            !KNOWN_ZERO_PREFS.has(resolveTaxPreference(item, inv));
        });

        if (hasUnclassifiedZero) {
          sectionDetails.unclassifiedZeroRate.push(detail);
        }
      }

      if (isNote) {
        const noteType = docTypeOf(inv) === 'CN' ? 'C' : 'D';
        const isExportNote = isExportSupply(inv, pos);
        const noteCtx = { interState: isInterState, export: isExportNote };
        const noteItms = buildItms(lineItems, noteCtx);

        if (isB2B) {
          sectionDetails.cdnr.push(detail);

          if (!isExcluded) {
            const notePayload = {
              nt_num: inum,
              nt_dt: idt,
              ntty: noteType,
              pos,
              rchrg: getRchrg(inv),
              inv_typ: deriveInvTyp(inv, pos, supplierStateCode, hasCtin, totalIgst),
              val: grandTotalVal,
              itms: noteItms
            };

            const etin = getValidEtin(inv);
            if (etin) notePayload.etin = etin;

            addIrnFields(
              notePayload,
              inv,
              idt,
              `CDNR ${ctin} note ${inum}`,
              sectionDetails,
              warnings
            );

            if (!cdnrMap.has(ctin)) cdnrMap.set(ctin, []);
            cdnrMap.get(ctin).push(notePayload);
          }
        } else {
          sectionDetails.cdnur.push(detail);

          if (!isExcluded) {
            if (isExportNote) {
              const exportNote = {
                typ: deriveCdnurExportTyp(inv.exportType, totalIgst),
                nt_num: inum,
                nt_dt: idt,
                ntty: noteType,
                val: grandTotalVal,
                itms: buildItms(lineItems, { export: true })
              };

              addIrnFields(
                exportNote,
                inv,
                idt,
                `CDNUR export note ${inum}`,
                sectionDetails,
                warnings
              );

              cdnurFlat.push(exportNote);
            } else if (isInterState && thresholdValue > b2clThreshold) {
              const b2clPos = sanitizePosDomestic(inv.placeOfSupply || inv.pos, fallbackPos);

              const b2clNote = {
                typ: 'B2CL',
                pos: b2clPos,
                nt_num: inum,
                nt_dt: idt,
                ntty: noteType,
                val: grandTotalVal,
                itms: buildItms(lineItems, { interState: true })
              };

              addIrnFields(
                b2clNote,
                inv,
                idt,
                `CDNUR B2CL note ${inum}`,
                sectionDetails,
                warnings
              );

              cdnurFlat.push(b2clNote);
            } else {
              sectionDetails.intraUnregNotes.push({
                ...detail,
                noteType,
                lineItems,
                ecom: isEcommerceSupply(inv),
                etin: getValidEtin(inv)
              });
            }
          }
        }
      } else if (isExport) {
        sectionDetails.exp.push(detail);

        if (!isExcluded) {
          const expTyp = normalizeExportType(inv.exportType) || (totalIgst > 0 ? 'WPAY' : 'WOPAY');
          if (!expMap.has(expTyp)) expMap.set(expTyp, []);

          const expInvoice = {
            inum,
            idt,
            val: grandTotalVal,
            itms: buildExpItms(lineItems)
          };

          const sbnum = cleanShippingBillNumber(inv.shippingBillNumber);
          if (sbnum) {
            expInvoice.sbnum = sbnum;
          } else if (inv.shippingBillNumber) {
            warnings.push(
              `Shipping bill number for invoice ${inum} omitted because it does not match GSTN 3-7 digit pattern.`
            );
          }

          const sbdt = formatGstnDateStrict(inv.shippingBillDate);
          if (sbdt) {
            expInvoice.sbdt = sbdt;
          } else if (inv.shippingBillDate) {
            warnings.push(
              `Shipping bill date for invoice ${inum} omitted because it is not a valid DD-MM-YYYY date.`
            );
          }

          const sbpcode = cleanPortCode(inv.portCode);
          if (sbpcode) {
            expInvoice.sbpcode = sbpcode;
          } else if (inv.portCode) {
            warnings.push(
              `Port code for invoice ${inum} omitted because it does not match GSTN 1-6 alphanumeric pattern.`
            );
          }

          addIrnFields(
            expInvoice,
            inv,
            idt,
            `EXP invoice ${inum}`,
            sectionDetails,
            warnings
          );

          expMap.get(expTyp).push(expInvoice);
        }
      } else if (isB2B) {
        sectionDetails.b2b.push(detail);

        if (!isExcluded) {
          if (!b2bMap.has(ctin)) b2bMap.set(ctin, []);

          const invoicePayload = {
            inum,
            idt,
            val: grandTotalVal,
            pos,
            rchrg: getRchrg(inv),
            inv_typ: deriveInvTyp(inv, pos, supplierStateCode, hasCtin, totalIgst),
            itms: buildItms(lineItems, { interState: isInterState })
          };

          const etin = getValidEtin(inv);
          if (etin) invoicePayload.etin = etin;
          else if (isEcommerceSupply(inv)) {
            warnings.push(
              `B2B invoice ${inum} is flagged as e-commerce supply but has no valid ETIN. ETIN omitted.`
            );
          }

          addIrnFields(
            invoicePayload,
            inv,
            idt,
            `B2B invoice ${inum}`,
            sectionDetails,
            warnings
          );

          b2bMap.get(ctin).push(invoicePayload);
        }
      } else if (isInterState && thresholdValue > b2clThreshold) {
        sectionDetails.b2cl.push(detail);

        if (!isExcluded) {
          const b2clPos = sanitizePosDomestic(inv.placeOfSupply || inv.pos, fallbackPos);
          if (!b2clMap.has(b2clPos)) b2clMap.set(b2clPos, []);

          const b2clInvoice = {
            inum,
            idt,
            val: grandTotalVal,
            itms: buildItms(lineItems, { interState: true })
          };

          const etin = getValidEtin(inv);
          if (etin) b2clInvoice.etin = etin;
          else if (isEcommerceSupply(inv)) {
            warnings.push(
              `B2CL invoice ${inum} is flagged as e-commerce supply but has no valid ETIN. ETIN omitted.`
            );
          }

          b2clMap.get(b2clPos).push(b2clInvoice);
        }
      } else {
        sectionDetails.b2cs.push(detail);

        if (!isExcluded) {
          const b2csPos = sanitizePosDomestic(inv.placeOfSupply || inv.pos, fallbackPos);
          const sply_ty = isInterState ? 'INTER' : 'INTRA';

          const validEtin = getValidEtin(inv);
          const ecommerce = isEcommerceSupply(inv);

          let typ = 'OE';
          let etin = '';

          if (validEtin) {
            typ = 'E';
            etin = validEtin;
          } else if (ecommerce) {
            warnings.push(
              `Invoice ${inum} is flagged as e-commerce supply but has no valid ETIN. It is reported as OE in B2CS.`
            );
          }

          for (const item of lineItems) {
            const det = normalizeItmDet(item, { interState: sply_ty === 'INTER' });

            // Include zero-rate rows only if cess exists; pure nil/exempt/non-GST goes to Table 8.
            if (det.rt === 0 && round2(det.csamt || 0) === 0) continue;

            const rt = det.rt;
            const key = `${typ}|${etin}|${sply_ty}|${b2csPos}|${rt}`;

            if (!b2csMap.has(key)) {
              b2csMap.set(key, {
                typ,
                etin,
                sply_ty,
                pos: b2csPos,
                rt,
                txval: 0,
                iamt: 0,
                camt: 0,
                samt: 0,
                csamt: 0
              });
            }

            const row = b2csMap.get(key);
            row.txval += absAmount(det.txval);

            if (sply_ty === 'INTER') {
              row.iamt += absAmount(det.iamt || 0);
              row.camt = 0;
              row.samt = 0;
            } else {
              row.camt += absAmount(det.camt || 0);
              row.samt += absAmount(det.samt || 0);
              row.iamt = 0;
            }

            row.csamt += absAmount(det.csamt || 0);
          }
        }
      }

      // Nil-rated / exempt / non-GST buckets.
      if (!isExcluded && !isExport && !isNote) {
        for (const item of lineItems) {
          const det = normalizeItmDet(item, { interState: isInterState });

          if (det.rt !== 0 || round2(det.csamt || 0) !== 0) continue;

          const pref = resolveTaxPreference(item, inv);
          if (!KNOWN_ZERO_PREFS.has(pref)) continue;

          const supplyType = isInterState
            ? (isB2B ? 'INTRB2B' : 'INTRB2C')
            : (isB2B ? 'INTRAB2B' : 'INTRAB2C');

          const amt = absAmount(item.taxableAmount ?? item.amount);
          if (amt <= 0) continue;

          if (pref === 'EXEMPT') nilBuckets[supplyType].expt_amt += amt;
          else if (pref === 'NON_GST') nilBuckets[supplyType].ngsup_amt += amt;
          else nilBuckets[supplyType].nil_amt += amt;

          hasNilSupplies = true;
        }
      }

      // HSN summary — net of credit notes.
      if (!isExcluded) {
        const hsnSign = signOf(inv);

        for (const item of lineItems) {
          const rawHsn = item.hsnSac || item.hsnCode || item.hsn || inv.hsnSac || inv.hsnCode || inv.sacCode;
          let hsnCode = toHsnCode(rawHsn);

          if (!hsnCode) {
            sectionDetails.invalidHsn.push({
              invoiceNumber: inv.invoiceNumber,
              inum,
              itemName: item.name || 'Unknown item',
              rawHsn
            });
            hsnCode = '9999';
          }

          const rt = getItemEffectiveRate(item);
          const uqc = cleanUqc(item.unit || item.uqc || inv.uqc || inv.unit, DEFAULT_UQC);
          const key = `${hsnCode}|${uqc}|${rt}`;

          if (!hsnMap.has(key)) {
            const hsnDesc = String(item.name || inv.description || 'Goods and Services').trim().slice(0, 30) || 'Goods and Services';
            hsnMap.set(key, {
              hsn_sc: hsnCode,
              desc: hsnDesc,
              uqc,
              qty: 0,
              rt,
              txval: 0,
              iamt: 0,
              camt: 0,
              samt: 0,
              csamt: 0
            });
          }

          const hsnRow = hsnMap.get(key);
          hsnRow.qty += hsnSign * absAmount(item.quantity);
          hsnRow.txval += hsnSign * absAmount(item.taxableAmount ?? item.amount);
          hsnRow.iamt += hsnSign * absAmount(item.igstAmount ?? item.igst);
          hsnRow.camt += hsnSign * absAmount(item.cgstAmount ?? item.cgst);
          hsnRow.samt += hsnSign * absAmount(item.sgstAmount ?? item.sgst);
          hsnRow.csamt += hsnSign * absAmount(item.cessAmount ?? item.cess);
        }
      }
    }

    if (sectionDetails.synthesizedLineItemsCount > 0) {
      warnings.push(
        `${sectionDetails.synthesizedLineItemsCount} invoice(s) had no line items. Synthetic line item(s) were created from invoice header totals.`
      );
    }

    if (excludedActiveCount > 0 && treatExcludedAsCancelled) {
      warnings.push(
        `${excludedActiveCount} active invoice(s) are excluded from outward supply tables and are being reported as cancelled in Table 13 document series.`
      );
    }

    // Fold intra-state / small unregistered credit/debit notes into B2CS as net adjustments.
    for (const n of sectionDetails.intraUnregNotes || []) {
      if (n.isExcluded) continue;

      const sgn = n.noteType === 'C' ? -1 : 1;
      const b2csPos = sanitizePosDomestic(n.pos, supplierStateCode);
      const sply_ty = b2csPos !== supplierStateCode ? 'INTER' : 'INTRA';

      const validEtin = n.etin || '';
      const ecommerce = n.ecom;

      let typ = 'OE';
      let etin = '';

      if (validEtin) {
        typ = 'E';
        etin = validEtin;
      } else if (ecommerce) {
        warnings.push(
          `Note ${n.inum || n.invoiceNumber || 'unknown'} is flagged as e-commerce supply but has no valid ETIN. It is folded into B2CS as OE.`
        );
      }

      for (const item of (n.lineItems || [])) {
        const det = normalizeItmDet(item, { interState: sply_ty === 'INTER' });

        if (det.rt === 0 && round2(det.csamt || 0) === 0) continue;

        const rt = det.rt;
        const key = `${typ}|${etin}|${sply_ty}|${b2csPos}|${rt}`;

        if (!b2csMap.has(key)) {
          b2csMap.set(key, {
            typ,
            etin,
            sply_ty,
            pos: b2csPos,
            rt,
            txval: 0,
            iamt: 0,
            camt: 0,
            samt: 0,
            csamt: 0
          });
        }

        const row = b2csMap.get(key);
        row.txval += sgn * absAmount(det.txval);

        if (sply_ty === 'INTER') {
          row.iamt += sgn * absAmount(det.iamt || 0);
          row.camt = 0;
          row.samt = 0;
        } else {
          row.camt += sgn * absAmount(det.camt || 0);
          row.samt += sgn * absAmount(det.samt || 0);
          row.iamt = 0;
        }

        row.csamt += sgn * absAmount(det.csamt || 0);
      }
    }

    const b2b = Array.from(b2bMap.entries())
      .map(([ctin, invList]) => ({ ctin, inv: invList }))
      .sort((a, b) => a.ctin.localeCompare(b.ctin));

    b2b.forEach((party) => sortInvoiceList(party.inv));

    const b2cl = Array.from(b2clMap.entries())
      .map(([pos, invList]) => ({ pos, inv: invList }))
      .sort((a, b) => a.pos.localeCompare(b.pos));

    b2cl.forEach((group) => sortInvoiceList(group.inv));

    const b2cs = Array.from(b2csMap.values())
      .map((row) => {
        // Safety: never send ETIN for OE rows.
        if (row.typ === 'E' && !row.etin) {
          row.typ = 'OE';
          row.etin = '';
        }

        const out = {
          typ: row.typ,
          sply_ty: row.sply_ty,
          pos: row.pos,
          rt: round2(row.rt),
          txval: round2(row.txval),
          iamt: row.sply_ty === 'INTER' ? round2(row.iamt) : 0,
          camt: row.sply_ty === 'INTRA' ? round2(row.camt) : 0,
          samt: row.sply_ty === 'INTRA' ? round2(row.samt) : 0,
          csamt: round2(row.csamt)
        };

        if (out.typ === 'E' && row.etin) out.etin = row.etin;

        return out;
      })
      .filter((row) =>
        row.txval !== 0 ||
        row.iamt !== 0 ||
        row.camt !== 0 ||
        row.samt !== 0 ||
        row.csamt !== 0
      )
      .sort((a, b) =>
        a.typ.localeCompare(b.typ) ||
        a.sply_ty.localeCompare(b.sply_ty) ||
        a.pos.localeCompare(b.pos) ||
        (a.rt - b.rt) ||
        String(a.etin || '').localeCompare(String(b.etin || ''))
      );

    const exp = Array.from(expMap.entries())
      .map(([expTyp, invList]) => ({ exp_typ: expTyp, inv: invList }))
      .sort((a, b) => a.exp_typ.localeCompare(b.exp_typ));

    exp.forEach((group) => sortInvoiceList(group.inv));

    const cdnr = Array.from(cdnrMap.entries())
      .map(([ctin, noteList]) => ({ ctin, nt: noteList }))
      .sort((a, b) => a.ctin.localeCompare(b.ctin));

    cdnr.forEach((party) => sortInvoiceList(party.nt));

    const cdnur = cdnurFlat.sort((a, b) =>
      String(a.nt_dt || '').localeCompare(String(b.nt_dt || '')) ||
      naturalSortStrings(a.nt_num || '', b.nt_num || '')
    );

    const allHsnRows = Array.from(hsnMap.values())
      .map((row) => {
        const qty = round2(row.qty);
        const txval = round2(row.txval);
        const iamt = round2(row.iamt);
        const camt = round2(row.camt);
        const samt = round2(row.samt);
        const csamt = round2(row.csamt);
        const rt = round2(row.rt);

        const hasTax = iamt !== 0 || camt !== 0 || samt !== 0 || csamt !== 0;

        const out = {
          hsn_sc: row.hsn_sc,
          desc: String(row.desc || 'Goods and Services').trim().slice(0, 30) || 'Goods and Services',
          uqc: row.uqc,
          qty,
          txval
        };

        // Rate-wise only when tax exists. Zero-tax rows are reported value-wise.
        if (hasTax) {
          out.rt = rt;
        } else {
          out.val = txval;
        }

        if (iamt !== 0) out.iamt = iamt;
        if (camt !== 0) out.camt = camt;
        if (samt !== 0) out.samt = samt;
        if (csamt !== 0) out.csamt = csamt;

        return out;
      })
      .filter((row) =>
        row.qty !== 0 ||
        row.txval !== 0 ||
        row.iamt !== 0 ||
        row.camt !== 0 ||
        row.samt !== 0 ||
        row.csamt !== 0 ||
        row.val !== 0
      )
      .sort((a, b) =>
        a.hsn_sc.localeCompare(b.hsn_sc) ||
        a.uqc.localeCompare(b.uqc) ||
        ((a.rt || 0) - (b.rt || 0))
      )
      .map((row, idx) => ({
        num: idx + 1,
        ...row
      }));

    sectionDetails.hsn = allHsnRows;

    /* ---------------------------------------------------------------- */
    /* Document series summary (Table 13)                                */
    /* GSTN rule: totnum − cancel = net_issue                            */
    /* ---------------------------------------------------------------- */

    const buildSeries = (typeCode) => {
      const ofType = allInvoices.filter((i) => docTypeOf(i) === typeCode);
      const issuedOrCancelled = ofType.filter(isIssuedStatus);
      const cancelledOfType = issuedOrCancelled.filter(isCancelledStatus).length;
      const activeNonCancelled = issuedOrCancelled.filter(isFinalizedStatus);
      const includedOfType = activeNonCancelled.filter((i) => !excludedIds.has(String(i._id)));
      const excludedOfType = activeNonCancelled.length - includedOfType.length;

      const validNums = issuedOrCancelled
        .map((i) => toGstr1Inum(i.invoiceNumber))
        .filter(Boolean);

      const nums = validNums.sort(naturalSortStrings);
      const invalidIssued = issuedOrCancelled.length - validNums.length;

      if (invalidIssued > 0) {
        warnings.push(
          `Document series '${typeCode}' has ${invalidIssued} issued/cancelled document(s) with invalid GSTN invoice numbers. Table 13 from/to range may be incomplete.`
        );
      }

      const totnum = issuedOrCancelled.length;
      const cancel = treatExcludedAsCancelled ? (cancelledOfType + excludedOfType) : cancelledOfType;
      const net_issue = treatExcludedAsCancelled ? includedOfType.length : activeNonCancelled.length;

      const from = nums[0] || null;
      const to = nums[nums.length - 1] || null;

      if (totnum > 0 && (!from || !to)) {
        warnings.push(
          `Document series '${typeCode}' has issued/cancelled documents but no valid GSTN invoice numbers. Table 13 series omitted for this document type.`
        );
      }

      return {
        typeCode,
        from,
        to,
        totnum,
        cancel,
        net_issue,
        cancelled: cancelledOfType,
        excludedActive: excludedOfType,
        activeNonCancelled: activeNonCancelled.length,
        included: includedOfType.length,
        invalidIssued,
        totalCount: ofType.length
      };
    };

    const invSeries = buildSeries('INV');
    const cnSeries = buildSeries('CN');
    const dnSeries = buildSeries('DN');
    const allSeries = [invSeries, cnSeries, dnSeries];

    sectionDetails.docSeries = allSeries;

    const docRange = {
      from: invSeries.from || '1',
      to: invSeries.to || invSeries.from || '1',
      totnum: invSeries.totnum,
      cancel: invSeries.cancel,
      canc: invSeries.cancel,
      net_issue: invSeries.net_issue,
      totalCount: allInvoices.length
    };

    sectionDetails.docIssue = docRange;

    const doc_det = allSeries
      .filter((s) => s.totnum > 0 && s.from && s.to)
      .map((s) => ({
        doc_num: DOC_NUM_BY_TYPE[s.typeCode],
        doc_typ: DOC_TYP_LABELS[s.typeCode] || s.typeCode,
        docs: [{
          num: 1,
          from: s.from,
          to: s.to,
          totnum: Math.max(0, Math.round(s.totnum)),
          cancel: Math.max(0, Math.round(s.cancel)),
          net_issue: Math.max(0, Math.round(s.net_issue))
        }]
      }))
      .sort((a, b) => a.doc_num - b.doc_num);

    const doc_issue = doc_det.length > 0 ? { doc_det } : null;

    /* ---------------------------------------------------------------- */
    /* Aggregate summary totals applying negative sign for credit notes */
    /* ---------------------------------------------------------------- */

    let totalTaxable = 0;
    let totalIgst = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalCess = 0;
    let grandTotal = 0;
    let grossTurnover = 0;

    for (const inv of validIncludedInvoices) {
      const sign = inv.sign;
      totalTaxable += sign * inv.taxable;
      totalIgst += sign * inv.igst;
      totalCgst += sign * inv.cgst;
      totalSgst += sign * inv.sgst;
      totalCess += sign * inv.cess;
      grandTotal += sign * inv.grandTotal;
      grossTurnover += inv.grandTotal;
    }

    const calcSectionStats = (items) => {
      const all = items || [];
      const active = all.filter((item) => !item.isExcluded);
      const sum = (fn) => active.reduce((acc, item) => acc + fn(item), 0);

      const taxable = sum((i) => num(i.taxableAmount, 0));
      const igst = sum((i) => num(i.igst, 0));
      const cgst = sum((i) => num(i.cgst, 0));
      const sgst = sum((i) => num(i.sgst, 0));
      const cess = sum((i) => num(i.cess, 0));

      return {
        count: all.length,
        included: active.length,
        taxable: round2(taxable),
        tax: round2(igst + cgst + sgst + cess)
      };
    };

    const b2bStats = calcSectionStats(sectionDetails.b2b);
    const b2clStats = calcSectionStats(sectionDetails.b2cl);
    const b2csStats = calcSectionStats(sectionDetails.b2cs);
    const expStats = calcSectionStats(sectionDetails.exp);
    const cdnrStats = calcSectionStats(sectionDetails.cdnr);
    const cdnurStats = calcSectionStats(sectionDetails.cdnur);

    const summary = {
      totalInvoices: activeInvoices.length,
      allInvoicesCount: allInvoices.length,
      includedInvoices: validIncludedInvoices.length,
      excludedInvoices: excludedActiveCount,
      cancelledInvoices: cancelledCount,
      synthesizedLineItemsCount: sectionDetails.synthesizedLineItemsCount,
      treatExcludedAsCancelled,
      totalTaxable: round2(totalTaxable),
      totalIgst: round2(totalIgst),
      totalCgst: round2(totalCgst),
      totalSgst: round2(totalSgst),
      totalCess: round2(totalCess),
      totalTax: round2(totalIgst + totalCgst + totalSgst + totalCess),
      grandTotal: round2(grandTotal),
      grossTurnover: round2(grossTurnover),
      b2clThreshold,
      sections: {
        b2bCount: b2bStats.count,
        b2bIncluded: b2bStats.included,
        b2bTaxable: b2bStats.taxable,
        b2bTax: b2bStats.tax,
        b2clCount: b2clStats.count,
        b2clIncluded: b2clStats.included,
        b2clTaxable: b2clStats.taxable,
        b2clTax: b2clStats.tax,
        b2csCount: b2csStats.count,
        b2csIncluded: b2csStats.included,
        b2csTaxable: b2csStats.taxable,
        b2csTax: b2csStats.tax,
        expCount: expStats.count,
        expIncluded: expStats.included,
        expTaxable: expStats.taxable,
        expTax: expStats.tax,
        cdnrCount: cdnrStats.count,
        cdnrIncluded: cdnrStats.included,
        cdnrTaxable: cdnrStats.taxable,
        cdnrTax: cdnrStats.tax,
        cdnurCount: cdnurStats.count,
        cdnurIncluded: cdnurStats.included,
        cdnurTaxable: cdnurStats.taxable,
        cdnurTax: cdnurStats.tax,
        hsnCount: allHsnRows.length,
        missingIrnCount: sectionDetails.missingIrn.length,
        docRange,
        docSeries: allSeries
      },
      warnings
    };

    /* ---------------------------------------------------------------- */
    /* Official GSTN GSTR-1 RETSAVE payload                              */
    /* ---------------------------------------------------------------- */

    const payload = {
      gstin: normGstin,
      fp: period
    };

    // gt / cur_gt are optional. Do not send 0 by default.
    if (options.prevFyTurnover !== undefined && options.prevFyTurnover !== null) {
      payload.gt = round2(Math.max(0, num(options.prevFyTurnover, 0)));
    }

    if (options.currentFyTurnover !== undefined && options.currentFyTurnover !== null) {
      payload.cur_gt = round2(Math.max(0, num(options.currentFyTurnover, 0)));
    }

    if (b2b.length > 0) payload.b2b = b2b;
    if (b2cl.length > 0) payload.b2cl = b2cl;
    if (b2cs.length > 0) payload.b2cs = b2cs;
    if (cdnr.length > 0) payload.cdnr = cdnr;
    if (cdnur.length > 0) payload.cdnur = cdnur;
    if (exp.length > 0) payload.exp = exp;

    if (allHsnRows.length > 0) {
      payload.hsn = { data: allHsnRows };
    }

    if (doc_issue) {
      payload.doc_issue = doc_issue;
    }

    if (hasNilSupplies) {
      const nilInv = Object.values(nilBuckets)
        .map((b) => ({
          sply_ty: b.sply_ty,
          nil_amt: round2(b.nil_amt),
          expt_amt: round2(b.expt_amt),
          ngsup_amt: round2(b.ngsup_amt)
        }))
        .filter((row) => row.nil_amt !== 0 || row.expt_amt !== 0 || row.ngsup_amt !== 0);

      if (nilInv.length > 0) {
        payload.nil = { inv: nilInv };
      }
    }

    const normalizedPayload = normalizeGstr1Payload(payload);

    return {
      success: true,
      period,
      gstin: normGstin,
      summary,
      payload: normalizedPayload,
      sectionDetails,
      warnings,
      treatExcludedAsCancelled,
      excludedActiveCount
    };
  }

  static validateFilingPayload(prepared) {
    const sd = prepared?.sectionDetails || {};

    if ((sd.invalidInvoiceNumbers || []).length > 0) {
      const samples = sd.invalidInvoiceNumbers
        .slice(0, 3)
        .map((x) => x.invoiceNumber || x.inum || 'unknown')
        .join(', ');

      throw ApiError.validationError(
        `GSTR-1 filing blocked: one or more included invoices have invalid GSTN invoice numbers. GSTN inum must be 1-16 chars using only letters, digits, '/' or '-', and must contain at least one letter or non-zero digit. Affected: ${samples}`
      );
    }

    if ((sd.invalidDates || []).length > 0) {
      const samples = sd.invalidDates
        .slice(0, 3)
        .map((x) => x.invoiceNumber || 'unknown')
        .join(', ');

      throw ApiError.validationError(
        `GSTR-1 filing blocked: one or more included invoices have invalid invoice dates. GSTN requires valid DD-MM-YYYY calendar dates. Affected: ${samples}`
      );
    }

    if ((sd.unclassifiedZeroRate || []).length > 0) {
      const samples = sd.unclassifiedZeroRate
        .slice(0, 3)
        .map((x) => x.invoiceNumber || x.inum || 'unknown')
        .join(', ');

      throw ApiError.validationError(
        `GSTR-1 filing blocked because zero-rate outward supplies need nil/exempt/non-GST classification. Please review the "Unclassified Zero-Rate" section. Affected: ${samples}`
      );
    }

    if ((sd.invalidHsn || []).length > 0) {
      const samples = sd.invalidHsn
        .slice(0, 3)
        .map((x) => `${x.invoiceNumber || x.inum || 'unknown'} (${x.itemName || 'item'})`)
        .join(', ');

      throw ApiError.validationError(
        `GSTR-1 filing blocked: line item(s) have missing or invalid HSN/SAC code. HSN/SAC must be 2-8 digits. Affected: ${samples}`
      );
    }

    if ((sd.missingIrn || []).length > 0) {
      const samples = sd.missingIrn
        .slice(0, 3)
        .map((x) => `${x.invoiceNumber || x.reference || 'unknown'} [${x.location}]`)
        .join(', ');

      throw ApiError.validationError(
        `GSTR-1 filing blocked: B2B invoices, credit/debit notes, and export invoices require IRN, IRN generation date, and source type as per GSTN RETSAVE schema. Affected: ${samples}`
      );
    }

    if ((prepared?.excludedActiveCount || 0) > 0 && !prepared?.treatExcludedAsCancelled) {
      throw ApiError.validationError(
        'GSTR-1 filing blocked: invoices are excluded from outward supply tables but Table 13 is not configured to treat them as cancelled. Either include them, set treatExcludedAsCancelled=true, or adjust document series manually.'
      );
    }

    for (const s of sd.docSeries || []) {
      if (s.totnum > 0 && s.net_issue > 0 && (!s.from || !s.to)) {
        throw ApiError.validationError(
          `Document series (${s.typeCode}) has included documents but no valid from/to invoice number range. Filing aborted.`
        );
      }

      if (s.totnum > 0 && s.from && s.to) {
        if (s.totnum - s.cancel !== s.net_issue) {
          throw ApiError.validationError(
            `Document series (${s.typeCode}) is inconsistent: totnum(${s.totnum}) - cancel(${s.cancel}) != net_issue(${s.net_issue}). Filing aborted.`
          );
        }
      }
    }
  }

  /**
   * Prepares GSTR-1 payload, runs internal sanity checks, normalizes legacy shape,
   * and validates against strict official GSTN RETSAVE request schema.
   */
  static async prepareAndValidate(workspaceId, gstin, period, options = {}) {
    const prepared = await Gstr1Service.preparePayload(workspaceId, gstin, period, options);

    Gstr1Service.validateFilingPayload(prepared);

    prepared.payload = normalizeGstr1Payload(prepared.payload);
    validateGstr1Schema(prepared.payload);

    return prepared;
  }

  static async savePayload(workspaceId, gstin, period, options = {}) {
    let prepared = options.prepared;

    if (!prepared) {
      prepared = await Gstr1Service.prepareAndValidate(workspaceId, gstin, period, options);
    } else {
      Gstr1Service.validateFilingPayload(prepared);
      prepared.payload = normalizeGstr1Payload(prepared.payload);
      validateGstr1Schema(prepared.payload);
    }

    const isFilingEnabled = isLiveFilingEnabled();
    const idempotencyKey = options.idempotencyKey || null;

    if (!isFilingEnabled) {
      await writeAudit({
        workspaceId,
        memberId: options.memberId || null,
        gstin: prepared.gstin,
        action: 'GSTR1_SAVE_DRY_RUN',
        period,
        status: 'SUCCESS',
        metadata: {
          ref_id: 'DRY-RUN',
          summary: prepared.summary,
          excludedInvoiceIds: options.excludedInvoiceIds || [],
          idempotencyKey
        }
      });

      return {
        success: true,
        dryRun: true,
        message: 'GSTR-1 payload validated in dry-run mode. Live portal upload is disabled in this environment.',
        ref_id: `DRY-RUN-${Date.now()}`,
        period,
        gstin: prepared.gstin,
        summary: prepared.summary,
        payload: prepared.payload
      };
    }

    const FinaggService = require('./finagg.service');
    const provider = FinaggService.getProvider();

    if (!provider || typeof provider.saveGstr1 !== 'function') {
      throw ApiError.providerError('Active GST provider does not support GSTR-1 RETSAVE.', 502);
    }

    let result;

    try {
      result = await provider.saveGstr1(prepared.payload, {
        gstin: prepared.gstin,
        period,
        username: options.username,
        token: options.gstToken || options.token,
        gstToken: options.gstToken || options.token,
        idempotencyKey
      });
    } catch (err) {
      await writeAudit({
        workspaceId,
        memberId: options.memberId || null,
        gstin: prepared.gstin,
        action: 'GSTR1_SAVE_FAILED',
        period,
        status: 'FAILED',
        metadata: {
          error: safeErrorMessage(err),
          errorCd: err?.errorCd,
          code: err?.code,
          idempotencyKey,
          summary: prepared.summary
        }
      });

      throw err;
    }

    const refId = result?.reference_id || result?.ref_id;

    if (!refId) {
      throw ApiError.providerError(
        'GSTR-1 RETSAVE response did not include required reference_id. Save was not confirmed.',
        502
      );
    }

    await writeAudit({
      workspaceId,
      memberId: options.memberId || null,
      gstin: prepared.gstin,
      action: 'GSTR1_SAVE',
      period,
      status: 'SUCCESS',
      metadata: {
        ref_id: refId,
        summary: prepared.summary,
        excludedInvoiceIds: options.excludedInvoiceIds || [],
        idempotencyKey
      }
    });

    return {
      success: true,
      dryRun: false,
      message: 'GSTR-1 successfully uploaded and saved to GSTN Portal!',
      ref_id: refId,
      reference_id: refId,
      period,
      gstin: prepared.gstin,
      summary: prepared.summary
    };
  }

  static validatePayload(payload) {
    const normalized = normalizeGstr1Payload(payload);
    validateGstr1Schema(normalized);
    return normalized;
  }
}

module.exports = Gstr1Service;