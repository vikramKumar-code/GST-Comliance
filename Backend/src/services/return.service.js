const FinaggService = require('./finagg.service');
const Return = require('../models/Return');
const Filing = require('../models/Filing');
const Workspace = require('../models/Workspace');
const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const Gstr1Service = require('./gstr1.service');
const { encrypt, decrypt } = require('../utils/crypto');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const TZ_OFFSET_MIN = Number(process.env.GST_TZ_OFFSET_MIN || 330);
const TZ_OFFSET_MS = TZ_OFFSET_MIN * 60 * 1000;

// Allowlist-based finalized status. If env is not set, fallback to exclusion list.
const EXCLUDED_DOCUMENT_STATUSES = [
  'cancelled',
  'Cancelled',
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

const FINALIZED = ACTIVE_STATUS_LIST.length
  ? { $in: ACTIVE_STATUS_LIST }
  : { $nin: EXCLUDED_DOCUMENT_STATUSES };

const ZERO_TOTALS = Object.freeze({
  taxable: 0,
  igst: 0,
  cgst: 0,
  sgst: 0,
  cess: 0
});

// Local book synthesis is display-only and never cached as authoritative portal data.
const ALLOW_LOCAL_SYNTHESIS =
  String(process.env.GST_ENABLE_LOCAL_RETURN_SYNTHESIS || 'true').toLowerCase() === 'true';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function round2(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function safeErrorMessage(error) {
  if (!error) return 'unknown';
  const msg = typeof error.message === 'string' ? error.message : '';
  return msg
    .replace(/https?:\/\/\S+/gi, '[URL_REDACTED]')
    .replace(/(password|token|secret|authtoken|auth-token|OTP|sid|sign|aspid)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 200) || 'unknown';
}

function unwrapProviderData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) return raw.data;
  return raw;
}

// Credit notes decrease outward turnover / ITC depending on context.
const signOfInvoice = (inv) => (inv.documentType === 'CREDIT_NOTE' ? -1 : 1);
const signOfNote = (nt) => (nt?.ntty === 'C' ? -1 : 1);

// GSTN nonEmptydate format: DD-MM-YYYY
function formatGstnDate(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';

  const local = new Date(d.getTime() + TZ_OFFSET_MS);
  const day = String(local.getUTCDate()).padStart(2, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const year = local.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

function periodRange(period) {
  const month = parseInt(period.slice(0, 2), 10);
  const year = parseInt(period.slice(2), 10);

  return {
    startDate: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - TZ_OFFSET_MS),
    endDate: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - TZ_OFFSET_MS) // exclusive for $lt
  };
}

