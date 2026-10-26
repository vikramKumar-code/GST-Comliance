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

    // Fetch GST returns breakdown
    const returnData = await ReturnService.getDashboard(req.gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: req.username,
      workspaceId,
      sessionId: req.session._id
    });

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
