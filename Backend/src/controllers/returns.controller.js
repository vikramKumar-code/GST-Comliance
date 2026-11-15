const crypto = require('node:crypto');
const ReturnService = require('../services/return.service');
const { shouldSimulateDown } = require('../utils/testHooks');
const { resolveWorkspaceId } = require('../utils/workspaceHelper');
const Workspace = require('../models/Workspace');
const Invoice = require('../models/Invoice');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { isValidEvcOtp } = require('../utils/gstin');
const { isLiveFilingEnabled } = require('../utils/filingMode');
const { validateGstr1Schema } = require('../utils/gstr1Validator');

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getUsername(req) {
  return req.body?.username || req.username || req.session?.username;
}

// Read top-level or nested error code from provider/axios error objects
function errCdOf(err) {
  return err?.errorCd
    || err?.response?.data?.error?.error_cd
    || err?.response?.data?.error_cd
    || undefined;
}

/**
 * Prevents sending duplicate responses if HTTP connection timed out while processing in background.
 * Ensures long-running filing operations complete safely even if client connection drops.
 */
function sendJson(res, status, body) {
  if (res.headersSent) {
    logger.warn('Response already sent (likely HTTP timeout) — skipping duplicate response', { status });
    return;
  }
  res.status(status).json(body);
}

