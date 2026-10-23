const assert = require('node:assert/strict');
const mongoose = require('mongoose');
process.env.NODE_ENV = 'test';
const Workspace = require('../src/models/Workspace');
const WorkspaceMember = require('../src/models/WorkspaceMember');
const User = require('../src/models/User');
const TenantService = require('../src/services/tenant.service');

async function main() {
  const workspaceUnique = Workspace.schema.indexes().some(([keys, options]) =>
    keys.gstin === 1 && options.unique === true
  );
  assert.equal(workspaceUnique, true, 'a GSTIN must map to one workspace');

  const membershipUnique = WorkspaceMember.schema.indexes().some(([keys, options]) =>
    keys.workspaceId === 1 && keys.userId === 1 && options.unique === true
  );
  assert.equal(membershipUnique, true, 'a user must have one membership per workspace');
  assert.deepEqual(WorkspaceMember.schema.path('role').enumValues, ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);

  const originalWorkspaceFindOneAndUpdate = Workspace.findOneAndUpdate;
  const originalWorkspaceExists = Workspace.exists;
  const originalUserFindOneAndUpdate = User.findOneAndUpdate;
  const originalMemberFindOne = WorkspaceMember.findOne;
  const originalMemberCreate = WorkspaceMember.create;

  try {
    const workspace = {
      _id: new mongoose.Types.ObjectId(),
      gstin: '27AAPFU0939F1ZV',
      ownerUserId: null,
      status: 'ACTIVE'
    };
    const users = new Map();
    const memberships = new Map();

    Workspace.findOneAndUpdate = async (filter, update) => {
      if (update.$setOnInsert) return workspace;
      if (update.$set?.ownerUserId && workspace.ownerUserId === null) {
        workspace.ownerUserId = update.$set.ownerUserId;
        return workspace;
      }
      return null;
    };
    Workspace.exists = async (filter) => String(workspace.ownerUserId) === String(filter.ownerUserId);
    User.findOneAndUpdate = async ({ identityHash }) => {
      if (!users.has(identityHash)) users.set(identityHash, { _id: new mongoose.Types.ObjectId() });
      return users.get(identityHash);
    };
    WorkspaceMember.findOne = async ({ userId }) => memberships.get(String(userId)) || null;
    WorkspaceMember.create = async (fields) => {
      const membership = { _id: new mongoose.Types.ObjectId(), status: 'ACTIVE', ...fields };
      memberships.set(String(fields.userId), membership);
      return membership;
    };

    const owner = await TenantService.ensureMembership(workspace.gstin, 'taxpayer-user');
    const member = await TenantService.ensureMembership(workspace.gstin, 'second-user');
    assert.equal(owner.membership.role, 'OWNER');
    assert.equal(member.membership.role, 'MEMBER');
    assert.equal(String(owner.workspace._id), String(member.workspace._id));

    memberships.set(String(member.user._id), { ...member.membership, status: 'REVOKED' });
    await assert.rejects(
      TenantService.ensureMembership(workspace.gstin, 'second-user'),
      (error) => error.code === 'SESSION_EXPIRED'
    );

    console.log('✓ Workspace is unique per GSTIN and membership is unique per user.');
    console.log('✓ First verified identity becomes OWNER; later verified identities become MEMBER.');
    console.log('✓ Revoked membership cannot receive an active workspace session.');
  } finally {
    Workspace.findOneAndUpdate = originalWorkspaceFindOneAndUpdate;
    Workspace.exists = originalWorkspaceExists;
    User.findOneAndUpdate = originalUserFindOneAndUpdate;
    WorkspaceMember.findOne = originalMemberFindOne;
    WorkspaceMember.create = originalMemberCreate;
  }
}

main().catch((error) => {
  console.error(`Tenancy tests failed: ${error.message}`);
  process.exitCode = 1;
});
