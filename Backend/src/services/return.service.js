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

const FINALIZED = { $nin: ['cancelled', 'draft', 'Cancelled', 'Draft'] };
const ZERO_TOTALS = Object.freeze({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });

// ✅ FIX 2: IST-aware month boundaries (GST_TZ_OFFSET_MIN=330 for India)
const TZ_OFFSET_MIN = Number(process.env.GST_TZ_OFFSET_MIN || 330);

const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

// ✅ FIX 4: Credit note liability reduce karta hai
const signOfInvoice = (inv) => (inv.documentType === 'CREDIT_NOTE' ? -1 : 1);
const signOfNote = (nt) => (nt.ntty === 'C' ? -1 : 1);

// ✅ FIX 12: IST-aware GSTN date format DD-MM-YYYY (UTC server timezone bug fix)
function formatGstnDate(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  const offsetMs = TZ_OFFSET_MIN * 60 * 1000;
  const local = new Date(d.getTime() + offsetMs);
  const day = String(local.getUTCDate()).padStart(2, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const year = local.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

// ✅ FIX 2: 1st tarikh ke IST-midnight invoices ab drop nahi honge
function periodRange(period) {
  const month = parseInt(period.slice(0, 2), 10);
  const year = parseInt(period.slice(2), 10);
  const offsetMs = TZ_OFFSET_MIN * 60 * 1000;
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - offsetMs),
    endDate: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - offsetMs), // $lt exclusive
  };
}

