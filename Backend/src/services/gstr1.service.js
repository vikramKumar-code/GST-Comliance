const Invoice = require('../models/Invoice');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { isValidGstin, isValidPeriod } = require('../utils/gstin');
const FinaggService = require('./finagg.service');
const { isLiveFilingEnabled } = require('../utils/filingMode');
const { validateGstr1Schema } = require('../utils/gstr1Validator');

/* -------------------------------------------------------------------------- */
/* Config — verify these against utils/gstr1Validator.js + TaxPro sample       */
/* -------------------------------------------------------------------------- */

// IST-aware month boundaries (GST_TZ_OFFSET_MIN=330 for India, UTC+05:30)
const TZ_OFFSET_MIN = Number(process.env.GST_TZ_OFFSET_MIN || 330);

// GSTN doc_issue uses descriptive strings for document types
// Agar aapka validator short codes ('INV'/'CN'/'DN') expect karta hai, toh .env me override karein:
//   GSTN_DOC_TYP_INV=INV
//   GSTN_DOC_TYP_CN=CN
//   GSTN_DOC_TYP_DN=DN
const DOC_TYP_LABELS = {
  INV: process.env.GSTN_DOC_TYP_INV || 'Invoices for outward supply',
  CN: process.env.GSTN_DOC_TYP_CN || 'Credit Note',
  DN: process.env.GSTN_DOC_TYP_DN || 'Debit Note'
};

// Standard GSTN Unit Quantity Codes (UQC)
// Validator reject kare toh .env me: GSTN_DEFAULT_UQC=PCS-PIECES
const DEFAULT_UQC = process.env.GSTN_DEFAULT_UQC || 'PCS';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Recursively trim all keys + string values (numbers preserved)
function deepClean(obj) {
  if (typeof obj === 'string') return obj.trim();
  if (typeof obj === 'number') return obj;
  if (Array.isArray(obj)) return obj.map(deepClean);
  if (obj && typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      cleaned[key.trim()] = deepClean(value);
    }
    return cleaned;
  }
  return obj;
}

// Safe numeric helpers ensuring valid JSON serialization without NaN or null
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const round2 = (v) => {
  const n = num(v, 0);
  return Math.round(n * 100) / 100;
};

const absAmount = (v) => round2(Math.abs(num(v, 0)));
const posAmount = (v) => round2(Math.max(0, num(v, 0)));

// Strict GSTN date format regex (DD-MM-YYYY)
const GSTN_DATE_REGEX = /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-\d{4}$/;

// Calendar date validator verifying leap years and days in each month
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

// Formats date into standard GSTN DD-MM-YYYY format in Indian Standard Time
function formatGstnDate(dateVal, fallbackDateStr) {
  if (dateVal) {
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) {
      const offsetMs = TZ_OFFSET_MIN * 60 * 1000;
      const local = new Date(d.getTime() + offsetMs);
      const day = String(local.getUTCDate()).padStart(2, '0');
      const month = String(local.getUTCMonth() + 1).padStart(2, '0');
      const year = local.getUTCFullYear();
      const formatted = `${day}-${month}-${year}`;
      if (isGstnDate(formatted)) return formatted;
    }
  }
  if (fallbackDateStr && isGstnDate(fallbackDateStr)) {
    return fallbackDateStr;
  }
  const now = new Date(Date.now() + TZ_OFFSET_MIN * 60 * 1000);
  const day = String(now.getUTCDate()).padStart(2, '0');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const year = now.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

// Valid GST state codes per GSTN schema (01-38, 96, 97)
const VALID_STATE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '96', '97'
]);

// Domestic state codes for B2CL/B2CS (excluding 96 foreign)
const VALID_STATE_DOMESTIC = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '97'
]);

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

// Backward-compat alias
const extractPos = sanitizePos;

// Official GSTN invoice number pattern: 1-16 characters, alphanumeric with / and -
const GSTN_INUM_REGEX = /^(?=.{1,16}$)([0\/-]*[a-zA-Z0-9\/-]*[a-zA-Z1-9]+[a-zA-Z0-9\/-]*)$/;

function cleanInum(s, fallback = 'INV-1') {
  let v = String(s ?? '').trim().replace(/[^A-Za-z0-9/\-]/g, '');
  if (v.length > 16) v = v.slice(0, 16);
  if (!v || !GSTN_INUM_REGEX.test(v)) {
    const candidate = `INV-${v}`.slice(0, 16);
    if (GSTN_INUM_REGEX.test(candidate)) return candidate;
    return fallback;
  }
  return v;
}

// Normalizes GST rate to two decimal places within 0 to 999.99
function sanitizeRate(raw, fallback = 0) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = typeof raw === 'string' ? parseFloat(raw.replace(/[^0-9.]/g, '')) : Number(raw);
  if (!Number.isFinite(n) || Number.isNaN(n) || n < 0) return fallback;
  if (n > 999.99) return 999.99;
  return Math.round(n * 100) / 100;
}

// Sanitizes HSN code to 2-8 digits without punctuation or spaces
function cleanHsn(raw) {
  let v = String(raw ?? '').trim().replace(/[^0-9]/g, '');
  if (v.length > 8) v = v.slice(0, 8);
  return v;
}

