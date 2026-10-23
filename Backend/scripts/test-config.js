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
  JWT_SECRET: 'prod-valid-jwt-secret-min32-characters-custom',
  TENANT_IDENTITY_SECRET: 'prod-valid-tenant-secret-min32-characters-custom',
  DATA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
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
  // TAXPRO_DEC_PRODUCTION_APPROVED is set to 'true' only inside this synthetic child test environment to test the valid production baseline.
  TAXPRO_DEC_PRODUCTION_APPROVED: 'true',
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

// NODE_ENV validation tests
const missingNodeEnv = loadConfig(validProductionEnv.MONGO_URI, { NODE_ENV: '' });
assert.notEqual(missingNodeEnv.status, 0, 'NODE_ENV must not be empty or unset');
assert.match(missingNodeEnv.stderr, /NODE_ENV must be explicitly set/);

const invalidNodeEnv = loadConfig(validProductionEnv.MONGO_URI, { NODE_ENV: 'staging' });
assert.notEqual(invalidNodeEnv.status, 0, 'NODE_ENV must not be an arbitrary unapproved value');
assert.match(invalidNodeEnv.stderr, /NODE_ENV must be explicitly set/);

// JWT_SECRET validation tests
const missingJwtSecret = loadConfig(validProductionEnv.MONGO_URI, { JWT_SECRET: '' });
assert.notEqual(missingJwtSecret.status, 0, 'Production must configure an explicit JWT_SECRET');
assert.match(missingJwtSecret.stderr, /JWT_SECRET must be explicitly configured/);

const shortJwtSecret = loadConfig(validProductionEnv.MONGO_URI, { JWT_SECRET: 'short-secret' });
assert.notEqual(shortJwtSecret.status, 0, 'JWT_SECRET must be at least 32 characters');
assert.match(shortJwtSecret.stderr, /JWT_SECRET must be set to at least 32 characters/);
assert.equal(shortJwtSecret.stderr.includes('short-secret'), false, 'stderr must never print secret values');

const devDefaultJwtSecret = loadConfig(validProductionEnv.MONGO_URI, { JWT_SECRET: 'dev_secret_jwt_key_do_not_use_in_prod' });
assert.notEqual(devDefaultJwtSecret.status, 0, 'JWT_SECRET must refuse dev default string');
assert.match(devDefaultJwtSecret.stderr, /JWT_SECRET must not use the development default secret/);
assert.equal(devDefaultJwtSecret.stderr.includes('dev_secret_jwt_key_do_not_use_in_prod'), false, 'stderr must not print dev secret');

const placeholderDevSecretJwt = loadConfig(validProductionEnv.MONGO_URI, { JWT_SECRET: 'some-custom-secret-with-dev_secret-token' });
assert.notEqual(placeholderDevSecretJwt.status, 0, 'JWT_SECRET must refuse dev_secret token');
assert.match(placeholderDevSecretJwt.stderr, /JWT_SECRET must not contain insecure placeholder tokens/);
assert.equal(placeholderDevSecretJwt.stderr.includes('some-custom-secret-with-dev_secret-token'), false, 'stderr must not print secret');

const placeholderDoNotUseJwt = loadConfig(validProductionEnv.MONGO_URI, { JWT_SECRET: 'some-custom-secret-with-do_not_use-token' });
assert.notEqual(placeholderDoNotUseJwt.status, 0, 'JWT_SECRET must refuse do_not_use token');
assert.match(placeholderDoNotUseJwt.stderr, /JWT_SECRET must not contain insecure placeholder tokens/);

const placeholderChangeMeJwt = loadConfig(validProductionEnv.MONGO_URI, { JWT_SECRET: 'some-custom-secret-with-change_me-token' });
assert.notEqual(placeholderChangeMeJwt.status, 0, 'JWT_SECRET must refuse change_me token');
assert.match(placeholderChangeMeJwt.stderr, /JWT_SECRET must not contain insecure placeholder tokens/);

const placeholderPasswordJwt = loadConfig(validProductionEnv.MONGO_URI, { JWT_SECRET: 'some-custom-secret-with-password-token' });
assert.notEqual(placeholderPasswordJwt.status, 0, 'JWT_SECRET must refuse password token');
assert.match(placeholderPasswordJwt.stderr, /JWT_SECRET must not contain insecure placeholder tokens/);

// TENANT_IDENTITY_SECRET validation tests
const missingTenantIdentitySecret = loadConfig(validProductionEnv.MONGO_URI, { TENANT_IDENTITY_SECRET: '' });
assert.notEqual(missingTenantIdentitySecret.status, 0, 'Production must configure a stable tenant identity secret');
assert.match(missingTenantIdentitySecret.stderr, /TENANT_IDENTITY_SECRET must be explicitly configured/);

const shortTenantSecret = loadConfig(validProductionEnv.MONGO_URI, { TENANT_IDENTITY_SECRET: 'short-secret' });
assert.notEqual(shortTenantSecret.status, 0, 'TENANT_IDENTITY_SECRET must be at least 32 characters');
assert.match(shortTenantSecret.stderr, /TENANT_IDENTITY_SECRET must be set to at least 32 characters/);
assert.equal(shortTenantSecret.stderr.includes('short-secret'), false, 'stderr must never print secret values');

