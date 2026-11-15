const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { isValidGstin, isValidPeriod } = require('../utils/gstin');
const FinaggService = require('./finagg.service');
const { isLiveFilingEnabled } = require('../utils/filingMode');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

// IST-aware month boundaries (GST_TZ_OFFSET_MIN=330 for India, UTC+05:30)
const TZ_OFFSET_MIN = Number(process.env.GST_TZ_OFFSET_MIN || 330);
const TZ_OFFSET_MS = TZ_OFFSET_MIN * 60 * 1000;

function periodRangeIST(period) {
  const month = parseInt(period.slice(0, 2), 10);
  const year = parseInt(period.slice(2), 10);
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - TZ_OFFSET_MS),
    endDate: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - TZ_OFFSET_MS - 1),
  };
}

// Credit notes reduce outward tax liability
const signOfInvoice = (inv) => (inv.documentType === 'CREDIT_NOTE' ? -1 : 1);
const signOfBill = (b) => (b.documentType === 'DEBIT_NOTE' || b.billType === 'CREDIT_NOTE' || b.documentType === 'CREDIT_NOTE' ? -1 : 1);

const isFinalized = (doc) => {
  const status = (doc?.status || '').toLowerCase();
  return status !== 'cancelled' && status !== 'draft';
};

const fmt = (val) => {
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

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

    // 1. Fetch Outward Sales Invoices
    const invoices = await Invoice.find({
      workspaceId,
      invoiceDate: { $gte: startDate, $lte: endDate }
    }).lean();

    const activeInvoices = invoices.filter(isFinalized);

    // Table 3.1 Outward Buckets
    let sup31a_txval = 0, sup31a_iamt = 0, sup31a_camt = 0, sup31a_samt = 0, sup31a_csamt = 0; // Taxable Outward
    let sup31b_txval = 0, sup31b_iamt = 0, sup31b_csamt = 0; // Zero-rated (Exports/SEZ)
    let sup31c_txval = 0; // Nil/Exempt
    let sup31e_txval = 0; // Non-GST

    // Table 3.2: Inter-State supplies to unregistered persons
    const interStateB2C = new Map(); // pos -> { txval, iamt, csamt }
    const supplierState = normGstin.slice(0, 2);
    const exportTypes = ['WPAY', 'WOPAY', 'EXPORT'];

    activeInvoices.forEach((inv) => {
      const sign = signOfInvoice(inv);
      const isExport = inv.isExport === true || exportTypes.includes(String(inv.exportType || '').toUpperCase());

      if (isExport) {
        // Zero-rated supplies (Exports / SEZ)
        const txval = sign * Number(inv.subTotal ?? inv.totalTaxable ?? 0);
        const iamt = sign * Number(inv.totalIgst || 0);
        const csamt = sign * Number(inv.totalCess || 0);
        sup31b_txval += txval;
        sup31b_iamt += iamt;
        sup31b_csamt += csamt;
      } else if (Array.isArray(inv.lineItems) && inv.lineItems.length > 0) {
        // Line-item level bifurcation (prevents misclassifying mixed invoices)
        let invoiceTaxableTxval = 0;
        let invoiceTaxableIamt = 0;
        let invoiceTaxableCsamt = 0;

        inv.lineItems.forEach((item) => {
          const pref = String(item.taxPreference || '').toUpperCase();
          const itemTxval = sign * Number(item.taxableAmount ?? item.amount ?? 0);

          if (pref === 'EXEMPT' || pref === 'NIL') {
            sup31c_txval += itemTxval;
          } else if (pref === 'NON_GST') {
            sup31e_txval += itemTxval;
          } else {
            // Standard Taxable item
            const itemIamt = sign * Number(item.igstAmount || 0);
            const itemCamt = sign * Number(item.cgstAmount || 0);
            const itemSamt = sign * Number(item.sgstAmount || 0);
            const itemCsamt = sign * Number(item.cessAmount || 0);

            sup31a_txval += itemTxval;
            sup31a_iamt += itemIamt;
            sup31a_camt += itemCamt;
            sup31a_samt += itemSamt;
            sup31a_csamt += itemCsamt;

            invoiceTaxableTxval += itemTxval;
            invoiceTaxableIamt += itemIamt;
            invoiceTaxableCsamt += itemCsamt;
          }
        });

        // Table 3.2: Unregistered Inter-state taxable supplies
        const pos = inv.pos ? String(inv.pos).padStart(2, '0') : null;
        // B2C classification: customer without registered GSTIN
        const isB2C = !inv.customerGstin || inv.customerGstin.trim() === '';
        if (isB2C && pos && pos !== supplierState && (invoiceTaxableTxval !== 0 || invoiceTaxableIamt !== 0)) {
          const existing = interStateB2C.get(pos) || { txval: 0, iamt: 0, csamt: 0 };
          existing.txval += invoiceTaxableTxval;
          existing.iamt += invoiceTaxableIamt;
          existing.csamt += invoiceTaxableCsamt;
          interStateB2C.set(pos, existing);
        }
      } else {
        // Standard invoice without line-items
        const txval = sign * Number(inv.subTotal ?? inv.totalTaxable ?? 0);
        const iamt = sign * Number(inv.totalIgst || 0);
        const camt = sign * Number(inv.totalCgst || 0);
        const samt = sign * Number(inv.totalSgst || 0);
        const csamt = sign * Number(inv.totalCess || 0);

        sup31a_txval += txval;
        sup31a_iamt += iamt;
        sup31a_camt += camt;
        sup31a_samt += samt;
        sup31a_csamt += csamt;

        // Table 3.2: Unregistered Inter-state taxable supplies
        const pos = inv.pos ? String(inv.pos).padStart(2, '0') : null;
        // B2C classification: customer without registered GSTIN
        const isB2C = !inv.customerGstin || inv.customerGstin.trim() === '';
        if (isB2C && pos && pos !== supplierState && (txval !== 0 || iamt !== 0)) {
          const existing = interStateB2C.get(pos) || { txval: 0, iamt: 0, csamt: 0 };
          existing.txval += txval;
          existing.iamt += iamt;
          existing.csamt += csamt;
          interStateB2C.set(pos, existing);
        }
      }
    });

    // 2. Fetch Inward Purchase Bills (Eligible ITC & RCM)
    const bills = await Bill.find({
      workspaceId,
      billDate: { $gte: startDate, $lte: endDate }
    }).lean();

    const activeBills = bills.filter(isFinalized);

    let itc_isrc_iamt = 0, itc_isrc_camt = 0, itc_isrc_samt = 0, itc_isrc_csamt = 0; // ITC on Reverse Charge
    let itc_oth_iamt = 0, itc_oth_camt = 0, itc_oth_samt = 0, itc_oth_csamt = 0; // All other eligible ITC
    let sup31d_txval = 0, sup31d_iamt = 0, sup31d_camt = 0, sup31d_samt = 0, sup31d_csamt = 0; // Table 3.1(d) RCM Liability

    activeBills.forEach((b) => {
      const bSign = signOfBill(b);
      const txval = bSign * Number(b.subTotal ?? b.taxableAmount ?? 0);
      const iamt = bSign * Number(b.totalIgst || 0);
      const camt = bSign * Number(b.totalCgst || 0);
      const samt = bSign * Number(b.totalSgst || 0);
      const csamt = bSign * Number(b.totalCess || 0);

      if (b.isReverseCharge) {
        sup31d_txval += txval;
        sup31d_iamt += iamt;
        sup31d_camt += camt;
        sup31d_samt += samt;
        sup31d_csamt += csamt;

        // RCM ITC is claimed in ISRC bucket
        itc_isrc_iamt += iamt;
        itc_isrc_camt += camt;
        itc_isrc_samt += samt;
        itc_isrc_csamt += csamt;
      } else if (b.itcEligible !== false) {
        itc_oth_iamt += iamt;
        itc_oth_camt += camt;
        itc_oth_samt += samt;
        itc_oth_csamt += csamt;
      }
    });

    // Outward Liability (Table 3.1a + Table 3.1b) — can be offset by ITC
    const outwardLiabIgst = Math.max(0, sup31a_iamt + sup31b_iamt);
    const outwardLiabCgst = Math.max(0, sup31a_camt);
    const outwardLiabSgst = Math.max(0, sup31a_samt);
    const outwardLiabCess = Math.max(0, sup31a_csamt + sup31b_csamt);

    // RCM Liability (Table 3.1d) — strictly 100% Cash under Section 49(4)
    const rcmLiabIgst = Math.max(0, sup31d_iamt);
    const rcmLiabCgst = Math.max(0, sup31d_camt);
    const rcmLiabSgst = Math.max(0, sup31d_samt);
    const rcmLiabCess = Math.max(0, sup31d_csamt);

    // Total Eligible ITC Available
    const totalItcIgst = Math.max(0, itc_isrc_iamt + itc_oth_iamt);
    const totalItcCgst = Math.max(0, itc_isrc_camt + itc_oth_camt);
    const totalItcSgst = Math.max(0, itc_isrc_samt + itc_oth_samt);
    const totalItcCess = Math.max(0, itc_isrc_csamt + itc_oth_csamt);

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
    // Per Rule 88A proviso / GST portal auto-offset rules:
    // "The amount of CGST and SGST ITC utilised for payment of IGST shall be equal (to the extent possible)."
    let cgstForIgst = 0;
    let sgstForIgst = 0;

    if (balLiabIgst > 0) {
      // 6a. Equal utilization: each contributes at most half of the remaining IGST liability,
      // capped by the minimum available balance of both credits.
      const halfLiab = round2(balLiabIgst / 2);
      const equalPortion = Math.min(remItcCgst, remItcSgst, halfLiab);

      if (equalPortion > 0) {
        cgstForIgst += equalPortion;
        sgstForIgst += equalPortion;
        balLiabIgst = round2(balLiabIgst - (equalPortion * 2));
        remItcCgst = round2(remItcCgst - equalPortion);
        remItcSgst = round2(remItcSgst - equalPortion);
      }

      // 6b. If IGST liability still remains, use remaining balance from whichever ITC is left
      // (ensuring zero unnecessary cash outflow for the taxpayer)
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

    const netCashOutwardIgst = Math.max(0, balLiabIgst);
    const netCashOutwardCgst = Math.max(0, balLiabCgst);
    const netCashOutwardSgst = Math.max(0, balLiabSgst);
    const netCashOutwardCess = Math.max(0, balLiabCess);

    const totalNetCashPayable = (
      netCashOutwardIgst + netCashOutwardCgst + netCashOutwardSgst + netCashOutwardCess +
      rcmLiabIgst + rcmLiabCgst + rcmLiabSgst + rcmLiabCess
    );

    const isNilReturn = totalNetCashPayable === 0 && activeInvoices.length === 0 && activeBills.length === 0;

    // 4. Official GSTN GSTR-3B JSON structure
    const payload = {
      gstin: normGstin,
      ret_period: period,
      filing_typ: isNilReturn ? 'NIL' : 'R',
      sup_details: {
        osup_det: { // Table 3.1(a) - Taxable Outward
          txval: fmt(sup31a_txval), iamt: fmt(sup31a_iamt),
          camt: fmt(sup31a_camt), samt: fmt(sup31a_samt), csamt: fmt(sup31a_csamt)
        },
        osup_zero: { // Table 3.1(b) - Zero-rated (Exports)
          txval: fmt(sup31b_txval), iamt: fmt(sup31b_iamt), csamt: fmt(sup31b_csamt)
        },
        osup_nil_exmp: { // Table 3.1(c) - Nil/Exempt
          txval: fmt(sup31c_txval)
        },
        isup_rev: { // Table 3.1(d) - Inward supplies liable to reverse charge
          txval: fmt(sup31d_txval), iamt: fmt(sup31d_iamt),
          camt: fmt(sup31d_camt), samt: fmt(sup31d_samt), csamt: fmt(sup31d_csamt)
        },
        osup_nongst: { // Table 3.1(e) - Non-GST
          txval: fmt(sup31e_txval)
        }
      },
      inter_sup: { // Table 3.2 - Inter-State supplies to unregistered persons
        unreg_details: Array.from(interStateB2C.entries()).map(([pos, data]) => ({
          pos,
          txval: fmt(data.txval),
          iamt: fmt(data.iamt),
          csamt: fmt(data.csamt)
        })),
        comp_details: [],
        uin_details: []
      },
      itc_elg: { // Table 4 - Eligible ITC
        itc_avl: [
          { ty: 'IMPG', iamt: 0, camt: 0, samt: 0, csamt: 0 },
          { ty: 'IMPS', iamt: 0, camt: 0, samt: 0, csamt: 0 },
          { ty: 'ISRC', iamt: fmt(itc_isrc_iamt), camt: fmt(itc_isrc_camt), samt: fmt(itc_isrc_samt), csamt: fmt(itc_isrc_csamt) },
          { ty: 'ISD', iamt: 0, camt: 0, samt: 0, csamt: 0 },
          { ty: 'OTH', iamt: fmt(itc_oth_iamt), camt: fmt(itc_oth_camt), samt: fmt(itc_oth_samt), csamt: fmt(itc_oth_csamt) }
        ],
        itc_rev: [
          { ty: 'RUL', iamt: 0, camt: 0, samt: 0, csamt: 0 },
          { ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 }
        ],
        itc_net: {
          iamt: fmt(totalItcIgst), camt: fmt(totalItcCgst), samt: fmt(totalItcSgst), csamt: fmt(totalItcCess)
        },
        itc_inelg: [
          { ty: 'RUL', iamt: 0, camt: 0, samt: 0, csamt: 0 },
          { ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 }
        ]
      },
      inward_sup: { isup_details: [] },
      intr_ltfee: { intr_details: { iamt: 0, camt: 0, samt: 0, csamt: 0 } }
    };

    // 5. Official GSTN GSTR-3B RETOFFSET structure
    const offsetPayload = {
      pdcash: [
        // Ledger 30002: Outward supply liability paid in cash (after ITC offset)
        {
          liab_ldg_id: 30002, trans_typ: 30002,
          ipd: fmt(netCashOutwardIgst), cpd: fmt(netCashOutwardCgst),
          spd: fmt(netCashOutwardSgst), cspd: fmt(netCashOutwardCess),
          i_intrpd: 0, c_intrpd: 0, s_intrpd: 0, cs_intrpd: 0, c_lfeepd: 0, s_lfeepd: 0
        },
        // Ledger 30003: Reverse charge liability paid 100% in cash (Section 49(4))
        {
          liab_ldg_id: 30003, trans_typ: 30003,
          ipd: fmt(rcmLiabIgst), cpd: fmt(rcmLiabCgst),
          spd: fmt(rcmLiabSgst), cspd: fmt(rcmLiabCess),
          i_intrpd: 0, c_intrpd: 0, s_intrpd: 0, cs_intrpd: 0, c_lfeepd: 0, s_lfeepd: 0
        }
      ],
      pditc: {
        liab_ldg_id: 30002, trans_typ: 30002,
        i_pdi: fmt(igstForIgst), i_pdc: fmt(cgstForIgst), i_pds: fmt(sgstForIgst),
        c_pdi: fmt(igstForCgst), c_pdc: fmt(cgstForCgst),
        s_pdi: fmt(igstForSgst), s_pds: fmt(sgstForSgst),
        cs_pdcs: fmt(cessForCess)
      },
      nettaxpay: [
        {
          trans_typ: 30002, trans_desc: 'Other than reverse charge', liab_ldg_id: 30002,
          igst: { tx: fmt(outwardLiabIgst), intr: 0, fee: 0 },
          cgst: { tx: fmt(outwardLiabCgst), intr: 0, fee: 0 },
          sgst: { tx: fmt(outwardLiabSgst), intr: 0, fee: 0 },
          cess: { tx: fmt(outwardLiabCess), intr: 0, fee: 0 }
        },
        {
          trans_typ: 30003, trans_desc: 'Reverse charge', liab_ldg_id: 30003,
          igst: { tx: fmt(rcmLiabIgst), intr: 0, fee: 0 },
          cgst: { tx: fmt(rcmLiabCgst), intr: 0, fee: 0 },
          sgst: { tx: fmt(rcmLiabSgst), intr: 0, fee: 0 },
          cess: { tx: fmt(rcmLiabCess), intr: 0, fee: 0 }
        }
      ]
    };

    const summary = {
      outwardTaxable: fmt(sup31a_txval + sup31b_txval),
      outwardTax: fmt(outwardLiabIgst + outwardLiabCgst + outwardLiabSgst + outwardLiabCess),
      salesIgst: fmt(outwardLiabIgst), salesCgst: fmt(outwardLiabCgst),
      salesSgst: fmt(outwardLiabSgst), salesCess: fmt(outwardLiabCess),
      rcmTaxable: fmt(sup31d_txval),
      rcmLiability: fmt(rcmLiabIgst + rcmLiabCgst + rcmLiabSgst + rcmLiabCess),
      rcmIgst: fmt(rcmLiabIgst), rcmCgst: fmt(rcmLiabCgst),
      rcmSgst: fmt(rcmLiabSgst), rcmCess: fmt(rcmLiabCess),
      eligibleItc: fmt(totalItcIgst + totalItcCgst + totalItcSgst + totalItcCess),
      itcIgst: fmt(totalItcIgst), itcCgst: fmt(totalItcCgst),
      itcSgst: fmt(totalItcSgst), itcCess: fmt(totalItcCess),
      netCashPayable: fmt(totalNetCashPayable),
      netCashOutward: fmt(netCashOutwardIgst + netCashOutwardCgst + netCashOutwardSgst + netCashOutwardCess),
      netCashRcm: fmt(rcmLiabIgst + rcmLiabCgst + rcmLiabSgst + rcmLiabCess),
      invoicesCount: activeInvoices.length,
      billsCount: activeBills.length
    };

    return { payload, offsetPayload, summary };
  }

  static async savePayload(workspaceId, gstin, period, options = {}) {
    const { payload, offsetPayload, summary } = await this.preparePayload(workspaceId, gstin, period);
    const isLive = isLiveFilingEnabled();

    if (!isLive) {
      await AuditLog.create({
        workspaceId,
        memberId: options.memberId || null,
        action: 'GSTR3B_SAVE_DRY_RUN',
        details: { gstin, period, ref_id: 'DRY-RUN', summary },
        status: 'SUCCESS'
      }).catch((err) => logger.warn('AuditLog creation failed in GSTR3B savePayload dry-run', { error: err.message }));

      return {
        success: true, dryRun: true,
        message: 'GSTR-3B payload prepared in dry-run mode. Live portal upload is disabled outside production.',
        summary, payload, offsetPayload
      };
    }

    const provider = FinaggService.getProvider();
    if (!provider || typeof provider.saveGstr3b !== 'function') {
      throw ApiError.providerError('Active GST provider does not support GSTR-3B RETSAVE.', 502);
    }

    const saveResult = await provider.saveGstr3b(payload, {
      gstin, period, username: options.username, gstToken: options.gstToken
    });

    await AuditLog.create({
      workspaceId,
      memberId: options.memberId || null,
      action: 'GSTR3B_SAVE_LIVE',
      details: { gstin, period, ref_id: saveResult?.ref_id, summary },
      status: 'SUCCESS'
    }).catch((err) => logger.warn('AuditLog creation failed in GSTR3B savePayload live', { error: err.message }));

    return {
      success: true, ref_id: saveResult?.ref_id, summary, payload, offsetPayload
    };
  }

  static async offsetLiabilities(workspaceId, gstin, period, options = {}) {
    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError('Live GSTR-3B liability offset is disabled outside production.', 503);
    }

    const provider = FinaggService.getProvider();
    if (!provider || typeof provider.offsetGstr3b !== 'function') {
      throw ApiError.providerError('Active GST provider does not support GSTR-3B liability offset.', 502);
    }

    let body = options.body;
    let prepared;
    if (!body && workspaceId) {
      prepared = await this.preparePayload(workspaceId, gstin, period);
      body = prepared.offsetPayload;
    }

    const offsetResult = await provider.offsetGstr3b(period, {
      gstin, username: options.username, gstToken: options.gstToken, body
    });

    if (workspaceId) {
      await AuditLog.create({
        workspaceId,
        memberId: options.memberId || null,
        action: 'GSTR3B_OFFSET_LIABILITIES',
        details: { gstin, period, netCashPayable: prepared?.summary?.netCashPayable },
        status: 'SUCCESS'
      }).catch((err) => logger.warn('AuditLog creation failed in GSTR3B offsetLiabilities', { error: err.message }));
    }

    return offsetResult;
  }
}

module.exports = Gstr3bService;