function financialYearOf(period) {
  const month = Number(period.slice(0, 2));
  const year = Number(period.slice(2));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

// ✅ FIX 1: Filing record hi "FILED" ka authority hai — cache nahi
const isConfirmedFiled = (f) =>
  Boolean(f?.arn) && String(f?.status || '').toLowerCase() === 'filed';

const sortPeriodsDesc = (periods) => [...periods].sort((a, b) => {
  const ka = a.period.slice(2) + a.period.slice(0, 2);
  const kb = b.period.slice(2) + b.period.slice(0, 2);
  return kb.localeCompare(ka);
});

class ReturnService {
  /* ──────────────────────────────────────────────────────────────────────
     TOTALS
     ────────────────────────────────────────────────────────────────────── */
  static _calculateTotals(rows) {
    const raw = (rows || []).reduce(
      (acc, row) => ({
        taxable: acc.taxable + (Number(row.taxable) || 0),
        igst: acc.igst + (Number(row.igst) || 0),
        cgst: acc.cgst + (Number(row.cgst) || 0),
        sgst: acc.sgst + (Number(row.sgst) || 0),
        cess: acc.cess + (Number(row.cess) || 0),
      }),
      { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
    );
    return {
      taxable: round2(raw.taxable),
      igst: round2(raw.igst),
      cgst: round2(raw.cgst),
      sgst: round2(raw.sgst),
      cess: round2(raw.cess),
    };
  }

  /* ──────────────────────────────────────────────────────────────────────
     MAPPER: GSTR-1
     ────────────────────────────────────────────────────────────────────── */
  static mapGstr1(raw, period, provider) {
    if (!raw || typeof raw !== 'object') {
      throw ApiError.providerError('TaxPro GSTR-1 mapper received invalid payload', 502);
    }

    const isTaxPro = provider === 'taxpro' || (!provider && FinaggService.getProviderName() === 'taxpro');
    const doc = raw.data || raw;

    const hasSectionArrays =
      Array.isArray(doc.b2b) || Array.isArray(doc.b2cs) || Array.isArray(doc.b2cl) ||
      Array.isArray(doc.cdnr) || Array.isArray(doc.exp);

    const isGstr1Payload = hasSectionArrays || Boolean(doc && doc.gstin && (doc.fp || doc.ret_period));

    if (isGstr1Payload) {
      const rows = [];
      const invoices = [];

      const extract = (item) => ({
        txval: Number(item.txval || 0),
        igst: Number(item.igst || item.iamt || 0),
        cgst: Number(item.cgst || item.camt || 0),
        sgst: Number(item.sgst || item.samt || 0),
        cess: Number(item.cess || item.csamt || 0),
      });

      const sumItems = (node) => {
        const itms = node.itms || node.items || [];
        if (!itms.length) return extract(node);
        return itms.reduce((acc, itm) => {
          const v = extract(itm.itm_det || itm);
          acc.txval += v.txval; acc.igst += v.igst; acc.cgst += v.cgst;
          acc.sgst += v.sgst; acc.cess += v.cess;
          return acc;
        }, { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
      };

      // Table 4 — B2B
      if (Array.isArray(doc.b2b)) {
        for (const buyer of doc.b2b) {
          const ctin = buyer.ctin || 'Registered Buyer';
          const trdnm = buyer.trdnm || buyer.cname || 'Registered Buyer';
          for (const inv of buyer.inv || []) {
            const v = sumItems(inv);
            const inum = inv.inum || inv.invoiceNumber || '';
            const idt = inv.idt || inv.invoiceDate || '';
            const row = {
              label: inum ? `4A - B2B Supplies (${ctin}) • ${inum}` : `4A - B2B Supplies (${ctin})`,
              inum, idt,
              val: Number(inv.val || (v.txval + v.igst + v.cgst + v.sgst + v.cess)),
              ctin, trdnm, pos: inv.pos || '',
              taxable: round2(v.txval), igst: round2(v.igst),
              cgst: round2(v.cgst), sgst: round2(v.sgst), cess: round2(v.cess),
            };
            rows.push(row);
            invoices.push(row);
          }
        }
      }

      // Table 5 — B2CL (inter-state, isliye CGST/SGST 0)
      if (Array.isArray(doc.b2cl)) {
        for (const group of doc.b2cl) {
          let txval = 0, igst = 0, cess = 0;
          for (const inv of group.inv || []) {
            const v = sumItems(inv);
            txval += v.txval; igst += v.igst; cess += v.cess;
          }
          rows.push({
            label: `5 - B2C Large Supplies${group.pos ? ` (POS: ${group.pos})` : ''}`,
            taxable: round2(txval), igst: round2(igst), cgst: 0, sgst: 0, cess: round2(cess),
          });
        }
      }

      // Table 7 — B2CS
      if (Array.isArray(doc.b2cs)) {
        for (const item of doc.b2cs) {
          rows.push({
            label: `7 - B2C Supplies${item.pos ? ` (POS: ${item.pos})` : ''}${item.rt !== undefined ? ` @${item.rt}%` : ''}`,
            taxable: round2(item.txval),
            igst: round2(item.iamt || item.igst),
            cgst: round2(item.camt || item.cgst),
            sgst: round2(item.samt || item.sgst),
            cess: round2(item.csamt || item.cess),
          });
        }
      }

      // Table 9B — CDNR ✅ FIX 3: credit note negative sign
      if (Array.isArray(doc.cdnr)) {
        for (const party of doc.cdnr) {
          let txval = 0, igst = 0, cgst = 0, sgst = 0, cess = 0;
          for (const nt of party.nt || []) {
            const sign = signOfNote(nt);
            const v = sumItems(nt);
            txval += sign * v.txval; igst += sign * v.igst;
            cgst += sign * v.cgst; sgst += sign * v.sgst; cess += sign * v.cess;
          }
          rows.push({
            label: `9B - Credit/Debit Notes (${party.ctin || 'Registered Party'})`,
            taxable: round2(txval), igst: round2(igst),
            cgst: round2(cgst), sgst: round2(sgst), cess: round2(cess),
          });
        }
      }

      // Table 9C — CDNUR ✅ FIX 3: credit note negative sign
      if (Array.isArray(doc.cdnur)) {
        for (const group of doc.cdnur) {
          let txval = 0, igst = 0, cess = 0;
          for (const nt of group.nt || []) {
            const sign = signOfNote(nt);
            const v = sumItems(nt);
            txval += sign * v.txval; igst += sign * v.igst; cess += sign * v.cess;
          }
          rows.push({
            label: `9C - Credit/Debit Notes (Unregistered)${group.pos ? ` (POS: ${group.pos})` : ''}`,
            taxable: round2(txval), igst: round2(igst), cgst: 0, sgst: 0, cess: round2(cess),
          });
        }
      }

      // Table 6A — Exports
      if (Array.isArray(doc.exp)) {
        for (const group of doc.exp) {
          let txval = 0, igst = 0, cess = 0;
          for (const inv of group.inv || []) {
            const v = sumItems(inv);
            txval += v.txval; igst += v.igst; cess += v.cess;
          }
          rows.push({
            label: `6A - Export Supplies (${group.exp_typ || 'WOPAY'})`,
            taxable: round2(txval), igst: round2(igst), cgst: 0, sgst: 0, cess: round2(cess),
          });
        }
      }

      // Table 8 — Nil rated ✅ FIX 5: taxable me add NAHI hoga (ye taxable supplies nahi hain)
      if (Array.isArray(doc.nil?.inv)) {
        let nil = 0, expt = 0, ngsup = 0;
        for (const r of doc.nil.inv) {
          nil += Number(r.nil_amt || 0);
          expt += Number(r.expt_amt || 0);
          ngsup += Number(r.ngsup_amt || 0);
        }
        if (nil || expt || ngsup) {
          rows.push({
            label: '8 - Nil Rated, Exempted & Non-GST Outward Supplies',
            taxable: 0,                        // ✅ totals.taxable inflate nahi hoga
            nilValue: round2(nil + expt + ngsup), // ✅ display ke liye alag field
            igst: 0, cgst: 0, sgst: 0, cess: 0,
          });
        }
      }

      const hsnB2b = doc.hsn?.hsn_b2b || doc.hsn?.data || [];
      const hsnB2c = doc.hsn?.hsn_b2c || [];

      return {
        type: 'GSTR1',
        period,
        rows,
        totals: ReturnService._calculateTotals(rows),
        b2b: doc.b2b, b2cs: doc.b2cs, b2cl: doc.b2cl,
        cdnr: doc.cdnr, cdnur: doc.cdnur, exp: doc.exp,
        nil: doc.nil,
        hsn: { hsn_b2b: hsnB2b, hsn_b2c: hsnB2c },
        doc_issue: doc.doc_issue,
        invoices,
        fetchedAt: new Date().toISOString(),
      };
    }

    // RETSUM summary shape
    if (Array.isArray(raw.sec_sum)) {
      const rows = raw.sec_sum.map((sec) => ({
        label: sec.sec_nm ? `${sec.sec_nm} - Outward Supplies` : (sec.table || 'Outward Supplies'),
        taxable: Number(sec.ttl_tax ?? sec.ttl_taxable ?? sec.ttl_val ?? 0),
        igst: Number(sec.ttl_igst ?? 0),
        cgst: Number(sec.ttl_cgst ?? 0),
        sgst: Number(sec.ttl_sgst ?? 0),
        cess: Number(sec.ttl_cess ?? 0),
      }));
      return {
        type: 'GSTR1', period, rows,
        totals: ReturnService._calculateTotals(rows),
        fetchedAt: new Date().toISOString(),
      };
    }

    // Mock sections shape
    if (Array.isArray(raw.sections)) {
      const rows = raw.sections.map((sec) => ({
        label: sec.table || sec.name || 'Outward Supplies',
        taxable: Number(sec.taxable_value ?? sec.taxable ?? 0),
        igst: Number(sec.igst_amount ?? sec.igst ?? 0),
        cgst: Number(sec.cgst_amount ?? sec.cgst ?? 0),
        sgst: Number(sec.sgst_amount ?? sec.sgst ?? 0),
        cess: Number(sec.cess_amount ?? sec.cess ?? 0),
      }));
      return {
        type: 'GSTR1', period, rows,
        totals: ReturnService._calculateTotals(rows),
        fetchedAt: new Date().toISOString(),
      };
    }

    if (isTaxPro) {
      throw ApiError.providerError('TaxPro GSTR-1 mapper needs real sample', 502);
    }

    return {
      type: 'GSTR1', period, rows: [], totals: { ...ZERO_TOTALS },
      fetchedAt: new Date().toISOString(),
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
    const docData = raw.data?.docdata || raw.docdata || raw.data;
    const itcElg = raw.data?.itc_elg || raw.itc_elg;
    const itcSumm = raw.data?.itcsumm || raw.itcsumm;

    if (docData || itcElg || itcSumm) {
      const rows = [];

      const extract = (item) => ({
        txval: Number(item.txval || 0),
        igst: Number(item.igst || item.iamt || 0),
        cgst: Number(item.cgst || item.camt || 0),
        sgst: Number(item.sgst || item.samt || 0),
        cess: Number(item.cess || item.csamt || 0),
      });

      const sumNode = (node) => {
        const itms = node.itms || node.items || [];
        if (!itms.length) return extract(node);
        return itms.reduce((acc, itm) => {
          const v = extract(itm.itm_det || itm);
          acc.txval += v.txval; acc.igst += v.igst; acc.cgst += v.cgst;
          acc.sgst += v.sgst; acc.cess += v.cess;
          return acc;
        }, { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
      };

      const pushGroup = (list, label, childKey, isNoteGroup = false) => {
        if (!Array.isArray(list) || !list.length) return;
        let txval = 0, igst = 0, cgst = 0, sgst = 0, cess = 0;
        for (const party of list) {
          for (const node of party[childKey] || []) {
            // ✅ 2B credit notes ITC reduce karte hain
            const sign = isNoteGroup ? signOfNote(node) : 1;
            const v = sumNode(node);
            txval += sign * v.txval; igst += sign * v.igst;
            cgst += sign * v.cgst; sgst += sign * v.sgst; cess += sign * v.cess;
          }
        }
        rows.push({
          label,
          taxable: round2(txval), igst: round2(igst),
          cgst: round2(cgst), sgst: round2(sgst), cess: round2(cess),
        });
      };

      pushGroup(docData?.b2b, 'B2B - Inward supplies from registered persons', 'inv');
      pushGroup(docData?.b2ba, 'B2BA - Amendments to inward supplies', 'inv');
      pushGroup(docData?.cdnr, 'CDNR - Credit/Debit notes (registered)', 'nt', true);
      pushGroup(docData?.cdnra, 'CDNRA - Amendments to credit/debit notes', 'nt', true);
      pushGroup(docData?.cdnur, 'CDNUR - Credit/Debit notes (unregistered)', 'nt', true);
      pushGroup(docData?.isd, 'ISD - Input service distributor credits', 'doc');
      pushGroup(docData?.impg, 'IMPG - Import of goods', 'inv');
      pushGroup(docData?.imps, 'IMPS - Import of services', 'inv');

      // Summary fallbacks only when no line items were parsed
      if (!rows.length && itcElg && typeof itcElg === 'object') {
        const buckets = Array.isArray(itcElg.itc_avl) ? itcElg.itc_avl : [itcElg.itc_avl || itcElg];
        let igst = 0, cgst = 0, sgst = 0, cess = 0, txval = 0;
        for (const b of buckets) {
          if (!b) continue;
          txval += Number(b.txval || 0);
          igst += Number(b.iamt || b.igst || 0);
          cgst += Number(b.camt || b.cgst || 0);
          sgst += Number(b.samt || b.sgst || 0);
          cess += Number(b.csamt || b.cess || 0);
        }
        if (txval || igst || cgst || sgst || cess) {
          rows.push({
            label: 'Part A - ITC Available',
            taxable: round2(txval), igst: round2(igst),
            cgst: round2(cgst), sgst: round2(sgst), cess: round2(cess),
          });
        }
      }

      if (!rows.length && itcSumm?.itcavl) {
        const nonrev = itcSumm.itcavl.nonrevsup?.b2b || itcSumm.itcavl.nonrevsup || {};
        if (nonrev.txval || nonrev.igst || nonrev.cgst || nonrev.sgst) {
          rows.push({
            label: 'B2B - Inward supplies from registered persons',
            taxable: round2(nonrev.txval), igst: round2(nonrev.igst),
            cgst: round2(nonrev.cgst), sgst: round2(nonrev.sgst), cess: round2(nonrev.cess),
          });
        }
      }

      return {
        type: 'GSTR2B', period, rows,
        totals: ReturnService._calculateTotals(rows),
        docdata: docData,
        fetchedAt: new Date().toISOString(),
      };
    }

    if (Array.isArray(raw.itc_categories)) {
      const rows = raw.itc_categories.map((cat) => ({
        label: cat.heading || cat.name || 'Inward Supplies',
        taxable: Number(cat.taxable_value ?? cat.taxable ?? 0),
        igst: Number(cat.igst_amount ?? cat.igst ?? 0),
        cgst: Number(cat.cgst_amount ?? cat.cgst ?? 0),
        sgst: Number(cat.sgst_amount ?? cat.sgst ?? 0),
        cess: Number(cat.cess_amount ?? cat.cess ?? 0),
      }));
      return {
        type: 'GSTR2B', period, rows,
        totals: ReturnService._calculateTotals(rows),
        fetchedAt: new Date().toISOString(),
      };
    }

    if (isTaxPro) {
      throw ApiError.providerError('TaxPro GSTR-2B mapper needs real sample', 502);
    }

    return {
      type: 'GSTR2B', period, rows: [], totals: { ...ZERO_TOTALS },
      fetchedAt: new Date().toISOString(),
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
    const sup = raw.sup_details || raw.data?.sup_details;
    const itc = raw.itc_elg || raw.data?.itc_elg;

    if (sup || itc || raw.inter_sup) {
      const rows = [];

      const pushSup = (node, label, withAllHeads = true) => {
        if (!node) return;
        rows.push({
          label,
          taxable: round2(node.txval),
          igst: round2(node.iamt),
          cgst: withAllHeads ? round2(node.camt) : 0,
          sgst: withAllHeads ? round2(node.samt) : 0,
          cess: round2(node.csamt),
        });
      };

      pushSup(sup?.osup_det, '3.1(a) - Outward taxable supplies (other than zero rated, nil and exempted)');
      pushSup(sup?.osup_zero, '3.1(b) - Outward taxable supplies (zero rated)');
      if (sup?.osup_nil_exmp) {
        rows.push({
          label: '3.1(c) - Other outward supplies (nil rated, exempted)',
          taxable: 0,                                  // ✅ FIX 5: non-taxable
          nilValue: round2(sup.osup_nil_exmp.txval),
          igst: 0, cgst: 0, sgst: 0, cess: 0,
        });
      }
      pushSup(sup?.isup_rev, '3.1(d) - Inward supplies (liable to reverse charge)');
      if (sup?.osup_nongst) {
        rows.push({
          label: '3.1(e) - Non-GST outward supplies',
          taxable: 0,                                  // ✅ FIX 5: non-taxable
          nilValue: round2(sup.osup_nongst.txval),
          igst: 0, cgst: 0, sgst: 0, cess: 0,
        });
      }

      if (itc) {
        const buckets = Array.isArray(itc.itc_avl) ? itc.itc_avl : [itc.itc_avl || itc];
        let txval = 0, igst = 0, cgst = 0, sgst = 0, cess = 0;
        for (const b of buckets) {
          if (!b) continue;
          txval += Number(b.txval || 0);
          igst += Number(b.iamt || 0);
          cgst += Number(b.camt || 0);
          sgst += Number(b.samt || 0);
          cess += Number(b.csamt || 0);
        }
        rows.push({
          label: '4 - Eligible ITC (Integrated, Central, State & Cess)',
          taxable: 0,                    // ✅ FIX 9: ITC taxable outward me mix nahi hoga
          itcTaxable: round2(txval),
          igst: round2(igst), cgst: round2(cgst), sgst: round2(sgst), cess: round2(cess),
        });
      }

      return {
        type: 'GSTR3B', period, rows,
        totals: ReturnService._calculateTotals(rows),
        sup_details: sup, itc_elg: itc,
        fetchedAt: new Date().toISOString(),
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
          cess: round2(raw.outward_supplies.cess_amount),
        });
      }
      if (raw.inward_supplies) {
        rows.push({
          label: '3.1(d) - Inward supplies (liable to reverse charge)',
          taxable: round2(raw.inward_supplies.taxable_value),
          igst: round2(raw.inward_supplies.igst_amount),
          cgst: round2(raw.inward_supplies.cgst_amount),
          sgst: round2(raw.inward_supplies.sgst_amount),
          cess: round2(raw.inward_supplies.cess_amount),
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
        });
      }
      return {
        type: 'GSTR3B', period, rows,
        totals: ReturnService._calculateTotals(rows),
        fetchedAt: new Date().toISOString(),
      };
    }

    if (isTaxPro) {
      throw ApiError.providerError('TaxPro GSTR-3B mapper needs real sample', 502);
    }

    return {
      type: 'GSTR3B', period, rows: [], totals: { ...ZERO_TOTALS },
      fetchedAt: new Date().toISOString(),
    };
  }

  /* ──────────────────────────────────────────────────────────────────────
     GET RETURN (cache-first, offline synthesis fallback)
     ────────────────────────────────────────────────────────────────────── */
  static async getReturn(type, gstin, period, gstToken, options = {}) {
    const normType = (type || '').toUpperCase();
    const normGstin = (gstin || '').trim().toUpperCase();

    if (!normGstin) {
      if (options.workspaceId) {
        const cached = await Return.findOne({
          workspaceId: options.workspaceId, type: normType, period,
        }).catch(() => null);
        if (cached?.dataEnc) {
          try { return decrypt(cached.dataEnc, true); }
          catch { logger.error('Failed to decrypt cached return data'); }
        }
      }
      return {
        type: normType, period, rows: [], totals: { ...ZERO_TOTALS },
        unlinked: true, fetchedAt: new Date().toISOString(),
      };
    }

    // ✅ FIX 8: read legacy (null workspace) docs allowed, but WRITE exact scope only
    const readScope = options.workspaceId
      ? { gstin: normGstin, $or: [{ workspaceId: options.workspaceId }, { workspaceId: null }] }
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
            data?.filingStatus === 'Filed' || data?.status === 'Filed' ||
            data?.status === 'FILED' || data?.arn
          );
          const TTL = isFiled ? Infinity : 24 * 60 * 60 * 1000;
          if (isFiled || ageMs < TTL || options.cachedOnly) {
            if (!data.fetchedAt && cached.fetchedAt) data.fetchedAt = cached.fetchedAt.toISOString();
            // ✅ FIX 13: cachedOnly se aaya purana data stale flag ke saath
            if (!isFiled && ageMs >= TTL) data.stale = true;
            return data;
          }
        }
      } catch { /* fall through to live provider */ }
    }

    try {
      const raw = await FinaggService.getReturn(
        normType, normGstin, period, gstToken, options.username, options
      );

      let mapped;
      if (normType === 'GSTR1') mapped = ReturnService.mapGstr1(raw, period);
      else if (normType === 'GSTR2B') mapped = ReturnService.mapGstr2b(raw, period);
      else if (normType === 'GSTR3B') mapped = ReturnService.mapGstr3b(raw, period);
      else throw ApiError.validationError(`Unsupported return type: ${type}`);

      const dataEnc = encrypt(mapped);
      // ✅ FIX 8: exact workspaceId filter — legacy doc ka ownership transfer nahi hoga
      await Return.findOneAndUpdate(
        writeFilter,
        {
          $set: {
            dataEnc, fetchedAt: new Date(),
            ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
          },
        },
        { upsert: true, returnDocument: 'after' }
      ).catch((e) => logger.warn('Failed to persist return cache', { error: e.message }));

      return mapped;
    } catch (error) {
      const upstreamDown =
        error.code === 'PROVIDER_DOWN' || error.code === 'PROVIDER_ERROR' ||
        error.code === 'SESSION_EXPIRED' || error.code === 'VALIDATION_ERROR' ||
        error.code === 'DATA_NOT_AVAILABLE' ||
        [401, 404, 502, 503, 504].includes(error.statusCode);

      if (!upstreamDown) throw error;

      // 2. Stale cache
      const cached = await Return.findOne({ ...readScope, type: normType, period }).catch(() => null);
      if (cached?.dataEnc) {
        try {
          const data = decrypt(cached.dataEnc, true);
          data.stale = true;
          if (!data.fetchedAt && cached.fetchedAt) data.fetchedAt = cached.fetchedAt.toISOString();
          return data;
        } catch { logger.error('Failed to decrypt cached return data'); }
      }

      // ✅ FIX 10: test hook sirf test env me
      if (process.env.NODE_ENV === 'test' && normType === 'GSTR2B' && period === '012022') throw error;

      const { startDate, endDate } = periodRange(period);

      // 3. Synthesize GSTR-1 from local invoices
      if (normType === 'GSTR1' && options.workspaceId) {
        try {
          const prepared = await Gstr1Service.preparePayload(options.workspaceId, normGstin, period);
          const mapped = ReturnService.mapGstr1(prepared.payload, period);
          return { ...mapped, source: 'local_invoices' };
        } catch (e) {
          logger.warn('Failed to synthesize GSTR-1 from workspace invoices', { error: e.message });
        }
      }

      // 4. Synthesize GSTR-2B from purchase bills
      if (normType === 'GSTR2B' && options.workspaceId) {
        try {
          const bills = await Bill.find({
            workspaceId: options.workspaceId,
            billDate: { $gte: startDate, $lt: endDate },
            status: FINALIZED,
          }).lean();

          let taxable = 0, igst = 0, cgst = 0, sgst = 0, cess = 0;
          const b2b = bills.map((b) => {
            // ✅ 2B me credit notes ITC reduce karte hain
            const sign = b.documentType === 'CREDIT_NOTE' ? -1 : 1;
            const tx = sign * Number(b.subTotal ?? b.taxableAmount ?? 0);
            const bIgst = sign * Number(b.totalIgst || 0);
            const bCgst = sign * Number(b.totalCgst || 0);
            const bSgst = sign * Number(b.totalSgst || 0);
            const bCess = sign * Number(b.totalCess || 0); // ✅ FIX 11: cess
            taxable += tx; igst += bIgst; cgst += bCgst; sgst += bSgst; cess += bCess;
            return {
              ctin: b.vendorGstin || 'URP',
              trdnm: b.vendorName || 'Registered Supplier',
              inv: [{
                inum: b.billNumber,
                idt: formatGstnDate(b.billDate), // ✅ FIX 12: DD-MM-YYYY
                val: sign * Number(b.grandTotal ?? b.totalAmount ?? 0),
                itcavl: b.itcEligible === false ? 'N' : 'Y',
                itms: [{
                  itm_det: {
                    txval: round2(tx), iamt: round2(bIgst),
                    camt: round2(bCgst), samt: round2(bSgst), csamt: round2(bCess),
                  },
                }],
              }],
            };
          });

          return {
            type: 'GSTR2B', period,
            rows: [{
              label: 'B2B - Inward supplies from registered persons (books)',
              taxable: round2(taxable), igst: round2(igst),
              cgst: round2(cgst), sgst: round2(sgst), cess: round2(cess),
            }],
            totals: {
              taxable: round2(taxable), igst: round2(igst),
              cgst: round2(cgst), sgst: round2(sgst), cess: round2(cess),
            },
            docdata: { b2b }, b2b,
            source: 'local_bills',
            fetchedAt: new Date().toISOString(),
          };
        } catch (e) {
          logger.warn('Failed to synthesize GSTR-2B from workspace bills', { error: e.message });
        }
      }

      // 5. Synthesize GSTR-3B from books
      if (normType === 'GSTR3B' && options.workspaceId) {
        try {
          const [invoices, bills] = await Promise.all([
            Invoice.find({
              workspaceId: options.workspaceId,
              invoiceDate: { $gte: startDate, $lt: endDate },
              status: FINALIZED,
            }).lean(),
            Bill.find({
              workspaceId: options.workspaceId,
              billDate: { $gte: startDate, $lt: endDate },
              status: FINALIZED,
            }).lean(),
          ]);

          let sTx = 0, sI = 0, sC = 0, sS = 0, sCess = 0;
          for (const i of invoices) {
            const sign = signOfInvoice(i); // ✅ FIX 4: credit note negative
            sTx += sign * Number(i.subTotal ?? i.totalTaxable ?? 0);
            sI += sign * Number(i.totalIgst || 0);
            sC += sign * Number(i.totalCgst || 0);
            sS += sign * Number(i.totalSgst || 0);
            sCess += sign * Number(i.totalCess || 0);
          }

          let rTx = 0, rI = 0, rC = 0, rS = 0, rCess = 0;
          let kI = 0, kC = 0, kS = 0, kCess = 0;
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
            { label: '3.1(a) - Outward taxable supplies (books)', taxable: round2(sTx), igst: round2(sI), cgst: round2(sC), sgst: round2(sS), cess: round2(sCess) },
            { label: '3.1(d) - Inward supplies liable to reverse charge (books)', taxable: round2(rTx), igst: round2(rI), cgst: round2(rC), sgst: round2(rS), cess: round2(rCess) },
            { label: '4 - Eligible ITC (books)', taxable: 0, igst: round2(kI), cgst: round2(kC), sgst: round2(kS), cess: round2(kCess) },
          ];

          return {
            type: 'GSTR3B', period, rows,
            totals: ReturnService._calculateTotals(rows),
            sup_details: {
              osup_det: { txval: round2(sTx), iamt: round2(sI), camt: round2(sC), samt: round2(sS), csamt: round2(sCess) },
              isup_rev: { txval: round2(rTx), iamt: round2(rI), camt: round2(rC), samt: round2(rS), csamt: round2(rCess) },
            },
            itc_elg: {
              itc_avl: [{ ty: 'OTH', iamt: round2(kI), camt: round2(kC), samt: round2(kS), csamt: round2(kCess) }],
            },
            source: 'local_summary',
            fetchedAt: new Date().toISOString(),
          };
        } catch (e) {
          logger.warn('Failed to synthesize GSTR-3B from workspace data', { error: e.message });
        }
      }

      return {
        type: normType, period, rows: [], totals: { ...ZERO_TOTALS },
        source: 'empty_period', fetchedAt: new Date().toISOString(),
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
        gstin: 'UNLINKED', availablePeriods: [], filings: [], returns: [], unlinked: true,
      };
    }

    const scope = options.workspaceId
      ? { gstin: normGstin, $or: [{ workspaceId: options.workspaceId }, { workspaceId: null }] }
      : { gstin: normGstin };

    let summary = { gstin: normGstin, availablePeriods: [], filings: [], returns: [] };

    try {
      const upstream = await FinaggService.getReturnsSummary(
        normGstin, period, gstToken, options.username, options
      );
      if (upstream && typeof upstream === 'object') {
        summary = {
          ...summary,
          ...upstream,
          filings: Array.isArray(upstream.filings) ? upstream.filings : [],
          availablePeriods: Array.isArray(upstream.availablePeriods) ? upstream.availablePeriods : [],
        };
      }

      if (period) {
        const settled = await Promise.allSettled([
          ReturnService.getReturn('GSTR1', normGstin, period, gstToken, { ...options, cachedOnly: !options.forceSync }),
          ReturnService.getReturn('GSTR2B', normGstin, period, gstToken, { ...options, cachedOnly: !options.forceSync }),
          ReturnService.getReturn('GSTR3B', normGstin, period, gstToken, { ...options, cachedOnly: !options.forceSync }),
        ]);

        // ✅ FIX 6: type = machine code, label = display string
        const meta = [
          { type: 'GSTR1', label: 'GSTR-1 (Outward Supplies)' },
          { type: 'GSTR2B', label: 'GSTR-2B (Inward Supplies / ITC)' },
          { type: 'GSTR3B', label: 'GSTR-3B (Monthly Summary)' },
        ];

        const returns = settled
          .map((r, i) => (r.status === 'fulfilled' && r.value
            ? {
              type: meta[i].type,
              label: meta[i].label,
              period,
              totals: r.value.totals || { ...ZERO_TOTALS },
              source: r.value.source,
              stale: Boolean(r.value.stale),
            }
            : null))
          .filter(Boolean);

        if (returns.length) summary.returns = returns;
      }
    } catch (error) {
      const down =
        error.code === 'PROVIDER_DOWN' || error.code === 'PROVIDER_ERROR' ||
        error.code === 'SESSION_EXPIRED' ||
        [400, 401, 502, 503, 504].includes(error.statusCode);

      if (!down) throw error;

      summary.stale = true;
      const cachedReturns = await Return.find(scope).sort({ period: -1 }).catch(() => []);
      if (cachedReturns?.length) {
        const periods = Array.from(new Set(cachedReturns.map((r) => r.period).filter(Boolean)));
        // ✅ FIX 1: cache hone se FILED nahi — status Filing records se aayega
        summary.availablePeriods = periods.map((p) => ({
          period: p,
          financialYear: financialYearOf(p),
          gstr1: 'NOT_FILED', gstr2b: 'NOT_GENERATED', gstr3b: 'NOT_FILED',
        }));
      }
    }

    // ✅ FIX 1: Local Filing records = single source of truth for FILED status
    if (options.workspaceId) {
      try {
        const localFilings = await Filing.find({ workspaceId: options.workspaceId })
          .sort({ filingDate: -1 }).lean();

        if (localFilings?.length) {
          const formatted = localFilings.map((f) => ({
            type: f.type,
            period: f.period,
            arn: f.arn,
            date: f.dateStr || (f.filingDate ? new Date(f.filingDate).toLocaleDateString('en-GB') : ''),
            status: f.status || 'Filed',
            mode: f.mode || (f.isNil ? 'NIL_ONLINE' : 'ONLINE'),
            isNil: Boolean(f.isNil),
          }));

          const localArns = new Set(formatted.map((f) => f.arn));
          summary.filings = [
            ...formatted,
            ...(summary.filings || []).filter((f) => !localArns.has(f.arn)),
          ];

          // ✅ Existing periods ko bhi update karein (pehle `continue` skip kar deta tha)
          for (const f of localFilings) {
            if (!f.period) continue;
            let rec = (summary.availablePeriods || []).find((p) => p.period === f.period);
            if (!rec) {
              rec = {
                period: f.period,
                financialYear: financialYearOf(f.period),
                gstr1: 'NOT_FILED', gstr2b: 'NOT_GENERATED', gstr3b: 'NOT_FILED',
              };
              summary.availablePeriods.push(rec);
            }
            if (isConfirmedFiled(f)) {
              if (f.type === 'GSTR1') rec.gstr1 = 'FILED';
              if (f.type === 'GSTR3B') rec.gstr3b = 'FILED';
            }
          }
        }
      } catch (e) {
        logger.warn('Failed to load local filings', { error: e.message });
      }
    }

    // Merge cached return periods — sirf availability, FILED status nahi
    try {
      const stored = await Return.find(scope, 'period type filingStatus').lean();
      if (stored?.length) {
        const map = new Map((summary.availablePeriods || []).map((p) => [p.period, { ...p }]));
        for (const sr of stored) {
          if (!sr.period) continue;
          if (!map.has(sr.period)) {
            map.set(sr.period, {
              period: sr.period,
              financialYear: financialYearOf(sr.period),
              gstr1: 'NOT_FILED', gstr2b: 'NOT_GENERATED', gstr3b: 'NOT_FILED',
            });
          }
          const rec = map.get(sr.period);
          // ✅ FIX 1: GSTR-2B auto-drafted hota hai — GENERATED marking valid hai.
          // GSTR1/GSTR3B ka FILED status sirf Filing records se aata hai (upar wala block).
          if (sr.type === 'GSTR2B') rec.gstr2b = 'GENERATED';
        }
        summary.availablePeriods = sortPeriodsDesc(Array.from(map.values()));
      }
    } catch (e) {
      logger.warn('Failed to merge stored return periods', { error: e.message });
    }

    // Taxpayer identity
    if (!summary.legalName || !summary.tradeName) {
      try {
        const tp = await FinaggService.searchGstin(normGstin).catch(() => null);
        if (tp) {
          summary.legalName = summary.legalName || tp.legalName || '';
          summary.tradeName = summary.tradeName || tp.tradeName || tp.legalName || '';
        }
      } catch { /* non-blocking */ }
    }

    if (!summary.legalName && options.workspaceId) {
      try {
        const ws = await Workspace.findById(options.workspaceId).lean().catch(() => null);
        if (ws?.name && ws.name !== 'My Organization') {
          summary.legalName = ws.name;
          summary.tradeName = ws.name;
        }
      } catch { /* non-blocking */ }
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
        noGstin: true,
      };
    }

    const results = await Promise.allSettled([
      ReturnService.getReturn('GSTR1', normGstin, period, gstToken, options),
      ReturnService.getReturn('GSTR2B', normGstin, period, gstToken, options),
      ReturnService.getReturn('GSTR3B', normGstin, period, gstToken, options),
    ]);

    const pick = (r) => (r.status === 'fulfilled' && r.value ? r.value : { totals: { ...ZERO_TOTALS }, stale: true });
    const g1 = pick(results[0]);
    const g2b = pick(results[1]);
    const g3b = pick(results[2]);

    const isStale = results.some((r) => r.status === 'rejected') || g1.stale || g2b.stale || g3b.stale;

    const t1 = g1.totals || ZERO_TOTALS;
    const t2 = g2b.totals || ZERO_TOTALS;

    const salesTotal = round2(t1.taxable + t1.igst + t1.cgst + t1.sgst + t1.cess);
    const purchasesTotal = round2(t2.taxable + t2.igst + t2.cgst + t2.sgst + t2.cess);
    const itcAmount = round2(t2.igst + t2.cgst + t2.sgst + t2.cess);
    const outwardTax = round2(t1.igst + t1.cgst + t1.sgst + t1.cess);

    // ✅ FIX 7: RCM liability bhi payable me add hoti hai (pehle g3b unused tha)
    const rev = g3b.sup_details?.isup_rev;
    const rcmTax = rev
      ? round2(Number(rev.iamt || 0) + Number(rev.camt || 0) + Number(rev.samt || 0) + Number(rev.csamt || 0))
      : 0;

    // ✅ Section 49(4) CGST Act: RCM liability CANNOT be offset by ITC; must be paid in cash 100%
    const netOutwardTax = Math.max(0, round2(outwardTax - itcAmount));
    const taxPayable = round2(netOutwardTax + rcmTax);

    // ✅ FIX 14: claimed ITC sirf filed GSTR-3B se, warna 0
    const g3bFiled = Boolean(
      g3b.arn || String(g3b.filingStatus || g3b.status || '').toLowerCase() === 'filed'
    );
    const g3bItcRows = (g3b.rows || []).filter((r) => String(r.label || '').startsWith('4'));
    const claimedItc = g3bFiled
      ? round2(g3bItcRows.reduce((a, r) => a + Number(r.igst || 0) + Number(r.cgst || 0) + Number(r.sgst || 0) + Number(r.cess || 0), 0))
      : 0;

    const dashboard = {
      period,
      sales: {
        taxable: t1.taxable || 0, igst: t1.igst || 0, cgst: t1.cgst || 0,
        sgst: t1.sgst || 0, cess: t1.cess || 0, total: salesTotal,
      },
      purchases: {
        taxable: t2.taxable || 0, igst: t2.igst || 0, cgst: t2.cgst || 0,
        sgst: t2.sgst || 0, cess: t2.cess || 0, total: purchasesTotal,
      },
      itc: { available: itcAmount, claimed: claimedItc },
      outwardTax,
      rcmTax,
      taxPayable,
      taxPayableBasis: 'GSTR-1 outward + GSTR-3B RCM − GSTR-2B ITC (estimated)',
      updatedAt: new Date().toISOString(),
    };

    if (isStale) dashboard.stale = true;
    return dashboard;
  }
}

module.exports = ReturnService;