function forwardError(res, next, error) {
  if (res.headersSent) {
    logger.error('Request already responded (timeout?) — logging error instead of forwarding', {
      error_cd: errCdOf(error),
      code: error?.code,
      message: error?.message
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
  const workspaceId = await resolveWorkspaceId(req).catch(() => null);
  const ws = workspaceId ? await Workspace.findById(workspaceId).lean() : null;
  const trusted = ws?.gstin || req.gstin;
  const requested = req.query?.gstin || req.body?.gstin || req.headers?.['x-gstin'];

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
    throw ApiError.validationError('Active workspace does not have a linked GSTIN. Please link your GSTIN in Settings or log in via GSTIN OTP first.');
  }
  if (trusted && requested && String(requested).toUpperCase() !== String(trusted).toUpperCase()) {
    throw ApiError.validationError('The requested GSTIN does not belong to the active workspace.');
  }
  return { workspaceId: workspaceId || req.workspaceId, gstin: String(gstin).toUpperCase() };
}

async function writeAudit(entry) {
  try {
    const AuditLog = require('../models/AuditLog');
    await AuditLog.create(entry);
  } catch (e) {
    logger.error('AuditLog write failed', { action: entry?.action, reason: e?.message });
  }
}

// In-process guard against double submit (single instance).
// For multiple instances use a distributed lock (Redis SET NX EX or a DB unique index).
const inFlight = new Set();

function acquireLock(key) {
  if (inFlight.has(key)) {
    throw ApiError.validationError('A filing for this return period is already in progress. Please wait for it to finish.');
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
    throw ApiError.validationError(`${type} for ${period} is already filed (ARN ${existing.arn || 'n/a'}).`);
  }
}

/**
 * Centralized reference_id resolver:
 * GSTN RETSAVE response requires `reference_id` per official schema.
 * Tolerates both `reference_id` and legacy `ref_id`.
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

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function getGstr1PreFileStep(provider) {
  const configured = String(process.env.TAXPRO_GSTR1_PRE_FILE_STEP || '').toLowerCase();
  return configured || (provider?.apiProfile === 'current' ? 'none' : 'proceed');
}

function assertGstr1ProviderForStep(provider, step) {
  const required = ['saveGstr1', 'fileGstr1', 'trackStatus'];
  if (step === 'proceed') required.push('proceedToFile');
  if (step === 'retsubmit') required.push('submitGstr1');
  assertLiveProvider(provider, required, 'GSTR-1');
}

/**
 * Save / Submit / Proceed are asynchronous on the GST side. Poll RETSTATUS until processed.
 * GSTN status codes: P = processed, PE = processed with errors, ER = error, IP = in progress.
 *
 * ⚠️ IMPORTANT: tries × delayMs (18 × 3s = 54s) exceeds the global 30s HTTP timeout.
 * Filing routes MUST use a longer per-route timeout — see routes snippet below.
 */
async function waitForProcessed(provider, refId, ctx, label, { tries = 18, delayMs = 3000, req } = {}) {
  if (typeof provider.trackStatus !== 'function') {
    throw ApiError.providerError('Active GST provider cannot track processing status.', 502);
  }
  if (!refId) {
    throw ApiError.providerError(`${label}: reference id missing, cannot track processing.`, 502);
  }
  let timeoutWarned = false;
  let missingStatusCount = 0;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    const res = await provider.trackStatus(refId, {
      gstin: ctx.gstin,
      username: ctx.username,
      token: ctx.gstToken
    });
    const st = String(res?.status_cd || '').toUpperCase();
    logger.info(`${label}: status poll ${attempt}/${tries}`, { status: st });

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

    // Log warning if the incoming HTTP request timed out while background processing continues
    if (req?.timedout && !timeoutWarned) {
      timeoutWarned = true;
      logger.warn(`${label}: HTTP request timed out — continuing processing in background`, { attempt });
    }

    if (st === 'P') return res;
    if (st === 'PE' || st === 'ER') {
      const err = ApiError.validationError(`${label}: the GST portal reported processing errors. Please review the error report and correct the data.`);
      err.errorCd = st === 'PE' ? 'PROCESSED_WITH_ERRORS' : 'PROCESSING_ERROR';
      err.errorReport = res?.error_report || null;
      throw err;
    }
    await sleep(delayMs);
  }
  throw ApiError.providerError(`${label}: the GST portal is still processing. Please try again in a few minutes.`, 504);
}

/**
 * GSTR-1: Save -> poll -> (pre-file step) -> poll.
 * TAXPRO_GSTR1_PRE_FILE_STEP = retsubmit | proceed | none
 * Default: legacy -> retsubmit, current -> none.
 */
async function runGstr1PrepareSteps(provider, prepared, ctx, req, preFileStep) {
  const { gstin, period, username, gstToken } = ctx;

  const saved = await provider.saveGstr1(prepared.payload, { gstin, period, username, gstToken });
  const saveRefId = getRequiredRefId(saved, 'GSTR-1 save');
  await waitForProcessed(provider, saveRefId, ctx, 'GSTR-1 save', { req });

  const step = preFileStep || getGstr1PreFileStep(provider);

  if (step === 'proceed' && typeof provider.proceedToFile === 'function') {
    try {
      const proceeded = await provider.proceedToFile(period, { gstin, username, gstToken, returnType: 'GSTR1' });
      const proceedRefId = proceeded?.reference_id || proceeded?.ref_id;
      // isSync = 'Y' means the GST portal already completed it; nothing to poll.
      if (proceedRefId && proceeded.isSync !== 'Y') {
        const refId = getRequiredRefId(proceeded, 'GSTR-1 proceed to file');
        await waitForProcessed(provider, refId, ctx, 'GSTR-1 proceed to file', { req });
      }
    } catch (procErr) {
      logger.warn(`proceedToFile in prepare steps note: ${procErr.message}`);
      if (typeof provider.submitGstr1 === 'function') {
        const submitted = await provider.submitGstr1(period, { gstin, username, gstToken });
        if (submitted?.reference_id || submitted?.ref_id) {
          const submitRefId = getRequiredRefId(submitted, 'GSTR-1 submit');
          await waitForProcessed(provider, submitRefId, ctx, 'GSTR-1 submit', { req });
        }
      }
    }
  } else if (step === 'retsubmit' && typeof provider.submitGstr1 === 'function') {
    const submitted = await provider.submitGstr1(period, { gstin, username, gstToken });
    const submitRefId = getRequiredRefId(submitted, 'GSTR-1 submit');
    await waitForProcessed(provider, submitRefId, ctx, 'GSTR-1 submit', { req });
  }

  return saveRefId;
}

/**
 * Executes GSTR-3B pre-filing pipeline (Save -> RETSTATUS poll -> Liability Offset).
 * Performing liability offset beforehand prevents EVC OTP expiration during heavy processing.
 */
async function runGstr3bPrepareSteps(provider, prepared, ctx, req) {
  const saved = await provider.saveGstr3b(prepared.payload, ctx);
  const saveRefId = getRequiredRefId(saved, 'GSTR-3B save');
  await waitForProcessed(provider, saveRefId, ctx, 'GSTR-3B save', { req });
  await provider.offsetGstr3b(ctx.period, { ...ctx, body: prepared.offsetPayload });
  return saveRefId;
}

function assertLiveProvider(provider, methods, label) {
  if (!provider || methods.some((m) => typeof provider[m] !== 'function')) {
    throw ApiError.providerError(`Active GST provider does not support the complete ${label} filing flow.`, 502);
  }
}

// Local display format only (DD/MM/YYYY). GSTN upload payload uses DD-MM-YYYY in gstr1.service.
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const tzOffsetMin = Number(process.env.GST_TZ_OFFSET_MIN || 330);
  const local = new Date(d.getTime() + tzOffsetMin * 60 * 1000);
  const day = String(local.getUTCDate()).padStart(2, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const year = local.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function maskPan(pan) {
  return pan.slice(0, 2) + '******' + pan.slice(-2);
}

/* -------------------------------------------------------------------------- */
/* Read endpoints                                                             */
/* -------------------------------------------------------------------------- */

exports.getSummary = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const simulateDown = shouldSimulateDown(req);
    const summary = await ReturnService.getReturnsSummary(gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: getUsername(req),
      workspaceId,
      sessionId: req.session?._id
    });
    sendJson(res, 200, { success: true, ...summary });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.getGstr1 = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const simulateDown = shouldSimulateDown(req);
    const data = await ReturnService.getReturn('GSTR1', gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: getUsername(req),
      workspaceId,
      sessionId: req.session?._id
    });
    sendJson(res, 200, { success: true, ...data });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.getGstr2b = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const simulateDown = shouldSimulateDown(req);
    const data = await ReturnService.getReturn('GSTR2B', gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: getUsername(req),
      workspaceId,
      sessionId: req.session?._id
    });
    sendJson(res, 200, { success: true, ...data });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.getGstr3b = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const simulateDown = shouldSimulateDown(req);
    const data = await ReturnService.getReturn('GSTR3B', gstin, req.query.period, req.gstToken, {
      simulateDown,
      username: getUsername(req),
      workspaceId,
      sessionId: req.session?._id
    });
    sendJson(res, 200, { success: true, ...data });
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
    const Gstr1Service = require('../services/gstr1.service');
    const excludedInvoiceIds = req.body?.excludedInvoiceIds
      || (req.query?.excludedInvoiceIds ? req.query.excludedInvoiceIds.split(',') : []);
    const result = await Gstr1Service.preparePayload(workspaceId, gstin, req.query.period, {
      excludedInvoiceIds
    });
    sendJson(res, 200, result);
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.saveGstr1 = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const Gstr1Service = require('../services/gstr1.service');
    const excludedInvoiceIds = req.body?.excludedInvoiceIds || [];
    const result = await Gstr1Service.savePayload(workspaceId, gstin, req.query.period, {
      username: getUsername(req),
      gstToken: req.gstToken,
      excludedInvoiceIds,
      memberId: req.member?._id || req.user?._id || null
    });
    sendJson(res, 200, result);
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.generateSummary = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = req.query.period || req.body?.period;
    if (!period || !PERIOD_REGEX.test(period)) {
      throw ApiError.validationError('A valid return period (MMYYYY) is required to generate summary.');
    }
    const username = getUsername(req);
    const isNil = req.body?.isNil === true;
    const returnType = (req.body?.returnType || req.query.returnType || 'GSTR1').toUpperCase();

    logger.info(`Summary generation requested for [${gstin} - ${period}] (${returnType}, isNil: ${isNil})`);

    // Accurate invoice detection respecting user-excluded invoice identifiers
    const Gstr1Service = require('../services/gstr1.service');
    const excludedInvoiceIds = req.body?.excludedInvoiceIds
      || (req.query?.excludedInvoiceIds
        ? String(req.query.excludedInvoiceIds).split(',').map((s) => s.trim()).filter(Boolean)
        : []);

    const prepared = await Gstr1Service.preparePayload(workspaceId, gstin, period, {
      excludedInvoiceIds
    });

    if (prepared.summary.includedInvoices === 0 || isNil) {
      return sendJson(res, 200, {
        success: true,
        isNil: true,
        message: 'No outward transactions found. Nil return can be filed directly using "File Nil Return" with EVC OTP.'
      });
    }

    // Pass pre-computed payload to avoid redundant calculation during save step
    const saveRes = await Gstr1Service.savePayload(workspaceId, gstin, period, {
      username,
      gstToken: req.gstToken,
      excludedInvoiceIds,
      memberId: req.member?._id || req.user?._id || null,
      prepared
    });

    sendJson(res, 200, {
      success: true,
      message: 'Invoices uploaded to GST Portal. Government portal is now calculating the official return summary.',
      ...saveRes
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
    const NilReturnService = require('../services/nilReturn.service');
    const result = await NilReturnService.checkEligibility(
      workspaceId,
      gstin,
      req.query.period,
      req.query.type || 'GSTR1'
    );
    sendJson(res, 200, { success: true, ...result });
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
    const { workspaceId, gstin } = await resolveContext(req);
    const period = req.body?.period;
    returnType = String(req.body?.returnType || req.body?.type || 'GSTR1').toUpperCase();
    ctxForAudit = { workspaceId, gstin, period };

    if (!period || !PERIOD_REGEX.test(period)) {
      throw ApiError.validationError('Tax period (MMYYYY) is required.');
    }
    if (!['GSTR1', 'GSTR3B'].includes(returnType)) {
      throw ApiError.validationError('Nil return can only be filed for GSTR1 or GSTR-3B.');
    }
    if (!req.body?.declarationAccepted) {
      throw ApiError.validationError('Statutory declaration per CGST Rule 67A must be accepted before filing a Nil return.');
    }
    if (req.body?.verificationMode === 'EVC') {
      if (!isValidEvcOtp(req.body.otp)) {
        throw ApiError.validationError('Invalid EVC OTP format. Must be 4 to 8 letters or digits.');
      }
      const cleanPan = String(req.body.pan || '').trim().toUpperCase();
      if (!PAN_REGEX.test(cleanPan)) {
        throw ApiError.validationError('A valid authorised signatory PAN is required to file with EVC.');
      }
      if (!req.gstToken) {
        throw ApiError.validationError('Active GST Portal session token is required. Please verify OTP on the GST Return Hub first.');
      }
    }

    // Concurrency guard to prevent duplicate filing attempts
    release = acquireLock(`${workspaceId}:${returnType}:${period}`);
    await assertNotAlreadyFiled(workspaceId, returnType, period);

    const NilReturnService = require('../services/nilReturn.service');
    const result = await NilReturnService.fileNilReturn(
      workspaceId,
      gstin,
      period,
      returnType,
      {
        declarationAccepted: req.body.declarationAccepted,
        verificationMode: req.body.verificationMode,
        memberId: req.member?._id,
        username: getUsername(req),
        gstToken: req.gstToken,
        otp: req.body.otp,
        pan: req.body.pan
      }
    );
    sendJson(res, 200, result);
  } catch (error) {
    // Record failure in workspace audit trail
    await writeAudit({
      ...ctxForAudit,
      action: `${returnType}_NIL_FILE`,
      status: 'FAILED',
      metadata: { period: ctxForAudit.period, errorCd: errCdOf(error), code: error?.code }
    });
    logger.error('Nil return filing pipeline error', {
      error_cd: errCdOf(error),
      code: error?.code,
      message: error?.message
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

    const { workspaceId } = await resolveContext(req);
    if (!workspaceId) {
      throw ApiError.validationError('Active workspace context is required.');
    }
    const period = req.body?.period || req.query?.period || '102026';
    const month = parseInt(period.slice(0, 2), 10) || 10;
    const year = parseInt(period.slice(2), 10) || 2026;

    const d1 = new Date(Date.UTC(year, month - 1, 5, 10, 0, 0));
    const d2 = new Date(Date.UTC(year, month - 1, 15, 14, 30, 0));
    const d3 = new Date(Date.UTC(year, month - 1, 22, 11, 0, 0));
    const d4 = new Date(Date.UTC(year, month - 1, 26, 16, 0, 0));

    const sampleInvoices = [
      {
        workspaceId,
        invoiceNumber: `INV-${period}-001`,
        invoiceDate: d1,
        dueDate: new Date(d1.getTime() + 15 * 86400000),
        customerName: 'Reliance Retail Ltd',
        customerGstin: '27AAACR7197Q1ZV',
        placeOfSupply: '27-Maharashtra',
        status: 'Sent',
        subTotal: 150000,
        totalIgst: 27000,
        totalCgst: 0,
        totalSgst: 0,
        totalTax: 27000,
        grandTotal: 177000,
        lineItems: [
          {
            name: 'Cloud Computing Infrastructure Services',
            description: 'Monthly cloud hosting servers',
            hsnCode: '998313',
            quantity: 1,
            rate: 150000,
            taxableAmount: 150000,
            gstRate: 18,
            igstAmount: 27000,
            cgstAmount: 0,
            sgstAmount: 0,
            totalTax: 27000,
            totalAmount: 177000
          }
        ]
      },
      {
        workspaceId,
        invoiceNumber: `INV-${period}-002`,
        invoiceDate: d2,
        dueDate: new Date(d2.getTime() + 15 * 86400000),
        customerName: 'Tata Consultancy Services',
        customerGstin: '27AAAAT1234A1Z5',
        placeOfSupply: '27-Maharashtra',
        status: 'Paid',
        subTotal: 250000,
        totalIgst: 45000,
        totalCgst: 0,
        totalSgst: 0,
        totalTax: 45000,
        grandTotal: 295000,
        lineItems: [
          {
            name: 'Enterprise ERP Implementation',
            description: 'GST filing automation module',
            hsnCode: '998314',
            quantity: 1,
            rate: 250000,
            taxableAmount: 250000,
            gstRate: 18,
            igstAmount: 45000,
            cgstAmount: 0,
            sgstAmount: 0,
            totalTax: 45000,
            totalAmount: 295000
          }
        ]
      },
      {
        workspaceId,
        invoiceNumber: `INV-${period}-003`,
        invoiceDate: d3,
        dueDate: new Date(d3.getTime() + 15 * 86400000),
        customerName: 'Infosys BPM Technologies',
        customerGstin: '29AAACI4567B1Z8',
        placeOfSupply: '29-Karnataka',
        status: 'Sent',
        subTotal: 85000,
        totalIgst: 0,
        totalCgst: 7650,
        totalSgst: 7650,
        totalTax: 15300,
        grandTotal: 100300,
        lineItems: [
          {
            name: 'Financial Audit & Tax Advisory',
            description: 'Statutory compliance check',
            hsnCode: '998222',
            quantity: 1,
            rate: 85000,
            taxableAmount: 85000,
            gstRate: 18,
            igstAmount: 0,
            cgstAmount: 7650,
            sgstAmount: 7650,
            totalTax: 15300,
            totalAmount: 100300
          }
        ]
      },
      {
        workspaceId,
        invoiceNumber: `INV-${period}-004`,
        invoiceDate: d4,
        dueDate: new Date(d4.getTime() + 15 * 86400000),
        customerName: 'Retail Walk-in Consumer',
        customerGstin: '',
        placeOfSupply: '29-Karnataka',
        status: 'Paid',
        subTotal: 12000,
        totalIgst: 0,
        totalCgst: 1080,
        totalSgst: 1080,
        totalTax: 2160,
        grandTotal: 14160,
        lineItems: [
          {
            name: 'Tax Compliance Software License',
            description: 'Single user desktop key',
            hsnCode: '997331',
            quantity: 1,
            rate: 12000,
            taxableAmount: 12000,
            gstRate: 18,
            igstAmount: 0,
            cgstAmount: 1080,
            sgstAmount: 1080,
            totalTax: 2160,
            totalAmount: 14160
          }
        ]
      }
    ];

    const inserted = [];
    for (const inv of sampleInvoices) {
      const exists = await Invoice.findOne({ workspaceId, invoiceNumber: inv.invoiceNumber });
      if (!exists) {
        const created = await Invoice.create(inv);
        inserted.push(created);
      }
    }

    sendJson(res, 200, {
      success: true,
      message: inserted.length > 0
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
 * UI flow:
 *   1) POST /returns/gstr1/prepare-filing
 *   2) request the EVC OTP
 *   3) POST /returns/gstr1/file-evc with { alreadyPrepared: true, otp, pan, period }
 */
exports.prepareGstr1Filing = async (req, res, next) => {
  let release = () => { };
  let ctxForAudit = {}; // Preserved in outer scope for catch-block audit logging
  try {
    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError('Live GSTR-1 filing is disabled outside production. No return was filed.', 503);
    }
    const { workspaceId, gstin } = await resolveContext(req);
    const period = req.body?.period;
    ctxForAudit = { workspaceId, gstin, period };

    if (!period || !PERIOD_REGEX.test(period)) {
      throw ApiError.validationError('Tax period (MMYYYY) is required.');
    }
    if (!req.gstToken) {
      throw ApiError.validationError('Active GST Portal session token is required. Please verify OTP on the GST Return Hub first.');
    }

    release = acquireLock(`${workspaceId}:GSTR1:${period}`);
    await assertNotAlreadyFiled(workspaceId, 'GSTR1', period);

    const FinaggService = require('../services/finagg.service');
    const Gstr1Service = require('../services/gstr1.service');
    const provider = FinaggService.getProvider();

    const step = getGstr1PreFileStep(provider);
    assertGstr1ProviderForStep(provider, step);

    const excludedInvoiceIds = req.body?.excludedInvoiceIds || [];
    const prepared = await Gstr1Service.prepareAndValidate(workspaceId, gstin, period, {
      excludedInvoiceIds
    });

    const saveRefId = await runGstr1PrepareSteps(provider, prepared, {
      gstin, period, username: getUsername(req), gstToken: req.gstToken
    }, req, step);

    const payloadHash = hashPayload(prepared.payload);
    const Filing = require('../models/Filing');
    await Filing.findOneAndUpdate(
      { workspaceId, type: 'GSTR1', period },
      {
        workspaceId,
        gstin,
        type: 'GSTR1',
        period,
        status: 'ReadyToEVC',
        referenceId: saveRefId,
        payloadHash,
        excludedInvoiceIds,
        summary: {
          taxable: prepared.summary.totalTaxable,
          igst: prepared.summary.totalIgst,
          cgst: prepared.summary.totalCgst,
          sgst: prepared.summary.totalSgst,
          cess: prepared.summary.totalCess || 0,
          totalTax: prepared.summary.totalTax
        }
      },
      { upsert: true, returnDocument: 'after' }
    ).catch((err) => {
      logger.warn('Failed to persist intermediate ReadyToEVC filing state', { error: err.message });
    });

    await writeAudit({
      workspaceId, gstin, action: 'GSTR1_PREPARE_FILING', status: 'SUCCESS', metadata: { period, ref_id: saveRefId }
    });
    sendJson(res, 200, {
      success: true,
      ready: true,
      period,
      gstin,
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
        code: error?.code
      }
    });
    forwardError(res, next, error);
  } finally {
    release();
  }
};

/**
 * File GSTR-1 with Electronic Verification Code (EVC)
 */
exports.fileGstr1WithEvc = async (req, res, next) => {
  let release = () => { };
  let ctxForAudit = {};
  try {
    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError('Live GSTR-1 filing is disabled outside production. No return was filed.', 503);
    }

    const { workspaceId, gstin } = await resolveContext(req);
    const { period, pan, otp, excludedInvoiceIds, alreadyPrepared } = req.body;
    ctxForAudit = { workspaceId, gstin, period };

    if (!period || !PERIOD_REGEX.test(period)) throw ApiError.validationError('Tax period (MMYYYY) is required.');
    if (!otp || typeof otp !== 'string' || !otp.trim()) {
      throw ApiError.validationError('EVC OTP is required.');
    }
    const cleanOtp = otp.trim();
    if (!isValidEvcOtp(cleanOtp)) {
      throw ApiError.validationError('Invalid EVC OTP format. Must be 4 to 8 letters or digits.');
    }
    const cleanPan = String(pan || '').trim().toUpperCase();
    if (!PAN_REGEX.test(cleanPan)) {
      throw ApiError.validationError('A valid authorised signatory PAN is required to file with EVC.');
    }
    if (!req.gstToken) {
      throw ApiError.validationError('Active GST Portal session token is required to file GSTR-1 on the Government Portal. Please verify OTP on the GST Return Hub first.');
    }

    release = acquireLock(`${workspaceId}:GSTR1:${period}`);
    await assertNotAlreadyFiled(workspaceId, 'GSTR1', period);

    const Filing = require('../models/Filing');
    const Gstr1Service = require('../services/gstr1.service');
    const FinaggService = require('../services/finagg.service');
    const provider = FinaggService.getProvider();

    const step = getGstr1PreFileStep(provider);
    assertGstr1ProviderForStep(provider, step);

    let effectiveExcludedIds = excludedInvoiceIds || [];
    let readyFiling = null;

    if (alreadyPrepared) {
      readyFiling = await Filing.findOne({ workspaceId, type: 'GSTR1', period }).lean();
      if (!readyFiling || readyFiling.status !== 'ReadyToEVC' || !readyFiling.payloadHash) {
        throw ApiError.validationError('Prepare-filing state not found. Please run prepare-filing again before filing.');
      }
      if (Array.isArray(readyFiling.excludedInvoiceIds) && (!excludedInvoiceIds || excludedInvoiceIds.length === 0)) {
        effectiveExcludedIds = readyFiling.excludedInvoiceIds;
      }
    }

    const username = getUsername(req);
    const prepared = await Gstr1Service.prepareAndValidate(workspaceId, gstin, period, {
      excludedInvoiceIds: effectiveExcludedIds
    });

    if (alreadyPrepared) {
      const currentHash = hashPayload(prepared.payload);
      if (readyFiling.payloadHash !== currentHash) {
        throw ApiError.validationError('Return data changed after prepare-filing. Please prepare filing again.');
      }
      if (readyFiling.summary) {
        prepared.summary.totalTaxable = readyFiling.summary.taxable ?? prepared.summary.totalTaxable;
        prepared.summary.totalIgst = readyFiling.summary.igst ?? prepared.summary.totalIgst;
        prepared.summary.totalCgst = readyFiling.summary.cgst ?? prepared.summary.totalCgst;
        prepared.summary.totalSgst = readyFiling.summary.sgst ?? prepared.summary.totalSgst;
        prepared.summary.totalCess = readyFiling.summary.cess ?? prepared.summary.totalCess;
        prepared.summary.totalTax = readyFiling.summary.totalTax ?? prepared.summary.totalTax;
      }
    } else {
      await runGstr1PrepareSteps(provider, prepared, { gstin, period, username, gstToken: req.gstToken }, req, step);
    }

    // File with EVC
    let arn;
    try {
      const fileRes = await provider.fileGstr1(period, {
        gstin,
        username,
        gstToken: req.gstToken,
        otp: cleanOtp,
        pan: cleanPan,
        mode: 'EVC'
      });
      arn = fileRes?.arn;
    } catch (fileErr) {
      // RETFILE outcome can be unknown (timeout / 5xx / missing ack_num).
      // Before reporting failure, ask the portal whether the return is already filed.
      if (fileErr?.pendingVerification && typeof provider.findFiledArn === 'function') {
        arn = await provider.findFiledArn(gstin, period, 'GSTR1');
        if (!arn) {
          await writeAudit({
            workspaceId, gstin, action: 'GSTR1_FILE_EVC', status: 'FAILED',
            metadata: { period, errorCd: errCdOf(fileErr), outcome: 'UNCONFIRMED' }
          });
          return sendJson(res, 202, {
            success: false,
            pending: true,
            period,
            gstin,
            message: 'The GST portal did not confirm the filing yet. Please check the filing status in a few minutes before trying again.'
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
          summary: {
            taxable: prepared.summary.totalTaxable,
            igst: prepared.summary.totalIgst,
            cgst: prepared.summary.totalCgst,
            sgst: prepared.summary.totalSgst,
            cess: prepared.summary.totalCess || 0,
            totalTax: prepared.summary.totalTax
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
    } catch (dbErr) {
      filingSaved = false;
      logger.error('GSTR-1 filed successfully on GST portal but local Filing record update failed', {
        arn, period, gstin, message: dbErr.message
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
        pan: maskPan(cleanPan),
        localRecordSaved: filingSaved
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
      metadata: { period: ctxForAudit.period, errorCd: errCdOf(error), code: error?.code }
    });
    logger.error('Live GSTR-1 filing pipeline error', {
      error_cd: errCdOf(error),
      code: error?.code,
      message: error?.message
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
    const period = req.query.period || req.body?.period;
    const Gstr3bService = require('../services/gstr3b.service');
    const result = await Gstr3bService.preparePayload(workspaceId, gstin, period);
    sendJson(res, 200, {
      success: true,
      period,
      gstin,
      summary: result.summary,
      payload: result.payload,
      offsetPayload: result.offsetPayload
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.saveGstr3b = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = req.query.period || req.body?.period;
    const Gstr3bService = require('../services/gstr3b.service');
    const result = await Gstr3bService.savePayload(workspaceId, gstin, period, {
      username: getUsername(req),
      gstToken: req.gstToken
    });
    sendJson(res, 200, result);
  } catch (error) {
    forwardError(res, next, error);
  }
};

exports.offsetGstr3b = async (req, res, next) => {
  try {
    const { workspaceId, gstin } = await resolveContext(req);
    const period = req.query.period || req.body?.period;
    const Gstr3bService = require('../services/gstr3b.service');
    const result = await Gstr3bService.offsetLiabilities(workspaceId, gstin, period, {
      username: getUsername(req),
      gstToken: req.gstToken
    });
    sendJson(res, 200, {
      success: true,
      message: 'Tax liability offset completed successfully.',
      result
    });
  } catch (error) {
    forwardError(res, next, error);
  }
};

/**
 * GSTR-3B pre-filing handler (Save -> Poll -> Offset) executed before requesting EVC OTP.
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
      throw ApiError.providerError('Live GSTR-3B filing is disabled outside production. No return was filed.', 503);
    }
    const { workspaceId, gstin } = await resolveContext(req);
    const period = req.body?.period;
    ctxForAudit = { workspaceId, gstin, period };

    if (!period || !PERIOD_REGEX.test(period)) {
      throw ApiError.validationError('Tax period (MMYYYY) is required.');
    }
    if (!req.gstToken) {
      throw ApiError.validationError('Active GST Portal session token is required. Please verify OTP on the GST Return Hub first.');
    }

    release = acquireLock(`${workspaceId}:GSTR3B:${period}`);
    await assertNotAlreadyFiled(workspaceId, 'GSTR3B', period);

    const Gstr3bService = require('../services/gstr3b.service');
    const FinaggService = require('../services/finagg.service');
    const provider = FinaggService.getProvider();
    assertLiveProvider(provider, ['saveGstr3b', 'offsetGstr3b', 'getGstr3bRetSum', 'fileGstr3b', 'trackStatus'], 'GSTR-3B');

    const ctx = { gstin, period, username: getUsername(req), gstToken: req.gstToken };
    const prepared = await Gstr3bService.preparePayload(workspaceId, gstin, period);

    await runGstr3bPrepareSteps(provider, prepared, ctx, req);

    await writeAudit({
      workspaceId, gstin, action: 'GSTR3B_PREPARE_FILING', status: 'SUCCESS', metadata: { period }
    });
    sendJson(res, 200, {
      success: true,
      ready: true,
      period,
      gstin,
      summary: prepared.summary,
      message: 'GSTR-3B is saved and liability offset is done. You can now request the EVC OTP and file.'
    });
  } catch (error) {
    await writeAudit({
      ...ctxForAudit,
      action: 'GSTR3B_PREPARE_FILING',
      status: 'FAILED',
      metadata: { period: ctxForAudit.period || req.body?.period, errorCd: errCdOf(error), code: error?.code }
    });
    forwardError(res, next, error);
  } finally {
    release();
  }
};

/**
 * File GSTR-3B with EVC.
 * Flow: (Save -> poll -> Offset) -> final summary (final=Y, RAW) -> File (EVC)
 * Heavy steps skip ho jate hain jab alreadyPrepared = true.
 */
exports.fileGstr3bWithEvc = async (req, res, next) => {
  let release = () => { };
  let ctxForAudit = {};
  try {
    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError('Live GSTR-3B filing is disabled outside production. No return was filed.', 503);
    }

    const { workspaceId, gstin } = await resolveContext(req);
    const { period, pan, otp, alreadyPrepared } = req.body;
    ctxForAudit = { workspaceId, gstin, period };

    if (!period || !PERIOD_REGEX.test(period)) throw ApiError.validationError('Tax period (MMYYYY) is required.');
    if (!otp || typeof otp !== 'string' || !otp.trim()) {
      throw ApiError.validationError('EVC OTP is required.');
    }
    const cleanOtp = otp.trim();
    if (!isValidEvcOtp(cleanOtp)) {
      throw ApiError.validationError('Invalid EVC OTP format. Must be 4 to 8 letters or digits.');
    }
    const cleanPan = String(pan || '').trim().toUpperCase();
    if (!PAN_REGEX.test(cleanPan)) {
      throw ApiError.validationError('A valid authorised signatory PAN is required to file with EVC.');
    }
    if (!req.gstToken) {
      throw ApiError.validationError('Active GST Portal session token is required to file GSTR-3B on the Government Portal. Please verify OTP on the GST Return Hub first.');
    }

    release = acquireLock(`${workspaceId}:GSTR3B:${period}`);
    await assertNotAlreadyFiled(workspaceId, 'GSTR3B', period);

    const Filing = require('../models/Filing');
    const Gstr3bService = require('../services/gstr3b.service');
    const FinaggService = require('../services/finagg.service');
    const provider = FinaggService.getProvider();
    assertLiveProvider(provider, ['saveGstr3b', 'offsetGstr3b', 'getGstr3bRetSum', 'fileGstr3b', 'trackStatus'], 'GSTR-3B');

    const username = getUsername(req);
    const ctx = { gstin, period, username, gstToken: req.gstToken };
    const prepared = await Gstr3bService.preparePayload(workspaceId, gstin, period);

    // Execute Save, Poll, and Offset steps if not already pre-executed
    if (!alreadyPrepared) {
      await runGstr3bPrepareSteps(provider, prepared, ctx, req);
    }

    // Step 3: post-offset FINAL summary (final=Y), RAW string needed for the signature.
    // Always fresh — stale liability ids fail on the portal.
    const finalSummary = await provider.getGstr3bRetSum(gstin, period, {
      username,
      gstToken: req.gstToken,
      final: 'Y',
      raw: true
    });
    if (!finalSummary?.raw || !finalSummary?.data) {
      throw ApiError.providerError('GSTR-3B final summary (final=Y) could not be fetched. Filing aborted.', 502);
    }

    // Step 4: File with EVC
    let arn;
    try {
      const fileRes = await provider.fileGstr3b(period, {
        ...ctx,
        otp: cleanOtp,
        pan: cleanPan,
        mode: 'EVC',
        finalSummaryRaw: finalSummary.raw,
        finalSummaryData: finalSummary.data
      });
      arn = fileRes?.arn;
    } catch (fileErr) {
      if (fileErr?.pendingVerification && typeof provider.findFiledArn === 'function') {
        arn = await provider.findFiledArn(gstin, period, 'GSTR3B');
        if (!arn) {
          await writeAudit({
            workspaceId, gstin, action: 'GSTR3B_FILE_EVC', status: 'FAILED',
            metadata: { period, errorCd: errCdOf(fileErr), outcome: 'UNCONFIRMED' }
          });
          return sendJson(res, 202, {
            success: false,
            pending: true,
            period,
            gstin,
            message: 'The GST portal did not confirm the filing yet. Please check the filing status in a few minutes before trying again.'
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

    // Step 5: Save Filing Record & Audit Log (non-fatal DB update)
    const filingDate = new Date();
    const dateStr = formatDate(filingDate);

    let filingSaved = true;
    try {
      await Filing.findOneAndUpdate(
        { workspaceId, type: 'GSTR3B', period },
        {
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
          summary: {
            taxable: prepared.summary.outwardTaxable,
            igst: prepared.summary.salesIgst,
            cgst: prepared.summary.salesCgst,
            sgst: prepared.summary.salesSgst,
            cess: prepared.summary.cess || prepared.summary.salesCess || prepared.summary.totalCess || 0,
            totalTax: prepared.summary.outwardTax
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
    } catch (dbErr) {
      filingSaved = false;
      logger.error('GSTR-3B filed successfully on GST portal but local Filing record update failed', {
        arn,
        period,
        gstin,
        message: dbErr.message
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
        pan: maskPan(cleanPan),
        localRecordSaved: filingSaved
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
      metadata: { period: ctxForAudit.period, errorCd: errCdOf(error), code: error?.code }
    });
    logger.error('Live GSTR-3B filing pipeline error', {
      error_cd: errCdOf(error),
      code: error?.code,
      message: error?.message
    });
    forwardError(res, next, error);
  } finally {
    release();
  }
};