const Invoice = require('../models/Invoice');
const ApiError = require('../utils/apiError');
const { calculateInvoiceTotals, extractStateCode } = require('../utils/taxCalculator');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const { isValidGstin } = require('../utils/gstin');
const einvoiceService = require('../services/einvoice.service');

/**
 * Generates the next sequential invoice number for a workspace
 */
async function generateNextInvoiceNumber(workspaceId) {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `INV-${yearMonth}-`;
  
  const lastInvoice = await Invoice.findOne({
    workspaceId,
    invoiceNumber: new RegExp(`^${prefix}`)
  }).sort({ invoiceNumber: -1 }).lean();

  let nextSeq = 1;
  if (lastInvoice && lastInvoice.invoiceNumber) {
    const parts = lastInvoice.invoiceNumber.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) {
      nextSeq = lastNum + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

exports.listInvoices = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const { status, customerId, startDate, endDate, q, page = 1, limit = 50 } = req.query;
    const filter = { workspaceId };

    if (status) filter.status = status;
    if (customerId) filter.customerId = customerId;

    if (startDate || endDate) {
      filter.invoiceDate = {};
      if (startDate) filter.invoiceDate.$gte = new Date(startDate);
      if (endDate) filter.invoiceDate.$lte = new Date(endDate);
    }

    if (q) {
      const regex = new RegExp(String(q).trim(), 'i');
      filter.$or = [
        { invoiceNumber: regex },
        { customerName: regex },
        { customerGstin: regex }
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Math.max(1, Number(limit)));
    const actualLimit = Math.min(100, Math.max(1, Number(limit)));

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .sort({ invoiceDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(actualLimit)
        .lean(),
      Invoice.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: invoices,
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

exports.getInvoice = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const invoice = await Invoice.findOne({ _id: req.params.id, workspaceId }).lean();
    if (!invoice) {
      throw ApiError.notFound('Invoice not found in this workspace.');
    }

    res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    next(error);
  }
};

exports.createInvoice = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const {
      invoiceNumber: customNumber,
      invoiceDate,
      dueDate,
      customerId,
      customerName,
      customerGstin,
      placeOfSupply,
      billingAddress,
      lineItems = [],
      status = 'Draft',
      notes,
      terms
    } = req.body;

    if (!customerName || !customerName.trim()) {
      throw ApiError.validationError('Customer name is required.');
    }

    if (!lineItems || lineItems.length === 0) {
      throw ApiError.validationError('At least one line item is required.');
    }

    const sellerGstin = req.gstin || '';
    const cleanCustomerGstin = customerGstin ? String(customerGstin).trim().toUpperCase() : '';

    if (cleanCustomerGstin && !isValidGstin(cleanCustomerGstin)) {
      throw ApiError.validationError('Customer GSTIN is invalid. According to GST rules, a GSTIN must be exactly 15 alphanumeric characters (e.g. 29ABCDE1234F1Z5) or left blank for unregistered (B2C) sales.');
    }
    
    // Resolve Place of Supply (POS)
    let resolvedPos = placeOfSupply ? String(placeOfSupply).trim() : '';
    if (!resolvedPos && cleanCustomerGstin.length >= 2) {
      resolvedPos = cleanCustomerGstin.slice(0, 2);
    }
    if (!resolvedPos && sellerGstin.length >= 2) {
      resolvedPos = sellerGstin.slice(0, 2);
    }

    // Calculate line items and totals
    const calculation = calculateInvoiceTotals(lineItems, sellerGstin, resolvedPos);

    let finalInvoiceNumber = customNumber ? String(customNumber).trim().toUpperCase() : '';
    if (finalInvoiceNumber) {
      if (finalInvoiceNumber.length > 16) {
        throw ApiError.validationError('Invoice number cannot exceed 16 characters as per Rule 46(b) of CGST Rules.');
      }
      const existing = await Invoice.findOne({ workspaceId, invoiceNumber: finalInvoiceNumber });
      if (existing) {
        throw ApiError.validationError(`Invoice number "${finalInvoiceNumber}" already exists.`);
      }
    } else {
      finalInvoiceNumber = await generateNextInvoiceNumber(workspaceId);
    }

    const invoice = await Invoice.create({
      workspaceId,
      invoiceNumber: finalInvoiceNumber,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      customerId: customerId || null,
      customerName: customerName.trim(),
      customerGstin: cleanCustomerGstin,
      placeOfSupply: extractStateCode(resolvedPos),
      billingAddress: billingAddress || {},
      lineItems: calculation.calculatedItems,
      subTotal: calculation.subTotal,
      totalCgst: calculation.totalCgst,
      totalSgst: calculation.totalSgst,
      totalIgst: calculation.totalIgst,
      totalTax: calculation.totalTax,
      grandTotal: calculation.grandTotal,
      status: status || 'Draft',
      notes: notes !== undefined ? notes : 'Thanks for your business.',
      terms: terms !== undefined ? terms : 'Payment due upon receipt.'
    });

    res.status(201).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    next(error);
  }
};

exports.updateInvoice = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const invoice = await Invoice.findOne({ _id: req.params.id, workspaceId });
    if (!invoice) {
      throw ApiError.notFound('Invoice not found in this workspace.');
    }

    const {
      invoiceNumber: customNumber,
      customerId,
      customerName,
      customerGstin,
      placeOfSupply,
      invoiceDate,
      dueDate,
      billingAddress,
      lineItems,
      status,
      notes,
      terms
    } = req.body;

    if (customNumber && customNumber.trim().toUpperCase() !== invoice.invoiceNumber) {
      const newNum = customNumber.trim().toUpperCase();
      if (newNum.length > 16) {
        throw ApiError.validationError('Invoice number cannot exceed 16 characters as per Rule 46(b) of CGST Rules.');
      }
      const existing = await Invoice.findOne({ workspaceId, invoiceNumber: newNum, _id: { $ne: invoice._id } });
      if (existing) {
        throw ApiError.validationError(`Invoice number "${newNum}" already exists.`);
      }
      invoice.invoiceNumber = newNum;
    }

    if (customerName) invoice.customerName = customerName.trim();
    if (customerGstin !== undefined) {
      const cleanGstin = String(customerGstin).trim().toUpperCase();
      if (cleanGstin && !isValidGstin(cleanGstin)) {
        throw ApiError.validationError('Customer GSTIN is invalid. According to GST rules, a GSTIN must be exactly 15 alphanumeric characters (e.g. 29ABCDE1234F1Z5) or left blank for unregistered (B2C) sales.');
      }
      invoice.customerGstin = cleanGstin;
    }
    if (customerId !== undefined) invoice.customerId = customerId || null;
    if (invoiceDate) invoice.invoiceDate = new Date(invoiceDate);
    if (dueDate !== undefined) invoice.dueDate = dueDate ? new Date(dueDate) : null;
    if (billingAddress) invoice.billingAddress = billingAddress;
    if (status) invoice.status = status;
    if (notes !== undefined) invoice.notes = notes;
    if (terms !== undefined) invoice.terms = terms;

    const sellerGstin = req.gstin || '';
    if (placeOfSupply) {
      invoice.placeOfSupply = extractStateCode(placeOfSupply);
    }

    if (lineItems && lineItems.length > 0) {
      const calculation = calculateInvoiceTotals(lineItems, sellerGstin, invoice.placeOfSupply);
      invoice.lineItems = calculation.calculatedItems;
      invoice.subTotal = calculation.subTotal;
      invoice.totalCgst = calculation.totalCgst;
      invoice.totalSgst = calculation.totalSgst;
      invoice.totalIgst = calculation.totalIgst;
      invoice.totalTax = calculation.totalTax;
      invoice.grandTotal = calculation.grandTotal;
    }

    if (invoice.einvoiceStatus === 'Failed') {
      invoice.einvoiceStatus = 'Not Generated';
      invoice.einvoiceError = '';
    }

    await invoice.save();

    res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteInvoice = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const deleted = await Invoice.findOneAndDelete({ _id: req.params.id, workspaceId });
    if (!deleted) {
      throw ApiError.notFound('Invoice not found in this workspace.');
    }

    res.status(200).json({
      success: true,
      message: 'Invoice deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

exports.generateEInvoice = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const updatedInvoice = await einvoiceService.generateIrn(req.params.id, workspaceId);

    res.status(200).json({
      success: true,
      message: 'E-Invoice (IRN) generated successfully.',
      data: updatedInvoice
    });
  } catch (error) {
    next(error);
  }
};

exports.cancelEInvoice = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const { reasonCode = '1', remarks = 'Order cancelled' } = req.body;
    const updatedInvoice = await einvoiceService.cancelIrn(req.params.id, workspaceId, { reasonCode, remarks });

    res.status(200).json({
      success: true,
      message: 'E-Invoice (IRN) cancelled successfully.',
      data: updatedInvoice
    });
  } catch (error) {
    next(error);
  }
};

exports.generateEwayBill = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const updatedInvoice = await einvoiceService.generateEwayBill(req.params.id, workspaceId, req.body);

    res.status(200).json({
      success: true,
      message: 'E-Way Bill generated successfully.',
      data: updatedInvoice
    });
  } catch (error) {
    next(error);
  }
};

