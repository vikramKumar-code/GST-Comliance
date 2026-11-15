const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const Filing = require('../models/Filing');
const Return = require('../models/Return');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/apiError');
const { isValidGstin, isValidPeriod } = require('../utils/gstin');
const { encrypt } = require('../utils/crypto');
const logger = require('../utils/logger');
const { isLiveFilingEnabled } = require('../utils/filingMode');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

// IST-aware boundaries (GST_TZ_OFFSET_MIN=330 for India, UTC+05:30)
const TZ_OFFSET_MIN = Number(process.env.GST_TZ_OFFSET_MIN || 330);
const TZ_OFFSET_MS = TZ_OFFSET_MIN * 60 * 1000;

// Conservative policy: Require explicit configuration override to permit Nil GSTR-3B when purchase bills exist
const NIL_3B_ALLOW_ZERO_ITC_BILLS =
  String(process.env.GST_NIL_3B_ALLOW_ZERO_ITC_BILLS || 'false').toLowerCase() === 'true';

const FINALIZED = { $nin: ['cancelled', 'draft', 'Cancelled', 'Draft'] };

const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

// Credit notes decrease outward turnover for aggregate display
const signOfInvoice = (inv) => (inv.documentType === 'CREDIT_NOTE' ? -1 : 1);

// Format filing date in Indian Standard Time (DD/MM/YYYY)
function formatGstnDate(d = new Date()) {
  const local = new Date(d.getTime() + TZ_OFFSET_MS);
  const day = String(local.getUTCDate()).padStart(2, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const year = local.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

// Month range boundary aligned with Indian Standard Time
function periodRangeIST(period) {
  const month = parseInt(period.slice(0, 2), 10);
  const year = parseInt(period.slice(2), 10);
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - TZ_OFFSET_MS),
    endDate: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - TZ_OFFSET_MS - 1),
  };
}

// Matches confirmed filed record with valid ARN and status='Filed'
const CONFIRMED_FILED_FILTER = {
  status: 'Filed',
  arn: { $exists: true, $nin: [null, ''] },
};

