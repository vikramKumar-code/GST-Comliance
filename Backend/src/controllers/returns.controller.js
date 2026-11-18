const crypto = require('node:crypto');
const ReturnService = require('../services/return.service');
const { shouldSimulateDown } = require('../utils/testHooks');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const Workspace = require('../models/Workspace');
const Invoice = require('../models/Invoice');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { isValidGstin, isValidEvcOtp } = require('../utils/gstin');
const { isLiveFilingEnabled } = require('../utils/filingMode');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;
const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

// GSTN Save/Submit/Proceed are asynchronous. Poll RETSTATUS until processed.
// Default: 20 attempts * 3s = 60s.
// IMPORTANT: Filing routes must have HTTP timeout > this value, e.g. 90-120s.
const POLL_TRIES = Math.max(1, Number(process.env.GST_FILING_POLL_TRIES || 20));
const POLL_DELAY_MS = Math.max(500, Number(process.env.GST_FILING_POLL_DELAY_MS || 3000));

const TZ_OFFSET_MIN = Number(process.env.GST_TZ_OFFSET_MIN || 330);
const TZ_OFFSET_MS = TZ_OFFSET_MIN * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeErrorMessage(error) {
  if (!error) return 'unknown';

  const msg = typeof error.message === 'string' ? error.message : '';

  return (
    msg
      .replace(/https?:\/\/\S+/gi, '[URL_REDACTED]')
      .replace(
        /(password|token|secret|authtoken|auth-token|OTP|sid|sign|aspid|arn|reference_id)\s*[:=]\s*\S+/gi,
        '$1=[REDACTED]'
      )
      .slice(0, 220) || 'unknown'
  );
}

function getUsername(req) {
  return (
    req.body?.username ||
    req.query?.username ||
    req.username ||
    req.session?.username ||
    ''
  ).trim();
}

function errCdOf(err) {
  return (
    err?.errorCd ||
    err?.response?.data?.error?.error_cd ||
    err?.response?.data?.error_cd ||
    undefined
  );
}

function requirePeriod(value, label = 'period') {
  const period = String(value || '').trim();

  if (!period || !PERIOD_REGEX.test(period)) {
    throw ApiError.validationError(`A valid ${label} (MMYYYY) is required.`);
  }

  return period;
}

