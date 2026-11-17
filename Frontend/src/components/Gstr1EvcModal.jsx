import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import useFocusTrap from '../hooks/useFocusTrap';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowRight,
  RefreshCw,
  Copy,
  Check,
  Award,
  Printer,
  ExternalLink,
  Clock,
  AlertTriangle,
  Info
} from 'lucide-react';
import { requestEvcOtp } from '../api/auth.api';
import {
  prepareGstr1Filing,
  prepareGstr3bFiling,
  fileGstr1WithEvc,
  fileGstr3bWithEvc,
  getReturnsSummary,
  checkFilingStatus,
  createReturnIdempotencyKey
} from '../api/returns.api';
import { formatCurrency, formatPeriod } from '../utils/format';
import { isValidEvcOtp, isValidPan } from '../utils/validators';
import Button from './ui/Button';
import Badge from './ui/Badge';
import { Link } from 'react-router-dom';
import FilingCertificateModal from './FilingCertificateModal';

/* -------------------------------------------------------------------------- */
/* Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

const STEPS = {
  FORM: 'FORM',
  OTP: 'OTP',
  FILING: 'FILING',
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'FAILED'
};

const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

const INVALID_OTP_ERROR_CODES = new Set([
  'RETFILE01',
  'RETFILE02',
  'OTP_EXPIRED',
  'INVALID_OTP',
  'MAX_OTP_ATTEMPTS'
]);

function normalizeReturnType(type) {
  const normalized = String(type || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (normalized === 'GSTR3B' || normalized === 'GSTR3') {
    return 'GSTR3B';
  }

  return 'GSTR1';
}

function isInvalidOtpErrorCode(code) {
  return Boolean(code && INVALID_OTP_ERROR_CODES.has(String(code).toUpperCase()));
}

function isUncertainFilingError(err) {
  if (!err) return false;

  if (err.pendingVerification === true) return true;

  if (
    err.code === 'REQUEST_TIMEOUT' ||
    err.code === 'TIMEOUT' ||
    err.code === 'NETWORK_ERROR'
  ) {
    return true;
  }

  if (err.status === 504) return true;

  const message = String(err.message || '').toLowerCase();

  if (
    err.code === 'PROVIDER_ERROR' &&
    (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('did not confirm') ||
      message.includes('unknown')
    )
  ) {
    return true;
  }

  return false;
}

function collectExcludedIds(value) {
  let raw;

  if (value instanceof Set) {
    raw = Array.from(value);
  } else if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === 'string') {
    raw = value.split(',');
  } else if (value === undefined || value === null) {
    raw = [];
  } else {
    raw = [value];
  }

  const seen = new Set();
  const ids = [];
  const invalid = [];

  for (const item of raw) {
    const id = String(item ?? '').trim();

    if (!id) continue;
    if (seen.has(id)) continue;

    if (OBJECT_ID_REGEX.test(id)) {
      seen.add(id);
      ids.push(id);
    } else {
      seen.add(id);
      invalid.push(id);
    }
  }

  return { ids, invalid };
}

function extractFilings(summary) {
  if (!summary || typeof summary !== 'object') return [];

  const candidates = [
    summary.filings,
    summary.data?.filings,
    summary.result?.filings,
    summary.returns,
    summary.data?.returns
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * GSTR-1 / GSTR-3B EVC Filing Modal
 *
 * Supported flows:
 *
 * 1. Self-contained flow:
 *    - Modal calls prepareGstr1Filing()/prepareGstr3bFiling()
 *    - Then requests EVC OTP
 *    - Then files with alreadyPrepared=true
 *
 * 2. Parent-prepared flow:
 *    - Parent calls prepare-filing first
 *    - Then opens modal with:
 *      alreadyPrepared={true}
 *      preparedReferenceId="..."
 *    - Modal skips prepare and directly requests OTP/files
 */
