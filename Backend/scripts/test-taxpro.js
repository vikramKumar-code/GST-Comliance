process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  TaxProProvider,
  SESSION_ERROR_CODES,
  checkTaxProResponse,
  mapTaxProErrorCode,
  formatSafeHeaderDiagnostics
} = require('../src/services/providers/taxpro');
const {
  formatSafeHeaderDiagnostics: collectorFormatDiagnostics,
  providerErrorMessage,
  formatSafeNetworkDiagnostics
} = require('./capture-taxpro-samples');
const ReturnService = require('../src/services/return.service');
const FinaggService = require('../src/services/finagg.service');
const ApiError = require('../src/utils/apiError');
const logger = require('../src/utils/logger');
const { sanitizeSample } = require('./sanitize-sample');
const {
  TaxProGspSession,
  aesEncryptBase64,
  aesDecryptBase64,
  createSignedContent,
  formatTaxProTimestamp
} = require('../src/services/providers/taxproGspSession');

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

  async post(url, body, config) {
    this.calls.push({ url, body, config });
    if (!this.handler) throw new Error('FakeHttpClient: No handler configured');
    return this.handler(url, { ...config, body });
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

  runCheck('sample sanitizer redacts credentials and taxpayer personal data but preserves shape', () => {
    const cleaned = sanitizeSample({
      status_cd: '1',
      gstin: '27AAAAA0000A1Z5',
      legalName: 'Example Person',
      email: 'owner@example.com',
      mobile: '9876543210',
      auth_token: 'sample-token',
      invoiceNo: 'INV-0001',
      amount: 1234
    });
    assert.deepEqual(cleaned, {
      status_cd: '1',
      gstin: 'REDACTED',
      legalName: 'REDACTED',
      email: 'REDACTED',
      mobile: 'REDACTED',
      auth_token: 'REDACTED',
      invoiceNo: 'REDACTED',
      amount: 1234
    });
  });

  runCheck('TaxPro GetKey RSA signature and AES session-key wrapping match the published demo algorithm', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    const aspPassword = crypto.randomBytes(32).toString('base64');
    const sessionKey = crypto.randomBytes(32).toString('base64');
    const encryptedSessionKey = aesEncryptBase64(sessionKey, aspPassword);
    assert.equal(aesDecryptBase64(encryptedSessionKey, aspPassword), sessionKey);
    assert.throws(() => aesEncryptBase64('%%%invalid%%%', sessionKey), /Base64/);
    assert.throws(() => aesDecryptBase64('AQID', aspPassword), /invalid length/);
    const timestamp = formatTaxProTimestamp(new Date(2026, 9, 22, 15, 4, 5, 6));
    assert.match(timestamp, /^22102026150405006000$/);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxpro-key-test-'));
    const keyPath = path.join(tempDir, 'test-key.pem');
    try {
      fs.writeFileSync(keyPath, privateKey, { flag: 'wx' });
      const signature = createSignedContent('TESTASP', timestamp, keyPath);
      assert.equal(crypto.verify(
        'RSA-SHA256',
        Buffer.from(`TESTASP${timestamp}`, 'utf8'),
        publicKey,
        Buffer.from(signature, 'base64')
      ), true);
    } finally {
      if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
      fs.rmdirSync(tempDir);
    }
  });

  await runAsyncCheck('TaxPro GSP GetKey session is signed, transaction-bound, cached, and sends only encrypted ASP secret', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxpro-session-test-'));
    const keyPath = path.join(tempDir, 'test-key.pem');
    const aspPassword = crypto.randomBytes(32).toString('base64');
    const sessionKey = crypto.randomBytes(32).toString('base64');
    const httpClient = new FakeHttpClient();
    let now = new Date(2026, 9, 22, 15, 4, 5, 6).getTime();
    try {
      fs.writeFileSync(keyPath, privateKey, { flag: 'wx' });
      httpClient.setHandler((url, config) => {
        assert.equal(url, '/aspapi/v1.0/getKey');
        const { body, headers } = config;
        assert.equal(headers.aspid, 'TESTASP');
        assert.ok(crypto.verify(
          'RSA-SHA256',
          Buffer.from(`TESTASP${body.timestamp}`, 'utf8'),
          publicKey,
          Buffer.from(body.signed_content, 'base64')
        ));
        return {
          status: 200,
          data: {
            status_cd: '1',
            txn: headers.txn,
            session_id: 'TEST_SESSION',
            validity_min: 30,
            enc_key: aesEncryptBase64(sessionKey, aspPassword)
          }
        };
      });
      const session = new TaxProGspSession({
        aspid: 'TESTASP',
        password: aspPassword,
        privateKeyPath: keyPath,
        httpClient,
        now: () => now
      });
      const headers = await session.getHeaders();
      assert.equal(headers.aspid, 'TESTASP');
      assert.equal(headers['session-id'], 'TEST_SESSION');
      assert.equal(headers['asp-secret'], aesEncryptBase64(aspPassword, sessionKey));
      assert.notEqual(headers['asp-secret'], aspPassword);
      assert.equal(httpClient.calls.filter((call) => call.url === '/aspapi/v1.0/getKey').length, 1);
      await session.getHeaders();
      assert.equal(httpClient.calls.filter((call) => call.url === '/aspapi/v1.0/getKey').length, 1);
      now += 26 * 60 * 1000;
      await session.getHeaders();
      assert.equal(httpClient.calls.filter((call) => call.url === '/aspapi/v1.0/getKey').length, 2);
    } finally {
      if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
      fs.rmdirSync(tempDir);
    }
  });

  runCheck('operational logger redacts TaxPro credentials and taxpayer identifiers in nested metadata', () => {
    const captured = [];
    const originalLog = console.log;
    console.log = (...args) => captured.push(args.map((value) => (
      typeof value === 'string' ? value : JSON.stringify(value)
    )).join(' '));
    try {
      logger.info('redaction-test', {
        nested: {
          aspid: 'TEST_ASPID_VALUE',
          'asp-secret': 'TEST_ASP_SECRET_VALUE',
          gstin: '27AAAAA0000A1Z5',
          username: 'TEST_TAXPAYER_USERNAME',
          session_id: 'TEST_SESSION_VALUE',
          email: 'test@example.com'
        }
      });
    } finally {
      console.log = originalLog;
    }
    const output = captured.join('\n');
    for (const value of [
      'TEST_ASPID_VALUE', 'TEST_ASP_SECRET_VALUE', '27AAAAA0000A1Z5',
      'TEST_TAXPAYER_USERNAME', 'TEST_SESSION_VALUE', 'test@example.com'
    ]) {
      assert.ok(!output.includes(value), `Logger must not emit ${value}`);
    }
    assert.equal((output.match(/\[REDACTED\]/g) || []).length, 6);
  });

  runCheck('TaxPro adapter accepts only the exact official sandbox and production hosts', () => {
    assert.doesNotThrow(() => new TaxProProvider({ baseURL: 'https://gstapi.charteredinfo.com' }));
    assert.throws(
      () => new TaxProProvider({ baseURL: 'https://fake.charteredinfo.com' }),
      /official TaxPro sandbox or production host/
    );
  });

  runCheck('documented GSP errors map to safe auth, rate-limit, and outage classes', () => {
    const cases = [
      ['GSP022', 'PROVIDER_AUTH', 502, 'Could not complete the request. Please try again.'],
      ['GSP025', 'RATE_LIMITED', 429, 'Too many requests. Please wait and try again.'],
      ['GSP030', 'PROVIDER_DOWN', 503, 'GST service is unavailable. Please try again later.'],
      ['GSP101', 'PROVIDER_ERROR', 502, 'Could not complete the request. Please try again.'],
      ['RET2B1023', 'DATA_NOT_AVAILABLE', 404, 'Data for this period is not available yet. Try another month.'],
      ['GSP500', 'PROVIDER_DOWN', 503, 'GST service is unavailable. Please try again later.'],
      ['UNKNOWN999', 'PROVIDER_ERROR', 502, 'Could not complete the request. Please try again.']
    ];
    for (const [providerCode, expectedCode, expectedStatus, expectedMessage] of cases) {
      const mapped = mapTaxProErrorCode(providerCode);
      assert.equal(mapped.code, expectedCode, `${providerCode} should map to ${expectedCode}`);
      assert.equal(mapped.statusCode, expectedStatus, `${providerCode} should map to HTTP ${expectedStatus}`);
      assert.equal(mapped.message, expectedMessage);
    }
  });

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
    assert.equal(call.config.headers.aspid, testAspid);
    assert.equal(call.config.headers.password, testPassword);
    assert.equal(call.config.params.aspid, undefined);
    assert.equal(call.config.params.password, undefined);
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
    assert.equal(call.config.params.OTP, '123456');
    assert.equal(call.config.headers.aspid, testAspid);
    assert.equal(call.config.headers.password, testPassword);
    assert.equal(call.config.params.aspid, undefined);
    assert.equal(call.config.params.password, undefined);
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
    assert.equal(call.config.headers['auth-token'], testToken);
    assert.equal(call.config.headers.authtoken, undefined, 'Must not send duplicate authtoken header');
    assert.equal(call.config.params.gstin, '27AAAAA0000A1Z5');
    assert.equal(call.config.params.authtoken, undefined);
    assert.equal(call.config.params.password, undefined);
    assert.equal(call.config.params.aspid, undefined);
  });

  await runAsyncCheck('current API profile uses current routes and documented common headers', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler(() => ({ status: 200, data: { status_cd: '1' } }));
    const currentAdapter = new TaxProProvider({
      httpClient: fakeClient,
      aspid: testAspid,
      password: testPassword,
      apiProfile: 'current',
      gstr1ActionRequired: 'N',
      ipUsr: '203.0.113.1'
    });

    await currentAdapter.getReturn('GSTR1', '27AAAAA0000A1Z5', '092026', testToken, 'testuser');
    await currentAdapter.getReturn('GSTR3B', '27AAAAA0000A1Z5', '092026', testToken, 'testuser');
    await currentAdapter.getReturn('GSTR2B', '27AAAAA0000A1Z5', '092026', testToken, 'testuser');

    assert.deepEqual(fakeClient.calls.map((call) => call.url), [
      '/taxpayerapi/dec/v4.1/returns/gstr1',
      '/taxpayerapi/dec/v7.0/returns/gstr3b',
      '/taxpayerapi/dec/v4.2/returns/gstr2b'
    ]);
    assert.equal(fakeClient.calls[0].config.params.action_required, 'N');
    for (const call of fakeClient.calls) {
      assert.equal(call.config.headers['auth-token'], testToken, 'Must send hyphenated auth-token header');
      assert.equal(call.config.headers.authtoken, undefined, 'Must not send duplicate authtoken header');
      assert.equal(call.config.params.gstin, '27AAAAA0000A1Z5', 'TaxPro current profile requires gstin in query parameters');
      assert.equal(call.config.params.username, undefined);
      assert.equal(call.config.params.ret_prd, undefined);
      assert.equal(call.config.headers.gstin, '27AAAAA0000A1Z5');
      assert.equal(call.config.headers['state-cd'], '27', 'TaxPro current profile requires state-cd header');
      assert.equal(call.config.headers.username, 'testuser');
      assert.equal(call.config.headers.ret_prd, '092026');
      assert.equal(call.config.headers['ip-usr'], '203.0.113.1', 'Must forward ip-usr header from config');
      assert.match(
        call.config.headers.txn,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        'Must send unique UUID v4 txn transaction ID'
      );
    }
    const txns = fakeClient.calls.map((call) => call.config.headers.txn);
    assert.equal(new Set(txns).size, 3, 'Each return request must receive a unique txn transaction ID');
    assert.equal(fakeClient.calls[0].config.params.rtnprd, undefined, 'GSTR-1 does not include rtnprd in query params');
    assert.equal(fakeClient.calls[1].config.params.rtnprd, undefined, 'GSTR-3B does not include rtnprd in query params');
    assert.equal(fakeClient.calls[2].config.params.rtnprd, '092026', 'GSTR-2B GET2B requires rtnprd in query parameters');
    assert.equal(fakeClient.calls[2].config.headers.ret_prd, '092026', 'GSTR-2B preserves ret_prd header');
  });

  await runAsyncCheck('legacy API profile matches the TaxPro sandbox email routes and period fields', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler(() => ({ status: 200, data: { status_cd: '1' } }));
    await adapter.getReturn('GSTR1', '27AAAAA0000A1Z5', '022022', testToken, 'testuser');
    await adapter.getReturn('GSTR3B', '27AAAAA0000A1Z5', '022022', testToken, 'testuser');
    await adapter.getReturn('GSTR2B', '27AAAAA0000A1Z5', '012022', testToken, 'testuser');

    assert.deepEqual(fakeClient.calls.map((call) => call.url), [
      '/taxpayerapi/dec/v2.1/returns/gstr1',
      '/taxpayerapi/dec/v0.3/returns/gstr3b',
      '/taxpayerapi/dec/v1.0/returns/gstr2b'
    ]);
    assert.equal(fakeClient.calls[0].config.params.ret_period, '022022');
    assert.equal(fakeClient.calls[1].config.params.ret_period, '022022');
    assert.equal(fakeClient.calls[2].config.params.ret_period, '012022');
    assert.equal(fakeClient.calls[2].config.params.rtnprd, '012022');
    for (const call of fakeClient.calls) {
      assert.equal(call.config.headers.aspid, testAspid);
      assert.equal(call.config.headers.password, testPassword);
      assert.equal(call.config.headers['auth-token'], testToken, 'Must send hyphenated auth-token header');
      assert.equal(call.config.headers.authtoken, undefined, 'Must not send duplicate authtoken header');
      assert.equal(call.config.params.gstin, '27AAAAA0000A1Z5');
      assert.equal(call.config.params.aspid, undefined);
      assert.equal(call.config.params.password, undefined);
      assert.equal(call.config.params.authtoken, undefined);
    }
  });

  await runAsyncCheck('current API profile requires only the GSTR-1 action flag confirmation', async () => {
    fakeClient.calls = [];
    const unconfirmedAdapter = new TaxProProvider({
      httpClient: fakeClient,
      apiProfile: 'current',
      ipUsr: '203.0.113.1'
    });
    await assert.rejects(
      () => unconfirmedAdapter.getReturn('GSTR1', '27AAAAA0000A1Z5', '092026', testToken, 'testuser'),
      (error) => error.code === 'PROVIDER_ERROR' && error.statusCode === 502
    );
    assert.equal(fakeClient.calls.length, 0);

    await unconfirmedAdapter.getReturn('GSTR3B', '27AAAAA0000A1Z5', '092026', testToken, 'testuser');
    await unconfirmedAdapter.getReturn('GSTR2B', '27AAAAA0000A1Z5', '092026', testToken, 'testuser');
    assert.equal(fakeClient.calls.length, 2);
    assert.equal(fakeClient.calls[0].config.headers.ret_prd, '092026');
    assert.equal(fakeClient.calls[1].config.headers.ret_prd, '092026');
    assert.equal(fakeClient.calls[0].config.headers['auth-token'], testToken);
    assert.equal(fakeClient.calls[1].config.headers['auth-token'], testToken);
    assert.equal(fakeClient.calls[0].config.headers['state-cd'], '27');
    assert.equal(fakeClient.calls[1].config.headers['state-cd'], '27');
    assert.equal(fakeClient.calls[0].config.headers.authtoken, undefined);
    assert.equal(fakeClient.calls[1].config.headers.authtoken, undefined);
    assert.equal(fakeClient.calls[0].config.params.gstin, '27AAAAA0000A1Z5');
    assert.equal(fakeClient.calls[1].config.params.gstin, '27AAAAA0000A1Z5');
    assert.equal(fakeClient.calls[0].config.headers['ip-usr'], '203.0.113.1');
    assert.equal(fakeClient.calls[1].config.headers['ip-usr'], '203.0.113.1');
    assert.match(
      fakeClient.calls[0].config.headers.txn,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    assert.match(
      fakeClient.calls[1].config.headers.txn,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    assert.notEqual(fakeClient.calls[0].config.headers.txn, fakeClient.calls[1].config.headers.txn);
    assert.equal(fakeClient.calls[1].config.params.rtnprd, '092026');
  });

  await runAsyncCheck('current API profile fails safely when TAXPRO_GSP_IP_USR is missing', async () => {
    fakeClient.calls = [];
    const savedEnvIp = process.env.TAXPRO_GSP_IP_USR;
    delete process.env.TAXPRO_GSP_IP_USR;
    try {
      const noIpAdapter = new TaxProProvider({
        httpClient: fakeClient,
        aspid: testAspid,
        password: testPassword,
        apiProfile: 'current',
        gstr1ActionRequired: 'N',
        ipUsr: ''
      });

      await assert.rejects(
        () => noIpAdapter.getReturn('GSTR1', '27AAAAA0000A1Z5', '092026', testToken, 'testuser'),
        (error) => {
          assert.equal(error.code, 'PROVIDER_ERROR');
          assert.equal(error.statusCode, 500);
          assert.match(error.message, /TAXPRO_GSP_IP_USR is required/);
          return true;
        }
      );
      assert.equal(fakeClient.calls.length, 0, 'No HTTP request should be sent when ip-usr is missing');
    } finally {
      if (savedEnvIp !== undefined) {
        process.env.TAXPRO_GSP_IP_USR = savedEnvIp;
      } else {
        delete process.env.TAXPRO_GSP_IP_USR;
      }
    }
  });

  runCheck('safe header diagnostics reports header names and presence only, never values or secrets', () => {
    const testHeaders = {
      aspid: testAspid,
      password: testPassword,
      'auth-token': testToken,
      gstin: '27AAAAA0000A1Z5',
      'state-cd': '27',
      ret_prd: '092026',
      txn: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      'ip-usr': '203.0.113.1',
      empty_field: '',
      null_field: null,
      undef_field: undefined
    };

    for (const fn of [formatSafeHeaderDiagnostics, collectorFormatDiagnostics]) {
      const diagnostics = fn(testHeaders);
      assert.deepEqual(diagnostics, {
        aspid: '[PRESENT]',
        password: '[PRESENT]',
        'auth-token': '[PRESENT]',
        gstin: '[PRESENT]',
        'state-cd': '[PRESENT]',
        ret_prd: '[PRESENT]',
        txn: '[PRESENT]',
        'ip-usr': '[PRESENT]',
        empty_field: '[EMPTY]',
        null_field: '[EMPTY]',
        undef_field: '[EMPTY]'
      });

      const serialized = JSON.stringify(diagnostics);
      const sensitiveValues = [
        testAspid, testPassword, testToken,
        '27AAAAA0000A1Z5', '092026', '3fa85f64-5717-4562-b3fc-2c963f66afa6', '203.0.113.1'
      ];
      for (const val of sensitiveValues) {
        assert.ok(!serialized.includes(val), `Serialized safe diagnostics must not leak "${val}"`);
      }
    }
  });

  runCheck('safe provider error message extraction sanitizes sensitive taxpayer and credential strings', () => {
    assert.equal(providerErrorMessage(null), null);
    assert.equal(providerErrorMessage({}), null);
    assert.equal(providerErrorMessage({ status_cd: '0' }), null);

    const normal = providerErrorMessage({
      status_cd: '0',
      error: {
        error_cd: 'AUTH4037',
        message: 'GSTN Error: API Access is not enabled for the taxpayer'
      }
    });
    assert.equal(normal, 'GSTN Error: API Access is not enabled for the taxpayer');

    const withSensitive = providerErrorMessage({
      status_cd: '0',
      error: {
        error_cd: 'AUTH403',
        message: 'Error for 27AAAAA0000A1Z5 user test@example.com phone 9876543210 pan ABCDE1234F token abcdef0123456789abcdef0123456789\r\n'
      }
    });
    assert.ok(!withSensitive.includes('27AAAAA0000A1Z5'));
    assert.ok(!withSensitive.includes('test@example.com'));
    assert.ok(!withSensitive.includes('9876543210'));
    assert.ok(!withSensitive.includes('ABCDE1234F'));
    assert.ok(!withSensitive.includes('abcdef0123456789abcdef0123456789'));
    assert.ok(withSensitive.includes('REDACTED'));
    assert.ok(!withSensitive.includes('\r'));
    assert.ok(!withSensitive.includes('\n'));

    const maxSession = providerErrorMessage({
      status_cd: '0',
      error: {
        error_cd: 'AUTH403',
        message: 'GSTN Error: Maximum session allowed for user with this GSP account exceeded.'
      }
    });
    assert.equal(maxSession, 'GSTN Error: Maximum session allowed for user with this GSP account exceeded.');
  });

  // 4. Check the AUTH4041 response independently; source call is undocumented.
  await runAsyncCheck('4. AUTH4041 sample maps to PROVIDER_ERROR (502) without assuming its source call', async () => {
    fakeClient.calls = [];

    let caughtError = null;
    try {
      checkTaxProResponse(auth4041Error, 'sample-AUTH4041');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected getReturn to throw an error');
    assert.equal(caughtError.code, 'PROVIDER_ERROR', 'Expected code: PROVIDER_ERROR');
    assert.equal(caughtError.statusCode, 502, 'Expected HTTP 502');
    assert.equal(caughtError.message, 'Could not complete the request. Please try again.');
    assert.ok(!caughtError.message.includes('state-cd'), 'Must never forward raw provider message');

    assert.equal(fakeClient.calls.length, 0, 'The sample does not identify an API call; do not invent one');
  });

  // 5. Check unknown error_cd -> PROVIDER_ERROR (502)
  await runAsyncCheck('5. Unknown error_cd maps to PROVIDER_ERROR (502)', async () => {
    fakeClient.calls = [];
    let caughtError = null;
    try {
      checkTaxProResponse({
        status_cd: '0',
        error: {
          error_cd: 'CUSTOM999',
          message: 'Some internal raw provider error text'
        }
      }, 'unknown-error-test');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected provider response validation to throw');
    assert.equal(caughtError.code, 'PROVIDER_ERROR');
    assert.equal(caughtError.statusCode, 502);
    assert.equal(caughtError.message, 'Could not complete the request. Please try again.');
    assert.ok(!caughtError.message.includes('internal raw'), 'Never forward raw provider message');

    assert.equal(fakeClient.calls.length, 0, 'Error mapping must not depend on unconfirmed endpoint paths');
  });

  // 5b. Check GSP101 provider error envelope -> PROVIDER_ERROR (502)
  await runAsyncCheck('5b. GSP101 provider error envelope maps to PROVIDER_ERROR (502) without raw detail leaks', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler(() => ({
      status: 200,
      data: {
        status_cd: '0',
        error: {
          error_cd: 'GSP101',
          message: 'Error: Missing GST mandatory parms Gstin and/or auth-token.'
        }
      }
    }));

    let caughtError = null;
    try {
      await adapter.getReturn('GSTR3B', '27AAAAA0000A1Z5', '092026', testToken, 'testuser');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected getReturn to throw on GSP101 error envelope');
    assert.equal(caughtError.code, 'PROVIDER_ERROR');
    assert.equal(caughtError.statusCode, 502);
    assert.equal(caughtError.message, 'Could not complete the request. Please try again.');
    assert.ok(!caughtError.message.includes('Missing GST'), 'Never forward raw GSP101 provider message');
    assert.ok(!caughtError.message.includes('auth-token'), 'Never forward raw provider error details');
  });

  // 5c. Check RET2B1023 provider error envelope -> DATA_NOT_AVAILABLE (404)
  runCheck('5c. RET2B1023 provider error envelope validates to DATA_NOT_AVAILABLE (404)', () => {
    assert.throws(
      () => checkTaxProResponse({
        status_cd: '0',
        error: {
          error_cd: 'RET2B1023',
          message: 'GSTN Error: Data for the requested period is not available'
        }
      }, 'test-RET2B1023'),
      (err) => err.code === 'DATA_NOT_AVAILABLE' &&
               err.statusCode === 404 &&
               err.message === 'Data for this period is not available yet. Try another month.' &&
               !err.message.includes('GSTN Error')
    );
  });

  // 5d. Check AUTH403 provider error stops requestOtp flow immediately without retrying
  await runAsyncCheck('5d. AUTH403 provider error stops requestOtp immediately without repeated requests', async () => {
    fakeClient.calls = [];
    fakeClient.setHandler(() => {
      const err = new Error('Request failed with status code 400');
      err.response = {
        status: 400,
        data: {
          status_cd: '0',
          error: {
            error_cd: 'AUTH403',
            message: 'GSTN Error: Maximum session allowed for user with this GSP account exceeded.'
          }
        }
      };
      throw err;
    });

    let caughtError = null;
    try {
      await adapter.requestOtp('33AANCS2882A1ZG', 'TN_NT2.2265');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected requestOtp to throw an error on AUTH403');
    assert.equal(caughtError.code, 'PROVIDER_ERROR');
    assert.equal(caughtError.statusCode, 502);
    assert.equal(caughtError.message, 'Could not complete the request. Please try again.');
    assert.ok(!caughtError.message.includes('Maximum session'), 'Never forward raw provider message');
    assert.ok(!caughtError.message.includes('GSP account'), 'Never forward raw provider message');

    // Regression check: exactly 1 request was dispatched. Proves no automated retry occurs on AUTH403.
    assert.equal(fakeClient.calls.length, 1, 'requestOtp must halt immediately without repeated requests on AUTH403');
    assert.equal(fakeClient.calls[0].url, '/taxpayerapi/dec/v1.0/authenticate');
    assert.equal(fakeClient.calls[0].config.params.action, 'OTPREQUEST');
    assert.equal(fakeClient.calls[0].config.params.gstin, '33AANCS2882A1ZG');
    assert.equal(fakeClient.calls[0].config.params.username, 'TN_NT2.2265');
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

    // Regression check: verify exactly 1 request was dispatched (no automated retries on timeout/ECONNABORTED)
    assert.equal(fakeClient.calls.length, 1, 'requestOtp must not retry on timeout/ECONNABORTED');
  });

  runCheck('safe network diagnostics distinguishes timeout, cancellation, abort, and redacts sensitive strings', () => {
    // 1. Timeout with elapsedMs
    const timeoutErr = new Error('timeout of 20000ms exceeded');
    timeoutErr.code = 'ECONNABORTED';
    timeoutErr.elapsedMs = 20042;
    const timeoutDiag = formatSafeNetworkDiagnostics(timeoutErr, 20000);
    assert.match(timeoutDiag, /condition: timed out waiting for upstream response/);
    assert.match(timeoutDiag, /code: ECONNABORTED/);
    assert.match(timeoutDiag, /message: "timeout of 20000ms exceeded"/);
    assert.match(timeoutDiag, /elapsed: 20042ms/);
    assert.match(timeoutDiag, /configured timeout: 20000ms/);

    // 2. Cancellation
    const cancelErr = new Error('Request canceled by caller');
    cancelErr.code = 'ERR_CANCELED';
    cancelErr.elapsedMs = 45;
    const cancelDiag = formatSafeNetworkDiagnostics(cancelErr, 20000);
    assert.match(cancelDiag, /condition: explicitly cancelled/);
    assert.match(cancelDiag, /code: ERR_CANCELED/);
    assert.match(cancelDiag, /elapsed: 45ms/);

    // 3. Abort without timeout (e.g. ECONNABORTED from socket abort before timeout)
    const abortErr = new Error('socket hang up');
    abortErr.code = 'ECONNABORTED';
    abortErr.elapsedMs = 1200;
    const abortDiag = formatSafeNetworkDiagnostics(abortErr, 20000);
    assert.match(abortDiag, /condition: aborted/);
    assert.match(abortDiag, /code: ECONNABORTED/);

    // 4. Connection refused
    const refusedErr = new Error('connect ECONNREFUSED 127.0.0.1:443');
    refusedErr.code = 'ECONNREFUSED';
    refusedErr.elapsedMs = 10;
    const refusedDiag = formatSafeNetworkDiagnostics(refusedErr, 20000);
    assert.match(refusedDiag, /condition: connection refused by host/);

    // 5. DNS failure
    const dnsErr = new Error('getaddrinfo ENOTFOUND gstsandbox.charteredinfo.com');
    dnsErr.code = 'ENOTFOUND';
    const dnsDiag = formatSafeNetworkDiagnostics(dnsErr, 20000);
    assert.match(dnsDiag, /condition: DNS lookup failed/);

    // 6. TCP connection timeout
    const tcpTimeoutErr = new Error('connect ETIMEDOUT 1.2.3.4:443');
    tcpTimeoutErr.code = 'ETIMEDOUT';
    tcpTimeoutErr.elapsedMs = 21000;
    const tcpTimeoutDiag = formatSafeNetworkDiagnostics(tcpTimeoutErr, 20000);
    assert.match(tcpTimeoutDiag, /condition: TCP connection timed out/);

    // 7. Sanitization of sensitive data in error message
    const sensitiveErr = new Error('failed for 27AAAAA0000A1Z5 user test@example.com token abcdef0123456789abcdef0123456789 phone 9876543210 pan ABCDE1234F');
    sensitiveErr.code = 'ECONNABORTED';
    const sensitiveDiag = formatSafeNetworkDiagnostics(sensitiveErr, 20000);
    assert.ok(!sensitiveDiag.includes('27AAAAA0000A1Z5'));
    assert.ok(!sensitiveDiag.includes('test@example.com'));
    assert.ok(!sensitiveDiag.includes('abcdef0123456789abcdef0123456789'));
    assert.ok(!sensitiveDiag.includes('9876543210'));
    assert.ok(!sensitiveDiag.includes('ABCDE1234F'));
    assert.ok(sensitiveDiag.includes('REDACTED'));
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
      await adapter.getReturn('GSTR2B', '27AAAAA0000A1Z5', '092026', testToken);
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
      await adapter.getReturn('GSTR2B', '27AAAAA0000A1Z5', '092026', testToken);
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
        await adapter.getReturn('GSTR2B', '27AAAAA0000A1Z5', '092026', testToken);
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

  // 12. Public search requires the ASP caller GSTIN.
  await runAsyncCheck('12. searchGstin fails closed when the ASP caller GSTIN is not configured', async () => {
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

  // 13. RETTRACK sends its documented request, but response mapping requires a real sample.
  await runAsyncCheck('13. RETTRACK sends target GSTIN and financial year, then gates unknown response mapping', async () => {
    const trackingClient = new FakeHttpClient();
    trackingClient.setHandler(() => ({ status: 200, data: { status_cd: '1' } }));
    const trackingAdapter = new TaxProProvider({
      httpClient: trackingClient,
      aspid: testAspid,
      password: testPassword,
      gspSession: { getHeaders: async () => ({ aspid: testAspid, txn: 'TESTTXN' }) }
    });
    let caughtError = null;
    try {
      await trackingAdapter.getReturnsSummary('27AAAAA0000A1Z5', '012026', testToken);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.code, 'PROVIDER_ERROR');
    assert.equal(caughtError.statusCode, 502);
    assert.equal(trackingClient.calls[0].url, '/commonapi/v1.0/returns');
    assert.deepEqual(trackingClient.calls[0].config.params, {
      action: 'RETTRACK', gstin: '27AAAAA0000A1Z5', fy: '2025-26'
    });
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

  // 15. In taxpro mode: POST /api/gstin/search calls TaxPro public API and marks a documented result verified.
  await runAsyncCheck('15. Controller uses configured TaxPro public search and keeps invalid GSTIN fail-closed', async () => {
    const gstinController = require('../src/controllers/gstin.controller');
    const taxproAdapter = require('../src/services/providers/taxpro');

    const prevProvider = process.env.PROVIDER;
    const prevUseMock = process.env.USE_MOCK;

    let providerCalled = 0;
    const originalGspConfig = {
      aspCallerGstin: taxproAdapter.aspCallerGstin,
      gspSession: taxproAdapter.gspSession,
      httpClient: taxproAdapter.httpClient
    };
    taxproAdapter.aspCallerGstin = '27AAAAA0000A1Z5';
    taxproAdapter.gspSession = { getHeaders: async () => ({ aspid: 'TESTASP', txn: 'TESTTXN' }) };
    taxproAdapter.httpClient = {
      get: async (url, config) => {
        providerCalled += 1;
        assert.equal(url, '/commonapi/v1.1/search');
        assert.equal(config.params.action, 'TP');
        assert.equal(config.params.gstin, '27AAAAA0000A1Z5');
        assert.equal(config.params.searchgstin, '27AAAAA0000A1Z5');
        return { status: 200, data: {
          status_cd: '1', gstin: '27AAAAA0000A1Z5', lgnm: 'Example Legal Name',
          ctb: 'Private Limited Company', sts: 'Active', rgdt: '01/07/2017', nba: ['Wholesale Business']
        } };
      }
    };

    try {
      process.env.PROVIDER = 'taxpro';
      process.env.USE_MOCK = 'false';

      // (a) Valid GSTIN is searched upstream and returned with documented fields.
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
      assert.equal(responseData.legalName, 'Example Legal Name');
      assert.equal(responseData.tradeName, null, 'Expected tradeName: null');
      assert.equal(responseData.status, 'Active');
      assert.equal(responseData.verified, true);
      assert.equal(providerCalled, 1, 'TaxPro must be called exactly once for a valid GSTIN');

      // (b) Invalid GSTIN format must still be rejected with INVALID_GSTIN (400)
      let badFormatError = null;
      const badReq = { body: { gstin: 'BAD_FORMAT' } };
      await gstinController.search(badReq, res, (err) => { badFormatError = err; });
      assert.ok(badFormatError, 'Expected bad format to trigger error');
      assert.equal(badFormatError.code, 'INVALID_GSTIN');
      assert.equal(badFormatError.statusCode, 400);
      assert.equal(providerCalled, 1, 'Invalid GSTIN must be rejected before contacting TaxPro');
    } finally {
      Object.assign(taxproAdapter, originalGspConfig);
      process.env.PROVIDER = prevProvider;
      process.env.USE_MOCK = prevUseMock;
    }
  });

  // 16. Invalid provider names must fail closed instead of silently selecting mock data.
  await runAsyncCheck('16. Invalid PROVIDER fails closed unless USE_MOCK explicitly forces mock', async () => {
    const prevProvider = process.env.PROVIDER;
    const prevUseMock = process.env.USE_MOCK;
    try {
      process.env.PROVIDER = 'taxproo';
      delete process.env.USE_MOCK;
      assert.throws(() => FinaggService.getProviderName(), /PROVIDER must be either/);

      process.env.USE_MOCK = 'true';
      assert.equal(FinaggService.getProviderName(), 'mock');
    } finally {
      if (prevProvider === undefined) delete process.env.PROVIDER;
      else process.env.PROVIDER = prevProvider;
      if (prevUseMock === undefined) delete process.env.USE_MOCK;
      else process.env.USE_MOCK = prevUseMock;
    }
  });

  // 17. STRENGTHENED SECURITY LEAK TEST: TESTASP, TESTPASS, TESTTOKEN must NEVER appear
  await runAsyncCheck('17. Strengthened credential leak test: TESTASP, TESTPASS, TESTTOKEN never logged or returned', async () => {
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
        await adapter.getReturn('GSTR2B', '27AAAAA0000A1Z5', '092026', testToken, 'testuser');
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
