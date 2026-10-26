import client from './client';

/**
 * Fetch GSTR-1 vs GSTR-3B tax comparison report for a period
 * @param {string} period MMYYYY format (e.g. "092026")
 */
export const getGstrComparison = async (period) => {
  return client.get('/reports/gstr-comparison', {
    params: { period },
  });
};

/**
 * Fetch Outward Sales Register for a date range
 * @param {Object} params { from?: string, to?: string }
 */
export const getSalesRegister = async (params = {}) => {
  return client.get('/reports/sales-register', {
    params,
  });
};

/**
 * Fetch Inward Purchase Register for a date range
 * @param {Object} params { from?: string, to?: string }
 */
export const getPurchaseRegister = async (params = {}) => {
  return client.get('/reports/purchase-register', {
    params,
  });
};
