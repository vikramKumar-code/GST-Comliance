import { ShieldCheck, AlertCircle, CheckCircle2, RefreshCw, ArrowRight } from 'lucide-react';
import Button from '../ui/Button';
import { searchGstin, requestOtp, verifyOtp } from '../../api/auth.api';

/**
 * GST portal OTP authentication screen
 * @param {Object} props
 * @param {string} props.authGstin
 * @param {Function} props.setAuthGstin
 * @param {string} props.authUsername
 * @param {Function} props.setAuthUsername
 * @param {boolean} props.otpSent
 * @param {Function} props.setOtpSent
 * @param {string} props.otpInput
 * @param {Function} props.setOtpInput
 * @param {Object|null} props.taxpayerDetails
 * @param {Function} props.setTaxpayerDetails
 * @param {boolean} props.verifyingGstin
 * @param {Function} props.setVerifyingGstin
 * @param {boolean} props.authConsent
 * @param {Function} props.setAuthConsent
 * @param {boolean} props.authLoading
 * @param {Function} props.setAuthLoading
 * @param {string|null} props.authErrorMsg
 * @param {Function} props.setAuthErrorMsg
 * @param {string|null} props.authSuccessMsg
 * @param {Function} props.setAuthSuccessMsg
 * @param {Function} props.onVerifySuccess
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
  const handleVerifyGstinName = async () => {
    if (!authGstin || authGstin.length < 15) {
      setAuthErrorMsg('Please enter a valid 15-character GSTIN first.');
      return;
    }
    setVerifyingGstin(true);
    setAuthErrorMsg(null);
    setAuthSuccessMsg(null);
    try {
      const res = await searchGstin(authGstin.trim().toUpperCase());
      setTaxpayerDetails(res);
      setAuthSuccessMsg(`Registered Business: ${res.legalName || res.tradeName || 'Active Taxpayer'}`);
    } catch (err) {
      setAuthSuccessMsg(null);
      setAuthErrorMsg(err?.message || 'Could not verify GSTIN details.');
    } finally {
      setVerifyingGstin(false);
    }
  };

  const handleSendOtp = async (e) => {
    e?.preventDefault();
    if (!authGstin || authGstin.length < 15) {
      setAuthErrorMsg('Please enter a valid 15-digit GSTIN.');
      return;
    }
    if (!authUsername.trim()) {
      setAuthErrorMsg('Please enter your GST portal username.');
      return;
    }
    if (!authConsent) {
      setAuthErrorMsg('Please accept authorization consent to fetch returns.');
      return;
    }

    setAuthLoading(true);
    setAuthErrorMsg(null);
    setAuthSuccessMsg(null);
    try {
      const res = await requestOtp({
        gstin: authGstin.trim().toUpperCase(),
        username: authUsername.trim(),
        consent: authConsent
      });
      setOtpSent(true);
      setAuthSuccessMsg(res?.message || 'OTP sent successfully to registered mobile/email.');
    } catch (err) {
      setAuthSuccessMsg(null);
      setAuthErrorMsg(err?.message || 'Failed to request OTP from GST Portal.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtpAndEnter = async (e) => {
    e?.preventDefault();
    if (!otpInput.trim()) {
      setAuthErrorMsg('Please enter the OTP received.');
      return;
    }

    setAuthLoading(true);
    setAuthErrorMsg(null);
    setAuthSuccessMsg(null);
    try {
      await verifyOtp({
        gstin: authGstin.trim().toUpperCase(),
        username: authUsername.trim(),
        otp: otpInput.trim()
      });
      setOtpSent(false);
      setOtpInput('');
      setAuthSuccessMsg(`Authentication Successful! Logged in as ${authGstin}`);
      if (onVerifySuccess) {
        onVerifySuccess();
      }
    } catch (err) {
      setAuthSuccessMsg(null);
      setAuthErrorMsg(err?.message || 'Invalid or expired OTP. Please retry.');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-surface rounded-2xl border border-surface-border shadow-card p-8 sm:p-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-50 border border-brand-200 text-brand-600 shadow-xs mb-1">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            GST Return Portal Authentication
          </h1>
          <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
            Verify credentials and OTP via Government Portal API (GSP) to unlock live return preparation & filing.
          </p>
        </div>

        {authErrorMsg && (
          <div className="p-3.5 rounded-xl bg-danger-50 border border-danger-200 text-danger-700 text-xs flex items-center gap-2.5" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{authErrorMsg}</span>
          </div>
        )}

        {!authErrorMsg && authSuccessMsg && (
          <div className="p-3.5 rounded-xl bg-success-50 border border-success-200 text-success-700 text-xs flex items-center gap-2.5" role="status">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{authSuccessMsg}</span>
          </div>
        )}

        <form onSubmit={otpSent ? handleVerifyOtpAndEnter : handleSendOtp} className="space-y-4">
          <div>
            <label htmlFor="gstin-input" className="block text-xs font-semibold text-slate-800 mb-1.5">
              GSTIN (Goods & Services Tax Identification)
            </label>
            <div className="relative flex items-center">
              <input
                id="gstin-input"
                type="text"
                required
                maxLength={15}
                value={authGstin}
                onChange={(e) => {
                  setAuthGstin(e.target.value.toUpperCase());
                  setTaxpayerDetails(null);
                }}
                placeholder="e.g. 29ABCDE1234F1Z5"
                className="w-full pl-3 pr-24 py-2.5 text-xs font-mono font-bold uppercase rounded-xl border border-surface-border focus:outline-none focus:border-brand-500 bg-slate-50/50"
                disabled={otpSent}
              />
              <button
                type="button"
                onClick={handleVerifyGstinName}
                disabled={verifyingGstin || !authGstin || authGstin.length < 15 || otpSent}
                className="absolute right-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 transition disabled:opacity-40 cursor-pointer"
              >
                {verifyingGstin ? 'Verifying...' : 'Verify'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {taxpayerDetails
                ? `✓ Registered: ${taxpayerDetails.legalName || taxpayerDetails.tradeName}`
                : '15-character alphanumeric GSTIN. Click Verify to auto-fetch registered business name.'}
            </p>
          </div>

          <div>
            <label htmlFor="username-input" className="block text-xs font-semibold text-slate-800 mb-1.5">
              GST Portal Username
            </label>
            <input
              id="username-input"
              type="text"
              required
              value={authUsername}
              onChange={(e) => setAuthUsername(e.target.value)}
              placeholder="Enter GST Portal username"
              className="w-full px-3 py-2.5 text-xs rounded-xl border border-surface-border focus:outline-none focus:border-brand-500 bg-slate-50/50"
              disabled={otpSent}
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Your registered username on the official GST portal.
            </p>
          </div>

          <div className="flex items-start gap-2.5 pt-1 text-xs text-slate-600">
            <input
              type="checkbox"
              id="consentCheck"
              checked={authConsent}
              onChange={(e) => setAuthConsent(e.target.checked)}
              className="mt-0.5 rounded border-surface-border text-brand-600 focus:ring-brand-500 cursor-pointer"
            />
            <label htmlFor="consentCheck" className="text-[11px] text-slate-500 leading-tight select-none cursor-pointer">
              I authorize the application to fetch GST returns and tax compliance data on my behalf from the GST Portal via authorized GST Suvidha Provider (GSP).
            </label>
          </div>

          {otpSent && (
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 space-y-2 animate-in fade-in duration-200">
              <label htmlFor="otp-input" className="block text-xs font-semibold text-blue-900">
                Enter 6-Digit OTP received on registered Mobile/Email:
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="otp-input"
                  type="text"
                  maxLength={8}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value)}
                  placeholder="Enter OTP received"
                  className="w-full px-3 py-2 text-sm font-mono font-bold tracking-widest text-center rounded-xl border border-blue-300 focus:outline-none focus:border-blue-500 bg-white"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleVerifyOtpAndEnter}
                  disabled={authLoading}
                  className="shrink-0"
                >
                  {authLoading ? 'Verifying...' : 'Verify OTP →'}
                </Button>
              </div>
              <div className="flex justify-between items-center text-[11px] text-blue-700">
                <button
                  type="button"
                  onClick={() => setOtpSent(false)}
                  className="underline hover:text-blue-900 cursor-pointer"
                >
                  Change GSTIN
                </button>
              </div>
            </div>
          )}

          {!otpSent && (
            <Button
              type="submit"
              variant="fintech"
              className="w-full justify-center"
              disabled={authLoading || !authGstin || !authUsername}
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
      </div>
    </div>
  );
}

export default AuthScreen;
