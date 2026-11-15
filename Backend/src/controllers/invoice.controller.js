const Invoice = require('../models/Invoice');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { calculateInvoiceTotals, extractStateCode } = require('../utils/taxCalculator');
const { resolveWorkspaceId, escapeRegex } = require('../utils/workspaceHelper');
const { isValidGstin } = require('../utils/gstin');
const einvoiceService = require('../services/einvoice.service');

// ✅ Helper: Clean line item strings to prevent trailing spaces in JSON
function cleanLineItems(items) {
  return (items || []).map(item => ({
    ...item,
    name: item.name ? String(item.name).trim() : '',
    description: item.description ? String(item.description).trim() : '',
    hsnSac: item.hsnSac ? String(item.hsnSac).trim() : '',
    unit: item.unit ? String(item.unit).trim().toUpperCase() : 'PCS',
    taxPreference: item.taxPreference ? String(item.taxPreference).toUpperCase() : 'TAXABLE'
  }));
}

// ✅ Helper: Clean billing address strings
function cleanAddress(addr) {
  if (!addr || typeof addr !== 'object') return {};
  return {
    street: addr.street ? String(addr.street).trim() : '',
    city: addr.city ? String(addr.city).trim() : '',
    state: addr.state ? String(addr.state).trim() : '',
    stateCode: addr.stateCode ? String(addr.stateCode).trim().slice(0, 2) : '',
    pincode: addr.pincode ? String(addr.pincode).trim().slice(0, 6) : '',
    country: addr.country ? String(addr.country).trim() : 'India'
  };
}

/**
 * Generates the next sequential invoice number for a workspace
 */
