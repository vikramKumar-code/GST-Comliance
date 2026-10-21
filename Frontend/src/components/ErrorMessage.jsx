export default function ErrorMessage({ error, onRetry }) {
  if (!error) return null;

  const message = typeof error === 'string' ? error : error.message || 'An unexpected error occurred.';
  const code = error?.code;

  return (
    <div
      className="alert alert-danger d-flex align-items-center justify-content-between my-3 shadow-sm rounded-3"
      role="alert"
      aria-live="assertive"
    >
      <div className="d-flex align-items-center gap-2">
        <span className="fs-5" aria-hidden="true">⚠️</span>
        <div>
          {code && (
            <span className="badge bg-danger-subtle text-danger border border-danger-subtle me-2 font-monospace">
              {code}
            </span>
          )}
          <span className="fw-medium">{message}</span>
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-outline-danger btn-sm ms-3 text-nowrap"
        >
          Retry
        </button>
      )}
    </div>
  );
}
