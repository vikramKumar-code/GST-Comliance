import { useState } from 'react';
import { searchGstin, requestOtp } from '../api/auth.api';
import { isValidGstin } from '../utils/validators';
import ConsentBox from './ConsentBox';
import ErrorMessage from './ErrorMessage';
import { Building2, ArrowRight, CheckCircle2, ShieldCheck, Loader2 } from 'lucide-react';
import Button from './ui/Button';

export default function GstinForm({ initialGstin = '', onOtpSent }) {
  const [gstin, setGstin] = useState(initialGstin.toUpperCase());
  const [username, setUsername] = useState('');
  const [consent, setConsent] = useState(false);
  const [businessInfo, setBusinessInfo] = useState(null);
  const [searching, setSearching] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [error, setError] = useState(null);

  // Handle GSTIN business search / validation
  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    const cleanGstin = gstin.trim().toUpperCase();

    if (!isValidGstin(cleanGstin)) {
      setError({
        code: 'INVALID_GSTIN',
        message: 'Invalid GSTIN format. Must be 15 alphanumeric characters.',
      });
      return null;
    }

    setSearching(true);
    setError(null);
    try {
      const data = await searchGstin(cleanGstin);

      if (data && data.legalName && data.verified !== false) {
        setBusinessInfo(data);
      } else {
        setBusinessInfo({ legalName: null, status: data?.status || 'Active' });
      }
      return data;
    } catch {
      setBusinessInfo(null);
      setError({
        code: 'LOOKUP_UNAVAILABLE',
        message: 'Public business lookup is currently unavailable. You can proceed directly to enter your GST Portal username and click "Send GSTN Verification OTP".',
      });
      return null;
    } finally {
      setSearching(false);
    }
  };

  // Handle Send OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    const cleanGstin = gstin.trim().toUpperCase();
    const cleanUsername = username.trim();

    if (!isValidGstin(cleanGstin)) {
      setError({
        code: 'INVALID_GSTIN',
        message: 'Please enter a valid 15-character GSTIN before requesting OTP.',
      });
      return;
    }

    if (!cleanUsername) {
      setError({
        code: 'VALIDATION_ERROR',
        message: 'GST Portal Username is required.',
      });
      return;
    }

    if (!consent) {
      setError({
        code: 'VALIDATION_ERROR',
        message: 'Taxpayer consent is mandatory to request OTP.',
      });
      return;
    }

    setSendingOtp(true);
    setError(null);

    try {
      const resolvedLegalName = businessInfo?.legalName || null;

      await requestOtp({
        gstin: cleanGstin,
        username: cleanUsername,
        consent: true,
      });

      if (onOtpSent) {
        onOtpSent({
          gstin: cleanGstin,
          username: cleanUsername,
          legalName: resolvedLegalName || null,
        });
      }
    } catch (err) {
      if (err?.code === 'PROVIDER_ERROR' || err?.status === 502) {
        setError({
          code: 'PROVIDER_ERROR',
          status: 502,
          message: 'GSTN Gateway notice: Maximum active sessions exceeded for this taxpayer account. Please wait a few moments before trying again, or sign in using your verified Email / Google account.',
        });
      } else {
        setError(err);
      }
    } finally {
      setSendingOtp(false);
    }
  };

  const isFormBusy = searching || sendingOtp;

  return (
    <form onSubmit={handleSendOtp} noValidate className="space-y-4">
      <ErrorMessage error={error} onRetry={() => setError(null)} />

      {/* GSTIN Input Field */}
      <div>
        <label htmlFor="gstin-input" className="block text-xs font-semibold text-slate-700 mb-1.5">
          GSTIN (Goods & Services Tax Identification)
        </label>
        <div className="relative flex items-center">
          <input
            id="gstin-input"
            type="text"
            className="w-full pl-3 pr-24 py-2.5 text-xs font-mono font-bold uppercase rounded-xl border border-surface-border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
            placeholder="e.g. 29ABCDE1234F1Z5"
            maxLength={15}
            value={gstin}
            disabled={isFormBusy}
            onChange={(e) => {
              setGstin(e.target.value.toUpperCase());
              setBusinessInfo(null);
              setError(null);
            }}
            aria-describedby="gstin-help"
            required
          />
          <button
            type="button"
            className="absolute right-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 transition disabled:opacity-40 cursor-pointer"
            onClick={handleSearch}
            disabled={gstin.length < 15 || isFormBusy}
            aria-label="Verify GSTIN"
          >
            {searching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-600" />
            ) : (
              'Verify'
            )}
          </button>
        </div>
        <p id="gstin-help" className="text-[11px] text-slate-400 mt-1">
          15-character alphanumeric GSTIN. Click Verify to auto-fetch registered business name.
        </p>
      </div>

      {/* Business Name Confirmation */}
      {businessInfo && businessInfo.legalName && (
        <div
          className="p-3.5 rounded-xl bg-success-50 border border-success-200 text-success-950 flex items-center gap-3"
          role="status"
          aria-live="polite"
        >
          <Building2 className="w-5 h-5 text-success-600 shrink-0" />
          <div className="text-xs">
            <div className="font-bold text-slate-900">{businessInfo.legalName}</div>
            {businessInfo.tradeName && (
              <div className="text-slate-500 mt-0.5">{businessInfo.tradeName} • Status: {businessInfo.status || 'Active'}</div>
            )}
          </div>
        </div>
      )}

      {/* GST Portal Username Input Field */}
      <div>
        <label htmlFor="username-input" className="block text-xs font-semibold text-slate-700 mb-1.5">
          GST Portal Username
        </label>
        <input
          id="username-input"
          type="text"
          className="w-full px-3 py-2.5 text-xs rounded-xl border border-surface-border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
          placeholder="Enter GST Portal username"
          value={username}
          disabled={isFormBusy}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <p className="text-[11px] text-slate-400 mt-1">
          Your registered username on the official GST portal.
        </p>
      </div>

      {/* Mandatory Taxpayer Consent */}
      <ConsentBox checked={consent} onChange={setConsent} disabled={isFormBusy} />

      {/* Submit Button */}
      <Button
        type="submit"
        variant="fintech"
        className="w-full justify-center py-2.5"
        disabled={gstin.length < 15 || !consent || isFormBusy}
      >
        {sendingOtp ? (
          <span>Requesting GSTN OTP...</span>
        ) : (
          <>
            <span>Send GSTN Verification OTP</span>
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </>
        )}
      </Button>
    </form>
  );
}
