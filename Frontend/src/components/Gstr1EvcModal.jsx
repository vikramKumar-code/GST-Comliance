import { useState, useEffect } from 'react';
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
  Printer
} from 'lucide-react';
import { requestEvcOtp } from '../api/auth.api';
import { fileGstr1WithEvc, fileNilReturn } from '../api/returns.api';
import { formatCurrency, formatPeriod } from '../utils/format';
import Button from './ui/Button';
import Badge from './ui/Badge';
import { Link } from 'react-router-dom';
import FilingCertificateModal from './FilingCertificateModal';

/**
 * GSTR-1 EVC (Aadhaar / PAN OTP) Electronic Verification Modal
 * Facilitates statutory filing under CGST Rule 26(1) with 2-step OTP verification
 */
export default function Gstr1EvcModal({
  isOpen,
  onClose,
  period,
  gstin,
  returnType = 'GSTR1',
  summary = {},
  excludedInvoiceIds = [],
  onSuccess
}) {
  // Extract 10-character PAN from 15-digit GSTIN (positions 3 to 12)
  const defaultPan = (gstin && gstin.length >= 12)
    ? gstin.slice(2, 12).toUpperCase()
    : 'AABCU9603R';

  const [pan, setPan] = useState(defaultPan);
  const [declaration, setDeclaration] = useState(true);
  const [step, setStep] = useState('FORM'); // 'FORM' | 'OTP' | 'SUCCESS'

  const [otpInput, setOtpInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [filingResult, setFilingResult] = useState(null);
  const [timer, setTimer] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showCert, setShowCert] = useState(false);

  useEffect(() => {
    if (gstin && gstin.length >= 12) {
      setPan(gstin.slice(2, 12).toUpperCase());
    }
  }, [gstin]);

  // Resend Timer Countdown
  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => {
      setTimer((t) => t - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [timer]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (step === 'SUCCESS' && typeof onSuccess === 'function') {
      onSuccess(filingResult);
    }
    setStep('FORM');
    setOtpInput('');
    setError(null);
    setSuccessMsg(null);
    setFilingResult(null);
    onClose();
  };

  // STEP 1: Request EVC OTP from GSTN
  const handleRequestOtp = async (e) => {
    e?.preventDefault();
    const cleanPan = pan.trim().toUpperCase();
    if (!cleanPan || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(cleanPan)) {
      setError('Please enter a valid 10-character PAN (e.g. AABCU9603R).');
      return;
    }
    if (!declaration) {
      setError('You must accept the CGST statutory declaration before proceeding.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const formType = returnType === 'GSTR3B' ? 'R3B' : 'R1';
      const res = await requestEvcOtp({
        pan: cleanPan,
        form_type: formType
      });
      setSuccessMsg(res?.message || 'EVC OTP dispatched to registered Mobile / Email linked with PAN.');
      setStep('OTP');
      setTimer(30);
    } catch (err) {
      setError(err?.message || 'Failed to request EVC OTP from GST Portal.');
    } finally {
      setLoading(false);
    }
  };

  // STEP 2: Verify EVC OTP and Complete Return Filing
  const handleVerifyAndFile = async (e) => {
    e?.preventDefault();
    if (!otpInput.trim() || otpInput.trim().length < 4) {
      setError('Please enter the 6-digit EVC OTP received on your mobile/email.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let res;
      if (returnType === 'GSTR3B') {
        res = await fileNilReturn({
          period,
          returnType: 'GSTR3B',
          declarationAccepted: true,
          verificationMode: 'EVC',
          otp: otpInput.trim(),
          pan: pan.trim().toUpperCase()
        });
      } else {
        const excludedArray = Array.isArray(excludedInvoiceIds)
          ? excludedInvoiceIds
          : Array.from(excludedInvoiceIds || []);

        res = await fileGstr1WithEvc({
          period,
          otp: otpInput.trim(),
          pan: pan.trim().toUpperCase(),
          excludedInvoiceIds: excludedArray
        });
      }

      setFilingResult(res);
      setStep('SUCCESS');
      if (typeof onSuccess === 'function') {
        onSuccess(res);
      }
    } catch (err) {
      setError(err?.message || 'EVC OTP verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyArn = () => {
    if (filingResult?.arn) {
      navigator.clipboard.writeText(filingResult.arn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-lg bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-surface-border animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4.5 border-b border-surface-border flex items-center justify-between bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shadow-xs">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
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
            className="w-8 h-8 rounded-full border border-white/10 bg-white/5 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
            onClick={handleClose}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* STEP 1: FORM & SUMMARY */}
          {step === 'FORM' && (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              {/* Return Filing Summary Card */}
              <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-100 text-indigo-950 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Return Period:</span>
                  <span className="font-mono font-bold text-indigo-900">
                    {formatPeriod(period)} ({period})
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Included Sales Invoices:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {summary.includedInvoices ?? 0} Invoices
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Taxable Turnover:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {formatCurrency(summary.totalTaxable || 0)}
                  </span>
                </div>
                <div className="pt-2 border-t border-indigo-200/80 flex items-center justify-between text-xs">
                  <span className="font-bold text-indigo-950">Total Tax Liability:</span>
                  <span className="font-mono font-bold text-indigo-700 text-sm">
                    {formatCurrency(summary.totalTax || 0)}
                  </span>
                </div>
              </div>

              {/* Authorized Signatory PAN */}
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                  Authorized Signatory PAN
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={pan}
                    onChange={(e) => setPan(e.target.value.toUpperCase())}
                    placeholder="e.g. AABCU9603R"
                    className="w-full pl-3 pr-20 py-2.5 text-xs font-mono font-bold uppercase rounded-xl border border-surface-border focus:outline-hidden focus:border-indigo-600 bg-white"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 font-semibold">
                    10-CHAR PAN
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  GSTN sends EVC OTP to the mobile/email registered with this PAN on the GST Portal.
                </p>
              </div>

              {/* Statutory Declaration */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={declaration}
                    onChange={(e) => setDeclaration(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="text-[11px] text-slate-600 leading-relaxed select-none">
                    <strong>Statutory Declaration:</strong> I hereby solemnly declare that the outward supplies and tax liability details declared in this GSTR-1 are true, complete and correct in accordance with CGST Rules.
                  </span>
                </label>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Action Button */}
              <Button
                type="submit"
                variant="fintech"
                className="w-full justify-center py-2.5"
                disabled={loading || !declaration || !pan}
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

          {/* STEP 2: ENTER EVC OTP */}
          {step === 'OTP' && (
            <form onSubmit={handleVerifyAndFile} className="space-y-4">
              {successMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-3">
                <label className="block text-xs font-bold text-slate-800">
                  Enter 6-Digit EVC OTP:
                </label>
                <div className="max-w-[240px] mx-auto">
                  <input
                    type="text"
                    required
                    maxLength={8}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.trim())}
                    placeholder="• • • • • •"
                    className="w-full px-4 py-2.5 text-center text-lg font-mono font-bold tracking-widest rounded-xl border border-indigo-300 focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 bg-white"
                    autoFocus
                  />
                </div>
                <div className="text-[11px] text-slate-500 flex items-center justify-center gap-2">
                  <span>(Sandbox Test OTP: <strong>575757</strong> or <strong>123456</strong>)</span>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => setStep('FORM')}
                  className="text-slate-500 hover:text-slate-700 underline cursor-pointer"
                >
                  ← Edit PAN / Details
                </button>

                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={loading || timer > 0}
                  className="font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-40 cursor-pointer"
                >
                  {timer > 0 ? `Resend OTP in ${timer}s` : 'Resend EVC OTP'}
                </button>
              </div>

              <Button
                type="submit"
                variant="fintech"
                className="w-full justify-center py-2.5"
                disabled={loading || !otpInput.trim()}
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

          {/* STEP 3: FILING SUCCESS CELEBRATION */}
          {step === 'SUCCESS' && filingResult && (
            <div className="text-center py-4 space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-100 border border-emerald-300 text-emerald-700 flex items-center justify-center shadow-md animate-in zoom-in-75 duration-200">
                <Award className="w-7 h-7 text-emerald-600" />
              </div>

              <div>
                <Badge variant="fintech" size="sm" className="mb-1.5 font-bold">
                  ✓ GSTR-1 OFFICIAL FILING COMPLETE
                </Badge>
                <h4 className="text-lg font-bold text-slate-900 tracking-tight">
                  Return Successfully Filed with GSTN!
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Your GSTR-1 for period {formatPeriod(period)} has been authenticated via EVC.
                </p>
              </div>

              {/* ARN Acknowledgement Box */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-left space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Application Reference # (ARN):</span>
                  <button
                    type="button"
                    onClick={handleCopyArn}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
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
                    <strong className="text-slate-900 font-mono">{filingResult.filingDate || 'Today'}</strong>
                  </div>
                  <div>
                    <span className="block text-slate-400">Mode:</span>
                    <strong className="text-indigo-700 font-semibold">EVC Verified (Rule 26)</strong>
                  </div>
                </div>
              </div>

              {/* Navigation Options */}
              <div className="pt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="fintech"
                  size="sm"
                  onClick={() => setShowCert(true)}
                  className="flex-1 justify-center bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Printer className="w-3.5 h-3.5 mr-1 text-white" />
                  <span>Print Certificate</span>
                </Button>
                <Link
                  to="/returns/filing-history"
                  className="flex-1 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-center transition"
                >
                  Filing History →
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClose}
                  className="px-3"
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

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
          name: 'Candidtax Private Limited',
          gstin
        }}
      />
    </div>
  );
}
