const Bill = require('../models/Bill');
const ApiError = require('../utils/apiError');
const { resolveWorkspaceId, escapeRegex } = require('../utils/workspaceHelper');

exports.listBills = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const { category, status, startDate, endDate, q, page = 1, limit = 50 } = req.query;
    const filter = { workspaceId };

    if (category) filter.category = String(category).trim();
    if (status) filter.status = String(status).trim();

    if (startDate || endDate) {
      filter.billDate = {};
      if (startDate) filter.billDate.$gte = new Date(startDate);
      if (endDate) filter.billDate.$lte = new Date(endDate);
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
    if (!bill) {
      throw ApiError.notFound('Bill not found in this workspace.');
    }

    res.status(200).json({
      success: true,
      data: bill
    });
  } catch (error) {
    next(error);
  }
};

exports.createBill = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const {
      billNumber,
      vendorName,
      vendorGstin = '',
      billDate,
      dueDate,
      category = 'Expense',
      lineItems = [],
      status = 'Pending',
      notes = ''
    } = req.body;

    if (!billNumber || !billNumber.trim()) {
      throw ApiError.validationError('Bill number is required.');
    }

    if (!vendorName || !vendorName.trim()) {
      throw ApiError.validationError('Vendor name is required.');
    }

    if (!lineItems || lineItems.length === 0) {
      throw ApiError.validationError('At least one bill item is required.');
    }

    let subTotal = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    const calculatedItems = lineItems.map((item) => {
      const quantity = Math.max(0, Number(item.quantity) || 1);
      const rate = Math.max(0, Number(item.rate) || 0);
      const taxableAmount = Math.round(quantity * rate * 100) / 100;
      const gstRate = Math.max(0, Number(item.gstRate) || 0);

      // Check Intra vs Inter based on vendor GSTIN
      const vendorState = vendorGstin && vendorGstin.length >= 2 ? vendorGstin.slice(0, 2) : '';
      const buyerState = req.gstin && req.gstin.length >= 2 ? req.gstin.slice(0, 2) : '';
      const isIntra = !vendorState || !buyerState || vendorState === buyerState;

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

    const bill = await Bill.create({
      workspaceId,
      billNumber: billNumber.trim(),
      vendorName: vendorName.trim(),
      vendorGstin: String(vendorGstin).trim().toUpperCase(),
      billDate: billDate ? new Date(billDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      category,
      lineItems: calculatedItems,
      subTotal,
      totalCgst,
      totalSgst,
      totalIgst,
      totalTax,
      grandTotal,
      status,
      notes: notes.trim()
    });

    res.status(201).json({
      success: true,
      data: bill
    });
  } catch (error) {
    next(error);
  }
};

exports.updateBill = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const bill = await Bill.findOne({ _id: req.params.id, workspaceId });
    if (!bill) {
      throw ApiError.notFound('Bill not found in this workspace.');
    }

    const {
      billNumber,
      vendorName,
      vendorGstin,
      billDate,
      dueDate,
      category,
      status,
      notes
    } = req.body;

    if (billNumber) bill.billNumber = billNumber.trim();
    if (vendorName) bill.vendorName = vendorName.trim();
    if (vendorGstin !== undefined) bill.vendorGstin = String(vendorGstin).trim().toUpperCase();
    if (billDate) bill.billDate = new Date(billDate);
    if (dueDate !== undefined) bill.dueDate = dueDate ? new Date(dueDate) : null;
    if (category) bill.category = category;
    if (status) bill.status = status;
    if (notes !== undefined) bill.notes = notes;

    await bill.save();

    res.status(200).json({
      success: true,
      data: bill
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteBill = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const deleted = await Bill.findOneAndDelete({ _id: req.params.id, workspaceId });
    if (!deleted) {
      throw ApiError.notFound('Bill not found in this workspace.');
    }

    res.status(200).json({
      success: true,
      message: 'Bill deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};
