import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import useFocusTrap from "../hooks/useFocusTrap";
import { useAuth } from "../context/AuthContext";
import {
  checkNilEligibility,
  fileNilReturn,
  getReturnsSummary,
  checkFilingStatus,
  createReturnIdempotencyKey
} from "../api/returns.api";
import { requestEvcOtp } from "../api/auth.api";
import { formatCurrency, formatPeriod } from "../utils/format";
import { isValidEvcOtp, isValidPan } from "../utils/validators";
import Loader from "./Loader";
import {
  Zap,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Copy,
  Check,
  X,
  ArrowLeft,
  RefreshCw,
  Lock,
  Smartphone,
  Award,
  Download,
  MessageSquare,
  ExternalLink,
  Clock,
  AlertTriangle,
  Info
} from "lucide-react";
import Button from "./ui/Button";
import Badge from "./ui/Badge";
import FilingCertificateModal from "./FilingCertificateModal";

/* -------------------------------------------------------------------------- */
/* Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

const STEPS = {
  FORM: "FORM",
  OTP: "OTP",
  FILING: "FILING",
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED"
};

const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;
const NIL_RETURN_TYPES = ["GSTR1", "GSTR3B"];

const INVALID_OTP_ERROR_CODES = new Set([
  "RETFILE01",
  "RETFILE02",
  "OTP_EXPIRED",
  "INVALID_OTP",
  "MAX_OTP_ATTEMPTS"
]);

/**
 * PAN storage is sensitive. Default disabled.
 * Enable only if your security policy allows local persistence.
 */
const STORE_PAN_LOCALLY =
  String(import.meta.env.VITE_NIL_STORE_PAN_LOCALLY || "false").toLowerCase() === "true";

const TZ_OFFSET_MIN = Number(import.meta.env.VITE_GST_TZ_OFFSET_MIN || 330);
const IST_OFFSET_MS = TZ_OFFSET_MIN * 60 * 1000;

