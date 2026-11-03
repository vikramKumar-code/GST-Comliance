import { useState, useEffect } from 'react';
import { verifyOtp, requestOtp } from '../api/auth.api';
import { isValidOtp } from '../utils/validators';
import ErrorMessage from './ErrorMessage';
import { RefreshCw, ArrowRight, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import Button from './ui/Button';

export default function OtpForm({ gstin, username, onSuccess }) {
  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [resendStatus, setResendStatus] = useState(null);
  const [error, setError] = useState(null);

  // 30-second visible countdown for Resend OTP
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleVerify = async (e) => {
    e.preventDefault();
    const cleanOtp = otp.trim();

    if (!isValidOtp(cleanOtp)) {
      setError({
        code: 'OTP_INVALID',
        message: 'OTP must be 4 to 8 digits.',
      });
      return;
    }

    setVerifying(true);
    setError(null);
    setResendStatus(null);

    try {
      const data = await verifyOtp({
        gstin,
        username,
        otp: cleanOtp,
      });
      if (onSuccess) {
        onSuccess(data);
      }
    } catch (err) {
      setError(err);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resending || verifying) return;

    setResending(true);
    setError(null);
    setResendStatus(null);

    try {
      await requestOtp({
        gstin,
        username,
        consent: true,
      });
      setCountdown(30);
      setResendStatus('A fresh OTP has been dispatched to your GST mobile/email.');
    } catch (err) {
      setError(err);
    } finally {
      setResending(false);
    }
  };

  const isBusy = verifying || resending;

  return (
    <form onSubmit={handleVerify} noValidate className="space-y-4">
      <ErrorMessage error={error} onRetry={() => setError(null)} />

      {resendStatus && (
        <div
          className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs flex items-center gap-2"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
          <span>{resendStatus}</span>
        </div>
      )}

      <div>
        <label htmlFor="otp-input" className="block text-xs font-semibold text-slate-700 text-center mb-2">
          One-Time Password (OTP)
        </label>
        <div className="flex justify-center">
          <input
            id="otp-input"
            type="text"
            className="w-full max-w-[280px] py-3 px-4 text-center font-mono text-2xl font-bold tracking-widest rounded-xl border border-surface-border bg-white text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 shadow-xs"
            placeholder="••••••"
            maxLength={8}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            disabled={isBusy}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '');
              setOtp(val);
              setError(null);
            }}
            required
            aria-describedby="otp-help"
            autoFocus
          />
        </div>
        <p id="otp-help" className="text-center text-slate-400 text-[11px] mt-2">
          Enter the 4-8 digit verification code sent to your GST-registered mobile number or email.
        </p>
      </div>

      <Button
        type="submit"
        variant="fintech"
        className="w-full justify-center py-2.5"
        disabled={otp.length < 4 || isBusy}
      >
        {verifying ? (
          <span>Verifying Session Handshake...</span>
        ) : (
          <>
            <span>Verify & Open Dashboard</span>
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </>
        )}
      </Button>

      <div className="pt-1 text-center">
        <button
          type="button"
          onClick={handleResend}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-50 transition cursor-pointer"
          disabled={countdown > 0 || isBusy}
          aria-label={countdown > 0 ? `Resend OTP disabled for ${countdown} seconds` : 'Resend OTP'}
        >
          {resending ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Dispatching fresh OTP...</span>
            </>
          ) : countdown > 0 ? (
            <span>Resend OTP in <strong>{countdown}s</strong></span>
          ) : (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Resend OTP</span>
            </>
          )}
        </button>
      </div>

      <div className="p-3 bg-slate-50 rounded-xl border border-surface-border text-center text-[11px] text-slate-500">
        <span>Sandbox Test Credentials: Use OTP <strong>575757</strong> or <strong>123456</strong></span>
      </div>
    </form>
  );
}
