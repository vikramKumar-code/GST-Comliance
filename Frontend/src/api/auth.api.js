import client from './client';

/**
 * Search taxpayer details by GSTIN
 * @param {string} gstin - 15-character GSTIN
 * @returns {Promise<{ legalName: string, tradeName: string, status: string }>}
 */
export const searchGstin = async (gstin) => {
  return client.post('/gstin/search', { gstin });
};

/**
 * Request OTP for taxpayer verification
 * @param {Object} payload
 * @param {string} payload.gstin - 15-character GSTIN
 * @param {string} payload.username - Taxpayer username
 * @param {boolean} payload.consent - Mandatory taxpayer consent flag (must be true)
 * @returns {Promise<{ message: string }>}
 */
export const requestOtp = async ({ gstin, username, consent }) => {
  return client.post('/auth/otp/request', { gstin, username, consent });
};

/**
 * Verify OTP and establish session cookie
 * @param {Object} payload
 * @param {string} payload.gstin - 15-character GSTIN
 * @param {string} payload.username - Taxpayer username
 * @param {string} payload.otp - 4-8 digit OTP
 * @returns {Promise<{ gstin: string }>}
 */
export const verifyOtp = async ({ gstin, username, otp }) => {
  return client.post('/auth/otp/verify', { gstin, username, otp });
};

/**
 * Check active session and get current user info
 * @returns {Promise<{ gstin: string, expiresAt: string, user?: Object, workspaceId?: string }>}
 */
export const getMe = async () => {
  return client.get('/auth/me');
};

/**
 * Register a new user with email and password
 * @param {Object} payload
 * @param {string} payload.name
 * @param {string} payload.email
 * @param {string} payload.password
 * @returns {Promise<{ success: boolean, user: Object, currentWorkspace: Object|null }>}
 */
export const signup = async ({ name, email, password }) => {
  return client.post('/auth/signup', { name, email, password });
};

/**
 * Log in an existing user with email and password
 * @param {Object} payload
 * @param {string} payload.email
 * @param {string} payload.password
 * @returns {Promise<{ success: boolean, user: Object, currentWorkspace: Object|null }>}
 */
export const signin = async ({ email, password }) => {
  return client.post('/auth/signin', { email, password });
};

/**
 * Authenticate with Google OAuth 2.0 credential token
 * @param {string} idToken
 * @returns {Promise<{ success: boolean, user: Object, currentWorkspace: Object|null }>}
 */
export const googleAuth = async (idToken) => {
  return client.post('/auth/google', { idToken });
};

/**
 * List all workspaces/GSTINs accessible by the authenticated user
 * @returns {Promise<{ success: boolean, workspaces: Array<{ id: string, gstin: string, role: string, isCurrent: boolean }> }>}
 */
export const getWorkspaces = async () => {
  return client.get('/auth/workspaces');
};

/**
 * Switch active session context to another workspace
 * @param {string} workspaceId
 * @returns {Promise<{ success: boolean, currentWorkspace: { id: string, gstin: string, role: string } }>}
 */
export const switchWorkspace = async (workspaceId) => {
  return client.post('/auth/switch-workspace', { workspaceId });
};

/**
 * Link or update GSTIN for active organization workspace
 * @param {Object} payload
 * @param {string} payload.gstin - 15-character GSTIN
 * @param {string} [payload.name] - Organization name
 * @returns {Promise<{ success: boolean, message: string, workspace: Object }>}
 */
export const linkGstin = async ({ gstin, name }) => {
  return client.post('/auth/workspace/link-gstin', { gstin, name });
};

/**
 * Create a new workspace/organization
 * @param {Object} payload
 * @param {string} payload.name - Organization name
 * @param {string} [payload.gstin] - 15-character GSTIN
 * @returns {Promise<{ success: boolean, message: string, workspace: Object }>}
 */
export const createWorkspace = async ({ name, gstin }) => {
  return client.post('/auth/workspace/create', { name, gstin });
};


/**
 * Switch or update active member role (OWNER, ADMIN, MEMBER, VIEWER)
 * @param {string} role
 * @returns {Promise<{ success: boolean, message: string, role: string }>}
 */
export const switchRole = async (role) => {
  return client.post('/auth/workspace/switch-role', { role });
};

/**
 * Invalidate current session and clear auth cookie
 * @returns {Promise<{ ok: boolean }>}
 */
export const logout = async () => {
  return client.post('/auth/logout');
};



