import client from './client';

/**
 * Fetch summary of filed returns and available periods
 * @param {string} period - Required period in MMYYYY format (e.g. "092026")
 * @returns {Promise<{ success: boolean, gstin: string, availablePeriods: Array<{ period: string, financialYear: string, gstr1: string, gstr2b: string, gstr3b: string }>, stale?: boolean }>}
 */
export const getReturnsSummary = async (period) => {
  return client.get('/returns/summary', {
    params: { period },
  });
};

/**
 * Fetch GSTR-1 sales data for a specific period
 * @param {string} period - Period in MMYYYY format
 * @returns {Promise<import('./types').ReturnData>}
 */
export const getGstr1 = async (period) => {
  return client.get('/returns/gstr1', {
    params: { period },
  });
};

/**
 * Fetch GSTR-2B inward supplies / eligible ITC data for a specific period
 * @param {string} period - Period in MMYYYY format
 * @returns {Promise<import('./types').ReturnData>}
 */
export const getGstr2b = async (period) => {
  return client.get('/returns/gstr2b', {
    params: { period },
  });
};

/**
 * Fetch GSTR-3B monthly tax summary & liability data for a specific period
 * @param {string} period - Period in MMYYYY format
 * @returns {Promise<import('./types').ReturnData>}
 */
export const getGstr3b = async (period) => {
  return client.get('/returns/gstr3b', {
    params: { period },
  });
};

/**
 * Fetch aggregate dashboard metrics for a period
 * @param {string} period - Period in MMYYYY format
 * @returns {Promise<import('./types').Dashboard>}
 */
export const getDashboard = async (period) => {
  return client.get('/dashboard', {
    params: { period },
  });
};

/**
 * Convenience helper to fetch return by return type (gstr1, gstr2b, gstr3b)
 * @param {'gstr1'|'gstr2b'|'gstr3b'|'GSTR1'|'GSTR2B'|'GSTR3B'} type
 * @param {string} period
 */
export const getReturnByType = async (type, period) => {
  const normalizedType = String(type).toLowerCase().replace(/[^a-z0-9]/g, '');
  switch (normalizedType) {
    case 'gstr1':
      return getGstr1(period);
    case 'gstr2b':
      return getGstr2b(period);
    case 'gstr3b':
      return getGstr3b(period);
    default:
      throw {
        code: 'VALIDATION_ERROR',
        message: `Unknown return type: ${type}. Expected gstr1, gstr2b, or gstr3b.`,
      };
  }
};

/**
 * Prepare GSTR-1 payload from workspace invoices for review
 * @param {string} period - Required period in MMYYYY format
 */
export const prepareGstr1 = async (period) => {
  return client.get('/returns/gstr1/prepare', {
    params: { period },
  });
};

/**
 * Save / Upload GSTR-1 payload to GSTN (or execute safe dry-run)
 * @param {string} period - Required period in MMYYYY format
 */
export const saveGstr1 = async (period) => {
  return client.post('/returns/gstr1/save', null, {
    params: { period },
  });
};
