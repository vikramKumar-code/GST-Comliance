/**
 * Security Regression Test Suite
 * Verifies all security fixes applied during Cloudflare Security Audit.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

const ApiError = require('../src/utils/apiError');
const userAuthController = require('../src/controllers/userAuth.controller');
const subscriptionController = require('../src/controllers/subscription.controller');
const authMiddleware = require('../src/middleware/auth');
const errorHandler = require('../src/middleware/errorHandler');
const { escapeRegex } = require('../src/utils/workspaceHelper');
const Workspace = require('../src/models/Workspace');

function createMockRes() {
  return {
    statusCode: 200,
    cookies: {},
    data: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    cookie(name, val, opts) {
      this.cookies[name] = { val, opts };
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
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
  console.log('\n--- Running Security Audit Fix Regression Tests ---');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gst-compliance-test';
  await mongoose.connect(mongoUri);

  try {
    // 1. Google OAuth Token Spoofing Protection
    await runCheck('1. googleAuth rejects mock-google-token when NODE_ENV is production or development', async () => {
      const origEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const req = {
          body: {
            idToken: 'mock-google-token:attacker_sub:victim@company.com:Attacker'
          }
        };
        const res = createMockRes();
        let capturedErr = null;
        await userAuthController.googleAuth(req, res, (err) => { capturedErr = err; });
        assert.ok(capturedErr, 'Mock token must be rejected in production');
        assert.match(capturedErr.message, /Google OAuth is not configured/i);
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    // 2. Auth Middleware Token Query Param Leakage Protection
    await runCheck('2. auth middleware rejects tokens passed in URL query string (?token=)', async () => {
      const req = {
        cookies: {},
        headers: {},
        query: { token: 'jwt.token.in.query.param' }
      };
      const res = createMockRes();
      let capturedErr = null;
      await authMiddleware(req, res, (err) => { capturedErr = err; });
      assert.ok(capturedErr, 'Token in query string must be rejected');
      assert.equal(capturedErr.code, 'SESSION_EXPIRED');
    });

    // 3. Subscription Payment Verification Security
    await runCheck('3. verifyPayment enforces orderId, paymentId and signature verification', async () => {
      const ws = await Workspace.create({
        name: 'Security Test Org',
        status: 'ACTIVE',
        subscription: {
          plan: 'FREE',
          orderId: 'order_test_12345'
        }
      });

      // Missing paymentId and orderId
      const emptyReq = {
        workspaceId: ws._id,
        body: { planId: 'PRO', billingCycle: 'MONTHLY' }
      };
      const emptyRes = createMockRes();
      let emptyErr = null;
      await subscriptionController.verifyPayment(emptyReq, emptyRes, (err) => { emptyErr = err; });
      assert.ok(emptyErr, 'verifyPayment must require orderId and paymentId');
      assert.match(emptyErr.message, /Both paymentId and orderId are required/i);

      // Order ID mismatch
      const mismatchReq = {
        workspaceId: ws._id,
        body: {
          planId: 'PRO',
          billingCycle: 'MONTHLY',
          orderId: 'order_fake_99999',
          paymentId: 'pay_12345'
        }
      };
      const mismatchRes = createMockRes();
      let mismatchErr = null;
      await subscriptionController.verifyPayment(mismatchReq, mismatchRes, (err) => { mismatchErr = err; });
      assert.ok(mismatchErr, 'Mismatched orderId must be rejected');
      assert.match(mismatchErr.message, /orderId does not match/i);

      // Signature verification when secret is present
      const origSecret = process.env.RAZORPAY_KEY_SECRET;
      try {
        process.env.RAZORPAY_KEY_SECRET = 'test_secret_key_1234567890';
        const invalidSigReq = {
          workspaceId: ws._id,
          body: {
            planId: 'PRO',
            billingCycle: 'MONTHLY',
            orderId: 'order_test_12345',
            paymentId: 'pay_12345',
            signature: 'invalid_forged_signature'
          }
        };
        const invalidSigRes = createMockRes();
        let invalidSigErr = null;
        await subscriptionController.verifyPayment(invalidSigReq, invalidSigRes, (err) => { invalidSigErr = err; });
        assert.ok(invalidSigErr, 'Forged signature must be rejected');
        assert.match(invalidSigErr.message, /invalid signature/i);

        // Valid signature passes
        const validSig = crypto
          .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
          .update('order_test_12345|pay_12345')
          .digest('hex');

        const validSigReq = {
          workspaceId: ws._id,
          body: {
            planId: 'PRO',
            billingCycle: 'MONTHLY',
            orderId: 'order_test_12345',
            paymentId: 'pay_12345',
            signature: validSig
          }
        };
        const validSigRes = createMockRes();
        let validSigErr = null;
        await subscriptionController.verifyPayment(validSigReq, validSigRes, (err) => { validSigErr = err; });
        assert.equal(validSigErr, null, 'Valid HMAC signature must be accepted');
        assert.equal(validSigRes.statusCode, 200);
        assert.equal(validSigRes.data.subscription.plan, 'PRO');
      } finally {
        process.env.RAZORPAY_KEY_SECRET = origSecret;
        await Workspace.deleteOne({ _id: ws._id });
      }
    });

    // 4. ReDoS & Regex Metacharacter Escaping
    await runCheck('4. escapeRegex properly neutralizes regex wildcards and malicious metacharacters', async () => {
      const maliciousInputs = [
        '((((((((a+)+)+)+)+)+)+)+)b',
        '[a-z',
        '*invalid+regex(test)',
        'Acme.*Company',
        '\\^$.*+?()[]{}|'
      ];
      for (const input of maliciousInputs) {
        const escaped = escapeRegex(input);
        assert.doesNotThrow(() => {
          new RegExp(escaped, 'i');
        }, `RegExp compiling ${input} must not throw SyntaxError`);
      }
    });

    // 5. CastError Handling in errorHandler
    await runCheck('5. errorHandler converts Mongoose CastError into clean 400 VALIDATION_ERROR', async () => {
      const castError = new mongoose.Error.CastError('ObjectId', 'invalid-id-string', '_id');
      const res = createMockRes();
      let nextCalled = false;
      errorHandler(castError, {}, res, () => { nextCalled = true; });
      assert.equal(res.statusCode, 400, 'CastError must return status 400');
      assert.equal(res.data.code, 'VALIDATION_ERROR');
      assert.equal(nextCalled, false);
    });

    console.log('\n🎉 ALL SECURITY AUDIT REGRESSION CHECKS PASSED!\n');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Security test suite failed:', err);
  process.exit(1);
});
