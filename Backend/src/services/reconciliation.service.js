const Bill = require('../models/Bill');
const Invoice = require('../models/Invoice');
const FinaggService = require('./finagg.service');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { isValidPeriod } = require('../utils/gstin');

/**
 * Normalization utilities for GST matching
 */
function normalizeGstin(gstin) {
  return String(gstin || '').trim().toUpperCase();
}

function normalizeInvoiceNumber(invNum) {
  // Strip special characters like slashes, dashes, spaces and uppercase
  return String(invNum || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function roundToTwo(num) {
  return Math.round((Number(num) || 0) * 100) / 100;
}

function getPeriodDateRange(period) {
  if (!isValidPeriod(period)) {
    throw ApiError.validationError('Period must be MMYYYY format (e.g. 092026).');
  }
  const month = parseInt(period.slice(0, 2), 10);
  const year = parseInt(period.slice(2), 10);

  const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { startDate, endDate };
}

class ReconciliationService {
  /**
   * Reconcile Purchase Bills against GSTR-2B Inward Supplies
   *
   * @param {string|mongoose.Types.ObjectId} workspaceId
   * @param {string} period MMYYYY format
   * @param {Object} options { gstin, token, username }
   */
  static async reconcileItc(workspaceId, period, options = {}) {
    if (!workspaceId) {
      throw ApiError.validationError('Workspace ID is required.');
    }
    const { startDate, endDate } = getPeriodDateRange(period);

    // 1. Fetch Purchase Bills for this workspace within this period
    const bills = await Bill.find({
      workspaceId,
      billDate: { $gte: startDate, $lt: endDate },
      status: { $ne: 'Cancelled' }
    }).lean();

    // 2. Fetch GSTR-2B Inward Supplies from provider/cache
    let rawGstr2b = null;
    let gstr2bAvailable = true;

    try {
      if (options.gstin) {
        rawGstr2b = await FinaggService.getReturn(
          'GSTR2B',
          options.gstin,
          period,
          options.token,
          options.username,
          options
        );
      }
    } catch (err) {
      if (err.code === 'DATA_NOT_AVAILABLE' || err.statusCode === 404) {
        gstr2bAvailable = false;
      } else {
        logger.warn('Failed to fetch GSTR-2B for reconciliation, falling back to books', {
          code: err.code || err.statusCode
        });
        gstr2bAvailable = false;
      }
    }

    // 3. Extract GSTR-2B B2B invoices
    const gstr2bInvoices = ReconciliationService._extract2bInvoices(rawGstr2b);

    // 4. Index GSTR-2B invoices by Normalized Supplier GSTIN + Normalized Invoice Number
    const gstr2bMap = new Map();
    for (const inv of gstr2bInvoices) {
      const key = `${normalizeGstin(inv.supplierGstin)}_${normalizeInvoiceNumber(inv.invoiceNumber)}`;
      // Support multiple items per invoice by aggregating if key repeats
      if (gstr2bMap.has(key)) {
        const existing = gstr2bMap.get(key);
        existing.taxableAmount = roundToTwo(existing.taxableAmount + inv.taxableAmount);
        existing.cgst = roundToTwo(existing.cgst + inv.cgst);
        existing.sgst = roundToTwo(existing.sgst + inv.sgst);
        existing.igst = roundToTwo(existing.igst + inv.igst);
        existing.totalTax = roundToTwo(existing.totalTax + inv.totalTax);
        existing.grandTotal = roundToTwo(existing.grandTotal + inv.grandTotal);
      } else {
        gstr2bMap.set(key, { ...inv, matched: false });
      }
    }

    // 5. Run Matching Engine
    const matched = [];
    const mismatched = [];
    const missingIn2b = [];

    let totalBooksTaxable = 0;
    let totalBooksTax = 0;
    let eligibleItcCgst = 0;
    let eligibleItcSgst = 0;
    let eligibleItcIgst = 0;
    let atRiskTax = 0;

    for (const bill of bills) {
      const billTaxable = roundToTwo(bill.subTotal || 0);
      const billCgst = roundToTwo(bill.totalCgst || 0);
      const billSgst = roundToTwo(bill.totalSgst || 0);
      const billIgst = roundToTwo(bill.totalIgst || 0);
      const billTax = roundToTwo(bill.totalTax || (billCgst + billSgst + billIgst));

      totalBooksTaxable = roundToTwo(totalBooksTaxable + billTaxable);
      totalBooksTax = roundToTwo(totalBooksTax + billTax);

      const billKey = `${normalizeGstin(bill.vendorGstin)}_${normalizeInvoiceNumber(bill.billNumber)}`;
      const g2bMatch = gstr2bMap.get(billKey);

      if (g2bMatch) {
        g2bMatch.matched = true;

        const diffTaxable = roundToTwo(Math.abs(billTaxable - g2bMatch.taxableAmount));
        const diffTax = roundToTwo(Math.abs(billTax - g2bMatch.totalTax));

        // Matching tolerance: <= ₹1.00 difference allows for rounding differences
        if (diffTaxable <= 1.0 && diffTax <= 1.0) {
          matched.push({
            billId: bill._id,
            billNumber: bill.billNumber,
            vendorName: bill.vendorName,
            vendorGstin: bill.vendorGstin,
            billDate: bill.billDate,
            taxableAmount: billTaxable,
            cgst: billCgst,
            sgst: billSgst,
            igst: billIgst,
            totalTax: billTax,
            gstr2b: {
              taxableAmount: g2bMatch.taxableAmount,
              cgst: g2bMatch.cgst,
              sgst: g2bMatch.sgst,
              igst: g2bMatch.igst,
              totalTax: g2bMatch.totalTax
            },
            status: 'MATCHED',
            itcEligible: true
          });

          eligibleItcCgst = roundToTwo(eligibleItcCgst + g2bMatch.cgst);
          eligibleItcSgst = roundToTwo(eligibleItcSgst + g2bMatch.sgst);
          eligibleItcIgst = roundToTwo(eligibleItcIgst + g2bMatch.igst);
        } else {
          mismatched.push({
            billId: bill._id,
            billNumber: bill.billNumber,
            vendorName: bill.vendorName,
            vendorGstin: bill.vendorGstin,
            billDate: bill.billDate,
            taxableAmount: billTaxable,
            totalTax: billTax,
            gstr2b: {
              taxableAmount: g2bMatch.taxableAmount,
              totalTax: g2bMatch.totalTax
            },
            discrepancy: {
              diffTaxable,
              diffTax,
              reason: 'Taxable value or tax amount does not match GSTR-2B'
            },
            status: 'MISMATCHED_VALUE',
            itcEligible: false
          });

          atRiskTax = roundToTwo(atRiskTax + billTax);
        }
      } else {
        // Missing in GSTR-2B
        missingIn2b.push({
          billId: bill._id,
          billNumber: bill.billNumber,
          vendorName: bill.vendorName,
          vendorGstin: bill.vendorGstin,
          billDate: bill.billDate,
          taxableAmount: billTaxable,
          cgst: billCgst,
          sgst: billSgst,
          igst: billIgst,
          totalTax: billTax,
          status: 'MISSING_IN_2B',
          reason: gstr2bAvailable
            ? 'Vendor has not filed GSTR-1 yet. ITC is blocked until reported.'
            : 'GSTR-2B data for this period is not available yet.',
          itcEligible: false
        });

        atRiskTax = roundToTwo(atRiskTax + billTax);
      }
    }

    // 6. Any GSTR-2B invoices that were NOT in Purchase Bills
    const extraIn2b = [];
    for (const [_, inv] of gstr2bMap) {
      if (!inv.matched) {
        extraIn2b.push({
          invoiceNumber: inv.invoiceNumber,
          supplierGstin: inv.supplierGstin,
          invoiceDate: inv.invoiceDate,
          taxableAmount: inv.taxableAmount,
          cgst: inv.cgst,
          sgst: inv.sgst,
          igst: inv.igst,
          totalTax: inv.totalTax,
          grandTotal: inv.grandTotal,
          status: 'EXTRA_IN_2B',
          reason: 'Present in GSTR-2B from supplier, but missing from your purchase bills.'
        });
      }
    }

    const eligibleTotal = roundToTwo(eligibleItcCgst + eligibleItcSgst + eligibleItcIgst);

    return {
      period,
      gstr2bAvailable,
      summary: {
        totalBooksBillsCount: bills.length,
        totalBooksTaxable,
        totalBooksTax,
        matchedCount: matched.length,
        mismatchedCount: mismatched.length,
        missingIn2bCount: missingIn2b.length,
        extraIn2bCount: extraIn2b.length,
        eligibleItc: {
          cgst: eligibleItcCgst,
          sgst: eligibleItcSgst,
          igst: eligibleItcIgst,
          total: eligibleTotal
        },
        atRiskItc: {
          total: atRiskTax
        }
      },
      matched,
      mismatched,
      missingIn2b,
      extraIn2b,
      reconciledAt: new Date().toISOString()
    };
  }

  /**
   * Calculate Estimated GST Refund or Net Tax Payable
   *
   * @param {string|mongoose.Types.ObjectId} workspaceId
   * @param {string} period MMYYYY format
   * @param {Object} options { gstin, token, username }
   */
  static async calculateRefundEstimate(workspaceId, period, options = {}) {
    if (!workspaceId) {
      throw ApiError.validationError('Workspace ID is required.');
    }
    const { startDate, endDate } = getPeriodDateRange(period);

    // 1. Calculate Output Tax from Sales Invoices
    const invoices = await Invoice.find({
      workspaceId,
      invoiceDate: { $gte: startDate, $lt: endDate },
      status: { $ne: 'Cancelled' }
    }).lean();

    let outputTaxable = 0;
    let outputCgst = 0;
    let outputSgst = 0;
    let outputIgst = 0;

    for (const inv of invoices) {
      outputTaxable = roundToTwo(outputTaxable + (inv.subTotal || 0));
      outputCgst = roundToTwo(outputCgst + (inv.totalCgst || 0));
      outputSgst = roundToTwo(outputSgst + (inv.totalSgst || 0));
      outputIgst = roundToTwo(outputIgst + (inv.totalIgst || 0));
    }
    const outputTotalTax = roundToTwo(outputCgst + outputSgst + outputIgst);

    // 2. Run ITC Reconciliation to get Eligible ITC
    const reconciliation = await ReconciliationService.reconcileItc(workspaceId, period, options);
    const itc = reconciliation.summary.eligibleItc;

    // 3. Compute Net Position (Output Tax Liability - Eligible ITC)
    const netCgst = roundToTwo(outputCgst - itc.cgst);
    const netSgst = roundToTwo(outputSgst - itc.sgst);
    const netIgst = roundToTwo(outputIgst - itc.igst);
    const netTotal = roundToTwo(outputTotalTax - itc.total);

    const isRefundEligible = netTotal < 0;
    const surplusItc = isRefundEligible ? Math.abs(netTotal) : 0;
    const netPayable = isRefundEligible ? 0 : netTotal;

    return {
      period,
      outputLiability: {
        totalInvoices: invoices.length,
        taxable: outputTaxable,
        cgst: outputCgst,
        sgst: outputSgst,
        igst: outputIgst,
        total: outputTotalTax
      },
      inputTaxCredit: {
        matchedBills: reconciliation.summary.matchedCount,
        cgst: itc.cgst,
        sgst: itc.sgst,
        igst: itc.igst,
        total: itc.total
      },
      netPosition: {
        cgst: netCgst,
        sgst: netSgst,
        igst: netIgst,
        total: netTotal,
        status: isRefundEligible ? 'REFUND_OR_CARRY_FORWARD' : 'TAX_PAYABLE',
        estimatedRefundAmount: surplusItc,
        estimatedTaxPayable: netPayable,
        explanation: isRefundEligible
          ? 'Eligible Input Tax Credit exceeds Output Tax Liability. You have surplus ITC eligible for refund (RFD-01) or carry forward to next month.'
          : 'Output Tax Liability exceeds Input Tax Credit. Net tax is payable in cash via GSTR-3B Table 6.1.'
      },
      reconciliationSummary: reconciliation.summary,
      calculatedAt: new Date().toISOString()
    };
  }

  /**
   * Helper to parse and flatten 2B invoice records from provider or mock shapes
   */
  static _extract2bInvoices(raw) {
    if (!raw || typeof raw !== 'object') return [];

    const result = [];
    const docData = raw.data?.docdata || raw.docdata || raw.data || raw;
    const b2bSupplies = docData?.b2b || [];

    if (Array.isArray(b2bSupplies)) {
      for (const sup of b2bSupplies) {
        const supplierGstin = sup.ctin || '';
        for (const inv of (sup.inv || [])) {
          let itmTaxable = 0;
          let itmCgst = 0;
          let itmSgst = 0;
          let itmIgst = 0;

          for (const itm of (inv.itms || [])) {
            const det = itm.itm_det || itm;
            itmTaxable += Number(det.txval || 0);
            itmCgst += Number(det.camt || 0);
            itmSgst += Number(det.samt || 0);
            itmIgst += Number(det.iamt || 0);
          }

          const totalTax = roundToTwo(itmCgst + itmSgst + itmIgst);
          const grandTotal = Number(inv.val) || roundToTwo(itmTaxable + totalTax);

          result.push({
            supplierGstin,
            invoiceNumber: inv.inum || '',
            invoiceDate: inv.dt || '',
            taxableAmount: roundToTwo(itmTaxable),
            cgst: roundToTwo(itmCgst),
            sgst: roundToTwo(itmSgst),
            igst: roundToTwo(itmIgst),
            totalTax,
            grandTotal,
            itcEligible: inv.itc_elg !== 'N'
          });
        }
      }
    }

    return result;
  }
}

module.exports = ReconciliationService;
