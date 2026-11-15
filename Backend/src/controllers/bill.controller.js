const Bill = require('../models/Bill');
const AuditLog = require('../models/AuditLog'); // ✅ Added for financial tracking
const ApiError = require('../utils/apiError');
const { resolveWorkspaceId, escapeRegex } = require('../utils/workspaceHelper');

/**
 * Helper function to calculate line items and totals accurately.
 * Prevents code duplication between create and update operations.
 */
function calculateBillTotals(lineItems, vendorGstin, buyerGstin) {
  let subTotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  // Safely extract 2-digit state codes
  const vendorState = vendorGstin && String(vendorGstin).length >= 2 ? String(vendorGstin).slice(0, 2) : '';
  const buyerState = buyerGstin && String(buyerGstin).length >= 2 ? String(buyerGstin).slice(0, 2) : '';

  // Determine Intra vs Inter state
  const isIntra = !vendorState || !buyerState || vendorState === buyerState;

  const calculatedItems = lineItems.map((item) => {
    const quantity = Math.max(0, Number(item.quantity) || 1);
    const rate = Math.max(0, Number(item.rate) || 0);
    const taxableAmount = Math.round(quantity * rate * 100) / 100;
    const gstRate = Math.max(0, Number(item.gstRate) || 0);

    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    if (isIntra) {
      cgstAmount = Math.round((taxableAmount * ((gstRate / 2) / 100)) * 100) / 100;
      sgstAmount = Math.round((taxableAmount * ((gstRate / 2) / 100)) * 100) / 100;
    } else {
      igstAmount = Math.round((taxableAmount * (gstRate / 100)) * 100) / 100;
    }

    const totalTax = Math.round((cgstAmount + sgstAmount + igstAmount) * 100) / 100;
    const totalAmount = Math.round((taxableAmount + totalTax) * 100) / 100;

    subTotal += taxableAmount;
    totalCgst += cgstAmount;
    totalSgst += sgstAmount;
    totalIgst += igstAmount;

    return {
      description: item.description ? String(item.description).trim() : 'Expense item',
      hsnSac: item.hsnSac ? String(item.hsnSac).trim() : '',
      quantity,
      rate,
      taxableAmount,
      gstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      totalTax,
      totalAmount
    };
  });

  subTotal = Math.round(subTotal * 100) / 100;
  totalCgst = Math.round(totalCgst * 100) / 100;
  totalSgst = Math.round(totalSgst * 100) / 100;
  totalIgst = Math.round(totalIgst * 100) / 100;
  const totalTax = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100;
  const grandTotal = Math.round((subTotal + totalTax) * 100) / 100;

  return { calculatedItems, subTotal, totalCgst, totalSgst, totalIgst, totalTax, grandTotal };
}

