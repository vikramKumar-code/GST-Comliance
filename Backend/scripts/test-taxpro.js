const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TaxProProvider, SESSION_ERROR_CODES } = require('../src/services/providers/taxpro');
const ReturnService = require('../src/services/return.service');
const ApiError = require('../src/utils/apiError');
const logger = require('../src/utils/logger');

// Load sample files from doc/ folder
const DOC_DIR = path.resolve(__dirname, '../../doc');
const otpRequestSuccess = JSON.parse(fs.readFileSync(path.join(DOC_DIR, 'otprequest-success.json'), 'utf8'));
const authTokenSuccess = JSON.parse(fs.readFileSync(path.join(DOC_DIR, 'authtoken-success.json'), 'utf8'));
const gstr2bError = JSON.parse(fs.readFileSync(path.join(DOC_DIR, 'gstr2b-error-RET2B1023.json'), 'utf8'));
const auth4041Error = JSON.parse(fs.readFileSync(path.join(DOC_DIR, 'error-AUTH4041.json'), 'utf8'));

/**
 * Fake HTTP Client for offline testing
 */
class FakeHttpClient {
  constructor() {
    this.calls = [];
    this.handler = null;
  }

  setHandler(fn) {
    this.handler = fn;
  }

  async get(url, config) {
    this.calls.push({ url, config });
    if (!this.handler) {
      throw new Error('FakeHttpClient: No handler configured');
    }
    return this.handler(url, config);
  }
}

let currentCheck = '';

function runCheck(name, fn) {
  currentCheck = name;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`\n❌ FAILED: ${currentCheck}`);
    console.error(err);
    process.exit(1);
  }
}

async function runAsyncCheck(name, fn) {
  currentCheck = name;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`\n❌ FAILED: ${currentCheck}`);
    console.error(err);
    process.exit(1);
  }
}

