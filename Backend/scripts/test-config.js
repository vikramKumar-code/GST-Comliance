const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempKeyPath = path.join(os.tmpdir(), `taxpro-config-${process.pid}.pem`);
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
});
fs.writeFileSync(tempKeyPath, privateKey, { flag: 'wx' });

const validProductionEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  NODE_ENV: 'production',
  PROVIDER: 'taxpro',
  USE_MOCK: 'false',
  JWT_SECRET: 'test-only-jwt-secret-with-at-least-32-characters',
  TENANT_IDENTITY_SECRET: 'test-only-tenant-identity-secret-at-least-32',
  DATA_ENCRYPTION_KEY: '1'.repeat(64),
  FRONTEND_URL: 'https://app.example.test',
  MONGO_URI: 'mongodb+srv://example.test/production',
  TAXPRO_BASE_URL: 'https://gstapi.charteredinfo.com',
  TAXPRO_ASPID: 'TEST_ONLY',
  TAXPRO_PASSWORD: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  TAXPRO_ASP_GSTIN: '27AAAAA0000A1Z5',
  TAXPRO_ASP_PRIVATE_KEY_PATH: tempKeyPath,
  TAXPRO_GSP_IP_USR: '203.0.113.10',
  TAXPRO_API_PROFILE: 'current',
  TAXPRO_GSTR1_ACTION_REQUIRED: 'N',
  SESSION_HOURS: '1'
};

function loadConfig(mongoUri, overrides = {}) {
  return spawnSync(process.execPath, ['--require', path.join(__dirname, 'e2e-no-dotenv.js'), '-e', "require('./src/config/env')"], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...validProductionEnv, MONGO_URI: mongoUri, ...overrides }
  });
}

const valid = loadConfig(validProductionEnv.MONGO_URI);
assert.equal(valid.status, 0, 'A valid remote production configuration should load');

const missingTenantIdentitySecret = loadConfig(validProductionEnv.MONGO_URI, { TENANT_IDENTITY_SECRET: '' });
assert.notEqual(missingTenantIdentitySecret.status, 0, 'Production must configure a stable tenant identity secret');
assert.match(missingTenantIdentitySecret.stderr, /TENANT_IDENTITY_SECRET must be set to at least 32 characters/);

const productionHost = loadConfig(validProductionEnv.MONGO_URI, {
  TAXPRO_BASE_URL: 'https://gstapi.charteredinfo.com'
});
assert.equal(productionHost.status, 0, 'The exact official TaxPro production host should be allowed');

const sandboxInProduction = loadConfig(validProductionEnv.MONGO_URI, {
  TAXPRO_BASE_URL: 'https://gstsandbox.charteredinfo.com'
});
assert.notEqual(sandboxInProduction.status, 0, 'Production must never target the TaxPro sandbox');
assert.match(sandboxInProduction.stderr, /Production requires TAXPRO_BASE_URL=https:\/\/gstapi\.charteredinfo\.com/);

const untrustedTaxProHost = loadConfig(validProductionEnv.MONGO_URI, {
  TAXPRO_BASE_URL: 'https://fake.charteredinfo.com'
});
assert.notEqual(untrustedTaxProHost.status, 0, 'Untrusted TaxPro lookalike hosts must be rejected');
assert.match(untrustedTaxProHost.stderr, /official TaxPro sandbox or production host/);

for (const uri of [
  'mongodb://localhost:27017/gstapp',
  'mongodb://127.0.0.1:27017/gstapp',
  'mongodb://[::1]:27017/gstapp'
]) {
  const result = loadConfig(uri);
  assert.notEqual(result.status, 0, 'A loopback MongoDB host must be rejected');
  assert.match(result.stderr, /not localhost/, 'The rejection should identify the local database requirement');
}

const missingProfile = loadConfig(validProductionEnv.MONGO_URI, { TAXPRO_API_PROFILE: '' });
assert.notEqual(missingProfile.status, 0, 'Production must explicitly select a TaxPro API profile');
assert.match(missingProfile.stderr, /TAXPRO_API_PROFILE must explicitly be legacy or current/);

const unconfirmedCurrent = loadConfig(validProductionEnv.MONGO_URI, {
  TAXPRO_API_PROFILE: 'current',
  TAXPRO_GSTR1_ACTION_REQUIRED: ''
});
assert.notEqual(unconfirmedCurrent.status, 0, 'Current GSTR-1 profile must require a confirmed action_required value');
assert.match(unconfirmedCurrent.stderr, /TAXPRO_GSTR1_ACTION_REQUIRED must be confirmed/);

const configuredCurrent = loadConfig(validProductionEnv.MONGO_URI, {
  TAXPRO_API_PROFILE: 'current',
  TAXPRO_GSTR1_ACTION_REQUIRED: 'N'
});
assert.equal(configuredCurrent.status, 0, 'Documented current API headers and confirmed GSTR-1 action flag should load');

const missingGspIp = loadConfig(validProductionEnv.MONGO_URI, { TAXPRO_GSP_IP_USR: '' });
assert.notEqual(missingGspIp.status, 0, 'Production must configure the TaxPro-allowed deployment IP');
assert.match(missingGspIp.stderr, /TAXPRO_GSP_IP_USR must be the deployment IP address allowed by TaxPro/);

const invalidAspSecret = loadConfig(validProductionEnv.MONGO_URI, { TAXPRO_PASSWORD: 'not-base64-key' });
assert.notEqual(invalidAspSecret.status, 0, 'Production must reject a non-AES TaxPro ASP secret');
assert.match(invalidAspSecret.stderr, /TAXPRO_PASSWORD must be the Base64 ASP secret key/);

const legacyProductionProfile = loadConfig(validProductionEnv.MONGO_URI, { TAXPRO_API_PROFILE: 'legacy' });
assert.notEqual(legacyProductionProfile.status, 0, 'Production must not use the legacy sandbox API profile');
assert.match(legacyProductionProfile.stderr, /Production requires TAXPRO_API_PROFILE=current/);

fs.unlinkSync(tempKeyPath);
console.log('Production config checks passed (TaxPro credentials, registered signing-key configuration, and API profile are fail-closed).');
