process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const { TaxProProvider, computeTaxProEvcSignature } = require('../src/services/providers/taxpro');

async function run() {
  console.log('--- Testing TaxPro 3-Step EVC Return Filing Pipeline ---');

  // 1. Test HMAC Signature Computation (per doc: without indentation)
  const sampleResponse = JSON.stringify({
    gstin: '33AANCS2882A1ZG',
    ret_period: '122022',
    chksum: 'SUMMARY-CHECKSUM',
    smryTyp: 'L',
    newSumFlag: true,
    sec_sum: []
  });
  const requestBody = JSON.stringify({
    gstin: '33AANCS2882A1ZG',
    ret_period: '122022',
    chksum: 'SUMMARY-CHECKSUM',
    smryTyp: 'L',
    newSumFlag: true,
    sec_sum: []
  });
  const pan = 'ABCDE1234F';
  const otp = '123456';
  const sig = computeTaxProEvcSignature(sampleResponse, pan, otp);

  assert.ok(typeof sig === 'string', 'Signature must be a string');
  assert.equal(Buffer.from(sig, 'base64').length, 32, 'HMAC-SHA256 digest must be 32 bytes (base64 string)');
  console.log('✓ 1. computeTaxProEvcSignature produces valid 32-byte Base64 HMAC-SHA256 signature:', sig);

  // 2. Mock HttpClient to test 3-Step Flow
  const calls = [];
  const fakeClient = {
    get: async (url, config) => {
      calls.push({ method: 'GET', url, config });
      if (url.includes('/returns/gstr1') && config.params.action === 'RETSUM') {
        return {
          status: 200,
          data: sampleResponse
        };
      }
      if (url.includes('/authenticate') && config.params.action === 'EVCOTP') {
        return {
          status: 200,
          data: { status_cd: '1', message: 'OTP sent' }
        };
      }
      return { status: 200, data: { status_cd: '1' } };
    },
    post: async (url, data, config) => {
      calls.push({ method: 'POST', url, data, config });
      if (url.includes('/returns/gstr1') && config.params.action === 'RETFILE') {
        return {
          status: 200,
          data: {
            status_cd: '1',
            ack_num: 'ABDF8DF1241348'
          }
        };
      }
      return { status: 200, data: { status_cd: '1' } };
    }
  };

  const provider = new TaxProProvider({
    httpClient: fakeClient,
    aspid: 'TEST_ASPID',
    password: 'TEST_PASSWORD',
    baseUrl: 'https://gstsandbox.charteredinfo.com',
    apiProfile: 'legacy'
  });

  // Test Step 2: requestEvcOtp
  const evcRes = await provider.requestEvcOtp('33AANCS2882A1ZG', 'TN_N12.2285', 'ABCDE1234F', 'R1', 'AUTH_TOKEN_VAL');
  assert.equal(evcRes.status_cd, '1');
  const otpCall = calls[calls.length - 1];
  assert.equal(otpCall.url, '/taxpayerapi/dec/v1.0/authenticate');
  assert.equal(otpCall.config.params.action, 'EVCOTP');
  assert.equal(otpCall.config.params.aspid, 'TEST_ASPID');
  assert.equal(otpCall.config.params.gstin, '33AANCS2882A1ZG');
  assert.equal(otpCall.config.params.username, 'TN_N12.2285');
  assert.equal(otpCall.config.params.pan, 'ABCDE1234F');
  assert.equal(otpCall.config.params.form_type, 'R1');
  assert.equal(otpCall.config.params.authtoken, 'AUTH_TOKEN_VAL');
  assert.equal(otpCall.config.headers.password, 'TEST_PASSWORD');
  console.log('✓ 2. Step 2 (EVCOTP) verified: query params and headers conform exactly to spec');

  // Test Step 1 + Step 3: fileGstr1 with EVC
  const fileRes = await provider.fileGstr1('122022', {
    gstin: '33AANCS2882A1ZG',
    username: 'TN_N12.2285',
    token: 'AUTH_TOKEN_VAL',
    pan: 'ABCDE1234F',
    otp: '123456',
    mode: 'EVC'
  });

  assert.equal(fileRes.success, true);
  assert.equal(fileRes.arn, 'ABDF8DF1241348');

  // Verify Step 1 RETSUM call
  const retsumCall = calls.find((c) => c.method === 'GET' && c.config.params.action === 'RETSUM');
  assert.ok(retsumCall, 'Step 1 RETSUM must be called');
  assert.equal(retsumCall.url, '/taxpayerapi/dec/v2.0/returns/gstr1');
  assert.equal(retsumCall.config.params.action, 'RETSUM');
  assert.equal(retsumCall.config.params.aspid, 'TEST_ASPID');
  assert.equal(retsumCall.config.headers.userrole, 'GSTR1');
  assert.equal(retsumCall.config.headers.rtn_typ, 'GSTR1');
  assert.equal(retsumCall.config.params.gstin, '33AANCS2882A1ZG');
  assert.equal(retsumCall.config.params.username, 'TN_N12.2285');
  assert.equal(retsumCall.config.params.ret_period, '122022');
  assert.equal(retsumCall.config.params.authtoken, 'AUTH_TOKEN_VAL');
  assert.equal(retsumCall.config.headers['state-cd'], '33');
  assert.equal(retsumCall.config.headers.api_version, '2.1');
  assert.equal(retsumCall.config.headers.password, 'TEST_PASSWORD');
  console.log('✓ 3. Step 1 (RETSUM) verified: query params, headers, and legacy v2.0/API 2.1 path match catalogue');

  // Verify Step 3 RETFILE call
  const retfileCall = calls.find((c) => c.method === 'POST' && c.config.params.action === 'RETFILE');
  assert.ok(retfileCall, 'Step 3 RETFILE must be called');
  assert.equal(retfileCall.url, '/taxpayerapi/dec/v2.0/returns/gstr1');
  assert.equal(retfileCall.config.params.action, 'RETFILE');
  assert.equal(retfileCall.config.params.aspid, 'TEST_ASPID');
  assert.equal(retfileCall.config.params.gstin, '33AANCS2882A1ZG');
  assert.equal(retfileCall.config.params.username, 'TN_N12.2285');
  assert.equal(retfileCall.config.params.ret_period, '122022');
  assert.equal(retfileCall.config.params.authtoken, 'AUTH_TOKEN_VAL');
  assert.equal(retfileCall.config.params.st, 'EVC');
  assert.equal(retfileCall.config.params.sid, 'ABCDE1234F|123456');
  assert.equal(retfileCall.config.params.sign, sig);
  assert.equal(retfileCall.config.headers['state-cd'], '33');
  assert.equal(retfileCall.config.headers.api_version, '2.1');
  assert.equal(retfileCall.config.headers.password, 'TEST_PASSWORD');
  assert.equal(retfileCall.config.headers['Content-Type'], 'application/json');
  assert.equal(retfileCall.data, requestBody, 'Request body must match the regular RETFILE schema');
  assert.equal(retfileCall.config.params.sign, computeTaxProEvcSignature(sampleResponse, pan, otp));
  console.log('✓ 4. Step 3 (RETFILE) verified: schema body, HMAC sign, sid, query params, headers, and ack_num match spec');

  const nilCalls = [];
  const nilSummaryResponse = JSON.stringify({
    status_cd: '1',
    gstin: '33AANCS2882A1ZG',
    ret_period: '122022',
    isnil: 'Y'
  }, null, 2);
  const nilClient = {
    get: async (url, config) => {
      nilCalls.push({ method: 'GET', url, config });
      return { status: 200, data: nilSummaryResponse };
    },
    post: async (url, data, config) => {
      nilCalls.push({ method: 'POST', url, data, config });
      return { status: 200, data: { ack_num: 'NIL-ACK-001' } };
    }
  };
  const nilProvider = new TaxProProvider({
    httpClient: nilClient,
    aspid: 'TEST_ASPID',
    password: 'TEST_PASSWORD',
    baseUrl: 'https://gstsandbox.charteredinfo.com',
    apiProfile: 'legacy'
  });
  const nilResult = await nilProvider.fileGstr1('122022', {
    gstin: '33AANCS2882A1ZG',
    username: 'TN_N12.2285',
    token: 'AUTH_TOKEN_VAL',
    pan,
    otp,
    mode: 'EVC',
    isNil: true
  });
  const nilFileCall = nilCalls.find((call) => call.method === 'POST');
  const nilBody = JSON.stringify({
    gstin: '33AANCS2882A1ZG',
    ret_period: '122022',
    isnil: 'Y'
  });
  assert.equal(nilResult.arn, 'NIL-ACK-001');
  assert.equal(nilFileCall.data, nilBody, 'Nil RETFILE body must match the Nil oneOf schema');
  assert.equal(nilFileCall.config.params.sign, computeTaxProEvcSignature(nilBody, pan, otp));
  console.log('✓ Nil RETFILE body and signature match the Nil request schema');

  await assert.rejects(
    () => provider.fileGstr1('122022', {
      gstin: '33AANCS2882A1ZG',
      username: 'TN_N12.2285',
      token: 'AUTH_TOKEN_VAL'
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  console.log('✓ Filing without PAN/EVC OTP fails closed instead of sending a non-schema RETFILE body');

  const invalidSummaryClient = {
    get: async () => ({ status: 200, data: '{"gstin":"33AANCS2882A1ZG","ret_period":"122022"}' }),
    post: async () => {
      throw new Error('RETFILE must not be sent for an invalid RETSUM response');
    }
  };
  const invalidSummaryProvider = new TaxProProvider({
    httpClient: invalidSummaryClient,
    aspid: 'TEST_ASPID',
    password: 'TEST_PASSWORD',
    baseUrl: 'https://gstsandbox.charteredinfo.com',
    apiProfile: 'legacy'
  });
  await assert.rejects(
    () => invalidSummaryProvider.fileGstr1('122022', {
      gstin: '33AANCS2882A1ZG',
      username: 'TN_N12.2285',
      token: 'AUTH_TOKEN_VAL',
      pan,
      otp
    }),
    (error) => error.code === 'PROVIDER_ERROR'
  );
  console.log('✓ Invalid RETSUM response is rejected before RETFILE');

  // A failed v4.0 filing must not be retried on the older catalogue route.
  const failedCalls = [];
  const failingClient = {
    get: async (url, config) => {
      failedCalls.push({ method: 'GET', url, config });
      return { status: 200, data: sampleResponse };
    },
    post: async (url, data, config) => {
      failedCalls.push({ method: 'POST', url, data, config });
      return {
        status: 200,
        data: { status_cd: '0', error: { error_cd: 'UNKNOWN' } }
      };
    }
  };
  const failingProvider = new TaxProProvider({
    httpClient: failingClient,
    aspid: 'TEST_ASPID',
    password: 'TEST_PASSWORD',
    apiProfile: 'legacy'
  });
  await assert.rejects(
    () => failingProvider.fileGstr1('122022', {
      gstin: '33AANCS2882A1ZG',
      username: 'TN_N12.2285',
      token: 'AUTH_TOKEN_VAL',
      pan,
      otp,
      mode: 'EVC'
    }),
    (error) => error.code === 'PROVIDER_ERROR'
  );
  assert.equal(failedCalls.length, 2, 'Expected one RETSUM and one RETFILE attempt only');
  assert.equal(failedCalls[0].url, '/taxpayerapi/dec/v2.0/returns/gstr1');
  assert.equal(failedCalls[1].url, '/taxpayerapi/dec/v2.0/returns/gstr1');
  console.log('✓ Failed legacy v2.0 RETFILE is surfaced without retrying on another route');

  console.log('\n🎉 ALL EVC PIPELINE CHECKS PASSED!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
