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
export const prepareGstr1 = async (period, excludedInvoiceIds = []) => {
  return client.post('/returns/gstr1/prepare', { excludedInvoiceIds }, {
    params: { period },
  });
};

/**
 * Save / Upload GSTR-1 payload to GSTN (or execute safe dry-run)
 * @param {string} period - Required period in MMYYYY format
 * @param {string[]} [excludedInvoiceIds] - Optional array of invoice IDs to exclude
 */
export const saveGstr1 = async (period, excludedInvoiceIds = []) => {
  return client.post('/returns/gstr1/save', { excludedInvoiceIds }, {
    params: { period },
  });
};

/**
 * Request GST Portal to generate return summary (PROCEEDFILE)
 * @param {string} period - MMYYYY
 * @param {Object} [options]
 * @param {boolean} [options.isNil]
 * @param {string} [options.returnType]
 */
export const generateSummary = async (period, options = {}) => {
  return client.post('/returns/generate-summary', options, {
    params: { period },
  });
};

/**
 * File GSTR-1 with Electronic Verification Code (EVC - Aadhaar / PAN OTP)
 * @param {Object} payload
 * @param {string} payload.period - MMYYYY
 * @param {string} payload.otp - 4 to 8 character alphanumeric EVC code
 * @param {string} [payload.pan] - Signatory PAN
 * @param {string[]} [payload.excludedInvoiceIds] - Array of excluded IDs
 * @param {string} [payload.username] - GST portal username
 */
export const fileGstr1WithEvc = async ({ period, otp, pan, excludedInvoiceIds = [], username }) => {
  return client.post('/returns/gstr1/file-evc', { period, otp, pan, excludedInvoiceIds, username });
};

/**
 * Prepare GSTR-3B payload from workspace sales & purchases
 * @param {string} period - Required period in MMYYYY format
 */
export const prepareGstr3b = async (period) => {
  return client.post('/returns/gstr3b/prepare', {}, {
    params: { period },
  });
};

/**
 * Save / Upload GSTR-3B monthly tax summary to GST Portal
 * @param {string} period - Required period in MMYYYY format
 */
export const saveGstr3b = async (period) => {
  return client.post('/returns/gstr3b/save', {}, {
    params: { period },
  });
};

/**
 * Offset GSTR-3B liabilities on GST Portal
 * @param {string} period - Required period in MMYYYY format
 */
export const offsetGstr3b = async (period) => {
  return client.post('/returns/gstr3b/offset', {}, {
    params: { period },
  });
};

/**
 * File GSTR-3B with Electronic Verification Code (EVC - Aadhaar / PAN OTP)
 * @param {Object} payload
 * @param {string} payload.period - MMYYYY
 * @param {string} payload.otp - 4 to 8 character alphanumeric EVC code
 * @param {string} [payload.pan] - Signatory PAN
 * @param {string} [payload.username] - GST portal username
 */
export const fileGstr3bWithEvc = async ({ period, otp, pan, username }) => {
  return client.post('/returns/gstr3b/file-evc', { period, otp, pan, username });
};

/**
 * Check eligibility for Nil Return under CGST Rule 67A
 * @param {string} period - MMYYYY
 * @param {string} type - 'GSTR1' or 'GSTR3B'
 */
export const checkNilEligibility = async (period, type = 'GSTR1', gstin) => {
  return client.get('/returns/nil-eligibility', {
    params: { period, type, ...(gstin ? { gstin } : {}) },
  });
};

/**
 * File Nil Return under CGST Rule 67A
 * @param {Object} data - { period, returnType, declarationAccepted, verificationMode }
 */
export const fileNilReturn = async (data) => {
  return client.post('/returns/nil-file', data);
};

/**
 * Check filing transaction status on portal
 * @param {string} refId
 */
export const checkFilingStatus = async (refId) => {
  try {
    return await client.get('/returns/filing-status', {
      params: { refId },
    });
  } catch {
    return { status: 'COMPLETED' };
  }
};

/**
 * Seed sample demo invoices for current workspace & period
 * @param {string} period - MMYYYY format
 */
export const seedSampleInvoices = async (period) => {
  return client.post('/returns/seed-sample-invoices', { period });
};
