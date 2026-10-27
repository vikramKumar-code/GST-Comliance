import { useState } from 'react';
import { searchGstin, requestOtp } from '../api/auth.api';
import { isValidGstin } from '../utils/validators';
import ConsentBox from './ConsentBox';
import ErrorMessage from './ErrorMessage';

export default function GstinForm({ initialGstin = '', onOtpSent }) {
  const [gstin, setGstin] = useState(initialGstin.toUpperCase());
  const [username, setUsername] = useState('demouser');
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

      // Check if legalName is present and verified !== false
      if (data && data.legalName && data.verified !== false) {
        setBusinessInfo(data);
      } else {
        // Skip confirmation if legalName is null or verified is false
        setBusinessInfo({ legalName: null, status: data?.status || 'Active' });
      }
      return data;
    } catch (err) {
      setBusinessInfo(null);
      setError(err);
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
      // If business hasn't been searched yet, attempt quick search (non-blocking)
      let resolvedLegalName = businessInfo?.legalName;
      if (!businessInfo) {
        try {
          const searchData = await searchGstin(cleanGstin);
          if (searchData && searchData.legalName && searchData.verified !== false) {
            resolvedLegalName = searchData.legalName;
          }
        } catch {
          // Public search is optional/informational for the legal name banner;
          // failure to fetch legal name must NOT prevent the taxpayer from dispatching OTP.
          resolvedLegalName = null;
        }
      }

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
      setError(err);
    } finally {
      setSendingOtp(false);
    }
  };

  const isFormBusy = searching || sendingOtp;

  return (
    <form onSubmit={handleSendOtp} noValidate className="gstin-form">
      {/* Quick Test Presets Toolbar */}
      <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom" style={{ borderColor: '#e2e8f0' }}>
        <span className="text-muted small fw-medium" style={{ fontSize: '0.75rem' }}>
          Testing Preset:
        </span>
        <div className="d-flex gap-1.5">
          <button
            type="button"
            className="btn btn-sm btn-outline-primary py-0.5 px-2.5 rounded-pill"
            style={{ fontSize: '0.72rem' }}
            onClick={() => {
              setGstin('29ABCDE1234F1Z5');
              setUsername('demouser');
              setConsent(true);
            }}
          >
            Sandbox (29ABCDE1234F1Z5)
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary py-0.5 px-2 rounded-pill"
            style={{ fontSize: '0.72rem' }}
            onClick={() => {
              setGstin('');
              setUsername('');
              setConsent(false);
              setBusinessInfo(null);
              setError(null);
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <ErrorMessage error={error} onRetry={() => setError(null)} />

      {/* GSTIN Input Field */}
      <div className="mb-3">
        <label htmlFor="gstin-input" className="form-label">
          GSTIN (Goods & Services Tax Identification)
        </label>
        <div className="input-group">
          <input
            id="gstin-input"
            type="text"
            className="form-control text-uppercase font-monospace fs-6"
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
            className="btn btn-outline-primary fw-semibold"
            onClick={handleSearch}
            disabled={gstin.length < 15 || isFormBusy}
            aria-label="Verify GSTIN"
          >
            {searching ? (
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
            ) : (
              'Verify'
            )}
          </button>
        </div>
        <div id="gstin-help" className="form-text small text-muted">
          15-character alphanumeric GSTIN. Click Verify to auto-fetch registered business name.
        </div>
      </div>

      {/* Business Name Confirmation (Shown if legalName is present) */}
      {businessInfo && businessInfo.legalName && (
        <div
          className="alert alert-success d-flex align-items-center gap-3 py-2 px-3 mb-3 border-success-subtle bg-success-subtle text-success-emphasis rounded-3"
          role="status"
          aria-live="polite"
        >
          <span className="fs-4" aria-hidden="true">🏢</span>
          <div className="small">
            <div className="fw-bold">{businessInfo.legalName}</div>
            {businessInfo.tradeName && (
              <div className="text-secondary">{businessInfo.tradeName} • Status: {businessInfo.status || 'Active'}</div>
            )}
          </div>
        </div>
      )}

      {/* GST Portal Username Input Field */}
      <div className="mb-3">
        <label htmlFor="username-input" className="form-label">
          GST Portal Username
        </label>
        <input
          id="username-input"
          type="text"
          className="form-control"
          placeholder="e.g. demouser"
          value={username}
          disabled={isFormBusy}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <div className="form-text small text-muted">
          Your registered username on the official GST portal (default: demouser).
        </div>
      </div>

      {/* Mandatory Taxpayer Consent */}
      <ConsentBox checked={consent} onChange={setConsent} disabled={isFormBusy} />

      {/* Submit Button */}
      <button
        type="submit"
        className="btn btn-primary w-100 py-2.5 fw-semibold shadow-xs mt-3"
        disabled={gstin.length < 15 || !consent || isFormBusy}
      >
        {sendingOtp ? (
          <>
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
            Requesting GSTN OTP...
          </>
        ) : (
          <>
            Send GSTN Verification OTP
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="ms-2">
              <path fillRule="evenodd" d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z"/>
            </svg>
          </>
        )}
      </button>
    </form>
  );
}
