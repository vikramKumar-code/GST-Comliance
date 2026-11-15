const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const { isValidGstin } = require('./gstin');
const logger = require('./logger');

/**
 * Resolves the workspace ObjectId for the current request.
 * 
 * Resolution Priority:
 * 1. Explicit req.workspaceId (set by middleware or route param)
 * 2. User's active membership (most recent if multiple)
 * 3. Find or create workspace by verified GSTIN
 * 
 * @param {Object} req - Express request object
 * @returns {Promise<ObjectId|null>} Workspace ObjectId or null
 */
async function resolveWorkspaceId(req) {
  try {
    // Priority 1: Explicit workspace ID (highest priority)
    if (req.workspaceId) {
      const ws = await Workspace.findById(req.workspaceId).select('status').lean();
      if (!ws) {
        logger.warn('[WorkspaceHelper] Explicit workspaceId not found', { workspaceId: req.workspaceId });
        return null;
      }
      if (ws.status === 'SUSPENDED') {
        logger.warn('[WorkspaceHelper] Workspace is suspended', { workspaceId: req.workspaceId });
        return null; // Don't allow operations on suspended workspaces
      }
      return req.workspaceId;
    }

    // Priority 2: User's active membership
    if (req.userId) {
      const member = await WorkspaceMember.findOne({
        userId: req.userId,
        status: 'ACTIVE'
      })
        .sort({ updatedAt: -1 }) // Most recently used workspace
        .populate('workspaceId', 'status')
        .lean();

      if (member && member.workspaceId) {
        if (member.workspaceId.status === 'SUSPENDED') {
          logger.warn('[WorkspaceHelper] User workspace is suspended', {
            userId: req.userId,
            workspaceId: member.workspaceId._id
          });
          return null;
        }
        return member.workspaceId._id;
      }
    }

    // Priority 3: Find or create workspace by GSTIN
    if (req.gstin) {
      // ✅ FIX 2: Validate GSTIN before using it
      if (!isValidGstin(req.gstin)) {
        logger.warn('[WorkspaceHelper] Invalid GSTIN provided', { gstin: req.gstin });
        return null;
      }

      const normalizedGstin = req.gstin.trim().toUpperCase();

      // ✅ FIX 1: Use findOne to avoid race condition
      // If multiple requests come simultaneously, only first will create
      let ws = await Workspace.findOne({ gstin: normalizedGstin }).lean();

      if (ws) {
        // ✅ FIX 3: Check workspace status
        if (ws.status === 'SUSPENDED') {
          logger.warn('[WorkspaceHelper] GSTIN workspace is suspended', { gstin: normalizedGstin });
          return null;
        }
        return ws._id;
      }

      // Create new workspace (only if not exists)
      try {
        const newWs = await Workspace.create({
          gstin: normalizedGstin,
          status: 'ACTIVE',
          name: 'New Workspace', // Default name, user can update later
          createdAt: new Date()
        });

        logger.info('[WorkspaceHelper] Created new workspace', {
          workspaceId: newWs._id,
          gstin: normalizedGstin
        });

        return newWs._id;
      } catch (createError) {
        // Handle duplicate key error (race condition)
        if (createError.code === 11000) {
          // Another request created it simultaneously, fetch it
          ws = await Workspace.findOne({ gstin: normalizedGstin }).lean();
          if (ws && ws.status !== 'SUSPENDED') {
            return ws._id;
          }
        }
        logger.error('[WorkspaceHelper] Failed to create workspace', {
          gstin: normalizedGstin,
          error: createError.message
        });
        return null;
      }
    }

    // No workspace context found
    return null;
  } catch (error) {
    // ✅ FIX 5: Proper error handling and logging
    logger.error('[WorkspaceHelper] Error resolving workspace', {
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      userId: req.userId,
      gstin: req.gstin,
      workspaceId: req.workspaceId
    });
    return null;
  }
}

/**
 * Escapes special regex characters in a string
 * Prevents ReDoS (Regular Expression Denial of Service) attacks
 * 
 * @param {string} str - Input string
 * @returns {string} Escaped string safe for regex
 */
function escapeRegex(str) {
  if (typeof str !== 'string') {
    return '';
  }
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates if a workspace ID is accessible by the current user
 * Useful for authorization checks before sensitive operations
 * 
 * @param {ObjectId} workspaceId - Workspace to check
 * @param {ObjectId} userId - User requesting access
 * @returns {Promise<boolean>} True if user has access
 */
async function canUserAccessWorkspace(workspaceId, userId) {
  if (!workspaceId || !userId) return false;

  try {
    const member = await WorkspaceMember.findOne({
      workspaceId,
      userId,
      status: 'ACTIVE'
    }).lean();

    return !!member;
  } catch (error) {
    logger.error('[WorkspaceHelper] Error checking workspace access', {
      workspaceId,
      userId,
      error: error.message
    });
    return false;
  }
}

module.exports = {
  resolveWorkspaceId,
  escapeRegex,
  canUserAccessWorkspace // ✅ NEW: Authorization helper
};