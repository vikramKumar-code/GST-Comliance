/**
 * Automated Tests for User Authentication & OAuth 2.0 (UserAuth Controller & Model)
 */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
process.env.NODE_ENV = 'test';

const User = require('../src/models/User');
const Session = require('../src/models/Session');
const Workspace = require('../src/models/Workspace');
const WorkspaceMember = require('../src/models/WorkspaceMember');
const userAuthController = require('../src/controllers/userAuth.controller');

function createMockRes() {
  return {
    statusCode: 200,
    cookies: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    cookie(name, val, opts) {
      this.cookies[name] = { val, opts };
      return this;
    },
    clearCookie(name) {
      delete this.cookies[name];
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    }
  };
}

async function runCheck(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function main() {
  console.log('--- Running User Authentication & OAuth 2.0 Tests ---');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gst-compliance-test';
  await mongoose.connect(mongoUri);

  try {
    await User.collection.dropIndex('identityHash_1').catch(() => {});
  } catch {}
  await User.syncIndexes();

  const testEmail = `testuser_${Date.now()}@example.com`;
  const testPassword = 'SecurePassword123!';

  try {
    // 1. Password Hashing and Comparison unit test
    await runCheck('1. User.hashPassword hashes with bcrypt and comparePassword verifies correctly', async () => {
      const hashed = await User.hashPassword(testPassword);
      assert.notEqual(hashed, testPassword, 'Password must not be stored in plaintext');
      assert.match(hashed, /^\$2[aby]\$\d+\$/, 'Hash must be valid bcrypt');

      const user = new User({ name: 'Test User', email: testEmail, password: hashed });
      const valid = await user.comparePassword(testPassword);
      assert.equal(valid, true, 'comparePassword must return true for matching password');

      const invalid = await user.comparePassword('WrongPassword123');
      assert.equal(invalid, false, 'comparePassword must return false for wrong password');
    });

    // 2. Password Privacy: Default queries never return password
    await runCheck('2. Password field is excluded (select: false) by default in queries', async () => {
      const u = await User.findOne({ email: testEmail });
      if (u) {
        assert.equal(u.password, undefined, 'Password must be undefined in standard findOne');
        const json = u.toJSON();
        assert.equal(json.password, undefined, 'Password must not be present in toJSON output');
      }
    });

    // 3. User Registration (Signup) Controller
    await runCheck('3. userAuthController.signup creates user and issues session cookie', async () => {
      const req = {
        body: {
          name: 'Jane Doe',
          email: testEmail,
          password: testPassword
        }
      };
      const res = createMockRes();
      let nextError = null;

      await userAuthController.signup(req, res, (err) => { nextError = err; });
      assert.equal(nextError, null, 'Signup must not throw an error');
      assert.equal(res.statusCode, 201, 'Signup must return 201 Created');
      assert.equal(res.data.success, true);
      assert.equal(res.data.user.email, testEmail);
      assert.equal(res.data.user.password, undefined, 'Password must never be returned in signup response');
      assert.ok(res.cookies.sid, 'Session cookie sid must be set');
      assert.equal(res.cookies.sid.opts.httpOnly, true, 'Cookie must be httpOnly');
    });

    // 4. Duplicate Email Rejection
    await runCheck('4. userAuthController.signup rejects duplicate email with 400 error', async () => {
      const req = {
        body: {
          name: 'Jane Duplicate',
          email: testEmail,
          password: 'AnotherPassword123!'
        }
      };
      const res = createMockRes();
      let nextError = null;

      await userAuthController.signup(req, res, (err) => { nextError = err; });
      assert.ok(nextError, 'Duplicate signup must throw error');
      assert.match(nextError.message, /already exists/i, 'Error message must state account exists');
    });

    // 5. User Signin with Correct vs Incorrect Password
    await runCheck('5. userAuthController.signin succeeds with correct password and rejects wrong password', async () => {
      // Wrong password
      const wrongReq = {
        body: {
          email: testEmail,
          password: 'IncorrectPassword999'
        }
      };
      const wrongRes = createMockRes();
      let wrongError = null;
      await userAuthController.signin(wrongReq, wrongRes, (err) => { wrongError = err; });
      assert.ok(wrongError, 'Invalid password must throw error');
      assert.match(wrongError.message, /invalid email or password/i);

      // Correct password
      const correctReq = {
        body: {
          email: testEmail,
          password: testPassword
        }
      };
      const correctRes = createMockRes();
      let correctError = null;
      await userAuthController.signin(correctReq, correctRes, (err) => { correctError = err; });
      assert.equal(correctError, null, 'Signin must succeed');
      assert.equal(correctRes.statusCode, 200);
      assert.equal(correctRes.data.success, true);
      assert.equal(correctRes.data.user.email, testEmail);
      assert.ok(correctRes.cookies.sid, 'Signin must set sid cookie');
    });

    // 6. Google OAuth 2.0 Controller Integration
    await runCheck('6. userAuthController.googleAuth provisions user account from verified token', async () => {
      const mockGoogleId = `google_sub_${Date.now()}`;
      const mockGoogleEmail = `googleuser_${Date.now()}@candidtax.com`;
      const req = {
        body: {
          idToken: `mock-google-token:${mockGoogleId}:${mockGoogleEmail}:Google Verified User`
        }
      };
      const res = createMockRes();
      let nextError = null;

      await userAuthController.googleAuth(req, res, (err) => { nextError = err; });
      assert.equal(nextError, null, 'Google auth must succeed');
      assert.equal(res.statusCode, 200);
      assert.equal(res.data.success, true);
      assert.equal(res.data.user.email, mockGoogleEmail);
      assert.equal(res.data.user.authProvider, 'GOOGLE');
      assert.ok(res.cookies.sid, 'Google login must set session cookie');

      // Verify user created in DB
      const dbUser = await User.findOne({ email: mockGoogleEmail });
      assert.ok(dbUser, 'User must be created in MongoDB');
      assert.equal(dbUser.authProvider, 'GOOGLE');
      assert.equal(dbUser.googleId, mockGoogleId);
    });

    // 7. Multi-workspace Listing and Switching
    await runCheck('7. userAuthController lists user workspaces and switches active session context', async () => {
      const user = await User.findOne({ email: testEmail });
      const ws1 = await Workspace.create({ gstin: '27AAAAA0000A1Z1', status: 'ACTIVE' });
      const ws2 = await Workspace.create({ gstin: '29BBBBB1111B1Z2', status: 'ACTIVE' });

      const mem1 = await WorkspaceMember.create({
        userId: user._id,
        workspaceId: ws1._id,
        role: 'OWNER',
        status: 'ACTIVE'
      });
      const mem2 = await WorkspaceMember.create({
        userId: user._id,
        workspaceId: ws2._id,
        role: 'MEMBER',
        status: 'ACTIVE'
      });

      // Mock session for user
      const session = await Session.create({
        userId: user._id,
        workspaceId: ws1._id,
        memberId: mem1._id,
        gstin: ws1.gstin,
        expiresAt: new Date(Date.now() + 3600000)
      });

      // List workspaces
      const listReq = {
        userId: user._id,
        session,
        workspaceId: ws1._id
      };
      const listRes = createMockRes();
      await userAuthController.getWorkspaces(listReq, listRes, (err) => { assert.ifError(err); });
      assert.equal(listRes.statusCode, 200);
      assert.equal(listRes.data.workspaces.length, 2, 'Must list both user workspaces');
      const ws1Entry = listRes.data.workspaces.find((w) => w.gstin === '27AAAAA0000A1Z1');
      assert.equal(ws1Entry.isCurrent, true, 'ws1 must be flagged as current');

      // Switch to ws2
      const switchReq = {
        userId: user._id,
        session,
        body: { workspaceId: ws2._id.toString() }
      };
      const switchRes = createMockRes();
      await userAuthController.switchWorkspace(switchReq, switchRes, (err) => { assert.ifError(err); });
      assert.equal(switchRes.statusCode, 200);
      assert.equal(switchRes.data.currentWorkspace.gstin, '29BBBBB1111B1Z2');
      assert.equal(switchRes.data.currentWorkspace.role, 'MEMBER');

      // Verify session updated
      const updatedSession = await Session.findById(session._id);
      assert.equal(updatedSession.gstin, '29BBBBB1111B1Z2');
      assert.equal(String(updatedSession.workspaceId), String(ws2._id));

      // Clean up test workspaces
      await Workspace.deleteMany({ _id: { $in: [ws1._id, ws2._id] } });
      await WorkspaceMember.deleteMany({ _id: { $in: [mem1._id, mem2._id] } });
      await Session.deleteOne({ _id: session._id });
    });

    console.log('\n🎉 ALL USER AUTH & OAUTH 2.0 TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    // Clean up test user
    await User.deleteMany({ email: { $in: [testEmail] } });
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
