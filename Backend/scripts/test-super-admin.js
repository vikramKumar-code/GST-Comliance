const assert = require('node:assert/strict');
const mongoose = require('mongoose');
process.env.NODE_ENV = 'test';
process.env.SUPER_ADMIN_EMAILS = 'admin@platform.com,super@candidtax.com';

const User = require('../src/models/User');
const Workspace = require('../src/models/Workspace');
const WorkspaceMember = require('../src/models/WorkspaceMember');
const superAdminController = require('../src/controllers/superAdmin.controller');
const requireSuperAdmin = require('../src/middleware/superAdmin');
const workspaceRole = require('../src/middleware/workspaceRole');

async function main() {
  console.log('--- Running Super Admin & Multi-Tier RBAC Tests ---');

  // Test 1: User isSuperAdmin helper
  const regularUser = new User({ email: 'user@example.com', systemRole: 'USER' });
  assert.equal(regularUser.isSuperAdmin(), false, 'Regular user should not be super admin');

  const configSuperAdmin = new User({ email: 'admin@platform.com', systemRole: 'USER' });
  assert.equal(configSuperAdmin.isSuperAdmin(), true, 'User with email in SUPER_ADMIN_EMAILS is super admin');

  const dbSuperAdmin = new User({ email: 'other@example.com', systemRole: 'SUPER_ADMIN' });
  assert.equal(dbSuperAdmin.isSuperAdmin(), true, 'User with systemRole SUPER_ADMIN is super admin');
  console.log('  ✓ 1. User.isSuperAdmin identifies platform owners from email and role');

  // Test 2: requireSuperAdmin middleware
  let nextCalled = false;
  const mockReqAdmin = { isSuperAdmin: true, user: configSuperAdmin, session: { _id: 's1' } };
  await requireSuperAdmin(mockReqAdmin, {}, (err) => {
    if (!err) nextCalled = true;
  });
  assert.equal(nextCalled, true, 'requireSuperAdmin allows super admin');

  let forbiddenCaught = false;
  const mockReqUser = { isSuperAdmin: false, user: regularUser, session: { _id: 's2' } };
  await requireSuperAdmin(mockReqUser, {}, (err) => {
    if (err) {
      forbiddenCaught = true;
      assert.equal(err.statusCode, 403, 'Should return 403 FORBIDDEN');
    }
  });
  assert.equal(forbiddenCaught, true, 'requireSuperAdmin rejects non-admin users');
  console.log('  ✓ 2. requireSuperAdmin guards routes with 403 Forbidden for non-admins');

  // Test 3: workspaceRole middleware enforces CA vs Accountant
  let accountantBlocked = false;
  const accountantReq = {
    workspaceRole: 'ACCOUNTANT',
    isSuperAdmin: false
  };
  const filingMiddleware = workspaceRole('OWNER', 'ADMIN');
  filingMiddleware(accountantReq, {}, (err) => {
    if (err) {
      accountantBlocked = true;
      assert.equal(err.statusCode, 403);
      assert.ok(err.message.includes('Accountant'), 'Error mentions Accountant');
    }
  });
  assert.equal(accountantBlocked, true, 'Accountant is strictly prohibited from filing returns');

  let caAllowed = false;
  const caReq = {
    workspaceRole: 'OWNER',
    isSuperAdmin: false
  };
  filingMiddleware(caReq, {}, (err) => {
    if (!err) caAllowed = true;
  });
  assert.equal(caAllowed, true, 'CA / Owner is allowed to file returns');
  console.log('  ✓ 3. workspaceRole middleware strictly restricts Accountant from filing returns');

  // Test 4: Workspace suspension and subscription helpers
  const ws = new Workspace({
    name: 'Test Client',
    gstin: '07AAAAA0000A1Z5',
    status: 'ACTIVE',
    subscription: {
      plan: 'FREE',
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 1000000)
    }
  });
  assert.equal(ws.isSuspended(), false);
  assert.equal(ws.isSubscriptionActive(), true);

  ws.status = 'SUSPENDED';
  assert.equal(ws.isSuspended(), true);

  ws.subscription.status = 'EXPIRED';
  assert.equal(ws.isSubscriptionActive(), false);
  console.log('  ✓ 4. Workspace correctly tracks active, suspended, and expired subscription states');

  console.log('\n🎉 ALL SUPER ADMIN & MULTI-TIER RBAC TESTS PASSED SUCCESSFULLY!\n');
}

main().catch((err) => {
  console.error('Super Admin tests failed:', err);
  process.exit(1);
});
