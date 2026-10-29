require('dotenv').config();
const net = require('node:net');

const rawNodeEnv = process.env.NODE_ENV;
if (!rawNodeEnv || !['development', 'test', 'production'].includes(rawNodeEnv)) {
  throw new Error('NODE_ENV must be explicitly set to "development", "test", or "production"');
}

const isDevOrTest = rawNodeEnv === 'development' || rawNodeEnv === 'test';
const isProduction = rawNodeEnv === 'production';

const config = {
  PORT: parseInt(process.env.PORT, 10) || 4000,
  NODE_ENV: rawNodeEnv,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/gstapp',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  USE_MOCK: process.env.USE_MOCK !== 'false', // Default to true per specs
  PROVIDER: process.env.PROVIDER || 'mock',
  TAXPRO_BASE_URL: process.env.TAXPRO_BASE_URL || 'https://gstsandbox.charteredinfo.com',
  TAXPRO_ASPID: process.env.TAXPRO_ASPID || '',
  TAXPRO_PASSWORD: process.env.TAXPRO_PASSWORD || '',
  TAXPRO_ASP_GSTIN: process.env.TAXPRO_ASP_GSTIN || '',
  TAXPRO_ASP_PRIVATE_KEY_PATH: process.env.TAXPRO_ASP_PRIVATE_KEY_PATH || '',
  TAXPRO_ASP_PRIVATE_KEY_PASSPHRASE: process.env.TAXPRO_ASP_PRIVATE_KEY_PASSPHRASE || '',
  TAXPRO_GSP_IP_USR: process.env.TAXPRO_GSP_IP_USR || '',
  TAXPRO_EINV_USER: process.env.TAXPRO_EINV_USER || 'TaxProEnvPON',
  TAXPRO_EINV_PASSWORD: process.env.TAXPRO_EINV_PASSWORD || 'abc34*',
  TAXPRO_EINV_GSTIN: process.env.TAXPRO_EINV_GSTIN || '34AACCC1596Q002',
  TAXPRO_APP_VERSION: process.env.TAXPRO_APP_VERSION || 'CandidTax/1.0',
  TAXPRO_API_PROFILE: (process.env.TAXPRO_API_PROFILE || '').trim().toLowerCase(),
  TAXPRO_GSTR1_ACTION_REQUIRED: (process.env.TAXPRO_GSTR1_ACTION_REQUIRED || '').trim().toUpperCase(),
  TAXPRO_DEC_PRODUCTION_APPROVED: (process.env.TAXPRO_DEC_PRODUCTION_APPROVED || '').trim(),
  FINAGG_BASE_URL: process.env.FINAGG_BASE_URL || '',
  FINAGG_API_KEY: process.env.FINAGG_API_KEY || '',
  DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY || '',
  JWT_SECRET: process.env.JWT_SECRET || (isDevOrTest ? 'dev_secret_jwt_key_do_not_use_in_prod' : ''),
  TENANT_IDENTITY_SECRET: process.env.TENANT_IDENTITY_SECRET || (isDevOrTest ? (process.env.JWT_SECRET || 'dev_secret_jwt_key_do_not_use_in_prod') : ''),
  SESSION_HOURS: parseInt(process.env.SESSION_HOURS, 10) || 1,
  TRUST_PROXY_HOPS: Math.max(0, parseInt(process.env.TRUST_PROXY_HOPS, 10) || 0),
  CONTACT_INTAKE_ENABLED: process.env.CONTACT_INTAKE_ENABLED === undefined
    ? !isProduction
    : process.env.CONTACT_INTAKE_ENABLED === 'true',
  isProduction
};

