const Workspace = require('../models/Workspace');

/**
 * Resolves the workspace ObjectId for the current request.
 * Prioritizes req.workspaceId, and falls back to finding or creating
 * the active workspace by verified req.gstin.
 */
async function resolveWorkspaceId(req) {
  if (req.workspaceId) {
    return req.workspaceId;
  }
  if (req.gstin) {
    const ws = await Workspace.findOne({ gstin: req.gstin });
    if (ws) return ws._id;
    const newWs = await Workspace.create({ gstin: req.gstin, status: 'ACTIVE' });
    return newWs._id;
  }
  return null;
}

module.exports = {
  resolveWorkspaceId
};
