// Sandbox-only interactive collector. It never writes raw responses or tokens to disk.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const axios = require('axios');
const dotenv = require('dotenv');
const { sanitizeSample, cleanString } = require('./sanitize-sample');
const { isValidPeriod } = require('../src/utils/gstin');

function formatSafeHeaderDiagnostics(headers) {
  const summary = {};
  for (const [key, val] of Object.entries(headers || {})) {
    summary[key] = val !== undefined && val !== null && String(val).length > 0 ? '[PRESENT]' : '[EMPTY]';
  }
  return summary;
}

const BACKEND_DIR = path.resolve(__dirname, '..');
const DOC_DIR = path.resolve(BACKEND_DIR, '..', 'doc');
const ENV_PATH = path.join(BACKEND_DIR, '.env');
const AUTH_PATH = '/taxpayerapi/dec/v1.0/authenticate';
const REQUEST_TIMEOUT_MS = 20000;

dotenv.config({ path: ENV_PATH });

const PERIOD_PLACEMENT = (process.env.TAXPRO_PERIOD_PLACEMENT || 'both').trim().toLowerCase();
if (!['header', 'query', 'both'].includes(PERIOD_PLACEMENT)) {
  throw new Error('TAXPRO_PERIOD_PLACEMENT must be header, query, or both.');
}

function createPrompt() {
  return readline.createInterface({ input: stdin, output: stdout });
}

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this collector from an interactive terminal so the OTP can stay hidden.'));
  }

  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    let value = '';
    let ignoreLineFeed = false;
    const previousRawMode = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const finish = (error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(Boolean(previousRawMode));
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        if (ignoreLineFeed && char === '\n') {
          ignoreLineFeed = false;
          continue;
        }
        ignoreLineFeed = false;
        if (char === '\u0003') return finish(new Error('Interrupted.'));
        if (char === '\r' || char === '\n') {
          ignoreLineFeed = char === '\r';
          return finish();
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= ' ' && char <= '~') value += char;
      }
    };

    stdin.on('data', onData);
  });
}

function providerErrorCode(data) {
  const code = data && typeof data === 'object' ? data.error?.error_cd : null;
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : null;
}

function providerErrorMessage(data) {
  if (!data || typeof data !== 'object') return null;
  let raw = data.error?.message;
  if (!raw && typeof data.message === 'string') raw = data.message;
  if (!raw && typeof data.error === 'string') raw = data.error;
  if (typeof raw !== 'string') return null;
  const singleLine = raw.replace(/[\r\n\t]+/g, ' ').trim();
  return cleanString(singleLine);
}

function formatSafeNetworkDiagnostics(error, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (!error) return 'unknown error';
  const code = typeof error.code === 'string' && /^[A-Z0-9_-]{1,32}$/i.test(error.code)
    ? error.code
    : 'network error';
  const rawMsg = typeof error.message === 'string'
    ? error.message.replace(/[\r\n\t]+/g, ' ').trim()
    : '';
  const safeMsg = cleanString(rawMsg);
  const elapsedMs = typeof error.elapsedMs === 'number' ? error.elapsedMs : null;

  let condition = 'aborted';
  if (code === 'ECONNABORTED' && /timeout/i.test(safeMsg)) {
    condition = 'timed out waiting for upstream response';
  } else if (code === 'ERR_CANCELED' || /cancel/i.test(safeMsg)) {
    condition = 'explicitly cancelled';
  } else if (code === 'ECONNREFUSED') {
    condition = 'connection refused by host';
  } else if (code === 'ENOTFOUND') {
    condition = 'DNS lookup failed';
  } else if (code === 'ETIMEDOUT') {
    condition = 'TCP connection timed out';
  }

  const parts = [
    `condition: ${condition}`,
    `code: ${code}`,
    `message: "${safeMsg}"`
  ];
  if (elapsedMs !== null) {
    parts.push(`elapsed: ${elapsedMs}ms`);
  }
  if (timeoutMs) {
    parts.push(`configured timeout: ${timeoutMs}ms`);
  }
  return parts.join('; ');
}

