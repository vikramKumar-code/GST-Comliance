export default function EmptyState({
  title = 'No Data Found',
  message = 'Data for this period is not available yet. Try another month.',
  action = null,
}) {
  return (
    <div
      className="card border text-center py-5 px-4 my-3 bg-white rounded-4 shadow-sm"
      role="status"
      aria-live="polite"
    >
      <div
        className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle bg-light text-secondary"
        style={{ width: '64px', height: '64px', fontSize: '1.75rem' }}
        aria-hidden="true"
      >
        📂
      </div>
      <h4 className="fw-bold text-dark mb-2">{title}</h4>
      <p className="text-secondary mx-auto mb-3" style={{ maxWidth: '440px' }}>
        {message}
      </p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
