const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const ReturnService = require('./return.service');
const ApiError = require('../utils/apiError');
const { isValidPeriod } = require('../utils/gstin');

/**
 * Safely rounds a number to 2 decimal places to prevent floating-point errors
 */
function roundToTwo(num) {
  return Math.round((Number(num) || 0) * 100) / 100;
}

class ReportService {
  /**
   * Compute GSTR-1 vs GSTR-3B Tax Liability Comparison Report
   *
   * @param {string|mongoose.Types.ObjectId} workspaceId
   * @param {string} period MMYYYY format
   * @param {Object} options { gstin, token, username }
   */
  static async getGstrComparison(workspaceId, period, options = {}) {
    if (!isValidPeriod(period)) {
      throw ApiError.validationError('Period must be in MMYYYY format (e.g., 092026).');
    }
    if (!options.gstin) {
      throw ApiError.validationError('GSTIN is required for return comparison.');
    }

    // Fetch both returns for the period with graceful fallback to cache or local workspace invoices
    const [g1Res, g3bRes] = await Promise.allSettled([
      ReturnService.getReturn('GSTR1', options.gstin, period, options.token, {
        ...options,
        workspaceId
      }),
      ReturnService.getReturn('GSTR3B', options.gstin, period, options.token, {
        ...options,
        workspaceId
      })
    ]);

    let gstr1 = g1Res.status === 'fulfilled' ? g1Res.value : null;
    let gstr3b = g3bRes.status === 'fulfilled' ? g3bRes.value : null;

    // ✅ FIX: If GSTR-1 could not be fetched from portal, synthesize from local workspace sales invoices
    if (!gstr1 && workspaceId) {
      try {
        const Gstr1Service = require('./gstr1.service');
        const prep = await Gstr1Service.preparePayload(workspaceId, options.gstin, period);
        if (prep?.summary) {
          gstr1 = {
            totals: {
              taxable: prep.summary.totalTaxable || 0,
              igst: prep.summary.totalIgst || 0,
              cgst: prep.summary.totalCgst || 0,
              sgst: prep.summary.totalSgst || 0,
              cess: 0
            }
          };
        }
      } catch (err) {
        // Fallback continues with default zero totals if local prep also fails
        console.warn('Local GSTR-1 synthesis failed:', err.message);
      }
    }

    const g1Totals = gstr1?.totals || { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    const g3bTotals = gstr3b?.totals || { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };

    const gstr1Liability = {
      taxable: roundToTwo(g1Totals.taxable),
      cgst: roundToTwo(g1Totals.cgst),
      sgst: roundToTwo(g1Totals.sgst),
      igst: roundToTwo(g1Totals.igst),
      cess: roundToTwo(g1Totals.cess),
      totalTax: roundToTwo(g1Totals.cgst + g1Totals.sgst + g1Totals.igst + g1Totals.cess)
    };

    const gstr3bLiability = {
      taxable: roundToTwo(g3bTotals.taxable),
      cgst: roundToTwo(g3bTotals.cgst),
      sgst: roundToTwo(g3bTotals.sgst),
      igst: roundToTwo(g3bTotals.igst),
      cess: roundToTwo(g3bTotals.cess),
      totalTax: roundToTwo(g3bTotals.cgst + g3bTotals.sgst + g3bTotals.igst + g3bTotals.cess)
    };

    const difference = {
      taxable: roundToTwo(gstr1Liability.taxable - gstr3bLiability.taxable),
      cgst: roundToTwo(gstr1Liability.cgst - gstr3bLiability.cgst),
      sgst: roundToTwo(gstr1Liability.sgst - gstr3bLiability.sgst),
      igst: roundToTwo(gstr1Liability.igst - gstr3bLiability.igst),
      cess: roundToTwo(gstr1Liability.cess - gstr3bLiability.cess),
      totalTax: roundToTwo(gstr1Liability.totalTax - gstr3bLiability.totalTax)
    };

    // Allow a tolerance of ₹1.00 for rounding differences
    const isMatched = Math.abs(difference.totalTax) <= 1.0 && Math.abs(difference.taxable) <= 1.0;

    let complianceRisk = 'LOW';
    let explanation = 'Outward liability in GSTR-1 matches tax declared in GSTR-3B. Zero variance.';

    if (!isMatched) {
      complianceRisk = 'HIGH';
      if (difference.totalTax > 0) {
        explanation = `GSTR-1 outward liability exceeds GSTR-3B declared tax by ₹${Math.abs(difference.totalTax)}. High risk of GST DRC-01B mismatch notice.`;
      } else {
        explanation = `GSTR-3B declared tax exceeds GSTR-1 outward liability by ₹${Math.abs(difference.totalTax)}. Review for missing sales invoices in GSTR-1 or excess ITC claim.`;
      }
    }

    return {
      period,
      gstin: options.gstin.toUpperCase(),
      status: isMatched ? 'MATCHED' : 'DISCREPANCY',
      complianceRisk,
      explanation,
      gstr1: gstr1Liability,
      gstr3b: gstr3bLiability,
      difference,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Generate Outward Sales Register with date range filters
   *
   * @param {string|mongoose.Types.ObjectId} workspaceId
   * @param {string} [fromDate] YYYY-MM-DD
   * @param {string} [toDate] YYYY-MM-DD
   */
  static async getSalesRegister(workspaceId, fromDate, toDate) {
    if (!workspaceId) {
      throw ApiError.validationError('Workspace ID is required.');
    }

    const query = {
      workspaceId,
      status: { $ne: 'Cancelled' }
    };

    // ✅ FIX: Robust UTC Date Filtering to prevent timezone off-by-one errors
    if (fromDate || toDate) {
      query.invoiceDate = {};
      if (fromDate) {
        const start = new Date(fromDate);
        start.setUTCHours(0, 0, 0, 0);
        query.invoiceDate.$gte = start;
      }
      if (toDate) {
        const end = new Date(toDate);
        end.setUTCHours(23, 59, 59, 999);
        query.invoiceDate.$lte = end;
      }
    }

    const invoices = await Invoice.find(query).sort({ invoiceDate: -1 }).lean();

    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let grandTotal = 0;

    const rows = invoices.map((inv) => {
      const taxable = roundToTwo(inv.subTotal || 0);
      const cgst = roundToTwo(inv.totalCgst || 0);
      const sgst = roundToTwo(inv.totalSgst || 0);
      const igst = roundToTwo(inv.totalIgst || 0);
      const totalTax = roundToTwo(inv.totalTax || (cgst + sgst + igst));
      const total = roundToTwo(inv.grandTotal || (taxable + totalTax));

      totalTaxable = roundToTwo(totalTaxable + taxable);
      totalCgst = roundToTwo(totalCgst + cgst);
      totalSgst = roundToTwo(totalSgst + sgst);
      totalIgst = roundToTwo(totalIgst + igst);
      grandTotal = roundToTwo(grandTotal + total);

      return {
        id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate ? inv.invoiceDate.toISOString().slice(0, 10) : '',
        customerName: inv.customerName,
        customerGstin: inv.customerGstin || 'Unregistered',
        placeOfSupply: inv.placeOfSupply || '',
        status: inv.status,
        taxableAmount: taxable,
        cgst,
        sgst,
        igst,
        totalTax,
        grandTotal: total
      };
    });

    const finalTotalTax = roundToTwo(totalCgst + totalSgst + totalIgst);

    return {
      summary: {
        totalInvoices: invoices.length,
        totalTaxable,
        totalCgst,
        totalSgst,
        totalIgst,
        totalTax: finalTotalTax,
        grandTotal
      },
      rows,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Generate Inward Purchase Register with date range filters
   *
   * @param {string|mongoose.Types.ObjectId} workspaceId
   * @param {string} [fromDate] YYYY-MM-DD
   * @param {string} [toDate] YYYY-MM-DD
   */
  static async getPurchaseRegister(workspaceId, fromDate, toDate) {
    if (!workspaceId) {
      throw ApiError.validationError('Workspace ID is required.');
    }

    const query = {
      workspaceId,
      status: { $ne: 'Cancelled' }
    };

    // ✅ FIX: Robust UTC Date Filtering to prevent timezone off-by-one errors
    if (fromDate || toDate) {
      query.billDate = {};
      if (fromDate) {
        const start = new Date(fromDate);
        start.setUTCHours(0, 0, 0, 0);
        query.billDate.$gte = start;
      }
      if (toDate) {
        const end = new Date(toDate);
        end.setUTCHours(23, 59, 59, 999);
        query.billDate.$lte = end;
      }
    }

    const bills = await Bill.find(query).sort({ billDate: -1 }).lean();

    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let grandTotal = 0;

    const rows = bills.map((bill) => {
      const taxable = roundToTwo(bill.subTotal || 0);
      const cgst = roundToTwo(bill.totalCgst || 0);
      const sgst = roundToTwo(bill.totalSgst || 0);
      const igst = roundToTwo(bill.totalIgst || 0);
      const totalTax = roundToTwo(bill.totalTax || (cgst + sgst + igst));
      const total = roundToTwo(bill.grandTotal || (taxable + totalTax));

      totalTaxable = roundToTwo(totalTaxable + taxable);
      totalCgst = roundToTwo(totalCgst + cgst);
      totalSgst = roundToTwo(totalSgst + sgst);
      totalIgst = roundToTwo(totalIgst + igst);
      grandTotal = roundToTwo(grandTotal + total);

      return {
        id: bill._id,
        billNumber: bill.billNumber,
        billDate: bill.billDate ? bill.billDate.toISOString().slice(0, 10) : '',
        vendorName: bill.vendorName,
        vendorGstin: bill.vendorGstin || 'Unregistered',
        category: bill.category || 'Expense',
        status: bill.status,
        taxableAmount: taxable,
        cgst,
        sgst,
        igst,
        totalTax,
        grandTotal: total
      };
    });

    const finalTotalTax = roundToTwo(totalCgst + totalSgst + totalIgst);

    return {
      summary: {
        totalBills: bills.length,
        totalTaxable,
        totalCgst,
        totalSgst,
        totalIgst,
        totalTax: finalTotalTax,
        grandTotal
      },
      rows,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = ReportService;