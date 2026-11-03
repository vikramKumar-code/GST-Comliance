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
  static async preparePayload(workspaceId, gstin, period, options = {}) {
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

    const excludedIds = new Set((options.excludedInvoiceIds || []).map(String));

    // Query all invoices in the tax period
    const allInvoices = await Invoice.find({
      workspaceId,
      invoiceDate: { $gte: startDate, $lte: endDate }
    }).sort({ invoiceDate: 1, invoiceNumber: 1 });

    const isCancelled = (inv) => (inv.status || '').toLowerCase() === 'cancelled';
    const activeInvoices = allInvoices.filter((inv) => !isCancelled(inv));
    const cancelledCount = allInvoices.filter((inv) => isCancelled(inv)).length;

    // Categorized invoice list for drilldown inspection
    const sectionDetails = {
      b2b: [],
      b2cl: [],
      b2cs: [],
      exp: [],
      cdnr: [],
      hsn: [],
      docIssue: null,
      docIssueList: []
    };

    // 1. Group B2B Invoices (Table 4)
    const b2bMap = new Map();
    // 2. Group B2CL Invoices (Table 5)
    const b2clMap = new Map();
    // 3. Group B2CS Invoices (Table 7)
    const b2csMap = new Map();
    // 4. Group Exports (Table 6A)
    const expList = [];
    // 5. Group HSN Summary (Table 12)
    const hsnMap = new Map();

    const supplierStateCode = normGstin.slice(0, 2);

    for (const inv of activeInvoices) {
      const invIdStr = String(inv._id);
      const isExcluded = excludedIds.has(invIdStr);

      const pos = extractPos(inv.placeOfSupply);
      const isInterState = pos !== supplierStateCode;
      const isB2B = inv.customerGstin && isValidGstin(inv.customerGstin.trim().toUpperCase());
      const isExport = Boolean(inv.isExport || pos === '96' || inv.exportType);
      const grandTotalVal = Number(inv.grandTotal || 0);
      const taxableVal = Number(inv.subTotal ?? inv.totalTaxable ?? 0);
      const igstVal = Number(inv.totalIgst || 0);
      const cgstVal = Number(inv.totalCgst || 0);
      const sgstVal = Number(inv.totalSgst || 0);

      const invoiceItemDetail = {
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        dateFormatted: formatGstnDate(inv.invoiceDate),
        customerName: inv.customerName,
        customerGstin: inv.customerGstin || '',
        placeOfSupply: inv.placeOfSupply || pos,
        pos,
        grandTotal: grandTotalVal,
        taxableAmount: taxableVal,
        igst: igstVal,
        cgst: cgstVal,
        sgst: sgstVal,
        lineItemsCount: inv.lineItems?.length || 0,
        isExcluded
      };

      sectionDetails.docIssueList.push(invoiceItemDetail);

      if (inv.documentType === 'CREDIT_NOTE' || inv.documentType === 'DEBIT_NOTE') {
        sectionDetails.cdnr.push({
          ...invoiceItemDetail,
          noteType: inv.documentType === 'CREDIT_NOTE' ? 'C' : 'D',
          originalInvoiceNumber: inv.originalInvoiceNumber || 'INV-ORIG',
          originalInvoiceDate: inv.originalInvoiceDate ? formatGstnDate(inv.originalInvoiceDate) : '',
          reason: inv.noteReason || 'Sales Return'
        });
      } else if (isExport) {
        sectionDetails.exp.push(invoiceItemDetail);
        if (!isExcluded) {
          expList.push({
            exp_typ: inv.exportType || 'WOPAY',
            inv: [{
              inum: inv.invoiceNumber,
              idt: formatGstnDate(inv.invoiceDate),
              val: Math.round(grandTotalVal * 100) / 100,
              itms: (inv.lineItems || []).map((item, idx) => ({
                num: idx + 1,
                itm_det: {
                  rt: Number(item.gstRate || 0),
                  txval: Math.round(Number(item.taxableAmount || 0) * 100) / 100,
                  iamt: Math.round(Number(item.igstAmount || 0) * 100) / 100,
                  csamt: 0
                }
              }))
            }]
          });
        }
      } else if (isB2B) {
        sectionDetails.b2b.push(invoiceItemDetail);
        if (!isExcluded) {
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
            val: Math.round(grandTotalVal * 100) / 100,
            pos,
            rchrg: 'N',
            inv_typ: 'R',
            itms
          });
        }
      } else if (isInterState && grandTotalVal > 250000) {
        // Table 5: B2C Large (Unregistered, Inter-State, > 2.5 Lakhs)
        sectionDetails.b2cl.push(invoiceItemDetail);
        if (!isExcluded) {
          if (!b2clMap.has(pos)) {
            b2clMap.set(pos, []);
          }
          b2clMap.get(pos).push({
            inum: inv.invoiceNumber,
            idt: formatGstnDate(inv.invoiceDate),
            val: Math.round(grandTotalVal * 100) / 100,
            pos,
            itms: (inv.lineItems || []).map((item, idx) => ({
              num: idx + 1,
              itm_det: {
                rt: Number(item.gstRate || 0),
                txval: Math.round(Number(item.taxableAmount || 0) * 100) / 100,
                iamt: Math.round(Number(item.igstAmount || 0) * 100) / 100,
                csamt: 0
              }
            }))
          });
        }
      } else {
        // Table 7: B2C Small
        sectionDetails.b2cs.push(invoiceItemDetail);
        if (!isExcluded) {
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
      }

      // HSN items aggregation (only for non-excluded invoices)
      if (!isExcluded) {
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

    // Transform B2CL array
    const b2cl = [];
    for (const [pos, invList] of b2clMap.entries()) {
      b2cl.push({
        pos,
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
    sectionDetails.hsn = hsnData;

    // Transform Document Issue (Table 13)
    const includedInvoices = activeInvoices.filter((inv) => !excludedIds.has(String(inv._id)));
    const docRange = {
      from: includedInvoices.length > 0 ? includedInvoices[0].invoiceNumber : 'N/A',
      to: includedInvoices.length > 0 ? includedInvoices[includedInvoices.length - 1].invoiceNumber : 'N/A',
      totnum: allInvoices.length,
      canc: cancelledCount + excludedIds.size,
      net_issue: includedInvoices.length,
      totalCount: allInvoices.length
    };
    sectionDetails.docIssue = docRange;

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

    // Calculate active/included totals
    let totalTaxable = 0, totalIgst = 0, totalCgst = 0, totalSgst = 0, grandTotal = 0;
    for (const inv of includedInvoices) {
      totalTaxable += Number(inv.subTotal ?? inv.totalTaxable ?? 0);
      totalIgst += Number(inv.totalIgst || 0);
      totalCgst += Number(inv.totalCgst || 0);
      totalSgst += Number(inv.totalSgst || 0);
      grandTotal += Number(inv.grandTotal || 0);
    }

    const summary = {
      totalInvoices: activeInvoices.length,
      allInvoicesCount: allInvoices.length,
      includedInvoices: includedInvoices.length,
      excludedInvoices: excludedIds.size,
      cancelledInvoices: cancelledCount,
      totalTaxable: Math.round(totalTaxable * 100) / 100,
      totalIgst: Math.round(totalIgst * 100) / 100,
      totalCgst: Math.round(totalCgst * 100) / 100,
      totalSgst: Math.round(totalSgst * 100) / 100,
      totalTax: Math.round((totalIgst + totalCgst + totalSgst) * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      sections: {
        b2bCount: sectionDetails.b2b.length,
        b2bIncluded: sectionDetails.b2b.filter((i) => !i.isExcluded).length,
        b2bTaxable: Math.round(sectionDetails.b2b.filter((i) => !i.isExcluded).reduce((acc, i) => acc + i.taxableAmount, 0) * 100) / 100,
        b2bTax: Math.round(sectionDetails.b2b.filter((i) => !i.isExcluded).reduce((acc, i) => acc + i.igst + i.cgst + i.sgst, 0) * 100) / 100,

        b2clCount: sectionDetails.b2cl.length,
        b2clIncluded: sectionDetails.b2cl.filter((i) => !i.isExcluded).length,
        b2clTaxable: Math.round(sectionDetails.b2cl.filter((i) => !i.isExcluded).reduce((acc, i) => acc + i.taxableAmount, 0) * 100) / 100,
        b2clTax: Math.round(sectionDetails.b2cl.filter((i) => !i.isExcluded).reduce((acc, i) => acc + i.igst + i.cgst + i.sgst, 0) * 100) / 100,

        b2csCount: sectionDetails.b2cs.length,
        b2csIncluded: sectionDetails.b2cs.filter((i) => !i.isExcluded).length,
        b2csTaxable: Math.round(sectionDetails.b2cs.filter((i) => !i.isExcluded).reduce((acc, i) => acc + i.taxableAmount, 0) * 100) / 100,
        b2csTax: Math.round(sectionDetails.b2cs.filter((i) => !i.isExcluded).reduce((acc, i) => acc + i.igst + i.cgst + i.sgst, 0) * 100) / 100,

        expCount: sectionDetails.exp.length,
        expIncluded: sectionDetails.exp.filter((i) => !i.isExcluded).length,
        expTaxable: Math.round(sectionDetails.exp.filter((i) => !i.isExcluded).reduce((acc, i) => acc + i.taxableAmount, 0) * 100) / 100,
        expTax: Math.round(sectionDetails.exp.filter((i) => !i.isExcluded).reduce((acc, i) => acc + i.igst, 0) * 100) / 100,

        cdnrCount: sectionDetails.cdnr.length,
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
      b2cl,
      b2cs,
      exp: expList,
      hsn: { data: hsnData },
      doc_issue
    };

    return {
      success: true,
      period,
      gstin: normGstin,
      summary,
      payload,
      sectionDetails
    };
  }

  /**
   * Save / Upload GSTR-1 payload to GSTN via TaxPro RETSAVE.
   * STRICT SAFETY GUARD: When FEATURE_FILING !== 'true', this strictly operates in dry-run mode.
   */
  static async savePayload(workspaceId, gstin, period, options = {}) {
    const prepared = await Gstr1Service.preparePayload(workspaceId, gstin, period, options);

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
      message: 'GSTR-1 successfully uploaded and saved to GSTN Portal!',
      ref_id: result.ref_id,
      period,
      gstin: prepared.gstin,
      summary: prepared.summary
    };
  }
}

module.exports = Gstr1Service;
