process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const {
  TaxProProvider,
  OK_SHAPE,
  buildGstr3bRetFileBody
} = require('../src/services/providers/taxpro');

class MockHttpClient {
  constructor() {
    this.calls = [];
    this.handler = null;
  }
  setHandler(fn) {
    this.handler = fn;
  }
  async get(url, config) {
    this.calls.push({ method: 'GET', url, config });
    return this.handler(url, config);
  }
  async post(url, data, config) {
    this.calls.push({ method: 'POST', url, data, config });
    return this.handler(url, { ...config, body: data });
  }
  async put(url, data, config) {
    this.calls.push({ method: 'PUT', url, data, config });
    return this.handler(url, { ...config, body: data });
  }
}

async function runContractTests() {
  console.log('--- Running TaxPro Contract & GSTN Schema Alignment Tests ---');

  const fakeClient = new MockHttpClient();
  const provider = new TaxProProvider({
    httpClient: fakeClient,
    aspid: 'TEST_ASPID',
    password: 'TEST_PASSWORD',
    apiProfile: 'legacy'
  });

  const gstin = '27AAAAA0000A1Z5';
  const period = '022022';
  const username = 'testuser';
  const gstToken = 'TEST_TOKEN_XYZ';

  // 1. saveGstr1 returns both reference_id & ref_id (including nested data.data.reference_id)
  fakeClient.setHandler(() => ({
    status: 200,
    data: { status_cd: '1', data: { reference_id: 'REF-GSTR1-NESTED-999' } }
  }));
  const save1Res = await provider.saveGstr1({ gstin, fp: period }, { gstin, period, username, gstToken });
  assert.equal(save1Res.reference_id, 'REF-GSTR1-NESTED-999', 'saveGstr1 must return reference_id');
  assert.equal(save1Res.ref_id, 'REF-GSTR1-NESTED-999', 'saveGstr1 must return ref_id');
  console.log('✓ 1. saveGstr1 returns both reference_id & ref_id on nested TaxPro responses');

  // 2. saveGstr3b returns both reference_id & ref_id
  fakeClient.setHandler(() => ({
    status: 200,
    data: { status_cd: '1', data: { reference_id: 'REF-GSTR3B-NESTED-888' } }
  }));
  const save3bRes = await provider.saveGstr3b({ gstin, ret_period: period }, { gstin, period, username, gstToken });
  assert.equal(save3bRes.reference_id, 'REF-GSTR3B-NESTED-888', 'saveGstr3b must return reference_id');
  assert.equal(save3bRes.ref_id, 'REF-GSTR3B-NESTED-888', 'saveGstr3b must return ref_id');
  console.log('✓ 2. saveGstr3b returns both reference_id & ref_id on nested TaxPro responses');

  // 3. proceedToFile returns both reference_id, ref_id, and normalized isSync
  fakeClient.setHandler(() => ({
    status: 200,
    data: { status_cd: '1', reference_id: 'REF-PROCEED-111' }
  }));
  const procRes = await provider.proceedToFile(period, { gstin, username, token: gstToken });
  assert.equal(procRes.reference_id, 'REF-PROCEED-111');
  assert.equal(procRes.ref_id, 'REF-PROCEED-111');
  console.log('✓ 3. proceedToFile returns both reference_id & ref_id for async responses');

  // 3b. proceedToFile handles synchronous isSync = 'Y'
  fakeClient.setHandler(() => ({
    status: 200,
    data: { status_cd: '1', isSync: 'Y' }
  }));
  const procSyncRes = await provider.proceedToFile(period, { gstin, username, token: gstToken });
  assert.equal(procSyncRes.isSync, 'Y');
  console.log('✓ 3b. proceedToFile handles synchronous isSync: Y');

  // 4. submitGstr1 sends strictly Submit Schema body (gstin, ret_period, generate_summary)
  fakeClient.setHandler((url, cfg) => {
    assert.deepEqual(Object.keys(cfg.body).sort(), ['generate_summary', 'gstin', 'ret_period']);
    assert.equal(cfg.body.gstin, gstin);
    assert.equal(cfg.body.ret_period, period);
    assert.equal(cfg.body.generate_summary, 'Y');
    return { status: 200, data: { status_cd: '1', reference_id: 'REF-SUBMIT-222' } };
  });
  const subRes = await provider.submitGstr1(period, { gstin, username, token: gstToken, optionsLeaked: 'should_not_be_in_body' });
  assert.equal(subRes.reference_id, 'REF-SUBMIT-222');
  assert.equal(subRes.ref_id, 'REF-SUBMIT-222');
  console.log('✓ 4. submitGstr1 payload conforms strictly to Submit Request schema without leaking stray options');

  // 5. trackStatus handles refId as string OR as object, unwraps nested data.data.status_cd
  fakeClient.setHandler(() => ({
    status: 200,
    data: {
      status_cd: '1',
      data: {
        status_cd: 'P',
        form_typ: 'GSTR1'
      }
    }
  }));
  const trackRes1 = await provider.trackStatus('REF-123', { gstin, username, token: gstToken });
  assert.equal(trackRes1.status_cd, 'P', 'trackStatus must unwrap real GSTN status P from nested data');
  const trackRes2 = await provider.trackStatus({ reference_id: 'REF-123' }, { gstin, username, token: gstToken });
  assert.equal(trackRes2.status_cd, 'P', 'trackStatus must accept object reference');
  console.log('✓ 5. trackStatus accepts both string and object refId, and unwraps real status_cd P');

  // 6. fileGstr1 returns both arn and ack_num
  fakeClient.setHandler((url, cfg) => {
    if (url.includes('returns/gstr1') && cfg.params.action === 'RETSUM') {
      return {
        status: 200,
        data: JSON.stringify({
          gstin,
          ret_period: period,
          chksum: 'SUM-CHK',
          smryTyp: 'L',
          newSumFlag: true,
          sec_sum: []
        })
      };
    }
    if (url.includes('returns/gstr1') && cfg.params.action === 'RETFILE') {
      return {
        status: 200,
        data: {
          status_cd: '1',
          data: { ack_num: 'ARN-GSTR1-7777777' }
        }
      };
    }
    return { status: 200, data: { status_cd: '1' } };
  });
  const file1Res = await provider.fileGstr1(period, {
    gstin,
    username,
    token: gstToken,
    pan: 'ABCDE1234F',
    otp: '123456',
    mode: 'EVC'
  });
  assert.equal(file1Res.arn, 'ARN-GSTR1-7777777');
  assert.equal(file1Res.ack_num, 'ARN-GSTR1-7777777');
  console.log('✓ 6. fileGstr1 returns both arn & ack_num, handling nested ack_num');

  // 7. Regular GSTR-1 summary containing isnil: "N" does NOT fail with 502
  fakeClient.setHandler((url, cfg) => {
    if (url.includes('returns/gstr1') && cfg.params.action === 'RETSUM') {
      return {
        status: 200,
        data: JSON.stringify({
          gstin,
          ret_period: period,
          isnil: 'N', // GST portal echoes isnil: N for regular returns
          chksum: 'SUM-CHK-REG',
          smryTyp: 'L',
          newSumFlag: true,
          sec_sum: []
        })
      };
    }
    if (url.includes('returns/gstr1') && cfg.params.action === 'RETFILE') {
      // Assert that isnil was stripped from regular body so it adheres to additionalProperties: false
      const sent = JSON.parse(cfg.body);
      assert.equal(sent.isnil, undefined, 'isnil: N must be stripped from regular RETFILE body');
      assert.equal(sent.chksum, 'SUM-CHK-REG');
      return {
        status: 200,
        data: { status_cd: '1', ack_num: 'ARN-GSTR1-REGULAR' }
      };
    }
    return { status: 200, data: { status_cd: '1' } };
  });
  const file1RegRes = await provider.fileGstr1(period, {
    gstin,
    username,
    token: gstToken,
    pan: 'ABCDE1234F',
    otp: '123456',
    mode: 'EVC'
  });
  assert.equal(file1RegRes.arn, 'ARN-GSTR1-REGULAR');
  console.log('✓ 7. Regular GSTR-1 summary with isnil: "N" cleanly strips isnil and succeeds without 502');

  // 8. fileGstr3b returns both arn and ack_num
  fakeClient.setHandler((url, cfg) => {
    if (url.includes('returns/gstr3b') && cfg.params.action === 'RETSUM') {
      return {
        status: 200,
        data: JSON.stringify({
          gstin,
          ret_period: period,
          sup_details: {},
          itc_elg: {}
        })
      };
    }
    if (url.includes('returns/gstr3b') && cfg.params.action === 'RETFILE') {
      return {
        status: 200,
        data: {
          status_cd: '1',
          data: { ack_num: 'ARN-GSTR3B-8888888' }
        }
      };
    }
    return { status: 200, data: { status_cd: '1' } };
  });
  const file3bRes = await provider.fileGstr3b(period, {
    gstin,
    username,
    token: gstToken,
    pan: 'ABCDE1234F',
    otp: '123456',
    mode: 'EVC'
  });
  assert.equal(file3bRes.arn, 'ARN-GSTR3B-8888888');
  assert.equal(file3bRes.ack_num, 'ARN-GSTR3B-8888888');
  console.log('✓ 8. fileGstr3b returns both arn & ack_num, handling nested ack_num');

  console.log('\n🎉 ALL TAXPRO CONTRACT & SCHEMA VERIFICATION TESTS PASSED (100%)!');
}

runContractTests().catch((err) => {
  console.error('\n❌ CONTRACT TEST FAILED:', err);
  process.exit(1);
});