async function generateNextInvoiceNumber(workspaceId) {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `INV-${yearMonth}-`;

  const lastInvoice = await Invoice.findOne({
    workspaceId,
    invoiceNumber: new RegExp(`^${escapeRegex(prefix)}`)
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

    if (status) filter.status = String(status).trim();
    if (customerId) filter.customerId = String(customerId).trim();

    if (startDate || endDate) {
      filter.invoiceDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        filter.invoiceDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        filter.invoiceDate.$lte = end;
      }
    }

    if (q) {
      const escaped = escapeRegex(String(q).trim());
      const regex = new RegExp(escaped, 'i');
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
    if (!invoice) throw ApiError.notFound('Invoice not found in this workspace.');

    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

exports.createInvoice = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const {
      invoiceNumber: customNumber, invoiceDate, dueDate, customerId,
      customerName, customerGstin, placeOfSupply, billingAddress,
      lineItems = [], status = 'Draft', notes, terms,
      isReverseCharge, isExport, exportType
    } = req.body;

    if (!customerName || !customerName.trim()) throw ApiError.validationError('Customer name is required.');
    if (!lineItems || lineItems.length === 0) throw ApiError.validationError('At least one line item is required.');

    const sellerGstin = req.gstin || '';
    const cleanCustomerGstin = customerGstin ? String(customerGstin).trim().toUpperCase() : '';

    if (cleanCustomerGstin && !isValidGstin(cleanCustomerGstin)) {
      throw ApiError.validationError('Customer GSTIN is invalid. Must be 15 alphanumeric characters or blank for B2C.');
    }

    // ✅ Resolve and clean Place of Supply (POS)
    let resolvedPos = placeOfSupply ? String(placeOfSupply).trim() : '';
    if (!resolvedPos && cleanCustomerGstin.length >= 2) resolvedPos = cleanCustomerGstin.slice(0, 2);
    if (!resolvedPos && sellerGstin.length >= 2) resolvedPos = sellerGstin.slice(0, 2);

    const cleanPos = extractStateCode(resolvedPos);

    // ✅ Clean line items to prevent trailing spaces in JSON
    const cleanedLineItems = cleanLineItems(lineItems);
    const calculation = calculateInvoiceTotals(cleanedLineItems, sellerGstin, cleanPos);

    let finalInvoiceNumber = customNumber ? String(customNumber).trim().toUpperCase() : '';
    if (finalInvoiceNumber) {
      if (finalInvoiceNumber.length > 16) throw ApiError.validationError('Invoice number cannot exceed 16 characters (Rule 46(b)).');
      const existing = await Invoice.findOne({ workspaceId, invoiceNumber: finalInvoiceNumber });
      if (existing) throw ApiError.validationError(`Invoice number "${finalInvoiceNumber}" already exists.`);
    } else {
      finalInvoiceNumber = await generateNextInvoiceNumber(workspaceId);
    }

    const invoiceData = {
      workspaceId,
      invoiceNumber: finalInvoiceNumber,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      customerId: customerId || null,
      customerName: customerName.trim(),
      customerGstin: cleanCustomerGstin,
      placeOfSupply: cleanPos,
      billingAddress: cleanAddress(billingAddress),
      lineItems: calculation.calculatedItems,
      subTotal: calculation.subTotal,
      totalCgst: calculation.totalCgst,
      totalSgst: calculation.totalSgst,
      totalIgst: calculation.totalIgst,
      totalTax: calculation.totalTax,
      grandTotal: calculation.grandTotal,
      status: status || 'Draft',
      notes: notes !== undefined ? String(notes).trim() : 'Thanks for your business.',
      terms: terms !== undefined ? String(terms).trim() : 'Payment due upon receipt.',
      isReverseCharge: Boolean(isReverseCharge),
      isExport: Boolean(isExport),
      exportType: exportType ? String(exportType).trim().toUpperCase() : ''
    };

    let invoice;
    try {
      invoice = await Invoice.create(invoiceData);
    } catch (dbError) {
      if (dbError.code === 11000) {
        throw ApiError.validationError(`Invoice number "${finalInvoiceNumber}" was generated concurrently and already exists. Please try again or use a custom number.`);
      }
      throw dbError;
    }

    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      gstin: sellerGstin || null,
      action: 'INVOICE_CREATE',
      status: 'SUCCESS',
      metadata: { invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, grandTotal: calculation.grandTotal }
    }).catch(() => { });

    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

exports.updateInvoice = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const invoice = await Invoice.findOne({ _id: req.params.id, workspaceId });
    if (!invoice) throw ApiError.notFound('Invoice not found in this workspace.');

    const {
      invoiceNumber: customNumber, customerId, customerName, customerGstin,
      placeOfSupply, invoiceDate, dueDate, billingAddress, lineItems, status, notes, terms,
      isReverseCharge, isExport, exportType
    } = req.body;

    let needsTaxRecalculation = false;
    let currentPos = invoice.placeOfSupply;

    if (customNumber && customNumber.trim().toUpperCase() !== invoice.invoiceNumber) {
      const newNum = customNumber.trim().toUpperCase();
      if (newNum.length > 16) throw ApiError.validationError('Invoice number cannot exceed 16 characters.');
      const existing = await Invoice.findOne({ workspaceId, invoiceNumber: newNum, _id: { $ne: invoice._id } });
      if (existing) throw ApiError.validationError(`Invoice number "${newNum}" already exists.`);
      invoice.invoiceNumber = newNum;
    }

    if (customerName) invoice.customerName = customerName.trim();
    if (customerId !== undefined) invoice.customerId = customerId || null;
    if (invoiceDate) invoice.invoiceDate = new Date(invoiceDate);
    if (dueDate !== undefined) invoice.dueDate = dueDate ? new Date(dueDate) : null;
    if (billingAddress) invoice.billingAddress = cleanAddress(billingAddress);
    if (status) invoice.status = status;
    if (notes !== undefined) invoice.notes = String(notes).trim();
    if (terms !== undefined) invoice.terms = String(terms).trim();
    if (isReverseCharge !== undefined) invoice.isReverseCharge = Boolean(isReverseCharge);
    if (isExport !== undefined) invoice.isExport = Boolean(isExport);
    if (exportType !== undefined) invoice.exportType = String(exportType).trim().toUpperCase();

    if (customerGstin !== undefined) {
      const cleanGstin = String(customerGstin).trim().toUpperCase();
      if (cleanGstin && !isValidGstin(cleanGstin)) throw ApiError.validationError('Customer GSTIN is invalid.');
      if (invoice.customerGstin !== cleanGstin) {
        invoice.customerGstin = cleanGstin;
        needsTaxRecalculation = true;
      }
    }

    if (placeOfSupply) {
      const newPos = extractStateCode(placeOfSupply);
      if (invoice.placeOfSupply !== newPos) {
        invoice.placeOfSupply = newPos;
        currentPos = newPos;
        needsTaxRecalculation = true;
      }
    }

    if (lineItems && lineItems.length > 0) {
      invoice.lineItems = cleanLineItems(lineItems);
      needsTaxRecalculation = true;
    }

    if (needsTaxRecalculation) {
      const sellerGstin = req.gstin || '';
      const calculation = calculateInvoiceTotals(invoice.lineItems, sellerGstin, currentPos);

      invoice.lineItems = calculation.calculatedItems;
      invoice.subTotal = calculation.subTotal;
      invoice.totalCgst = calculation.totalCgst;
      invoice.totalSgst = calculation.totalSgst;
      invoice.totalIgst = calculation.totalIgst;
      invoice.totalTax = calculation.totalTax;
      invoice.grandTotal = calculation.grandTotal;

      if (invoice.einvoiceStatus === 'Generated') {
        invoice.einvoiceStatus = 'Not Generated';
        invoice.irn = '';
        invoice.einvoiceError = 'Invoice modified after IRN generation. Please regenerate.';
      }
    }

    await invoice.save();

    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      gstin: req.gstin || null,
      action: 'INVOICE_UPDATE',
      status: 'SUCCESS',
      metadata: { invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, grandTotal: invoice.grandTotal }
    }).catch(() => { });

    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

exports.deleteInvoice = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');

    const deleted = await Invoice.findOneAndDelete({ _id: req.params.id, workspaceId });
    if (!deleted) throw ApiError.notFound('Invoice not found in this workspace.');

    await AuditLog.create({
      workspaceId,
      userId: req.user?._id || req.userId || null,
      gstin: req.gstin || null,
      action: 'INVOICE_DELETE',
      status: 'SUCCESS',
      metadata: { invoiceId: deleted._id, invoiceNumber: deleted.invoiceNumber, customerName: deleted.customerName, grandTotal: deleted.grandTotal }
    }).catch(() => { });

    res.status(200).json({ success: true, message: 'Invoice deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

exports.generateEInvoice = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');
    const updatedInvoice = await einvoiceService.generateIrn(req.params.id, workspaceId);
    res.status(200).json({ success: true, message: 'E-Invoice (IRN) generated successfully.', data: updatedInvoice });
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
    res.status(200).json({ success: true, message: 'E-Invoice (IRN) cancelled successfully.', data: updatedInvoice });
  } catch (error) {
    next(error);
  }
};

exports.generateEwayBill = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) throw ApiError.unauthorized('Workspace context is required.');
    const updatedInvoice = await einvoiceService.generateEwayBill(req.params.id, workspaceId, req.body);
    res.status(200).json({ success: true, message: 'E-Way Bill generated successfully.', data: updatedInvoice });
  } catch (error) {
    next(error);
  }
};