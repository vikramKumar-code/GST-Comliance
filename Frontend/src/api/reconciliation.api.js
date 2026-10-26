import client from './client';

/**
 * Fetch ITC reconciliation comparing purchase bills against GSTR-2B
 * @param {string} period - Period in MMYYYY format (e.g. "092026")
 */
export const getItcReconciliation = async (period) => {
  return client.get('/reconciliation/itc', {
    params: { period },
  });
};

/**
 * Fetch GST refund and liability estimation
 * @param {string} period - Period in MMYYYY format (e.g. "092026")
 */
export const getRefundEstimate = async (period) => {
  return client.get('/reconciliation/refund-estimate', {
    params: { period },
  });
};
