const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const http = require('http');

const {
  validate,
  searchGstinSchema,
  requestOtpSchema,
  verifyOtpSchema,
  periodQuerySchema
} = require('../src/middleware/validate');
const { otpLimiter } = require('../src/middleware/rateLimit');
const errorHandler = require('../src/middleware/errorHandler');
const auth = require('../src/middleware/auth');
const ApiError = require('../src/utils/apiError');
const Session = require('../src/models/Session');
const { JWT_SECRET, MONGO_URI } = require('../src/config/env');

let currentTest = '';

function runCheck(testName, fn) {
  currentTest = testName;
  try {
    fn();
  } catch (err) {
    console.error(`❌ FAILED: ${testName}`);
    console.error(err);
    process.exit(1);
  }
}

async function runAsyncCheck(testName, fn) {
  currentTest = testName;
  try {
    await fn();
  } catch (err) {
    console.error(`❌ FAILED: ${testName}`);
    console.error(err);
    process.exit(1);
  }
}

async function request(baseUrl, path, options = {}) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  let data = null;
  const text = await response.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    status: response.status,
    headers: response.headers,
    body: data
  };
}

async function main() {
  console.log('--- Starting Middleware Test Suite ---');

  // 1. Connect to MongoDB for auth & session tests
  await mongoose.connect(MONGO_URI);

  // 2. Setup tiny temporary Express application
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Mount validation test endpoints
  app.post('/test/validate/gstin', validate(searchGstinSchema), (req, res) => {
    res.status(200).json({ success: true, gstin: req.body.gstin });
  });

  app.post('/test/validate/otp-request', validate(requestOtpSchema), (req, res) => {
    res.status(200).json({ success: true, message: 'OTP requested' });
  });

  app.post('/test/validate/otp-verify', validate(verifyOtpSchema), (req, res) => {
    res.status(200).json({ success: true, message: 'OTP verified' });
  });

  app.get('/test/validate/period', validate(periodQuerySchema, 'query'), (req, res) => {
    res.status(200).json({ success: true, period: req.query.period });
  });

  // Mount rateLimit test endpoint
  app.post('/test/ratelimit/otp', otpLimiter, (req, res) => {
    res.status(200).json({ success: true, message: 'OTP endpoint hit' });
  });

  // Mount errorHandler test endpoints
  app.get('/test/error/apierror', (req, res, next) => {
    next(ApiError.otpInvalid('Wrong OTP provided'));
  });

  app.get('/test/error/unexpected', (req, res, next) => {
    next(new Error('Unexpected unhandled database failure'));
  });

  // Mount auth test endpoint
  app.get('/test/auth/protected', auth, (req, res) => {
    res.status(200).json({ success: true, gstin: req.gstin, username: req.username });
  });

  // Mount centralized error handler
  app.use(errorHandler);

  // Start HTTP server on a random port (0)
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`Temporary test server listening on ${baseUrl}`);

  try {
    // ------------------------------------------------------------------------
    // Group 1: Validate Middleware
    // ------------------------------------------------------------------------
    await runAsyncCheck('validate: bad GSTIN is rejected with INVALID_GSTIN (400)', async () => {
      const res = await request(baseUrl, '/test/validate/gstin', {
        method: 'POST',
        body: { gstin: 'INVALID_GSTIN_123' }
      });
      assert.equal(res.status, 400, 'Expected HTTP 400 for bad GSTIN');
      assert.equal(res.body.success, false, 'Expected success: false');
      assert.equal(res.body.code, 'INVALID_GSTIN', 'Expected code: INVALID_GSTIN');
    });

    await runAsyncCheck('validate: OTP "12ab" is rejected with VALIDATION_ERROR (400)', async () => {
      const res = await request(baseUrl, '/test/validate/otp-verify', {
        method: 'POST',
        body: { gstin: '27AAAAA0000A1Z5', username: 'demo', otp: '12ab' }
      });
      assert.equal(res.status, 400, 'Expected HTTP 400 for invalid OTP format');
      assert.equal(res.body.success, false, 'Expected success: false');
      assert.equal(res.body.code, 'VALIDATION_ERROR', 'Expected code: VALIDATION_ERROR');
    });

    await runAsyncCheck('validate: period "132026" (month 13) is rejected with VALIDATION_ERROR (400)', async () => {
      const res = await request(baseUrl, '/test/validate/period?period=132026');
      assert.equal(res.status, 400, 'Expected HTTP 400 for month 13');
      assert.equal(res.body.success, false, 'Expected success: false');
      assert.equal(res.body.code, 'VALIDATION_ERROR', 'Expected code: VALIDATION_ERROR');
    });

    await runAsyncCheck('validate: future period is rejected with VALIDATION_ERROR (400)', async () => {
      const futureYear = new Date().getFullYear() + 2;
      const res = await request(baseUrl, `/test/validate/period?period=12${futureYear}`);
      assert.equal(res.status, 400, 'Expected HTTP 400 for future period');
      assert.equal(res.body.success, false, 'Expected success: false');
      assert.equal(res.body.code, 'VALIDATION_ERROR', 'Expected code: VALIDATION_ERROR');
    });

    await runAsyncCheck('validate: good input passes for GSTIN, OTP, and period', async () => {
      // Good GSTIN
      const resGstin = await request(baseUrl, '/test/validate/gstin', {
        method: 'POST',
        body: { gstin: '27AAAAA0000A1Z5' }
      });
      assert.equal(resGstin.status, 200, 'Good GSTIN should pass');
      assert.equal(resGstin.body.success, true);

      // Good OTP Verify
      const resOtp = await request(baseUrl, '/test/validate/otp-verify', {
        method: 'POST',
        body: { gstin: '27AAAAA0000A1Z5', username: 'demo', otp: '123456' }
      });
      assert.equal(resOtp.status, 200, 'Good OTP should pass');
      assert.equal(resOtp.body.success, true);

      // Good Period
      const resPeriod = await request(baseUrl, '/test/validate/period?period=012024');
      assert.equal(resPeriod.status, 200, 'Good past period should pass');
      assert.equal(resPeriod.body.success, true);
    });

    await runAsyncCheck('validate: OTP request without consent:true is rejected with VALIDATION_ERROR (400)', async () => {
      // consent: false
      const resFalse = await request(baseUrl, '/test/validate/otp-request', {
        method: 'POST',
        body: { gstin: '27AAAAA0000A1Z5', username: 'demo', consent: false }
      });
      assert.equal(resFalse.status, 400, 'Expected HTTP 400 when consent is false');
      assert.equal(resFalse.body.code, 'VALIDATION_ERROR');

      // missing consent
      const resMissing = await request(baseUrl, '/test/validate/otp-request', {
        method: 'POST',
        body: { gstin: '27AAAAA0000A1Z5', username: 'demo' }
      });
      assert.equal(resMissing.status, 400, 'Expected HTTP 400 when consent is missing');
      assert.equal(resMissing.body.code, 'VALIDATION_ERROR');
    });

    // ------------------------------------------------------------------------
    // Group 2: Rate Limit Middleware
    // ------------------------------------------------------------------------
    await runAsyncCheck('rateLimit: the 6th OTP request from one IP returns 429 RATE_LIMITED', async () => {
      // First 5 requests should succeed
      for (let i = 1; i <= 5; i++) {
        const res = await request(baseUrl, '/test/ratelimit/otp', { method: 'POST' });
        assert.equal(res.status, 200, `Request ${i} within limit should succeed`);
      }

      // The 6th request must trigger rate limit
      const res6 = await request(baseUrl, '/test/ratelimit/otp', { method: 'POST' });
      assert.equal(res6.status, 429, '6th request must return HTTP 429');
      assert.equal(res6.body.success, false, 'Expected success: false on 429');
      assert.equal(res6.body.code, 'RATE_LIMITED', 'Expected code: RATE_LIMITED');
    });

    // ------------------------------------------------------------------------
    // Group 3: Error Handler Middleware
    // ------------------------------------------------------------------------
    await runAsyncCheck('errorHandler: an ApiError returns { success:false, code, message } with right status', async () => {
      const res = await request(baseUrl, '/test/error/apierror');
      assert.equal(res.status, 400, 'Expected ApiError status 400');
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'OTP_INVALID');
      assert.equal(res.body.message, 'Wrong OTP provided');
    });

    await runAsyncCheck('errorHandler: unexpected Error returns 500 with generic message and no stack or details', async () => {
      const res = await request(baseUrl, '/test/error/unexpected');
      assert.equal(res.status, 500, 'Expected status 500');
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'SERVER_ERROR');
      assert.equal(typeof res.body.message, 'string', 'Expected generic message string');
      assert.ok(res.body.message.length > 0, 'Generic message must not be empty');
      assert.equal(res.body.stack, undefined, 'Stack must not be exposed in response body');
      assert.equal(res.body.details, undefined, 'Details must not be exposed in response body');
      assert.equal(typeof res.body.error, 'undefined', 'Internal error object must not be exposed');
    });

    // ------------------------------------------------------------------------
    // Group 4: Auth Middleware
    // ------------------------------------------------------------------------
    await runAsyncCheck('auth: no cookie is rejected with SESSION_EXPIRED (401)', async () => {
      const res = await request(baseUrl, '/test/auth/protected');
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'SESSION_EXPIRED');
    });

    await runAsyncCheck('auth: bad JWT is rejected with SESSION_EXPIRED (401)', async () => {
      const res = await request(baseUrl, '/test/auth/protected', {
        headers: { Cookie: 'sid=invalid.jwt.token' }
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'SESSION_EXPIRED');
    });

    await runAsyncCheck('auth: valid JWT whose Session does not exist is rejected with SESSION_EXPIRED (401)', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const token = jwt.sign({ sessionId: nonExistentId }, JWT_SECRET, { expiresIn: '1h' });
      const res = await request(baseUrl, '/test/auth/protected', {
        headers: { Cookie: `sid=${token}` }
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'SESSION_EXPIRED');
    });

    await runAsyncCheck('auth: Session with past expiresAt is rejected with SESSION_EXPIRED (401)', async () => {
      const expiredSession = await Session.create({
        gstin: '27AAAAA0000A1Z5',
        username: 'expired_user',
        gstTokenEnc: 'mock_encrypted_token',
        expiresAt: new Date(Date.now() - 3600000) // 1 hour ago
      });

      const token = jwt.sign({ sessionId: expiredSession._id }, JWT_SECRET, { expiresIn: '1h' });
      const res = await request(baseUrl, '/test/auth/protected', {
        headers: { Cookie: `sid=${token}` }
      });

      // Cleanup
      await Session.findByIdAndDelete(expiredSession._id).catch(() => { });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'SESSION_EXPIRED');
    });

    await runAsyncCheck('auth: a valid session passes', async () => {
      const validSession = await Session.create({
        gstin: '27AAAAA0000A1Z5',
        username: 'active_taxpayer',
        gstTokenEnc: 'mock_encrypted_token',
        expiresAt: new Date(Date.now() + 3600000) // 1 hour in the future
      });

      const token = jwt.sign({ sessionId: validSession._id }, JWT_SECRET, { expiresIn: '1h' });
      const res = await request(baseUrl, '/test/auth/protected', {
        headers: { Cookie: `sid=${token}` }
      });

      // Cleanup
      await Session.findByIdAndDelete(validSession._id).catch(() => { });

      assert.equal(res.status, 200, 'Valid session should return HTTP 200');
      assert.equal(res.body.success, true);
      assert.equal(res.body.gstin, '27AAAAA0000A1Z5');
      assert.equal(res.body.username, 'active_taxpayer');
    });

    console.log('\n🎉 ALL MIDDLEWARE TESTS PASSED SUCCESSFULLY! (100% assertions satisfied)');
  } finally {
    // Teardown
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(`❌ Test execution failed:`, err);
  process.exit(1);
});
