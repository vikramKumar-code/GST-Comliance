import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import useFocusTrap from "../hooks/useFocusTrap";
import { useAuth } from "../context/AuthContext";
import { checkNilEligibility, fileNilReturn } from "../api/returns.api";
import { requestEvcOtp } from "../api/auth.api";
import { formatCurrency, formatPeriod } from "../utils/format";
import { isValidEvcOtp, isValidPan } from "../utils/validators";
import Loader from "./Loader";
import ErrorMessage from "./ErrorMessage";
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
  ExternalLink
} from "lucide-react";
import Button from "./ui/Button";
import Badge from "./ui/Badge";
import FilingCertificateModal from "./FilingCertificateModal";

const STEPS = {
  FORM: "FORM",
  CONFIRM: "CONFIRM",
  OTP: "OTP",
  FILING: "FILING",
  SUCCESS: "SUCCESS"
};

export default function NilReturnModal({
  isOpen,
  onClose,
  initialPeriod,
  initialType = "GSTR1",
  onSuccess,
  gstin,
  username,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [returnType, setReturnType] = useState(() => (initialType ? initialType.toUpperCase() : "GSTR1"));
  const [prevInitType, setPrevInitType] = useState(initialType);
  if (initialType !== prevInitType) {
    setPrevInitType(initialType);
    if (initialType) setReturnType(initialType.toUpperCase());
  }

  // Dynamic available open tax periods (past 24 months)
  const availablePeriods = useMemo(() => {
    const list = [];
    const now = new Date();
    for (let offset = 1; offset <= 24; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const y = d.getFullYear();
      const code = `${m}${y}`;
      const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      list.push({ code, label });
    }
    if (initialPeriod && !list.some((p) => p.code === initialPeriod)) {
      list.unshift({ code: initialPeriod, label: initialPeriod });
    }
    return list;
  }, [initialPeriod]);

  const [period, setPeriod] = useState(() => initialPeriod || availablePeriods[0]?.code || "022025");
  const [prevInitPeriod, setPrevInitPeriod] = useState(initialPeriod);
  if (initialPeriod !== prevInitPeriod) {
    setPrevInitPeriod(initialPeriod);
    if (initialPeriod) setPeriod(initialPeriod);
  }

  const [checking, setChecking] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(STEPS.FORM);
  const [declaration, setDeclaration] = useState(false);

  const activeGstin = gstin || user?.gstin || "";
  const activeUsername = username || user?.portalUsername || "";

  const getInitialPan = (gstinVal) => {
    if (gstinVal && gstinVal.length >= 12) {
      const extractedPan = gstinVal.slice(2, 12).toUpperCase();
      if (extractedPan[3] === 'P') return extractedPan;
      if (typeof window !== 'undefined') {
        return localStorage.getItem(`signatory_pan_${gstinVal}`) || localStorage.getItem('last_signatory_pan') || '';
      }
    }
    return '';
  };

  const [pan, setPan] = useState(() => getInitialPan(activeGstin));
  const [prevActiveGstin, setPrevActiveGstin] = useState(activeGstin);
  if (activeGstin !== prevActiveGstin) {
    setPrevActiveGstin(activeGstin);
    setPan(getInitialPan(activeGstin));
  }
  const [otpInput, setOtpInput] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpMessage, setOtpMessage] = useState(null);
  const [timer, setTimer] = useState(0);

  const [filing, setFiling] = useState(false);
  const [filingResult, setFilingResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [smsCopied, setSmsCopied] = useState(false);
  const [showCert, setShowCert] = useState(false);

  // Refs for focus management
  const otpInputRef = useRef(null);
  const panInputRef = useRef(null);
  const modalRef = useFocusTrap(isOpen && !filing && !sendingOtp, () => handleClose());

  // Auto-focus based on step
  useEffect(() => {
    if (!isOpen) return;

    if (step === STEPS.FORM && panInputRef.current && eligibility?.eligible) {
      panInputRef.current.focus();
    } else if (step === STEPS.OTP && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [isOpen, step, eligibility]);

  // Timer with visibility API
  useEffect(() => {
    if (timer <= 0) return;

    const interval = setInterval(() => {
      if (!document.hidden) {
        setTimer((t) => Math.max(0, t - 1));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timer]);

  const checkEligibility = useCallback(async (p, t) => {
    if (!p) return;
    setChecking(true);
    setError(null);
    setFilingResult(null);
    try {
      const res = await checkNilEligibility(p, t, activeGstin);
      setEligibility(res);
      if (res?.gstin && res.gstin.length >= 12) {
        const extractedPan = res.gstin.slice(2, 12).toUpperCase();
        if (extractedPan[3] === 'P') {
          setPan(extractedPan);
        }
      }
    } catch (err) {
      setError(err?.message || err?.error || 'Failed to check eligibility');
      setEligibility(null);
    } finally {
      setChecking(false);
    }
  }, [activeGstin]);

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

  if (!isOpen) return null;

  function handleClose() {
    if (filing || sendingOtp) {
      if (!window.confirm('Filing is in progress. Are you sure you want to close? This might not cancel the filing.')) {
        return;
      }
    }
    setEligibility(null);
    setError(null);
    setFilingResult(null);
    setDeclaration(false);
    setStep(STEPS.FORM);
    setOtpInput("");
    setOtpMessage(null);
    onClose();
  };

  const handleSendEvcOtp = async () => {
    const cleanPan = pan.trim().toUpperCase();

    if (!isValidPan(cleanPan)) {
      setError("Please enter a valid 10-character PAN (e.g., AABCP1234F).");
      return;
    }

    if (cleanPan[3] !== 'P') {
      setError("For company/LLP GSTINs, use the personal PAN of the designated Director/Partner (4th letter must be 'P').");
      return;
    }

    if (!declaration) {
      setError("You must accept the CGST Rule 67A statutory declaration before proceeding.");
      return;
    }

    setSendingOtp(true);
    setError(null);

    try {
      const formType = returnType === "GSTR1" ? "R1" : "R3B";
      const res = await requestEvcOtp({
        gstin: activeGstin,
        pan: cleanPan,
        form_type: formType,
        period,
        username: activeUsername,
      });

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(`signatory_pan_${activeGstin}`, cleanPan);
          localStorage.setItem("last_signatory_pan", cleanPan);
        } catch {
          console.warn("Could not save PAN preference in browser storage.");
        }
      }

      setOtpMessage(
        res?.message ||
        `EVC OTP sent successfully to mobile/email registered with PAN ${cleanPan}.`
      );
      setStep(STEPS.OTP);
      setTimer(30);
    } catch (err) {
      setError(err?.message || err?.error || 'Failed to send EVC OTP');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtpAndFile = async () => {
    const cleanOtp = otpInput.trim();

    if (!isValidEvcOtp(cleanOtp)) {
      setError("Enter the 4 to 8 character EVC code received on your mobile/email.");
      return;
    }

    setStep(STEPS.FILING);
    setFiling(true);
    setError(null);

    try {
      const res = await fileNilReturn({
        gstin: activeGstin,
        period,
        returnType,
        declarationAccepted: true,
        verificationMode: "EVC",
        otp: cleanOtp,
        pan: pan.trim().toUpperCase(),
        username: activeUsername,
      });

      if (!res?.arn) {
        throw new Error("The filing service did not return an official ARN. Filing status could not be confirmed.");
      }

      setFilingResult(res);
      setStep(STEPS.SUCCESS);

      if (typeof onSuccess === "function") {
        onSuccess(res);
      }
    } catch (err) {
      setStep(STEPS.OTP);
      setError(err?.message || err?.error || 'Failed to file Nil return');
    } finally {
      setFiling(false);
    }
  };

  const handleCopyArn = async () => {
    if (!filingResult?.arn) return;

    try {
      await navigator.clipboard.writeText(filingResult.arn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
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

  const handleDownloadNilJson = () => {
    let nilPayload;
    if (returnType === "GSTR1") {
      nilPayload = {
        gstin: activeGstin,
        fp: period,
        gt: 0,
        cur_gt: 0,
        version: "GSTR1_3.0.4",
        hash: "hash",
        b2b: [],
        b2cl: [],
        b2cs: [],
        exp: [],
        nil: {
          inv: [
            {
              sply_ty: "INTRAB2B",
              nil_amt: 0,
              expt_amt: 0,
              ngsup_amt: 0
            }
          ]
        },
        hsn: { hsn_b2b: [], hsn_b2c: [] },
        doc_issue: { doc_det: [] }
      };
    } else {
      nilPayload = {
        gstin: activeGstin,
        ret_period: period,
        inward_sup: { isup_details: [] },
        sup_details: {
          osup_det: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
          osup_zero: { txval: 0 },
          osup_nil_exmp: { txval: 0 },
          isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
          osup_nongst: { txval: 0 }
        },
        itc_elg: { itc_avl: [] }
      };
    }

    const jsonString = JSON.stringify(nilPayload, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${returnType}_${activeGstin}_${period}_NIL_PortalReady.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isEligible = Boolean(eligibility?.eligible);

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
              <h2 id="nil-return-title" className="text-base font-bold text-white flex items-center gap-2">
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
            <ErrorMessage
              error={typeof error === 'string' ? { message: error } : error}
              onRetry={() => checkEligibility(period, returnType)}
            />
          )}

          {/* SUCCESS SCREEN */}
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
                  Your Nil <strong>{filingResult.type}</strong> return for{" "}
                  <strong>{formatPeriod(filingResult.period)}</strong> has been
                  formally registered on the GST system.
                </p>
              </div>

              {/* Digital Acknowledgement Certificate Card */}
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
                      Filing Date & Time:
                    </span>
                    <strong className="text-slate-800">
                      {filingResult.filingDate || "Not provided"}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      Return Form:
                    </span>
                    <strong className="text-slate-800">
                      {filingResult.type}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      Verification Mode:
                    </span>
                    <strong className="text-slate-800 font-semibold text-brand-700">
                      {filingResult.filingMode || "Aadhaar EVC"}
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
                  Please do not close this window. This may take up to 30 seconds.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                <Lock className="w-3.5 h-3.5" />
                <span>Verifying EVC and submitting to government portal</span>
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

              {/* OTP Input Form Box */}
              <div className="p-5 rounded-2xl border border-surface-border bg-slate-50/50 space-y-4">
                <div>
                  <label htmlFor="otp-input" className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
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
                      setOtpInput(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
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

                {/* Resend Timer */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-surface-border">
                  <button
                    type="button"
                    onClick={() => {
                      setStep(STEPS.FORM);
                      setOtpInput("");
                      setError(null);
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
                        disabled={sendingOtp || filing}
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
              {/* Form Controls: Return Type & Period */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="return-type" className="block text-xs font-semibold text-slate-700 mb-1">
                    Return Type
                  </label>
                  <select
                    id="return-type"
                    value={returnType}
                    onChange={(e) => setReturnType(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-surface-border bg-white text-slate-800 focus:outline-none focus:border-brand-500 disabled:opacity-50"
                    disabled={checking || filing}
                    aria-label="Select return type"
                  >
                    <option value="GSTR1">GSTR-1 (Outward Supplies)</option>
                    <option value="GSTR3B">GSTR-3B (Summary Return)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="tax-period" className="block text-xs font-semibold text-slate-700 mb-1">
                    Tax Period
                  </label>
                  <select
                    id="tax-period"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-surface-border bg-white text-slate-800 focus:outline-none focus:border-brand-500 font-mono disabled:opacity-50"
                    disabled={checking || filing}
                    aria-label="Select tax period"
                  >
                    {availablePeriods.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.label} ({p.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Eligibility Check Result */}
              {checking ? (
                <div className="py-6 text-center">
                  <Loader message="Verifying CGST Rule 67A eligibility requirements..." />
                </div>
              ) : (
                eligibility && (
                  <div
                    className={`p-4 rounded-xl border ${eligibility.hasBusinessActivity
                        ? "bg-amber-50/90 border-amber-300 text-amber-950"
                        : isEligible
                          ? "bg-success-50/70 border-success-200 text-success-950"
                          : "bg-red-50/80 border-red-200 text-red-950"
                      }`}
                    role="alert"
                  >
                    <div className="flex items-start gap-2.5 text-xs">
                      {eligibility.hasBusinessActivity ? (
                        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      ) : isEligible ? (
                        <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1 w-full">
                        <div className="flex items-center justify-between gap-2">
                          <strong className="block font-semibold">
                            {eligibility.hasBusinessActivity
                              ? `⚠️ Active Invoices Detected (${eligibility.activeInvoicesCount} Invoices)`
                              : isEligible
                                ? `Eligible to file Nil ${returnType} for ${formatPeriod(period)}`
                                : `Not Eligible for Nil Return (${returnType})`}
                          </strong>
                          {eligibility.totalTaxableSales > 0 && (
                            <span className="font-mono font-bold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded text-[11px]">
                              Sales: {formatCurrency(eligibility.totalTaxableSales)}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] opacity-90 leading-relaxed">
                          {eligibility.hasBusinessActivity
                            ? eligibility.warnings && eligibility.warnings.length > 0
                              ? eligibility.warnings.join(" ")
                              : `You have ${eligibility.activeInvoicesCount} active sales invoice(s) recorded in this period.`
                            : eligibility.message ||
                            (isEligible
                              ? "No outward supplies, inward supplies, or tax liabilities are recorded for this tax period."
                              : "Transactions exist in this period that require standard filing.")}
                        </p>
                        {eligibility.hasBusinessActivity && (
                          <div className="mt-2 p-2 rounded-lg bg-amber-100/70 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
                            <strong>CGST Rule 67A Compliance Notice:</strong>{" "}
                            Nil Return is legally valid ONLY when you have zero
                            outward taxable sales. If these bills are actual
                            customer sales, you should close this modal and file
                            regular <strong>GSTR-1</strong> instead of Nil.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              )}

              {/* CGST Rule 67A Free SMS Filing Info */}
              <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200/80 flex items-start gap-3">
                <MessageSquare className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                <div className="flex-1 text-xs">
                  <div className="font-semibold text-indigo-950 flex items-center justify-between">
                    <span>CGST Rule 67A: Instant Free SMS Filing (₹0 API Cost)</span>
                    <button
                      type="button"
                      onClick={() => {
                        const smsText = `NIL ${returnType === 'GSTR1' ? 'R1' : '3B'} ${activeGstin} ${period}`;
                        try {
                          navigator.clipboard?.writeText(smsText);
                          setSmsCopied(true);
                          setTimeout(() => setSmsCopied(false), 2000);
                        } catch {
                          // Fallback
                          const textArea = document.createElement('textarea');
                          textArea.value = smsText;
                          document.body.appendChild(textArea);
                          textArea.select();
                          document.execCommand('copy');
                          document.body.removeChild(textArea);
                          setSmsCopied(true);
                          setTimeout(() => setSmsCopied(false), 2000);
                        }
                      }}
                      className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1 cursor-pointer"
                      aria-label="Copy SMS text"
                    >
                      {smsCopied ? 'Copied ✓' : 'Copy SMS'}
                    </button>
                  </div>
                  <p className="text-slate-600 mt-1 text-[11px] leading-relaxed">
                    Send free SMS to <strong className="text-indigo-900 font-mono">14409</strong> from your registered mobile:
                    <span className="block mt-1 font-mono font-bold text-indigo-700 bg-white px-2 py-1 rounded border border-indigo-200">
                      NIL {returnType === 'GSTR1' ? 'R1' : '3B'} {activeGstin} {period}
                    </span>
                  </p>
                </div>
              </div>

              {/* Statutory Declaration & PAN */}
              {isEligible && !checking && (
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
                    <span className="font-semibold text-slate-800">EVC required</span>
                  </div>

                  <div className="pt-2 border-t border-surface-border space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <label htmlFor="pan-input" className="block text-[11px] font-semibold text-slate-700">
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
                        onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                        placeholder="ABCDE1234F"
                        className="w-36 text-center font-mono font-bold text-xs uppercase px-2.5 py-1.5 rounded-lg border border-surface-border bg-white text-slate-900 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
                        disabled={filing || sendingOtp}
                        autoComplete="off"
                        aria-label="Enter authorized signatory PAN"
                      />
                    </div>
                    {pan.length === 10 && pan[3] !== 'P' && (
                      <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px]" role="alert">
                        ⚠️ <strong>Entity PAN detected:</strong> 4th letter is '{pan[3]}'. For Companies and LLPs, GST Portal requires the personal PAN of the registered Director/Signatory (where the 4th letter is 'P').
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        {step !== STEPS.SUCCESS && step !== STEPS.FILING && (
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
                onClick={handleDownloadNilJson}
                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                title="Download official schema JSON to upload directly on gst.gov.in"
                disabled={filing || sendingOtp}
                aria-label="Download Nil JSON for offline filing"
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                Download Nil JSON
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
                  disabled={filing || otpInput.trim().length < 4}
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
                  disabled={!isEligible || !declaration || sendingOtp || checking || !pan || pan.length !== 10}
                  aria-label="Send EVC OTP to mobile"
                >
                  <Smartphone className="w-3.5 h-3.5 mr-1" />
                  <span>
                    {sendingOtp
                      ? "Sending OTP to Mobile..."
                      : `Send EVC OTP to Mobile →`}
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
          filing={filingResult}
          workspace={{
            name: user?.workspaceName || user?.currentWorkspace?.name,
            gstin: user?.gstin,
          }}
        />
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}