async function main() {
  console.log('--- Running TaxPro Provider Adapter Test Suite (node:assert, offline) ---\n');

  const fakeClient = new FakeHttpClient();
  const testAspid = 'TESTASP';
  const testPassword = 'TESTPASS';
  const testToken = 'TESTTOKEN';

  const adapter = new TaxProProvider({
    httpClient: fakeClient,
    aspid: testAspid,
    password: testPassword
  });

  // 1. Check doc/otprequest-success.json
  await runAsyncCheck('1. requestOtp with otprequest-success.json sample', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler((url, config) => ({
      status: 200,
      data: otpRequestSuccess
    }));

    const res = await adapter.requestOtp('27AAAAA0000A1Z5', 'testuser');
    assert.equal(res.status_cd, '1', 'Expected status_cd "1"');
    assert.ok(typeof res.message === 'string', 'Expected message to be a string');

    assert.equal(fakeClient.calls.length, 1);
    const call = fakeClient.calls[0];
    assert.equal(call.url, '/taxpayerapi/dec/v1.0/authenticate');
    assert.equal(call.config.params.action, 'OTPREQUEST');
    assert.equal(call.config.params.aspid, testAspid);
    assert.equal(call.config.params.password, testPassword);
    assert.equal(call.config.params.gstin, '27AAAAA0000A1Z5');
    assert.equal(call.config.params.username, 'testuser');
  });

  // 2. Check doc/authtoken-success.json
  await runAsyncCheck('2. verifyOtp with authtoken-success.json sample returns token, never stores sek', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler((url, config) => ({
      status: 200,
      data: authTokenSuccess
    }));

    const res = await adapter.verifyOtp('27AAAAA0000A1Z5', 'testuser', '123456');
    assert.equal(res.token, authTokenSuccess.auth_token, 'Expected token to match auth_token');
    assert.equal(res.sek, undefined, 'sek must NEVER be stored or returned');
    assert.equal(res.auth_token, undefined, 'Should normalize to token field');

    assert.equal(fakeClient.calls.length, 1);
    const call = fakeClient.calls[0];
    assert.equal(call.url, '/taxpayerapi/dec/v1.0/authenticate');
    assert.equal(call.config.params.action, 'AUTHTOKEN');
    assert.equal(call.config.params.otp, '123456');
    assert.equal(call.config.params.aspid, testAspid);
    assert.equal(call.config.params.password, testPassword);
    assert.equal(call.config.params.gstin, '27AAAAA0000A1Z5');
    assert.equal(call.config.params.username, 'testuser');
  });

  // 3. Check doc/gstr2b-error-RET2B1023.json -> DATA_NOT_AVAILABLE (404)
  await runAsyncCheck('3. getReturn GSTR-2B with RET2B1023 sample maps to DATA_NOT_AVAILABLE (404)', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler((url, config) => ({
      status: 200,
      data: gstr2bError
    }));

    let caughtError = null;
    try {
      await adapter.getReturn('GSTR2B', '27AAAAA0000A1Z5', '012022', testToken, 'testuser');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected getReturn to throw an error');
    assert.equal(caughtError.code, 'DATA_NOT_AVAILABLE', 'Expected code: DATA_NOT_AVAILABLE');
    assert.equal(caughtError.statusCode, 404, 'Expected HTTP 404');
    assert.equal(caughtError.message, 'Data for this period is not available yet. Try another month.');
    assert.ok(!caughtError.message.includes('GSTN Error'), 'Must never forward raw provider message');

    assert.equal(fakeClient.calls.length, 1);
    const call = fakeClient.calls[0];
    assert.equal(call.url, '/taxpayerapi/dec/v1.0/returns/gstr2b');
    assert.equal(call.config.params.action, 'GET2B');
    assert.equal(call.config.params.ret_period, '012022');
    assert.equal(call.config.params.rtnprd, '012022', 'ret_period and rtnprd must have same value');
    assert.equal(call.config.params.authtoken, testToken);
  });

  // 4. Check doc/error-AUTH4041.json -> PROVIDER_ERROR (502)
  await runAsyncCheck('4. getReturn with AUTH4041 sample maps to PROVIDER_ERROR (502)', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler((url, config) => ({
      status: 200,
      data: auth4041Error
    }));

    let caughtError = null;
    try {
      await adapter.getReturn('GSTR1', '27AAAAA0000A1Z5', '092026', testToken, 'testuser');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected getReturn to throw an error');
    assert.equal(caughtError.code, 'PROVIDER_ERROR', 'Expected code: PROVIDER_ERROR');
    assert.equal(caughtError.statusCode, 502, 'Expected HTTP 502');
    assert.equal(caughtError.message, 'Could not complete the request. Please try again.');
    assert.ok(!caughtError.message.includes('state-cd'), 'Must never forward raw provider message');

    assert.equal(fakeClient.calls.length, 1);
    const call = fakeClient.calls[0];
    assert.equal(call.url, '/taxpayerapi/dec/v2.1/returns/gstr1');
    assert.equal(call.config.params.action, 'B2B');
  });

  // 5. Check unknown error_cd -> PROVIDER_ERROR (502)
  await runAsyncCheck('5. Unknown error_cd maps to PROVIDER_ERROR (502)', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler((url, config) => ({
      status: 200,
      data: {
        status_cd: '0',
        error: {
          error_cd: 'CUSTOM999',
          message: 'Some internal raw provider error text'
        }
      }
    }));

    let caughtError = null;
    try {
      await adapter.getReturn('GSTR3B', '27AAAAA0000A1Z5', '092026', testToken, 'testuser');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected getReturn to throw');
    assert.equal(caughtError.code, 'PROVIDER_ERROR');
    assert.equal(caughtError.statusCode, 502);
    assert.equal(caughtError.message, 'Could not complete the request. Please try again.');
    assert.ok(!caughtError.message.includes('internal raw'), 'Never forward raw provider message');

    assert.equal(fakeClient.calls.length, 1);
    const call = fakeClient.calls[0];
    assert.equal(call.url, '/taxpayerapi/dec/v0.3/returns/gstr3b');
    assert.equal(call.config.params.action, 'RETSUM');
  });

  // 6. Check timeout -> PROVIDER_DOWN (503)
  await runAsyncCheck('6. Timeout maps to PROVIDER_DOWN (503)', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler(() => {
      const err = new Error('timeout of 20000ms exceeded');
      err.code = 'ECONNABORTED';
      throw err;
    });

    let caughtError = null;
    try {
      await adapter.requestOtp('27AAAAA0000A1Z5', 'testuser');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.code, 'PROVIDER_DOWN');
    assert.equal(caughtError.statusCode, 503);
    assert.equal(caughtError.message, 'GST service is unavailable. Please try again later.');
  });

  // 7. Check network error / connection refused -> PROVIDER_DOWN (503)
  await runAsyncCheck('7. Network connection failure maps to PROVIDER_DOWN (503)', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler(() => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:443');
      err.code = 'ECONNREFUSED';
      throw err;
    });

    let caughtError = null;
    try {
      await adapter.verifyOtp('27AAAAA0000A1Z5', 'testuser', '123456');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.code, 'PROVIDER_DOWN');
    assert.equal(caughtError.statusCode, 503);
  });

  // 8. Check HTTP 500 / 502 / 503 -> PROVIDER_DOWN (503)
  await runAsyncCheck('8. Upstream HTTP 5xx maps to PROVIDER_DOWN (503)', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler(() => {
      const err = new Error('Request failed with status code 503');
      err.response = { status: 503, data: {} };
      throw err;
    });

    let caughtError = null;
    try {
      await adapter.getReturn('GSTR1', '27AAAAA0000A1Z5', '092026', testToken);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.code, 'PROVIDER_DOWN');
    assert.equal(caughtError.statusCode, 503);
  });

  // 9. Check HTTP 429 -> RATE_LIMITED (429)
  await runAsyncCheck('9. Upstream HTTP 429 maps to RATE_LIMITED (429)', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler(() => {
      const err = new Error('Request failed with status code 429');
      err.response = { status: 429, data: {} };
      throw err;
    });

    let caughtError = null;
    try {
      await adapter.requestOtp('27AAAAA0000A1Z5', 'testuser');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.code, 'RATE_LIMITED');
    assert.equal(caughtError.statusCode, 429);
    assert.equal(caughtError.message, 'Too many requests. Please wait and try again.');
  });

  // 10. Check HTTP 401 and 403 map to PROVIDER_AUTH (502)
  await runAsyncCheck('10. HTTP 401 and 403 map to PROVIDER_AUTH (502)', async () => {
    // 401
    fakeClient.calls = [];
    fakeClient.setHandler(() => {
      const err = new Error('Request failed with status code 401');
      err.response = { status: 401, data: {} };
      throw err;
    });

    let err401 = null;
    try {
      await adapter.getReturn('GSTR1', '27AAAAA0000A1Z5', '092026', testToken);
    } catch (err) {
      err401 = err;
    }
    assert.ok(err401, 'Expected 401 to throw');
    assert.equal(err401.code, 'PROVIDER_AUTH');
    assert.equal(err401.statusCode, 502);
    assert.equal(err401.message, 'Could not complete the request. Please try again.');

    // 403
    fakeClient.calls = [];
    fakeClient.setHandler(() => {
      const err = new Error('Request failed with status code 403');
      err.response = { status: 403, data: {} };
      throw err;
    });

    let err403 = null;
    try {
      await adapter.requestOtp('27AAAAA0000A1Z5', 'testuser');
    } catch (err) {
      err403 = err;
    }
    assert.ok(err403, 'Expected 403 to throw');
    assert.equal(err403.code, 'PROVIDER_AUTH');
    assert.equal(err403.statusCode, 502);
    assert.equal(err403.message, 'Could not complete the request. Please try again.');
  });

  // 11. Check error_cd listed in SESSION_ERROR_CODES maps to SESSION_EXPIRED (401)
  await runAsyncCheck('11. error_cd listed in SESSION_ERROR_CODES maps to SESSION_EXPIRED (401)', async () => {
    SESSION_ERROR_CODES.push('TOKEN_EXPIRED_TEST');
    try {
      fakeClient.calls = [];
      fakeClient.setHandler(() => ({
        status: 200,
        data: {
          status_cd: '0',
          error: {
            error_cd: 'TOKEN_EXPIRED_TEST',
            message: 'Token has expired on GST portal'
          }
        }
      }));

      let caughtError = null;
      try {
        await adapter.getReturn('GSTR1', '27AAAAA0000A1Z5', '092026', testToken);
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError, 'Expected SESSION_ERROR_CODES match to throw');
      assert.equal(caughtError.code, 'SESSION_EXPIRED');
      assert.equal(caughtError.statusCode, 401);
      assert.equal(caughtError.message, 'Please verify OTP again.');
      assert.ok(!caughtError.message.includes('Token has expired'), 'Never forward raw provider message');
    } finally {
      SESSION_ERROR_CODES.pop();
    }
  });

  // 12. GSTIN search not provided -> PROVIDER_ERROR (502) with server-side TODO
  await runAsyncCheck('12. searchGstin not supported by TaxPro throws PROVIDER_ERROR (502)', async () => {
    let caughtError = null;
    try {
      await adapter.searchGstin('27AAAAA0000A1Z5');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.code, 'PROVIDER_ERROR');
    assert.equal(caughtError.statusCode, 502);
  });

  // 13. Returns summary not provided -> PROVIDER_ERROR (502) with server-side TODO
  await runAsyncCheck('13. getReturnsSummary not supported by TaxPro throws PROVIDER_ERROR (502)', async () => {
    let caughtError = null;
    try {
      await adapter.getReturnsSummary('27AAAAA0000A1Z5', '092026', testToken);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.code, 'PROVIDER_ERROR');
    assert.equal(caughtError.statusCode, 502);
  });

  // 14. Mappers in TaxPro mode throw PROVIDER_ERROR with "mapper needs real sample"
  runCheck('14. ReturnService mappers in TaxPro mode throw PROVIDER_ERROR', () => {
    assert.throws(
      () => ReturnService.mapGstr1({ some: 'data' }, '092026', 'taxpro'),
      (err) => err.code === 'PROVIDER_ERROR' && err.statusCode === 502 && err.message.includes('mapper needs real sample')
    );

    assert.throws(
      () => ReturnService.mapGstr2b({ some: 'data' }, '092026', 'taxpro'),
      (err) => err.code === 'PROVIDER_ERROR' && err.statusCode === 502 && err.message.includes('mapper needs real sample')
    );

    assert.throws(
      () => ReturnService.mapGstr3b({ some: 'data' }, '092026', 'taxpro'),
      (err) => err.code === 'PROVIDER_ERROR' && err.statusCode === 502 && err.message.includes('mapper needs real sample')
    );
  });

  // 15. In taxpro mode: POST /api/gstin/search returns verified: false and never calls provider
  await runAsyncCheck('15. Controller in taxpro mode returns verified: false and never calls provider', async () => {
    const gstinController = require('../src/controllers/gstin.controller');
    const taxproAdapter = require('../src/services/providers/taxpro');

    const prevProvider = process.env.PROVIDER;
    const prevUseMock = process.env.USE_MOCK;

    let providerCalled = false;
    const origSearchGstin = taxproAdapter.searchGstin;
    taxproAdapter.searchGstin = async () => {
      providerCalled = true;
      throw new Error('Provider searchGstin should NOT be called in taxpro mode');
    };

    try {
      process.env.PROVIDER = 'taxpro';
      process.env.USE_MOCK = 'false';

      // (a) Valid GSTIN returns verified: false with null names
      let responseStatus = null;
      let responseData = null;
      const req = {
        body: { gstin: '27AAAAA0000A1Z5' }
      };
      const res = {
        status(s) {
          responseStatus = s;
          return this;
        },
        json(d) {
          responseData = d;
          return this;
        }
      };
      let nextError = null;
      await gstinController.search(req, res, (err) => { nextError = err; });

      assert.equal(nextError, null, 'Expected no error for valid GSTIN in taxpro mode');
      assert.equal(responseStatus, 200, 'Expected status 200');
      assert.equal(responseData.success, true, 'Expected success: true');
      assert.equal(responseData.gstin, '27AAAAA0000A1Z5');
      assert.equal(responseData.legalName, null, 'Expected legalName: null');
      assert.equal(responseData.tradeName, null, 'Expected tradeName: null');
      assert.equal(responseData.status, null, 'Expected status: null');
      assert.equal(responseData.verified, false, 'Expected verified: false');
      assert.equal(providerCalled, false, 'Provider searchGstin must NEVER be called');

      // (b) Invalid GSTIN format must still be rejected with INVALID_GSTIN (400)
      let badFormatError = null;
      const badReq = { body: { gstin: 'BAD_FORMAT' } };
      await gstinController.search(badReq, res, (err) => { badFormatError = err; });
      assert.ok(badFormatError, 'Expected bad format to trigger error');
      assert.equal(badFormatError.code, 'INVALID_GSTIN');
      assert.equal(badFormatError.statusCode, 400);
      assert.equal(providerCalled, false, 'Provider searchGstin must NEVER be called even on bad format');
    } finally {
      taxproAdapter.searchGstin = origSearchGstin;
      process.env.PROVIDER = prevProvider;
      process.env.USE_MOCK = prevUseMock;
    }
  });

  // 16. STRENGTHENED SECURITY LEAK TEST: TESTASP, TESTPASS, TESTTOKEN must NEVER appear
  await runAsyncCheck('16. Strengthened credential leak test: TESTASP, TESTPASS, TESTTOKEN never logged or returned', async () => {
    const capturedLogs = [];

    // Intercept console logging methods
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug
    };

    const interceptor = (level) => (...args) => {
      const formatted = args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
      capturedLogs.push(`[${level}] ${formatted}`);
    };

    console.log = interceptor('log');
    console.error = interceptor('error');
    console.warn = interceptor('warn');
    console.info = interceptor('info');
    console.debug = interceptor('debug');

    const thrownErrors = [];

    try {
      // (a) a response with status_cd "2" whose body contains auth_token TESTTOKEN
      fakeClient.setHandler(() => ({
        status: 200,
        data: {
          status_cd: '2',
          auth_token: testToken,
          message: `Unexpected status code body containing ${testToken}`
        }
      }));
      try {
        await adapter.verifyOtp('27AAAAA0000A1Z5', 'testuser', '123456');
      } catch (e) {
        thrownErrors.push(e);
      }

      // (b) a non-object response containing TESTTOKEN
      fakeClient.setHandler(() => ({
        status: 200,
        data: `<html><body>Error with token ${testToken}</body></html>`
      }));
      try {
        await adapter.requestOtp('27AAAAA0000A1Z5', 'testuser');
      } catch (e) {
        thrownErrors.push(e);
      }

      // (c) status_cd "0" with an unknown error_cd and a message containing TESTPASS
      fakeClient.setHandler(() => ({
        status: 200,
        data: {
          status_cd: '0',
          error: {
            error_cd: 'UNKNOWN_CODE',
            message: `Authentication failed for password ${testPassword} on GST portal`
          }
        }
      }));
      try {
        await adapter.getReturn('GSTR1', '27AAAAA0000A1Z5', '092026', testToken, 'testuser');
      } catch (e) {
        thrownErrors.push(e);
      }

      // (d) a thrown error whose config.params contains TESTASP, TESTPASS and TESTTOKEN
      fakeClient.setHandler(() => {
        const axiosErr = new Error('Request failed with status code 500');
        axiosErr.config = {
          url: `/taxpayerapi/dec/v1.0/authenticate?aspid=${testAspid}&password=${testPassword}&authtoken=${testToken}`,
          params: {
            aspid: testAspid,
            password: testPassword,
            authtoken: testToken
          }
        };
        axiosErr.response = {
          status: 500,
          data: {
            error: {
              error_cd: 'SERVER_ERR',
              message: `Server failed with ${testAspid}`
            }
          }
        };
        throw axiosErr;
      });
      try {
        await adapter.getReturn('GSTR2B', '27AAAAA0000A1Z5', '012022', testToken, 'testuser');
      } catch (e) {
        thrownErrors.push(e);
      }
    } finally {
      // Restore original console
      console.log = originalConsole.log;
      console.error = originalConsole.error;
      console.warn = originalConsole.warn;
      console.info = originalConsole.info;
      console.debug = originalConsole.debug;
    }

    const secrets = [testAspid, testPassword, testToken];

    // Assert that none of these strings appear in the captured logger output
    for (const logLine of capturedLogs) {
      for (const secret of secrets) {
        assert.ok(
          !logLine.includes(secret),
          `SECURITY LEAK: Found secret "${secret}" in log output: ${logLine}`
        );
      }
    }

    // Assert that none of these strings appear in the thrown error or in its JSON.stringify
    for (const err of thrownErrors) {
      const errString = JSON.stringify(err);
      const msg = err.message || '';
      const name = err.name || '';
      const code = err.code || '';
      const fullErr = `${name}: ${msg} (code: ${code}) ${errString}`;

      for (const secret of secrets) {
        assert.ok(
          !fullErr.includes(secret),
          `SECURITY LEAK: Found secret "${secret}" in thrown error: ${fullErr}`
        );
      }
    }

    assert.equal(thrownErrors.length, 4, 'Expected all 4 leak test cases to have thrown errors');
    assert.ok(capturedLogs.length > 0, 'Expected logger output to have been generated and evaluated');
  });

  console.log('\n🎉 ALL TAXPRO ADAPTER TESTS PASSED! (0 leaks, 100% assertions satisfied)\n');
}

main().catch((err) => {
  console.error('\n❌ TaxPro adapter test suite failed:', err);
  process.exit(1);
});
