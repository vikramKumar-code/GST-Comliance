const ImportService = require('../services/import.service');
const ApiError = require('../utils/apiError');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const logger = require('../utils/logger');

/**
 * Controller for Bulk Data Ingestion
 */
class ImportController {
  /**
   * POST /api/import/invoices
   */
  static async importInvoices(req, res, next) {
    try {
      const workspaceId = await resolveWorkspaceId(req);
      if (!workspaceId) {
        throw ApiError.unauthorized('Active workspace session is required.');
      }

      const { rows, options = {} } = req.body || {};
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Request body must contain a non-empty "rows" array.'
        });
      }

      const supplierGstin = req.gstin || req.session?.gstin || '';
      logger.info('Processing bulk invoice import', {
        workspaceId,
        rowCount: rows.length
      });

      const result = await ImportService.importInvoices(workspaceId, supplierGstin, rows, options);

      return res.status(200).json({
        status: 'success',
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
    try {
      const workspaceId = await resolveWorkspaceId(req);
      if (!workspaceId) {
        throw ApiError.unauthorized('Active workspace session is required.');
      }

      const { rows, options = {} } = req.body || {};
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Request body must contain a non-empty "rows" array.'
        });
      }

      const buyerGstin = req.gstin || req.session?.gstin || '';
      logger.info('Processing bulk bill import', {
        workspaceId,
        rowCount: rows.length
      });

      const result = await ImportService.importBills(workspaceId, buyerGstin, rows, options);

      return res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = ImportController;
