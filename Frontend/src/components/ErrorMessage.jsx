import { useState, useEffect } from 'react';

/**
 * Simple, Clean & Visually Attractive Error Banner Component
 * Formatted with balanced margin, padding, modern typography, and compact actions.
 */
export default function ErrorMessage({ error, onRetry }) {
  const [dismissed, setDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset dismissed state whenever error object changes
  useEffect(() => {
    setDismissed(false);
    setShowDetails(false);
    setCopied(false);
  }, [error]);

  if (!error || dismissed) return null;

  const rawMessage = typeof error === 'string' ? error : error.message || 'An unexpected issue occurred.';
  const code = error?.code;
  const status = error?.status;
  const rawData = error?.data;

  const lowerMsg = String(rawMessage).toLowerCase();

  // Smart Contextual Titles & Actionable Guidance
  let errorTitle = 'Notice';
  let userTip = null;
  let providerBadge = null;

  if (code === 'INVALID_GSTIN' || lowerMsg.includes('gstin') || lowerMsg.includes('format')) {
    errorTitle = 'GSTIN Validation Notice';
    userTip = 'Please ensure the GSTIN contains exactly 15 alphanumeric characters matching state and PAN format.';
  } else if (code === 'OTP_INVALID' || lowerMsg.includes('otp') || lowerMsg.includes('verification code')) {
    errorTitle = 'OTP Verification Notice';
    userTip = 'Please check the 4-8 digit code sent to your registered contact or request a fresh OTP.';
  } else if (code === 'SESSION_EXPIRED' || status === 401 || lowerMsg.includes('session')) {
    errorTitle = 'Security Session Expired';
    userTip = 'Your active session has expired for security. Please sign in again to continue.';
  } else if (code === 'FORBIDDEN' || status === 403 || lowerMsg.includes('forbidden') || lowerMsg.includes('permission')) {
    errorTitle = 'Access Permission Restricted';
    userTip = 'Your current role does not have permission for this action. Contact your workspace administrator.';
  } else if (code === 'RATE_LIMITED' || status === 429) {
    errorTitle = 'Too Many Requests';
    userTip = 'Rate limit reached for security. Please wait a minute before submitting again.';
  } else if (code === 'PROVIDER_DOWN' || status === 502 || status === 503 || lowerMsg.includes('gateway') || lowerMsg.includes('unavailable')) {
    errorTitle = 'GSTN Gateway Notice';
    userTip = 'The government GST portal servers are experiencing high traffic. Please retry in a few moments.';
  } else if (status === 404 || code === 'NOT_FOUND') {
    errorTitle = 'Record Not Found';
    userTip = 'The requested tax record or return data could not be found for this period.';
  }

  // Safe Provider Badge Mapping
  if (lowerMsg.includes('portal user is not registered') || code === 'AUTH4037') {
    providerBadge = 'AUTH4037';
  } else if (lowerMsg.includes('expired or was not found') || code === 'GSP053') {
    providerBadge = 'GSP053';
  } else if (code === 'PROVIDER_DOWN' || code === 'GSP032') {
    providerBadge = 'GSP032';
  } else if (code === 'DATA_NOT_AVAILABLE' || code === 'RET2B1023') {
    providerBadge = 'RET2B1023';
  }

  const handleCopyDiagnostics = async (e) => {
    e.stopPropagation();
    const payload = {
      message: rawMessage,
      code: code || null,
      status: status || null,
      details: rawData || null,
      timestamp: new Date().toISOString()
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failure
    }
  };

  return (
    <div
      className="custom-error-banner my-3 shadow-xs rounded-3 overflow-hidden"
      role="alert"
      aria-live="assertive"
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #fecaca',
        borderLeft: '4.5px solid #ef4444',
        padding: '0.95rem 1.25rem',
        animation: 'slideDownAlert 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <div className="d-flex align-items-start gap-2.5">
        {/* Modern Alert Icon */}
        <div
          className="d-flex align-items-center justify-content-center rounded-circle flex-shrink-0 shadow-xs"
          style={{
            width: '34px',
            height: '34px',
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            marginTop: '1px'
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        {/* Error Main Body */}
        <div className="flex-grow-1 min-w-0">
          {/* Header Bar with Title, Badges, and Action Buttons */}
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-1">
            <div className="d-flex align-items-center gap-1.5 flex-wrap">
              <span className="fw-bold text-dark" style={{ fontSize: '0.93rem', letterSpacing: '-0.01em' }}>
                {errorTitle}
              </span>

              {status && (
                <span
                  className="badge font-monospace px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: '#fee2e2', color: '#991b1b', fontSize: '0.7rem' }}
                >
                  HTTP {status}
                </span>
              )}

              {providerBadge && (
                <span
                  className="badge font-monospace px-1.5 py-0.5 rounded text-white"
                  style={{ backgroundColor: '#dc2626', fontSize: '0.7rem' }}
                >
                  {providerBadge}
                </span>
              )}

              {code && !providerBadge && (
                <span
                  className="badge font-monospace px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: '0.7rem' }}
                >
                  {code}
                </span>
              )}
            </div>

            {/* Quick Actions: Retry and Dismiss */}
            <div className="d-flex align-items-center gap-2">
              {(code === 'SESSION_EXPIRED' || status === 401) && (
                <a
                  href="/login"
                  className="btn btn-sm btn-danger py-0.5 px-2.5 rounded-pill fw-semibold shadow-xs d-flex align-items-center gap-1 text-decoration-none"
                  style={{ fontSize: '0.75rem', minHeight: '26px' }}
                >
                  🔑 Verify OTP Again
                </a>
              )}
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="btn btn-sm btn-outline-danger py-0.5 px-2.5 rounded-pill fw-semibold shadow-xs d-flex align-items-center gap-1"
                  style={{ fontSize: '0.75rem', minHeight: '26px' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                  </svg>
                  Retry Now
                </button>
              )}

              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="btn btn-link btn-sm text-secondary p-0 text-decoration-none d-flex align-items-center justify-content-center"
                style={{ width: '22px', height: '22px', fontSize: '0.95rem', lineHeight: 1 }}
                title="Dismiss message"
                aria-label="Dismiss alert"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Primary Message */}
          <div className="text-secondary mb-1" style={{ fontSize: '0.86rem', lineHeight: '1.45' }}>
            {rawMessage}
          </div>

          {/* Simple Inline User Tip (Clean and compact) */}
          {userTip && (
            <div className="text-muted d-flex align-items-baseline gap-1.5 mt-1" style={{ fontSize: '0.8rem' }}>
              <span className="flex-shrink-0" style={{ fontSize: '0.85rem' }}>💡</span>
              <span style={{ color: '#475569' }}>{userTip}</span>
            </div>
          )}

          {/* Collapsible Diagnostics Toggle */}
          {(rawData || code || status) && (
            <div className="mt-2 pt-1.5 border-top d-flex align-items-center justify-content-between flex-wrap gap-2" style={{ borderColor: '#f1f5f9' }}>
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="btn btn-link btn-sm p-0 text-secondary text-decoration-none"
                style={{ fontSize: '0.74rem' }}
              >
                {showDetails ? '▴ Hide Technical Diagnostics' : '▾ View Technical Diagnostics'}
              </button>

              {showDetails && (
                <button
                  type="button"
                  onClick={handleCopyDiagnostics}
                  className="btn btn-link btn-sm p-0 text-primary text-decoration-none fw-semibold"
                  style={{ fontSize: '0.74rem' }}
                >
                  {copied ? '✓ Copied to clipboard!' : 'Copy Diagnostics'}
                </button>
              )}
            </div>
          )}

          {/* Collapsed Diagnostics Panel */}
          {showDetails && (rawData || code || status) && (
            <pre
              className="p-2.5 rounded-2 mt-2 mb-0 font-monospace text-dark overflow-auto shadow-xs"
              style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', maxHeight: '130px', fontSize: '0.73rem' }}
            >
              <code>{JSON.stringify({ code, status, data: rawData || null }, null, 2)}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
