import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import useFocusTrap from '../hooks/useFocusTrap';
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
import { fileGstr1WithEvc, fileGstr3bWithEvc, saveGstr1, checkFilingStatus } from '../api/returns.api';
import { formatCurrency, formatPeriod } from '../utils/format';
import { isValidEvcOtp, isValidPan } from '../utils/validators';
import Button from './ui/Button';
import Badge from './ui/Badge';
import { Link } from 'react-router-dom';
import FilingCertificateModal from './FilingCertificateModal';

// ✅ Step constants for type safety
const STEPS = {
  FORM: 'FORM',
  OTP: 'OTP',
  FILING: 'FILING',
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'FAILED'
};

/**
 * GSTR-1/3B EVC Filing Modal
 * Statutory filing under CGST Rule 26(1) with 3-step verification
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
  requiresOffset = false
}) {
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
  const [successMsg, setSuccessMsg] = useState(null);
  const [filingResult, setFilingResult] = useState(null);
  const [timer, setTimer] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showCert, setShowCert] = useState(false);
  const [offsetDone, setOffsetDone] = useState(false);

  // Refs for focus management
  const otpInputRef = useRef(null);
  const panInputRef = useRef(null);
  const modalRef = useFocusTrap(isOpen && !loading, () => handleClose());

  // Auto-focus inputs based on step
  useEffect(() => {
    if (!isOpen) return;

    if (step === STEPS.FORM && panInputRef.current) {
      panInputRef.current.focus();
    } else if (step === STEPS.OTP && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [isOpen, step]);

  // ✅ Resend timer with visibility API
  useEffect(() => {
    if (timer <= 0) return;

    const interval = setInterval(() => {
      if (!document.hidden) {
        setTimer((t) => Math.max(0, t - 1));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timer]);

  if (!isOpen) return null;

  function handleClose() {
    if (step === STEPS.FILING || loading) {
      if (!window.confirm('Filing is in progress. Are you sure you want to close? This might not cancel the filing.')) {
        return;
      }
    }

    setStep(STEPS.FORM);
    setOtpInput('');
    setError(null);
    setErrorCode(null);
    setSuccessMsg(null);
    setFilingResult(null);
    setOffsetDone(false);
    onClose();
  };

  // ✅ Handle specific GSTN error codes
  const getErrorMessage = (err) => {
    const code = err?.code || err?.response?.data?.code;
    const message = err?.message || 'An error occurred';

    const errorMessages = {
      'OTP0001': 'Invalid GSTIN. Please verify your GSTIN on the GST portal.',
      'OTP0006': 'PAN does not match Authorized Signatory on GST portal. Please use personal PAN of Director/Partner.',
      'OTP0008': 'GST session expired. Please re-login to GST portal and try again.',
      'OTP0011': 'Session expired. Please generate new OTP.',
      'AUTH4033': 'GST session invalid. Please refresh and try again.',
      'RET11407': 'Auth token expired. Please re-verify OTP on GST Return Hub.',
      'RET13504': 'GST portal is busy. Please try again after a few minutes.',
      'RET13505': 'GST portal system failure. Please try again later.',
      'RETOFFSET_REQUIRED': 'Tax liability must be offset before filing. Please offset liability first.',
      'OTP_EXPIRED': 'OTP has expired. Please request a new OTP.',
      'INVALID_OTP': 'Invalid OTP. Please check the code and try again.',
      'MAX_OTP_ATTEMPTS': 'Maximum OTP attempts exceeded. Please try again after 30 minutes.',
      'NETWORK_ERROR': 'Network error. Please check your internet connection.',
      'SERVER_ERROR': 'Server temporarily unavailable. Please try again in a few moments.'
    };

    setErrorCode(code);
    return errorMessages[code] || message;
  };

  // STEP 1: Request EVC OTP
  const handleRequestOtp = async (e) => {
    e?.preventDefault();
    const cleanPan = pan.trim().toUpperCase();

    if (!isValidPan(cleanPan)) {
      setError('Please enter a valid 10-character PAN (e.g., AABCP1234F).');
      return;
    }

    if (cleanPan[3] !== 'P') {
      const panType = cleanPan[3];
      const panTypes = {
        'C': 'Company', 'F': 'Firm/Partnership', 'H': 'HUF',
        'A': 'Association of Persons', 'T': 'Trust', 'B': 'Body of Individuals',
        'L': 'Local Authority', 'J': 'Artificial Juridical Person', 'G': 'Government'
      };

      if (panTypes[panType]) {
        setError(`Entity PAN detected (${panTypes[panType]}). For EVC filing, you must use the personal PAN of the Authorized Signatory (4th letter should be 'P' for Person). Please contact your company director/partner for their personal PAN.`);
        return;
      }
    }

    if (!declaration) {
      setError('You must accept the CGST statutory declaration before proceeding.');
      return;
    }

    if (returnType === 'GSTR3B' && requiresOffset && !offsetDone) {
      setError('GSTR-3B tax liability must be offset before filing. Please click "Offset Liability" first from the GSTR-3B hub.');
      return;
    }

    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      if (returnType === 'GSTR1') {
        const excludedArray = Array.isArray(excludedInvoiceIds)
          ? excludedInvoiceIds
          : Array.from(excludedInvoiceIds || []);
        await saveGstr1(period, excludedArray);
      }

      const formType = returnType === 'GSTR3B' ? 'R3B' : 'R1';
      const res = await requestEvcOtp({
        pan: cleanPan,
        form_type: formType,
        period,
        username
      });

      setSuccessMsg(res?.message || 'EVC OTP dispatched to registered Mobile / Email linked with PAN.');
      setStep(STEPS.OTP);
      setTimer(30);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // STEP 2: Verify OTP and File
  const handleVerifyAndFile = async (e) => {
    e?.preventDefault();
    const cleanOtp = otpInput.trim();

    if (!isValidEvcOtp(cleanOtp)) {
      setError('Enter the 4 to 8 character EVC code received on your mobile/email.');
      return;
    }

    setStep(STEPS.FILING);
    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      let res;
      const cleanPan = pan.trim().toUpperCase();
      const excludedArray = Array.isArray(excludedInvoiceIds)
        ? excludedInvoiceIds
        : Array.from(excludedInvoiceIds || []);

      if (returnType === 'GSTR3B') {
        res = await fileGstr3bWithEvc({
          period,
          otp: cleanOtp,
          pan: cleanPan,
          username
        });
      } else {
        res = await fileGstr1WithEvc({
          period,
          otp: cleanOtp,
          pan: cleanPan,
          excludedInvoiceIds: excludedArray,
          username
        });
      }

      if (res?.pendingVerification) {
        setStep(STEPS.PENDING);
        setFilingResult(res);
        setTimeout(() => handleCheckStatus(res), 5000);
        return;
      }

      if (!res?.arn) {
        throw new Error('The filing service did not return an official ARN. Filing status could not be confirmed.');
      }

      setFilingResult(res);
      setStep(STEPS.SUCCESS);

      if (typeof onSuccess === 'function') {
        onSuccess(res);
      }
    } catch (err) {
      setStep(STEPS.FAILED);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCheckStatus = async (result) => {
    try {
      setLoading(true);
      const status = await checkFilingStatus(result?.referenceId || result?.refId);

      if (status?.arn) {
        setFilingResult({ ...result, ...status });
        setStep(STEPS.SUCCESS);
        if (typeof onSuccess === 'function') {
          onSuccess({ ...result, ...status });
        }
      } else if (status?.status === 'FAILED') {
        setStep(STEPS.FAILED);
        setError('Filing failed on GST portal. ' + (status?.error || 'Please try again.'));
      } else {
        setTimeout(() => handleCheckStatus(result), 5000);
      }
    } catch (err) {
      setError('Could not verify filing status. Please check Filing History.');
      setStep(STEPS.FAILED);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyArn = async () => {
    if (!filingResult?.arn) return;

    try {
      await navigator.clipboard.writeText(filingResult.arn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
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
    setOtpInput('');
    setError(null);
    setErrorCode(null);
    handleRequestOtp();
  };

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
                  File {returnType === 'GSTR3B' ? 'GSTR-3B' : 'GSTR-1'} with EVC
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
                {returnType === 'GSTR1' && (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>Included Sales Invoices:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {summary.includedInvoices ?? 0} Invoices
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Taxable Turnover:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {summary.totalTaxable == null ? 'Not available' : formatCurrency(summary.totalTaxable)}
                  </span>
                </div>
                <div className="pt-2 border-t border-indigo-200/80 flex items-center justify-between text-xs">
                  <span className="font-bold text-indigo-950">Total Tax Liability:</span>
                  <span className="font-mono font-bold text-indigo-700 text-sm">
                    {summary.totalTax == null ? 'Not available' : formatCurrency(summary.totalTax)}
                  </span>
                </div>
              </div>

              {returnType === 'GSTR3B' && requiresOffset && !offsetDone && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Offset Required:</strong> GSTR-3B tax liability must be offset before filing. Please offset liability from the GSTR-3B hub first.
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
                      <strong>Entity PAN detected:</strong> 4th letter is '{pan[3]}'. For Companies and LLPs, GST Portal requires the personal PAN of the registered Director/Signatory (where the 4th letter is 'P').
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
                    <strong>Statutory Declaration:</strong> I hereby solemnly declare that the outward supplies and tax liability details declared in this {returnType} are true, complete and correct in accordance with CGST Rules. I understand that filing a false return is punishable under Section 132 of the CGST Act.
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
                disabled={loading || !declaration || !pan || pan.length !== 10}
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    <span>Requesting EVC from GSTN...</span>
                  </>
                ) : (
                  <>
                    <span>Send EVC OTP to Registered Mobile</span>
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
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
                disabled={loading || !otpInput.trim() || otpInput.length < 4}
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
                  Please do not close this window. This may take up to 60 seconds.
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
                  GST portal is taking longer than usual. We're checking if your return was filed successfully.
                </p>
              </div>
              {loading && (
                <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying filing status...</span>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCheckStatus(filingResult)}
                disabled={loading}
                className="mx-auto"
              >
                Check Status Manually
              </Button>
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
                  ✓ {returnType} OFFICIAL FILING COMPLETE
                </Badge>
                <h4 className="text-lg font-bold text-slate-900 tracking-tight">
                  Return Successfully Filed with GSTN!
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Your {returnType} for period {formatPeriod(period)} has been authenticated via EVC.
                </p>
              </div>

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
                    <strong className="text-slate-900 font-mono">{filingResult.filingDate || new Date().toLocaleDateString('en-IN')}</strong>
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
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setStep(STEPS.OTP);
                    setError(null);
                  }}
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
            type: returnType,
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