// Polls status while GSTN asynchronous batch queue processes RETSAVE or Submit requests
async function waitForProcessing(provider, refId, authCtx, label, maxAttempts = 6, delayMs = 2500) {
  if (!refId || typeof provider.trackStatus !== 'function') return null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await provider.trackStatus(refId, authCtx);
      const status = String(res?.status_cd || '').toUpperCase();
      logger.info(`${label} status poll ${attempt}/${maxAttempts}: ${status}`);
      if (status === 'P') return res;
      if (status === 'PE' || status === 'ER') {
        logger.warn(`${label} reported error status: ${status}`, { report: res?.error_report });
        return res;
      }
    } catch (trackErr) {
      logger.debug(`${label} status tracking poll note: ${trackErr.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

class NilReturnService {
  /**
   * Check eligibility for Nil Return under CGST Rule 67A
   */
  static async checkEligibility(workspaceId, gstin, period, returnType = 'GSTR1') {
    if (!workspaceId) throw ApiError.validationError('Workspace ID is required.');

    const normGstin = (gstin || '').trim().toUpperCase();
    if (!isValidGstin(normGstin)) throw ApiError.invalidGstin('Invalid GSTIN format.');
    if (!isValidPeriod(period)) throw ApiError.validationError('Invalid tax period format. Must be MMYYYY.');

    const normType = (returnType || 'GSTR1').toUpperCase();
    if (!['GSTR1', 'GSTR3B'].includes(normType)) {
      throw ApiError.validationError('Nil return can only be filed for GSTR1 or GSTR3B per CGST Rule 67A.');
    }

    const { startDate, endDate } = periodRangeIST(period);

    // ✅ FIX 3: Sirf confirmed filed record hi block karega
    const existingFiling = await Filing.findOne({
      workspaceId, type: normType, period, ...CONFIRMED_FILED_FILTER,
    }).lean();

    if (existingFiling) {
      return {
        alreadyFiled: true,
        arn: existingFiling.arn,
        filingDate: existingFiling.filingDate,
        dateStr: existingFiling.dateStr,
        status: existingFiling.status,
        isNil: existingFiling.isNil,
        mode: existingFiling.mode,
        eligible: false,
        message: `${normType} for period ${period} has already been filed with ARN ${existingFiling.arn}.`,
      };
    }

    const invoices = await Invoice.find({
      workspaceId,
      invoiceDate: { $gte: startDate, $lte: endDate },
      status: FINALIZED,
    }).lean();

    const bills = await Bill.find({
      workspaceId,
      billDate: { $gte: startDate, $lte: endDate },
      status: FINALIZED,
    }).lean();

    const activeInvoicesCount = invoices.length;
    const activeBillsCount = bills.length;

    // Apply negative sign for credit notes in outward turnover summary
    let totalTaxableSales = 0;
    let totalOutwardTax = 0;
    for (const inv of invoices) {
      const sign = signOfInvoice(inv);
      totalTaxableSales += sign * Number(inv.subTotal ?? inv.totalTaxable ?? 0);
      totalOutwardTax += sign * (
        Number(inv.totalIgst || 0) + Number(inv.totalCgst || 0)
        + Number(inv.totalSgst || 0) + Number(inv.totalCess || 0)
      );
    }

    let totalItc = 0;
    let hasRcmLiability = false;

    for (const b of bills) {
      if (b.isReverseCharge) hasRcmLiability = true;
      // Only eligible ITC counts (Section 17(5) blocked credits excluded)
      if (b.itcEligible !== false) {
        const sign = b.documentType === 'CREDIT_NOTE' ? -1 : 1;
        // Include cess in eligible ITC computation
        totalItc += sign * (
          Number(b.totalCgst || 0) + Number(b.totalSgst || 0)
          + Number(b.totalIgst || 0) + Number(b.totalCess || 0)
        );
      }
    }

    totalItc = round2(totalItc);
    const hasPositiveItc = totalItc > 0;

    // GSTR-1 Nil: no outward supplies allowed (credit notes also count as outward adjustments)
    // GSTR-3B Nil: no outward supplies + no RCM liability + no ITC claimed
    const hasBusinessActivity = normType === 'GSTR1'
      ? activeInvoicesCount > 0
      : (
        activeInvoicesCount > 0
        || hasPositiveItc
        || hasRcmLiability
        // Block Nil filing if purchase bills exist unless override flag is set
        || (!NIL_3B_ALLOW_ZERO_ITC_BILLS && activeBillsCount > 0)
      );

    const warnings = [];
    if (activeInvoicesCount > 0) {
      warnings.push(
        `You have ${activeInvoicesCount} active sales document(s) totaling ₹${round2(totalTaxableSales).toLocaleString('en-IN')} `
        + `(outward tax ₹${round2(totalOutwardTax).toLocaleString('en-IN')}) in this period.`
      );
    }
    if (normType === 'GSTR3B') {
      if (activeBillsCount > 0 && hasPositiveItc) {
        warnings.push(
          `You have ${activeBillsCount} purchase bill(s) with ₹${totalItc.toLocaleString('en-IN')} eligible ITC in this period.`
        );
      }
      if (hasRcmLiability) {
        warnings.push('You have inward supplies liable to Reverse Charge (RCM) in this period.');
      }
      // Informational notice when bills exist with zero ITC
      if (activeBillsCount > 0 && !hasPositiveItc && !hasRcmLiability && !NIL_3B_ALLOW_ZERO_ITC_BILLS) {
        warnings.push(
          `${activeBillsCount} purchase bill(s) recorded with no eligible ITC and no RCM. `
          + 'Nil GSTR-3B may be permissible — confirm with your tax advisor before enabling GST_NIL_3B_ALLOW_ZERO_ITC_BILLS=true.'
        );
      }
    }

    return {
      alreadyFiled: false,
      eligible: !hasBusinessActivity,
      hasBusinessActivity,
      activeInvoicesCount,
      activeBillsCount,
      totalTaxableSales: round2(totalTaxableSales),
      totalOutwardTax: round2(totalOutwardTax),
      totalItc,
      hasRcmLiability,
      warnings,
      policy: {
        timezoneOffsetMinutes: TZ_OFFSET_MIN,
        nil3bAllowsZeroItcBills: NIL_3B_ALLOW_ZERO_ITC_BILLS,
      },
      ruleReference: 'Central Goods and Services Tax (CGST) Rules, 2017 - Rule 67A (Filing of Nil Return)',
      criteria: [
        'No outward supply of goods or services made (including nil rated, exempted, and non-GST supplies)',
        'No inward supplies liable to reverse charge (RCM)',
        'No Input Tax Credit (ITC) to be availed / claimed',
        'No tax liability, interest, late fees, or other penalty payable',
      ],
    };
  }

  /**
   * File Nil Return for GSTR-1 or GSTR-3B under CGST Rule 67A
   */
  static async fileNilReturn(workspaceId, gstin, period, returnType = 'GSTR1', options = {}) {
    if (!workspaceId) throw ApiError.validationError('Workspace ID is required.');

    const normGstin = (gstin || '').trim().toUpperCase();
    if (!isValidGstin(normGstin)) throw ApiError.invalidGstin('Invalid GSTIN format.');
    if (!isValidPeriod(period)) throw ApiError.validationError('Invalid tax period format.');

    const normType = (returnType || 'GSTR1').toUpperCase();
    if (!['GSTR1', 'GSTR3B'].includes(normType)) {
      throw ApiError.validationError('Nil return can only be filed for GSTR1 or GSTR-3B.');
    }

    if (!options.declarationAccepted) {
      throw ApiError.validationError('Statutory declaration per CGST Rule 67A must be accepted before filing a Nil return.');
    }

    /* ------------------------------------------------------------------ */
    /* Mandatory server-side eligibility gate per CGST Rule 67A           */
    /* Prevents direct API bypass of statutory zero-transaction rules     */
    /* ------------------------------------------------------------------ */
    const eligibility = await NilReturnService.checkEligibility(workspaceId, normGstin, period, normType);

    if (eligibility.alreadyFiled) {
      throw ApiError.validationError(
        `${normType} for period ${period} is already filed with ARN: ${eligibility.arn}. Duplicate filing is prohibited.`
      );
    }
    if (!eligibility.eligible) {
      throw ApiError.validationError(
        `Nil ${normType} cannot be filed for ${period} — business activity exists in this period. `
        + (eligibility.warnings || []).join(' ')
      );
    }

    if (!isLiveFilingEnabled()) {
      throw ApiError.providerError('Live nil-return filing is disabled outside production. No return was filed.', 503);
    }

    const FinaggService = require('./finagg.service');
    const isLiveTaxPro = FinaggService.getProviderName() === 'taxpro';
    const provider = FinaggService.getProvider();

    if (!provider) {
      throw ApiError.providerError('No live GST provider is available. Nil return was not filed.', 502);
    }

    if (isLiveTaxPro && options.verificationMode === 'EVC' && !options.gstToken) {
      const activeTok = typeof provider.getActiveToken === 'function'
        ? provider.getActiveToken(normGstin, options.username)
        : null;
      if (activeTok) {
        options.gstToken = activeTok;
      } else {
        throw ApiError.validationError(
          'Active GST Portal session token is required to file on the Government Portal. Please verify OTP on the GST Return Hub first.'
        );
      }
    }

    let arn;
    const filingDate = new Date();
    const dateStr = formatGstnDate(filingDate);
    const mode = options.verificationMode === 'EVC' ? 'NIL_EVC' : 'NIL_ONLINE';

    try {
      if (normType === 'GSTR1' && typeof provider.fileGstr1 === 'function') {
        const authCtx = {
          gstin: normGstin,
          username: options.username,
          token: options.gstToken
        };

        // Step 1a: Zero-outward RETSAVE — initializes return state on Government GST portal
        if (typeof provider.saveGstr1 === 'function') {
          try {
            logger.info(`Step 1a: Saving zero outward payload to GST Portal [${normGstin} - ${period}] to initialize summary...`);
            const saveRes = await provider.saveGstr1({
              gstin: normGstin,
              fp: period,
              gt: 0,
              cur_gt: 0,
            }, {
              ...authCtx,
              period,
            });
            const refId = saveRes?.ref_id || saveRes?.reference_id;
            logger.info(`Step 1a RETSAVE acknowledged. Reference: ${refId || 'OK'}`);
            if (refId) {
              await waitForProcessing(provider, refId, authCtx, 'Nil GSTR-1 RETSAVE');
            }
          } catch (saveErr) {
            logger.debug(`Nil pre-filing save note: ${saveErr.message}`);
          }
        }

        // Step 1b: Proceed to File / Generate Summary via ProceedToFileGSTRAsync
        // Mandatory bridge that freezes return data and triggers GST portal summary calculation
        let proceedSuccess = false;
        if (typeof provider.proceedToFile === 'function') {
          try {
            logger.info(`Step 1b: ProceedToFile / Gen. Summary for Nil GSTR-1 [${normGstin} - ${period}]...`);
            const procRes = await provider.proceedToFile(period, {
              ...authCtx,
              isNil: true,
              returnType: 'GSTR1',
            });
            const procRef = procRes?.reference_id || procRes?.ref_id;
            logger.info(`Step 1b ProceedToFile complete. Reference: ${procRef || (procRes?.isSync === 'Y' ? 'SYNC' : 'OK')}`);
            if (procRef && procRes?.isSync !== 'Y') {
              await waitForProcessing(provider, procRef, authCtx, 'Nil GSTR-1 ProceedToFile', 5, 2000);
            }
            proceedSuccess = true;
            // Brief pause to allow GST portal summary background calculation to settle
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } catch (procErr) {
            logger.warn(`GSTR-1 proceedToFile note: ${procErr.message}`);
          }
        }

        // Fallback: If proceedToFile was unconfirmed or failed, try legacy submitGstr1
        if (!proceedSuccess && typeof provider.submitGstr1 === 'function') {
          try {
            logger.info(`Step 1b (fallback): Submitting Nil GSTR-1 for period ${period} [${normGstin}] to freeze return...`);
            const submitRes = await provider.submitGstr1(period, {
              ...authCtx,
              isNil: true,
              generate_summary: 'Y'
            });
            const subRef = submitRes?.reference_id || submitRes?.ref_id;
            logger.info(`Step 1b Submit complete. Reference ID: ${subRef || 'OK'}`);
            if (subRef) {
              await waitForProcessing(provider, subRef, authCtx, 'Nil GSTR-1 Submit', 5, 2000);
            }
          } catch (subErr) {
            logger.warn(`GSTR-1 pre-filing submit step note: ${subErr.message}`);
          }
        }

        logger.info(`Step 2: TaxPro direct Nil RETFILE initiating with EVC OTP for [${normGstin} - ${period}]`);
        const fileRes = await provider.fileGstr1(period, {
          gstin: normGstin,
          username: options.username,
          token: options.gstToken,
          gstToken: options.gstToken,
          otp: options.otp,
          pan: options.pan,
          mode: options.verificationMode,
          isNil: true,
        });

        if (fileRes?.arn) {
          arn = fileRes.arn;
          logger.info(`Live TaxPro Nil GSTR-1 filed successfully with official GSTN ARN: ${arn}`);
        } else if (isLiveTaxPro) {
          throw ApiError.providerError('Government GST Portal did not return an ARN. Please verify and retry.');
        }
      }
      else if (normType === 'GSTR3B' && typeof provider.fileGstr3b === 'function') {
        logger.info(`TaxPro direct Nil GSTR-3B RETFILE initiating with EVC OTP for [${normGstin} - ${period}]`);
        const fileRes = await provider.fileGstr3b(period, {
          gstin: normGstin,
          username: options.username,
          token: options.gstToken,
          gstToken: options.gstToken,
          otp: options.otp,
          pan: options.pan,
          mode: options.verificationMode,
          isNil: true,
        });

        if (fileRes?.arn) {
          arn = fileRes.arn;
          logger.info(`Live TaxPro Nil GSTR-3B filed successfully with official GSTN ARN: ${arn}`);
        } else if (isLiveTaxPro) {
          throw ApiError.providerError('Government GST Portal did not return an ARN for GSTR-3B. Please verify and retry.');
        }
      }
      else {
        throw ApiError.providerError(`Active GST provider does not support Nil ${normType} filing.`, 502);
      }
    } catch (err) {
      logger.error(`Live GSP pipeline error for Nil Return: ${err.message}`);

      // Recovery check: Query filing history if submission response was indeterminate (timeout or 5xx)
      const outcomeUnknown = Boolean(err?.pendingVerification)
        || ['ECONNABORTED', 'ETIMEDOUT'].includes(err?.code)
        || (typeof err?.statusCode === 'number' && err.statusCode >= 500);

      if (outcomeUnknown && typeof provider.findFiledArn === 'function') {
        const filedArn = await provider.findFiledArn(normGstin, period, normType);
        if (filedArn) {
          logger.info(`Return was confirmed filed on GST portal. Recovered official ARN: ${filedArn}`);
          arn = filedArn;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    if (!arn) {
      throw ApiError.providerError('GST provider did not confirm Nil return filing with an ARN.', 502);
    }

    /* ------------------------------------------------------------------ */
    /* 1. Permanent Filing record                                          */
    /* Return filed successfully on GST portal — handle DB failure safely */
    /* ------------------------------------------------------------------ */
    let recordPersisted = true;
    try {
      await Filing.create({
        workspaceId,
        gstin: normGstin,
        type: normType,
        period,
        arn,
        status: 'Filed',
        mode,
        isNil: true,
        filingDate,
        dateStr,
        declarationAccepted: true,
        summary: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, totalTax: 0 },
      });
    } catch (e) {
      if (e?.code === 11000) {
        // Concurrent instance already recorded the filing — reuse existing ARN
        logger.warn('Filing record already exists (concurrent filing) — reusing existing record', {
          gstin: normGstin, type: normType, period,
        });
        const dup = await Filing.findOne({ workspaceId, type: normType, period }).lean().catch(() => null);
        if (dup?.arn) arn = dup.arn;
      } else {
        recordPersisted = false;
        logger.error('CRITICAL: Nil return filed at GSTN but Filing record could not be saved', {
          arn, gstin: normGstin, type: normType, period, error: e.message,
        });
        await AuditLog.create({
          workspaceId,
          memberId: options.memberId || null,
          gstin: normGstin,
          action: `${normType}_NIL_FILED_RECORD_FAILED`,
          period,
          status: 'FAILURE',
          metadata: { arn, error: e.message },
        }).catch(() => { });
      }
    }

    /* ------------------------------------------------------------------ */
    /* 2. Encrypted Return cache                                           */
    /* ------------------------------------------------------------------ */
    const nilReturnData = {
      type: normType,
      period,
      rows: [
        {
          label: normType === 'GSTR1'
            ? 'Table 4-13: Nil Outward Supplies (CGST Rule 67A)'
            : 'Table 3.1 & 4: Nil Outward Liability & Nil ITC (CGST Rule 67A)',
          section: 'NIL', // Standard section identifier matching return service convention
          taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0,
          nilValue: 0,
        },
      ],
      totals: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
      isNil: true,
      arn,
      status: 'FILED',
      filingStatus: 'Filed',
      filingMode: mode,
      filingDate: filingDate.toISOString(),
      fetchedAt: filingDate.toISOString(),
    };

    await Return.findOneAndUpdate(
      { workspaceId, gstin: normGstin, type: normType, period },
      { $set: { dataEnc: encrypt(nilReturnData), fetchedAt: filingDate } },
      { upsert: true }
    ).catch((e) => {
      // Cache failure filing ko invalidate nahi karta
      logger.warn('Failed to update Nil return cache', { arn, period, error: e.message });
    });

    /* ------------------------------------------------------------------ */
    /* 3. Audit Log                                                        */
    /* ------------------------------------------------------------------ */
    await AuditLog.create({
      workspaceId,
      memberId: options.memberId || null,
      gstin: normGstin,
      action: `${normType}_NIL_FILED`,
      period,
      status: 'SUCCESS',
      metadata: {
        arn,
        mode,
        recordPersisted,
        eligibilitySnapshot: {
          activeInvoicesCount: eligibility.activeInvoicesCount,
          activeBillsCount: eligibility.activeBillsCount,
          totalItc: eligibility.totalItc,
          hasRcmLiability: eligibility.hasRcmLiability,
        },
      },
    }).catch((err) => {
      logger.warn('Failed to write audit log for nil return filing', { error: err.message });
    });

    logger.info(`Nil return filed successfully: ${normType} for ${normGstin} period ${period} [ARN: ${arn}]`);

    return {
      success: true,
      isNil: true,
      arn,
      type: normType,
      period,
      gstin: normGstin,
      filingDate: filingDate.toISOString(),
      dateStr,
      mode,
      status: 'Filed',
      recordPersisted,
      message: recordPersisted
        ? `Nil ${normType} return for ${period} has been filed successfully under CGST Rule 67A!`
        : `Nil ${normType} for ${period} was FILED at GSTN (ARN ${arn}), but the local record could not be saved. Please contact support — DO NOT file again.`,
      acknowledgement: {
        arn,
        gstin: normGstin,
        returnType: normType,
        period,
        status: 'FILED',
        mode,
        filedAt: dateStr,
        legalNotice: 'Acknowledged electronically under Central Goods and Services Tax Rules, 2017',
      },
    };
  }
}

module.exports = NilReturnService;