import client from './client';

/**
 * Bulk import sales invoices
 * @param {Array<Object>} rows
 * @param {Object} options - { skipDuplicates?: boolean }
 */
export const importInvoices = async (rows, options = {}) => {
  return client.post('/import/invoices', { rows, options });
};

/**
 * Bulk import purchase bills
 * @param {Array<Object>} rows
 * @param {Object} options - { skipDuplicates?: boolean }
 */
export const importBills = async (rows, options = {}) => {
  return client.post('/import/bills', { rows, options });
};
