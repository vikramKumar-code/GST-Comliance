import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  Clock,
  Info,
  X,
  ExternalLink
} from 'lucide-react';

import Button from '../ui/Button';
import { searchGstin, requestOtp, verifyOtp } from '../../api/auth.api';
import {
  isValidGstin,
  normalizeGstin,
  isValidOtp
} from '../../utils/validators';

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const RESEND_COOLDOWN_SECONDS = Math.max(
  0,
  Number(import.meta.env.VITE_GST_AUTH_RESEND_COOLDOWN || 30)
);

const SESSION_RESET_ERROR_CODES = new Set([
  'AUTH4033',
  'GSP102',
  'AUTH4038',
  'GSP052A'
]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function normalizeUsername(value) {
  return String(value || '').trim();
}

function mapAuthError(err, fallback = 'Authentication failed.') {
  const code = err?.code || null;
  const errorCd =
    err?.errorCd ||
    err?.error_cd ||
    err?.data?.error_cd ||
    null;

  const retryAfterSeconds =
    err?.rateLimit?.retryAfterSeconds ||
    null;

  const status = err?.status ?? null;
  let message = err?.message || fallback;

  if (code === 'RATE_LIMITED') {
    message = retryAfterSeconds
      ? `Too many OTP attempts. Please try again after ${retryAfterSeconds} seconds.`
      : 'Too many OTP attempts. Please wait before trying again.';
  } else if (
    code === 'REQUEST_TIMEOUT' ||
    code === 'TIMEOUT' ||
    status === 504
  ) {
    message =
      'GST portal did not respond in time. Please try again after a moment.';
  } else if (code === 'NETWORK_ERROR') {
    message =
      'Network error while contacting GST portal. Please check your connection and retry.';
  } else if (code === 'SESSION_EXPIRED') {
    message =
      'GST portal session expired. Please request a new OTP.';
  } else if (errorCd === 'AUTH4037') {
    message =
      'API Access is not enabled for this username. Please enable API Access under My Profile > Manage API Access on gst.gov.in.';
  } else if (SESSION_RESET_ERROR_CODES.has(errorCd)) {
    message =
      'OTP/session token expired on GST portal. Please request a fresh OTP.';
  } else if (errorCd === 'OTP0010') {
    message =
      'Not authorized signatory / PAN mismatch. Please use the registered signatory credentials for this GSTIN.';
  } else if (errorCd === 'GSTNBadRequest') {
    message =
      'GST portal rejected the request. Please verify GSTIN, username, OTP and API access.';
  } else if (errorCd) {
    message =
      err?.message &&
        err.message !== 'Could not complete the request. Please try again.'
        ? err.message
        : `GST Portal Notice (${errorCd}): ${fallback}`;
  } else if (code === 'VALIDATION_ERROR') {
    message =
      err?.message ||
      'Invalid input. Please check GSTIN, username, consent and OTP.';
  } else if (code === 'INVALID_GSTIN') {
    message = err?.message || 'Invalid GSTIN format.';
  } else if (!message) {
    message = fallback;
  }

  return {
    message,
    code,
    errorCd,
    retryAfterSeconds,
    status
  };
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * GST portal OTP authentication screen.
 *
 * Expected API shape from auth.api:
 *
 * requestOtp({
 *   gstin: string,
 *   username: string,
 *   consent: boolean
 * })
 *
 * verifyOtp({
 *   gstin: string,
 *   username: string,
 *   otp: string
 * })
 *
 * searchGstin(gstin: string)
 */
export function AuthScreen({
  authGstin,
  setAuthGstin,
  authUsername,
  setAuthUsername,
  otpSent,
  setOtpSent,
  otpInput,
  setOtpInput,
  taxpayerDetails,
  setTaxpayerDetails,
  verifyingGstin,
  setVerifyingGstin,
  authConsent,
  setAuthConsent,
  authLoading,
  setAuthLoading,
  authErrorMsg,
  setAuthErrorMsg,
  authSuccessMsg,
  setAuthSuccessMsg,
  onVerifySuccess
}) {
  const [errorMeta, setErrorMeta] = useState(null);
  const [resendSeconds, setResendSeconds] = useState(0);

  const otpInputRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Derived values                                                           */
  /* ------------------------------------------------------------------------ */

  const normalizedGstin = useMemo(
    () => normalizeGstin(authGstin),
    [authGstin]
  );

  const gstinValid = useMemo(
    () => isValidGstin(normalizedGstin),
    [normalizedGstin]
  );

  const usernameValid = useMemo(
    () => Boolean(normalizeUsername(authUsername)),
    [authUsername]
  );

  const otpValid = useMemo(
    () => isValidOtp(otpInput),
    [otpInput]
  );

  /* ------------------------------------------------------------------------ */
  /* Message helpers                                                          */
  /* ------------------------------------------------------------------------ */

  const clearMessages = useCallback(() => {
    setAuthErrorMsg(null);
    setAuthSuccessMsg(null);
    setErrorMeta(null);
  }, [setAuthErrorMsg, setAuthSuccessMsg]);

  const setFailure = useCallback(
    (err, fallback) => {
      const mapped = mapAuthError(err, fallback);

      setAuthErrorMsg(mapped.message);
      setErrorMeta(mapped);

      return mapped;
    },
    [setAuthErrorMsg]
  );

  /* ------------------------------------------------------------------------ */
  /* Resend timer                                                             */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (resendSeconds <= 0) return;

    const interval = setInterval(() => {
      if (!document.hidden) {
        setResendSeconds((s) => Math.max(0, s - 1));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [resendSeconds]);

  /* ------------------------------------------------------------------------ */
  /* Focus OTP input                                                          */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (otpSent && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [otpSent]);

  /* ------------------------------------------------------------------------ */
  /* GSTIN lookup                                                             */
  /* ------------------------------------------------------------------------ */

  const handleVerifyGstinName = useCallback(async () => {
    if (!gstinValid) {
      setFailure(
        {
          code: 'INVALID_GSTIN',
          message:
            'Invalid GSTIN format. GSTIN must be 15 alphanumeric characters.'
        },
        'Invalid GSTIN.'
      );
      return;
    }

    setVerifyingGstin(true);
    clearMessages();

    try {
      const res = await searchGstin(normalizedGstin);

      if (!res || typeof res !== 'object') {
        throw {
          code: 'DATA_NOT_AVAILABLE',
          message: 'GSTIN details not found on GST portal.'
        };
      }

      setTaxpayerDetails(res);

      const displayName =
        res.legalName ||
        res.tradeName ||
        res.lgnm ||
        res.tradeNm ||
        'Active Taxpayer';

      setAuthSuccessMsg(`Registered Business: ${displayName}`);
    } catch (err) {
      setTaxpayerDetails(null);
      setFailure(err, 'Could not verify GSTIN details.');
    } finally {
      if (mountedRef.current) {
        setVerifyingGstin(false);
      }
    }
  }, [
    gstinValid,
    normalizedGstin,
    setFailure,
    setTaxpayerDetails,
    setAuthSuccessMsg,
    setVerifyingGstin,
    clearMessages
  ]);

  /* ------------------------------------------------------------------------ */
  /* Request OTP                                                              */
  /* ------------------------------------------------------------------------ */

  const performSendOtp = useCallback(async () => {
    if (authLoading) return;

    if (!gstinValid) {
      setFailure(
        {
          code: 'INVALID_GSTIN',
          message:
            'Please enter a valid 15-character GSTIN before requesting OTP.'
        },
        'Invalid GSTIN.'
      );
      return;
    }

    if (!usernameValid) {
      setFailure(
        {
          code: 'VALIDATION_ERROR',
          message: 'Please enter your GST portal username.'
        },
        'Username is required.'
      );
      return;
    }

    if (!authConsent) {
      setFailure(
        {
          code: 'VALIDATION_ERROR',
          message:
            'Please accept authorization consent to fetch GST returns.'
        },
        'Consent is required.'
      );
      return;
    }

    setAuthLoading(true);
    clearMessages();

    try {
      const res = await requestOtp({
        gstin: normalizedGstin,
        username: normalizeUsername(authUsername),
        consent: true
      });

      setOtpSent(true);
      setOtpInput('');
      setResendSeconds(RESEND_COOLDOWN_SECONDS);

      setAuthSuccessMsg(
        res?.message ||
        'OTP sent successfully to registered mobile/email.'
      );
    } catch (err) {
      const mapped = setFailure(err, 'Failed to request OTP from GST Portal.');

      if (mapped.retryAfterSeconds && mapped.retryAfterSeconds > 0) {
        setResendSeconds((prev) =>
          Math.max(prev, Number(mapped.retryAfterSeconds))
        );
      }
    } finally {
      if (mountedRef.current) {
        setAuthLoading(false);
      }
    }
  }, [
    authLoading,
    authConsent,
    authUsername,
    gstinValid,
    normalizedGstin,
    usernameValid,
    setAuthLoading,
    setOtpSent,
    setOtpInput,
    setAuthSuccessMsg,
    clearMessages,
    setFailure
  ]);

  const handleSendOtp = useCallback(
    (event) => {
      event?.preventDefault();
      performSendOtp();
    },
    [performSendOtp]
  );

  const handleResendOtp = useCallback(() => {
    if (resendSeconds > 0 || authLoading) return;
    performSendOtp();
  }, [resendSeconds, authLoading, performSendOtp]);

  /* ------------------------------------------------------------------------ */
  /* Verify OTP                                                               */
  /* ------------------------------------------------------------------------ */

  const handleVerifyOtpAndEnter = useCallback(
    async (event) => {
      event?.preventDefault();

      if (!otpValid) {
        setFailure(
          {
            code: 'VALIDATION_ERROR',
            message:
              'Please enter a valid 4 to 8 digit numeric OTP.'
          },
          'Invalid OTP.'
        );
        return;
      }

      if (authLoading) return;

      setAuthLoading(true);
      clearMessages();

      try {
        const res = await verifyOtp({
          gstin: normalizedGstin,
          username: normalizeUsername(authUsername),
          otp: String(otpInput || '').trim()
        });

        setOtpSent(false);
        setOtpInput('');
        setResendSeconds(0);

        setAuthSuccessMsg(
          res?.message ||
          `Authentication successful for ${normalizedGstin}.`
        );

        if (typeof onVerifySuccess === 'function') {
          onVerifySuccess({
            gstin: normalizedGstin,
            username: normalizeUsername(authUsername),
            taxpayerDetails: taxpayerDetails || null,
            response: res || null
          });
        }
      } catch (err) {
        const mapped = setFailure(
          err,
          'Invalid or expired OTP. Please retry.'
        );

        const cd = mapped.errorCd;

        /**
         * If GST session/token expired, go back to OTP request form.
         * Otherwise keep user on OTP step but clear wrong OTP.
         */
        if (
          mapped.code === 'SESSION_EXPIRED' ||
          SESSION_RESET_ERROR_CODES.has(cd)
        ) {
          setOtpSent(false);
          setOtpInput('');
          setResendSeconds(0);
        } else {
          setOtpInput('');
        }

        if (mapped.retryAfterSeconds && mapped.retryAfterSeconds > 0) {
          setResendSeconds((prev) =>
            Math.max(prev, Number(mapped.retryAfterSeconds))
          );
        }
      } finally {
        if (mountedRef.current) {
          setAuthLoading(false);
        }
      }
    },
    [
      authLoading,
      authUsername,
      normalizedGstin,
      otpInput,
      otpValid,
      taxpayerDetails,
      onVerifySuccess,
      setAuthLoading,
      setOtpSent,
      setOtpInput,
      setAuthSuccessMsg,
      clearMessages,
      setFailure
    ]
  );

  /* ------------------------------------------------------------------------ */
  /* Change GSTIN / reset OTP flow                                            */
  /* ------------------------------------------------------------------------ */

  const handleChangeGstin = useCallback(() => {
    setOtpSent(false);
    setOtpInput('');
    setResendSeconds(0);
    setTaxpayerDetails(null);
    clearMessages();
  }, [
    setOtpSent,
    setOtpInput,
    setTaxpayerDetails,
    clearMessages
  ]);

  /* ------------------------------------------------------------------------ */
  /* Render helpers                                                           */
  /* ------------------------------------------------------------------------ */

  const gstinHelpText = useMemo(() => {
    if (taxpayerDetails) {
      const name =
        taxpayerDetails.legalName ||
        taxpayerDetails.tradeName ||
        taxpayerDetails.lgnm ||
        taxpayerDetails.tradeNm ||
        'Active Taxpayer';

      return `✓ Registered: ${name}`;
    }

    if (!authGstin) {
      return '15-character GSTIN. Click Verify to fetch registered business name.';
    }

    if (gstinValid) {
      return 'Valid GSTIN format.';
    }

    if (String(authGstin || '').trim().length === 15) {
      return 'Invalid GSTIN format.';
    }

    return 'Enter 15-character GSTIN.';
  }, [authGstin, gstinValid, taxpayerDetails]);

  const canSubmitOtpRequest =
    !authLoading &&
    gstinValid &&
    usernameValid &&
    authConsent;

  const canSubmitOtpVerify =
    !authLoading &&
    otpValid;

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="min-h-[75vh] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-surface rounded-2xl border border-surface-border shadow-card p-8 sm:p-10 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-50 border border-brand-200 text-brand-600 shadow-xs mb-1">
            <ShieldCheck className="w-7 h-7" />
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            GST Return Portal Authentication
          </h1>

          <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
            Verify credentials and OTP via Government Portal API (GSP) to unlock
            live return preparation &amp; filing.
          </p>
        </div>

        {/* Error banner */}
        {authErrorMsg && (
          <div
            className="p-3.5 rounded-xl bg-danger-50 border border-danger-200 text-danger-700 text-xs"
            role="alert"
            aria-live="polite"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />

              <div className="flex-1">
                <div>{authErrorMsg}</div>

                {errorMeta &&
                  (errorMeta.code ||
                    errorMeta.errorCd ||
                    errorMeta.retryAfterSeconds) && (
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] font-mono text-danger-500">
                      {errorMeta.code && (
                        <span>Code: {errorMeta.code}</span>
                      )}

                      {errorMeta.errorCd && (
                        <span>GSTN: {errorMeta.errorCd}</span>
                      )}

                      {errorMeta.retryAfterSeconds && (
                        <span>
                          Retry after: {errorMeta.retryAfterSeconds}s
                        </span>
                      )}
                    </div>
                  )}
              </div>

              <button
                type="button"
                onClick={clearMessages}
                className="shrink-0 rounded p-1 text-danger-500 hover:text-danger-700"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Success banner */}
        {!authErrorMsg && authSuccessMsg && (
          <div
            className="p-3.5 rounded-xl bg-success-50 border border-success-200 text-success-700 text-xs flex items-center gap-2.5"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{authSuccessMsg}</span>
          </div>
        )}

        {/* Form */}
        <form
          onSubmit={otpSent ? handleVerifyOtpAndEnter : handleSendOtp}
          className="space-y-4"
        >
          {/* GSTIN */}
          <div>
            <label
              htmlFor="gstin-input"
              className="block text-xs font-semibold text-slate-800 mb-1.5"
            >
              GSTIN (Goods &amp; Services Tax Identification)
            </label>

            <div className="relative flex items-center">
              <input
                id="gstin-input"
                type="text"
                required
                maxLength={15}
                value={authGstin}
                onChange={(e) => {
                  setAuthGstin(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                  );
                  setTaxpayerDetails(null);
                }}
                placeholder="e.g. 29ABCDE1234F1Z5"
                className="w-full pl-3 pr-24 py-2.5 text-xs font-mono font-bold uppercase rounded-xl border border-surface-border focus:outline-none focus:border-brand-500 bg-slate-50/50 disabled:opacity-50"
                disabled={otpSent}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="gstin-help"
              />

              <button
                type="button"
                onClick={handleVerifyGstinName}
                disabled={
                  verifyingGstin ||
                  !gstinValid ||
                  otpSent
                }
                className="absolute right-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 transition disabled:opacity-40 cursor-pointer"
              >
                {verifyingGstin ? 'Verifying...' : 'Verify'}
              </button>
            </div>

            <p
              id="gstin-help"
              className="text-[11px] text-slate-400 mt-1"
            >
              {gstinHelpText}
            </p>
          </div>

          {/* Username */}
          <div>
            <label
              htmlFor="username-input"
              className="block text-xs font-semibold text-slate-800 mb-1.5"
            >
              GST Portal Username
            </label>

            <input
              id="username-input"
              type="text"
              required
              value={authUsername}
              onChange={(e) => setAuthUsername(e.target.value)}
              placeholder="Enter GST Portal username"
              className="w-full px-3 py-2.5 text-xs rounded-xl border border-surface-border focus:outline-none focus:border-brand-500 bg-slate-50/50 disabled:opacity-50"
              disabled={otpSent}
              autoComplete="username"
              aria-describedby="username-help"
            />

            <p
              id="username-help"
              className="text-[11px] text-slate-400 mt-1"
            >
              Your registered username on the official GST portal. API Access
              must be enabled for this username.
            </p>
          </div>

          {/* Consent */}
          <div className="flex items-start gap-2.5 pt-1 text-xs text-slate-600">
            <input
              type="checkbox"
              id="consentCheck"
              checked={authConsent}
              onChange={(e) => setAuthConsent(e.target.checked)}
              className="mt-0.5 rounded border-surface-border text-brand-600 focus:ring-brand-500 cursor-pointer disabled:opacity-50"
              disabled={otpSent}
              aria-describedby="consent-help"
            />

            <label
              htmlFor="consentCheck"
              id="consent-help"
              className="text-[11px] text-slate-500 leading-tight select-none cursor-pointer"
            >
              I authorize the application to fetch GST returns and tax
              compliance data on my behalf from the GST Portal via authorized
              GST Suvidha Provider (GSP).
            </label>
          </div>

          {/* OTP step */}
          {otpSent && (
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 space-y-3 animate-in fade-in duration-200">
              <label
                htmlFor="otp-input"
                className="block text-xs font-semibold text-blue-900"
              >
                Enter OTP received on registered Mobile/Email:
              </label>

              <div className="flex items-center gap-2">
                <input
                  id="otp-input"
                  ref={otpInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={otpInput}
                  onChange={(e) =>
                    setOtpInput(e.target.value.replace(/[^0-9]/g, ''))
                  }
                  placeholder="Enter numeric OTP"
                  className="w-full px-3 py-2 text-sm font-mono font-bold tracking-widest text-center rounded-xl border border-blue-300 focus:outline-none focus:border-blue-500 bg-white disabled:opacity-50"
                  disabled={authLoading}
                  aria-describedby="otp-help"
                />

                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!canSubmitOtpVerify}
                  className="shrink-0"
                >
                  {authLoading ? 'Verifying...' : 'Verify OTP →'}
                </Button>
              </div>

              <p
                id="otp-help"
                className="text-[11px] text-blue-700"
              >
                OTP is usually 6 digits, but GST portal may send 4 to 8 numeric
                characters.
              </p>

              <div className="flex justify-between items-center text-[11px] text-blue-700 pt-1 border-t border-blue-200">
                <button
                  type="button"
                  onClick={handleChangeGstin}
                  className="underline hover:text-blue-900 cursor-pointer disabled:opacity-50"
                  disabled={authLoading}
                >
                  Change GSTIN
                </button>

                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={authLoading || resendSeconds > 0}
                  className="font-semibold flex items-center gap-1 underline hover:text-blue-900 cursor-pointer disabled:opacity-50"
                >
                  {resendSeconds > 0 ? (
                    <>
                      <Clock className="w-3.5 h-3.5" />
                      Resend in {resendSeconds}s
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      Resend OTP
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Initial submit button */}
          {!otpSent && (
            <Button
              type="submit"
              variant="fintech"
              className="w-full justify-center"
              disabled={!canSubmitOtpRequest}
            >
              {authLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  <span>Connecting to Govt Portal API...</span>
                </>
              ) : (
                <>
                  <span>Send GSTN Verification OTP</span>
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </>
              )}
            </Button>
          )}
        </form>

        {/* Footer help */}
        <div className="pt-2 border-t border-surface-border text-[11px] text-slate-500 space-y-1">
          <div className="flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand-600" />
            <span>
              If OTP is not received, verify that API Access is enabled for
              this username on the GST portal.
            </span>
          </div>

          <a
            href="https://www.gst.gov.in"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand-600 hover:underline"
          >
            Open GST Portal
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

export default AuthScreen;