const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';

const Workspace = require('../src/models/Workspace');
const WorkspaceMember = require('../src/models/WorkspaceMember');
const AuditLog = require('../src/models/AuditLog');
const userAuthController = require('../src/controllers/userAuth.controller');

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    }
  };
}

async function main() {
  const originalWorkspaceFindOne = Workspace.findOne;
  const originalMemberFindOne = WorkspaceMember.findOne;
  const originalMemberCreate = WorkspaceMember.create;
  const originalAuditCreate = AuditLog.create;

  const userId = new mongoose.Types.ObjectId();
  const workspace = {
    _id: new mongoose.Types.ObjectId(),
    gstin: '27AAAAA0000A1Z5',
    name: 'Existing Organization',
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    }
  };
  let membership = null;
  let memberCreateCalls = 0;
  let auditCreateCalls = 0;

  Workspace.findOne = async ({ gstin }) => {
    assert.equal(gstin, workspace.gstin);
    return workspace;
  };
  WorkspaceMember.findOne = async (filter) => {
    assert.equal(filter.status, 'ACTIVE');
    return membership;
  };
  WorkspaceMember.create = async () => {
    memberCreateCalls += 1;
    throw new Error('Workspace creation must not grant an existing workspace membership.');
  };
  AuditLog.create = async () => {
    auditCreateCalls += 1;
  };

  try {
    const request = {
      userId,
      body: { name: 'Unauthorized Rename', gstin: workspace.gstin },
      session: {
        saveCalls: 0,
        async save() {
          this.saveCalls += 1;
        }
      }
    };
    const deniedResponse = createMockRes();
    let deniedError = null;

    await userAuthController.createWorkspace(request, deniedResponse, (error) => {
      deniedError = error;
    });

    assert.equal(deniedError?.statusCode, 403, 'Uninvited users cannot claim an existing workspace.');
    assert.equal(memberCreateCalls, 0, 'Denied users must not receive a membership.');
    assert.equal(workspace.name, 'Existing Organization', 'Denied users must not rename the workspace.');
    assert.equal(request.session.saveCalls, 0, 'Denied users must not switch into the workspace.');

    membership = {
      _id: new mongoose.Types.ObjectId(),
      role: 'MEMBER',
      status: 'ACTIVE'
    };
    const memberResponse = createMockRes();
    let memberError = null;
    await userAuthController.createWorkspace(request, memberResponse, (error) => {
      memberError = error;
    });

    assert.equal(memberError, null, 'Existing active members can switch to their workspace.');
    assert.equal(memberResponse.statusCode, 200);
    assert.equal(memberResponse.data.workspace.role, 'MEMBER', 'Existing roles must not be elevated.');
    assert.equal(workspace.name, 'Existing Organization', 'Members cannot rename the workspace here.');
    assert.equal(memberCreateCalls, 0);
    assert.equal(auditCreateCalls, 1);
    assert.equal(request.session.saveCalls, 1);

    membership.role = 'OWNER';
    const ownerResponse = createMockRes();
    let ownerError = null;
    await userAuthController.createWorkspace(
      { ...request, body: { name: 'Updated Organization', gstin: workspace.gstin } },
      ownerResponse,
      (error) => {
        ownerError = error;
      }
    );

    assert.equal(ownerError, null, 'Existing owners retain workspace management access.');
    assert.equal(workspace.name, 'Updated Organization');
    assert.equal(workspace.saveCalls, 1);
    assert.equal(ownerResponse.data.workspace.role, 'OWNER');
    console.log('✓ Existing workspace access requires an active membership and never escalates roles.');
  } finally {
    Workspace.findOne = originalWorkspaceFindOne;
    WorkspaceMember.findOne = originalMemberFindOne;
    WorkspaceMember.create = originalMemberCreate;
    AuditLog.create = originalAuditCreate;
  }
}

main().catch((error) => {
  console.error(`Workspace claim tests failed: ${error.message}`);
  process.exitCode = 1;
});
