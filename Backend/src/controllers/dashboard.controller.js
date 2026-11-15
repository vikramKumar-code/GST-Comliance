const ReturnService = require('../services/return.service');
const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const Customer = require('../models/Customer');
const { shouldSimulateDown } = require('../utils/testHooks');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');

exports.getDashboard = async (req, res, next) => {
  try {
    const simulateDown = shouldSimulateDown(req);
    const workspaceId = await resolveWorkspaceId(req);

    // Fetch GST returns breakdown:
    // Only call external live TaxPro GSP APIs when explicitly requested (?live=true).
    // By default, compute directly from local MongoDB books (Zero GSP API cost & 5ms response).
    const period = req.query.period;
    let returnData;

    if (req.query.live === 'true') {
      returnData = await ReturnService.getDashboard(req.gstin, period, req.gstToken, {
        simulateDown,
        username: req.username,
        workspaceId,
        sessionId: req.session?._id
      });
    } else {
      let salesTaxable = 0, salesIgst = 0, salesCgst = 0, salesSgst = 0, salesCess = 0, salesTotal = 0;
      let purchTaxable = 0, purchIgst = 0, purchCgst = 0, purchSgst = 0, purchCess = 0, purchTotal = 0;

      if (period && period.length === 6) {
        const m = parseInt(period.slice(0, 2), 10);
        const y = parseInt(period.slice(2), 10);
        const startDate = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
        const endDate = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

        if (workspaceId) {
          const [periodInvoices, periodBills] = await Promise.all([
            Invoice.find({ workspaceId, invoiceDate: { $gte: startDate, $lte: endDate }, status: { $ne: 'Cancelled' } }).lean(),
            Bill.find({ workspaceId, billDate: { $gte: startDate, $lte: endDate }, status: { $ne: 'Cancelled' } }).lean()
          ]);

          for (const inv of periodInvoices) {
            salesTaxable += Number(inv.subTotal ?? inv.totalTaxable ?? 0);
            salesIgst += Number(inv.totalIgst || 0);
            salesCgst += Number(inv.totalCgst || 0);
            salesSgst += Number(inv.totalSgst || 0);
            salesCess += Number(inv.totalCess || 0);
            salesTotal += Number(inv.grandTotal || 0);
          }

          for (const b of periodBills) {
            purchTaxable += Number(b.subTotal ?? b.totalTaxable ?? 0);
            purchIgst += Number(b.totalIgst || 0);
            purchCgst += Number(b.totalCgst || 0);
            purchSgst += Number(b.totalSgst || 0);
            purchCess += Number(b.totalCess || 0);
            purchTotal += Number(b.grandTotal || 0);
          }
        }
      }

      const itcAmount = purchIgst + purchCgst + purchSgst + purchCess;
      const outwardTax = salesIgst + salesCgst + salesSgst + salesCess;
      const taxPayable = Math.max(0, outwardTax - itcAmount);

      returnData = {
        period: period || '',
        sales: {
          taxable: Math.round(salesTaxable * 100) / 100,
          igst: Math.round(salesIgst * 100) / 100,
          cgst: Math.round(salesCgst * 100) / 100,
          sgst: Math.round(salesSgst * 100) / 100,
          cess: Math.round(salesCess * 100) / 100,
          total: Math.round(salesTotal * 100) / 100
        },
        purchases: {
          taxable: Math.round(purchTaxable * 100) / 100,
          igst: Math.round(purchIgst * 100) / 100,
          cgst: Math.round(purchCgst * 100) / 100,
          sgst: Math.round(purchSgst * 100) / 100,
          cess: Math.round(purchCess * 100) / 100,
          total: Math.round(purchTotal * 100) / 100
        },
        itc: {
          available: Math.round(itcAmount * 100) / 100,
          claimed: Math.round(itcAmount * 100) / 100
        },
        taxPayable: Math.round(taxPayable * 100) / 100,
        updatedAt: new Date().toISOString(),
        source: 'books'
      };
    }

    // Fetch real business data from MongoDB for this active workspace
    let billing = {
      totalSales: 0,
      paidSales: 0,
      pendingSales: 0,
      invoiceCount: 0,
      totalPurchases: 0,
      paidPurchases: 0,
      pendingPurchases: 0,
      billCount: 0,
      customerCount: 0,
      recentInvoices: [],
      recentBills: []
    };

    if (workspaceId) {
      const [
        invoices,
        bills,
        customerCount,
        recentInvoices,
        recentBills
      ] = await Promise.all([
        Invoice.find({ workspaceId, status: { $ne: 'Cancelled' } }).select('grandTotal status').lean(),
        Bill.find({ workspaceId }).select('grandTotal status').lean(),
        Customer.countDocuments({ workspaceId }),
        Invoice.find({ workspaceId }).sort({ invoiceDate: -1, createdAt: -1 }).limit(5).lean(),
        Bill.find({ workspaceId }).sort({ billDate: -1, createdAt: -1 }).limit(5).lean()
      ]);

      let totalSales = 0;
      let paidSales = 0;
      let pendingSales = 0;
      for (const inv of invoices) {
        totalSales += inv.grandTotal || 0;
        if (inv.status === 'Paid') paidSales += inv.grandTotal || 0;
        if (inv.status === 'Draft' || inv.status === 'Sent' || inv.status === 'Overdue') {
          pendingSales += inv.grandTotal || 0;
        }
      }

      let totalPurchases = 0;
      let paidPurchases = 0;
      let pendingPurchases = 0;
      for (const b of bills) {
        totalPurchases += b.grandTotal || 0;
        if (b.status === 'Paid') paidPurchases += b.grandTotal || 0;
        if (b.status === 'Pending' || b.status === 'Draft' || b.status === 'Overdue') {
          pendingPurchases += b.grandTotal || 0;
        }
      }

      billing = {
        totalSales: Math.round(totalSales * 100) / 100,
        paidSales: Math.round(paidSales * 100) / 100,
        pendingSales: Math.round(pendingSales * 100) / 100,
        invoiceCount: invoices.length,
        totalPurchases: Math.round(totalPurchases * 100) / 100,
        paidPurchases: Math.round(paidPurchases * 100) / 100,
        pendingPurchases: Math.round(pendingPurchases * 100) / 100,
        billCount: bills.length,
        customerCount,
        recentInvoices,
        recentBills
      };
    }

    res.status(200).json({
      success: true,
      ...returnData,
      billing
    });
  } catch (error) {
    next(error);
  }
};
