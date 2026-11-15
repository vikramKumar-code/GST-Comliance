const assert = require('node:assert/strict');
const { isLiveFilingEnabled } = require('../src/utils/filingMode');

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  FEATURE_FILING: process.env.FEATURE_FILING,
  PROVIDER: process.env.PROVIDER,
  USE_MOCK: process.env.USE_MOCK,
  ALLOW_DEV_LIVE_FILING: process.env.ALLOW_DEV_LIVE_FILING
};

function setEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

try {
  setEnv({
    NODE_ENV: 'development',
    FEATURE_FILING: 'true',
    PROVIDER: 'taxpro',
    USE_MOCK: 'false'
  });
  assert.equal(isLiveFilingEnabled(), false, 'Development must never enable live filing without explicit ALLOW_DEV_LIVE_FILING');

  setEnv({
    NODE_ENV: 'development',
    FEATURE_FILING: 'true',
    PROVIDER: 'taxpro',
    USE_MOCK: 'false',
    ALLOW_DEV_LIVE_FILING: 'true'
  });
  assert.equal(isLiveFilingEnabled(), true, 'Explicit ALLOW_DEV_LIVE_FILING enables live filing in development');

  setEnv({
    NODE_ENV: 'production',
    FEATURE_FILING: 'true',
    PROVIDER: 'taxpro',
    USE_MOCK: 'true'
  });
  assert.equal(isLiveFilingEnabled(), false, 'Mock mode must never enable live filing');

  setEnv({
    NODE_ENV: 'production',
    FEATURE_FILING: 'true',
    PROVIDER: 'mock',
    USE_MOCK: 'false'
  });
  assert.equal(isLiveFilingEnabled(), false, 'Mock provider must never enable live filing');

  setEnv({
    NODE_ENV: 'production',
    FEATURE_FILING: 'false',
    PROVIDER: 'taxpro',
    USE_MOCK: 'false'
  });
  assert.equal(isLiveFilingEnabled(), false, 'Disabled filing feature must remain disabled');

  setEnv({
    NODE_ENV: 'production',
    FEATURE_FILING: 'true',
    PROVIDER: 'taxpro',
    USE_MOCK: 'false'
  });
  assert.equal(isLiveFilingEnabled(), true, 'Explicit production TaxPro configuration enables live filing');

  console.log('Filing-mode safety checks passed.');
} finally {
  setEnv(originalEnv);
}
