const assert = require('node:assert/strict');

const PORT = process.env.PORT || 4000;
const BASE_URL = `http://localhost:${PORT}`;

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

const clientIp = `192.168.10.${Math.floor(Math.random() * 200) + 10}`;

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Forwarded-For': options.ip || clientIp,
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    status: response.status,
    headers: response.headers,
    body
  };
}

function extractCookie(headers, cookieName = 'sid') {
  const rawCookie = headers.get('set-cookie');
  if (!rawCookie) return null;
  const match = rawCookie.match(new RegExp(`${cookieName}=([^;]+)`));
  return match ? match[1] : null;
}

async function main() {
  console.log(`--- Running End-to-End API Test Suite against ${BASE_URL} ---\n`);

  // 1. GET /health -> ok
  await runAsyncCheck('GET /health -> ok', async () => {
    const res = await request('/health');
    assert.equal(res.status, 200, 'Expected status 200 for /health');
    assert.deepEqual(res.body, { ok: true }, 'Expected body { ok: true }');
  });

  // 2. POST /api/gstin/search
  await runAsyncCheck('POST /api/gstin/search: valid GSTIN ok (mock: verified: true, names present)', async () => {
    const res = await request('/api/gstin/search', {
      method: 'POST',
      body: { gstin: '27AAAAA0000A1Z5' }
    });
    assert.equal(res.status, 200, 'Expected status 200 for valid GSTIN');
    assert.equal(res.body.success, true);
    assert.equal(res.body.verified, true, 'Expected verified: true in mock mode');
    assert.equal(typeof res.body.legalName, 'string', 'Expected legalName to be present');
    assert.equal(typeof res.body.tradeName, 'string', 'Expected tradeName to be present');
    assert.equal(typeof res.body.status, 'string', 'Expected status to be present');
  });

  await runAsyncCheck('POST /api/gstin/search: bad format returns INVALID_GSTIN (400)', async () => {
    const res = await request('/api/gstin/search', {
      method: 'POST',
      body: { gstin: 'INVALID_FORMAT' }
    });
    assert.equal(res.status, 400, 'Expected status 400 for bad format');
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'INVALID_GSTIN');
  });

  await runAsyncCheck('POST /api/gstin/search: GSTIN ending in 0 returns not found (INVALID_GSTIN 400)', async () => {
    const res = await request('/api/gstin/search', {
      method: 'POST',
      body: { gstin: '27AAAAA0000A1Z0' }
    });
    assert.equal(res.status, 400, 'Expected status 400 for GSTIN ending in 0');
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'INVALID_GSTIN');
  });

  await runAsyncCheck('POST /api/gstin/search: GSTIN starting with 99 returns PROVIDER_DOWN (503)', async () => {
    const res = await request('/api/gstin/search', {
      method: 'POST',
      body: { gstin: '99AAAAA0000A1Z5' }
    });
    assert.equal(res.status, 503, 'Expected status 503 for GSTIN starting with 99');
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'PROVIDER_DOWN');
  });

  // 3. POST /api/auth/otp/request
  await runAsyncCheck('POST /api/auth/otp/request without consent:true returns VALIDATION_ERROR (400)', async () => {
    const res = await request('/api/auth/otp/request', {
      method: 'POST',
      body: { gstin: '27AAAAA0000A1Z5', username: 'testuser', consent: false }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'VALIDATION_ERROR');

    const resMissing = await request('/api/auth/otp/request', {
      method: 'POST',
      body: { gstin: '27AAAAA0000A1Z5', username: 'testuser' }
    });
    assert.equal(resMissing.status, 400);
    assert.equal(resMissing.body.code, 'VALIDATION_ERROR');
  });

  const testGstin = '27AAAAA0000A1Z5';
  const testUser = `user_${Date.now()}`;

  await runAsyncCheck('POST /api/auth/otp/request with consent -> ok', async () => {
    const res = await request('/api/auth/otp/request', {
      method: 'POST',
      body: { gstin: testGstin, username: testUser, consent: true }
    });
    assert.equal(res.status, 200, 'Expected status 200 for valid OTP request');
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.message, 'string');
  });

  // 4a. POST /api/auth/otp/verify: wrong OTP -> OTP_INVALID
  await runAsyncCheck('POST /api/auth/otp/verify: wrong OTP returns OTP_INVALID (400)', async () => {
    const res1 = await request('/api/auth/otp/verify', {
      method: 'POST',
      body: { gstin: testGstin, username: testUser, otp: '999999' }
    });
    assert.equal(res1.status, 400);
    assert.equal(res1.body.success, false);
    assert.equal(res1.body.code, 'OTP_INVALID');
  });

  // 4b. OTP format validation: "12ab" and "12" -> VALIDATION_ERROR (400)
  await runAsyncCheck('POST /api/auth/otp/verify: OTP "12ab" and "12" return VALIDATION_ERROR (400)', async () => {
    const resLetters = await request('/api/auth/otp/verify', {
      method: 'POST',
      body: { gstin: testGstin, username: testUser, otp: '12ab' }
    });
    assert.equal(resLetters.status, 400);
    assert.equal(resLetters.body.success, false);
    assert.equal(resLetters.body.code, 'VALIDATION_ERROR');

    const resTooShort = await request('/api/auth/otp/verify', {
      method: 'POST',
      body: { gstin: testGstin, username: testUser, otp: '12' }
    });
    assert.equal(resTooShort.status, 400);
    assert.equal(resTooShort.body.success, false);
    assert.equal(resTooShort.body.code, 'VALIDATION_ERROR');
  });

  // 4c. After 3 wrong OTPs for the same GSTIN, the 4th attempt (even with 123456) is blocked
  await runAsyncCheck('After 3 wrong OTPs for the same GSTIN, 4th attempt is blocked with OTP_INVALID (400)', async () => {
    const blockedGstin = '27AAAAA0000A1Z5';
    const blockedUser = `user_block_${Date.now()}`;

    // Request OTP to initialize OtpState
    await request('/api/auth/otp/request', {
      method: 'POST',
      body: { gstin: blockedGstin, username: blockedUser, consent: true }
    });

    // 3 wrong attempts
    for (let i = 1; i <= 3; i++) {
      const resWrong = await request('/api/auth/otp/verify', {
        method: 'POST',
        body: { gstin: blockedGstin, username: blockedUser, otp: `99990${i}` }
      });
      assert.equal(resWrong.status, 400);
      assert.equal(resWrong.body.code, 'OTP_INVALID');
    }

    // 4th attempt with correct OTP 123456 is blocked
    const res4 = await request('/api/auth/otp/verify', {
      method: 'POST',
      body: { gstin: blockedGstin, username: blockedUser, otp: '123456' }
    });
    assert.equal(res4.status, 400, 'Expected 4th attempt to be blocked');
    assert.equal(res4.body.success, false);
    assert.ok(
      res4.body.code === 'OTP_INVALID' || res4.body.code === 'RATE_LIMITED',
      `Expected OTP_INVALID or RATE_LIMITED, got ${res4.body.code}`
    );
  });

  // Now create a fresh user for valid login
  const validUser = `valid_${Date.now()}`;
  let sidCookie = null;
  let verifyHeaders = null;

  await runAsyncCheck('POST /api/auth/otp/verify: correct OTP 123456 sets the cookie', async () => {
    // Request fresh OTP
    const reqRes = await request('/api/auth/otp/request', {
      method: 'POST',
      body: { gstin: testGstin, username: validUser, consent: true }
    });
    assert.equal(reqRes.status, 200);

    // Verify OTP with 123456
    const res = await request('/api/auth/otp/verify', {
      method: 'POST',
      body: { gstin: testGstin, username: validUser, otp: '123456' }
    });
    assert.equal(res.status, 200, 'Expected status 200 for correct OTP');
    assert.equal(res.body.success, true);
    assert.equal(res.body.gstin, testGstin);

    sidCookie = extractCookie(res.headers, 'sid');
    assert.ok(sidCookie, 'Expected "sid" cookie to be set in Set-Cookie header');
    verifyHeaders = res.headers;
  });

  // 4e. Set-Cookie attributes: HttpOnly and SameSite=Lax (NODE_ENV=development)
  await runAsyncCheck('Set-Cookie header for "sid" contains HttpOnly and SameSite=Lax (NODE_ENV=development)', async () => {
    let setCookieStr = '';
    if (typeof verifyHeaders.getSetCookie === 'function') {
      const list = verifyHeaders.getSetCookie();
      setCookieStr = list.find((c) => c.startsWith('sid=')) || list[0] || '';
    } else {
      setCookieStr = verifyHeaders.get('set-cookie') || '';
    }
    assert.ok(setCookieStr, 'Set-Cookie header must be present');
    assert.match(setCookieStr, /HttpOnly/i, 'Expected Set-Cookie to contain HttpOnly');
    assert.match(setCookieStr, /SameSite=Lax/i, 'Expected Set-Cookie to contain SameSite=Lax');
  });

  // 5. GET /api/auth/me without cookie -> SESSION_EXPIRED (401); with cookie -> ok
  await runAsyncCheck('GET /api/auth/me without cookie returns SESSION_EXPIRED (401)', async () => {
    const res = await request('/api/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'SESSION_EXPIRED');
  });

  await runAsyncCheck('GET /api/auth/me with cookie returns gstin and expiresAt', async () => {
    const res = await request('/api/auth/me', {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.gstin, testGstin);
    assert.ok(res.body.expiresAt, 'Expected expiresAt to be present');
  });

  // Period format validation: "132026" and a future period -> VALIDATION_ERROR (400)
  await runAsyncCheck('GET /api/returns: period "132026" and future period return VALIDATION_ERROR (400)', async () => {
    const resBadMonth = await request('/api/returns/gstr1?period=132026', {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(resBadMonth.status, 400);
    assert.equal(resBadMonth.body.success, false);
    assert.equal(resBadMonth.body.code, 'VALIDATION_ERROR');

    const futureYear = new Date().getFullYear() + 2;
    const futurePeriod = `01${futureYear}`;
    const resFuture = await request(`/api/returns/gstr1?period=${futurePeriod}`, {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(resFuture.status, 400);
    assert.equal(resFuture.body.success, false);
    assert.equal(resFuture.body.code, 'VALIDATION_ERROR');
  });

  // 6. Returns and Dashboard endpoints with period 092026
  await runAsyncCheck('GET /api/returns/summary with period 092026 -> ok', async () => {
    const res = await request('/api/returns/summary?period=092026', {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.availablePeriods), 'Expected availablePeriods array');
  });

  await runAsyncCheck('GET /api/returns/gstr1 with period 092026 matches ReturnData shape', async () => {
    const res = await request('/api/returns/gstr1?period=092026', {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.type, 'GSTR1');
    assert.equal(res.body.period, '092026');
    assert.ok(Array.isArray(res.body.rows), 'Expected rows array');
    assert.ok(res.body.totals, 'Expected totals object');
    assert.equal(typeof res.body.totals.taxable, 'number');
    assert.equal(typeof res.body.totals.igst, 'number');
    assert.equal(typeof res.body.totals.cgst, 'number');
    assert.equal(typeof res.body.totals.sgst, 'number');
    assert.equal(typeof res.body.totals.cess, 'number');
    assert.ok(res.body.fetchedAt, 'Expected fetchedAt timestamp');
  });

  // 6b. "stale": true case: fetch GSTR-1 for a period (data gets saved), then make the provider fail for that GSTIN
  await runAsyncCheck('Stale cache fallback: GSTR-1 returns saved data with "stale": true and fetchedAt, not a 503', async () => {
    const period = '092026';

    // 1. Initial fetch: provider succeeds, saves data to MongoDB
    const initialRes = await request(`/api/returns/gstr1?period=${period}`, {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(initialRes.status, 200, 'Expected initial fetch to succeed with 200');
    assert.equal(initialRes.body.success, true);
    assert.equal(initialRes.body.type, 'GSTR1');
    assert.equal(initialRes.body.period, period);
    assert.ok(initialRes.body.fetchedAt, 'Expected fetchedAt in initial response');
    assert.equal(initialRes.body.stale, undefined, 'Initial response must not be stale');

    // 2. Make provider fail for that GSTIN (simulated downtime via fail-closed header)
    const staleRes = await request(`/api/returns/gstr1?period=${period}`, {
      headers: {
        Cookie: `sid=${sidCookie}`,
        'x-simulate-provider-down': 'true'
      }
    });
    assert.equal(staleRes.status, 200, 'Expected stale response to return 200, not a 503');
    assert.equal(staleRes.body.success, true);
    assert.equal(staleRes.body.type, 'GSTR1');
    assert.equal(staleRes.body.period, period);
    assert.equal(staleRes.body.stale, true, 'Expected stale: true in response');
    assert.ok(staleRes.body.fetchedAt, 'Expected fetchedAt in stale response');
    assert.deepEqual(staleRes.body.totals, initialRes.body.totals, 'Expected totals to match saved data');
  });

  // 6c. Offline test for shouldSimulateDown fail-closed test hook
  runCheck('Offline: shouldSimulateDown returns false when NODE_ENV unset, production, or provider is taxpro; true only for dev/test with mock', () => {
    const { shouldSimulateDown } = require('../src/utils/testHooks');

    const origNodeEnv = process.env.NODE_ENV;
    const origUseMock = process.env.USE_MOCK;
    const origProvider = process.env.PROVIDER;

    const reqWithHeader = {
      headers: { 'x-simulate-provider-down': 'true' }
    };
    const reqWithLegacyHeader = {
      headers: { 'x-test-provider-down': 'true' }
    };
    const reqWithoutHeader = {
      headers: {}
    };

    try {
      // 1. NODE_ENV unset -> false
      delete process.env.NODE_ENV;
      process.env.USE_MOCK = 'true';
      assert.equal(shouldSimulateDown(reqWithHeader), false, 'Expected false when NODE_ENV is unset');
      assert.equal(shouldSimulateDown(reqWithLegacyHeader), false, 'Expected false when NODE_ENV is unset (legacy header)');

      // 2. NODE_ENV = "production" -> false
      process.env.NODE_ENV = 'production';
      process.env.USE_MOCK = 'true';
      assert.equal(shouldSimulateDown(reqWithHeader), false, 'Expected false when NODE_ENV is production');

      // 3. Provider is taxpro (PROVIDER=taxpro, USE_MOCK=false) -> false
      process.env.NODE_ENV = 'development';
      process.env.PROVIDER = 'taxpro';
      process.env.USE_MOCK = 'false';
      assert.equal(shouldSimulateDown(reqWithHeader), false, 'Expected false when provider is taxpro');

      // 4. Missing / false header in development -> false
      process.env.NODE_ENV = 'development';
      process.env.USE_MOCK = 'true';
      process.env.PROVIDER = 'mock';
      assert.equal(shouldSimulateDown(reqWithoutHeader), false, 'Expected false when header is missing');
      assert.equal(shouldSimulateDown({ headers: { 'x-simulate-provider-down': 'false' } }), false, 'Expected false when header is not "true"');

      // 5. True ONLY for development with mock provider
      process.env.NODE_ENV = 'development';
      process.env.USE_MOCK = 'true';
      assert.equal(shouldSimulateDown(reqWithHeader), true, 'Expected true for development with mock provider');
      assert.equal(shouldSimulateDown(reqWithLegacyHeader), true, 'Expected true for development with mock provider (legacy header)');

      // 6. True for test with mock provider
      process.env.NODE_ENV = 'test';
      process.env.USE_MOCK = 'true';
      assert.equal(shouldSimulateDown(reqWithHeader), true, 'Expected true for test with mock provider');
    } finally {
      // Restore original environment variables
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;

      if (origUseMock !== undefined) process.env.USE_MOCK = origUseMock;
      else delete process.env.USE_MOCK;

      if (origProvider !== undefined) process.env.PROVIDER = origProvider;
      else delete process.env.PROVIDER;
    }
  });

  await runAsyncCheck('GET /api/returns/gstr2b with period 092026 matches ReturnData shape', async () => {
    const res = await request('/api/returns/gstr2b?period=092026', {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.type, 'GSTR2B');
    assert.equal(res.body.period, '092026');
    assert.ok(Array.isArray(res.body.rows), 'Expected rows array');
    assert.ok(res.body.totals, 'Expected totals object');
    assert.equal(typeof res.body.totals.taxable, 'number');
    assert.equal(typeof res.body.totals.igst, 'number');
    assert.equal(typeof res.body.totals.cgst, 'number');
    assert.equal(typeof res.body.totals.sgst, 'number');
    assert.equal(typeof res.body.totals.cess, 'number');
    assert.ok(res.body.fetchedAt, 'Expected fetchedAt timestamp');
  });

  await runAsyncCheck('GET /api/returns/gstr2b with period 012022 returns DATA_NOT_AVAILABLE (404)', async () => {
    const res = await request('/api/returns/gstr2b?period=012022', {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(res.status, 404, 'Expected status 404 for period 012022');
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'DATA_NOT_AVAILABLE');
    assert.ok(!res.body.message.includes('GSTN Error'), 'Never forward raw provider message');
  });

  await runAsyncCheck('GET /api/returns/gstr3b with period 092026 matches ReturnData shape', async () => {
    const res = await request('/api/returns/gstr3b?period=092026', {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.type, 'GSTR3B');
    assert.equal(res.body.period, '092026');
    assert.ok(Array.isArray(res.body.rows), 'Expected rows array');
    assert.ok(res.body.totals, 'Expected totals object');
    assert.equal(typeof res.body.totals.taxable, 'number');
    assert.equal(typeof res.body.totals.igst, 'number');
    assert.equal(typeof res.body.totals.cgst, 'number');
    assert.equal(typeof res.body.totals.sgst, 'number');
    assert.equal(typeof res.body.totals.cess, 'number');
    assert.ok(res.body.fetchedAt, 'Expected fetchedAt timestamp');
  });

  await runAsyncCheck('GET /api/dashboard with period 092026 matches Dashboard shape', async () => {
    const res = await request('/api/dashboard?period=092026', {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.period, '092026');

    // Sales shape
    assert.ok(res.body.sales, 'Expected sales object');
    assert.equal(typeof res.body.sales.taxable, 'number');
    assert.equal(typeof res.body.sales.igst, 'number');
    assert.equal(typeof res.body.sales.cgst, 'number');
    assert.equal(typeof res.body.sales.sgst, 'number');
    assert.equal(typeof res.body.sales.cess, 'number');
    assert.equal(typeof res.body.sales.total, 'number');

    // Purchases shape
    assert.ok(res.body.purchases, 'Expected purchases object');
    assert.equal(typeof res.body.purchases.taxable, 'number');
    assert.equal(typeof res.body.purchases.igst, 'number');
    assert.equal(typeof res.body.purchases.cgst, 'number');
    assert.equal(typeof res.body.purchases.sgst, 'number');
    assert.equal(typeof res.body.purchases.cess, 'number');
    assert.equal(typeof res.body.purchases.total, 'number');

    // ITC shape
    assert.ok(res.body.itc, 'Expected itc object');
    assert.equal(typeof res.body.itc.available, 'number');
    assert.equal(typeof res.body.itc.claimed, 'number');

    // Tax Payable
    assert.equal(typeof res.body.taxPayable, 'number');
    assert.ok(res.body.updatedAt, 'Expected updatedAt timestamp');
  });

  // 7. Protected route without cookie -> SESSION_EXPIRED
  await runAsyncCheck('Protected route without cookie returns SESSION_EXPIRED (401)', async () => {
    const resReturns = await request('/api/returns/gstr1?period=092026');
    assert.equal(resReturns.status, 401);
    assert.equal(resReturns.body.code, 'SESSION_EXPIRED');

    const resDash = await request('/api/dashboard?period=092026');
    assert.equal(resDash.status, 401);
    assert.equal(resDash.body.code, 'SESSION_EXPIRED');
  });

  // 8. POST /api/auth/logout, then /api/auth/me -> SESSION_EXPIRED
  await runAsyncCheck('POST /api/auth/logout, then /api/auth/me returns SESSION_EXPIRED (401)', async () => {
    const logoutRes = await request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.success, true);
    assert.equal(logoutRes.body.ok, true);

    const meRes = await request('/api/auth/me', {
      headers: { Cookie: `sid=${sidCookie}` }
    });
    assert.equal(meRes.status, 401);
    assert.equal(meRes.body.code, 'SESSION_EXPIRED');
  });

  // 9. Rate limit: the 6th OTP request from one IP in the window -> RATE_LIMITED (429)
  await runAsyncCheck('Rate limit: 6th OTP request returns RATE_LIMITED (429)', async () => {
    const rateLimitIp = `10.99.${Math.floor(Math.random() * 200) + 10}.${Math.floor(Math.random() * 200) + 10}`;
    
    // First 5 requests should succeed
    for (let i = 1; i <= 5; i++) {
      const res = await request('/api/auth/otp/request', {
        method: 'POST',
        ip: rateLimitIp,
        body: { gstin: testGstin, username: `rl_${i}`, consent: true }
      });
      assert.equal(res.status, 200, `Expected request ${i} to succeed under rate limit`);
    }

    // 6th request must trigger RATE_LIMITED (429)
    const res6 = await request('/api/auth/otp/request', {
      method: 'POST',
      ip: rateLimitIp,
      body: { gstin: testGstin, username: 'rl_6', consent: true }
    });
    assert.equal(res6.status, 429, 'Expected 6th request to return HTTP 429');
    assert.equal(res6.body.code, 'RATE_LIMITED', 'Expected code: RATE_LIMITED');
  });

  console.log('\n🎉 ALL END-TO-END API TESTS PASSED SUCCESSFULLY! (100% assertions satisfied)');
}

main().catch((err) => {
  console.error(`\n❌ Test suite failed to execute:`, err);
  process.exit(1);
});
