const Invoice = require('../models/Invoice');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { isValidGstin, isValidPeriod } = require('../utils/gstin');
const FinaggService = require('./finagg.service');

function formatGstnDate(dateVal) {
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

function extractPos(pos) {
  if (!pos || typeof pos !== 'string') return '00';
  const match = pos.trim().match(/^([0-9]{2})/);
  return match ? match[1] : pos.trim().slice(0, 2) || '00';
}

class Gstr1Service {
  /**
   * Prepares official GSTN GSTR-1 JSON schema payload from stored workspace invoices
   * Tables:
   * - Table 4A/4B (B2B): Supplies to registered persons
   * - Table 7 (B2CS): Other supplies to unregistered persons
   * - Table 12 (HSN): HSN-wise summary of outward supplies
   * - Table 13 (DOCISS): Documents issued during the tax period
   */
  static async preparePayload(workspaceId, gstin, period) {
    if (!workspaceId) {
      throw ApiError.validationError('Active workspaceId is required to prepare GSTR-1.');
    }
    const normGstin = (gstin || '').trim().toUpperCase();
    if (!isValidGstin(normGstin)) {
      throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
    }
    if (!isValidPeriod(period)) {
      throw ApiError.validationError('Invalid return period format. Must be MMYYYY.');
    }

    const month = parseInt(period.slice(0, 2), 10);
    const year = parseInt(period.slice(2), 10);
    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    // Query all invoices in the tax period
    const allInvoices = await Invoice.find({
      workspaceId,
      invoiceDate: { $gte: startDate, $lte: endDate }
    }).sort({ invoiceDate: 1, invoiceNumber: 1 });

    const isCancelled = (inv) => (inv.status || '').toLowerCase() === 'cancelled';
    const activeInvoices = allInvoices.filter((inv) => !isCancelled(inv));
    const cancelledCount = allInvoices.filter((inv) => isCancelled(inv)).length;

    // 1. Group B2B Invoices (Table 4)
    const b2bMap = new Map();
    // 2. Group B2CS Invoices (Table 7)
    const b2csMap = new Map();
    // 3. Group HSN Summary (Table 12)
    const hsnMap = new Map();

    const supplierStateCode = normGstin.slice(0, 2);

    for (const inv of activeInvoices) {
      const pos = extractPos(inv.placeOfSupply);
      const isInterState = pos !== supplierStateCode;
      const isB2B = inv.customerGstin && isValidGstin(inv.customerGstin.trim().toUpperCase());

      if (isB2B) {
        const buyerGstin = inv.customerGstin.trim().toUpperCase();
        if (!b2bMap.has(buyerGstin)) {
          b2bMap.set(buyerGstin, []);
        }

        const itms = (inv.lineItems || []).map((item, idx) => ({
          num: idx + 1,
          itm_det: {
            rt: Number(item.gstRate || 0),
            txval: Math.round(Number(item.taxableAmount || 0) * 100) / 100,
            iamt: Math.round(Number(item.igstAmount || 0) * 100) / 100,
            camt: Math.round(Number(item.cgstAmount || 0) * 100) / 100,
            samt: Math.round(Number(item.sgstAmount || 0) * 100) / 100,
            csamt: 0
          }
        }));

        b2bMap.get(buyerGstin).push({
          inum: inv.invoiceNumber,
          idt: formatGstnDate(inv.invoiceDate),
          val: Math.round(Number(inv.grandTotal || 0) * 100) / 100,
          pos,
          rchrg: 'N',
          inv_typ: 'R',
          itms
        });
      } else {
        // B2C Small
        const sply_ty = isInterState ? 'INTER' : 'INTRA';
        for (const item of (inv.lineItems || [])) {
          const rt = Number(item.gstRate || 0);
          const key = `${sply_ty}_${pos}_${rt}`;
          if (!b2csMap.has(key)) {
            b2csMap.set(key, {
              sply_ty,
              pos,
              rt,
              txval: 0,
              iamt: 0,
              camt: 0,
              samt: 0,
              csamt: 0
            });
          }
          const row = b2csMap.get(key);
          row.txval += Number(item.taxableAmount || 0);
          row.iamt += Number(item.igstAmount || 0);
          row.camt += Number(item.cgstAmount || 0);
          row.samt += Number(item.sgstAmount || 0);
        }
      }

      // HSN items aggregation
      for (const item of (inv.lineItems || [])) {
        const hsnCode = (item.hsnSac || '9999').trim();
        const rt = Number(item.gstRate || 0);
        const uqc = (item.unit || 'PCS').trim().toUpperCase();
        const key = `${hsnCode}_${uqc}_${rt}`;
        if (!hsnMap.has(key)) {
          hsnMap.set(key, {
            hsn_sc: hsnCode,
            desc: item.name || 'Goods and Services',
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
        hsnRow.qty += Number(item.quantity || 0);
        hsnRow.txval += Number(item.taxableAmount || 0);
        hsnRow.iamt += Number(item.igstAmount || 0);
        hsnRow.camt += Number(item.cgstAmount || 0);
        hsnRow.samt += Number(item.sgstAmount || 0);
      }
    }

    // Transform B2B array
    const b2b = [];
    for (const [ctin, invList] of b2bMap.entries()) {
      b2b.push({
        ctin,
        cfs: 'Y',
        inv: invList
      });
    }

    // Transform B2CS array
    const b2cs = [];
    for (const row of b2csMap.values()) {
      b2cs.push({
        sply_ty: row.sply_ty,
        pos: row.pos,
        rt: row.rt,
        txval: Math.round(row.txval * 100) / 100,
        iamt: Math.round(row.iamt * 100) / 100,
        camt: Math.round(row.camt * 100) / 100,
        samt: Math.round(row.samt * 100) / 100,
        csamt: 0
      });
    }

    // Transform HSN array
    const hsnData = [];
    let hsnIdx = 1;
    for (const row of hsnMap.values()) {
      hsnData.push({
        num: hsnIdx++,
        hsn_sc: row.hsn_sc,
        desc: row.desc,
        uqc: row.uqc,
        qty: Math.round(row.qty * 100) / 100,
        rt: row.rt,
        txval: Math.round(row.txval * 100) / 100,
        iamt: Math.round(row.iamt * 100) / 100,
        camt: Math.round(row.camt * 100) / 100,
        samt: Math.round(row.samt * 100) / 100,
        csamt: 0
      });
    }

    // Transform Document Issue (Table 13)
    const docRange = {
      from: allInvoices.length > 0 ? allInvoices[0].invoiceNumber : 'N/A',
      to: allInvoices.length > 0 ? allInvoices[allInvoices.length - 1].invoiceNumber : 'N/A',
      totnum: allInvoices.length,
      canc: cancelledCount,
      net_issue: activeInvoices.length
    };

    const doc_issue = {
      doc_det: [
        {
          doc_num: 1,
          doc_typ: 'Invoices for outward supply',
          docs: [
            {
              num: 1,
              from: docRange.from,
              to: docRange.to,
              totnum: docRange.totnum,
              canc: docRange.canc,
              net_issue: docRange.net_issue
            }
          ]
        }
      ]
    };

    // Calculate overall totals
    let totalTaxable = 0, totalIgst = 0, totalCgst = 0, totalSgst = 0, grandTotal = 0;
    for (const inv of activeInvoices) {
      totalTaxable += Number(inv.subTotal ?? inv.totalTaxable ?? 0);
      totalIgst += Number(inv.totalIgst || 0);
      totalCgst += Number(inv.totalCgst || 0);
      totalSgst += Number(inv.totalSgst || 0);
      grandTotal += Number(inv.grandTotal || 0);
    }

    const summary = {
      totalInvoices: activeInvoices.length,
      cancelledInvoices: cancelledCount,
      totalTaxable: Math.round(totalTaxable * 100) / 100,
      totalIgst: Math.round(totalIgst * 100) / 100,
      totalCgst: Math.round(totalCgst * 100) / 100,
      totalSgst: Math.round(totalSgst * 100) / 100,
      totalTax: Math.round((totalIgst + totalCgst + totalSgst) * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      sections: {
        b2bCount: b2b.reduce((acc, b) => acc + (b.inv || []).length, 0),
        b2csCount: b2cs.length,
        hsnCount: hsnData.length,
        docRange
      }
    };

    const payload = {
      gstin: normGstin,
      fp: period,
      gt: 0,
      cur_gt: summary.grandTotal,
      b2b,
      b2cs,
      hsn: { data: hsnData },
      doc_issue
    };

    return {
      success: true,
      period,
      gstin: normGstin,
      summary,
      payload
    };
  }

  /**
   * Save / Upload GSTR-1 payload to GSTN via TaxPro RETSAVE.
   * STRICT SAFETY GUARD: When FEATURE_FILING !== 'true', this strictly operates in dry-run mode.
   */
  static async savePayload(workspaceId, gstin, period, options = {}) {
    const prepared = await Gstr1Service.preparePayload(workspaceId, gstin, period);

    const isFilingEnabled = process.env.FEATURE_FILING === 'true';

    // 1. Dry-run mode (Default, per AGENTS.md safety rule)
    if (!isFilingEnabled) {
      await AuditLog.create({
        workspaceId,
        gstin: prepared.gstin,
        action: 'GSTR1_SAVE_DRY_RUN',
        status: 'SUCCESS'
      }).catch(() => {});

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

    // 2. Production filing mode (Only when FEATURE_FILING === 'true')
    const provider = FinaggService.getProvider();
    if (!provider || typeof provider.saveGstr1 !== 'function') {
      throw ApiError.providerError('Active GST provider does not support GSTR-1 RETSAVE.', 502);
    }

    const result = await provider.saveGstr1(prepared.payload, options);

    await AuditLog.create({
      workspaceId,
      gstin: prepared.gstin,
      action: 'GSTR1_SAVE',
      status: 'SUCCESS'
    }).catch(() => {});

    return {
      success: true,
      dryRun: false,
      ref_id: result.ref_id,
      period,
      gstin: prepared.gstin,
      summary: prepared.summary
    };
  }
}

module.exports = Gstr1Service;