function nowIst() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function getCurrentIstPeriod() {
  const d = nowIst();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${month}${year}`;
}

function getLastMonthPeriod() {
  const d = nowIst();

  let monthIndex = d.getUTCMonth();
  let year = d.getUTCFullYear();

  monthIndex -= 1;

  if (monthIndex < 0) {
    monthIndex = 11;
    year -= 1;
  }

  const month = String(monthIndex + 1).padStart(2, "0");
  return `${month}${year}`;
}

function isValidPeriod(value) {
  return PERIOD_REGEX.test(String(value || "").trim());
}

function isFuturePeriod(value) {
  const period = String(value || "").trim();

  if (!isValidPeriod(period)) return false;

  const current = getCurrentIstPeriod();

  const periodMonth = Number(period.slice(0, 2));
  const periodYear = Number(period.slice(2));

  const currentMonth = Number(current.slice(0, 2));
  const currentYear = Number(current.slice(2));

  if (periodYear > currentYear) return true;
  if (periodYear === currentYear && periodMonth > currentMonth) return true;

  return false;
}

function normalizeReturnType(type) {
  const normalized = String(type || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (normalized === "GSTR3B" || normalized === "GSTR3") {
    return "GSTR3B";
  }

  return "GSTR1";
}

function getInitialPanFromGstin(gstinVal) {
  if (!gstinVal || gstinVal.length < 12) return "";

  const extractedPan = String(gstinVal).slice(2, 12).toUpperCase();

  if (extractedPan[3] === "P") {
    return extractedPan;
  }

  if (STORE_PAN_LOCALLY && typeof window !== "undefined") {
    try {
      return (
        localStorage.getItem(`signatory_pan_${gstinVal}`) ||
        localStorage.getItem("last_signatory_pan") ||
        ""
      );
    } catch (_) {
      return "";
    }
  }

  return "";
}

function isInvalidOtpErrorCode(code) {
  return Boolean(code && INVALID_OTP_ERROR_CODES.has(String(code).toUpperCase()));
}

function isUncertainFilingError(err) {
  if (!err) return false;

  if (err.pendingVerification === true) return true;

  if (
    err.code === "REQUEST_TIMEOUT" ||
    err.code === "TIMEOUT" ||
    err.code === "NETWORK_ERROR"
  ) {
    return true;
  }

  if (err.status === 504) return true;

  const message = String(err.message || "").toLowerCase();

  if (
    err.code === "PROVIDER_ERROR" &&
    (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("did not confirm") ||
      message.includes("unknown") ||
      message.includes("could not be confirmed")
    )
  ) {
    return true;
  }

  return false;
}

function mapNilErrorMessage(err) {
  const code = err?.code || null;
  const cd =
    err?.errorCd ||
    err?.error_cd ||
    err?.data?.error_cd ||
    null;

  const message = err?.message || "";
  const retryAfter = err?.rateLimit?.retryAfterSeconds || null;

  if (code === "RATE_LIMITED") {
    return retryAfter
      ? `Too many nil filing attempts. Please try again after ${retryAfter} seconds.`
      : "Too many nil filing attempts. Please wait before trying again.";
  }

  if (code === "REQUEST_TIMEOUT" || code === "TIMEOUT") {
    return "The GST portal did not respond in time. Please check filing status before retrying. Do not file again immediately.";
  }

  if (code === "NETWORK_ERROR") {
    return "Network connection failed while filing. Please check filing status before retrying.";
  }

  const cdUpper = String(cd || "").toUpperCase();

  if (cdUpper === "OTP0001") {
    return "Invalid GSTIN. Please verify your GSTIN on the GST portal.";
  }

  if (cdUpper === "OTP0006") {
    return "PAN does not match Authorized Signatory on GST portal. Please use personal PAN of Director/Partner.";
  }

  if (cdUpper === "OTP0008" || cdUpper === "OTP0011" || cdUpper === "AUTH4033") {
    return "GST session expired or invalid. Please reconnect your GST portal session and try again.";
  }

  if (
    cdUpper === "AUTH4038" ||
    cdUpper === "GSP052A" ||
    cdUpper === "GSP102" ||
    cdUpper === "RET11407"
  ) {
    return "GST Portal AuthToken expired or not found. Please re-verify OTP on GST Return Hub.";
  }

  if (cdUpper === "OTP0010") {
    return "Not Authorized Signatory. Please enter personal PAN of the designated Director / Partner (4th letter must be 'P').";
  }

  if (cdUpper === "RET11406" || cdUpper === "RET11404") {
    return "Return summary calculation is in progress on the GST portal. Please wait 1-2 minutes and retry.";
  }

  if (cdUpper === "RETFILE01") {
    return "Invalid EVC OTP entered. Please check the code received on your mobile/email and try again.";
  }

  if (cdUpper === "RETFILE02") {
    return "EVC OTP has expired. Please request a fresh EVC OTP.";
  }

  if (cdUpper === "RET01202") {
    return "Previous tax period return is pending on GST portal. Please file earlier periods first.";
  }

  if (cdUpper === "GSP101") {
    return "Request payload rejected by GST System. Please verify nil return parameters and portal nil confirmation.";
  }

  if (cdUpper === "AUTH4037") {
    return "API Access is not enabled for this username. Please enable API Access under My Profile > Manage API Access on gst.gov.in.";
  }

  if (cdUpper === "GSP500" || cdUpper === "SYS500") {
    return "Government GST Portal is undergoing maintenance. Please retry in a few moments.";
  }

  if (cdUpper === "GSTNBadRequest") {
    return "The government portal rejected the nil filing request. Please verify that the return period is open, nil eligibility is confirmed on the portal, and the signatory PAN is registered for this GSTIN.";
  }

  if (cdUpper) {
    return message && message !== "Could not complete the request. Please try again."
      ? message
      : `GST Portal Notice (${cdUpper}): The government portal could not complete this nil filing request.`;
  }

  if (code === "VALIDATION_ERROR") {
    return message || "Invalid input. Please check PAN, OTP, period, return type, and statutory declaration.";
  }

  if (code === "PROVIDER_ERROR") {
    return message || "The GST service could not complete this nil filing request on the government portal. Please verify return status or try again in a few moments.";
  }

  return message || "An unexpected error occurred.";
}

function normalizeFilingRow(f) {
  if (!f || typeof f !== "object") return null;

  const period = String(f.period || f.ret_period || f.tax_period || "").trim();
  const type = normalizeReturnType(f.type || f.returnType || f.return_type || "");
  const status = String(f.status || f.filingStatus || f.filing_status || "").trim();
  const arn = f.arn || f.ARN || f.acknowledgement_number || null;

  return {
    ...f,
    period,
    type,
    status,
    arn
  };
}

function extractFilings(summary) {
  if (!summary || typeof summary !== "object") return [];

  const candidates = [
    summary.filings,
    summary.data?.filings,
    summary.result?.filings,
    summary.returns,
    summary.data?.returns
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map(normalizeFilingRow)
        .filter(Boolean);
    }
  }

  const periods =
    summary.availablePeriods ||
    summary.data?.availablePeriods ||
    [];

  if (!Array.isArray(periods)) return [];

  const out = [];

  for (const p of periods) {
    const period = String(p?.period || "").trim();
    if (!period) continue;

    if (p?.gstr1) {
      out.push(
        normalizeFilingRow({
          period,
          type: "GSTR1",
          status: p.gstr1,
          arn: p.gstr1Arn || p.gstr1_arn || null
        })
      );
    }

    if (p?.gstr3b) {
      out.push(
        normalizeFilingRow({
          period,
          type: "GSTR3B",
          status: p.gstr3b,
          arn: p.gstr3bArn || p.gstr3b_arn || null
        })
      );
    }
  }

  return out.filter(Boolean);
}

function buildAvailablePeriods(initialPeriod) {
  const list = [];
  const base = nowIst();

  // Conservative default: last 24 completed months.
  for (let offset = 1; offset <= 24; offset += 1) {
    const d = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - offset, 1)
    );

    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const y = d.getUTCFullYear();
    const code = `${m}${y}`;

    const label = new Intl.DateTimeFormat("en-IN", {
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }).format(d);

    list.push({ code, label });
  }

  const ip = String(initialPeriod || "").trim();

  if (
    isValidPeriod(ip) &&
    !isFuturePeriod(ip) &&
    !list.some((p) => p.code === ip)
  ) {
    list.unshift({ code: ip, label: ip });
  }

  return list;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function NilReturnModal({
  isOpen,
  onClose,
  initialPeriod,
  initialType = "GSTR1",
  onSuccess,
  onPending,
  gstin,
  username
}) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const activeGstin =
    gstin ||
    user?.gstin ||
    user?.currentWorkspace?.gstin ||
    "";

  const activeUsername =
    username ||
    user?.portalUsername ||
    user?.username ||
    "";

  const userId =
    user?._id ||
    user?.memberId ||
    user?.member?._id ||
    activeUsername ||
    activeGstin ||
    "anonymous";

  const availablePeriods = useMemo(
    () => buildAvailablePeriods(initialPeriod),
    [initialPeriod]
  );

  const [returnType, setReturnType] = useState(() =>
    normalizeReturnType(initialType)
  );

  const [period, setPeriod] = useState(() => {
    const ip = String(initialPeriod || "").trim();

    if (isValidPeriod(ip) && !isFuturePeriod(ip)) {
      return ip;
    }

    return availablePeriods[0]?.code || getLastMonthPeriod();
  });

  const [checking, setChecking] = useState(false);
  const [eligibility, setEligibility] = useState(null);

  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [errorCd, setErrorCd] = useState(null);
  const [rateLimitRetryAfter, setRateLimitRetryAfter] = useState(null);

  const [step, setStep] = useState(STEPS.FORM);
  const [declaration, setDeclaration] = useState(false);

  const [pan, setPan] = useState(() => getInitialPanFromGstin(activeGstin));
  const [otpInput, setOtpInput] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpMessage, setOtpMessage] = useState(null);
  const [timer, setTimer] = useState(0);

  const [filing, setFiling] = useState(false);
  const [filingResult, setFilingResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [smsCopied, setSmsCopied] = useState(false);
  const [showCert, setShowCert] = useState(false);

  const otpInputRef = useRef(null);
  const panInputRef = useRef(null);

  const mountedRef = useRef(true);
  const pollTimerRef = useRef(null);
  const statusAttemptsRef = useRef(0);
  const nilKeyRef = useRef(null);
  const checkStatusRef = useRef(null);

  /* ------------------------------------------------------------------------ */
  /* Error helpers                                                            */
  /* ------------------------------------------------------------------------ */

  const clearStructuredError = useCallback(() => {
    setError(null);
    setErrorCode(null);
    setErrorCd(null);
    setRateLimitRetryAfter(null);
  }, []);

  const setStructuredError = useCallback((err, fallback = "An unexpected error occurred.") => {
    const code = err?.code || null;
    const cd =
      err?.errorCd ||
      err?.error_cd ||
      err?.data?.error_cd ||
      null;
    const retryAfter = err?.rateLimit?.retryAfterSeconds || null;

    setError(mapNilErrorMessage(err) || fallback);
    setErrorCode(code);
    setErrorCd(cd);
    setRateLimitRetryAfter(retryAfter);
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Polling / reset helpers                                                  */
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
    setOtpInput("");
    setSendingOtp(false);
    setFiling(false);
    setError(null);
    setErrorCode(null);
    setErrorCd(null);
    setRateLimitRetryAfter(null);
    setOtpMessage(null);
    setFilingResult(null);
    setTimer(0);
    setCopied(false);
    setSmsCopied(false);
    setShowCert(false);
    setDeclaration(false);
    setEligibility(null);
    setChecking(false);
    setPan(getInitialPanFromGstin(activeGstin));

    nilKeyRef.current = null;
    statusAttemptsRef.current = 0;
  }, [activeGstin, clearPollTimer]);

  const handleClose = useCallback(() => {
    if (filing || sendingOtp) {
      const ok = window.confirm(
        "Nil filing is in progress. Are you sure you want to close? This may not cancel the filing on the GST portal."
      );

      if (!ok) return;
    }

    resetInternalState();
    onClose?.();
  }, [filing, sendingOtp, resetInternalState, onClose]);

  const modalRef = useFocusTrap(isOpen && !filing && !sendingOtp, handleClose);

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
    if (initialType) {
      setReturnType(normalizeReturnType(initialType));
    }
  }, [initialType]);

  useEffect(() => {
    const ip = String(initialPeriod || "").trim();

    if (isValidPeriod(ip) && !isFuturePeriod(ip)) {
      setPeriod(ip);
    }
  }, [initialPeriod]);

  useEffect(() => {
    setPan(getInitialPanFromGstin(activeGstin));
  }, [activeGstin]);

  useEffect(() => {
    if (!isOpen) return;

    if (step === STEPS.FORM && panInputRef.current && eligibility?.eligible) {
      panInputRef.current.focus();
    } else if (step === STEPS.OTP && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [isOpen, step, eligibility]);

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
  /* Eligibility                                                              */
  /* ------------------------------------------------------------------------ */

  const checkEligibility = useCallback(
    async (p, t) => {
      if (!p) return;

      setChecking(true);
      clearStructuredError();
      setFilingResult(null);

      try {
        const res = await checkNilEligibility(p, t, activeGstin);
        setEligibility(res);
      } catch (err) {
        setEligibility(null);
        setStructuredError(err, "Failed to check nil eligibility.");
      } finally {
        if (mountedRef.current) {
          setChecking(false);
        }
      }
    },
    [activeGstin, clearStructuredError, setStructuredError]
  );

  useEffect(() => {
    if (!isOpen || !period) return;

    let ignore = false;

    Promise.resolve().then(() => {
      if (!ignore) {
        checkEligibility(period, returnType);
      }
    });

    return () => {
      ignore = true;
    };
  }, [isOpen, period, returnType, checkEligibility]);

  /* ------------------------------------------------------------------------ */
  /* Pending status polling                                                   */
  /* ------------------------------------------------------------------------ */

  const scheduleStatusCheck = useCallback(
    (result, delay = 5000) => {
      clearPollTimer();

      pollTimerRef.current = setTimeout(() => {
        checkStatusRef.current?.(result);
      }, delay);
    },
    [clearPollTimer]
  );

  const handleCheckStatus = useCallback(
    async (result) => {
      if (!mountedRef.current) return;

      statusAttemptsRef.current += 1;
      setFiling(true);

      try {
        let arn = null;

        const refId =
          result?.referenceId ||
          result?.reference_id ||
          result?.refId ||
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
            const filingPeriod = String(f?.period || "").trim();
            const filingType = normalizeReturnType(f?.type || "");
            const filingStatus = String(f?.status || "").toLowerCase();
            const filingArn = f?.arn || null;

            return (
              filingPeriod === String(period) &&
              filingType === returnType &&
              filingStatus === "filed" &&
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
            type: returnType,
            period,
            filingDate:
              result?.filingDate ||
              result?.dateStr ||
              new Date().toLocaleDateString("en-IN"),
            localRecordSaved:
              result?.localRecordSaved ??
              result?.recordPersisted ??
              true
          };

          setFilingResult(successResult);
          setStep(STEPS.SUCCESS);
          clearPollTimer();

          if (typeof onSuccess === "function") {
            onSuccess(successResult);
          }

          return;
        }

        if (statusAttemptsRef.current < 3) {
          scheduleStatusCheck(result, 8000);
          return;
        }

        setStep(STEPS.PENDING);
        setStructuredError(
          {
            code: "PROVIDER_ERROR",
            message:
              "Could not confirm nil filing yet. Please check Filing History or the GST portal after some time. Do not file again immediately."
          },
          "Could not confirm nil filing yet."
        );
      } catch (err) {
        if (statusAttemptsRef.current < 3) {
          scheduleStatusCheck(result, 8000);
          return;
        }

        setStep(STEPS.PENDING);
        setStructuredError(
          err,
          "Could not verify nil filing status. Please check Filing History before retrying."
        );
      } finally {
        if (mountedRef.current) {
          setFiling(false);
        }
      }
    },
    [
      period,
      returnType,
      onSuccess,
      scheduleStatusCheck,
      setStructuredError,
      clearPollTimer
    ]
  );

  useEffect(() => {
    checkStatusRef.current = handleCheckStatus;
  }, [handleCheckStatus]);

  /* ------------------------------------------------------------------------ */
  /* OTP request                                                              */
  /* ------------------------------------------------------------------------ */

  const handleSendEvcOtp = useCallback(async () => {
    const cleanPan = String(pan || "").trim().toUpperCase();

    if (!isValidPan(cleanPan)) {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          message: "Please enter a valid 10-character PAN (e.g., AABCP1234F)."
        },
        "Invalid PAN."
      );
      return;
    }

    if (cleanPan[3] !== "P") {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          errorCd: "OTP0010",
          message:
            "For company/LLP GSTINs, use the personal PAN of the designated Director/Partner (4th letter must be 'P')."
        },
        "Entity PAN detected."
      );
      return;
    }

    if (!declaration) {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          message:
            "You must accept the CGST Rule 67A statutory declaration before proceeding."
        },
        "Statutory declaration required."
      );
      return;
    }

    if (!period || !isValidPeriod(period) || isFuturePeriod(period)) {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          message: "A valid non-future return period (MMYYYY) is required."
        },
        "Invalid period."
      );
      return;
    }

    if (!eligibility) {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          message: "Eligibility check is still running. Please wait."
        },
        "Eligibility not loaded."
      );
      return;
    }

    if (eligibility.alreadyFiled) {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          message:
            `Nil ${returnType} for ${period} is already filed with ARN ${eligibility.arn || "n/a"}.`
        },
        "Already filed."
      );
      return;
    }

    if (!eligibility.eligible) {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          message:
            eligibility.warnings?.join(" ") ||
            `You are not eligible to file Nil ${returnType} for ${period}.`
        },
        "Not eligible for nil return."
      );
      return;
    }

    setSendingOtp(true);
    clearStructuredError();

    try {
      const formType = returnType === "GSTR3B" ? "R3B" : "R1";

      const res = await requestEvcOtp({
        gstin: activeGstin,
        pan: cleanPan,
        form_type: formType,
        period,
        username: activeUsername
      });

      if (STORE_PAN_LOCALLY && typeof window !== "undefined") {
        try {
          localStorage.setItem(`signatory_pan_${activeGstin}`, cleanPan);
          localStorage.setItem("last_signatory_pan", cleanPan);
        } catch (_) {
          // Ignore storage failures.
        }
      }

      setOtpMessage(
        res?.message ||
        `EVC OTP sent successfully to mobile/email registered with PAN ${cleanPan}.`
      );

      setStep(STEPS.OTP);
      setTimer(30);

      nilKeyRef.current = createReturnIdempotencyKey(
        "nil-file",
        `${returnType}:${period}`,
        userId
      );
    } catch (err) {
      setStructuredError(err, "Failed to send EVC OTP.");
    } finally {
      if (mountedRef.current) {
        setSendingOtp(false);
      }
    }
  }, [
    pan,
    declaration,
    eligibility,
    period,
    returnType,
    activeGstin,
    activeUsername,
    userId,
    clearStructuredError,
    setStructuredError
  ]);

  /* ------------------------------------------------------------------------ */
  /* File nil return                                                          */
  /* ------------------------------------------------------------------------ */

  const handleVerifyOtpAndFile = useCallback(async () => {
    const cleanOtp = String(otpInput || "").trim();
    const cleanPan = String(pan || "").trim().toUpperCase();

    if (!isValidEvcOtp(cleanOtp)) {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          message:
            "Enter the 4 to 8 character EVC code received on your mobile/email."
        },
        "Invalid EVC OTP."
      );
      return;
    }

    if (!isValidPan(cleanPan) || cleanPan[3] !== "P") {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          message: "Authorized signatory personal PAN is required."
        },
        "Invalid PAN."
      );
      setStep(STEPS.FORM);
      return;
    }

    if (!declaration) {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          message: "Statutory declaration must be accepted."
        },
        "Declaration required."
      );
      setStep(STEPS.FORM);
      return;
    }

    if (!eligibility?.eligible || eligibility?.alreadyFiled) {
      setStructuredError(
        {
          code: "VALIDATION_ERROR",
          message:
            eligibility?.alreadyFiled
              ? `Nil ${returnType} for ${period} is already filed.`
              : "You are not eligible to file Nil return for this period."
        },
        "Not eligible."
      );
      setStep(STEPS.FORM);
      return;
    }

    setStep(STEPS.FILING);
    setFiling(true);
    clearStructuredError();

    try {
      const idempotencyKey =
        nilKeyRef.current ||
        createReturnIdempotencyKey(
          "nil-file",
          `${returnType}:${period}`,
          userId
        );

      nilKeyRef.current = idempotencyKey;

      const res = await fileNilReturn({
        period,
        returnType,
        declarationAccepted: true,
        verificationMode: "EVC",
        otp: cleanOtp,
        pan: cleanPan,
        username: activeUsername,
        userId,
        idempotencyKey
      });

      /**
       * Backend may return HTTP 202 with:
       * {
       *   success: false,
       *   pending: true,
       *   message: '...'
       * }
       */
      if (
        res?.pending === true ||
        (res?.success === false && res?.pending !== false)
      ) {
        const pendingResult = {
          ...(res || {}),
          pending: true,
          type: returnType,
          period
        };

        setFilingResult(pendingResult);
        setStep(STEPS.PENDING);

        if (typeof onPending === "function") {
          onPending(pendingResult);
        }

        scheduleStatusCheck(pendingResult, 5000);
        return;
      }

      if (!res?.arn) {
        throw {
          code: "PROVIDER_ERROR",
          message:
            "The nil filing service did not return an official ARN. Filing status could not be confirmed."
        };
      }

      setFilingResult(res);
      setStep(STEPS.SUCCESS);

      if (typeof onSuccess === "function") {
        onSuccess(res);
      }
    } catch (err) {
      const cd =
        err?.errorCd ||
        err?.error_cd ||
        err?.data?.error_cd ||
        null;

      if (isUncertainFilingError(err)) {
        const pendingResult = {
          pending: true,
          type: returnType,
          period,
          message:
            mapNilErrorMessage(err) ||
            err?.message ||
            "Nil filing outcome could not be confirmed."
        };

        setFilingResult(pendingResult);
        setStep(STEPS.PENDING);

        if (typeof onPending === "function") {
          onPending(pendingResult);
        }

        scheduleStatusCheck(pendingResult, 5000);
        return;
      }

      if (isInvalidOtpErrorCode(cd)) {
        nilKeyRef.current = null;
        setOtpInput("");
        setStep(STEPS.OTP);
        setStructuredError(err, "Invalid or expired EVC OTP.");
        return;
      }

      setStep(STEPS.FAILED);
      setStructuredError(err, "Failed to file Nil return.");
    } finally {
      if (mountedRef.current) {
        setFiling(false);
      }
    }
  }, [
    otpInput,
    pan,
    declaration,
    eligibility,
    period,
    returnType,
    activeUsername,
    userId,
    clearStructuredError,
    setStructuredError,
    scheduleStatusCheck,
    onPending,
    onSuccess
  ]);

  const handleFailedTryAgain = useCallback(() => {
    if (isInvalidOtpErrorCode(errorCd)) {
      nilKeyRef.current = createReturnIdempotencyKey(
        "nil-file",
        `${returnType}:${period}`,
        userId
      );

      setOtpInput("");
      setStep(STEPS.OTP);
      clearStructuredError();
      return;
    }

    setStep(STEPS.FORM);
    clearStructuredError();
    checkEligibility(period, returnType);
  }, [
    errorCd,
    returnType,
    period,
    userId,
    clearStructuredError,
    checkEligibility
  ]);

  /* ------------------------------------------------------------------------ */
  /* Copy / download                                                          */
  /* ------------------------------------------------------------------------ */

  const handleCopyArn = useCallback(async () => {
    if (!filingResult?.arn) return;

    try {
      await navigator.clipboard.writeText(filingResult.arn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      const textArea = document.createElement("textarea");
      textArea.value = filingResult.arn;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [filingResult?.arn]);

  const handleCopySms = useCallback(() => {
    const smsText = `NIL ${returnType === "GSTR1" ? "R1" : "3B"} ${activeGstin} ${period}`;

    try {
      navigator.clipboard?.writeText(smsText);
      setSmsCopied(true);
      setTimeout(() => setSmsCopied(false), 2000);
    } catch (_) {
      const textArea = document.createElement("textarea");
      textArea.value = smsText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setSmsCopied(true);
      setTimeout(() => setSmsCopied(false), 2000);
    }
  }, [returnType, activeGstin, period]);

  /**
   * Safe local info download.
   *
   * IMPORTANT:
   * This is NOT a GSTN portal-ready JSON.
   * Old version fabricated gt/cur_gt/hash and full nil tables, which is unsafe.
   */
  const handleDownloadNilInfo = useCallback(() => {
    const payload = {
      documentType: "NIL_RETURN_FILING_INFO",
      generatedAt: new Date().toISOString(),
      gstin: activeGstin,
      period,
      returnType,
      declarationAccepted: declaration,
      verificationMode: "EVC",
      eligibility: eligibility
        ? {
          eligible: Boolean(eligibility.eligible),
          alreadyFiled: Boolean(eligibility.alreadyFiled),
          arn: eligibility.arn || null,
          activeInvoicesCount: eligibility.activeInvoicesCount ?? 0,
          activeBillsCount: eligibility.activeBillsCount ?? 0,
          totalTaxableSales: eligibility.totalTaxableSales ?? 0,
          totalOutwardTax: eligibility.totalOutwardTax ?? 0,
          totalItc: eligibility.totalItc ?? 0,
          hasRcmLiability: Boolean(eligibility.hasRcmLiability),
          warnings: eligibility.warnings || [],
          portalConfirmationRequired: Boolean(eligibility.portalConfirmationRequired),
          localEligibilityOnly: Boolean(eligibility.localEligibilityOnly)
        }
        : null,
      officialNote:
        "This file is not a GSTN portal-ready JSON. For official nil filing, use GST Return Hub EVC flow or the official GST offline tool. Backend nil filing requires GSTN portal isnil: Y confirmation where configured.",
      preview:
        returnType === "GSTR1"
          ? {
            minimalSavePayload: {
              gstin: activeGstin,
              fp: period
            },
            note:
              "Do not include gt, cur_gt, or fabricated hash in nil GSTR-1 RETSAVE payload unless explicitly required by a trusted compliant source."
          }
          : {
            note:
              "GSTR-3B nil filing must be confirmed by GSTN portal summary. No local portal-ready payload is generated."
          }
    };

    const jsonString = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Nil_${returnType}_${activeGstin || "GSTIN"}_${period}_FilingInfo.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [
    activeGstin,
    period,
    returnType,
    declaration,
    eligibility
  ]);

  /* ------------------------------------------------------------------------ */
  /* Derived                                                                  */
  /* ------------------------------------------------------------------------ */

  const isEligible = Boolean(eligibility?.eligible);
  const alreadyFiled = Boolean(eligibility?.alreadyFiled);
  const hasBusinessActivity = Boolean(eligibility?.hasBusinessActivity);

  const isRateLimited =
    errorCode === "RATE_LIMITED" ||
    (rateLimitRetryAfter && rateLimitRetryAfter > 0);

  const panValid = isValidPan(pan) && String(pan || "").toUpperCase()[3] === "P";

  const canSendOtp =
    isEligible &&
    !alreadyFiled &&
    declaration &&
    panValid &&
    !checking &&
    !sendingOtp &&
    !filing &&
    !isRateLimited;

  const canFile =
    String(otpInput || "").trim().length >= 4 &&
    !filing &&
    !sendingOtp &&
    !isRateLimited;

  const currentIstPeriod = getCurrentIstPeriod();
  const isCurrentPeriodSelected = period === currentIstPeriod;

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
      aria-labelledby="nil-return-title"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-xl max-h-[90vh] bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-surface-border animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between bg-gradient-to-r from-brand-700 via-brand-600 to-teal-700 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white">
              <Zap className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h2
                id="nil-return-title"
                className="text-base font-bold text-white flex items-center gap-2"
              >
                <span>File Nil GST Return</span>

                {step === STEPS.OTP && (
                  <Badge
                    variant="warning"
                    size="sm"
                    className="bg-amber-400 text-slate-900 font-bold"
                  >
                    STEP 2: EVC OTP
                  </Badge>
                )}

                {step === STEPS.FILING && (
                  <Badge
                    variant="info"
                    size="sm"
                    className="bg-blue-400 text-white font-bold"
                  >
                    FILING...
                  </Badge>
                )}

                {step === STEPS.PENDING && (
                  <Badge
                    variant="warning"
                    size="sm"
                    className="bg-amber-400 text-slate-900 font-bold"
                  >
                    PENDING
                  </Badge>
                )}

                {step === STEPS.FAILED && (
                  <Badge
                    variant="danger"
                    size="sm"
                    className="bg-rose-500 text-white font-bold"
                  >
                    FAILED
                  </Badge>
                )}
              </h2>
              <span className="text-[11px] text-white/80">
                Under Rule 67A of CGST Rules, 2017
              </span>
            </div>
          </div>

          <button
            type="button"
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition cursor-pointer disabled:opacity-50"
            aria-label="Close modal"
            onClick={handleClose}
            disabled={filing || sendingOtp}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2"
              role="alert"
              aria-live="polite"
            >
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
                  <div className="mt-1 text-[10px] text-amber-700 font-mono">
                    Retry after: {rateLimitRetryAfter}s
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={clearStructuredError}
                className="text-rose-500 hover:text-rose-700 font-bold"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {/* SUCCESS */}
          {step === STEPS.SUCCESS && filingResult ? (
            <div className="text-center py-4 space-y-4" role="status" aria-live="polite">
              <div className="w-16 h-16 rounded-2xl bg-success-50 border border-success-200 text-success-600 flex items-center justify-center mx-auto shadow-xs animate-in zoom-in-75 duration-200">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  Nil Return Filed Successfully!
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Your Nil{" "}
                  <strong>{filingResult.type || returnType}</strong> return for{" "}
                  <strong>{formatPeriod(filingResult.period || period)}</strong>{" "}
                  has been formally registered on the GST system.
                </p>
              </div>

              {filingResult.localRecordSaved === false && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2" role="alert">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Local record sync failed:</strong> Nil return is filed on GST portal with ARN {filingResult.arn}, but local filing record could not be saved. Please contact support before retrying.
                  </div>
                </div>
              )}

              {filingResult.portalConfirmation && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-left text-[11px] text-slate-600">
                  <div className="font-semibold text-slate-800 mb-1">
                    Portal Nil Confirmation
                  </div>
                  <div>
                    Status:{" "}
                    <strong>
                      {filingResult.portalConfirmation.confirmed
                        ? "Confirmed by GSTN summary"
                        : filingResult.portalConfirmation.skipped
                          ? "Skipped by configuration"
                          : filingResult.portalConfirmation.recoveredFromPortal
                            ? "Recovered from portal filed status"
                            : "Not confirmed"}
                    </strong>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-xl border border-surface-border bg-slate-50 text-left space-y-3">
                <div className="flex items-center justify-between border-b border-surface-border pb-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Official Acknowledgement
                  </span>
                  <Badge variant="success" size="sm">
                    ● Status: FILED
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      Application Reference # (ARN):
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <strong className="font-mono text-sm text-brand-700">
                        {filingResult.arn}
                      </strong>
                      <button
                        type="button"
                        onClick={handleCopyArn}
                        className="p-1 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                        title="Copy ARN"
                        aria-label={copied ? "ARN copied" : "Copy ARN"}
                      >
                        {copied ? (
                          <Check className="w-3.5 h-3.5 text-success-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      Filing Date:
                    </span>
                    <strong className="text-slate-800">
                      {filingResult.filingDate ||
                        filingResult.dateStr ||
                        new Date().toLocaleDateString("en-IN")}
                    </strong>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      Return Form:
                    </span>
                    <strong className="text-slate-800">
                      Nil {filingResult.type || returnType}
                    </strong>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      Verification Mode:
                    </span>
                    <strong className="text-slate-800 font-semibold text-brand-700">
                      {filingResult.mode || filingResult.filingMode || "NIL_EVC"}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                <Button
                  variant="fintech"
                  onClick={() => setShowCert(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Award className="w-4 h-4 mr-1.5 text-amber-300" />
                  <span>View & Print Certificate</span>
                </Button>

                <a
                  href="https://www.gst.gov.in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View on GST Portal
                </a>

                <Button
                  variant="primary"
                  onClick={() => {
                    handleClose();
                    navigate("/returns/filing-history");
                  }}
                >
                  View in Filing History →
                </Button>
              </div>
            </div>
          ) : step === STEPS.FILING ? (
            /* FILING IN PROGRESS */
            <div className="text-center py-8 space-y-4" role="status" aria-live="polite">
              <div className="w-16 h-16 mx-auto rounded-full bg-indigo-100 border border-indigo-300 text-indigo-700 flex items-center justify-center">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-600" />
              </div>

              <div>
                <h4 className="text-lg font-bold text-slate-900 tracking-tight">
                  Filing Nil Return with GSTN...
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Please do not close this window. This may take up to 120 seconds.
                </p>
              </div>

              <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                <Lock className="w-3.5 h-3.5" />
                <span>Verifying EVC and submitting to government portal</span>
              </div>
            </div>
          ) : step === STEPS.PENDING ? (
            /* PENDING */
            <div className="text-center py-6 space-y-4" role="status">
              <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 border border-amber-300 text-amber-700 flex items-center justify-center">
                <Clock className="w-8 h-8 text-amber-600 animate-pulse" />
              </div>

              <div>
                <Badge variant="warning" size="sm" className="mb-2">
                  FILING STATUS PENDING
                </Badge>
                <h4 className="text-lg font-bold text-slate-900 tracking-tight">
                  Checking Nil Filing Status...
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  {filingResult?.message ||
                    error ||
                    "GST portal did not confirm the nil filing immediately. We are checking whether your return was filed successfully."}
                </p>
                <p className="text-[11px] text-amber-700 mt-2 font-semibold">
                  Do not file again immediately. Duplicate filing risk exists.
                </p>
              </div>

              {filing && (
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
                  disabled={filing}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Check Status
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    handleClose();
                    navigate("/returns/filing-history");
                  }}
                  className="py-2 px-3 text-xs font-semibold rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition"
                >
                  Filing History →
                </button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClose}
                  disabled={filing}
                >
                  Close
                </Button>
              </div>
            </div>
          ) : step === STEPS.FAILED ? (
            /* FAILED */
            <div className="text-center py-6 space-y-4" role="alert">
              <div className="w-16 h-16 mx-auto rounded-full bg-rose-100 border border-rose-300 text-rose-700 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-rose-600" />
              </div>

              <div>
                <h4 className="text-lg font-bold text-slate-900 tracking-tight">
                  Nil Filing Failed
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  {error || "An error occurred while filing your nil return."}
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
                  disabled={filing || isRateLimited}
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
            </div>
          ) : step === STEPS.OTP ? (
            /* EVC OTP VERIFICATION STEP */
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-xl bg-indigo-50/90 border border-indigo-200 text-indigo-950 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5">
                  <Smartphone className="w-5 h-5" />
                </div>

                <div className="space-y-1 text-xs">
                  <strong className="block text-sm font-semibold text-indigo-900">
                    Enter Electronic Verification Code (EVC)
                  </strong>
                  <p className="text-slate-600 leading-relaxed">
                    {otpMessage ||
                      `GST Portal has dispatched an EVC code to the mobile & email registered with PAN: ${pan}`}
                  </p>
                  <div className="text-[11px] font-mono text-indigo-700 pt-0.5">
                    Return: <strong>Nil {returnType}</strong> • Period:{" "}
                    <strong>{formatPeriod(period)}</strong> • PAN:{" "}
                    <strong>{pan}</strong>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-2xl border border-surface-border bg-slate-50/50 space-y-4">
                <div>
                  <label
                    htmlFor="otp-input"
                    className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5"
                  >
                    <Lock className="w-3.5 h-3.5 text-brand-600" />
                    <span>Mobile EVC code</span>
                  </label>

                  <input
                    id="otp-input"
                    ref={otpInputRef}
                    type="text"
                    maxLength={8}
                    value={otpInput}
                    onChange={(e) =>
                      setOtpInput(
                        e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
                      )
                    }
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    pattern="[A-Za-z0-9]{4,8}"
                    title="Enter 4 to 8 letters or digits"
                    placeholder="Enter code"
                    className="w-full text-center tracking-[0.5em] font-mono text-2xl font-bold px-4 py-3 rounded-xl border border-surface-border bg-white text-slate-900 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 shadow-xs disabled:opacity-50"
                    disabled={filing}
                    aria-label="Enter EVC OTP code"
                  />

                  <p className="text-[11px] text-slate-500 mt-1.5 text-center">
                    Enter the 4 to 8 character code received from GSTN
                  </p>
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-surface-border">
                  <button
                    type="button"
                    onClick={() => {
                      setStep(STEPS.FORM);
                      setOtpInput("");
                      clearStructuredError();
                      nilKeyRef.current = null;
                    }}
                    className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-xs cursor-pointer disabled:opacity-50"
                    disabled={filing}
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Details</span>
                  </button>

                  <div className="flex items-center gap-2">
                    {timer > 0 ? (
                      <span className="text-[11px] text-slate-400">
                        Resend OTP in <strong>{timer}s</strong>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSendEvcOtp}
                        disabled={sendingOtp || filing || isRateLimited}
                        className="text-brand-600 hover:text-brand-700 font-semibold text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${sendingOtp ? "animate-spin" : ""}`}
                        />
                        <span>Resend OTP</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* FORM CONTROLS (ELIGIBILITY & SELECTION) */
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="return-type"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Return Type
                  </label>
                  <select
                    id="return-type"
                    value={returnType}
                    onChange={(e) => setReturnType(normalizeReturnType(e.target.value))}
                    className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-surface-border bg-white text-slate-800 focus:outline-none focus:border-brand-500 disabled:opacity-50"
                    disabled={checking || filing || sendingOtp}
                    aria-label="Select return type"
                  >
                    <option value="GSTR1">GSTR-1 (Outward Supplies)</option>
                    <option value="GSTR3B">GSTR-3B (Summary Return)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="tax-period"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Tax Period
                  </label>
                  <select
                    id="tax-period"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-surface-border bg-white text-slate-800 focus:outline-none focus:border-brand-500 font-mono disabled:opacity-50"
                    disabled={checking || filing || sendingOtp}
                    aria-label="Select tax period"
                  >
                    {availablePeriods.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.label} ({p.code})
                      </option>
                    ))}
                  </select>

                  {isCurrentPeriodSelected && (
                    <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div>
                        Current tax period is not closed. Nil filing for an ongoing month may be premature if transactions can still occur in the same period.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {checking ? (
                <div className="py-6 text-center">
                  <Loader message="Verifying CGST Rule 67A eligibility requirements..." />
                </div>
              ) : eligibility ? (
                <div
                  className={`p-4 rounded-xl border ${alreadyFiled
                      ? "bg-slate-50 border-slate-200 text-slate-900"
                      : hasBusinessActivity
                        ? "bg-amber-50/90 border-amber-300 text-amber-950"
                        : isEligible
                          ? "bg-success-50/70 border-success-200 text-success-950"
                          : "bg-red-50/80 border-red-200 text-red-950"
                    }`}
                  role="alert"
                >
                  <div className="flex items-start gap-2.5 text-xs">
                    {alreadyFiled ? (
                      <CheckCircle2 className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
                    ) : hasBusinessActivity ? (
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    ) : isEligible ? (
                      <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    )}

                    <div className="space-y-1 w-full">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="block font-semibold">
                          {alreadyFiled
                            ? `Already Filed: Nil ${returnType} for ${formatPeriod(period)}`
                            : hasBusinessActivity
                              ? `⚠️ Business Activity Detected for ${returnType}`
                              : isEligible
                                ? `Eligible to file Nil ${returnType} for ${formatPeriod(period)}`
                                : `Not Eligible for Nil Return (${returnType})`}
                        </strong>

                        {!alreadyFiled && Number(eligibility.totalTaxableSales || 0) > 0 && (
                          <span className="font-mono font-bold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded text-[11px]">
                            Sales: {formatCurrency(eligibility.totalTaxableSales)}
                          </span>
                        )}
                      </div>

                      {alreadyFiled && (
                        <div className="text-[11px] text-slate-600 space-y-1">
                          <div>
                            ARN:{" "}
                            <strong className="font-mono text-slate-900">
                              {eligibility.arn || "n/a"}
                            </strong>
                          </div>
                          {eligibility.dateStr && (
                            <div>
                              Filed on: <strong>{eligibility.dateStr}</strong>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              handleClose();
                              navigate("/returns/filing-history");
                            }}
                            className="text-brand-600 hover:text-brand-700 font-semibold underline cursor-pointer"
                          >
                            View in Filing History →
                          </button>
                        </div>
                      )}

                      {!alreadyFiled && (
                        <p className="text-[11px] opacity-90 leading-relaxed">
                          {hasBusinessActivity
                            ? eligibility.warnings && eligibility.warnings.length > 0
                              ? eligibility.warnings.join(" ")
                              : `You have ${eligibility.activeInvoicesCount || 0} active sales document(s) and/or ${eligibility.activeBillsCount || 0} purchase bill(s) recorded in this period.`
                            : eligibility.message ||
                            (isEligible
                              ? "No outward supplies, inward supplies, or tax liabilities are recorded for this tax period."
                              : "Transactions exist in this period that require standard filing.")}
                        </p>
                      )}

                      {!alreadyFiled && !hasBusinessActivity && isEligible && (
                        <div className="mt-2 p-2 rounded-lg bg-white/70 border border-success-200 text-success-900 text-[11px] leading-relaxed">
                          <strong>Statutory safety note:</strong> Local eligibility is only a pre-check. Final nil filing requires GSTN portal nil confirmation (`isnil: "Y"`) where configured.
                        </div>
                      )}

                      {hasBusinessActivity && (
                        <div className="mt-2 p-2 rounded-lg bg-amber-100/70 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
                          <strong>CGST Rule 67A Compliance Notice:</strong>{" "}
                          Nil Return is legally valid ONLY when you have zero
                          outward taxable sales, no RCM liability, and no ITC to
                          claim. If these bills are actual customer sales, you
                          should close this modal and file regular{" "}
                          <strong>{returnType}</strong> instead of Nil.
                        </div>
                      )}

                      {eligibility.warnings && eligibility.warnings.length > 0 && !hasBusinessActivity && (
                        <ul className="mt-2 space-y-1 text-[11px] text-slate-600 list-disc pl-4">
                          {eligibility.warnings.slice(0, 5).map((w, idx) => (
                            <li key={idx}>{w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200/80 flex items-start gap-3">
                <MessageSquare className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                <div className="flex-1 text-xs">
                  <div className="font-semibold text-indigo-950 flex items-center justify-between">
                    <span>CGST Rule 67A: Instant Free SMS Filing (₹0 API Cost)</span>
                    <button
                      type="button"
                      onClick={handleCopySms}
                      className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1 cursor-pointer"
                      aria-label="Copy SMS text"
                    >
                      {smsCopied ? "Copied ✓" : "Copy SMS"}
                    </button>
                  </div>
                  <p className="text-slate-600 mt-1 text-[11px] leading-relaxed">
                    Send free SMS to{" "}
                    <strong className="text-indigo-900 font-mono">14409</strong>{" "}
                    from your registered mobile:
                    <span className="block mt-1 font-mono font-bold text-indigo-700 bg-white px-2 py-1 rounded border border-indigo-200">
                      NIL {returnType === "GSTR1" ? "R1" : "3B"} {activeGstin}{" "}
                      {period}
                    </span>
                  </p>
                </div>
              </div>

              {isEligible && !alreadyFiled && !checking && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-surface-border space-y-3">
                  <div className="flex items-start gap-2.5 text-xs">
                    <input
                      type="checkbox"
                      id="nilDeclaration"
                      checked={declaration}
                      onChange={(e) => setDeclaration(e.target.checked)}
                      className="mt-0.5 rounded border-surface-border text-brand-600 focus:ring-brand-500 cursor-pointer"
                      disabled={filing || sendingOtp}
                      aria-describedby="declaration-text"
                    />
                    <label
                      id="declaration-text"
                      htmlFor="nilDeclaration"
                      className="text-[11px] text-slate-600 leading-snug cursor-pointer select-none"
                    >
                      I solemnly affirm and declare that I have not made any
                      outward supply of goods or services, have no tax
                      liability, and have not received any supplies on which tax
                      is payable during this tax period under{" "}
                      <strong>Rule 67A of CGST Rules, 2017</strong>.
                    </label>
                  </div>

                  <div className="pt-2 border-t border-surface-border flex items-center justify-between text-xs">
                    <span className="text-slate-500 text-[11px]">
                      Verification Mode:
                    </span>
                    <span className="font-semibold text-slate-800">
                      EVC required
                    </span>
                  </div>

                  <div className="pt-2 border-t border-surface-border space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <label
                          htmlFor="pan-input"
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          Authorized Signatory PAN
                        </label>
                        <span className="text-[10px] text-slate-400">
                          Enter registered Director / Signatory PAN (4th letter 'P')
                        </span>
                      </div>
                      <input
                        id="pan-input"
                        ref={panInputRef}
                        type="text"
                        maxLength={10}
                        value={pan}
                        onChange={(e) =>
                          setPan(
                            e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                          )
                        }
                        placeholder="ABCDE1234F"
                        className="w-36 text-center font-mono font-bold text-xs uppercase px-2.5 py-1.5 rounded-lg border border-surface-border bg-white text-slate-900 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
                        disabled={filing || sendingOtp}
                        autoComplete="off"
                        aria-label="Enter authorized signatory PAN"
                      />
                    </div>

                    {pan.length === 10 && pan[3] !== "P" && (
                      <div
                        className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px]"
                        role="alert"
                      >
                        ⚠️{" "}
                        <strong>Entity PAN detected:</strong> 4th letter is "
                        {pan[3]}". For Companies and LLPs, GST Portal requires
                        the personal PAN of the registered Director/Signatory
                        (where the 4th letter is 'P').
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        {(step === STEPS.FORM || step === STEPS.OTP) && (
          <div className="px-6 py-3.5 border-t border-surface-border bg-slate-50 flex items-center justify-between shrink-0">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-brand-600" />
              <span>CGST Rule 67A Compliant</span>
            </span>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadNilInfo}
                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                title="Download safe nil filing info/checklist. This is not a GSTN portal-ready JSON."
                disabled={filing || sendingOtp}
                aria-label="Download Nil filing info"
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                Download Info
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleClose}
                disabled={filing || sendingOtp}
              >
                Cancel
              </Button>

              {step === STEPS.OTP ? (
                <Button
                  variant="fintech"
                  size="sm"
                  onClick={handleVerifyOtpAndFile}
                  disabled={!canFile}
                  aria-label="Verify OTP and file Nil return"
                >
                  <Lock className="w-3.5 h-3.5 mr-1" />
                  <span>
                    {filing
                      ? "Submitting to Portal..."
                      : `Verify OTP & File Nil ${returnType}`}
                  </span>
                </Button>
              ) : (
                <Button
                  variant="fintech"
                  size="sm"
                  onClick={handleSendEvcOtp}
                  disabled={!canSendOtp}
                  aria-label="Send EVC OTP to mobile"
                >
                  <Smartphone className="w-3.5 h-3.5 mr-1" />
                  <span>
                    {sendingOtp
                      ? "Sending OTP to Mobile..."
                      : "Send EVC OTP to Mobile →"}
                  </span>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Certificate Modal */}
      {showCert && filingResult && (
        <FilingCertificateModal
          isOpen={showCert}
          onClose={() => setShowCert(false)}
          filing={{
            ...filingResult,
            type: filingResult.type || returnType,
            period: filingResult.period || period,
            isNil: true
          }}
          workspace={{
            name: user?.workspaceName || user?.currentWorkspace?.name,
            gstin: activeGstin || user?.gstin
          }}
        />
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}