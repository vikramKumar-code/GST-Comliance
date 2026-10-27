import { useState, useEffect } from 'react';
import { verifyOtp, requestOtp } from '../api/auth.api';
import { isValidOtp } from '../utils/validators';
import ErrorMessage from './ErrorMessage';

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
    <form onSubmit={handleVerify} noValidate className="otp-form">
      <ErrorMessage error={error} onRetry={() => setError(null)} />

      {resendStatus && (
        <div
          className="alert alert-info py-2 px-3 mb-3 small d-flex align-items-center gap-2 rounded-3"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">ℹ️</span>
          <span>{resendStatus}</span>
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="otp-input" className="form-label text-center d-block mb-2">
          One-Time Password (OTP)
        </label>
        <div className="d-flex justify-content-center">
          <input
            id="otp-input"
            type="text"
            className="form-control text-center font-monospace fs-2 fw-bold tracking-wide"
            style={{ maxWidth: '280px', letterSpacing: '0.25em', padding: '0.65rem 1rem' }}
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
          />
        </div>
        <div id="otp-help" className="form-text text-center text-muted small mt-2">
          Enter 4-8 digits received on mobile/email (Sandbox Demo: <code className="fw-bold text-dark">123456</code>).
        </div>
      </div>

      <button
        type="submit"
        className="btn btn-primary w-100 py-2.5 fw-semibold shadow-xs mb-3"
        disabled={otp.length < 4 || isBusy}
      >
        {verifying ? (
          <>
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
            Verifying Session Handshake...
          </>
        ) : (
          <>
            Verify & Open Dashboard
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="ms-2">
              <path fillRule="evenodd" d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z"/>
            </svg>
          </>
        )}
      </button>

      <div className="d-grid">
        <button
          type="button"
          onClick={handleResend}
          className="btn btn-outline-secondary btn-sm py-2"
          disabled={countdown > 0 || isBusy}
          aria-label={countdown > 0 ? `Resend OTP disabled for ${countdown} seconds` : 'Resend OTP'}
        >
          {resending ? (
            <>
              <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />
              Dispatching fresh OTP...
            </>
          ) : countdown > 0 ? (
            `Resend OTP in ${countdown}s`
          ) : (
            '↻ Resend OTP'
          )}
        </button>
      </div>
    </form>
  );
}