const devDefaultTenantSecret = loadConfig(validProductionEnv.MONGO_URI, { TENANT_IDENTITY_SECRET: 'dev_secret_jwt_key_do_not_use_in_prod' });
assert.notEqual(devDefaultTenantSecret.status, 0, 'TENANT_IDENTITY_SECRET must refuse dev default string');
assert.match(devDefaultTenantSecret.stderr, /TENANT_IDENTITY_SECRET must not use the development default secret/);
assert.equal(devDefaultTenantSecret.stderr.includes('dev_secret_jwt_key_do_not_use_in_prod'), false, 'stderr must not print dev secret');

const placeholderTenantSecret = loadConfig(validProductionEnv.MONGO_URI, { TENANT_IDENTITY_SECRET: 'custom-tenant-secret-with-example-token' });
assert.notEqual(placeholderTenantSecret.status, 0, 'TENANT_IDENTITY_SECRET must refuse example token');
assert.match(placeholderTenantSecret.stderr, /TENANT_IDENTITY_SECRET must not contain insecure placeholder tokens/);
assert.equal(placeholderTenantSecret.stderr.includes('custom-tenant-secret-with-example-token'), false, 'stderr must not print secret');

// Identical secrets test
const identicalSecrets = loadConfig(validProductionEnv.MONGO_URI, {
  JWT_SECRET: 'identical-secret-candidate-with-more-than-32-chars',
  TENANT_IDENTITY_SECRET: 'identical-secret-candidate-with-more-than-32-chars'
});
assert.notEqual(identicalSecrets.status, 0, 'JWT_SECRET and TENANT_IDENTITY_SECRET must not be identical');
assert.match(identicalSecrets.stderr, /JWT_SECRET and TENANT_IDENTITY_SECRET must not be identical/);
assert.equal(identicalSecrets.stderr.includes('identical-secret-candidate-with-more-than-32-chars'), false, 'stderr must not print secret value');

// DATA_ENCRYPTION_KEY validation tests
const repeatedCharDataKey = loadConfig(validProductionEnv.MONGO_URI, {
  DATA_ENCRYPTION_KEY: '1'.repeat(64)
});
assert.notEqual(repeatedCharDataKey.status, 0, 'DATA_ENCRYPTION_KEY must refuse a single repeated character');
assert.match(repeatedCharDataKey.stderr, /DATA_ENCRYPTION_KEY must not be a single repeated character/);
assert.equal(repeatedCharDataKey.stderr.includes('1'.repeat(64)), false, 'stderr must not print key');

const allZerosDataKey = loadConfig(validProductionEnv.MONGO_URI, {
  DATA_ENCRYPTION_KEY: '0'.repeat(64)
});
assert.notEqual(allZerosDataKey.status, 0, 'DATA_ENCRYPTION_KEY must refuse all zeros');
assert.match(allZerosDataKey.stderr, /DATA_ENCRYPTION_KEY must not be all zeros/);
assert.equal(allZerosDataKey.stderr.includes('0'.repeat(64)), false, 'stderr must not print key');

// TAXPRO_DEC_PRODUCTION_APPROVED validation tests
const missingDecApproval = loadConfig(validProductionEnv.MONGO_URI, {
  TAXPRO_DEC_PRODUCTION_APPROVED: ''
});
assert.notEqual(missingDecApproval.status, 0, 'Production must refuse live TaxPro without TAXPRO_DEC_PRODUCTION_APPROVED=true');
assert.match(missingDecApproval.stderr, /TAXPRO_DEC_PRODUCTION_APPROVED=true/);

const falseDecApproval = loadConfig(validProductionEnv.MONGO_URI, {
  TAXPRO_DEC_PRODUCTION_APPROVED: 'false'
});
assert.notEqual(falseDecApproval.status, 0, 'Production must refuse when TAXPRO_DEC_PRODUCTION_APPROVED is false');
assert.match(falseDecApproval.stderr, /TAXPRO_DEC_PRODUCTION_APPROVED=true/);

const numericDecApproval = loadConfig(validProductionEnv.MONGO_URI, {
  TAXPRO_DEC_PRODUCTION_APPROVED: '1'
});
assert.notEqual(numericDecApproval.status, 0, 'Production must refuse when TAXPRO_DEC_PRODUCTION_APPROVED is not true');
assert.match(numericDecApproval.stderr, /TAXPRO_DEC_PRODUCTION_APPROVED=true/);

// Development and test mode fallback tests
const devMode = spawnSync(process.execPath, [
  '--require', path.join(__dirname, 'e2e-no-dotenv.js'),
  '-e', "const c = require('./src/config/env'); if (c.JWT_SECRET !== 'dev_secret_jwt_key_do_not_use_in_prod' || c.TENANT_IDENTITY_SECRET !== 'dev_secret_jwt_key_do_not_use_in_prod') process.exit(2);"
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: 'development'
  }
});
assert.equal(devMode.status, 0, 'Development mode should start cleanly with dev fallback secrets');

const testMode = spawnSync(process.execPath, [
  '--require', path.join(__dirname, 'e2e-no-dotenv.js'),
  '-e', "const c = require('./src/config/env'); if (c.JWT_SECRET !== 'dev_secret_jwt_key_do_not_use_in_prod' || c.TENANT_IDENTITY_SECRET !== 'dev_secret_jwt_key_do_not_use_in_prod') process.exit(2);"
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: 'test'
  }
});
assert.equal(testMode.status, 0, 'Test mode should start cleanly with dev fallback secrets');

// Existing production checks
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