if (config.isProduction) {
  const issues = [];
  const liveTaxPro = config.PROVIDER.toLowerCase() === 'taxpro' && process.env.USE_MOCK === 'false';
  const isHttpsUrl = (value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  };
  const isLocalHost = (hostname) => {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    return normalized === 'localhost' ||
      normalized.endsWith('.localhost') ||
      normalized === '::1' ||
      /^127(?:\.\d{1,3}){3}$/.test(normalized);
  };

  if (!['mock', 'taxpro'].includes(config.PROVIDER.toLowerCase())) {
    issues.push('PROVIDER must be mock or taxpro');
  }
  if (!['true', 'false'].includes(process.env.USE_MOCK)) {
    issues.push('USE_MOCK must be explicitly set to true or false');
  }
  if (config.PROVIDER.toLowerCase() !== 'taxpro' || process.env.USE_MOCK !== 'false') {
    issues.push('Production must explicitly enable PROVIDER=taxpro and USE_MOCK=false');
  }

  const DISALLOWED_SECRET_SUBSTRINGS = [
    'dev_secret',
    'do_not_use',
    'change_me',
    'changeme',
    'your_',
    'example',
    'password'
  ];

  const validateProductionSecret = (varName, val) => {
    if (!val) {
      issues.push(`${varName} must be explicitly configured`);
      return;
    }
    if (val.length < 32) {
      issues.push(`${varName} must be set to at least 32 characters`);
      return;
    }
    if (val === 'dev_secret_jwt_key_do_not_use_in_prod') {
      issues.push(`${varName} must not use the development default secret`);
      return;
    }
    const lower = val.toLowerCase();
    if (DISALLOWED_SECRET_SUBSTRINGS.some((sub) => lower.includes(sub))) {
      issues.push(`${varName} must not contain insecure placeholder tokens`);
    }
  };

  validateProductionSecret('JWT_SECRET', process.env.JWT_SECRET);
  validateProductionSecret('TENANT_IDENTITY_SECRET', process.env.TENANT_IDENTITY_SECRET);

  if (process.env.JWT_SECRET && process.env.TENANT_IDENTITY_SECRET && process.env.JWT_SECRET === process.env.TENANT_IDENTITY_SECRET) {
    issues.push('JWT_SECRET and TENANT_IDENTITY_SECRET must not be identical');
  }

  if (!/^[a-fA-F0-9]{64}$/.test(config.DATA_ENCRYPTION_KEY)) {
    issues.push('DATA_ENCRYPTION_KEY must be 64 hexadecimal characters');
  } else if (/^0{64}$/.test(config.DATA_ENCRYPTION_KEY)) {
    issues.push('DATA_ENCRYPTION_KEY must not be all zeros');
  } else if (new Set(config.DATA_ENCRYPTION_KEY).size === 1) {
    issues.push('DATA_ENCRYPTION_KEY must not be a single repeated character');
  }
  if (!isHttpsUrl(config.FRONTEND_URL) || new URL(config.FRONTEND_URL).origin !== config.FRONTEND_URL) {
    issues.push('FRONTEND_URL must use HTTPS');
  }
  if (!process.env.MONGO_URI) {
    issues.push('MONGO_URI must be explicitly configured');
  } else {
    try {
      const mongoUrl = new URL(config.MONGO_URI);
      if (!['mongodb:', 'mongodb+srv:'].includes(mongoUrl.protocol)) {
        issues.push('MONGO_URI must use mongodb:// or mongodb+srv://');
      }
      if (isLocalHost(mongoUrl.hostname)) {
        issues.push('MONGO_URI must point to the configured production database, not localhost');
      }
      if (mongoUrl.searchParams.get('tls') === 'false' || mongoUrl.searchParams.get('ssl') === 'false') {
        issues.push('MONGO_URI must not disable TLS');
      }
    } catch {
      issues.push('MONGO_URI must be a valid MongoDB connection URL');
    }
  }
  if (liveTaxPro) {
    if (process.env.TAXPRO_DEC_PRODUCTION_APPROVED !== 'true') {
      issues.push('Production requires TAXPRO_DEC_PRODUCTION_APPROVED=true because only the unapproved /dec/ transport is implemented');
    }
    if (!config.TAXPRO_ASPID || !config.TAXPRO_PASSWORD) {
      issues.push('TAXPRO_ASPID and TAXPRO_PASSWORD are required for live TaxPro mode');
    }
    const encodedAspPassword = config.TAXPRO_PASSWORD.trim();
    const aspPasswordBytes = /^[A-Za-z0-9+/]+={0,2}$/.test(encodedAspPassword)
      ? Buffer.from(encodedAspPassword, 'base64')
      : Buffer.alloc(0);
    const canonicalAspPassword = aspPasswordBytes.toString('base64').replace(/=+$/, '') ===
      encodedAspPassword.replace(/=+$/, '');
    if (![16, 24, 32].includes(aspPasswordBytes.length) || !canonicalAspPassword) {
      aspPasswordBytes.fill(0);
      issues.push('TAXPRO_PASSWORD must be the Base64 ASP secret key supplied by TaxPro (16, 24, or 32 decoded bytes)');
    } else {
      aspPasswordBytes.fill(0);
    }
    if (!process.env.TAXPRO_BASE_URL || !isHttpsUrl(config.TAXPRO_BASE_URL)) {
      issues.push('TAXPRO_BASE_URL must be explicitly set to a valid HTTPS URL');
    } else {
      const providerHost = new URL(config.TAXPRO_BASE_URL).hostname.toLowerCase();
      const providerUrl = new URL(config.TAXPRO_BASE_URL);
      if (!['gstsandbox.charteredinfo.com', 'gstapi.charteredinfo.com'].includes(providerHost)) {
        issues.push('TAXPRO_BASE_URL must use the official TaxPro sandbox or production host');
      }
      if (providerHost !== 'gstapi.charteredinfo.com') {
        issues.push('Production requires TAXPRO_BASE_URL=https://gstapi.charteredinfo.com; the sandbox host is not allowed');
      }
      if (providerUrl.username || providerUrl.password || providerUrl.port || providerUrl.pathname !== '/' ||
          providerUrl.search || providerUrl.hash) {
        issues.push('TAXPRO_BASE_URL must be an HTTPS origin without credentials, port, path, query, or fragment');
      }
    }
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(config.TAXPRO_ASP_GSTIN)) {
      issues.push('TAXPRO_ASP_GSTIN must be the valid GSTIN registered to the TaxPro ASP account');
    }
    if (!config.TAXPRO_GSP_IP_USR || !net.isIP(config.TAXPRO_GSP_IP_USR)) {
      issues.push('TAXPRO_GSP_IP_USR must be the deployment IP address allowed by TaxPro');
    }
    if (!config.TAXPRO_ASP_PRIVATE_KEY_PATH) {
      issues.push('TAXPRO_ASP_PRIVATE_KEY_PATH must point to the registered ASP signing private key in PEM format');
    } else {
      try {
        const fs = require('node:fs');
        const crypto = require('node:crypto');
        const path = require('node:path');
        if (!path.isAbsolute(config.TAXPRO_ASP_PRIVATE_KEY_PATH)) {
          throw new Error('Private key path must be absolute');
        }
        const keyBytes = fs.readFileSync(config.TAXPRO_ASP_PRIVATE_KEY_PATH);
        const privateKey = crypto.createPrivateKey({
          key: keyBytes,
          ...(config.TAXPRO_ASP_PRIVATE_KEY_PASSPHRASE
            ? { passphrase: config.TAXPRO_ASP_PRIVATE_KEY_PASSPHRASE }
            : {})
        });
        if (privateKey.asymmetricKeyType !== 'rsa') {
          issues.push('TAXPRO_ASP_PRIVATE_KEY_PATH must contain an RSA private key');
        }
      } catch {
        issues.push('TAXPRO_ASP_PRIVATE_KEY_PATH must point to a readable PEM RSA key with a valid passphrase');
      }
    }
    if (config.SESSION_HOURS !== 1) {
      issues.push('SESSION_HOURS must be 1 until TaxPro confirms token lifetime');
    }
    if (!['legacy', 'current'].includes(config.TAXPRO_API_PROFILE)) {
      issues.push('TAXPRO_API_PROFILE must explicitly be legacy or current');
    }
    if (config.TAXPRO_API_PROFILE === 'legacy') {
      issues.push('Production requires TAXPRO_API_PROFILE=current; legacy is only for sandbox compatibility');
    }
    if (config.TAXPRO_API_PROFILE === 'current' && !['Y', 'N'].includes(config.TAXPRO_GSTR1_ACTION_REQUIRED)) {
      issues.push('TAXPRO_GSTR1_ACTION_REQUIRED must be confirmed as Y or N for the current GSTR-1 API');
    }
  }

  if (issues.length) {
    throw new Error(`Invalid production configuration: ${issues.join('; ')}`);
  }
}

module.exports = config;
