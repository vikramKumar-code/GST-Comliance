import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { checkNilEligibility, fileNilReturn } from '../api/returns.api';
import { requestEvcOtp } from '../api/auth.api';
import { formatCurrency, formatPeriod } from '../utils/format';
import Loader from './Loader';
import ErrorMessage from './ErrorMessage';
import {
  Zap,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Copy,
  Check,
  X,
  FileText,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Lock,
  Smartphone,
  Info,
  Award
} from 'lucide-react';
import Button from './ui/Button';
import Badge from './ui/Badge';
import FilingCertificateModal from './FilingCertificateModal';

export default function NilReturnModal({
  isOpen,
  onClose,
  initialPeriod,
  initialType = 'GSTR1',
  onSuccess
}) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [returnType, setReturnType] = useState(initialType);
  const [period, setPeriod] = useState(initialPeriod || '102026');
  const [checking, setChecking] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const [error, setError] = useState(null);

  // Flow steps: 'FORM' -> 'OTP' -> Success (filingResult)
  const [step, setStep] = useState('FORM');
  const [declaration, setDeclaration] = useState(false);
  const [verificationMode, setVerificationMode] = useState('EVC'); // 'EVC' | '1_CLICK'

  // EVC OTP state
  const activeGstin = user?.gstin || '06AAMCC3439Q1Z2';
  const defaultPan = activeGstin.length >= 12 ? activeGstin.slice(2, 12).toUpperCase() : 'AAMCC3439Q';
  const [pan, setPan] = useState(defaultPan);
  const [otpInput, setOtpInput] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpMessage, setOtpMessage] = useState(null);
  const [timer, setTimer] = useState(0);

  const [filing, setFiling] = useState(false);
  const [filingResult, setFilingResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showCert, setShowCert] = useState(false);

  useEffect(() => {
    if (initialType) setReturnType(initialType.toUpperCase());
    if (initialPeriod) setPeriod(initialPeriod);
  }, [initialType, initialPeriod]);

  useEffect(() => {
    if (user?.gstin && user.gstin.length >= 12) {
      setPan(user.gstin.slice(2, 12).toUpperCase());
    }
  }, [user?.gstin]);

  // Resend OTP countdown
  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => {
      setTimer((t) => t - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [timer]);

  // Check eligibility on mount or when returnType / period changes
  const checkEligibility = useCallback(async (p, t) => {
    if (!p) return;
    setChecking(true);
    setError(null);
    setFilingResult(null);
    try {
      const res = await checkNilEligibility(p, t);
      setEligibility(res);
      if (res?.gstin && res.gstin.length >= 12) {
        setPan(res.gstin.slice(2, 12).toUpperCase());
      }
    } catch (err) {
      setError(err);
      setEligibility(null);
    } finally {
      setChecking(false);
    }
  }, []);

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

  const handleClose = () => {
    setEligibility(null);
    setError(null);
    setFilingResult(null);
    setDeclaration(false);
    setStep('FORM');
    setOtpInput('');
    setOtpMessage(null);
    onClose();
  };

  // STEP 1: Request EVC OTP to Taxpayer Mobile
  const handleSendEvcOtp = async () => {
    const cleanPan = pan.trim().toUpperCase();
    if (!cleanPan || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(cleanPan)) {
      setError({ message: 'Please enter a valid 10-character PAN of authorized signatory (e.g. AAMCC3439Q).' });
      return;
    }
    if (!declaration) {
      setError({ message: 'You must check and accept the CGST Rule 67A statutory declaration before proceeding.' });
      return;
    }

    setSendingOtp(true);
    setError(null);
    try {
      const formType = returnType === 'GSTR1' ? 'R1' : 'R3B';
      const res = await requestEvcOtp({
        pan: cleanPan,
        form_type: formType
      });
      setOtpMessage(res?.message || `EVC OTP sent successfully to mobile/email registered with PAN ${cleanPan}.`);
      setStep('OTP');
      setTimer(30);
    } catch (err) {
      setError(err);
    } finally {
      setSendingOtp(false);
    }
  };

  // STEP 2: Verify OTP & Submit Nil Return to Portal
  const handleVerifyOtpAndFile = async () => {
    if (!otpInput.trim() || otpInput.trim().length < 4) {
      setError({ message: 'Please enter the 6-digit EVC OTP received on your mobile/email.' });
      return;
    }

    setFiling(true);
    setError(null);
    try {
      const res = await fileNilReturn({
        period,
        returnType,
        declarationAccepted: true,
        verificationMode: 'EVC',
        otp: otpInput.trim(),
        pan: pan.trim().toUpperCase()
      });
      setFilingResult(res);
      setStep('FORM');
      if (typeof onSuccess === 'function') {
        onSuccess(res);
      }
    } catch (err) {
      setError(err);
    } finally {
      setFiling(false);
    }
  };

  // Direct 1-Click File (For mock / direct API without live OTP)
  const handleDirectFile = async () => {
    if (!declaration) {
      setError({ message: 'You must check and accept the CGST Rule 67A statutory declaration before filing.' });
      return;
    }
    setFiling(true);
    setError(null);
    try {
      const res = await fileNilReturn({
        period,
        returnType,
        declarationAccepted: true,
        verificationMode: '1_CLICK'
      });
      setFilingResult(res);
      setStep('FORM');
      if (typeof onSuccess === 'function') {
        onSuccess(res);
      }
    } catch (err) {
      setError(err);
    } finally {
      setFiling(false);
    }
  };

  const handleCopyArn = () => {
    if (filingResult?.arn) {
      navigator.clipboard.writeText(filingResult.arn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isEligible = Boolean(eligibility?.eligible);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-xl max-h-[90vh] bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-surface-border animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between bg-gradient-to-r from-brand-700 via-brand-600 to-teal-700 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white">
              <Zap className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>File Nil GST Return</span>
                {step === 'OTP' && (
                  <Badge variant="warning" size="sm" className="bg-amber-400 text-slate-900 font-bold">
                    STEP 2: EVC OTP
                  </Badge>
                )}
              </h2>
              <span className="text-[11px] text-white/80">Under Rule 67A of CGST Rules, 2017</span>
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition cursor-pointer"
            aria-label="Close"
            onClick={handleClose}
            disabled={filing || sendingOtp}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && <ErrorMessage error={error} onRetry={() => checkEligibility(period, returnType)} />}

          {/* SCREEN 1: SUCCESS SCREEN */}
          {filingResult ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-success-50 border border-success-200 text-success-600 flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Nil Return Filed Successfully!</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Your Nil <strong>{filingResult.type}</strong> return for <strong>{formatPeriod(filingResult.period)}</strong> has been formally registered on the GST system.
                </p>
              </div>

              {/* Digital Acknowledgement Certificate Card */}
              <div className="p-4 rounded-xl border border-surface-border bg-slate-50 text-left space-y-3">
                <div className="flex items-center justify-between border-b border-surface-border pb-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Official Acknowledgement</span>
                  <Badge variant="success" size="sm">
                    ● Status: FILED
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Application Reference # (ARN):</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <strong className="font-mono text-sm text-brand-700">{filingResult.arn}</strong>
                      <button
                        type="button"
                        onClick={handleCopyArn}
                        className="p-1 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                        title="Copy ARN"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-success-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Filing Date & Time:</span>
                    <strong className="text-slate-800">{filingResult.filingDate || new Date().toLocaleString()}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Return Form:</span>
                    <strong className="text-slate-800">{filingResult.type}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Verification Mode:</span>
                    <strong className="text-slate-800 font-semibold text-brand-700">{filingResult.filingMode || 'Aadhaar EVC'}</strong>
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
                <Button
                  variant="primary"
                  onClick={() => {
                    handleClose();
                    navigate('/returns/filing-history');
                  }}
                >
                  View in Filing History →
                </Button>
                <Button variant="outline" onClick={handleClose}>
                  Done
                </Button>
              </div>
            </div>
          ) : step === 'OTP' ? (
            /* SCREEN 2: EVC OTP VERIFICATION STEP */
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
                    {otpMessage || `GST Portal has dispatched a 6-digit EVC OTP to the mobile & email registered with PAN: ${pan}`}
                  </p>
                  <div className="text-[11px] font-mono text-indigo-700 pt-0.5">
                    Return: <strong>Nil {returnType}</strong> • Period: <strong>{formatPeriod(period)}</strong> • PAN: <strong>{pan}</strong>
                  </div>
                </div>
              </div>

              {/* OTP Input Form Box */}
              <div className="p-5 rounded-2xl border border-surface-border bg-slate-50/50 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-brand-600" />
                    <span>6-Digit Mobile EVC OTP</span>
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="• • • • • •"
                    className="w-full text-center tracking-[0.5em] font-mono text-2xl font-bold px-4 py-3 rounded-xl border border-surface-border bg-white text-slate-900 focus:outline-none focus:border-brand-500 shadow-xs"
                    autoFocus
                    disabled={filing}
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5 text-center">
                    Enter the 6-digit code received via SMS from GSTN.
                  </p>
                </div>

                {/* Resend Timer */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-surface-border">
                  <button
                    type="button"
                    onClick={() => setStep('FORM')}
                    className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-xs cursor-pointer"
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
                        <RefreshCw className={`w-3.5 h-3.5 ${sendingOtp ? 'animate-spin' : ''}`} />
                        <span>Resend OTP</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* SCREEN 3: FORM CONTROLS (ELIGIBILITY & SELECTION) */
            <>
              {/* Form Controls: Return Type & Period */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Return Type
                  </label>
                  <select
                    value={returnType}
                    onChange={(e) => setReturnType(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-surface-border bg-white text-slate-800 focus:outline-none focus:border-brand-500"
                    disabled={checking || filing}
                  >
                    <option value="GSTR1">GSTR-1 (Outward Supplies)</option>
                    <option value="GSTR3B">GSTR-3B (Summary Return)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tax Period
                  </label>
                  <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-surface-border bg-white text-slate-800 focus:outline-none focus:border-brand-500 font-mono"
                    disabled={checking || filing}
                  >
                    <option value="102026">Oct 2026</option>
                    <option value="092026">Sep 2026</option>
                    <option value="082026">Aug 2026</option>
                    <option value="072026">Jul 2026</option>
                  </select>
                </div>
              </div>

              {/* Eligibility Check Result */}
              {checking ? (
                <div className="py-6 text-center">
                  <Loader message="Verifying CGST Rule 67A eligibility requirements..." />
                </div>
              ) : eligibility && (
                <div
                  className={`p-4 rounded-xl border ${
                    eligibility.hasBusinessActivity
                      ? 'bg-amber-50/90 border-amber-300 text-amber-950'
                      : isEligible
                      ? 'bg-success-50/70 border-success-200 text-success-950'
                      : 'bg-red-50/80 border-red-200 text-red-950'
                  }`}
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
                            ? eligibility.warnings.join(' ')
                            : `You have ${eligibility.activeInvoicesCount} active sales invoice(s) recorded in this period.`
                          : eligibility.message ||
                            (isEligible
                              ? 'No outward supplies, inward supplies, or tax liabilities are recorded for this tax period.'
                              : 'Transactions exist in this period that require standard filing.')}
                      </p>
                      {eligibility.hasBusinessActivity && (
                        <div className="mt-2 p-2 rounded-lg bg-amber-100/70 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
                          <strong>CGST Rule 67A Compliance Notice:</strong> Nil Return is legally valid ONLY when you have zero outward taxable sales. If these bills are actual customer sales, you should close this modal and file regular <strong>GSTR-1</strong> instead of Nil.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

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
                    />
                    <label htmlFor="nilDeclaration" className="text-[11px] text-slate-600 leading-snug cursor-pointer select-none">
                      I solemnly affirm and declare that I have not made any outward supply of goods or services, have no tax liability, and have not received any supplies on which tax is payable during this tax period under <strong>Rule 67A of CGST Rules, 2017</strong>.
                    </label>
                  </div>

                  {/* Verification Mode Selection */}
                  <div className="pt-2 border-t border-surface-border flex items-center justify-between text-xs">
                    <span className="text-slate-500 text-[11px]">Verification Mode:</span>
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-800 text-xs font-semibold">
                        <input
                          type="radio"
                          name="vMode"
                          value="EVC"
                          checked={verificationMode === 'EVC'}
                          onChange={() => setVerificationMode('EVC')}
                          className="text-brand-600"
                        />
                        <span>Aadhaar EVC (Real Mobile OTP)</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-600 text-xs">
                        <input
                          type="radio"
                          name="vMode"
                          value="1_CLICK"
                          checked={verificationMode === '1_CLICK'}
                          onChange={() => setVerificationMode('1_CLICK')}
                          className="text-brand-600"
                        />
                        <span>Direct 1-Click (Test Mode)</span>
                      </label>
                    </div>
                  </div>

                  {/* PAN Input when EVC is selected */}
                  {verificationMode === 'EVC' && (
                    <div className="pt-2 border-t border-surface-border flex items-center justify-between gap-3 text-xs">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700">
                          Authorized Signatory PAN
                        </label>
                        <span className="text-[10px] text-slate-400">Mobile OTP will be sent to registered Aadhaar/PAN</span>
                      </div>
                      <input
                        type="text"
                        maxLength={10}
                        value={pan}
                        onChange={(e) => setPan(e.target.value.toUpperCase())}
                        placeholder="AAMCC3439Q"
                        className="w-36 text-center font-mono font-bold text-xs uppercase px-2.5 py-1.5 rounded-lg border border-surface-border bg-white text-slate-900 focus:outline-none focus:border-brand-500"
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        {!filingResult && (
          <div className="px-6 py-3.5 border-t border-surface-border bg-slate-50 flex items-center justify-between">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-brand-600" />
              <span>CGST Rule 67A Compliant</span>
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClose}
                disabled={filing || sendingOtp}
              >
                Cancel
              </Button>

              {step === 'OTP' ? (
                <Button
                  variant="fintech"
                  size="sm"
                  onClick={handleVerifyOtpAndFile}
                  disabled={filing || otpInput.trim().length < 4}
                >
                  <Lock className="w-3.5 h-3.5 mr-1" />
                  <span>{filing ? 'Submitting to Portal...' : `Verify OTP & File Nil ${returnType} Now`}</span>
                </Button>
              ) : verificationMode === 'EVC' ? (
                <Button
                  variant="fintech"
                  size="sm"
                  onClick={handleSendEvcOtp}
                  disabled={!isEligible || !declaration || sendingOtp || checking}
                >
                  <Smartphone className="w-3.5 h-3.5 mr-1" />
                  <span>{sendingOtp ? 'Sending OTP to Mobile...' : `Send EVC OTP to Mobile →`}</span>
                </Button>
              ) : (
                <Button
                  variant="fintech"
                  size="sm"
                  onClick={handleDirectFile}
                  disabled={!isEligible || !declaration || filing || checking}
                >
                  <Zap className="w-3.5 h-3.5 mr-1" />
                  <span>{filing ? 'Filing Nil Return...' : `File Nil ${returnType} Directly`}</span>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <FilingCertificateModal
        isOpen={showCert}
        onClose={() => setShowCert(false)}
        filing={filingResult}
        workspace={{
          name: user?.name || 'Candidtax Private Limited',
          gstin: user?.gstin || '06AAMCC3439Q1Z2'
        }}
      />
    </div>
  );
}