function currentIstPeriod() {
  const d = new Date(Date.now() + TZ_OFFSET_MS);
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${month}${year}`;
}

/**
 * Parses and validates excluded invoice IDs.
 * Accepts array, comma-separated string, or single value.
 */
function parseExcludedIds(value, label = 'excludedInvoiceIds') {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  let raw;

  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === 'string') {
    raw = value.split(',');
  } else {
    raw = [value];
  }

  const seen = new Set();
  const out = [];

  for (const item of raw) {
    const id = String(item ?? '').trim();

    if (!id) continue;

    if (!OBJECT_ID_REGEX.test(id)) {
      throw ApiError.validationError(
        `${label} contains invalid ObjectId: ${id}. Invoice IDs must be 24-character MongoDB ObjectIds.`
      );
    }

    if (seen.has(id)) continue;

    seen.add(id);
    out.push(id);
  }

  return out;
}

/**
 * Canonical JSON stringify with sorted object keys.
 * Used for stable payload hashing across prepare-filing and file-evc.
 */
function canonicalJsonStringify(value) {
  const seen = new WeakSet();

  return JSON.stringify(value, function replacer(key, val) {
    if (val === undefined) return undefined;

    if (typeof val === 'object' && val !== null) {
      if (Array.isArray(val)) return val;

      if (seen.has(val)) return '[Circular]';
      seen.add(val);

      const sorted = {};

      for (const k of Object.keys(val).sort()) {
        if (val[k] !== undefined) {
          sorted[k] = val[k];
        }
      }

      return sorted;
    }

    return val;
  });
}

function hashPayload(payload) {
  return crypto
    .createHash('sha256')
    .update(canonicalJsonStringify(payload ?? null))
    .digest('hex');
}

function hashGstr3BPrepared(prepared) {
  return hashPayload({
    payload: prepared?.payload ?? null,
    offsetPayload: prepared?.offsetPayload ?? null
  });
}

/**
 * Prevents sending duplicate responses if HTTP connection timed out while
 * processing continues in background.
 */
function sendJson(res, status, body) {
  if (res.headersSent) {
    logger.warn('Response already sent (likely HTTP timeout) — skipping duplicate response', {
      status
    });
    return;
  }

  res.status(status).json(body);
}

function forwardError(res, next, error) {
  if (res.headersSent) {
    logger.error('Request already responded (timeout?) — logging error instead of forwarding', {
      error_cd: errCdOf(error),
      code: error?.code,
      message: safeErrorMessage(error)
    });
    return;
  }

  next(error);
}

/**
 * GSTIN comes from a TRUSTED source only (workspace, or GST session set by auth middleware).
 * A GSTIN sent in query / body / header is accepted only if it equals the trusted one.
 * No silent TEST_GSTIN fallback outside NODE_ENV=test.
 */
async function resolveContext(req) {
  const workspaceId = await resolveWorkspaceId(req).catch((e) => {
    logger.debug('workspaceId resolution skipped', {
      error: safeErrorMessage(e)
    });
    return null;
  });

  const ws = workspaceId
    ? await Workspace.findById(workspaceId).lean().catch(() => null)
    : null;

  const trusted = ws?.gstin || req.gstin;
  const requested =
    req.query?.gstin ||
    req.body?.gstin ||
    req.headers?.['x-gstin'];

  let gstin = trusted;

  if (!gstin) {
    const env = process.env.NODE_ENV;

    if (env === 'test') {
      gstin = requested || process.env.TEST_GSTIN;
    } else if (env !== 'production') {
      gstin = requested; // local development convenience only
    }
  }

  if (!gstin) {
    throw ApiError.validationError(
      'Active workspace does not have a linked GSTIN. Please link your GSTIN in Settings or log in via GSTIN OTP first.'
    );
  }

  gstin = String(gstin).trim().toUpperCase();

  if (!isValidGstin(gstin)) {
    throw ApiError.invalidGstin('Invalid GSTIN format. Must be 15 alphanumeric characters.');
  }

  if (trusted && requested) {
    const requestedNorm = String(requested).trim().toUpperCase();

    if (requestedNorm && requestedNorm !== gstin) {
      throw ApiError.validationError('The requested GSTIN does not belong to the active workspace.');
    }
  }

  return {
    workspaceId: workspaceId || req.workspaceId || null,
    gstin
  };
}

/**
 * AuditLog compatibility helper.
 * Copies metadata/details depending on model schema and drops unknown top-level fields.
 */
async function writeAudit(entry) {
  try {
    const AuditLog = require('../models/AuditLog');
    const paths = AuditLog.schema?.paths || {};
    const payload = { ...entry };

    if (paths.details && !payload.details && payload.metadata) {
      payload.details = typeof payload.metadata === 'string'
        ? payload.metadata
        : JSON.stringify(payload.metadata);
    }

    if (payload.details && typeof payload.details !== 'string') {
      payload.details = JSON.stringify(payload.details);
    }

    if (paths.metadata && !payload.metadata && payload.details) {
      payload.metadata = payload.details;
    }

    if (Object.keys(paths).length > 0) {
      for (const key of Object.keys(payload)) {
        if (!paths[key]) delete payload[key];
      }
    }

    await AuditLog.create(payload);
  } catch (e) {
    logger.error('AuditLog write failed', {
      action: entry?.action,
      reason: safeErrorMessage(e)
    });
  }
}

/**
 * In-process guard against double submit (single instance only).
 * For multiple instances use a distributed lock (Redis SET NX EX or DB unique index).
 */
const inFlight = new Set();

function acquireLock(key) {
  if (inFlight.has(key)) {
    throw ApiError.validationError(
      'A filing for this return period is already in progress. Please wait for it to finish.'
    );
  }

  inFlight.add(key);

  return () => inFlight.delete(key);
}

async function assertNotAlreadyFiled(workspaceId, type, period) {
  const Filing = require('../models/Filing');

  const existing = await Filing.findOne({
    workspaceId,
    type,
    period,
    status: 'Filed',
    arn: { $exists: true, $nin: [null, ''] }
  }).lean();

  if (existing) {
    throw ApiError.validationError(
      `${type} for ${period} is already filed (ARN ${existing.arn || 'n/a'}).`
    );
  }
}

/**
 * Centralized reference_id resolver:
 * Official GSTN Save/Submit response schema requires `reference_id`.
 * Tolerates legacy `ref_id` too.
 */
function getRequiredRefId(res, label) {
  const refId = res?.reference_id || res?.ref_id;

  if (!refId || typeof refId !== 'string' || !refId.trim()) {
    throw ApiError.providerError(
      `${label}: GSTN response did not include required reference_id. Operation was not confirmed.`,
      502
    );
  }

  return refId.trim();
}

function getGstr1PreFileStep(provider) {
  const configured = String(process.env.TAXPRO_GSTR1_PRE_FILE_STEP || '').trim().toLowerCase();
  const fallback = provider?.apiProfile === 'current' ? 'none' : 'proceed';

  if (['none', 'proceed', 'retsubmit'].includes(configured)) {
    return configured;
  }

  return fallback;
}

function assertLiveProvider(provider, methods, label) {
  if (!provider || methods.some((m) => typeof provider[m] !== 'function')) {
    throw ApiError.providerError(
      `Active GST provider does not support the complete ${label} filing flow.`,
      502
    );
  }
}

function assertGstr1ProviderForStep(provider, step) {
  const required = ['saveGstr1', 'fileGstr1', 'trackStatus'];

  if (step === 'proceed') required.push('proceedToFile');
  if (step === 'retsubmit') required.push('submitGstr1');

  assertLiveProvider(provider, required, 'GSTR-1');
}

/**
 * Save / Submit / Proceed are asynchronous on the GST side.
 * Poll RETSTATUS until processed.
 *
 * GSTN status codes:
 * P  = processed
 * PE = processed with errors
 * ER = error
 * IP = in progress
 */
async function waitForProcessed(provider, refId, ctx, label, { req } = {}) {
  if (typeof provider.trackStatus !== 'function') {
    throw ApiError.providerError('Active GST provider cannot track processing status.', 502);
  }

  if (!refId) {
    throw ApiError.providerError(`${label}: reference id missing, cannot track processing.`, 502);
  }

  let timeoutWarned = false;
  let missingStatusCount = 0;

  for (let attempt = 1; attempt <= POLL_TRIES; attempt += 1) {
    const res = await provider.trackStatus(refId, {
      gstin: ctx.gstin,
      username: ctx.username,
      token: ctx.gstToken,
      gstToken: ctx.gstToken,
      period: ctx.period,
      ret_period: ctx.period,
      returnType: label.toUpperCase().includes('3B') ? 'GSTR3B' : 'GSTR1'
    });

    const st = String(res?.status_cd || '').toUpperCase();

    logger.info(`${label}: status poll ${attempt}/${POLL_TRIES}`, {
      status: st
    });

    if (!st) {
      missingStatusCount += 1;

      logger.warn(`${label}: status_cd missing in trackStatus response`, {
        attempt,
        responseKeys: Object.keys(res || {})
      });

      if (missingStatusCount >= 3) {
        throw ApiError.providerError(
          `${label}: GST portal status response is malformed (missing status_cd).`,
          502
        );
      }
    } else {
      missingStatusCount = 0;
    }

    if (req?.timedout && !timeoutWarned) {
      timeoutWarned = true;
      logger.warn(`${label}: HTTP request timed out — continuing processing in background`, {
        attempt
      });
    }

    if (st === 'P') return res;

    if (st === 'PE' || st === 'ER') {
      const report = res?.error_report || res?.data?.error_report || null;
      const reportMsg =
        report?.error_msg ||
        report?.message ||
        res?.data?.error?.message ||
        res?.data?.message ||
        (typeof report === 'string' ? report : null);
      const reportCd =
        res?.error_cd ||
        report?.error_cd ||
        res?.data?.error?.error_cd ||
        (st === 'PE' ? 'PROCESSED_WITH_ERRORS' : 'PROCESSING_ERROR');

      logger.error(`${label}: GST portal reported ${st}`, {
        status: st,
        error_cd: reportCd,
        error_msg: reportMsg,
        error_report: report
      });

      const detailMsg = reportMsg
        ? `${label}: GST portal error (${reportCd}): ${reportMsg}`
        : `${label}: the GST portal reported processing errors (${reportCd}). Please review the error report and correct the data.`;

      const err = ApiError.validationError(detailMsg);

      err.errorCd = reportCd;
      err.errorReport = report;

      throw err;
    }

    await sleep(POLL_DELAY_MS);
  }

  throw ApiError.providerError(
    `${label}: the GST portal is still processing. Please try again in a few minutes.`,
    504
  );
}

/**
 * GSTR-1: Save -> poll -> (pre-file step) -> poll.
 *
 * TAXPRO_GSTR1_PRE_FILE_STEP = retsubmit | proceed | none
 * Default: legacy -> proceed, current -> none.
 */
async function runGstr1PrepareSteps(provider, prepared, ctx, req, preFileStep) {
  const { gstin, period, username, gstToken } = ctx;

  const saved = await provider.saveGstr1(prepared.payload, {
    gstin,
    period,
    username,
    token: gstToken,
    gstToken
  });

  const saveRefId = getRequiredRefId(saved, 'GSTR-1 save');
  await waitForProcessed(provider, saveRefId, ctx, 'GSTR-1 save', { req });

  const step = preFileStep || getGstr1PreFileStep(provider);

  if (step === 'proceed' && typeof provider.proceedToFile === 'function') {
    try {
      const proceeded = await provider.proceedToFile(period, {
        gstin,
        username,
        token: gstToken,
        gstToken,
        returnType: 'GSTR1'
      });

      if (proceeded?.isSync === 'Y') {
        return saveRefId;
      }

      const proceedRefId = getRequiredRefId(proceeded, 'GSTR-1 proceed to file');
      await waitForProcessed(provider, proceedRefId, ctx, 'GSTR-1 proceed to file', { req });

      return saveRefId;
    } catch (procErr) {
      logger.warn('GSTR-1 proceedToFile failed, attempting RETSUBMIT fallback', {
        error: safeErrorMessage(procErr)
      });

      if (typeof provider.submitGstr1 === 'function') {
        const submitted = await provider.submitGstr1(period, {
          gstin,
          username,
          token: gstToken,
          gstToken
        });

        const submitRefId = getRequiredRefId(submitted, 'GSTR-1 submit');
        await waitForProcessed(provider, submitRefId, ctx, 'GSTR-1 submit', { req });

        return saveRefId;
      }

      throw procErr;
    }
  }

  if (step === 'retsubmit' && typeof provider.submitGstr1 === 'function') {
    const submitted = await provider.submitGstr1(period, {
      gstin,
      username,
      token: gstToken,
      gstToken
    });

    const submitRefId = getRequiredRefId(submitted, 'GSTR-1 submit');
    await waitForProcessed(provider, submitRefId, ctx, 'GSTR-1 submit', { req });
  }

  return saveRefId;
}

/**
 * GSTR-3B: Save -> poll -> Offset.
 * Offset is skipped when there is no liability/ITC utilization.
 */
async function runGstr3bPrepareSteps(provider, prepared, ctx, req) {
  if (!prepared || prepared.isNil || !prepared.payload) {
    throw ApiError.validationError(
      'Nil GSTR-3B cannot be prepared through the regular filing flow. Use the Nil Return filing endpoint.'
    );
  }

  const saved = await provider.saveGstr3b(prepared.payload, {
    gstin: ctx.gstin,
    period: ctx.period,
    username: ctx.username,
    token: ctx.gstToken,
    gstToken: ctx.gstToken
  });

  const saveRefId = getRequiredRefId(saved, 'GSTR-3B save');
  await waitForProcessed(provider, saveRefId, ctx, 'GSTR-3B save', { req });

  if (prepared.offsetPayload) {
    await provider.offsetGstr3b(ctx.period, {
      gstin: ctx.gstin,
      username: ctx.username,
      token: ctx.gstToken,
      gstToken: ctx.gstToken,
      body: prepared.offsetPayload
    });
  }

  return saveRefId;
}

// Local display format only (DD/MM/YYYY). GSTN upload payload uses DD-MM-YYYY in services.
function formatDate(date) {
  if (!date) return '';

  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const local = new Date(d.getTime() + TZ_OFFSET_MS);

  const day = String(local.getUTCDate()).padStart(2, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const year = local.getUTCFullYear();

  return `${day}/${month}/${year}`;
}

function maskPan(pan) {
  const s = String(pan || '');
  if (s.length < 4) return '****';
  return s.slice(0, 2) + '******' + s.slice(-2);
}

function mapGstr1FilingSummary(summary) {
  return {
    taxable: summary?.totalTaxable ?? 0,
    igst: summary?.totalIgst ?? 0,
    cgst: summary?.totalCgst ?? 0,
    sgst: summary?.totalSgst ?? 0,
    cess: summary?.totalCess ?? 0,
    totalTax: summary?.totalTax ?? 0
  };
}

function mapGstr3BFilingSummary(summary) {
  return {
    taxable: summary?.outwardTaxable ?? 0,
    igst: summary?.salesIgst ?? 0,
    cgst: summary?.salesCgst ?? 0,
    sgst: summary?.salesSgst ?? 0,
    cess: summary?.salesCess ?? 0,
    totalTax: summary?.outwardTax ?? 0,
    rcmTax: summary?.rcmLiability ?? 0,
    eligibleItc: summary?.eligibleItc ?? 0,
    netCashPayable: summary?.netCashPayable ?? 0
  };
}

function getIdempotencyKey(req) {
  return (
    req.idempotencyKey ||
    req.get?.('X-Idempotency-Key') ||
    req.body?.idempotencyKey ||
    null
  );
}

/* -------------------------------------------------------------------------- */
/* Read endpoints                                                             */
/* -------------------------------------------------------------------------- */

exports.getSummary = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);

    const period = req.query.period ? requirePeriod(req.query.period, 'period') : undefined;
    const simulateDown = shouldSimulateDown(req);

    const summary = await ReturnService.getReturnsSummary(gstin, period, req.gstToken, {
      simulateDown,
      username: getUsername(req),
      workspaceId,
      sessionId: req.session?._id
    });

    sendJson(res, 200, {
      ...summary,
      success: true,
      gstin,
      period: period || summary.period || null
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.getGstr1 = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.query.period, 'period');
    const simulateDown = shouldSimulateDown(req);

    const data = await ReturnService.getReturn('GSTR1', gstin, period, req.gstToken, {
      simulateDown,
      forceSync: req.query.forceSync === 'true',
      username: getUsername(req),
      workspaceId,
      sessionId: req.session?._id
    });

    sendJson(res, 200, {
      ...data,
      success: true,
      gstin,
      period
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.getGstr2b = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.query.period, 'period');
    const simulateDown = shouldSimulateDown(req);

    const data = await ReturnService.getReturn('GSTR2B', gstin, period, req.gstToken, {
      simulateDown,
      forceSync: req.query.forceSync === 'true',
      username: getUsername(req),
      workspaceId,
      sessionId: req.session?._id
    });

    sendJson(res, 200, {
      ...data,
      success: true,
      gstin,
      period
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.getGstr3b = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.query.period, 'period');
    const simulateDown = shouldSimulateDown(req);

    const data = await ReturnService.getReturn('GSTR3B', gstin, period, req.gstToken, {
      simulateDown,
      forceSync: req.query.forceSync === 'true',
      username: getUsername(req),
      workspaceId,
      sessionId: req.session?._id
    });

    sendJson(res, 200, {
      ...data,
      success: true,
      gstin,
      period
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

/* -------------------------------------------------------------------------- */
/* GSTR-1 prepare / save                                                      */
/* -------------------------------------------------------------------------- */

exports.prepareGstr1 = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.query.period || req.body?.period, 'period');

    const Gstr1Service = require('../services/gstr1.service');
    const excludedInvoiceIds = parseExcludedIds(
      req.body?.excludedInvoiceIds || req.query?.excludedInvoiceIds
    );

    const result = await Gstr1Service.preparePayload(workspaceId, gstin, period, {
      excludedInvoiceIds
    });

    sendJson(res, 200, {
      ...result,
      success: true,
      gstin,
      period
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.saveGstr1 = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.query.period || req.body?.period, 'period');

    const Gstr1Service = require('../services/gstr1.service');
    const excludedInvoiceIds = parseExcludedIds(
      req.body?.excludedInvoiceIds || req.query?.excludedInvoiceIds
    );

    const result = await Gstr1Service.savePayload(workspaceId, gstin, period, {
      username: getUsername(req),
      gstToken: req.gstToken,
      token: req.gstToken,
      excludedInvoiceIds,
      memberId: req.member?._id || req.user?._id || null,
      idempotencyKey: getIdempotencyKey(req)
    });

    sendJson(res, 200, {
      ...result,
      success: true,
      gstin,
      period
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.generateSummary = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.query.period || req.body?.period, 'period');

    const username = getUsername(req);
    const requestedNil = req.body?.isNil === true;
    const returnType = String(req.body?.returnType || req.query.returnType || 'GSTR1').toUpperCase();

    if (returnType !== 'GSTR1') {
      throw ApiError.validationError('This endpoint currently generates GSTR-1 summary only.');
    }

    logger.info(`Summary generation requested for [${gstin} - ${period}] (${returnType})`);

    const Gstr1Service = require('../services/gstr1.service');
    const excludedInvoiceIds = parseExcludedIds(
      req.body?.excludedInvoiceIds || req.query?.excludedInvoiceIds
    );

    const prepared = await Gstr1Service.preparePayload(workspaceId, gstin, period, {
      excludedInvoiceIds
    });

    const hasTransactions = Number(prepared?.summary?.includedInvoices || 0) > 0;

    if (requestedNil && hasTransactions) {
      throw ApiError.validationError(
        'Nil return cannot be generated because outward transactions exist. Remove transactions or file regular GSTR-1.'
      );
    }

    if (!hasTransactions) {
      return sendJson(res, 200, {
        success: true,
        isNil: true,
        gstin,
        period,
        message:
          'No outward transactions found. Nil return can be filed directly using "File Nil Return" with EVC OTP.'
      });
    }

    const saveRes = await Gstr1Service.savePayload(workspaceId, gstin, period, {
      username,
      gstToken: req.gstToken,
      token: req.gstToken,
      excludedInvoiceIds,
      memberId: req.member?._id || req.user?._id || null,
      idempotencyKey: getIdempotencyKey(req),
      prepared
    });

    sendJson(res, 200, {
      ...saveRes,
      success: true,
      gstin,
      period,
      message:
        'Invoices uploaded to GST Portal. Government portal is now calculating the official return summary.'
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

/* -------------------------------------------------------------------------- */
/* Nil return                                                                 */
/* -------------------------------------------------------------------------- */

exports.checkNilEligibility = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.query.period || req.body?.period, 'period');
    const type = String(req.query.type || req.body?.type || 'GSTR1').toUpperCase();

    if (!['GSTR1', 'GSTR3B'].includes(type)) {
      throw ApiError.validationError('Nil eligibility can be checked only for GSTR1 or GSTR3B.');
    }

    const NilReturnService = require('../services/nilReturn.service');

    const result = await NilReturnService.checkEligibility(
      workspaceId,
      gstin,
      period,
      type
    );

    sendJson(res, 200, {
      ...result,
      success: true,
      gstin,
      period,
      type
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

/**
 * Files a statutory Nil return under CGST Rule 67A.
 * Enforces concurrency locking, duplicate checks, server-side eligibility, and audit logging.
 */
exports.fileNilReturn = async (req, res, next) => {
  let release = () => { };
  let ctxForAudit = {};
  let returnType = 'GSTR1';

  try {
    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError(
        'Live Nil return filing is disabled outside production. No return was filed.',
        503
      );
    }

    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.body?.period, 'period');

    returnType = String(req.body?.returnType || req.body?.type || 'GSTR1').toUpperCase();
    ctxForAudit = { workspaceId, gstin, period, returnType };

    if (!['GSTR1', 'GSTR3B'].includes(returnType)) {
      throw ApiError.validationError('Nil return can only be filed for GSTR1 or GSTR-3B.');
    }

    if (req.body?.declarationAccepted !== true) {
      throw ApiError.validationError(
        'Statutory declaration per CGST Rule 67A must be accepted before filing a Nil return.'
      );
    }

    const verificationMode = String(req.body?.verificationMode || 'EVC').trim().toUpperCase();

    if (verificationMode !== 'EVC') {
      throw ApiError.validationError(
        'Nil return filing currently requires EVC verification. DSC/other modes are not supported by this provider flow.'
      );
    }

    if (!isValidEvcOtp(req.body?.otp)) {
      throw ApiError.validationError('Invalid EVC OTP format. Must be 4 to 8 letters or digits.');
    }

    const cleanPan = String(req.body?.pan || '').trim().toUpperCase();
    if (!PAN_REGEX.test(cleanPan)) {
      throw ApiError.validationError(
        'A valid authorised signatory PAN is required to file with EVC.'
      );
    }

    if (!req.gstToken) {
      throw ApiError.validationError(
        'Active GST Portal session token is required. Please verify OTP on the GST Return Hub first.'
      );
    }

    const lockKey = `${workspaceId || gstin}:${returnType}:${period}`;
    release = acquireLock(lockKey);

    await assertNotAlreadyFiled(workspaceId, returnType, period);

    const NilReturnService = require('../services/nilReturn.service');

    const result = await NilReturnService.fileNilReturn(
      workspaceId,
      gstin,
      period,
      returnType,
      {
        declarationAccepted: true,
        verificationMode: 'EVC',
        memberId: req.member?._id || req.user?._id || null,
        username: getUsername(req),
        gstToken: req.gstToken,
        token: req.gstToken,
        otp: String(req.body.otp || '').trim(),
        pan: cleanPan,
        idempotencyKey: getIdempotencyKey(req)
      }
    );

    sendJson(res, 200, {
      ...result,
      success: true,
      gstin,
      period,
      returnType
    });
  } catch (error) {
    await writeAudit({
      ...ctxForAudit,
      action: `${returnType}_NIL_FILE`,
      status: 'FAILED',
      metadata: {
        period: ctxForAudit.period,
        errorCd: errCdOf(error),
        code: error?.code,
        error: safeErrorMessage(error)
      }
    });

    logger.error('Nil return filing pipeline error', {
      error_cd: errCdOf(error),
      code: error?.code,
      message: safeErrorMessage(error)
    });

    forwardError(res, next, error);
  } finally {
    release();
  }
};

/* -------------------------------------------------------------------------- */
/* Demo data (never in production)                                            */
/* -------------------------------------------------------------------------- */

exports.seedSampleInvoices = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
      throw ApiError.validationError('Demo data seeding is disabled in production.');
    }

    const { workspaceId, gstin } = await resolveContext(req);

    if (!workspaceId) {
      throw ApiError.validationError('Active workspace context is required.');
    }

    const period = requirePeriod(
      req.body?.period || req.query?.period || currentIstPeriod(),
      'period'
    );

    const month = parseInt(period.slice(0, 2), 10);
    const year = parseInt(period.slice(2), 10);

    const supplierState = gstin.slice(0, 2);
    const otherState = supplierState === '29' ? '27' : '29';

    const d1 = new Date(Date.UTC(year, month - 1, 5, 10, 0, 0));
    const d2 = new Date(Date.UTC(year, month - 1, 15, 14, 30, 0));
    const d3 = new Date(Date.UTC(year, month - 1, 22, 11, 0, 0));

    const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

    const intraTaxable = 150000;
    const intraTax = round2(intraTaxable * 0.18);
    const intraCgst = round2(intraTax / 2);
    const intraSgst = round2(intraTax - intraCgst);

    const interTaxable = 250000;
    const interIgst = round2(interTaxable * 0.18);

    const unregTaxable = 12000;
    const unregTax = round2(unregTaxable * 0.18);
    const unregCgst = round2(unregTax / 2);
    const unregSgst = round2(unregTax - unregCgst);

    const sampleInvoices = [
      {
        workspaceId,
        gstin,
        supplierGstin: gstin,
        invoiceNumber: `INV-${period}-001`,
        invoiceDate: d1,
        dueDate: new Date(d1.getTime() + 15 * 86400000),
        customerName: 'Registered Buyer - Intra State',
        customerGstin: `${supplierState}AAACR7197Q1ZV`,
        placeOfSupply: `${supplierState}-Intra State`,
        status: 'Sent',
        documentType: 'INVOICE',
        invoiceType: 'INVOICE',
        sourceType: 'I',
        irn: `SAMPLEIRN-${period}-001`,
        irnGenDate: d1,
        isReverseCharge: false,
        subTotal: intraTaxable,
        totalIgst: 0,
        totalCgst: intraCgst,
        totalSgst: intraSgst,
        totalTax: intraTax,
        grandTotal: round2(intraTaxable + intraTax),
        lineItems: [
          {
            name: 'Cloud Computing Infrastructure Services',
            description: 'Monthly cloud hosting servers',
            hsnCode: '998313',
            hsnSac: '998313',
            unit: 'PCS',
            quantity: 1,
            rate: intraTaxable,
            taxableAmount: intraTaxable,
            gstRate: 18,
            igstAmount: 0,
            cgstAmount: intraCgst,
            sgstAmount: intraSgst,
            totalTax: intraTax,
            totalAmount: round2(intraTaxable + intraTax)
          }
        ]
      },
      {
        workspaceId,
        gstin,
        supplierGstin: gstin,
        invoiceNumber: `INV-${period}-002`,
        invoiceDate: d2,
        dueDate: new Date(d2.getTime() + 15 * 86400000),
        customerName: 'Registered Buyer - Inter State',
        customerGstin: `${otherState}AAAAT1234A1Z5`,
        placeOfSupply: `${otherState}-Inter State`,
        status: 'Paid',
        documentType: 'INVOICE',
        invoiceType: 'INVOICE',
        sourceType: 'I',
        irn: `SAMPLEIRN-${period}-002`,
        irnGenDate: d2,
        isReverseCharge: false,
        subTotal: interTaxable,
        totalIgst: interIgst,
        totalCgst: 0,
        totalSgst: 0,
        totalTax: interIgst,
        grandTotal: round2(interTaxable + interIgst),
        lineItems: [
          {
            name: 'Enterprise ERP Implementation',
            description: 'GST filing automation module',
            hsnCode: '998314',
            hsnSac: '998314',
            unit: 'PCS',
            quantity: 1,
            rate: interTaxable,
            taxableAmount: interTaxable,
            gstRate: 18,
            igstAmount: interIgst,
            cgstAmount: 0,
            sgstAmount: 0,
            totalTax: interIgst,
            totalAmount: round2(interTaxable + interIgst)
          }
        ]
      },
      {
        workspaceId,
        gstin,
        supplierGstin: gstin,
        invoiceNumber: `INV-${period}-003`,
        invoiceDate: d3,
        dueDate: new Date(d3.getTime() + 15 * 86400000),
        customerName: 'Retail Walk-in Consumer',
        customerGstin: '',
        placeOfSupply: `${supplierState}-Intra State`,
        status: 'Paid',
        documentType: 'INVOICE',
        invoiceType: 'INVOICE',
        sourceType: 'I',
        isReverseCharge: false,
        subTotal: unregTaxable,
        totalIgst: 0,
        totalCgst: unregCgst,
        totalSgst: unregSgst,
        totalTax: unregTax,
        grandTotal: round2(unregTaxable + unregTax),
        lineItems: [
          {
            name: 'Tax Compliance Software License',
            description: 'Single user desktop key',
            hsnCode: '997331',
            hsnSac: '997331',
            unit: 'PCS',
            quantity: 1,
            rate: unregTaxable,
            taxableAmount: unregTaxable,
            gstRate: 18,
            igstAmount: 0,
            cgstAmount: unregCgst,
            sgstAmount: unregSgst,
            totalTax: unregTax,
            totalAmount: round2(unregTaxable + unregTax)
          }
        ]
      }
    ];

    const inserted = [];

    for (const inv of sampleInvoices) {
      const exists = await Invoice.findOne({
        workspaceId,
        invoiceNumber: inv.invoiceNumber
      });

      if (!exists) {
        const created = await Invoice.create(inv);
        inserted.push(created);
      }
    }

    sendJson(res, 200, {
      success: true,
      gstin,
      period,
      message:
        inserted.length > 0
          ? `Successfully generated ${inserted.length} demo invoices for ${period}!`
          : `Sample invoices for ${period} already exist in this workspace.`,
      count: inserted.length
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

/* -------------------------------------------------------------------------- */
/* GSTR-1 filing                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Run Save -> poll -> pre-file step BEFORE the user is asked for the EVC OTP,
 * so the OTP is used within seconds of being typed.
 *
 * UI flow:
 *   1) POST /returns/gstr1/prepare-filing
 *   2) request the EVC OTP
 *   3) POST /returns/gstr1/file-evc with { alreadyPrepared: true, otp, pan, period }
 */
exports.prepareGstr1Filing = async (req, res, next) => {
  let release = () => { };
  let ctxForAudit = {};

  try {
    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError(
        'Live GSTR-1 filing is disabled outside production. No return was filed.',
        503
      );
    }

    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.body?.period, 'period');

    ctxForAudit = { workspaceId, gstin, period };

    if (!req.gstToken) {
      throw ApiError.validationError(
        'Active GST Portal session token is required. Please verify OTP on the GST Return Hub first.'
      );
    }

    const lockKey = `${workspaceId || gstin}:GSTR1:${period}`;
    release = acquireLock(lockKey);

    await assertNotAlreadyFiled(workspaceId, 'GSTR1', period);

    const FinaggService = require('../services/finagg.service');
    const Gstr1Service = require('../services/gstr1.service');
    const provider = FinaggService.getProvider();
    const providerName = FinaggService.getProviderNameSafe();

    const step = getGstr1PreFileStep(provider);
    assertGstr1ProviderForStep(provider, step);

    const excludedInvoiceIds = parseExcludedIds(req.body?.excludedInvoiceIds);
    const idempotencyKey = getIdempotencyKey(req);

    const prepared = await Gstr1Service.prepareAndValidate(workspaceId, gstin, period, {
      excludedInvoiceIds
    });

    const saveRefId = await runGstr1PrepareSteps(
      provider,
      prepared,
      {
        gstin,
        period,
        username: getUsername(req),
        gstToken: req.gstToken
      },
      req,
      step
    );

    const payloadHash = hashPayload(prepared.payload);
    const Filing = require('../models/Filing');

    await Filing.findOneAndUpdate(
      { workspaceId, type: 'GSTR1', period },
      {
        $set: {
          workspaceId,
          gstin,
          type: 'GSTR1',
          period,
          status: 'ReadyToEVC',
          referenceId: saveRefId,
          payloadHash,
          excludedInvoiceIds,
          idempotencyKey,
          summary: mapGstr1FilingSummary(prepared.summary)
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );

    await writeAudit({
      workspaceId,
      gstin,
      action: 'GSTR1_PREPARE_FILING',
      status: 'SUCCESS',
      metadata: {
        period,
        provider: providerName,
        ref_id: saveRefId,
        excludedInvoiceIds,
        idempotencyKey
      }
    });

    sendJson(res, 200, {
      success: true,
      ready: true,
      period,
      gstin,
      reference_id: saveRefId,
      summary: prepared.summary,
      message: 'GSTR-1 is saved and ready. You can now request the EVC OTP and file.'
    });
  } catch (error) {
    await writeAudit({
      ...ctxForAudit,
      action: 'GSTR1_PREPARE_FILING',
      status: 'FAILED',
      metadata: {
        period: ctxForAudit.period || req.body?.period,
        errorCd: errCdOf(error),
        code: error?.code,
        error: safeErrorMessage(error)
      }
    });

    forwardError(res, next, error);
  } finally {
    release();
  }
};

/**
 * File GSTR-1 with Electronic Verification Code (EVC).
 */
exports.fileGstr1WithEvc = async (req, res, next) => {
  let release = () => { };
  let ctxForAudit = {};

  try {
    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError(
        'Live GSTR-1 filing is disabled outside production. No return was filed.',
        503
      );
    }

    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.body?.period, 'period');

    const { pan, otp, alreadyPrepared } = req.body;
    ctxForAudit = { workspaceId, gstin, period };

    if (!otp || typeof otp !== 'string' || !otp.trim()) {
      throw ApiError.validationError('EVC OTP is required.');
    }

    const cleanOtp = otp.trim();
    if (!isValidEvcOtp(cleanOtp)) {
      throw ApiError.validationError('Invalid EVC OTP format. Must be 4 to 8 letters or digits.');
    }

    const cleanPan = String(pan || '').trim().toUpperCase();
    if (!PAN_REGEX.test(cleanPan)) {
      throw ApiError.validationError(
        'A valid authorised signatory PAN is required to file with EVC.'
      );
    }

    if (!req.gstToken) {
      throw ApiError.validationError(
        'Active GST Portal session token is required to file GSTR-1 on the Government Portal. Please verify OTP on the GST Return Hub first.'
      );
    }

    const lockKey = `${workspaceId || gstin}:GSTR1:${period}`;
    release = acquireLock(lockKey);

    await assertNotAlreadyFiled(workspaceId, 'GSTR1', period);

    const Filing = require('../models/Filing');
    const Gstr1Service = require('../services/gstr1.service');
    const FinaggService = require('../services/finagg.service');
    const provider = FinaggService.getProvider();
    const providerName = FinaggService.getProviderNameSafe();

    const step = getGstr1PreFileStep(provider);
    assertGstr1ProviderForStep(provider, step);

    const idempotencyKey = getIdempotencyKey(req);
    const requestedExcludedIds = parseExcludedIds(req.body?.excludedInvoiceIds);

    let effectiveExcludedIds = requestedExcludedIds;
    let readyFiling = null;

    if (alreadyPrepared) {
      readyFiling = await Filing.findOne({ workspaceId, type: 'GSTR1', period }).lean();

      if (
        !readyFiling ||
        readyFiling.status !== 'ReadyToEVC' ||
        !readyFiling.payloadHash
      ) {
        throw ApiError.validationError(
          'Prepare-filing state not found. Please run prepare-filing again before filing.'
        );
      }

      if (!readyFiling.referenceId && !readyFiling.ref_id) {
        throw ApiError.validationError(
          'Prepare-filing reference id is missing. Please run prepare-filing again before filing.'
        );
      }

      // Critical: when alreadyPrepared=true, use the exact exclusions persisted during prepare-filing.
      // Do not allow client to change exclusions at EVC stage.
      effectiveExcludedIds = Array.isArray(readyFiling.excludedInvoiceIds)
        ? readyFiling.excludedInvoiceIds.map(String)
        : [];
    }

    const username = getUsername(req);
    const ctx = { gstin, period, username, gstToken: req.gstToken };

    const prepared = await Gstr1Service.prepareAndValidate(workspaceId, gstin, period, {
      excludedInvoiceIds: effectiveExcludedIds
    });

    const currentHash = hashPayload(prepared.payload);

    if (alreadyPrepared) {
      if (readyFiling.payloadHash !== currentHash) {
        throw ApiError.validationError(
          'Return data changed after prepare-filing. Please prepare filing again.'
        );
      }
    } else {
      const saveRefId = await runGstr1PrepareSteps(provider, prepared, ctx, req, step);

      await Filing.findOneAndUpdate(
        { workspaceId, type: 'GSTR1', period },
        {
          $set: {
            workspaceId,
            gstin,
            type: 'GSTR1',
            period,
            status: 'ReadyToEVC',
            referenceId: saveRefId,
            payloadHash: currentHash,
            excludedInvoiceIds: effectiveExcludedIds,
            idempotencyKey,
            summary: mapGstr1FilingSummary(prepared.summary)
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true
        }
      );
    }

    // File with EVC
    let arn;

    try {
      const fileRes = await provider.fileGstr1(period, {
        gstin,
        username,
        token: req.gstToken,
        gstToken: req.gstToken,
        otp: cleanOtp,
        pan: cleanPan,
        mode: 'EVC'
      });

      arn = fileRes?.arn;
    } catch (fileErr) {
      // RETFILE outcome can be unknown (timeout / 5xx / missing ack_num).
      // Before reporting failure, ask the portal whether the return is already filed.
      if (fileErr?.pendingVerification) {
        arn = await FinaggService.findFiledArn(gstin, period, 'GSTR1');

        if (!arn) {
          await writeAudit({
            workspaceId,
            gstin,
            action: 'GSTR1_FILE_EVC',
            status: 'FAILED',
            metadata: {
              period,
              provider: providerName,
              errorCd: errCdOf(fileErr),
              outcome: 'UNCONFIRMED',
              idempotencyKey,
              error: safeErrorMessage(fileErr)
            }
          });

          return sendJson(res, 202, {
            success: false,
            pending: true,
            period,
            gstin,
            message:
              'The GST portal did not confirm the filing yet. Please check the filing status in a few minutes before trying again.'
          });
        }

        logger.warn('GSTR-1 RETFILE unconfirmed but portal shows the return as filed');
      } else {
        throw fileErr;
      }
    }

    if (!arn) {
      throw ApiError.providerError('GSTR-1 filing was not confirmed by the GST provider.', 502);
    }

    const filingDate = new Date();
    const dateStr = formatDate(filingDate);

    let filingSaved = true;

    try {
      await Filing.findOneAndUpdate(
        { workspaceId, type: 'GSTR1', period },
        {
          $set: {
            workspaceId,
            gstin,
            type: 'GSTR1',
            period,
            arn,
            status: 'Filed',
            mode: 'EVC',
            isNil: false,
            filingDate,
            dateStr,
            declarationAccepted: true,
            payloadHash: currentHash,
            excludedInvoiceIds: effectiveExcludedIds,
            idempotencyKey,
            summary: mapGstr1FilingSummary(prepared.summary)
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true
        }
      );
    } catch (dbErr) {
      filingSaved = false;

      logger.error('GSTR-1 filed successfully on GST portal but local Filing record update failed', {
        arn,
        period,
        gstin,
        message: safeErrorMessage(dbErr)
      });
    }

    await writeAudit({
      workspaceId,
      gstin,
      action: 'GSTR1_FILE_EVC',
      status: 'SUCCESS',
      metadata: {
        arn,
        period,
        provider: providerName,
        pan: maskPan(cleanPan),
        localRecordSaved: filingSaved,
        idempotencyKey
      }
    });

    sendJson(res, 200, {
      success: true,
      arn,
      period,
      gstin,
      status: 'Filed',
      mode: 'EVC',
      filingDate: dateStr,
      summary: prepared.summary,
      localRecordSaved: filingSaved,
      message: filingSaved
        ? `GSTR-1 for ${period} successfully filed with EVC verification! Official ARN: ${arn}`
        : `GSTR-1 for ${period} was filed on GST portal (ARN: ${arn}), but local record sync failed. Please contact support before retrying.`
    });
  } catch (error) {
    await writeAudit({
      ...ctxForAudit,
      action: 'GSTR1_FILE_EVC',
      status: 'FAILED',
      metadata: {
        period: ctxForAudit.period,
        errorCd: errCdOf(error),
        code: error?.code,
        error: safeErrorMessage(error)
      }
    });

    logger.error('Live GSTR-1 filing pipeline error', {
      error_cd: errCdOf(error),
      code: error?.code,
      message: safeErrorMessage(error)
    });

    forwardError(res, next, error);
  } finally {
    release();
  }
};

/* -------------------------------------------------------------------------- */
/* GSTR-3B                                                                    */
/* -------------------------------------------------------------------------- */

exports.prepareGstr3b = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.query.period || req.body?.period, 'period');

    const Gstr3bService = require('../services/gstr3b.service');
    const result = await Gstr3bService.preparePayload(workspaceId, gstin, period);

    sendJson(res, 200, {
      ...result,
      success: true,
      gstin,
      period
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.saveGstr3b = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.query.period || req.body?.period, 'period');

    const Gstr3bService = require('../services/gstr3b.service');

    const result = await Gstr3bService.savePayload(workspaceId, gstin, period, {
      username: getUsername(req),
      gstToken: req.gstToken,
      token: req.gstToken,
      memberId: req.member?._id || req.user?._id || null,
      idempotencyKey: getIdempotencyKey(req)
    });

    sendJson(res, 200, {
      ...result,
      success: true,
      gstin,
      period
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.offsetGstr3b = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.query.period || req.body?.period, 'period');

    const Gstr3bService = require('../services/gstr3b.service');

    const result = await Gstr3bService.offsetLiabilities(workspaceId, gstin, period, {
      username: getUsername(req),
      gstToken: req.gstToken,
      token: req.gstToken,
      memberId: req.member?._id || req.user?._id || null,
      body: req.body?.offsetPayload,
      idempotencyKey: getIdempotencyKey(req)
    });

    sendJson(res, 200, {
      success: true,
      gstin,
      period,
      message:
        result?.skipped
          ? 'No GSTR-3B liability or ITC utilization requires offset.'
          : 'Tax liability offset completed successfully.',
      result
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

/**
 * GSTR-3B pre-filing handler (Save -> Poll -> Offset) executed before requesting EVC OTP.
 *
 * UI flow:
 *   1) POST /returns/gstr3b/prepare-filing
 *   2) request the EVC OTP
 *   3) POST /returns/gstr3b/file-evc with { alreadyPrepared: true, otp, pan, period }
 */
exports.prepareGstr3bFiling = async (req, res, next) => {
  let release = () => { };
  let ctxForAudit = {};

  try {
    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError(
        'Live GSTR-3B filing is disabled outside production. No return was filed.',
        503
      );
    }

    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.body?.period, 'period');

    ctxForAudit = { workspaceId, gstin, period };

    if (!req.gstToken) {
      throw ApiError.validationError(
        'Active GST Portal session token is required. Please verify OTP on the GST Return Hub first.'
      );
    }

    const lockKey = `${workspaceId || gstin}:GSTR3B:${period}`;
    release = acquireLock(lockKey);

    await assertNotAlreadyFiled(workspaceId, 'GSTR3B', period);

    const Gstr3bService = require('../services/gstr3b.service');
    const FinaggService = require('../services/finagg.service');
    const provider = FinaggService.getProvider();
    const providerName = FinaggService.getProviderNameSafe();

    assertLiveProvider(
      provider,
      ['saveGstr3b', 'offsetGstr3b', 'getGstr3bRetSum', 'fileGstr3b', 'trackStatus'],
      'GSTR-3B'
    );

    const ctx = {
      gstin,
      period,
      username: getUsername(req),
      gstToken: req.gstToken
    };

    const idempotencyKey = getIdempotencyKey(req);
    const prepared = await Gstr3bService.preparePayload(workspaceId, gstin, period);

    if (prepared.isNil) {
      throw ApiError.validationError(
        'Nil GSTR-3B must be filed using the Nil Return endpoint, not regular GSTR-3B filing.'
      );
    }

    const saveRefId = await runGstr3bPrepareSteps(provider, prepared, ctx, req);
    const payloadHash = hashGstr3BPrepared(prepared);

    const Filing = require('../models/Filing');

    await Filing.findOneAndUpdate(
      { workspaceId, type: 'GSTR3B', period },
      {
        $set: {
          workspaceId,
          gstin,
          type: 'GSTR3B',
          period,
          status: 'ReadyToEVC',
          referenceId: saveRefId,
          payloadHash,
          idempotencyKey,
          summary: mapGstr3BFilingSummary(prepared.summary)
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );

    await writeAudit({
      workspaceId,
      gstin,
      action: 'GSTR3B_PREPARE_FILING',
      status: 'SUCCESS',
      metadata: {
        period,
        provider: providerName,
        ref_id: saveRefId,
        idempotencyKey
      }
    });

    sendJson(res, 200, {
      success: true,
      ready: true,
      period,
      gstin,
      reference_id: saveRefId,
      summary: prepared.summary,
      message:
        'GSTR-3B is saved and liability offset is done. You can now request the EVC OTP and file.'
    });
  } catch (error) {
    await writeAudit({
      ...ctxForAudit,
      action: 'GSTR3B_PREPARE_FILING',
      status: 'FAILED',
      metadata: {
        period: ctxForAudit.period || req.body?.period,
        errorCd: errCdOf(error),
        code: error?.code,
        error: safeErrorMessage(error)
      }
    });

    forwardError(res, next, error);
  } finally {
    release();
  }
};

/**
 * File GSTR-3B with EVC.
 *
 * Flow:
 *   (Save -> poll -> Offset) -> final summary (final=Y, RAW) -> File (EVC)
 *
 * Heavy steps skip ho jate hain jab alreadyPrepared = true, but hash verification compulsory hai.
 */
exports.fileGstr3bWithEvc = async (req, res, next) => {
  let release = () => { };
  let ctxForAudit = {};

  try {
    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError(
        'Live GSTR-3B filing is disabled outside production. No return was filed.',
        503
      );
    }

    const { workspaceId, gstin } = await resolveContext(req);
    const period = requirePeriod(req.body?.period, 'period');

    const { pan, otp, alreadyPrepared } = req.body;
    ctxForAudit = { workspaceId, gstin, period };

    if (!otp || typeof otp !== 'string' || !otp.trim()) {
      throw ApiError.validationError('EVC OTP is required.');
    }

    const cleanOtp = otp.trim();
    if (!isValidEvcOtp(cleanOtp)) {
      throw ApiError.validationError('Invalid EVC OTP format. Must be 4 to 8 letters or digits.');
    }

    const cleanPan = String(pan || '').trim().toUpperCase();
    if (!PAN_REGEX.test(cleanPan)) {
      throw ApiError.validationError(
        'A valid authorised signatory PAN is required to file with EVC.'
      );
    }

    if (!req.gstToken) {
      throw ApiError.validationError(
        'Active GST Portal session token is required to file GSTR-3B on the Government Portal. Please verify OTP on the GST Return Hub first.'
      );
    }

    const lockKey = `${workspaceId || gstin}:GSTR3B:${period}`;
    release = acquireLock(lockKey);

    await assertNotAlreadyFiled(workspaceId, 'GSTR3B', period);

    const Filing = require('../models/Filing');
    const Gstr3bService = require('../services/gstr3b.service');
    const FinaggService = require('../services/finagg.service');
    const provider = FinaggService.getProvider();
    const providerName = FinaggService.getProviderNameSafe();

    assertLiveProvider(
      provider,
      ['saveGstr3b', 'offsetGstr3b', 'getGstr3bRetSum', 'fileGstr3b', 'trackStatus'],
      'GSTR-3B'
    );

    const username = getUsername(req);
    const ctx = { gstin, period, username, gstToken: req.gstToken };
    const idempotencyKey = getIdempotencyKey(req);

    const prepared = await Gstr3bService.preparePayload(workspaceId, gstin, period);

    if (prepared.isNil) {
      throw ApiError.validationError(
        'Nil GSTR-3B must be filed using the Nil Return endpoint, not regular GSTR-3B filing.'
      );
    }

    const currentHash = hashGstr3BPrepared(prepared);
    let readyFiling = null;

    if (alreadyPrepared) {
      readyFiling = await Filing.findOne({ workspaceId, type: 'GSTR3B', period }).lean();

      if (
        !readyFiling ||
        readyFiling.status !== 'ReadyToEVC' ||
        !readyFiling.payloadHash
      ) {
        throw ApiError.validationError(
          'Prepare-filing state not found. Please run prepare-filing again before filing.'
        );
      }

      if (readyFiling.payloadHash !== currentHash) {
        throw ApiError.validationError(
          'GSTR-3B payload/offset data changed after prepare-filing. Please prepare filing again.'
        );
      }
    } else {
      const saveRefId = await runGstr3bPrepareSteps(provider, prepared, ctx, req);

      await Filing.findOneAndUpdate(
        { workspaceId, type: 'GSTR3B', period },
        {
          $set: {
            workspaceId,
            gstin,
            type: 'GSTR3B',
            period,
            status: 'ReadyToEVC',
            referenceId: saveRefId,
            payloadHash: currentHash,
            idempotencyKey,
            summary: mapGstr3BFilingSummary(prepared.summary)
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true
        }
      );
    }

    // Step: post-offset FINAL summary (final=Y), RAW string needed for the signature.
    // Always fresh — stale liability ids fail on the portal.
    const finalSummary = await provider.getGstr3bRetSum(gstin, period, {
      username,
      token: req.gstToken,
      gstToken: req.gstToken,
      final: 'Y',
      raw: true
    });

    if (!finalSummary?.raw || !finalSummary?.data) {
      throw ApiError.providerError(
        'GSTR-3B final summary (final=Y) could not be fetched. Filing aborted.',
        502
      );
    }

    // Step: File with EVC
    let arn;

    try {
      const fileRes = await provider.fileGstr3b(period, {
        ...ctx,
        token: req.gstToken,
        gstToken: req.gstToken,
        otp: cleanOtp,
        pan: cleanPan,
        mode: 'EVC',
        finalSummaryRaw: finalSummary.raw,
        finalSummaryData: finalSummary.data
      });

      arn = fileRes?.arn;
    } catch (fileErr) {
      if (fileErr?.pendingVerification) {
        arn = await FinaggService.findFiledArn(gstin, period, 'GSTR3B');

        if (!arn) {
          await writeAudit({
            workspaceId,
            gstin,
            action: 'GSTR3B_FILE_EVC',
            status: 'FAILED',
            metadata: {
              period,
              provider: providerName,
              errorCd: errCdOf(fileErr),
              outcome: 'UNCONFIRMED',
              idempotencyKey,
              error: safeErrorMessage(fileErr)
            }
          });

          return sendJson(res, 202, {
            success: false,
            pending: true,
            period,
            gstin,
            message:
              'The GST portal did not confirm the filing yet. Please check the filing status in a few minutes before trying again.'
          });
        }

        logger.warn('GSTR-3B RETFILE unconfirmed but portal shows the return as filed');
      } else {
        throw fileErr;
      }
    }

    if (!arn) {
      throw ApiError.providerError('GSTR-3B filing was not confirmed by the GST provider.', 502);
    }

    // Step: Save Filing Record & Audit Log (non-fatal DB update)
    const filingDate = new Date();
    const dateStr = formatDate(filingDate);

    let filingSaved = true;

    try {
      await Filing.findOneAndUpdate(
        { workspaceId, type: 'GSTR3B', period },
        {
          $set: {
            workspaceId,
            gstin,
            type: 'GSTR3B',
            period,
            arn,
            status: 'Filed',
            mode: 'EVC',
            isNil: false,
            filingDate,
            dateStr,
            declarationAccepted: true,
            payloadHash: currentHash,
            idempotencyKey,
            summary: mapGstr3BFilingSummary(prepared.summary)
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true
        }
      );
    } catch (dbErr) {
      filingSaved = false;

      logger.error('GSTR-3B filed successfully on GST portal but local Filing record update failed', {
        arn,
        period,
        gstin,
        message: safeErrorMessage(dbErr)
      });
    }

    await writeAudit({
      workspaceId,
      gstin,
      action: 'GSTR3B_FILE_EVC',
      status: 'SUCCESS',
      metadata: {
        arn,
        period,
        provider: providerName,
        pan: maskPan(cleanPan),
        localRecordSaved: filingSaved,
        idempotencyKey
      }
    });

    sendJson(res, 200, {
      success: true,
      arn,
      period,
      gstin,
      status: 'Filed',
      mode: 'EVC',
      filingDate: dateStr,
      summary: prepared.summary,
      localRecordSaved: filingSaved,
      message: filingSaved
        ? `GSTR-3B for ${period} successfully filed with EVC verification! Official ARN: ${arn}`
        : `GSTR-3B for ${period} was filed on GST portal (ARN: ${arn}), but local record sync failed. Please contact support before retrying.`
    });
  } catch (error) {
    await writeAudit({
      ...ctxForAudit,
      action: 'GSTR3B_FILE_EVC',
      status: 'FAILED',
      metadata: {
        period: ctxForAudit.period,
        errorCd: errCdOf(error),
        code: error?.code,
        error: safeErrorMessage(error)
      }
    });

    logger.error('Live GSTR-3B filing pipeline error', {
      error_cd: errCdOf(error),
      code: error?.code,
      message: safeErrorMessage(error)
    });

    forwardError(res, next, error);
  } finally {
    release();
  }
};