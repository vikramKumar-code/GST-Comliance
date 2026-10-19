import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="d-flex flex-column min-vh-100 bg-light text-dark">
      <nav className="navbar navbar-expand bg-white border-bottom border-light-subtle sticky-top px-3 py-2 shadow-sm">
        <div className="container">
          <Link to="/dashboard" className="navbar-brand d-flex align-items-center gap-2 fw-bold text-dark">
            <span className="badge bg-primary fs-6 px-2.5 py-1.5 rounded-3">GST</span>
            <span className="fs-5">Compliance Portal</span>
          </Link>
          {user && (
            <div className="d-flex align-items-center gap-3">
              <span className="badge bg-light text-secondary border px-3 py-2 font-monospace">
                GSTIN: <span className="text-primary fw-bold">{user.gstin}</span>
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="btn btn-outline-danger btn-sm rounded-3"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="flex-grow-1">
        {children || <Outlet />}
      </main>

      <footer className="bg-white border-top border-light-subtle py-3 text-secondary small">
        <div className="container d-flex justify-content-between align-items-center flex-wrap gap-2">
          <p className="mb-0 text-muted">© {new Date().getFullYear()} GST Taxpayer Compliance & Analytics</p>
          <div className="d-flex gap-3">
            <Link to="/" className="text-secondary text-decoration-none">Home</Link>
            <Link to="/privacy" className="text-secondary text-decoration-none">Privacy</Link>
            <Link to="/terms" className="text-secondary text-decoration-none">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