export default function Gstr1EvcModal({
  isOpen,
  onClose,
  period,
  gstin,
  username,
  workspaceName,
  returnType = 'GSTR1',
  summary = {},
  excludedInvoiceIds = [],
  onSuccess,
  onPending,
  requiresOffset = false,
  alreadyPrepared = false,
  preparedReferenceId = null
}) {
  const auth = useAuth();
  const userId =
    auth?.user?._id ||
    auth?.member?._id ||
    auth?.user?.memberId ||
    username ||
    gstin ||
    'anonymous';

  const normalizedReturnType = normalizeReturnType(returnType);

  // Extract PAN from GSTIN (positions 3-12)
  const gstinPan = gstin?.length === 15 ? gstin.slice(2, 12).toUpperCase() : '';
  const defaultPan = gstinPan[3] === 'P' ? gstinPan : '';

  const [pan, setPan] = useState(defaultPan);
  const [declaration, setDeclaration] = useState(false);
  const [step, setStep] = useState(STEPS.FORM);

  const [otpInput, setOtpInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [errorCd, setErrorCd] = useState(null);
  const [rateLimitRetryAfter, setRateLimitRetryAfter] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [filingResult, setFilingResult] = useState(null);
  const [timer, setTimer] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showCert, setShowCert] = useState(false);

  const [prepareCompleted, setPrepareCompleted] = useState(Boolean(alreadyPrepared));
  const [offsetDone, setOffsetDone] = useState(Boolean(alreadyPrepared));
  const [prepareReferenceId, setPrepareReferenceId] = useState(preparedReferenceId || null);

  // Refs for focus management
  const otpInputRef = useRef(null);
  const panInputRef = useRef(null);

  // Idempotency keys:
  // - prepareKey reused while same prepare attempt is retried after transient error
  // - fileKey reused for same OTP submission attempt; reset on invalid/expired OTP
  const prepareKeyRef = useRef(null);
  const fileKeyRef = useRef(null);

  // Polling / race protection
  const pollTimerRef = useRef(null);
  const statusAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const checkStatusRef = useRef(null);

  /* ------------------------------------------------------------------------ */
  /* Cleanup helpers                                                          */
  /* ------------------------------------------------------------------------ */

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const resetInternalState = useCallback(() => {
    clearPollTimer();

    setStep(STEPS.FORM);
    setOtpInput('');
    setLoading(false);
    setError(null);
    setErrorCode(null);
    setErrorCd(null);
    setRateLimitRetryAfter(null);
    setSuccessMsg(null);
    setFilingResult(null);
    setTimer(0);
    setCopied(false);
    setShowCert(false);

    setPrepareCompleted(Boolean(alreadyPrepared));
    setOffsetDone(Boolean(alreadyPrepared));
    setPrepareReferenceId(preparedReferenceId || null);

    prepareKeyRef.current = null;
    fileKeyRef.current = null;
    statusAttemptsRef.current = 0;

    setPan(defaultPan);
    setDeclaration(false);
  }, [
    alreadyPrepared,
    preparedReferenceId,
    defaultPan,
    clearPollTimer
  ]);

  const handleClose = useCallback(() => {
    if (step === STEPS.FILING || loading) {
      const ok = window.confirm(
        'Filing is in progress. Are you sure you want to close? This may not cancel the filing on the GST portal.'
      );

      if (!ok) return;
    }

    resetInternalState();
    onClose?.();
  }, [step, loading, resetInternalState, onClose]);

  const modalRef = useFocusTrap(isOpen && !loading, handleClose);

  /* ------------------------------------------------------------------------ */
  /* Effects                                                                  */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearPollTimer();
    };
  }, [clearPollTimer]);

  useEffect(() => {
    if (isOpen) {
      resetInternalState();
    }
  }, [isOpen, resetInternalState]);

  useEffect(() => {
    if (!isOpen) return;

    if (step === STEPS.FORM && panInputRef.current) {
      panInputRef.current.focus();
    } else if (step === STEPS.OTP && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [isOpen, step]);

  useEffect(() => {
    if (timer <= 0) return;

    const interval = setInterval(() => {
      if (!document.hidden) {
        setTimer((t) => Math.max(0, t - 1));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timer]);

  /* ------------------------------------------------------------------------ */
  /* Error mapping                                                            */
  /* ------------------------------------------------------------------------ */

  const getErrorMessage = useCallback((err) => {
    const code = err?.code || null;
    const cd =
      err?.errorCd ||
      err?.error_cd ||
      err?.data?.error_cd ||
      null;

    const message = err?.message || 'An error occurred.';
    const retryAfter = err?.rateLimit?.retryAfterSeconds || null;

    setErrorCode(code);
    setErrorCd(cd);
    setRateLimitRetryAfter(retryAfter);

    if (code === 'RATE_LIMITED') {
      return retryAfter
        ? `Too many attempts. Please try again after ${retryAfter} seconds.`
        : 'Too many attempts. Please wait before trying again.';
    }

    if (code === 'REQUEST_TIMEOUT' || code === 'TIMEOUT') {
      return 'The GST portal did not respond in time. Please check filing status before retrying. Do not file again immediately.';
    }

    if (code === 'NETWORK_ERROR') {
      return 'Network connection failed while filing. Please check filing status before retrying.';
    }

    const cdUpper = String(cd || '').toUpperCase();

    if (cdUpper === 'OTP0001') {
      return 'Invalid GSTIN. Please verify your GSTIN on the GST portal.';
    }

    if (cdUpper === 'OTP0006') {
      return 'PAN does not match Authorized Signatory on GST portal. Please use personal PAN of Director/Partner.';
    }

    if (cdUpper === 'OTP0008' || cdUpper === 'OTP0011' || cdUpper === 'AUTH4033') {
      return 'GST session expired or invalid. Please reconnect your GST portal session and try again.';
    }

    if (cdUpper === 'AUTH4038' || cdUpper === 'GSP052A' || cdUpper === 'GSP102' || cdUpper === 'RET11407') {
      return 'GST Portal AuthToken expired or not found. Please re-verify OTP on GST Return Hub.';
    }

    if (cdUpper === 'OTP0010') {
      return 'Not Authorized Signatory. Please enter personal PAN of the designated Director / Partner (4th letter must be "P").';
    }

    if (cdUpper === 'RET11406' || cdUpper === 'RET11404') {
      return 'Return summary calculation is in progress on the GST portal. Please wait 1-2 minutes and retry.';
    }

    if (cdUpper === 'RETFILE01' || cdUpper === 'RET11407') {
      return 'Invalid EVC OTP entered. Please check the code received on your mobile/email and try again.';
    }

    if (cdUpper === 'RETFILE02') {
      return 'EVC OTP has expired. Please request a fresh EVC OTP.';
    }

    if (cdUpper === 'RET01202') {
      return 'Previous tax period return is pending on GST portal. Please file earlier periods first.';
    }

    if (cdUpper === 'GSP101') {
      return 'Request payload rejected by GST System. Please verify return parameters and prepared filing state.';
    }

    if (cdUpper === 'AUTH4037') {
      return 'API Access is not enabled for this username. Please enable API Access under My Profile > Manage API Access on gst.gov.in.';
    }

    if (cdUpper === 'GSP500' || cdUpper === 'SYS500') {
      return 'Government GST Portal is undergoing maintenance. Please retry in a few moments.';
    }

    if (cdUpper === 'GSTNBadRequest') {
      return 'The government portal rejected the request. Please verify that the return period is open, return summary is generated, and signatory PAN is registered for this GSTIN.';
    }

    if (cdUpper) {
      return message && message !== 'Could not complete the request. Please try again.'
        ? message
        : `GST Portal Notice (${cdUpper}): The government portal could not complete this request.`;
    }

    if (code === 'VALIDATION_ERROR') {
      return message || 'Invalid input. Please check PAN, OTP, period, and declaration.';
    }

    if (code === 'PROVIDER_ERROR') {
      return message || 'The GST service could not complete this request on the government portal. Please verify return status or try again in a few moments.';
    }

    return message;
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Prepare filing                                                           */
  /* ------------------------------------------------------------------------ */

  const ensurePrepared = useCallback(async () => {
    if (alreadyPrepared || prepareCompleted) {
      return {
        alreadyPrepared: true,
        referenceId: prepareReferenceId || null
      };
    }

    if (!period) {
      throw {
        code: 'VALIDATION_ERROR',
        message: 'Return period is required.'
      };
    }

    if (!prepareKeyRef.current) {
      prepareKeyRef.current = createReturnIdempotencyKey(
        `${normalizedReturnType.toLowerCase()}-prepare-filing`,
        period,
        userId
      );
    }

    const { ids, invalid } = collectExcludedIds(excludedInvoiceIds);

    if (invalid.length > 0) {
      throw {
        code: 'VALIDATION_ERROR',
        message: `Invalid excluded invoice id(s): ${invalid.slice(0, 3).join(', ')}. excludedInvoiceIds must be 24-character MongoDB ObjectIds.`
      };
    }

    let res;

    if (normalizedReturnType === 'GSTR3B') {
      res = await prepareGstr3bFiling(period, {
        userId,
        idempotencyKey: prepareKeyRef.current
      });
    } else {
      res = await prepareGstr1Filing(period, ids, {
        userId,
        idempotencyKey: prepareKeyRef.current
      });
    }

    const refId =
      res?.reference_id ||
      res?.referenceId ||
      res?.ref_id ||
      null;

    setPrepareCompleted(true);
    setOffsetDone(true);
    setPrepareReferenceId(refId);

    return {
      ...res,
      referenceId: refId
    };
  }, [
    alreadyPrepared,
    prepareCompleted,
    prepareReferenceId,
    period,
    userId,
    normalizedReturnType,
    excludedInvoiceIds
  ]);

  /* ------------------------------------------------------------------------ */
  /* Status polling                                                           */
  /* ------------------------------------------------------------------------ */

  const scheduleStatusCheck = useCallback((result, delay = 5000) => {
    clearPollTimer();

    pollTimerRef.current = setTimeout(() => {
      checkStatusRef.current?.(result);
    }, delay);
  }, [clearPollTimer]);

  async function handleCheckStatus(result) {
    if (!mountedRef.current) return;

    statusAttemptsRef.current += 1;
    setLoading(true);

    try {
      let arn = null;

      const refId =
        result?.referenceId ||
        result?.reference_id ||
        result?.refId ||
        prepareReferenceId ||
        null;

      if (refId) {
        try {
          const statusRes = await checkFilingStatus(refId);

          if (statusRes?.arn) {
            arn = statusRes.arn;
          }
        } catch (_) {
          // Status endpoint may be unavailable. Fall back to summary lookup.
        }
      }

      if (!arn && period) {
        const summaryRes = await getReturnsSummary(period);
        const filings = extractFilings(summaryRes);

        const found = filings.find((f) => {
          const filingPeriod = String(f?.period || f?.ret_period || '').trim();
          const filingType = normalizeReturnType(f?.type || f?.returnType || '');
          const filingStatus = String(f?.status || f?.filingStatus || '').toLowerCase();
          const filingArn = f?.arn || f?.ARN || f?.acknowledgement_number || null;

          return (
            filingPeriod === String(period) &&
            filingType === normalizedReturnType &&
            filingStatus === 'filed' &&
            filingArn
          );
        });

        if (found?.arn) {
          arn = found.arn;
        }
      }

      if (arn) {
        const successResult = {
          ...(result || {}),
          arn,
          filingDate:
            result?.filingDate ||
            result?.dateStr ||
            new Date().toLocaleDateString('en-IN'),
          localRecordSaved: result?.localRecordSaved ?? true
        };

        setFilingResult(successResult);
        setStep(STEPS.SUCCESS);
        clearPollTimer();

        if (typeof onSuccess === 'function') {
          onSuccess(successResult);
        }

        return;
      }

      if (statusAttemptsRef.current < 3) {
        scheduleStatusCheck(result, 8000);
        return;
      }

      setStep(STEPS.PENDING);
      setError(
        'Could not confirm filing yet. Please check Filing History or the GST portal after some time. Do not file again immediately.'
      );
    } catch (err) {
      if (statusAttemptsRef.current < 3) {
        scheduleStatusCheck(result, 8000);
        return;
      }

      setStep(STEPS.PENDING);
      setError(
        err?.message ||
        'Could not verify filing status. Please check Filing History before retrying.'
      );
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  checkStatusRef.current = handleCheckStatus;

  /* ------------------------------------------------------------------------ */
  /* STEP 1: Prepare + request EVC OTP                                        */
  /* ------------------------------------------------------------------------ */

  const handleRequestOtp = async (e) => {
    e?.preventDefault();

    const cleanPan = String(pan || '').trim().toUpperCase();

    if (!isValidPan(cleanPan)) {
      setError('Please enter a valid 10-character PAN (e.g., AABCP1234F).');
      setErrorCode('VALIDATION_ERROR');
      setErrorCd(null);
      return;
    }

    if (cleanPan[3] !== 'P') {
      const panTypes = {
        C: 'Company',
        F: 'Firm/Partnership',
        H: 'HUF',
        A: 'Association of Persons',
        T: 'Trust',
        B: 'Body of Individuals',
        L: 'Local Authority',
        J: 'Artificial Juridical Person',
        G: 'Government'
      };

      const detected = panTypes[cleanPan[3]] || 'Non-person';

      setError(
        `Entity PAN detected (${detected}). For EVC filing, GST portal generally requires the personal PAN of the Authorized Signatory (4th letter must be 'P'). Please use the designated Director/Partner personal PAN.`
      );
      setErrorCode('VALIDATION_ERROR');
      setErrorCd('OTP0010');
      return;
    }

    if (!declaration) {
      setError('You must accept the CGST statutory declaration before proceeding.');
      setErrorCode('VALIDATION_ERROR');
      setErrorCd(null);
      return;
    }

    if (!period) {
      setError('Return period is missing.');
      setErrorCode('VALIDATION_ERROR');
      return;
    }

    setLoading(true);
    setError(null);
    setErrorCode(null);
    setErrorCd(null);
    setRateLimitRetryAfter(null);

    try {
      await ensurePrepared();

      const formType = normalizedReturnType === 'GSTR3B' ? 'R3B' : 'R1';

      const res = await requestEvcOtp({
        pan: cleanPan,
        form_type: formType,
        period,
        username
      });

      setSuccessMsg(
        res?.message ||
        'EVC OTP dispatched to registered Mobile / Email linked with PAN.'
      );

      setStep(STEPS.OTP);
      setTimer(30);

      // New OTP => new file idempotency key for this filing attempt.
      fileKeyRef.current = createReturnIdempotencyKey(
        `${normalizedReturnType.toLowerCase()}-file-evc`,
        period,
        userId
      );
    } catch (err) {
      const msg = getErrorMessage(err);

      // Deterministic validation failure: allow fresh prepare key after user fixes data.
      if (err?.code === 'VALIDATION_ERROR' || err?.status === 400) {
        prepareKeyRef.current = null;
        setPrepareCompleted(false);
        setOffsetDone(false);
      }

      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------------------------------------------------------ */
  /* STEP 2: Verify OTP and File                                              */
  /* ------------------------------------------------------------------------ */

  const handleVerifyAndFile = async (e) => {
    e?.preventDefault();

    const cleanOtp = String(otpInput || '').trim();
    const cleanPan = String(pan || '').trim().toUpperCase();

    if (!isValidEvcOtp(cleanOtp)) {
      setError('Enter the 4 to 8 character EVC code received on your mobile/email.');
      setErrorCode('VALIDATION_ERROR');
      return;
    }

    if (!isValidPan(cleanPan)) {
      setError('Authorized signatory PAN is invalid.');
      setErrorCode('VALIDATION_ERROR');
      setStep(STEPS.FORM);
      return;
    }

    if (!prepareCompleted && !alreadyPrepared) {
      setError('Filing preparation is required before EVC filing. Please go back and prepare filing again.');
      setErrorCode('VALIDATION_ERROR');
      setStep(STEPS.FORM);
      return;
    }

    setStep(STEPS.FILING);
    setLoading(true);
    setError(null);
    setErrorCode(null);
    setErrorCd(null);
    setRateLimitRetryAfter(null);

    try {
      const fileArgs = {
        period,
        otp: cleanOtp,
        pan: cleanPan,
        alreadyPrepared: true,
        username,
        userId,
        idempotencyKey:
          fileKeyRef.current ||
          createReturnIdempotencyKey(
            `${normalizedReturnType.toLowerCase()}-file-evc`,
            period,
            userId
          )
      };

      const res =
        normalizedReturnType === 'GSTR3B'
          ? await fileGstr3bWithEvc(fileArgs)
          : await fileGstr1WithEvc(fileArgs);

      /**
       * Backend may return HTTP 202 with:
       * {
       *   success: false,
       *   pending: true,
       *   message: '...'
       * }
       *
       * Axios treats 2xx as success, so handle it explicitly.
       */
      if (res?.pending === true || (res?.success === false && res?.pending !== false)) {
        const pendingResult = {
          ...(res || {}),
          pending: true,
          referenceId:
            res?.referenceId ||
            res?.reference_id ||
            res?.refId ||
            prepareReferenceId ||
            null
        };

        setFilingResult(pendingResult);
        setStep(STEPS.PENDING);

        if (typeof onPending === 'function') {
          onPending(pendingResult);
        }

        scheduleStatusCheck(pendingResult, 5000);
        return;
      }

      if (!res?.arn) {
        throw {
          code: 'PROVIDER_ERROR',
          message:
            'The filing service did not return an official ARN. Filing status could not be confirmed.'
        };
      }

      setFilingResult(res);
      setStep(STEPS.SUCCESS);

      if (typeof onSuccess === 'function') {
        onSuccess(res);
      }
    } catch (err) {
      const msg = getErrorMessage(err);
      const cd =
        err?.errorCd ||
        err?.error_cd ||
        err?.data?.error_cd ||
        null;

      /**
       * If filing outcome is uncertain, do NOT show normal failure/retry.
       * Show pending and ask user to verify status.
       */
      if (isUncertainFilingError(err)) {
        const pendingResult = {
          pending: true,
          message: msg,
          referenceId: prepareReferenceId || null,
          arn: null
        };

        setFilingResult(pendingResult);
        setStep(STEPS.PENDING);

        if (typeof onPending === 'function') {
          onPending(pendingResult);
        }

        scheduleStatusCheck(pendingResult, 5000);
        return;
      }

      setStep(STEPS.FAILED);
      setError(msg);

      // Invalid/expired OTP => next submission should use a new file idempotency key.
      if (isInvalidOtpErrorCode(cd)) {
        fileKeyRef.current = null;
      }
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------------------------------------------------------ */
  /* Misc handlers                                                            */
  /* ------------------------------------------------------------------------ */

  const handleCopyArn = async () => {
    if (!filingResult?.arn) return;

    try {
      await navigator.clipboard.writeText(filingResult.arn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      const textArea = document.createElement('textarea');
      textArea.value = filingResult.arn;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleResendOtp = () => {
    if (timer > 0 || loading) return;

    setOtpInput('');
    setError(null);
    setErrorCode(null);
    setErrorCd(null);
    setRateLimitRetryAfter(null);

    // Resend OTP means new OTP attempt; reset file key.
    fileKeyRef.current = null;

    handleRequestOtp();
  };

  const handleFailedTryAgain = () => {
    const cdUpper = String(errorCd || '').toUpperCase();

    if (isInvalidOtpErrorCode(cdUpper)) {
      setStep(STEPS.OTP);
      setOtpInput('');
      setError(null);
      setErrorCode(null);
      setErrorCd(null);
      fileKeyRef.current = createReturnIdempotencyKey(
        `${normalizedReturnType.toLowerCase()}-file-evc`,
        period,
        userId
      );
      return;
    }

    setStep(STEPS.FORM);
    setError(null);
    setErrorCode(null);
    setErrorCd(null);
    setRateLimitRetryAfter(null);

    // If form-level validation failed, allow fresh prepare key.
    prepareKeyRef.current = null;
    setPrepareCompleted(Boolean(alreadyPrepared));
    setOffsetDone(Boolean(alreadyPrepared));
  };

  /* ------------------------------------------------------------------------ */
  /* Derived display values                                                   */
  /* ------------------------------------------------------------------------ */

  const displayIncludedInvoices =
    normalizedReturnType === 'GSTR1'
      ? summary?.includedInvoices ?? summary?.totalInvoices ?? 0
      : null;

  const displayTaxable =
    summary?.totalTaxable ??
    summary?.outwardTaxable ??
    null;

  const displayTotalTax =
    summary?.totalTax ??
    summary?.outwardTax ??
    summary?.netCashPayable ??
    null;

  const showOffsetWarning =
    normalizedReturnType === 'GSTR3B' &&
    requiresOffset &&
    !prepareCompleted &&
    !alreadyPrepared;

  const isRateLimited =
    errorCode === 'RATE_LIMITED' ||
    (rateLimitRetryAfter && rateLimitRetryAfter > 0);

  /* ------------------------------------------------------------------------ */
  /* Render guard                                                             */
  /* ------------------------------------------------------------------------ */

  if (!isOpen) return null;

  /* ------------------------------------------------------------------------ */
  /* Modal content                                                            */
  /* ------------------------------------------------------------------------ */

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evc-modal-title"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-lg bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-surface-border animate-in zoom-in-95 duration-150 max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="px-6 py-4.5 border-b border-surface-border flex items-center justify-between bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-900 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shadow-xs">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="evc-modal-title" className="text-base font-bold text-white tracking-tight">
                  File {normalizedReturnType === 'GSTR3B' ? 'GSTR-3B' : 'GSTR-1'} with EVC
                </h3>
                <Badge variant="fintech" size="sm" className="font-mono text-[10px]">
                  Rule 26(1)
                </Badge>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Electronic Verification Code (Aadhaar / PAN OTP)
              </p>
            </div>
          </div>

          <button
            type="button"
            className="w-8 h-8 rounded-full border border-white/10 bg-white/5 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleClose}
            aria-label="Close modal"
            disabled={loading || step === STEPS.FILING}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* STEP 1: FORM */}
          {step === STEPS.FORM && (
            <form onSubmit={handleRequestOtp} className="space-y-4" aria-label="EVC OTP request form">
              <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-100 text-indigo-950 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Return Period:</span>
                  <span className="font-mono font-bold text-indigo-900">
                    {formatPeriod(period)} ({period})
                  </span>
                </div>

                {displayIncludedInvoices !== null && (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>Included Sales Invoices:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {displayIncludedInvoices} Invoices
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Taxable Turnover:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {displayTaxable == null ? 'Not available' : formatCurrency(displayTaxable)}
                  </span>
                </div>

                <div className="pt-2 border-t border-indigo-200/80 flex items-center justify-between text-xs">
                  <span className="font-bold text-indigo-950">Total Tax Liability:</span>
                  <span className="font-mono font-bold text-indigo-700 text-sm">
                    {displayTotalTax == null ? 'Not available' : formatCurrency(displayTotalTax)}
                  </span>
                </div>

                {(alreadyPrepared || prepareCompleted) && (
                  <div className="pt-2 border-t border-indigo-200/80 flex items-center gap-2 text-[11px] text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      Filing is already prepared on GST portal. OTP will be used for final EVC verification.
                    </span>
                  </div>
                )}
              </div>

              {showOffsetWarning && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Offset Required:</strong> GSTR-3B liability offset will be performed during filing preparation. Please do not close this window while preparation is running.
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="pan-input" className="block text-xs font-semibold text-slate-800 mb-1.5">
                  Authorized Signatory PAN
                </label>
                <div className="relative">
                  <input
                    id="pan-input"
                    ref={panInputRef}
                    type="text"
                    required
                    maxLength={10}
                    value={pan}
                    onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="e.g. AABCP1234F"
                    className="w-full pl-3 pr-20 py-2.5 text-xs font-mono font-bold uppercase rounded-xl border border-surface-border focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 bg-white disabled:opacity-50"
                    disabled={loading}
                    autoComplete="off"
                    aria-describedby="pan-help"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 font-semibold">
                    10-CHAR
                  </span>
                </div>
                <p id="pan-help" className="text-[11px] text-slate-400 mt-1">
                  GSTN sends EVC OTP to the mobile/email registered with this PAN on the GST Portal.
                </p>
                {pan.length === 10 && pan[3] !== 'P' && (
                  <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2" role="alert">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <strong>Entity PAN detected:</strong> 4th letter is '{pan[3]}'. For Companies and LLPs, GST Portal generally requires the personal PAN of the registered Director/Signatory (where the 4th letter is 'P').
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={declaration}
                    onChange={(e) => setDeclaration(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    disabled={loading}
                    aria-describedby="declaration-text"
                  />
                  <span id="declaration-text" className="text-[11px] text-slate-600 leading-relaxed select-none">
                    <strong>Statutory Declaration:</strong> I hereby solemnly declare that the outward supplies and tax liability details declared in this {normalizedReturnType === 'GSTR3B' ? 'GSTR-3B' : 'GSTR-1'} are true, complete and correct in accordance with CGST Rules. I understand that filing a false return is punishable under Section 132 of the CGST Act.
                  </span>
                </label>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2" role="alert" aria-live="polite">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div>{error}</div>
                    {errorCode && (
                      <div className="mt-1 text-[10px] text-rose-500 font-mono">
                        Error Code: {errorCode}
                      </div>
                    )}
                    {errorCd && (
                      <div className="mt-1 text-[10px] text-rose-500 font-mono">
                        GSTN Code: {errorCd}
                      </div>
                    )}
                    {rateLimitRetryAfter && (
                      <div className="mt-1 text-[10px] text-rose-500 font-mono">
                        Retry after: {rateLimitRetryAfter}s
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="text-rose-500 hover:text-rose-700 font-bold"
                    aria-label="Dismiss error"
                  >
                    ×
                  </button>
                </div>
              )}

              <Button
                type="submit"
                variant="fintech"
                className="w-full justify-center py-2.5"
                disabled={
                  loading ||
                  !declaration ||
                  !pan ||
                  pan.length !== 10 ||
                  isRateLimited
                }
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    <span>
                      {prepareCompleted || alreadyPrepared
                        ? 'Requesting EVC from GSTN...'
                        : 'Preparing filing & requesting EVC...'}
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      {prepareCompleted || alreadyPrepared
                        ? 'Send EVC OTP to Registered Mobile'
                        : 'Prepare Filing & Send EVC OTP'}
                    </span>
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              <p className="text-[10px] text-slate-400 text-center">
                Preparation may include GSTN RETSAVE, status polling, and for GSTR-3B liability offset.
              </p>
            </form>
          )}

          {/* STEP 2: OTP */}
          {step === STEPS.OTP && (
            <form onSubmit={handleVerifyAndFile} className="space-y-4" aria-label="EVC OTP verification form">
              {successMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5" role="status">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-3">
                <label htmlFor="otp-input" className="block text-xs font-bold text-slate-800">
                  Enter EVC code:
                </label>
                <div className="max-w-[240px] mx-auto">
                  <input
                    id="otp-input"
                    ref={otpInputRef}
                    type="text"
                    required
                    maxLength={8}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    pattern="[A-Za-z0-9]{4,8}"
                    title="Enter 4 to 8 letters or digits"
                    placeholder="Enter code"
                    className="w-full px-4 py-2.5 text-center text-lg font-mono font-bold tracking-widest rounded-xl border border-indigo-300 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 bg-white disabled:opacity-50"
                    disabled={loading}
                    aria-describedby="otp-help"
                  />
                </div>
                <div id="otp-help" className="text-[11px] text-slate-500 flex items-center justify-center gap-2">
                  <Info className="w-3.5 h-3.5" />
                  Enter the EVC sent to the authorized signatory
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2" role="alert">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div>{error}</div>
                    {errorCode && (
                      <div className="mt-1 text-[10px] text-rose-500 font-mono">
                        Error Code: {errorCode}
                      </div>
                    )}
                    {errorCd && (
                      <div className="mt-1 text-[10px] text-rose-500 font-mono">
                        GSTN Code: {errorCd}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setStep(STEPS.FORM);
                    setOtpInput('');
                    setError(null);
                    setErrorCode(null);
                    setErrorCd(null);
                    fileKeyRef.current = null;
                  }}
                  className="text-slate-500 hover:text-slate-700 underline cursor-pointer disabled:opacity-50"
                  disabled={loading}
                >
                  ← Edit PAN / Details
                </button>

                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={loading || timer > 0}
                  className="font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-40 cursor-pointer flex items-center gap-1"
                >
                  {timer > 0 ? (
                    <>
                      <Clock className="w-3 h-3" />
                      Resend in {timer}s
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3 h-3" />
                      Resend EVC OTP
                    </>
                  )}
                </button>
              </div>

              <Button
                type="submit"
                variant="fintech"
                className="w-full justify-center py-2.5"
                disabled={loading || !otpInput.trim() || otpInput.length < 4 || isRateLimited}
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    <span>Verifying EVC & Filing Return...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 mr-2" />
                    <span>Verify EVC & Complete Filing</span>
                  </>
                )}
              </Button>
            </form>
          )}

          {/* STEP 3: FILING */}
          {step === STEPS.FILING && (
            <div className="text-center py-8 space-y-4" role="status" aria-live="polite">
              <div className="w-16 h-16 mx-auto rounded-full bg-indigo-100 border border-indigo-300 text-indigo-700 flex items-center justify-center">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-600" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900 tracking-tight">
                  Filing Return with GSTN...
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Please do not close this window. This may take up to 120 seconds.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                <span>Verifying EVC and submitting to government portal</span>
              </div>
            </div>
          )}

          {/* STEP 4: PENDING */}
          {step === STEPS.PENDING && (
            <div className="text-center py-6 space-y-4" role="status">
              <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 border border-amber-300 text-amber-700 flex items-center justify-center">
                <Clock className="w-8 h-8 text-amber-600 animate-pulse" />
              </div>
              <div>
                <Badge variant="warning" size="sm" className="mb-2">
                  FILING STATUS PENDING
                </Badge>
                <h4 className="text-lg font-bold text-slate-900 tracking-tight">
                  Checking Filing Status...
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  {filingResult?.message ||
                    'GST portal did not confirm the filing immediately. We are checking whether your return was filed successfully.'}
                </p>
                <p className="text-[11px] text-amber-700 mt-2 font-semibold">
                  Do not file again immediately. Duplicate filing risk exists.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs text-left" role="alert">
                  {error}
                </div>
              )}

              {loading && (
                <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying filing status...</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="fintech"
                  size="sm"
                  onClick={() => handleCheckStatus(filingResult)}
                  disabled={loading}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Check Status
                </Button>

                <Link
                  to="/returns/filing-history"
                  className="py-2 px-3 text-xs font-semibold rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition inline-flex items-center justify-center gap-1"
                >
                  Filing History →
                </Link>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClose}
                  disabled={loading}
                >
                  Close
                </Button>
              </div>
            </div>
          )}

          {/* STEP 5: SUCCESS */}
          {step === STEPS.SUCCESS && filingResult && (
            <div className="text-center py-4 space-y-4" role="status" aria-live="polite">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-100 border border-emerald-300 text-emerald-700 flex items-center justify-center shadow-md animate-in zoom-in-75 duration-200">
                <Award className="w-7 h-7 text-emerald-600" />
              </div>

              <div>
                <Badge variant="success" size="sm" className="mb-1.5 font-bold">
                  ✓ {normalizedReturnType === 'GSTR3B' ? 'GSTR-3B' : 'GSTR-1'} OFFICIAL FILING COMPLETE
                </Badge>
                <h4 className="text-lg font-bold text-slate-900 tracking-tight">
                  Return Successfully Filed with GSTN!
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Your {normalizedReturnType === 'GSTR3B' ? 'GSTR-3B' : 'GSTR-1'} for period {formatPeriod(period)} has been authenticated via EVC.
                </p>
              </div>

              {filingResult.localRecordSaved === false && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2" role="alert">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Local record sync failed:</strong> Return is filed on GST portal with ARN {filingResult.arn}, but local filing record could not be saved. Please contact support before retrying.
                  </div>
                </div>
              )}

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-left space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Application Reference # (ARN):</span>
                  <button
                    type="button"
                    onClick={handleCopyArn}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    aria-label={copied ? 'ARN copied' : 'Copy ARN to clipboard'}
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied!' : 'Copy ARN'}</span>
                  </button>
                </div>
                <div className="font-mono font-bold text-slate-900 text-base tracking-wide bg-white p-2.5 rounded-lg border border-slate-200 select-all">
                  {filingResult.arn}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/80 text-[11px] text-slate-600">
                  <div>
                    <span className="block text-slate-400">Filing Date:</span>
                    <strong className="text-slate-900 font-mono">
                      {filingResult.filingDate || filingResult.dateStr || new Date().toLocaleDateString('en-IN')}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-slate-400">Mode:</span>
                    <strong className="text-indigo-700 font-semibold">EVC Verified (Rule 26)</strong>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="fintech"
                  size="sm"
                  onClick={() => setShowCert(true)}
                  className="flex-1 justify-center bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Printer className="w-3.5 h-3.5 mr-1" />
                  <span>Print Certificate</span>
                </Button>
                <a
                  href="https://www.gst.gov.in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-center transition inline-flex items-center justify-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View on GST Portal
                </a>
              </div>

              <div className="flex gap-2 pt-2">
                <Link
                  to="/returns/filing-history"
                  className="flex-1 py-2 text-xs font-semibold rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-center transition"
                >
                  Filing History →
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClose}
                  className="px-4"
                >
                  Done
                </Button>
              </div>
            </div>
          )}

          {/* STEP 6: FAILED */}
          {step === STEPS.FAILED && (
            <div className="text-center py-6 space-y-4" role="alert">
              <div className="w-16 h-16 mx-auto rounded-full bg-rose-100 border border-rose-300 text-rose-700 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-rose-600" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900 tracking-tight">
                  Filing Failed
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  {error || 'An error occurred while filing your return.'}
                </p>
                {errorCode && (
                  <p className="text-[10px] text-slate-400 font-mono mt-2">
                    Error Code: {errorCode}
                  </p>
                )}
                {errorCd && (
                  <p className="text-[10px] text-slate-400 font-mono mt-1">
                    GSTN Code: {errorCd}
                  </p>
                )}
                {rateLimitRetryAfter && (
                  <p className="text-[10px] text-amber-700 font-mono mt-1">
                    Retry after: {rateLimitRetryAfter}s
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFailedTryAgain}
                  disabled={loading || isRateLimited}
                  className="flex-1"
                >
                  Try Again
                </Button>
                <Button
                  variant="fintech"
                  size="sm"
                  onClick={handleClose}
                  className="flex-1"
                >
                  Close
                </Button>
              </div>

              <div className="pt-2 text-[11px] text-slate-400">
                Need help? <Link to="/support" className="text-indigo-600 hover:underline">Contact Support</Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {showCert && filingResult && (
        <FilingCertificateModal
          isOpen={showCert}
          onClose={() => setShowCert(false)}
          filing={{
            ...filingResult,
            type: normalizedReturnType,
            period,
            summary
          }}
          workspace={{
            name: workspaceName,
            gstin
          }}
        />
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}