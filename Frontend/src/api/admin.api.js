import client from './client';

/**
 * Super Admin (Software Owner) API Client
 */

/**
 * Fetch platform-level metrics (MRR, users, workspaces, invoices)
 */
export const getAdminMetrics = async () => {
  return client.get('/admin/metrics');
};

/**
 * Fetch list of all workspaces across the platform
 */
export const getAdminWorkspaces = async (params = {}) => {
  return client.get('/admin/workspaces', { params });
};

/**
 * Update workspace status (1-Click Block / Activate)
 */
export const updateWorkspaceStatus = async (id, status, reason = '') => {
  return client.patch(`/admin/workspaces/${id}/status`, { status, reason });
};

/**
 * Update workspace subscription tier (Free, Pro, Enterprise)
 */
export const updateWorkspaceSubscription = async (id, data) => {
  return client.patch(`/admin/workspaces/${id}/subscription`, data);
};

/**
 * Impersonate or switch session into any workspace
 */
export const impersonateWorkspace = async (id) => {
  return client.post(`/admin/workspaces/${id}/impersonate`);
};

/**
 * Fetch list of all registered CAs and users
 */
export const getAdminUsers = async (params = {}) => {
  return client.get('/admin/users', { params });
};

/**
 * Update user account status or system role
 */
export const updateUserStatus = async (id, data) => {
  return client.patch(`/admin/users/${id}/status`, data);
};

/**
 * Fetch live real-time user & CA audit activities stream
 */
export const getAdminActivities = async (params = {}) => {
  return client.get('/admin/activities', { params });
};

/**
 * Fetch platform financials, Razorpay transactions, user purchase breakdown, and bank settlements
 */
export const getAdminFinancials = async (params = {}) => {
  return client.get('/admin/financials', { params });
};

/**
 * Trigger or record a bank withdrawal / payout
 */
export const createAdminBankWithdrawal = async (data) => {
  return client.post('/admin/bank-withdrawals', data);
};
