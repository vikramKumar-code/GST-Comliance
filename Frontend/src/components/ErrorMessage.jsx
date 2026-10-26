export default function ErrorMessage({ error, onRetry }) {
  if (!error) return null;

  const message = typeof error === 'string' ? error : error.message || 'An unexpected error occurred.';
  const code = error?.code;
  const status = error?.status;
  const rawData = error?.data;

  // Safe provider error detection
  let providerBadge = null;
  const lowerMsg = String(message).toLowerCase();
  if (lowerMsg.includes('portal user is not registered') || code === 'AUTH4037') {
    providerBadge = 'AUTH4037';
  } else if (lowerMsg.includes('expired or was not found') || code === 'GSP053') {
    providerBadge = 'GSP053';
  } else if (code === 'PROVIDER_DOWN' || lowerMsg.includes('unavailable') || code === 'GSP032') {
    providerBadge = 'GSP032';
  } else if (code === 'DATA_NOT_AVAILABLE' || lowerMsg.includes('not available yet') || code === 'RET2B1023') {
    providerBadge = 'RET2B1023';
  }

  return (
    <div
      className="alert alert-danger shadow-sm rounded-3 my-3"
      role="alert"
      aria-live="assertive"
    >
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="fs-5" aria-hidden="true">⚠️</span>
          <div>
            {status && (
              <span className="badge bg-danger-subtle text-danger border border-danger-subtle me-1 font-monospace">
                HTTP {status}
              </span>
            )}
            {providerBadge && (
              <span className="badge bg-danger text-white me-1 font-monospace">
                {providerBadge}
              </span>
            )}
            {code && !providerBadge && (
              <span className="badge bg-danger-subtle text-danger border border-danger-subtle me-1 font-monospace">
                {code}
              </span>
            )}
            <span className="fw-medium text-dark">{message}</span>
          </div>
        </div>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="btn btn-outline-danger btn-sm text-nowrap"
          >
            Retry
          </button>
        )}
      </div>

      {rawData && typeof rawData === 'object' && (
        <details className="mt-2 pt-2 border-top border-danger-subtle small">
          <summary className="text-secondary cursor-pointer" style={{ cursor: 'pointer' }}>
            View Error Envelope
          </summary>
          <pre className="bg-white p-2 rounded border border-danger-subtle font-monospace mt-1 mb-0 small text-danger">
            <code>{JSON.stringify(rawData, null, 2)}</code>
          </pre>
        </details>
      )}
    </div>
  );
}

