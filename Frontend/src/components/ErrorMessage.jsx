export default function ErrorMessage({ error, onRetry }) {
  if (!error) return null;

  const message = typeof error === 'string' ? error : error.message || 'An unexpected error occurred.';
  const code = error?.code;

  return (
    <div className="alert alert-danger d-flex align-items-center justify-content-between my-3 shadow-sm" role="alert">
      <div className="d-flex align-items-center gap-2">
        <span className="fs-5">⚠️</span>
        <div>
          {code && <span className="badge bg-danger me-2 font-monospace">{code}</span>}
          <span>{message}</span>
        </div>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-outline-danger btn-sm ms-3">
          Retry
        </button>
      )}
    </div>
  );
}