// Sanitizes Unit Quantity Code (UQC) per GSTN schema requirements
function cleanUqc(raw, fallback = 'OTH') {
  let v = String(raw ?? '').trim().replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (!v) v = fallback;
  if (v.length > 30) v = v.slice(0, 30);
  return v;
}

// Export type normalization strictly mapped to 'WPAY' or 'WOPAY' (Table 6A)
function normalizeExportType(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (['WPAY', 'WP', 'WITH_PAY', 'WITH_PAYMENT', 'PAY', 'EXPWP'].includes(s)) return 'WPAY';
  if (['WOPAY', 'WOP', 'WITHOUT_PAY', 'WITHOUT_PAYMENT', 'NOPAY', 'EXPWOP'].includes(s)) return 'WOPAY';
  return null;
}

// CDNUR export type mapping ('EXPWP' or 'EXPWOP' for Table 9B unregistered notes)
function deriveCdnurExportTyp(raw, totalIgst = 0) {
  const norm = normalizeExportType(raw);
  if (norm === 'WPAY') return 'EXPWP';
  if (norm === 'WOPAY') return 'EXPWOP';
  return num(totalIgst, 0) > 0 ? 'EXPWP' : 'EXPWOP';
}

function isExportSupply(inv, pos) {
  // B2B recipient with valid Indian GSTIN is NEVER a direct Table 6A export
  // (e.g. SEZ supplies with GSTIN are Table 4 B2B with inv_typ 'SEWP' / 'SEWOP')
  const hasValidGstin = inv.customerGstin && isValidGstin(String(inv.customerGstin).trim().toUpperCase());
  if (hasValidGstin) return false;

  if (pos === '96') return true;
  if (inv.isExport === true || String(inv.isExport).toLowerCase() === 'true') return true;
  if (normalizeExportType(inv.exportType) !== null) return true;
  return false;
}

// Enforces tax heads based on Place of Supply (Intra-state CGST/SGST vs Inter-state IGST)
// Inter-state / Export: IGST + Cess, CGST/SGST = 0 (omitted per schema)
// Intra-state: CGST + SGST + Cess, IGST = 0 (omitted per schema)
function normalizeItmDet(item, ctx = {}) {
  const rt = sanitizeRate(item.gstRate);
  const txval = absAmount(item.taxableAmount);

  const igst = absAmount(item.igstAmount);
  const cgst = absAmount(item.cgstAmount);
  const sgst = absAmount(item.sgstAmount);
  const cess = absAmount(item.cessAmount);

  // Export ya inter-state: only IGST + cess
  if (ctx.export || ctx.interState) {
    return {
      rt,
      txval,
      iamt: round2(igst + cgst + sgst),
      csamt: cess
    };
  }

  // Intra-state: only CGST + SGST + cess
  let camt = cgst;
  let samt = sgst;

  if (camt === 0 && samt === 0 && igst > 0) {
    camt = round2(igst / 2);
    samt = round2(igst - camt);
  } else if (igst > 0) {
    const totalTax = round2(igst + camt + samt);
    camt = round2(totalTax / 2);
    samt = round2(totalTax - camt);
  }

  return {
    rt,
    txval,
    camt,
    samt,
    csamt: cess
  };
}

// Derives statutory invoice type (R=Regular, DE=Deemed Export, SEWP=SEZ with payment, SEWOP=SEZ without payment)
function deriveInvTyp(inv, pos, supplierStateCode) {
  const t = String(inv.invoiceType || inv.exportType || '').toUpperCase();

  if (['SEWP', 'SEZWP'].includes(t)) return 'SEWP';
  if (['SEWOP', 'SEZWOP'].includes(t)) return 'SEWOP';
  if (['DE', 'DEEMED', 'DEEMED_EXPORT'].includes(t)) return 'DE';
  if (t === 'CBW') return 'CBW';

  // Registered recipient but foreign/SEZ POS → treat as SEZ supply
  if (pos === '96' && pos !== supplierStateCode) {
    return num(inv.totalIgst, 0) > 0 ? 'SEWP' : 'SEWOP';
  }

  // Explicit export flag but registered GSTIN recipient (e.g. SEZ unit)
  if (
    (inv.isExport === true || String(inv.isExport).toLowerCase() === 'true') &&
    inv.customerGstin &&
    isValidGstin(String(inv.customerGstin).trim().toUpperCase())
  ) {
    return num(inv.totalIgst, 0) > 0 ? 'SEWP' : 'SEWOP';
  }

  return 'R';
}

// Natural numerical sort for invoice series (e.g., INV-2 before INV-10)
const sortDocNumbers = (nums) =>
  [...nums].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));

const docTypeOf = (inv) =>
  inv.documentType === 'CREDIT_NOTE' ? 'CN'
    : inv.documentType === 'DEBIT_NOTE' ? 'DN'
      : 'INV';

// Credit notes decrease outward turnover and tax liability
const signOf = (inv) => (inv.documentType === 'CREDIT_NOTE' ? -1 : 1);