function financialYearOf(period) {
  const month = Number(period.slice(0, 2));
  const year = Number(period.slice(2));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

const isConfirmedFiled = (f) =>
  Boolean(f?.arn) && String(f?.status || '').toLowerCase() === 'filed';

function filingDisplayStatus(f) {
  if (isConfirmedFiled(f)) return 'FILED';
  if (String(f?.status || '') === 'Failed') return 'FAILED';
  if (['InProgress', 'ReadyToEVC', 'Submitted', 'Saved', 'Pending'].includes(String(f?.status || ''))) {
    return 'IN_PROGRESS';
  }
  return f?.status || 'NOT_FILED';
}

const sortPeriodsDesc = (periods) =>
  [...periods]
    .filter((p) => p?.period)
    .sort((a, b) => {
      const ka = a.period.slice(2) + a.period.slice(0, 2);
      const kb = b.period.slice(2) + b.period.slice(0, 2);
      return kb.localeCompare(ka);
    });

/* -------------------------------------------------------------------------- */
/* GSTR-1 schema-aware helpers                                                */
/* -------------------------------------------------------------------------- */

// Official GSTR-1 Save request schema allowed root keys.
const GSTR1_ALLOWED_ROOT_KEYS = [
  'gstin',
  'fp',
  'gt',
  'cur_gt',
  'hash',
  'version',
  'b2b',
  'b2ba',
  'b2cl',
  'b2cla',
  'b2cs',
  'b2csa',
  'cdnr',
  'cdnra',
  'cdnur',
  'cdnura',
  'nil',
  'exp',
  'expa',
  'at',
  'ata',
  'txpd',
  'txpda',
  'supeco',
  'supecoa',
  'ecom',
  'ecoma',
  'hsn',
  'doc_issue'
];

function pickGstr1AllowedFields(doc) {
  const out = {};
  for (const key of GSTR1_ALLOWED_ROOT_KEYS) {
    if (doc?.[key] !== undefined) out[key] = doc[key];
  }
  return out;
}

const GSTR1_SECTION_LABELS = {
  AT: '5A - Advances Received',
  ATA: '5A - Amendments to Advances Received',
  CDNUR: '9C - Credit/Debit Notes (Unregistered)',
  B2BA_4A: '4B - Amendments to B2B (4A)',
  CDNURA: '9C - Amendments to Credit/Debit Notes (Unregistered)',
  B2BA_4B: '4B - Amendments to B2B (4B)',
  EXP: '6A - Export Supplies',
  B2BA_6C: '4B - Amendments to B2B (6C)',
  EXPA: '6A - Amendments to Export Supplies',
  B2BA_SEZWOP: '4B - Amendments to SEZ Without Payment',
  B2BA_SEZWP: '4B - Amendments to SEZ With Payment',
  B2B_4A: '4A - B2B Supplies (4A)',
  B2B_4B: '4A - B2B Supplies (4B)',
  B2B_6C: '4A - B2B Supplies (6C)',
  B2B_SEZWOP: '4A - SEZ Without Payment',
  B2B_SEZWP: '4A - SEZ With Payment',
  B2CL: '5 - B2C Large Supplies',
  B2CLA: '5 - Amendments to B2C Large Supplies',
  B2CS: '7 - B2C Small Supplies',
  B2CSA: '7 - Amendments to B2C Small Supplies',
  HSN: '12 - HSN Summary',
  NIL: '8 - Nil Rated, Exempted & Non-GST Outward Supplies',
  TTL_LIAB: 'Total Liability',
  TXPD: '6 - Tax Paid on Advances',
  TXPDA: '6 - Amendments to Tax Paid on Advances',
  DOC_ISSUE: '13 - Document Issue Number Series',
  CDNR: '9B - Credit/Debit Notes (Registered)',
  CDNRA: '9B - Amendments to Credit/Debit Notes (Registered)',
  B2B: '4A - B2B Supplies',
  B2BA: '4B - Amendments to B2B Supplies',
  SUPECOM: '9A - E-commerce Supplies (Operator)',
  SUPECOMA: '9A - Amendments to E-commerce Supplies (Operator)',
  ECOM: '9A - E-commerce Outward Supplies',
  ECOMA: '9A - Amendments to E-commerce Outward Supplies',
  ECOM_REG: '9A - E-commerce Registered Supplies',
  ECOM_DE: '9A - E-commerce Deleted Supplies',
  ECOM_SEZWOP: '9A - E-commerce SEZ Without Payment',
  ECOM_SEZWP: '9A - E-commerce SEZ With Payment',
  ECOM_UNREG: '9A - E-commerce Unregistered Supplies',
  ECOMA_REG: '9A - Amendments to E-commerce Registered Supplies',
  ECOMA_DE: '9A - Amendments to E-commerce Deleted Supplies',
  ECOMA_SEZWOP: '9A - Amendments to E-commerce SEZ Without Payment',
  ECOMA_SEZWP: '9A - Amendments to E-commerce SEZ With Payment',
  ECOMA_UNREG: '9A - Amendments to E-commerce Unregistered Supplies'
};

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

class ReturnService {
  /* ──────────────────────────────────────────────────────────────────────
     TOTALS
     Rows marked excludeFromTotals are skipped (e.g. ITC in GSTR-3B).
     ────────────────────────────────────────────────────────────────────── */
  static _calculateTotals(rows) {
    const raw = (rows || []).reduce(
      (acc, row) => {
        if (row?.excludeFromTotals) return acc;

        return {
          taxable: acc.taxable + (Number(row.taxable) || 0),
          igst: acc.igst + (Number(row.igst) || 0),
          cgst: acc.cgst + (Number(row.cgst) || 0),
          sgst: acc.sgst + (Number(row.sgst) || 0),
          cess: acc.cess + (Number(row.cess) || 0)
        };
      },
      { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
    );

    return {
      taxable: round2(raw.taxable),
      igst: round2(raw.igst),
      cgst: round2(raw.cgst),
      sgst: round2(raw.sgst),
      cess: round2(raw.cess)
    };
  }

  /* ──────────────────────────────────────────────────────────────────────
     MAPPER: GSTR-1
     ────────────────────────────────────────────────────────────────────── */
  static mapGstr1(raw, period, provider, gstin = '') {
    if (!raw || typeof raw !== 'object') {
      throw ApiError.providerError('TaxPro GSTR-1 mapper received invalid payload', 502);
    }

    const isTaxPro = provider === 'taxpro' || (!provider && FinaggService.getProviderName() === 'taxpro');
    const doc = unwrapProviderData(raw);

    const requestedGstin = String(gstin || '').trim().toUpperCase();
    const responseGstin = String(doc.gstin || '').trim().toUpperCase();
    const responsePeriod = String(doc.ret_period || doc.fp || '').trim();

    const gstinMismatch = Boolean(requestedGstin && responseGstin && requestedGstin !== responseGstin);
    const periodMismatch = Boolean(responsePeriod && responsePeriod !== String(period || '').trim());

    const portalNil = String(doc.isnil || '').toUpperCase() === 'Y';

    /* -------------------------------------------------------------------- */
    /* 1. Portal-confirmed Nil summary                                      */
    /* -------------------------------------------------------------------- */
    if (portalNil && !Array.isArray(doc.sec_sum)) {
      return {
        type: 'GSTR1',
        period,
        gstin: responseGstin || requestedGstin || undefined,
        fp: responsePeriod || period,
        rows: [
          {
            label: 'NIL - No outward supplies (portal confirmed)',
            sec_nm: 'nil',
            taxable: 0,
            nilValue: 0,
            igst: 0,
            cgst: 0,
            sgst: 0,
            cess: 0
          }
        ],
        totals: { ...ZERO_TOTALS },
        isNil: true,
        isnil: 'Y',
        summary: true,
        sec_sum: [],
        chksum: null,
        gstinMismatch,
        periodMismatch,
        fetchedAt: new Date().toISOString()
      };
    }

    /* -------------------------------------------------------------------- */
    /* 2. RETSUM summary shape                                              */
    /* -------------------------------------------------------------------- */
    if (Array.isArray(doc.sec_sum)) {
      const rows = doc.sec_sum.map((sec, idx) => {
        const secNm = String(sec?.sec_nm || '').toUpperCase();
        const isNilSection = secNm === 'NIL';

        const nilValue = round2(
          Number(sec?.ttl_nilsup_amt || 0) +
          Number(sec?.ttl_expt_amt || 0) +
          Number(sec?.ttl_ngsup_amt || 0)
        );

        const taxable = isNilSection
          ? 0
          : round2(Number(sec?.ttl_tax ?? sec?.ttl_val ?? 0));

        return {
          label: GSTR1_SECTION_LABELS[secNm] || secNm || `Section #${idx + 1}`,
          sec_nm: secNm.toLowerCase(),
          count: Number(sec?.ttl_rec ?? sec?.cnt ?? sec?.tot_rec ?? 0),
          val: round2(Number(sec?.ttl_val ?? 0)),
          taxable,
          nilValue,
          igst: round2(Number(sec?.ttl_igst ?? 0)),
          cgst: round2(Number(sec?.ttl_cgst ?? 0)),
          sgst: round2(Number(sec?.ttl_sgst ?? 0)),
          cess: round2(Number(sec?.ttl_cess ?? 0))
        };
      });

      return {
        type: 'GSTR1',
        period,
        gstin: responseGstin || requestedGstin || undefined,
        fp: responsePeriod || period,
        rows,
        totals: ReturnService._calculateTotals(rows),
        summary: true,
        isNil: portalNil,
        isnil: portalNil ? 'Y' : undefined,
        sec_sum: doc.sec_sum,
        chksum: doc.chksum || null,
        smryTyp: doc.smryTyp,
        newSumFlag: doc.newSumFlag,
        gstinMismatch,
        periodMismatch,
        fetchedAt: new Date().toISOString()
      };
    }

    /* -------------------------------------------------------------------- */
    /* 3. Detailed GSTR-1 payload shape                                     */
    /* -------------------------------------------------------------------- */
    const hasSectionArrays =
      Array.isArray(doc.b2b) ||
      Array.isArray(doc.b2ba) ||
      Array.isArray(doc.b2cl) ||
      Array.isArray(doc.b2cla) ||
      Array.isArray(doc.b2cs) ||
      Array.isArray(doc.b2csa) ||
      Array.isArray(doc.cdnr) ||
      Array.isArray(doc.cdnra) ||
      Array.isArray(doc.cdnur) ||
      Array.isArray(doc.cdnura) ||
      Array.isArray(doc.exp) ||
      Array.isArray(doc.expa) ||
      Array.isArray(doc.at) ||
      Array.isArray(doc.ata) ||
      Array.isArray(doc.txpd) ||
      Array.isArray(doc.txpda) ||
      Boolean(doc.supeco) ||
      Boolean(doc.supecoa) ||
      Boolean(doc.ecom) ||
      Boolean(doc.ecoma);

    const isGstr1Payload =
      hasSectionArrays ||
      Boolean(doc.gstin && (doc.fp || doc.ret_period));

    if (isGstr1Payload) {
      const rows = [];
      const invoices = [];

      const extract = (item) => ({
        txval: Number(item?.txval || 0),
        igst: Number(item?.igst ?? item?.iamt ?? 0),
        cgst: Number(item?.cgst ?? item?.camt ?? 0),
        sgst: Number(item?.sgst ?? item?.samt ?? 0),
        cess: Number(item?.cess ?? item?.csamt ?? 0)
      });

      const sumItems = (node) => {
        const itms = node?.itms || node?.items || [];
        if (!Array.isArray(itms) || !itms.length) return extract(node);

        return itms.reduce((acc, itm) => {
          const v = extract(itm?.itm_det || itm);
          acc.txval += v.txval;
          acc.igst += v.igst;
          acc.cgst += v.cgst;
          acc.sgst += v.sgst;
          acc.cess += v.cess;
          return acc;
        }, { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
      };

      /* ---------------------------- B2B / B2BA --------------------------- */
      const pushB2B = (list, labelBase, amendment = false) => {
        if (!Array.isArray(list)) return;

        for (const buyer of list) {
          const ctin = buyer?.ctin || 'Registered Buyer';

          for (const inv of buyer?.inv || []) {
            const v = sumItems(inv);
            const inum = inv?.inum || inv?.invoiceNumber || '';
            const idt = inv?.idt || inv?.invoiceDate || '';
            const oinum = amendment ? (inv?.oinum || '') : '';
            const oidt = amendment ? (inv?.oidt || '') : '';

            const row = {
              label:
                `${labelBase} (${ctin})` +
                (inum ? ` • ${inum}` : '') +
                (amendment && oinum ? ` -> ${oinum}` : ''),
              inum,
              idt,
              oinum,
              oidt,
              val: Number(inv?.val || (v.txval + v.igst + v.cgst + v.sgst + v.cess)),
              ctin,
              trdnm: buyer?.trdnm || buyer?.cname || 'Registered Buyer',
              pos: inv?.pos || '',
              taxable: round2(v.txval),
              igst: round2(v.igst),
              cgst: round2(v.cgst),
              sgst: round2(v.sgst),
              cess: round2(v.cess)
            };

            rows.push(row);
            invoices.push(row);
          }
        }
      };

      pushB2B(doc.b2b, '4A - B2B Supplies', false);
      pushB2B(doc.b2ba, '4B - Amendments to B2B Supplies', true);

      /* --------------------------- B2CL / B2CLA -------------------------- */
      const pushB2CL = (list, labelBase) => {
        if (!Array.isArray(list)) return;

        for (const group of list) {
          let txval = 0;
          let igst = 0;
          let cess = 0;

          for (const inv of group?.inv || []) {
            const v = sumItems(inv);
            txval += v.txval;
            igst += v.igst;
            cess += v.cess;
          }

          rows.push({
            label: `${labelBase}${group?.pos ? ` (POS: ${group.pos})` : ''}`,
            pos: group?.pos || '',
            taxable: round2(txval),
            igst: round2(igst),
            cgst: 0,
            sgst: 0,
            cess: round2(cess)
          });
        }
      };

      pushB2CL(doc.b2cl, '5 - B2C Large Supplies');
      pushB2CL(doc.b2cla, '5 - Amendments to B2C Large Supplies');

      /* --------------------------- B2CS / B2CSA -------------------------- */
      const pushB2CS = (list, labelBase) => {
        if (!Array.isArray(list)) return;

        for (const item of list) {
          const v = sumItems(item);

          rows.push({
            label:
              `${labelBase}` +
              `${item?.pos ? ` (POS: ${item.pos})` : ''}` +
              `${item?.rt !== undefined ? ` @${item.rt}%` : ''}` +
              `${item?.sply_ty ? ` ${item.sply_ty}` : ''}` +
              `${item?.omon ? ` (Original: ${item.omon})` : ''}`,
            pos: item?.pos || '',
            sply_ty: item?.sply_ty || '',
            omon: item?.omon || '',
            taxable: round2(v.txval),
            igst: round2(v.igst),
            cgst: round2(v.cgst),
            sgst: round2(v.sgst),
            cess: round2(v.cess)
          });
        }
      };

      pushB2CS(doc.b2cs, '7 - B2C Small Supplies');
      pushB2CS(doc.b2csa, '7 - Amendments to B2C Small Supplies');

      /* ------------------------ CDNR / CDNRA (Registered) ---------------- */
      const pushRegisteredNotes = (list, labelBase) => {
        if (!Array.isArray(list)) return;

        for (const party of list) {
          let txval = 0;
          let igst = 0;
          let cgst = 0;
          let sgst = 0;
          let cess = 0;

          for (const nt of party?.nt || []) {
            const sign = signOfNote(nt);
            const v = sumItems(nt);

            txval += sign * v.txval;
            igst += sign * v.igst;
            cgst += sign * v.cgst;
            sgst += sign * v.sgst;
            cess += sign * v.cess;
          }

          rows.push({
            label: `${labelBase} (${party?.ctin || 'Registered Party'})`,
            ctin: party?.ctin || '',
            taxable: round2(txval),
            igst: round2(igst),
            cgst: round2(cgst),
            sgst: round2(sgst),
            cess: round2(cess)
          });
        }
      };

      pushRegisteredNotes(doc.cdnr, '9B - Credit/Debit Notes (Registered)');
      pushRegisteredNotes(doc.cdnra, '9B - Amendments to Credit/Debit Notes (Registered)');

      /* ---------------------- CDNUR / CDNURA (Unregistered) -------------- */
      // In GSTR-1 schema, cdnur/cdnura are arrays of note objects directly.
      const pushUnregisteredNotes = (list, labelBase, amendment = false) => {
        if (!Array.isArray(list)) return;

        const groups = new Map();

        for (const nt of list) {
          const key = `${nt?.typ || 'UNREG'}|${nt?.pos || ''}`;
          if (!groups.has(key)) groups.set(key, { txval: 0, igst: 0, cess: 0, typ: nt?.typ, pos: nt?.pos });

          const sign = signOfNote(nt);
          const v = sumItems(nt);
          const g = groups.get(key);

          g.txval += sign * v.txval;
          g.igst += sign * v.igst;
          g.cess += sign * v.cess;
        }

        for (const g of groups.values()) {
          rows.push({
            label:
              `${labelBase}` +
              `${g.typ ? ` (${g.typ})` : ''}` +
              `${g.pos ? ` POS: ${g.pos}` : ''}` +
              (amendment ? ' (Amended)' : ''),
            typ: g.typ || '',
            pos: g.pos || '',
            taxable: round2(g.txval),
            igst: round2(g.igst),
            cgst: 0,
            sgst: 0,
            cess: round2(g.cess)
          });
        }
      };

      pushUnregisteredNotes(doc.cdnur, '9C - Credit/Debit Notes (Unregistered)', false);
      pushUnregisteredNotes(doc.cdnura, '9C - Amendments to Credit/Debit Notes (Unregistered)', true);

      /* ---------------------------- EXP / EXPA --------------------------- */
      const pushExport = (list, labelBase, amendment = false) => {
        if (!Array.isArray(list)) return;

        for (const group of list) {
          let txval = 0;
          let igst = 0;
          let cess = 0;

          for (const inv of group?.inv || []) {
            const v = sumItems(inv);
            txval += v.txval;
            igst += v.igst;
            cess += v.cess;
          }

          rows.push({
            label:
              `${labelBase} (${group?.exp_typ || 'EXPORT'})` +
              (amendment ? ' (Amended)' : ''),
            exp_typ: group?.exp_typ || '',
            taxable: round2(txval),
            igst: round2(igst),
            cgst: 0,
            sgst: 0,
            cess: round2(cess)
          });
        }
      };

      pushExport(doc.exp, '6A - Export Supplies', false);
      pushExport(doc.expa, '6A - Amendments to Export Supplies', true);

      /* --------------------- AT / ATA / TXPD / TXPDA --------------------- */
      const pushAdvanceLike = (list, labelBase, amendment = false) => {
        if (!Array.isArray(list)) return;

        for (const entry of list) {
          let txval = 0;
          let igst = 0;
          let cgst = 0;
          let sgst = 0;
          let cess = 0;

          for (const itm of entry?.itms || []) {
            const det = itm?.itm_det || itm || {};
            txval += Number(det?.ad_amt || det?.txval || 0);
            igst += Number(det?.iamt || det?.igst || 0);
            cgst += Number(det?.camt || det?.cgst || 0);
            sgst += Number(det?.samt || det?.sgst || 0);
            cess += Number(det?.csamt || det?.cess || 0);
          }

          rows.push({
            label:
              `${labelBase}` +
              `${entry?.pos ? ` (POS: ${entry.pos})` : ''}` +
              `${entry?.sply_ty ? ` ${entry.sply_ty}` : ''}` +
              `${entry?.omon ? ` (Original: ${entry.omon})` : ''}` +
              (amendment ? ' (Amended)' : ''),
            pos: entry?.pos || '',
            sply_ty: entry?.sply_ty || '',
            omon: entry?.omon || '',
            taxable: round2(txval),
            igst: round2(igst),
            cgst: round2(cgst),
            sgst: round2(sgst),
            cess: round2(cess)
          });
        }
      };

      pushAdvanceLike(doc.at, '5A - Advances Received', false);
      pushAdvanceLike(doc.ata, '5A - Amendments to Advances Received', true);
      pushAdvanceLike(doc.txpd, '6 - Tax Paid on Advances', false);
      pushAdvanceLike(doc.txpda, '6 - Amendments to Tax Paid on Advances', true);

      /* ------------------------- SUPECOM / SUPECOMA ---------------------- */
      const pushSupeco = (obj, labelBase, amendment = false) => {
        if (!obj || typeof obj !== 'object') return;

        const keys = amendment ? ['clttxa', 'paytxa'] : ['clttx', 'paytx'];

        for (const key of keys) {
          const list = obj[key];
          if (!Array.isArray(list) || !list.length) continue;

          let txval = 0;
          let igst = 0;
          let cgst = 0;
          let sgst = 0;
          let cess = 0;

          for (const item of list) {
            txval += Number(item?.suppval || 0);
            igst += Number(item?.igst || 0);
            cgst += Number(item?.cgst || 0);
            sgst += Number(item?.sgst || 0);
            cess += Number(item?.cess || 0);
          }

          rows.push({
            label:
              `${labelBase} (${key === keys[0] ? 'Client Taxable' : 'Operator Taxable'})` +
              (amendment ? ' (Amended)' : ''),
            taxable: round2(txval),
            igst: round2(igst),
            cgst: round2(cgst),
            sgst: round2(sgst),
            cess: round2(cess)
          });
        }
      };

      pushSupeco(doc.supeco, '9A - E-commerce Supplies (Operator)', false);
      pushSupeco(doc.supecoa, '9A - Amendments to E-commerce Supplies (Operator)', true);

      /* ---------------------------- ECOM / ECOMA ------------------------- */
      const summarizeEcom = (ecom, isAmendment = false) => {
        if (!ecom || typeof ecom !== 'object') return null;

        let txval = 0;
        let igst = 0;
        let cgst = 0;
        let sgst = 0;
        let cess = 0;

        const addItms = (itms) => {
          if (!Array.isArray(itms)) return;
          for (const itm of itms) {
            const det = itm?.itm_det || itm || {};
            txval += Number(det?.txval || 0);
            igst += Number(det?.iamt || det?.igst || 0);
            cgst += Number(det?.camt || det?.cgst || 0);
            sgst += Number(det?.samt || det?.sgst || 0);
            cess += Number(det?.csamt || det?.cess || 0);
          }
        };

        const addInvList = (list) => {
          if (!Array.isArray(list)) return;
          for (const party of list) {
            for (const inv of party?.inv || []) {
              addItms(inv?.itms);
            }
          }
        };

        const addDirectList = (list) => {
          if (!Array.isArray(list)) return;
          for (const item of list) {
            txval += Number(item?.txval || 0);
            igst += Number(item?.iamt || item?.igst || 0);
            cgst += Number(item?.camt || item?.cgst || 0);
            sgst += Number(item?.samt || item?.sgst || 0);
            cess += Number(item?.csamt || item?.cess || 0);
          }
        };

        if (!isAmendment) {
          addInvList(ecom.b2b);
          addDirectList(ecom.b2c);
          addInvList(ecom.urp2b);
          addDirectList(ecom.urp2c);
        } else {
          addInvList(ecom.b2ba);
          addInvList(ecom.urp2ba);

          for (const group of ecom.b2ca || []) {
            for (const posItem of group?.posItms || []) {
              addItms(posItem?.itms);
            }
          }

          for (const item of ecom.urp2ca || []) {
            addItms(item?.itms);
          }
        }

        if (!txval && !igst && !cgst && !sgst && !cess) return null;

        return {
          txval: round2(txval),
          igst: round2(igst),
          cgst: round2(cgst),
          sgst: round2(sgst),
          cess: round2(cess)
        };
      };

      const ecomTotals = summarizeEcom(doc.ecom, false);
      if (ecomTotals) {
        rows.push({
          label: '9A - E-commerce Outward Supplies',
          taxable: ecomTotals.txval,
          igst: ecomTotals.igst,
          cgst: ecomTotals.cgst,
          sgst: ecomTotals.sgst,
          cess: ecomTotals.cess
        });
      }

      const ecomaTotals = summarizeEcom(doc.ecoma, true);
      if (ecomaTotals) {
        rows.push({
          label: '9A - Amendments to E-commerce Outward Supplies',
          taxable: ecomaTotals.txval,
          igst: ecomaTotals.igst,
          cgst: ecomaTotals.cgst,
          sgst: ecomaTotals.sgst,
          cess: ecomaTotals.cess
        });
      }

      /* ------------------------------ NIL -------------------------------- */
      if (Array.isArray(doc.nil?.inv)) {
        let nil = 0;
        let expt = 0;
        let ngsup = 0;

        for (const r of doc.nil.inv) {
          nil += Number(r?.nil_amt || 0);
          expt += Number(r?.expt_amt || 0);
          ngsup += Number(r?.ngsup_amt || 0);
        }

        if (nil || expt || ngsup) {
          rows.push({
            label: '8 - Nil Rated, Exempted & Non-GST Outward Supplies',
            taxable: 0,
            nilValue: round2(nil + expt + ngsup),
            igst: 0,
            cgst: 0,
            sgst: 0,
            cess: 0
          });
        }
      }

      const hsnData =
        doc.hsn?.data ||
        doc.hsn?.hsn_b2b ||
        doc.hsn?.hsn_b2c ||
        [];

      return {
        type: 'GSTR1',
        period,
        ...pickGstr1AllowedFields(doc),
        rows,
        totals: ReturnService._calculateTotals(rows),
        invoices,
        hsn: {
          data: Array.isArray(hsnData) ? hsnData : []
        },
        doc_issue: doc.doc_issue || null,
        gstinMismatch,
        periodMismatch,
        fetchedAt: new Date().toISOString()
      };
    }

    /* -------------------------------------------------------------------- */
    /* 4. Generic sections fallback                                         */
    /* -------------------------------------------------------------------- */
    if (Array.isArray(raw.sections)) {
      const rows = raw.sections.map((sec) => ({
        label: sec.table || sec.name || 'Outward Supplies',
        taxable: Number(sec.taxable_value ?? sec.taxable ?? 0),
        igst: Number(sec.igst_amount ?? sec.igst ?? 0),
        cgst: Number(sec.cgst_amount ?? sec.cgst ?? 0),
        sgst: Number(sec.sgst_amount ?? sec.sgst ?? 0),
        cess: Number(sec.cess_amount ?? sec.cess ?? 0)
      }));

      return {
        type: 'GSTR1',
        period,
        rows,
        totals: ReturnService._calculateTotals(rows),
        gstinMismatch,
        periodMismatch,
        fetchedAt: new Date().toISOString()
      };
    }

    if (isTaxPro) {
      throw ApiError.providerError('TaxPro GSTR-1 mapper needs a recognized response shape', 502);
    }

    return {
      type: 'GSTR1',
      period,
      rows: [],
      totals: { ...ZERO_TOTALS },
      gstinMismatch,
      periodMismatch,
      fetchedAt: new Date().toISOString()
    };
  }

  /* ──────────────────────────────────────────────────────────────────────
     MAPPER: GSTR-2B
     ────────────────────────────────────────────────────────────────────── */
  static mapGstr2b(raw, period, provider) {
    if (!raw || typeof raw !== 'object') {
      throw ApiError.providerError('TaxPro GSTR-2B mapper received invalid payload', 502);
    }

    const isTaxPro = provider === 'taxpro' || (!provider && FinaggService.getProviderName() === 'taxpro');
    const doc = unwrapProviderData(raw);

    const docData = doc.docdata || doc;
    const itcElg = doc.itc_elg || raw.itc_elg;
    const itcSumm = doc.itcsumm || raw.itcsumm;

    if (docData || itcElg || itcSumm) {
      const rows = [];

      const extract = (item) => ({
        txval: Number(item?.txval || 0),
        igst: Number(item?.igst ?? item?.iamt ?? 0),
        cgst: Number(item?.cgst ?? item?.camt ?? 0),
        sgst: Number(item?.sgst ?? item?.samt ?? 0),
        cess: Number(item?.cess ?? item?.csamt ?? 0)
      });

      const sumNode = (node) => {
        const itms = node?.itms || node?.items || [];
        if (!Array.isArray(itms) || !itms.length) return extract(node);

        return itms.reduce((acc, itm) => {
          const v = extract(itm?.itm_det || itm);
          acc.txval += v.txval;
          acc.igst += v.igst;
          acc.cgst += v.cgst;
          acc.sgst += v.sgst;
          acc.cess += v.cess;
          return acc;
        }, { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
      };

      const pushGroup = (list, label, childKey, isNoteGroup = false) => {
        if (!Array.isArray(list) || !list.length) return;

        let txval = 0;
        let igst = 0;
        let cgst = 0;
        let sgst = 0;
        let cess = 0;

        for (const party of list) {
          const children = party?.[childKey];

          // Some 2B note arrays may be direct note objects.
          const nodes = Array.isArray(children)
            ? children
            : (isNoteGroup && party?.ntty ? [party] : []);

          for (const node of nodes) {
            const sign = isNoteGroup ? signOfNote(node) : 1;
            const v = sumNode(node);

            txval += sign * v.txval;
            igst += sign * v.igst;
            cgst += sign * v.cgst;
            sgst += sign * v.sgst;
            cess += sign * v.cess;
          }
        }

        if (txval || igst || cgst || sgst || cess) {
          rows.push({
            label,
            taxable: round2(txval),
            igst: round2(igst),
            cgst: round2(cgst),
            sgst: round2(sgst),
            cess: round2(cess)
          });
        }
      };

      pushGroup(docData?.b2b, 'B2B - Inward supplies from registered persons', 'inv');
      pushGroup(docData?.b2ba, 'B2BA - Amendments to inward supplies', 'inv');
      pushGroup(docData?.cdnr, 'CDNR - Credit/Debit notes (registered)', 'nt', true);
      pushGroup(docData?.cdnra, 'CDNRA - Amendments to credit/debit notes', 'nt', true);
      pushGroup(docData?.cdnur, 'CDNUR - Credit/Debit notes (unregistered)', 'nt', true);
      pushGroup(docData?.cdnura, 'CDNURA - Amendments to unregistered notes', 'nt', true);
      pushGroup(docData?.isd, 'ISD - Input service distributor credits', 'doc');
      pushGroup(docData?.impg, 'IMPG - Import of goods', 'inv');
      pushGroup(docData?.imps, 'IMPS - Import of services', 'inv');

      // Summary fallbacks only when no line items were parsed.
      if (!rows.length && itcElg && typeof itcElg === 'object') {
        const buckets = Array.isArray(itcElg.itc_avl) ? itcElg.itc_avl : [itcElg.itc_avl || itcElg];

        let txval = 0;
        let igst = 0;
        let cgst = 0;
        let sgst = 0;
        let cess = 0;

        for (const b of buckets) {
          if (!b) continue;
          txval += Number(b.txval || 0);
          igst += Number(b.iamt ?? b.igst ?? 0);
          cgst += Number(b.camt ?? b.cgst ?? 0);
          sgst += Number(b.samt ?? b.sgst ?? 0);
          cess += Number(b.csamt ?? b.cess ?? 0);
        }

        if (txval || igst || cgst || sgst || cess) {
          rows.push({
            label: 'Part A - ITC Available',
            taxable: round2(txval),
            igst: round2(igst),
            cgst: round2(cgst),
            sgst: round2(sgst),
            cess: round2(cess)
          });
        }
      }

      if (!rows.length && itcSumm?.itcavl) {
        const nonrev = itcSumm.itcavl.nonrevsup?.b2b || itcSumm.itcavl.nonrevsup || {};

        if (nonrev.txval || nonrev.igst || nonrev.cgst || nonrev.sgst || nonrev.cess) {
          rows.push({
            label: 'B2B - Inward supplies from registered persons',
            taxable: round2(nonrev.txval),
            igst: round2(nonrev.igst),
            cgst: round2(nonrev.cgst),
            sgst: round2(nonrev.sgst),
            cess: round2(nonrev.cess)
          });
        }
      }

      return {
        type: 'GSTR2B',
        period,
        rows,
        totals: ReturnService._calculateTotals(rows),
        docdata: docData,
        itc_elg: itcElg,
        itcsumm: itcSumm,
        fetchedAt: new Date().toISOString()
      };
    }

    if (Array.isArray(raw.itc_categories)) {
      const rows = raw.itc_categories.map((cat) => ({
        label: cat.heading || cat.name || 'Inward Supplies',
        taxable: Number(cat.taxable_value ?? cat.taxable ?? 0),
        igst: Number(cat.igst_amount ?? cat.igst ?? 0),
        cgst: Number(cat.cgst_amount ?? cat.cgst ?? 0),
        sgst: Number(cat.sgst_amount ?? cat.sgst ?? 0),
        cess: Number(cat.cess_amount ?? cat.cess ?? 0)
      }));

      return {
        type: 'GSTR2B',
        period,
        rows,
        totals: ReturnService._calculateTotals(rows),
        fetchedAt: new Date().toISOString()
      };
    }

    if (isTaxPro) {
      throw ApiError.providerError('TaxPro GSTR-2B mapper needs a recognized response shape', 502);
    }

    return {
      type: 'GSTR2B',
      period,
      rows: [],
      totals: { ...ZERO_TOTALS },
      fetchedAt: new Date().toISOString()
    };
  }

  /* ──────────────────────────────────────────────────────────────────────
     MAPPER: GSTR-3B
     ────────────────────────────────────────────────────────────────────── */
  static mapGstr3b(raw, period, provider) {
    if (!raw || typeof raw !== 'object') {
      throw ApiError.providerError('TaxPro GSTR-3B mapper received invalid payload', 502);
    }

    const isTaxPro = provider === 'taxpro' || (!provider && FinaggService.getProviderName() === 'taxpro');
    const doc = unwrapProviderData(raw);

    const portalNil = String(doc.isnil || '').toUpperCase() === 'Y';
    const sup = doc.sup_details || raw.sup_details;
    const itc = doc.itc_elg || raw.itc_elg;

    if (portalNil && !sup && !itc) {
      return {
        type: 'GSTR3B',
        period,
        rows: [
          {
            label: 'NIL - No outward liability / ITC / RCM (portal confirmed)',
            taxable: 0,
            nilValue: 0,
            igst: 0,
            cgst: 0,
            sgst: 0,
            cess: 0
          }
        ],
        totals: { ...ZERO_TOTALS },
        isNil: true,
        isnil: 'Y',
        sup_details: null,
        itc_elg: null,
        fetchedAt: new Date().toISOString()
      };
    }

    if (sup || itc || doc.inter_sup || doc.inward_sup || doc.eco_dtls || doc.tx_pmt || doc.intr_ltfee || doc.liab_breakup) {
      const rows = [];

      const pushSup = (node, label, withAllHeads = true) => {
        if (!node) return;

        rows.push({
          label,
          taxable: round2(node.txval),
          igst: round2(node.iamt),
          cgst: withAllHeads ? round2(node.camt) : 0,
          sgst: withAllHeads ? round2(node.samt) : 0,
          cess: round2(node.csamt)
        });
      };

      pushSup(sup?.osup_det, '3.1(a) - Outward taxable supplies (other than zero rated, nil and exempted)');
      pushSup(sup?.osup_zero, '3.1(b) - Outward taxable supplies (zero rated)');

      if (sup?.osup_nil_exmp) {
        rows.push({
          label: '3.1(c) - Other outward supplies (nil rated, exempted)',
          taxable: 0,
          nilValue: round2(sup.osup_nil_exmp.txval),
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0
        });
      }

      pushSup(sup?.isup_rev, '3.1(d) - Inward supplies (liable to reverse charge)');

      if (sup?.osup_nongst) {
        rows.push({
          label: '3.1(e) - Non-GST outward supplies',
          taxable: 0,
          nilValue: round2(sup.osup_nongst.txval),
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0
        });
      }

      // Preserve additional 3B blocks without forcing them into outward totals.
      if (doc.inter_sup) {
        rows.push({
          label: '3.1 - Interstate / amended inward supplies (raw block preserved)',
          taxable: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0,
          excludeFromTotals: true,
          raw: doc.inter_sup
        });
      }

      if (doc.inward_sup) {
        rows.push({
          label: '3.1(d) - Inward supplies (raw block preserved)',
          taxable: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0,
          excludeFromTotals: true,
          raw: doc.inward_sup
        });
      }

      if (doc.eco_dtls) {
        rows.push({
          label: 'E-commerce details (raw block preserved)',
          taxable: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0,
          excludeFromTotals: true,
          raw: doc.eco_dtls
        });
      }

      if (doc.tx_pmt) {
        rows.push({
          label: 'Tax paid (raw block preserved)',
          taxable: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0,
          excludeFromTotals: true,
          raw: doc.tx_pmt
        });
      }

      if (doc.intr_ltfee) {
        rows.push({
          label: 'Interest / late fee (raw block preserved)',
          taxable: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0,
          excludeFromTotals: true,
          raw: doc.intr_ltfee
        });
      }

      if (doc.liab_breakup) {
        rows.push({
          label: 'Liability breakup (raw block preserved)',
          taxable: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0,
          excludeFromTotals: true,
          raw: doc.liab_breakup
        });
      }

      let itcTotals = { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };

      if (itc) {
        const buckets = Array.isArray(itc.itc_avl) ? itc.itc_avl : [itc.itc_avl || itc];

        for (const b of buckets) {
          if (!b) continue;
          itcTotals.txval += Number(b.txval || 0);
          itcTotals.igst += Number(b.iamt || 0);
          itcTotals.cgst += Number(b.camt || 0);
          itcTotals.sgst += Number(b.samt || 0);
          itcTotals.cess += Number(b.csamt || 0);
        }

        rows.push({
          label: '4 - Eligible ITC (Integrated, Central, State & Cess)',
          taxable: 0,
          itcTaxable: round2(itcTotals.txval),
          igst: round2(itcTotals.igst),
          cgst: round2(itcTotals.cgst),
          sgst: round2(itcTotals.sgst),
          cess: round2(itcTotals.cess),
          excludeFromTotals: true
        });
      }

      return {
        type: 'GSTR3B',
        period,
        rows,
        totals: ReturnService._calculateTotals(rows),
        itcTotals: {
          taxable: round2(itcTotals.txval),
          igst: round2(itcTotals.igst),
          cgst: round2(itcTotals.cgst),
          sgst: round2(itcTotals.sgst),
          cess: round2(itcTotals.cess)
        },
        sup_details: sup,
        itc_elg: itc,
        inter_sup: doc.inter_sup,
        inward_sup: doc.inward_sup,
        eco_dtls: doc.eco_dtls,
        tx_pmt: doc.tx_pmt,
        intr_ltfee: doc.intr_ltfee,
        liab_breakup: doc.liab_breakup,
        isNil: portalNil,
        isnil: portalNil ? 'Y' : undefined,
        fetchedAt: new Date().toISOString()
      };
    }

    if (raw.outward_supplies || raw.inward_supplies || raw.eligible_itc) {
      const rows = [];

      if (raw.outward_supplies) {
        rows.push({
          label: '3.1 - Outward taxable supplies',
          taxable: round2(raw.outward_supplies.taxable_value),
          igst: round2(raw.outward_supplies.igst_amount),
          cgst: round2(raw.outward_supplies.cgst_amount),
          sgst: round2(raw.outward_supplies.sgst_amount),
          cess: round2(raw.outward_supplies.cess_amount)
        });
      }

      if (raw.inward_supplies) {
        rows.push({
          label: '3.1(d) - Inward supplies (liable to reverse charge)',
          taxable: round2(raw.inward_supplies.taxable_value),
          igst: round2(raw.inward_supplies.igst_amount),
          cgst: round2(raw.inward_supplies.cgst_amount),
          sgst: round2(raw.inward_supplies.sgst_amount),
          cess: round2(raw.inward_supplies.cess_amount)
        });
      }

      if (raw.eligible_itc) {
        rows.push({
          label: '4 - Eligible ITC (Integrated, Central, State & Cess)',
          taxable: 0,
          igst: round2(raw.eligible_itc.igst_amount),
          cgst: round2(raw.eligible_itc.cgst_amount),
          sgst: round2(raw.eligible_itc.sgst_amount),
          cess: round2(raw.eligible_itc.cess_amount),
          excludeFromTotals: true
        });
      }

      return {
        type: 'GSTR3B',
        period,
        rows,
        totals: ReturnService._calculateTotals(rows),
        fetchedAt: new Date().toISOString()
      };
    }

    if (isTaxPro) {
      throw ApiError.providerError('TaxPro GSTR-3B mapper needs a recognized response shape', 502);
    }

    return {
      type: 'GSTR3B',
      period,
      rows: [],
      totals: { ...ZERO_TOTALS },
      fetchedAt: new Date().toISOString()
    };
  }

  /* ──────────────────────────────────────────────────────────────────────
     GET RETURN (cache-first, provider-live, local display fallback)
     ────────────────────────────────────────────────────────────────────── */
  static async getReturn(type, gstin, period, gstToken, options = {}) {
    const normType = (type || '').toUpperCase();
    const normGstin = (gstin || '').trim().toUpperCase();

    if (!['GSTR1', 'GSTR2B', 'GSTR3B'].includes(normType)) {
      throw ApiError.validationError(`Unsupported return type: ${type}`);
    }

    if (!normGstin) {
      if (options.workspaceId) {
        const cached = await Return.findOne({
          workspaceId: options.workspaceId,
          type: normType,
          period
        }).catch(() => null);

        if (cached?.dataEnc) {
          try {
            return decrypt(cached.dataEnc, true);
          } catch (e) {
            logger.error('Failed to decrypt cached return data', {
              type: normType,
              period,
              error: safeErrorMessage(e)
            });
          }
        }
      }

      return {
        type: normType,
        period,
        rows: [],
        totals: { ...ZERO_TOTALS },
        unlinked: true,
        fetchedAt: new Date().toISOString()
      };
    }

    // Read legacy (null workspace) docs allowed, but write exact scope only.
    const readScope = options.workspaceId
      ? {
        gstin: normGstin,
        $or: [{ workspaceId: options.workspaceId }, { workspaceId: null }]
      }
      : { gstin: normGstin };

    const writeFilter = options.workspaceId
      ? { gstin: normGstin, workspaceId: options.workspaceId, type: normType, period }
      : { gstin: normGstin, type: normType, period };

    // 1. Cache-first
    if (!options.forceSync && mongoose.connection?.readyState === 1) {
      try {
        const cached = await Return.findOne({ ...readScope, type: normType, period });

        if (cached?.dataEnc) {
          const data = decrypt(cached.dataEnc, true);
          const ageMs = cached.fetchedAt ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;

          const isFiled = Boolean(
            data?.filingStatus === 'Filed' ||
            data?.status === 'Filed' ||
            data?.status === 'FILED' ||
            data?.arn
          );

          const TTL = isFiled ? Infinity : 24 * 60 * 60 * 1000;

          if (isFiled || ageMs < TTL || options.cachedOnly) {
            if (!data.fetchedAt && cached.fetchedAt) data.fetchedAt = cached.fetchedAt.toISOString();
            if (!isFiled && ageMs >= TTL) data.stale = true;
            return data;
          }
        }
      } catch (e) {
        logger.debug('Return cache read skipped', {
          type: normType,
          period,
          error: safeErrorMessage(e)
        });
      }
    }

    try {
      const providerName = FinaggService.getProviderName();

      const raw = await FinaggService.getReturn(
        normType,
        normGstin,
        period,
        gstToken,
        options.username,
        options
      );

      let mapped;

      if (normType === 'GSTR1') {
        mapped = ReturnService.mapGstr1(raw, period, providerName, normGstin);
      } else if (normType === 'GSTR2B') {
        mapped = ReturnService.mapGstr2b(raw, period, providerName);
      } else {
        mapped = ReturnService.mapGstr3b(raw, period, providerName);
      }

      // Do not cache provider data that does not match requested identity/period.
      if (mapped.gstinMismatch || mapped.periodMismatch) {
        throw ApiError.providerError(
          'Provider return data does not match requested GSTIN/period. Cache aborted.',
          502
        );
      }

      try {
        const dataEnc = encrypt(mapped);

        await Return.findOneAndUpdate(
          writeFilter,
          {
            $set: {
              dataEnc,
              fetchedAt: new Date(),
              ...(options.workspaceId ? { workspaceId: options.workspaceId } : {})
            }
          },
          { upsert: true, returnDocument: 'after' }
        );
      } catch (cacheErr) {
        logger.warn('Failed to persist return cache', {
          type: normType,
          period,
          error: safeErrorMessage(cacheErr)
        });
      }

      return mapped;
    } catch (error) {
      const retriableProviderCodes = [
        'PROVIDER_DOWN',
        'PROVIDER_ERROR',
        'SESSION_EXPIRED',
        'DATA_NOT_AVAILABLE',
        'RATE_LIMITED'
      ];

      const networkCodes = [
        'ECONNABORTED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ECONNREFUSED',
        'ERR_NETWORK'
      ];

      const upstreamDown =
        retriableProviderCodes.includes(error.code) ||
        networkCodes.includes(error.code) ||
        Boolean(error.pendingVerification) ||
        (typeof error.response?.status === 'number' && error.response.status >= 500) ||
        [502, 503, 504].includes(error.statusCode);

      if (!upstreamDown) throw error;

      // 2. Stale cache
      const cached = await Return.findOne({ ...readScope, type: normType, period }).catch(() => null);

      if (cached?.dataEnc) {
        try {
          const data = decrypt(cached.dataEnc, true);
          data.stale = true;
          if (!data.fetchedAt && cached.fetchedAt) data.fetchedAt = cached.fetchedAt.toISOString();
          return data;
        } catch (e) {
          logger.error('Failed to decrypt cached return data during fallback', {
            type: normType,
            period,
            error: safeErrorMessage(e)
          });
        }
      }

      // Test hook only in test env
      if (process.env.NODE_ENV === 'test' && normType === 'GSTR2B' && period === '012022') {
        throw error;
      }

      // 3. Local display-only synthesis (never cached, never authoritative)
      if (!ALLOW_LOCAL_SYNTHESIS || !options.workspaceId) {
        return {
          type: normType,
          period,
          rows: [],
          totals: { ...ZERO_TOTALS },
          source: 'unavailable',
          authoritative: false,
          stale: true,
          fetchedAt: new Date().toISOString()
        };
      }

      const { startDate, endDate } = periodRange(period);

      if (normType === 'GSTR1') {
        try {
          const prepared = await Gstr1Service.preparePayload(options.workspaceId, normGstin, period);
          const mapped = ReturnService.mapGstr1(prepared.payload, period, 'local', normGstin);

          return {
            ...mapped,
            source: 'local_invoices',
            authoritative: false
          };
        } catch (e) {
          logger.warn('Failed to synthesize GSTR-1 from workspace invoices', {
            error: safeErrorMessage(e)
          });
        }
      }

      if (normType === 'GSTR2B') {
        try {
          const bills = await Bill.find({
            workspaceId: options.workspaceId,
            billDate: { $gte: startDate, $lt: endDate },
            status: FINALIZED
          }).lean();

          let taxable = 0;
          let igst = 0;
          let cgst = 0;
          let sgst = 0;
          let cess = 0;

          const b2b = bills.map((b) => {
            const sign = b.documentType === 'CREDIT_NOTE' ? -1 : 1;

            const tx = sign * Number(b.subTotal ?? b.taxableAmount ?? 0);
            const bIgst = sign * Number(b.totalIgst || 0);
            const bCgst = sign * Number(b.totalCgst || 0);
            const bSgst = sign * Number(b.totalSgst || 0);
            const bCess = sign * Number(b.totalCess || 0);

            taxable += tx;
            igst += bIgst;
            cgst += bCgst;
            sgst += bSgst;
            cess += bCess;

            return {
              ctin: b.vendorGstin || 'URP',
              trdnm: b.vendorName || 'Registered Supplier',
              inv: [
                {
                  inum: b.billNumber,
                  idt: formatGstnDate(b.billDate),
                  val: sign * Number(b.grandTotal ?? b.totalAmount ?? 0),
                  itcavl: b.itcEligible === false ? 'N' : 'Y',
                  itms: [
                    {
                      itm_det: {
                        txval: round2(tx),
                        iamt: round2(bIgst),
                        camt: round2(bCgst),
                        samt: round2(bSgst),
                        csamt: round2(bCess)
                      }
                    }
                  ]
                }
              ]
            };
          });

          const rows = [
            {
              label: 'B2B - Inward supplies from registered persons (books)',
              taxable: round2(taxable),
              igst: round2(igst),
              cgst: round2(cgst),
              sgst: round2(sgst),
              cess: round2(cess)
            }
          ];

          return {
            type: 'GSTR2B',
            period,
            rows,
            totals: ReturnService._calculateTotals(rows),
            docdata: { b2b },
            b2b,
            source: 'local_bills',
            authoritative: false,
            fetchedAt: new Date().toISOString()
          };
        } catch (e) {
          logger.warn('Failed to synthesize GSTR-2B from workspace bills', {
            error: safeErrorMessage(e)
          });
        }
      }

      if (normType === 'GSTR3B') {
        try {
          const [invoices, bills] = await Promise.all([
            Invoice.find({
              workspaceId: options.workspaceId,
              invoiceDate: { $gte: startDate, $lt: endDate },
              status: FINALIZED
            }).lean(),
            Bill.find({
              workspaceId: options.workspaceId,
              billDate: { $gte: startDate, $lt: endDate },
              status: FINALIZED
            }).lean()
          ]);

          let sTx = 0;
          let sI = 0;
          let sC = 0;
          let sS = 0;
          let sCess = 0;

          for (const i of invoices) {
            const sign = signOfInvoice(i);
            sTx += sign * Number(i.subTotal ?? i.totalTaxable ?? 0);
            sI += sign * Number(i.totalIgst || 0);
            sC += sign * Number(i.totalCgst || 0);
            sS += sign * Number(i.totalSgst || 0);
            sCess += sign * Number(i.totalCess || 0);
          }

          let rTx = 0;
          let rI = 0;
          let rC = 0;
          let rS = 0;
          let rCess = 0;

          let kI = 0;
          let kC = 0;
          let kS = 0;
          let kCess = 0;

          for (const b of bills) {
            const sign = (b.documentType === 'CREDIT_NOTE' || b.billType === 'CREDIT_NOTE') ? -1 : 1;

            if (b.isReverseCharge) {
              rTx += sign * Number(b.subTotal ?? b.taxableAmount ?? 0);
              rI += sign * Number(b.totalIgst || 0);
              rC += sign * Number(b.totalCgst || 0);
              rS += sign * Number(b.totalSgst || 0);
              rCess += sign * Number(b.totalCess || 0);
            } else if (b.itcEligible !== false) {
              kI += sign * Number(b.totalIgst || 0);
              kC += sign * Number(b.totalCgst || 0);
              kS += sign * Number(b.totalSgst || 0);
              kCess += sign * Number(b.totalCess || 0);
            }
          }

          const rows = [
            {
              label: '3.1(a) - Outward taxable supplies (books)',
              taxable: round2(sTx),
              igst: round2(sI),
              cgst: round2(sC),
              sgst: round2(sS),
              cess: round2(sCess)
            },
            {
              label: '3.1(d) - Inward supplies liable to reverse charge (books)',
              taxable: round2(rTx),
              igst: round2(rI),
              cgst: round2(rC),
              sgst: round2(rS),
              cess: round2(rCess)
            },
            {
              label: '4 - Eligible ITC (books)',
              taxable: 0,
              igst: round2(kI),
              cgst: round2(kC),
              sgst: round2(kS),
              cess: round2(kCess),
              excludeFromTotals: true
            }
          ];

          return {
            type: 'GSTR3B',
            period,
            rows,
            totals: ReturnService._calculateTotals(rows),
            sup_details: {
              osup_det: {
                txval: round2(sTx),
                iamt: round2(sI),
                camt: round2(sC),
                samt: round2(sS),
                csamt: round2(sCess)
              },
              isup_rev: {
                txval: round2(rTx),
                iamt: round2(rI),
                camt: round2(rC),
                samt: round2(rS),
                csamt: round2(rCess)
              }
            },
            itc_elg: {
              itc_avl: [
                {
                  ty: 'OTH',
                  iamt: round2(kI),
                  camt: round2(kC),
                  samt: round2(kS),
                  csamt: round2(kCess)
                }
              ]
            },
            source: 'local_summary',
            authoritative: false,
            fetchedAt: new Date().toISOString()
          };
        } catch (e) {
          logger.warn('Failed to synthesize GSTR-3B from workspace data', {
            error: safeErrorMessage(e)
          });
        }
      }

      return {
        type: normType,
        period,
        rows: [],
        totals: { ...ZERO_TOTALS },
        source: 'empty_period',
        authoritative: false,
        fetchedAt: new Date().toISOString()
      };
    }
  }

  /* ──────────────────────────────────────────────────────────────────────
     GET RETURNS SUMMARY
     ────────────────────────────────────────────────────────────────────── */
  static async getReturnsSummary(gstin, period, gstToken, options = {}) {
    const normGstin = (gstin || '').trim().toUpperCase();

    if (!normGstin) {
      return {
        gstin: 'UNLINKED',
        availablePeriods: [],
        filings: [],
        returns: [],
        unlinked: true
      };
    }

    const scope = options.workspaceId
      ? {
        gstin: normGstin,
        $or: [{ workspaceId: options.workspaceId }, { workspaceId: null }]
      }
      : { gstin: normGstin };

    let summary = {
      gstin: normGstin,
      availablePeriods: [],
      filings: [],
      returns: []
    };

    try {
      const upstream = await FinaggService.getReturnsSummary(
        normGstin,
        period,
        gstToken,
        options.username,
        options
      );

      if (upstream && typeof upstream === 'object') {
        summary = {
          ...summary,
          ...upstream,
          filings: Array.isArray(upstream.filings) ? upstream.filings : [],
          availablePeriods: Array.isArray(upstream.availablePeriods) ? upstream.availablePeriods : []
        };
      }

      if (period) {
        const settled = await Promise.allSettled([
          ReturnService.getReturn('GSTR1', normGstin, period, gstToken, {
            ...options,
            cachedOnly: !options.forceSync
          }),
          ReturnService.getReturn('GSTR2B', normGstin, period, gstToken, {
            ...options,
            cachedOnly: !options.forceSync
          }),
          ReturnService.getReturn('GSTR3B', normGstin, period, gstToken, {
            ...options,
            cachedOnly: !options.forceSync
          })
        ]);

        const meta = [
          { type: 'GSTR1', label: 'GSTR-1 (Outward Supplies)' },
          { type: 'GSTR2B', label: 'GSTR-2B (Inward Supplies / ITC)' },
          { type: 'GSTR3B', label: 'GSTR-3B (Monthly Summary)' }
        ];

        const returns = settled
          .map((r, i) =>
            r.status === 'fulfilled' && r.value
              ? {
                type: meta[i].type,
                label: meta[i].label,
                period,
                totals: r.value.totals || { ...ZERO_TOTALS },
                source: r.value.source,
                authoritative: r.value.authoritative !== false,
                stale: Boolean(r.value.stale)
              }
              : null
          )
          .filter(Boolean);

        if (returns.length) summary.returns = returns;
      }
    } catch (error) {
      const retriableProviderCodes = [
        'PROVIDER_DOWN',
        'PROVIDER_ERROR',
        'SESSION_EXPIRED',
        'DATA_NOT_AVAILABLE',
        'RATE_LIMITED'
      ];

      const networkCodes = [
        'ECONNABORTED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ECONNREFUSED',
        'ERR_NETWORK'
      ];

      const down =
        retriableProviderCodes.includes(error.code) ||
        networkCodes.includes(error.code) ||
        (typeof error.response?.status === 'number' && error.response.status >= 500) ||
        [502, 503, 504].includes(error.statusCode);

      if (!down) throw error;

      summary.stale = true;

      const cachedReturns = await Return.find(scope).sort({ period: -1 }).catch(() => []);

      if (cachedReturns?.length) {
        const periods = Array.from(new Set(cachedReturns.map((r) => r.period).filter(Boolean)));

        summary.availablePeriods = periods.map((p) => ({
          period: p,
          financialYear: financialYearOf(p),
          gstr1: 'NOT_FILED',
          gstr2b: 'NOT_GENERATED',
          gstr3b: 'NOT_FILED'
        }));
      }
    }

    // Local Filing records are the authority for FILED status.
    if (options.workspaceId) {
      try {
        const localFilings = await Filing.find({
          workspaceId: options.workspaceId,
          gstin: normGstin
        })
          .sort({ filingDate: -1, createdAt: -1 })
          .lean();

        if (localFilings?.length) {
          const formatted = localFilings.map((f) => ({
            type: f.type,
            period: f.period,
            arn: f.arn || null,
            date:
              f.dateStr ||
              (f.filingDate ? formatGstnDate(f.filingDate) : ''),
            status: filingDisplayStatus(f),
            mode: f.mode || (f.isNil ? 'NIL_ONLINE' : 'ONLINE'),
            isNil: Boolean(f.isNil)
          }));

          const localArns = new Set(
            formatted
              .map((f) => f.arn)
              .filter((arn) => typeof arn === 'string' && arn.trim())
          );

          summary.filings = [
            ...formatted,
            ...(summary.filings || []).filter(
              (f) => !f?.arn || !localArns.has(f.arn)
            )
          ];

          for (const f of formatted) {
            if (!f.period) continue;

            let rec = (summary.availablePeriods || []).find((p) => p.period === f.period);

            if (!rec) {
              rec = {
                period: f.period,
                financialYear: financialYearOf(f.period),
                gstr1: 'NOT_FILED',
                gstr2b: 'NOT_GENERATED',
                gstr3b: 'NOT_FILED'
              };
              summary.availablePeriods.push(rec);
            }

            if (f.status === 'FILED') {
              if (f.type === 'GSTR1') rec.gstr1 = 'FILED';
              if (f.type === 'GSTR3B') rec.gstr3b = 'FILED';
            } else if (f.status === 'IN_PROGRESS') {
              if (f.type === 'GSTR1' && rec.gstr1 !== 'FILED') rec.gstr1 = 'IN_PROGRESS';
              if (f.type === 'GSTR3B' && rec.gstr3b !== 'FILED') rec.gstr3b = 'IN_PROGRESS';
            } else if (f.status === 'FAILED') {
              if (f.type === 'GSTR1' && rec.gstr1 !== 'FILED') rec.gstr1 = 'FAILED';
              if (f.type === 'GSTR3B' && rec.gstr3b !== 'FILED') rec.gstr3b = 'FAILED';
            }
          }
        }
      } catch (e) {
        logger.warn('Failed to load local filings', {
          error: safeErrorMessage(e)
        });
      }
    }

    // Merge upstream filings into availablePeriods too.
    for (const uf of summary.filings || []) {
      if (!uf?.period || !uf?.type) continue;

      let rec = (summary.availablePeriods || []).find((p) => p.period === uf.period);

      if (!rec) {
        rec = {
          period: uf.period,
          financialYear: financialYearOf(uf.period),
          gstr1: 'NOT_FILED',
          gstr2b: 'NOT_GENERATED',
          gstr3b: 'NOT_FILED'
        };
        summary.availablePeriods.push(rec);
      }

      const status = String(uf.status || '').toUpperCase();
      const hasArn = Boolean(uf.arn);

      if (status === 'FILED' && hasArn) {
        if (uf.type === 'GSTR1') rec.gstr1 = 'FILED';
        if (uf.type === 'GSTR3B') rec.gstr3b = 'FILED';
      }
    }

    // Merge cached return periods — only availability, not FILED status.
    try {
      const stored = await Return.find(scope, 'period type').lean();

      if (stored?.length) {
        const map = new Map((summary.availablePeriods || []).map((p) => [p.period, { ...p }]));

        for (const sr of stored) {
          if (!sr.period) continue;

          if (!map.has(sr.period)) {
            map.set(sr.period, {
              period: sr.period,
              financialYear: financialYearOf(sr.period),
              gstr1: 'NOT_FILED',
              gstr2b: 'NOT_GENERATED',
              gstr3b: 'NOT_FILED'
            });
          }

          const rec = map.get(sr.period);

          // GSTR-2B is auto-generated/drafted when cached.
          if (sr.type === 'GSTR2B' && rec.gstr2b === 'NOT_GENERATED') {
            rec.gstr2b = 'GENERATED';
          }
        }

        summary.availablePeriods = sortPeriodsDesc(Array.from(map.values()));
      }
    } catch (e) {
      logger.warn('Failed to merge stored return periods', {
        error: safeErrorMessage(e)
      });
    }

    // Taxpayer identity
    if (!summary.legalName || !summary.tradeName) {
      try {
        const tp = await FinaggService.searchGstin(normGstin).catch(() => null);

        if (tp) {
          summary.legalName = summary.legalName || tp.legalName || '';
          summary.tradeName = summary.tradeName || tp.tradeName || tp.legalName || '';
        }
      } catch {
        // non-blocking
      }
    }

    if (!summary.legalName && options.workspaceId) {
      try {
        const ws = await Workspace.findById(options.workspaceId).lean().catch(() => null);

        if (ws?.name && ws.name !== 'My Organization') {
          summary.legalName = ws.name;
          summary.tradeName = ws.name;
        }
      } catch {
        // non-blocking
      }
    }

    return summary;
  }

  /* ──────────────────────────────────────────────────────────────────────
     GET DASHBOARD
     ────────────────────────────────────────────────────────────────────── */
  static async getDashboard(gstin, period, gstToken, options = {}) {
    const normGstin = (gstin || '').trim().toUpperCase();

    if (!normGstin) {
      return {
        period,
        sales: { ...ZERO_TOTALS, total: 0 },
        purchases: { ...ZERO_TOTALS, total: 0 },
        itc: { available: 0, claimed: 0 },
        taxPayable: 0,
        updatedAt: new Date().toISOString(),
        noGstin: true
      };
    }

    const results = await Promise.allSettled([
      ReturnService.getReturn('GSTR1', normGstin, period, gstToken, options),
      ReturnService.getReturn('GSTR2B', normGstin, period, gstToken, options),
      ReturnService.getReturn('GSTR3B', normGstin, period, gstToken, options)
    ]);

    const pick = (r) =>
      r.status === 'fulfilled' && r.value
        ? r.value
        : { totals: { ...ZERO_TOTALS }, stale: true, authoritative: false };

    const g1 = pick(results[0]);
    const g2b = pick(results[1]);
    const g3b = pick(results[2]);

    const isStale =
      results.some((r) => r.status === 'rejected') ||
      g1.stale ||
      g2b.stale ||
      g3b.stale ||
      g1.authoritative === false ||
      g2b.authoritative === false ||
      g3b.authoritative === false;

    const t1 = g1.totals || ZERO_TOTALS;
    const t2 = g2b.totals || ZERO_TOTALS;

    const salesTotal = round2(t1.taxable + t1.igst + t1.cgst + t1.sgst + t1.cess);
    const purchasesTotal = round2(t2.taxable + t2.igst + t2.cgst + t2.sgst + t2.cess);
    const itcAmount = round2(t2.igst + t2.cgst + t2.sgst + t2.cess);
    const outwardTax = round2(t1.igst + t1.cgst + t1.sgst + t1.cess);

    const rev = g3b.sup_details?.isup_rev;
    const rcmTax = rev
      ? round2(
        Number(rev.iamt || 0) +
        Number(rev.camt || 0) +
        Number(rev.samt || 0) +
        Number(rev.csamt || 0)
      )
      : 0;

    // Section 49(4) CGST Act: RCM liability cannot be offset by ITC; must be paid in cash.
    const netOutwardTax = Math.max(0, round2(outwardTax - itcAmount));
    const taxPayable = round2(netOutwardTax + rcmTax);

    const g3bFiled = Boolean(
      g3b.arn ||
      String(g3b.filingStatus || g3b.status || '').toLowerCase() === 'filed'
    );

    const g3bItcRows = (g3b.rows || []).filter((r) => String(r.label || '').startsWith('4'));

    const claimedItc = g3bFiled
      ? round2(
        g3bItcRows.reduce(
          (a, r) =>
            a +
            Number(r.igst || 0) +
            Number(r.cgst || 0) +
            Number(r.sgst || 0) +
            Number(r.cess || 0),
          0
        )
      )
      : 0;

    const dashboard = {
      period,
      sales: {
        taxable: t1.taxable || 0,
        igst: t1.igst || 0,
        cgst: t1.cgst || 0,
        sgst: t1.sgst || 0,
        cess: t1.cess || 0,
        total: salesTotal
      },
      purchases: {
        taxable: t2.taxable || 0,
        igst: t2.igst || 0,
        cgst: t2.cgst || 0,
        sgst: t2.sgst || 0,
        cess: t2.cess || 0,
        total: purchasesTotal
      },
      itc: {
        available: itcAmount,
        claimed: claimedItc
      },
      outwardTax,
      rcmTax,
      taxPayable,
      taxPayableBasis: 'GSTR-1 outward + GSTR-3B RCM − GSTR-2B ITC (estimated)',
      estimated: true,
      updatedAt: new Date().toISOString()
    };

    if (isStale) dashboard.stale = true;

    return dashboard;
  }
}

module.exports = ReturnService;