import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="container min-vh-100 d-flex align-items-center justify-content-center py-5">
      <div className="card shadow-lg border-0 rounded-4 p-5 text-center" style={{ maxWidth: '480px' }}>
        <h1 className="display-1 fw-bold text-danger mb-2">404</h1>
        <h3 className="fw-bold text-dark mb-3">Page Not Found</h3>
        <p className="text-secondary mb-4">The page or return resource you requested does not exist.</p>
        <div className="d-flex flex-column gap-2 align-items-center">
          <Link to="/dashboard" className="btn btn-primary px-4 py-2 w-100">
            Go to Dashboard
          </Link>
          <Link to="/" className="text-secondary text-decoration-none small mt-2">
            ← Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
