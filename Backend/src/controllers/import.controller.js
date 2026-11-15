const ImportService = require('../services/import.service');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const logger = require('../utils/logger');

// ✅ FIX 1: Hard limit to prevent Memory Exhaustion / DoS attacks
const MAX_BULK_IMPORT_ROWS = 5000;

/**
 * Deep sanitizer function to normalize parsed spreadsheet data
 * Removes trailing spaces, enforces uppercase for GSTIN/HSN, validates enums, 
 * and ensures numbers are actually numbers.
 */
function sanitizeImportRow(row) {
  if (!row || typeof row !== 'object') return row;

  const cleaned = { ...row };

  // 1. Clean top-level strings
  if (typeof cleaned.invoiceNumber === 'string') {
    cleaned.invoiceNumber = cleaned.invoiceNumber.trim().toUpperCase();
  }
  if (typeof cleaned.customerName === 'string') {
    cleaned.customerName = cleaned.customerName.trim();
  }
  if (typeof cleaned.customerGstin === 'string') {
    let gstin = cleaned.customerGstin.trim().toUpperCase();
    // Normalize unregistered customer placeholders into empty strings
    if (['UNREGISTERED', 'URP', 'NA', 'N/A', ''].includes(gstin)) {
      cleaned.customerGstin = '';
    } else {
      cleaned.customerGstin = gstin;
    }
  }
  if (typeof cleaned.placeOfSupply === 'string') {
    const posStr = cleaned.placeOfSupply.trim();
    const match = posStr.match(/^([0-9]{2})/);
    cleaned.placeOfSupply = match ? match[1] : (posStr.slice(0, 2).toUpperCase() || '00');
  }
  if (typeof cleaned.documentType === 'string') {
    const docType = cleaned.documentType.trim().toUpperCase();
    // Enforce strict enum values
    if (['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(docType)) {
      cleaned.documentType = docType;
    } else {
      cleaned.documentType = 'INVOICE'; // Safe default
    }
  }

  // 2. Clean and validate line items
  if (Array.isArray(cleaned.lineItems)) {
    cleaned.lineItems = cleaned.lineItems.map(item => {
      if (!item || typeof item !== 'object') return item;
      const cleanItem = { ...item };

      if (typeof cleanItem.name === 'string') cleanItem.name = cleanItem.name.trim();
      if (typeof cleanItem.description === 'string') cleanItem.description = cleanItem.description.trim();
      if (typeof cleanItem.hsnSac === 'string') cleanItem.hsnSac = cleanItem.hsnSac.trim().toUpperCase();
      if (typeof cleanItem.unit === 'string') cleanItem.unit = cleanItem.unit.trim().toUpperCase() || 'PCS';

      if (typeof cleanItem.taxPreference === 'string') {
        const pref = cleanItem.taxPreference.trim().toUpperCase();
        // Enforce strict enum values for Table 8 classification
        if (['TAXABLE', 'NIL', 'EXEMPT', 'NON_GST'].includes(pref)) {
          cleanItem.taxPreference = pref;
        } else {
          cleanItem.taxPreference = 'TAXABLE'; // Safe default
        }
      }

      // Coerce strings into numerical values
      cleanItem.quantity = Number(cleanItem.quantity) || 0;
      cleanItem.rate = Number(cleanItem.rate) || 0;
      cleanItem.discount = Number(cleanItem.discount) || 0;
      cleanItem.taxableAmount = Number(cleanItem.taxableAmount) || 0;
      cleanItem.gstRate = Number(cleanItem.gstRate) || 0;
      cleanItem.igstAmount = Number(cleanItem.igstAmount) || 0;
      cleanItem.cgstAmount = Number(cleanItem.cgstAmount) || 0;
      cleanItem.sgstAmount = Number(cleanItem.sgstAmount) || 0;
      cleanItem.totalTax = Number(cleanItem.totalTax) || 0;
      cleanItem.totalAmount = Number(cleanItem.totalAmount) || 0;

      return cleanItem;
    });
  }

  // 3. Clean top-level numeric totals
  cleaned.subTotal = Number(cleaned.subTotal) || 0;
  cleaned.totalIgst = Number(cleaned.totalIgst) || 0;
  cleaned.totalCgst = Number(cleaned.totalCgst) || 0;
  cleaned.totalSgst = Number(cleaned.totalSgst) || 0;
  cleaned.totalTax = Number(cleaned.totalTax) || 0;
  cleaned.grandTotal = Number(cleaned.grandTotal) || 0;

  return cleaned;
}

class ImportController {
  /**
   * POST /api/import/invoices
   */
  static async importInvoices(req, res, next) {
    const startTime = Date.now();
    try {
      const workspaceId = await resolveWorkspaceId(req);
      if (!workspaceId) throw ApiError.unauthorized('Active workspace session is required.');

      const { rows, options = {} } = req.body || {};

      if (!Array.isArray(rows) || rows.length === 0) {
        throw ApiError.validationError('Request body must contain a non-empty "rows" array.');
      }

      if (rows.length > MAX_BULK_IMPORT_ROWS) {
        throw ApiError.validationError(
          `Bulk import is limited to ${MAX_BULK_IMPORT_ROWS} rows per request to ensure system stability. Please split your file into smaller batches.`
        );
      }

      const supplierGstin = req.gstin || req.session?.gstin || '';

      logger.info('Processing bulk invoice import', {
        workspaceId,
        userId: req.user?._id,
        rowCount: rows.length
      });

      // ✅ FIX 3: Sanitize ALL rows before passing to service
      const sanitizedRows = rows.map(sanitizeImportRow);

      const result = await ImportService.importInvoices(workspaceId, supplierGstin, sanitizedRows, options);

      const durationMs = Date.now() - startTime;
      logger.info('Bulk invoice import completed', {
        workspaceId,
        totalRows: rows.length,
        successCount: result.successCount || 0,
        failedCount: result.failedCount || 0,
        durationMs
      });

      // ✅ FIX 4: Audit Log for compliance and dispute resolution
      await AuditLog.create({
        workspaceId,
        userId: req.user?._id || null,
        gstin: supplierGstin,
        action: 'BULK_IMPORT_INVOICES',
        status: (result.failedCount > 0 && result.successCount === 0) ? 'FAILURE' : 'SUCCESS',
        ipAddress: req.ip || null,
        metadata: {
          totalRows: rows.length,
          successCount: result.successCount || 0,
          failedCount: result.failedCount || 0,
          durationMs
        }
      }).catch(() => { });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/import/bills
   */
  static async importBills(req, res, next) {
    const startTime = Date.now();
    try {
      const workspaceId = await resolveWorkspaceId(req);
      if (!workspaceId) throw ApiError.unauthorized('Active workspace session is required.');

      const { rows, options = {} } = req.body || {};

      if (!Array.isArray(rows) || rows.length === 0) {
        throw ApiError.validationError('Request body must contain a non-empty "rows" array.');
      }

      if (rows.length > MAX_BULK_IMPORT_ROWS) {
        throw ApiError.validationError(
          `Bulk import is limited to ${MAX_BULK_IMPORT_ROWS} rows per request to ensure system stability. Please split your file into smaller batches.`
        );
      }

      const buyerGstin = req.gstin || req.session?.gstin || '';

      logger.info('Processing bulk bill import', {
        workspaceId,
        userId: req.user?._id,
        rowCount: rows.length
      });

      // ✅ FIX 3: Sanitize ALL rows before passing to service
      const sanitizedRows = rows.map(sanitizeImportRow);

      const result = await ImportService.importBills(workspaceId, buyerGstin, sanitizedRows, options);

      const durationMs = Date.now() - startTime;
      logger.info('Bulk bill import completed', {
        workspaceId,
        totalRows: rows.length,
        successCount: result.successCount || 0,
        failedCount: result.failedCount || 0,
        durationMs
      });

      // ✅ FIX 4: Audit Log
      await AuditLog.create({
        workspaceId,
        userId: req.user?._id || null,
        gstin: buyerGstin,
        action: 'BULK_IMPORT_BILLS',
        status: (result.failedCount > 0 && result.successCount === 0) ? 'FAILURE' : 'SUCCESS',
        ipAddress: req.ip || null,
        metadata: {
          totalRows: rows.length,
          successCount: result.successCount || 0,
          failedCount: result.failedCount || 0,
          durationMs
        }
      }).catch(() => { });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = ImportController;