class Gstr1Service {
  static async preparePayload(workspaceId, gstin, period, options = {}) {
    if (!workspaceId) throw ApiError.validationError('Active workspaceId is required to prepare GSTR-1.');

    const normGstin = (gstin || '').trim().toUpperCase();
    if (!isValidGstin(normGstin)) throw ApiError.invalidGstin('Invalid GSTIN format.');
    if (!isValidPeriod(period)) throw ApiError.validationError('Invalid return period format. Must be MMYYYY.');

    const month = parseInt(period.slice(0, 2), 10);
    const year = parseInt(period.slice(2), 10);
    const defaultPeriodDate = `01-${period.slice(0, 2)}-${period.slice(2, 6)}`;

    // Month start and end timestamps aligned with Indian Standard Time
    const offsetMs = TZ_OFFSET_MIN * 60 * 1000;
    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - offsetMs);
    const endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - offsetMs - 1);

    // Statutory B2CL inter-state threshold (Rs. 1,00,000 effective Aug 2024, previously Rs. 2,50,000)
    const b2clThreshold = (year > 2024 || (year === 2024 && month >= 8)) ? 100000 : 250000;
    const excludedIds = new Set((options.excludedInvoiceIds || []).map(String));

    const query = Invoice.find({
      workspaceId,
      invoiceDate: { $gte: startDate, $lte: endDate }
    }).sort({ invoiceDate: 1, invoiceNumber: 1 });

    const allInvoices = (typeof query?.lean === 'function')
      ? await query.lean()
      : await query;

    const isCancelled = (inv) => (inv.status || '').toLowerCase() === 'cancelled';
    const isDraft = (inv) => (inv.status || '').toLowerCase() === 'draft';

    const activeInvoices = allInvoices.filter((inv) => !isCancelled(inv) && !isDraft(inv));
    const cancelledCount = allInvoices.filter((inv) => isCancelled(inv)).length;

    // Count active excluded invoice IDs for the selected period
    const excludedActiveCount = activeInvoices.filter((inv) => excludedIds.has(String(inv._id))).length;

    const sectionDetails = {
      b2b: [], b2cl: [], b2cs: [], exp: [], cdnr: [], cdnur: [],
      intraUnregNotes: [], // Collect intra-state and small unregistered credit/debit notes
      unclassifiedZeroRate: [], invalidHsn: [], hsn: [], docIssue: null, docIssueList: [], docSeries: []
    };

    const b2bMap = new Map();
    const b2clMap = new Map();
    const b2csMap = new Map();
    const expMap = new Map();
    const cdnrMap = new Map();
    const cdnurFlat = []; // Flat array of CDNUR objects conforming to GSTN schema
    const hsnMap = new Map(); // Unified HSN summary map across outward transactions

    const nilBuckets = {
      INTRB2B: { sply_ty: 'INTRB2B', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
      INTRB2C: { sply_ty: 'INTRB2C', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
      INTRAB2B: { sply_ty: 'INTRAB2B', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
      INTRAB2C: { sply_ty: 'INTRAB2C', nil_amt: 0, expt_amt: 0, ngsup_amt: 0 }
    };
    let hasNilSupplies = false;
    const supplierStateCode = normGstin.slice(0, 2);

    for (const inv of activeInvoices) {
      const invIdStr = String(inv._id);
      const isExcluded = excludedIds.has(invIdStr);

      const isNote = inv.documentType === 'CREDIT_NOTE' || inv.documentType === 'DEBIT_NOTE';
      const fallbackPos = (inv.customerGstin && isValidGstin(inv.customerGstin.trim().toUpperCase()))
        ? (inv.customerGstin.trim().slice(0, 2) || supplierStateCode)
        : supplierStateCode;
      const pos = sanitizePos(inv.placeOfSupply, fallbackPos); // Validated state code (01-38, 96, 97)
      const isInterState = pos !== supplierStateCode;
      const isExport = !isNote && isExportSupply(inv, pos); // Normalized export detection (domestic B2B preserved)
      const isB2B = !isExport && inv.customerGstin && isValidGstin(inv.customerGstin.trim().toUpperCase());
      const grandTotalVal = num(inv.grandTotal, 0);
      const taxableVal = num(inv.subTotal ?? inv.totalTaxable, 0);
      const thresholdValue = Math.abs(grandTotalVal);

      const invoiceItemDetail = {
        _id: inv._id, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate,
        dateFormatted: formatGstnDate(inv.invoiceDate, defaultPeriodDate), customerName: inv.customerName,
        customerGstin: inv.customerGstin || '', placeOfSupply: inv.placeOfSupply || pos,
        pos, grandTotal: grandTotalVal, taxableAmount: taxableVal,
        igst: num(inv.totalIgst, 0), cgst: num(inv.totalCgst, 0), sgst: num(inv.totalSgst, 0),
        cess: num(inv.totalCess, 0),
        lineItemsCount: inv.lineItems?.length || 0, isExcluded
      };

      sectionDetails.docIssueList.push(invoiceItemDetail);

      // Classify zero-rate supplies strictly according to tax preferences
      const KNOWN_ZERO_PREFS = new Set(['NIL', 'EXEMPT', 'NON_GST']);
      const hasUnclassifiedZero = (inv.lineItems || []).some((item) => {
        if (sanitizeRate(item.gstRate) !== 0) return false;
        const pref = String(item.taxPreference || '').trim().toUpperCase();
        return !KNOWN_ZERO_PREFS.has(pref);
      });

      if (!isExport && hasUnclassifiedZero) {
        sectionDetails.unclassifiedZeroRate.push(invoiceItemDetail);
      }

      if (isNote) {
        const noteDetail = { ...invoiceItemDetail, noteType: inv.documentType === 'CREDIT_NOTE' ? 'C' : 'D' };
        const isExportNote = isExportSupply(inv, pos);

        let noteItms = (inv.lineItems || []).map((item, idx) => ({
          num: idx + 1,
          itm_det: normalizeItmDet(item, {
            interState: isInterState,
            export: isExportNote
          })
        })).sort((a, b) => a.num - b.num);

        if (noteItms.length === 0) {
          noteItms = [{
            num: 1,
            itm_det: normalizeItmDet({
              gstRate: isInterState ? (num(inv.totalIgst, 0) > 0 ? 18 : 0) : ((num(inv.totalCgst, 0) + num(inv.totalSgst, 0)) > 0 ? 18 : 0),
              taxableAmount: taxableVal,
              igstAmount: num(inv.totalIgst, 0),
              cgstAmount: num(inv.totalCgst, 0),
              sgstAmount: num(inv.totalSgst, 0),
              cessAmount: num(inv.totalCess, 0)
            }, { interState: isInterState, export: isExportNote })
          }];
        }

        if (isB2B) {
          sectionDetails.cdnr.push(noteDetail);
          if (!isExcluded) {
            const buyerGstin = inv.customerGstin ? inv.customerGstin.trim().toUpperCase() : '';
            const notePayload = {
              nt_num: cleanInum(inv.invoiceNumber),
              nt_dt: formatGstnDate(inv.invoiceDate, defaultPeriodDate),
              ntty: inv.documentType === 'CREDIT_NOTE' ? 'C' : 'D',
              pos,
              rchrg: inv.isReverseCharge ? 'Y' : 'N',
              inv_typ: deriveInvTyp(inv, pos, supplierStateCode),
              val: absAmount(grandTotalVal),
              itms: noteItms
            };
            const cleanedNote = deepClean(notePayload);
            if (!cdnrMap.has(buyerGstin)) cdnrMap.set(buyerGstin, []);
            cdnrMap.get(buyerGstin).push(cleanedNote);
          }
        } else {
          // Unregistered Note (Fix C: CDNUR or B2CS fold)
          sectionDetails.cdnur.push(noteDetail);
          if (!isExcluded) {
            if (isExportNote) {
              const expNoteTyp = deriveCdnurExportTyp(inv.exportType, inv.totalIgst);
              cdnurFlat.push(deepClean({
                typ: expNoteTyp,
                nt_num: cleanInum(inv.invoiceNumber),
                nt_dt: formatGstnDate(inv.invoiceDate, defaultPeriodDate),
                ntty: inv.documentType === 'CREDIT_NOTE' ? 'C' : 'D',
                val: absAmount(grandTotalVal),
                itms: noteItms
              }));
            } else if (isInterState && thresholdValue > b2clThreshold) {
              const b2clPos = sanitizePosDomestic(inv.placeOfSupply, fallbackPos);
              cdnurFlat.push(deepClean({
                typ: 'B2CL',
                pos: b2clPos,
                nt_num: cleanInum(inv.invoiceNumber),
                nt_dt: formatGstnDate(inv.invoiceDate, defaultPeriodDate),
                ntty: inv.documentType === 'CREDIT_NOTE' ? 'C' : 'D',
                val: absAmount(grandTotalVal),
                itms: noteItms
              }));
            } else {
              sectionDetails.intraUnregNotes.push({
                ...noteDetail,
                lineItems: inv.lineItems || []
              });
            }
          }
        }
      }
      else if (isExport) {
        sectionDetails.exp.push(invoiceItemDetail);
        if (!isExcluded) {
          const expTyp = normalizeExportType(inv.exportType) || (num(inv.totalIgst, 0) > 0 ? 'WPAY' : 'WOPAY');
          if (!expMap.has(expTyp)) expMap.set(expTyp, []);

          let expItms = (inv.lineItems || []).map((item) =>
            normalizeItmDet(item, { export: true })
          );

          if (expItms.length === 0) {
            expItms = [
              normalizeItmDet({
                gstRate: num(inv.totalIgst, 0) > 0 ? 18 : 0,
                taxableAmount: taxableVal,
                igstAmount: num(inv.totalIgst, 0),
                cessAmount: num(inv.totalCess, 0)
              }, { export: true })
            ];
          }

          const expInvoice = {
            inum: cleanInum(inv.invoiceNumber),
            idt: formatGstnDate(inv.invoiceDate, defaultPeriodDate),
            val: absAmount(grandTotalVal),
            itms: expItms
          };

          if (inv.shippingBillNumber) {
            const sbnum = String(inv.shippingBillNumber).replace(/[^0-9]/g, '');
            if (sbnum.length >= 3 && sbnum.length <= 7) expInvoice.sbnum = sbnum;
          }
          if (inv.shippingBillDate) {
            expInvoice.sbdt = formatGstnDate(inv.shippingBillDate, defaultPeriodDate);
          }
          if (inv.portCode) {
            const sbpcode = String(inv.portCode).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (sbpcode.length >= 1 && sbpcode.length <= 6) expInvoice.sbpcode = sbpcode;
          }

          const cleanedExp = deepClean(expInvoice);
          expMap.get(expTyp).push(cleanedExp);
        }
      }
      else if (isB2B) {
        sectionDetails.b2b.push(invoiceItemDetail);
        if (!isExcluded) {
          const buyerGstin = inv.customerGstin.trim().toUpperCase();
          if (!b2bMap.has(buyerGstin)) b2bMap.set(buyerGstin, []);

          let itms = (inv.lineItems || []).map((item, idx) => ({
            num: idx + 1,
            itm_det: normalizeItmDet(item, { interState: isInterState })
          })).sort((a, b) => a.num - b.num);

          if (itms.length === 0) {
            itms = [{
              num: 1,
              itm_det: normalizeItmDet({
                gstRate: isInterState ? (num(inv.totalIgst, 0) > 0 ? 18 : 0) : ((num(inv.totalCgst, 0) + num(inv.totalSgst, 0)) > 0 ? 18 : 0),
                taxableAmount: taxableVal,
                igstAmount: num(inv.totalIgst, 0),
                cgstAmount: num(inv.totalCgst, 0),
                sgstAmount: num(inv.totalSgst, 0),
                cessAmount: num(inv.totalCess, 0)
              }, { interState: isInterState })
            }];
          }

          const invoicePayload = {
            inum: cleanInum(inv.invoiceNumber),
            idt: formatGstnDate(inv.invoiceDate, defaultPeriodDate),
            val: absAmount(grandTotalVal),
            pos,
            rchrg: inv.isReverseCharge ? 'Y' : 'N',
            inv_typ: deriveInvTyp(inv, pos, supplierStateCode),
            itms
          };
          const cleanedInvoice = deepClean(invoicePayload);
          b2bMap.get(buyerGstin).push(cleanedInvoice);
        }
      }
      else if (isInterState && thresholdValue > b2clThreshold) {
        const b2clPos = sanitizePosDomestic(inv.placeOfSupply, fallbackPos);
        sectionDetails.b2cl.push(invoiceItemDetail);
        if (!isExcluded) {
          if (!b2clMap.has(b2clPos)) b2clMap.set(b2clPos, []);

          let b2clItms = (inv.lineItems || []).map((item, idx) => ({
            num: idx + 1,
            itm_det: normalizeItmDet(item, { interState: true })
          })).sort((a, b) => a.num - b.num);

          if (b2clItms.length === 0) {
            b2clItms = [{
              num: 1,
              itm_det: normalizeItmDet({
                gstRate: num(inv.totalIgst, 0) > 0 ? 18 : 0,
                taxableAmount: taxableVal,
                igstAmount: num(inv.totalIgst, 0),
                cessAmount: num(inv.totalCess, 0)
              }, { interState: true })
            }];
          }

          const b2clInvoice = {
            inum: cleanInum(inv.invoiceNumber),
            idt: formatGstnDate(inv.invoiceDate, defaultPeriodDate),
            val: absAmount(grandTotalVal),
            itms: b2clItms
          };
          const cleanedB2cl = deepClean(b2clInvoice);
          b2clMap.get(b2clPos).push(cleanedB2cl);
        }
      }
      else {
        sectionDetails.b2cs.push(invoiceItemDetail);
        if (!isExcluded) {
          const b2csPos = sanitizePosDomestic(inv.placeOfSupply, fallbackPos);
          const sply_ty = isInterState ? 'INTER' : 'INTRA';
          for (const item of (inv.lineItems || [])) {
            const rt = sanitizeRate(item.gstRate);
            if (rt === 0) continue; // Zero-rate items belong in Table 8 Nil only
            const det = normalizeItmDet(item, { interState: sply_ty === 'INTER' });
            const key = `${sply_ty}_${b2csPos}_${rt}`;
            if (!b2csMap.has(key)) {
              b2csMap.set(key, { sply_ty, pos: b2csPos, rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
            }
            const row = b2csMap.get(key);
            row.txval += num(item.taxableAmount, 0);
            if (sply_ty === 'INTER') {
              row.iamt += num(det.iamt, 0);
              row.camt = 0;
              row.samt = 0;
            } else {
              row.camt += num(det.camt, 0);
              row.samt += num(det.samt, 0);
              row.iamt = 0;
            }
            row.csamt += num(det.csamt, 0);
          }
        }
      }

      // Nil-rated / exempt / non-GST buckets — notes ka apna section hai, yahan skip
      if (!isExcluded && !isExport && !isNote) {
        for (const item of (inv.lineItems || [])) {
          if (sanitizeRate(item.gstRate) === 0) {
            const supplyType = isInterState ? (isB2B ? 'INTRB2B' : 'INTRB2C') : (isB2B ? 'INTRAB2B' : 'INTRAB2C');
            const amt = absAmount(item.taxableAmount);
            const pref = String(item.taxPreference || '').toUpperCase();
            if (pref === 'EXEMPT') nilBuckets[supplyType].expt_amt += amt;
            else if (pref === 'NON_GST') nilBuckets[supplyType].ngsup_amt += amt;
            else nilBuckets[supplyType].nil_amt += amt;
            hasNilSupplies = true;
          }
        }
      }

      // HSN summary — net of credit notes (Issue #2 & #8)
      if (!isExcluded) {
        const hsnSign = signOf(inv);
        for (const item of (inv.lineItems || [])) {
          const rawCode = item.hsnSac || item.hsnCode || item.hsn;
          let hsnCode = cleanHsn(rawCode);
          if (hsnCode.length < 2) {
            sectionDetails.invalidHsn.push({
              invoiceNumber: inv.invoiceNumber,
              itemName: item.name || 'Unknown item',
              rawHsn: rawCode
            });
            hsnCode = '9999';
          }
          const rt = sanitizeRate(item.gstRate);
          const uqc = cleanUqc(item.unit || DEFAULT_UQC, 'OTH');
          const key = `${hsnCode}_${uqc}_${rt}`;
          if (!hsnMap.has(key)) {
            const hsnDesc = String(item.name || 'Goods and Services').trim().slice(0, 30);
            hsnMap.set(key, {
              hsn_sc: hsnCode, desc: hsnDesc, uqc,
              qty: 0, rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0
            });
          }
          const hsnRow = hsnMap.get(key);
          hsnRow.qty += hsnSign * num(item.quantity, 0);
          hsnRow.txval += hsnSign * num(item.taxableAmount, 0);
          hsnRow.iamt += hsnSign * num(item.igstAmount, 0);
          hsnRow.camt += hsnSign * num(item.cgstAmount, 0);
          hsnRow.samt += hsnSign * num(item.sgstAmount, 0);
          hsnRow.csamt += hsnSign * num(item.cessAmount, 0);
        }
      }
    }

    // Fold intra-state / small unregistered credit/debit notes into B2CS as net adjustments
    for (const n of sectionDetails.intraUnregNotes || []) {
      if (n.isExcluded) continue;
      const sgn = n.noteType === 'C' ? -1 : 1;
      const b2csPos = sanitizePosDomestic(n.pos, supplierStateCode);
      const sply_ty = b2csPos !== supplierStateCode ? 'INTER' : 'INTRA';
      for (const item of (n.lineItems || [])) {
        const rt = sanitizeRate(item.gstRate);
        if (rt === 0) continue;
        const det = normalizeItmDet(item, { interState: sply_ty === 'INTER' });
        const key = `${sply_ty}_${b2csPos}_${rt}`;
        if (!b2csMap.has(key)) {
          b2csMap.set(key, { sply_ty, pos: b2csPos, rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
        }
        const row = b2csMap.get(key);
        row.txval += sgn * num(item.taxableAmount, 0);
        if (sply_ty === 'INTER') {
          row.iamt += sgn * num(det.iamt, 0);
          row.camt = 0;
          row.samt = 0;
        } else {
          row.camt += sgn * num(det.camt, 0);
          row.samt += sgn * num(det.samt, 0);
          row.iamt = 0;
        }
        row.csamt += sgn * num(det.csamt, 0);
      }
    }

    const b2b = Array.from(b2bMap.entries()).map(([ctin, invList]) => ({ ctin, inv: invList }));
    const b2cl = Array.from(b2clMap.entries()).map(([pos, invList]) => ({ pos, inv: invList }));
    const b2cs = Array.from(b2csMap.values()).map(row => ({
      typ: 'OE', sply_ty: row.sply_ty, pos: row.pos, rt: row.rt,
      txval: round2(row.txval),
      iamt: row.sply_ty === 'INTER' ? round2(row.iamt) : 0,
      camt: row.sply_ty === 'INTRA' ? round2(row.camt) : 0,
      samt: row.sply_ty === 'INTRA' ? round2(row.samt) : 0,
      csamt: round2(row.csamt)
    }));
    const exp = Array.from(expMap.entries()).map(([expTyp, invList]) => ({ exp_typ: expTyp, inv: invList }));
    const cdnr = Array.from(cdnrMap.entries()).map(([ctin, noteList]) => ({ ctin, nt: noteList }));
    const cdnur = cdnurFlat; // Flat array of CDNUR objects (GSTN schema conforming)

    // Unified single HSN output across all supplies
    const allHsnRows = Array.from(hsnMap.values(), (row, idx) => ({
      num: idx + 1,
      hsn_sc: row.hsn_sc,
      desc: row.desc,
      uqc: row.uqc,
      qty: round2(row.qty),
      rt: row.rt,
      txval: round2(row.txval),
      iamt: round2(row.iamt),
      camt: round2(row.camt),
      samt: round2(row.samt),
      csamt: round2(row.csamt)
    }));
    sectionDetails.hsn = allHsnRows;

    const includedInvoices = activeInvoices.filter((inv) => !excludedIds.has(String(inv._id)));

    /* ---------------------------------------------------------------- */
    /* Document series summary (Table 13) grouped by document type with numeric sorting */
    /* GSTN rule: totnum − canc = net_issue                               */
    /* ---------------------------------------------------------------- */
    const buildSeries = (typeCode) => {
      const ofType = allInvoices.filter((i) => docTypeOf(i) === typeCode);
      const allIssuedOfType = ofType.filter((i) => !isDraft(i));
      const activeOfType = allIssuedOfType.filter((i) => !isCancelled(i));
      const cancelledOfType = allIssuedOfType.filter((i) => isCancelled(i)).length;
      const includedOfType = activeOfType.filter((i) => !excludedIds.has(String(i._id)));
      const excludedOfType = activeOfType.length - includedOfType.length;
      const allNums = sortDocNumbers(allIssuedOfType.map((i) => cleanInum(i.invoiceNumber))); // Serial range spans all issued documents in the period

      return {
        typeCode,
        from: allNums[0] || '1',
        to: allNums[allNums.length - 1] || allNums[0] || '1',
        totnum: allIssuedOfType.length, // Total count of issued documents excluding drafts
        cancel: cancelledOfType + excludedOfType,
        canc: cancelledOfType + excludedOfType, // Backward-compat
        net_issue: includedOfType.length,
        totalCount: ofType.length
      };
    };

    const invSeries = buildSeries('INV');
    const cnSeries = buildSeries('CN');
    const dnSeries = buildSeries('DN');
    const allSeries = [invSeries, cnSeries, dnSeries];
    sectionDetails.docSeries = allSeries;

    // Frontend backward-compat: primary invoice series
    const docRange = {
      from: invSeries.from,
      to: invSeries.to,
      totnum: invSeries.totnum,
      cancel: invSeries.cancel,
      canc: invSeries.canc,
      net_issue: invSeries.net_issue,
      totalCount: allInvoices.length // UI total (drafts included) — display only
    };
    sectionDetails.docIssue = docRange;

    const doc_det = allSeries
      .filter((s) => s.totnum > 0)
      .map((s, idx) => ({
        doc_num: idx + 1,
        doc_typ: DOC_TYP_LABELS[s.typeCode],
        docs: [{
          num: 1,
          from: s.from,
          to: s.to,
          totnum: s.totnum,
          cancel: s.cancel,
          net_issue: s.net_issue
        }]
      }));

    const doc_issue = doc_det.length > 0 ? { doc_det } : null;

    /* ---------------------------------------------------------------- */
    /* Aggregate summary totals applying negative sign for credit notes */
    /* ---------------------------------------------------------------- */
    let totalTaxable = 0, totalIgst = 0, totalCgst = 0, totalSgst = 0, totalCess = 0, grandTotal = 0;
    let grossTurnover = 0;
    for (const inv of includedInvoices) {
      const sign = signOf(inv);
      totalTaxable += sign * num(inv.subTotal ?? inv.totalTaxable, 0);
      totalIgst += sign * num(inv.totalIgst, 0);
      totalCgst += sign * num(inv.totalCgst, 0);
      totalSgst += sign * num(inv.totalSgst, 0);
      totalCess += sign * num(inv.totalCess, 0);
      grandTotal += sign * num(inv.grandTotal, 0);
      grossTurnover += absAmount(inv.grandTotal);
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
      includedInvoices: includedInvoices.length,
      excludedInvoices: excludedActiveCount, // Count of user-excluded active invoices
      cancelledInvoices: cancelledCount,
      totalTaxable: round2(totalTaxable),
      totalIgst: round2(totalIgst),
      totalCgst: round2(totalCgst),
      totalSgst: round2(totalSgst),
      totalCess: round2(totalCess),
      totalTax: round2(totalIgst + totalCgst + totalSgst + totalCess),
      grandTotal: round2(grandTotal),
      b2clThreshold,
      sections: {
        b2bCount: b2bStats.count, b2bIncluded: b2bStats.included,
        b2bTaxable: b2bStats.taxable, b2bTax: b2bStats.tax,
        b2clCount: b2clStats.count, b2clIncluded: b2clStats.included,
        b2clTaxable: b2clStats.taxable, b2clTax: b2clStats.tax,
        b2csCount: b2csStats.count, b2csIncluded: b2csStats.included,
        b2csTaxable: b2csStats.taxable, b2csTax: b2csStats.tax,
        expCount: expStats.count, expIncluded: expStats.included,
        expTaxable: expStats.taxable, expTax: expStats.tax,
        cdnrCount: cdnrStats.count, cdnrIncluded: cdnrStats.included,
        cdnrTaxable: cdnrStats.taxable, cdnrTax: cdnrStats.tax,
        cdnurCount: cdnurStats.count, cdnurIncluded: cdnurStats.included,
        cdnurTaxable: cdnurStats.taxable, cdnurTax: cdnurStats.tax,
        hsnCount: allHsnRows.length,
        docRange,
        docSeries: allSeries
      }
    };

    // Aggregate turnover parameters (gt and cur_gt) are optional per GSTN schema
    // - gt  = Previous FY aggregate turnover — only include when explicitly supplied.
    // - cur_gt = Current FY aggregate turnover — only include when explicitly supplied.
    //   Falling back to this period's grossTurnover was semantically wrong (FY ≠ month).
    //   Sending 0 when undefined is not needed and wastes bandwidth.
    const payload = {
      gstin: normGstin,
      fp: period,
    };
    if (options.prevFyTurnover !== undefined && options.prevFyTurnover !== null) {
      payload.gt = Math.max(0, round2(num(options.prevFyTurnover, 0)));
    }
    if (options.currentFyTurnover !== undefined && options.currentFyTurnover !== null) {
      payload.cur_gt = Math.max(0, round2(num(options.currentFyTurnover, 0)));
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

    if (doc_issue) payload.doc_issue = doc_issue;

    if (hasNilSupplies) {
      payload.nil = {
        inv: Object.values(nilBuckets).map((b) => ({
          sply_ty: b.sply_ty,
          nil_amt: round2(b.nil_amt),
          expt_amt: round2(b.expt_amt),
          ngsup_amt: round2(b.ngsup_amt)
        }))
      };
    }

    const cleanedPayload = deepClean(payload);

    return {
      success: true,
      period,
      gstin: normGstin,
      summary,
      payload: cleanedPayload,
      sectionDetails
    };
  }

  static validateFilingPayload(prepared) {
    const includedUnclassified = (prepared.sectionDetails.unclassifiedZeroRate || []).filter((inv) => !inv.isExcluded);
    if (includedUnclassified.length > 0) {
      throw ApiError.validationError(
        'GSTR-1 filing is blocked because zero-rate outward supplies need nil/exempt/non-GST classification. Please review the "Unclassified Zero-Rate" section.'
      );
    }

    if ((prepared.sectionDetails.invalidHsn || []).length > 0) {
      const samples = prepared.sectionDetails.invalidHsn.slice(0, 3).map(i => `${i.invoiceNumber} (${i.itemName})`).join(', ');
      throw ApiError.validationError(
        `GSTR-1 filing blocked: line item(s) have missing or invalid HSN/SAC code (min 2 digits required). Affected: ${samples}`
      );
    }

    // Validates document issue arithmetic: total issued - cancelled = net issued
    for (const s of prepared.sectionDetails.docSeries || []) {
      const cancelCount = s.cancel ?? s.canc ?? 0;
      if (s.totnum - cancelCount !== s.net_issue) {
        throw ApiError.providerError(
          `Document series (${s.typeCode}) is inconsistent: totnum(${s.totnum}) - cancel(${cancelCount}) != net_issue(${s.net_issue}). Filing aborted.`,
          502
        );
      }
    }
  }

  /**
   * Prepares GSTR-1 payload, runs internal sanity checks, and validates against
   * the strict official GSTN RETSAVE request schema.
   */
  static async prepareAndValidate(workspaceId, gstin, period, options = {}) {
    const prepared = await Gstr1Service.preparePayload(workspaceId, gstin, period, options);
    Gstr1Service.validateFilingPayload(prepared);
    validateGstr1Schema(prepared.payload);
    return prepared;
  }

  static async savePayload(workspaceId, gstin, period, options = {}) {
    // Reuse pre-computed payload when provided to avoid duplicate calculation
    const prepared = options.prepared
      || await Gstr1Service.preparePayload(workspaceId, gstin, period, options);

    Gstr1Service.validateFilingPayload(prepared);
    validateGstr1Schema(prepared.payload);

    const isFilingEnabled = isLiveFilingEnabled();

    if (!isFilingEnabled) {
      await AuditLog.create({
        workspaceId,
        memberId: options.memberId || null,
        gstin: prepared.gstin,
        action: 'GSTR1_SAVE_DRY_RUN',
        status: 'SUCCESS'
      }).catch(() => { });
      return {
        success: true, dryRun: true,
        message: 'GSTR-1 payload validated in dry-run mode. Live portal upload is disabled in this environment.',
        ref_id: `DRY-RUN-${Date.now()}`,
        period, gstin: prepared.gstin, summary: prepared.summary, payload: prepared.payload
      };
    }

    const provider = FinaggService.getProvider();
    if (!provider || typeof provider.saveGstr1 !== 'function') {
      throw ApiError.providerError('Active GST provider does not support GSTR-1 RETSAVE.', 502);
    }

    // Forward required payload parameters to provider
    const result = await provider.saveGstr1(prepared.payload, {
      gstin: prepared.gstin,
      period,
      username: options.username,
      gstToken: options.gstToken,
      token: options.token
    });

    const refId = result?.ref_id || result?.reference_id;
    if (!refId) {
      throw ApiError.providerError(
        'GSTR-1 RETSAVE response did not include reference_id. Save was not confirmed.',
        502
      );
    }

    await AuditLog.create({
      workspaceId,
      memberId: options.memberId || null,
      gstin: prepared.gstin,
      action: 'GSTR1_SAVE',
      status: 'SUCCESS',
      metadata: { period, ref_id: refId }
    }).catch(() => { });

    return {
      success: true, dryRun: false,
      message: 'GSTR-1 successfully uploaded and saved to GSTN Portal!',
      ref_id: refId, period, gstin: prepared.gstin, summary: prepared.summary
    };
  }
}

module.exports = Gstr1Service;