function toJsonBody(data) {
  if (data && typeof data === 'object') return data;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

function writeSanitizedSample(filename, body) {
  fs.mkdirSync(DOC_DIR, { recursive: true });
  const outputPath = path.join(DOC_DIR, filename);
  const sanitized = sanitizeSample(body);
  fs.writeFileSync(outputPath, `${JSON.stringify(sanitized, null, 2)}\n`, { flag: 'wx' });
  return outputPath;
}

function assertSandboxConfig() {
  const { TAXPRO_BASE_URL, TAXPRO_ASPID, TAXPRO_PASSWORD } = process.env;
  const missing = [];
  if (!TAXPRO_ASPID) missing.push('TAXPRO_ASPID');
  if (!TAXPRO_PASSWORD) missing.push('TAXPRO_PASSWORD');
  if (!TAXPRO_BASE_URL) missing.push('TAXPRO_BASE_URL');
  if (missing.length) throw new Error(`Set these values in Backend/.env first: ${missing.join(', ')}`);

  let parsed;
  try {
    parsed = new URL(TAXPRO_BASE_URL);
  } catch {
    throw new Error('TAXPRO_BASE_URL must be a valid TaxPro sandbox URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'gstsandbox.charteredinfo.com') {
    throw new Error('This collector only permits https://gstsandbox.charteredinfo.com.');
  }

  return parsed.origin;
}

async function sendGet(client, route, params, headers) {
  const startTime = Date.now();
  try {
    const response = await client.get(route, {
      params,
      headers,
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: () => true
    });
    return {
      status: response.status,
      body: toJsonBody(response.data),
      elapsedMs: Date.now() - startTime
    };
  } catch (error) {
    error.elapsedMs = Date.now() - startTime;
    throw error;
  }
}

async function saveCallResult(name, result) {
  if (!result.body) return;

  const successful = result.status >= 200 && result.status < 300 && result.body.status_cd === '1';
  const filename = successful ? name : name.replace(/\.json$/, '-error.json');
  try {
    writeSanitizedSample(filename, result.body);
  } catch (error) {
    if (error.code === 'EEXIST') {
      return;
    }
    throw error;
  }
}

async function requestSample(client, route, params, headers, filename, apiName) {
  const label = apiName || filename.replace(/\.json$/, '');
  try {
    const result = await sendGet(client, route, params, headers);
    await saveCallResult(filename, result);
    const httpClass = result.status ? `${Math.floor(result.status / 100)}xx` : 'none';
    const successful = result.status >= 200 && result.status < 300 && result.body?.status_cd === '1';
    const outcome = successful ? 'success' : (providerErrorCode(result.body) || 'error');
    console.log(`${label}: mode: ${PERIOD_PLACEMENT}, HTTP class: ${httpClass}, result: ${outcome}`);
    return successful;
  } catch (error) {
    const httpClass = error.response?.status ? `${Math.floor(error.response.status / 100)}xx` : 'network';
    const outcome = providerErrorCode(error.response?.data) || error.code || 'error';
    console.log(`${label}: mode: ${PERIOD_PLACEMENT}, HTTP class: ${httpClass}, result: ${outcome}`);
    return false;
  }
}

async function main() {
  const baseURL = assertSandboxConfig();
  if (!stdin.isTTY) throw new Error('Run this collector in a terminal, not in a non-interactive shell.');

  const prompt = createPrompt();
  const client = axios.create({ baseURL, timeout: REQUEST_TIMEOUT_MS, maxRedirects: 0 });
  const taxpayer = {};
  let otp = '';
  let tokenResponse;
  const credentials = {
    aspid: process.env.TAXPRO_ASPID,
    password: process.env.TAXPRO_PASSWORD
  };

  try {
    console.log('TaxPro sandbox sample collector. Raw responses and auth tokens stay in memory only.');
    console.log('API profile: current official docs (v4.1/v7.0/v4.2) or TaxPro email examples (v2.1/v0.3/v1.0).');
    const profile = (await prompt.question('Choose profile [current/email]: ')).trim().toLowerCase();
    if (!['current', 'email'].includes(profile)) throw new Error('Choose current or email.');
    if (profile === 'current' && !process.env.TAXPRO_GSP_IP_USR) {
      throw new Error('TAXPRO_GSP_IP_USR is required in Backend/.env for the current profile.');
    }
    const currentSettings = {};
    if (profile === 'current') {
      currentSettings.gstr1ActionRequired = (await prompt.question(
        'TaxPro-confirmed GSTR-1 action_required (Y/N): '
      )).trim().toUpperCase();
      if (!['Y', 'N'].includes(currentSettings.gstr1ActionRequired)) {
        throw new Error('Enter the TaxPro-confirmed Y or N value for GSTR-1 action_required.');
      }
    }

    taxpayer.gstin = (await prompt.question('Sandbox taxpayer GSTIN: ')).trim().toUpperCase();
    taxpayer.username = (await prompt.question('GST portal username: ')).trim();
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(taxpayer.gstin) || !taxpayer.username) {
      throw new Error('Enter a valid sandbox GSTIN and non-empty GST portal username.');
    }

    const otpRequest = await sendGet(client, AUTH_PATH, {
      action: 'OTPREQUEST',
      gstin: taxpayer.gstin,
      username: taxpayer.username
    }, credentials);
    if (otpRequest.status < 200 || otpRequest.status >= 300 || otpRequest.body?.status_cd !== '1') {
      await saveCallResult('otprequest.json', otpRequest);
      const code = providerErrorCode(otpRequest.body);
      const msg = providerErrorMessage(otpRequest.body);
      const details = [
        `HTTP ${otpRequest.status}`,
        `provider code: ${code || 'unavailable'}`,
        `provider message: ${msg || 'none'}`
      ].join('; ');
      throw new Error(`OTP request was not successful (${details}).`);
    }

    otp = await readHidden('GST portal OTP (input hidden): ');
    if (!/^\d{4,8}$/.test(otp)) throw new Error('OTP must contain 4 to 8 digits.');
    tokenResponse = await sendGet(client, AUTH_PATH, {
      action: 'AUTHTOKEN',
      gstin: taxpayer.gstin,
      username: taxpayer.username,
      OTP: otp
    }, credentials);
    if (tokenResponse.status < 200 || tokenResponse.status >= 300 ||
        tokenResponse.body?.status_cd !== '1' ||
        typeof tokenResponse.body.auth_token !== 'string' || !tokenResponse.body.auth_token) {
      await saveCallResult('authtoken.json', tokenResponse);
      const code = providerErrorCode(tokenResponse.body);
      const msg = providerErrorMessage(tokenResponse.body);
      const details = [
        `HTTP ${tokenResponse.status}`,
        `provider code: ${code || 'unavailable'}`,
        `provider message: ${msg || 'none'}`
      ].join('; ');
      throw new Error(`Auth-token request was not successful (${details}).`);
    }

    const authHeaders = { ...credentials, 'auth-token': tokenResponse.body.auth_token };
    otp = '';
    const periods = {};
    for (const returnType of ['GSTR-1', 'GSTR-3B', 'GSTR-2B']) {
      periods[returnType] = (await prompt.question(`${returnType} return period (MMYYYY): `)).trim();
      if (!isValidPeriod(periods[returnType])) {
        throw new Error(`${returnType} return period must be a valid past or current month in MMYYYY format.`);
      }
    }

    const isEmailProfile = profile === 'email';
    const stateCd = typeof taxpayer.gstin === 'string' && taxpayer.gstin.length >= 2
      ? taxpayer.gstin.slice(0, 2)
      : '';
    const sendHeaderPeriod = PERIOD_PLACEMENT === 'header' || PERIOD_PLACEMENT === 'both';
    const sendQueryPeriod = PERIOD_PLACEMENT === 'query' || PERIOD_PLACEMENT === 'both';

    const currentReturnHeaders = {
      ...authHeaders,
      gstin: taxpayer.gstin,
      username: taxpayer.username,
      'state-cd': stateCd,
      'ip-usr': process.env.TAXPRO_GSP_IP_USR
    };
    const gstr1Params = { action: 'B2B', gstin: taxpayer.gstin };
    if (!isEmailProfile) {
      gstr1Params.action_required = currentSettings.gstr1ActionRequired;
      if (sendQueryPeriod) {
        gstr1Params.ret_period = periods['GSTR-1'];
      }
      if (sendHeaderPeriod) {
        currentReturnHeaders.ret_period = periods['GSTR-1'];
      }
    } else {
      gstr1Params.username = taxpayer.username;
      gstr1Params.ret_period = periods['GSTR-1'];
    }
    await requestSample(
      client,
      isEmailProfile ? '/taxpayerapi/dec/v2.1/returns/gstr1' : '/taxpayerapi/dec/v4.1/returns/gstr1',
      gstr1Params,
      isEmailProfile ? authHeaders : { ...currentReturnHeaders, txn: crypto.randomUUID() },
      isEmailProfile ? 'gstr1-b2b-v2.1.json' : 'gstr1-b2b.json',
      'GSTR-1 B2B'
    );

    // The current GSTR-1 API documents RETSUM as a separate aggregate-summary call.
    // Keep the provider-email legacy profile limited to its explicitly listed B2B call.
    if (!isEmailProfile) {
      const gstr1RetsumParams = {
        action: 'RETSUM',
        gstin: taxpayer.gstin
      };
      if (sendQueryPeriod) {
        gstr1RetsumParams.ret_period = periods['GSTR-1'];
      }
      if (sendHeaderPeriod) {
        currentReturnHeaders.ret_period = periods['GSTR-1'];
      }
      await requestSample(
        client,
        '/taxpayerapi/dec/v4.1/returns/gstr1',
        gstr1RetsumParams,
        { ...currentReturnHeaders, txn: crypto.randomUUID() },
        'gstr1-retsum.json',
        'GSTR-1 RETSUM'
      );
    }

    if (!isEmailProfile && sendHeaderPeriod) {
      currentReturnHeaders.ret_period = periods['GSTR-3B'];
    }
    const gstr3bParams = {
      action: 'RETSUM',
      gstin: taxpayer.gstin,
      ...(isEmailProfile
        ? { username: taxpayer.username, ret_period: periods['GSTR-3B'] }
        : (sendQueryPeriod ? { ret_period: periods['GSTR-3B'] } : {}))
    };
    await requestSample(
      client,
      isEmailProfile ? '/taxpayerapi/dec/v0.3/returns/gstr3b' : '/taxpayerapi/dec/v7.0/returns/gstr3b',
      gstr3bParams,
      isEmailProfile ? authHeaders : { ...currentReturnHeaders, txn: crypto.randomUUID() },
      isEmailProfile ? 'gstr3b-retsum-v0.3.json' : 'gstr3b-retsum.json',
      'GSTR-3B RETSUM'
    );

    if (isEmailProfile) {
      await requestSample(
        client,
        '/taxpayerapi/dec/v1.0/returns/gstr2b',
        {
          action: 'GET2B',
          gstin: taxpayer.gstin,
          username: taxpayer.username,
          ret_period: periods['GSTR-2B'],
          rtnprd: periods['GSTR-2B']
        },
        authHeaders,
        'gstr2b-get2b-v1.0.json',
        'GSTR-2B'
      );
    } else {
      // Current profile requests GSTR-2B v4.2 GET2B.
      // Note: optional 'typ' and 'file_num' are omitted until documented by TaxPro.
      // On-demand generation APIs (GEN2B PUT v4.1, GENSTS2B GET v4.1) are omitted
      // pending provider confirmation on parameter placement (query vs JSON body).
      if (sendHeaderPeriod) {
        currentReturnHeaders.ret_period = periods['GSTR-2B'];
      }
      const gstr2bParams = {
        action: 'GET2B',
        gstin: taxpayer.gstin
      };
      if (sendQueryPeriod) {
        gstr2bParams.ret_period = periods['GSTR-2B'];
        gstr2bParams.rtnprd = periods['GSTR-2B'];
      }
      await requestSample(
        client,
        '/taxpayerapi/dec/v4.2/returns/gstr2b',
        gstr2bParams,
        { ...currentReturnHeaders, txn: crypto.randomUUID() },
        'gstr2b-success.json',
        'GSTR-2B'
      );
    }

    console.log('Review each sanitized file under doc/ before using it for a mapper or sharing it.');
  } finally {
    taxpayer.gstin = '';
    taxpayer.username = '';
    otp = '';
    if (tokenResponse?.body) tokenResponse.body.auth_token = '';
    credentials.aspid = '';
    credentials.password = '';
    prompt.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    // Never print raw Axios messages/config: even errors can carry the request URL or headers.
    if (error.isAxiosError) {
      const diag = formatSafeNetworkDiagnostics(error, REQUEST_TIMEOUT_MS);
      console.error(`TaxPro sample collection stopped: request failed (${diag}).`);
    } else {
      console.error(`TaxPro sample collection stopped: ${error.message}`);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  formatSafeHeaderDiagnostics,
  providerErrorMessage,
  formatSafeNetworkDiagnostics,
  PERIOD_PLACEMENT
};