exports.listBills = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const { category, status, startDate, endDate, q, page = 1, limit = 50 } = req.query;
    const filter = { workspaceId };

    if (category) filter.category = String(category).trim();
    if (status) filter.status = String(status).trim();

    // ✅ FIX 2: UTC Safe Date Filtering (Prevents off-by-one timezone errors)
    if (startDate || endDate) {
      filter.billDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        filter.billDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        filter.billDate.$lte = end;
      }
    }

    if (q) {
      const escaped = escapeRegex(String(q).trim());
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { billNumber: regex },
        { vendorName: regex },
        { vendorGstin: regex }
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Math.max(1, Number(limit)));
    const actualLimit = Math.min(100, Math.max(1, Number(limit)));

    const [bills, total] = await Promise.all([
      Bill.find(filter)
        .sort({ billDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(actualLimit)
        .lean(),
      Bill.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: bills,
      pagination: {
        page: Number(page),
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getBill = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const bill = await Bill.findOne({ _id: req.params.id, workspaceId }).lean();
    if (!bill) throw ApiError.notFound('Bill not found in this workspace.');

    res.status(200).json({ success: true, data: bill });
  } catch (error) {
    next(error);
  }
};

exports.createBill = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const {
      billNumber, vendorName, vendorGstin = '', billDate, dueDate,
      category = 'Expense', lineItems = [], status = 'Pending', notes = ''
    } = req.body;

    if (!billNumber || !billNumber.trim()) throw ApiError.validationError('Bill number is required.');
    if (!vendorName || !vendorName.trim()) throw ApiError.validationError('Vendor name is required.');
    if (!lineItems || lineItems.length === 0) throw ApiError.validationError('At least one bill item is required.');

    // Use helper function for calculation
    const totals = calculateBillTotals(lineItems, vendorGstin, req.gstin);

    const bill = await Bill.create({
      workspaceId,
      billNumber: billNumber.trim(),
      vendorName: vendorName.trim(),
      vendorGstin: String(vendorGstin).trim().toUpperCase(),
      billDate: billDate ? new Date(billDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      category,
      lineItems: totals.calculatedItems,
      subTotal: totals.subTotal,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      totalIgst: totals.totalIgst,
      totalTax: totals.totalTax,
      grandTotal: totals.grandTotal,
      status,
      notes: notes.trim()
    });

    // ✅ FIX 3: Audit Log
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || null,
      gstin: req.gstin || null,
      action: 'BILL_CREATE',
      status: 'SUCCESS',
      metadata: { billId: bill._id, billNumber: bill.billNumber, grandTotal: bill.grandTotal }
    }).catch(() => { });

    res.status(201).json({ success: true, data: bill });
  } catch (error) {
    next(error);
  }
};

exports.updateBill = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const bill = await Bill.findOne({ _id: req.params.id, workspaceId });
    if (!bill) throw ApiError.notFound('Bill not found in this workspace.');

    const { billNumber, vendorName, vendorGstin, billDate, dueDate, category, status, notes, lineItems } = req.body;

    if (billNumber) bill.billNumber = billNumber.trim();
    if (vendorName) bill.vendorName = vendorName.trim();
    if (vendorGstin !== undefined) bill.vendorGstin = String(vendorGstin).trim().toUpperCase();
    if (billDate) bill.billDate = new Date(billDate);
    if (dueDate !== undefined) bill.dueDate = dueDate ? new Date(dueDate) : null;
    if (category) bill.category = category;
    if (status) bill.status = status;
    if (notes !== undefined) bill.notes = notes;

    // ✅ FIX 1: Recalculate totals if lineItems or vendorGstin (state) changes
    if (lineItems || vendorGstin !== undefined) {
      const itemsToCalc = lineItems || bill.lineItems;
      const vendorToCalc = vendorGstin !== undefined ? vendorGstin : bill.vendorGstin;

      const totals = calculateBillTotals(itemsToCalc, vendorToCalc, req.gstin);

      bill.lineItems = totals.calculatedItems;
      bill.subTotal = totals.subTotal;
      bill.totalCgst = totals.totalCgst;
      bill.totalSgst = totals.totalSgst;
      bill.totalIgst = totals.totalIgst;
      bill.totalTax = totals.totalTax;
      bill.grandTotal = totals.grandTotal;
    }

    await bill.save();

    // ✅ FIX 3: Audit Log
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || null,
      gstin: req.gstin || null,
      action: 'BILL_UPDATE',
      status: 'SUCCESS',
      metadata: { billId: bill._id, billNumber: bill.billNumber }
    }).catch(() => { });

    res.status(200).json({ success: true, data: bill });
  } catch (error) {
    next(error);
  }
};

exports.deleteBill = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const deleted = await Bill.findOneAndDelete({ _id: req.params.id, workspaceId });
    if (!deleted) throw ApiError.notFound('Bill not found in this workspace.');

    // ✅ FIX 3: Audit Log
    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || null,
      gstin: req.gstin || null,
      action: 'BILL_DELETE',
      status: 'SUCCESS',
      metadata: { billId: deleted._id, billNumber: deleted.billNumber, vendorName: deleted.vendorName }
    }).catch(() => { });

    res.status(200).json({ success: true, message: 'Bill deleted successfully.' });
  } catch (error) {
    next(error);
  }
};