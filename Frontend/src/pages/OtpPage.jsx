import { Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OtpForm from '../components/OtpForm';

export default function OtpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { loginSuccess, checkAuth } = useAuth();

  const gstin = location.state?.gstin;
  const username = location.state?.username || 'demouser';
  const legalName = location.state?.legalName;

  // Requirement: If the user opens /otp directly without GSTIN in state, redirect to /login
  if (!gstin) {
    return <Navigate to="/login" replace />;
  }

  const handleSuccess = async (result) => {
    loginSuccess({
      gstin: result?.gstin || gstin,
      expiresAt: result?.expiresAt || new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    });
    // Refresh auth state from server cookie
    await checkAuth().catch(() => {});

    const targetUrl = location.state?.from?.pathname || '/dashboard';
    navigate(targetUrl, { replace: true });
  };

  return (
    <div className="container min-vh-100 d-flex align-items-center justify-content-center py-5">
      <div className="row justify-content-center w-100">
        <div className="col-12 col-md-8 col-lg-6 col-xl-5">
          <div className="card shadow-sm border rounded-4 p-2 bg-white">
            <div className="card-body p-4 p-sm-5">
              <div className="text-center mb-4">
                <span className="badge bg-info-subtle text-info-emphasis border border-info-subtle px-3 py-2 fs-6 rounded-pill mb-3">
                  Two-Factor Authentication
                </span>
                <h1 className="fw-bold fs-3 text-dark mb-1">Verify GST OTP</h1>
                <p className="text-muted small mb-0">
                  Enter the verification code sent to your registered GST mobile/email
                </p>
              </div>

              {/* Taxpayer Information Summary */}
              <div className="alert alert-light border py-2 px-3 mb-4 rounded-3 text-start small">
                <div className="text-muted">Verifying identity for:</div>
                <div className="d-flex justify-content-between align-items-center mt-1">
                  <span className="font-monospace fw-bold text-dark fs-6">{gstin}</span>
                  <span className="badge bg-secondary-subtle text-secondary">{username}</span>
                </div>
                {legalName && (
                  <div className="text-secondary fw-semibold mt-1">
                    🏢 {legalName}
                  </div>
                )}
              </div>

              <OtpForm gstin={gstin} username={username} onSuccess={handleSuccess} />

              <div className="text-center mt-4 pt-3 border-top small">
                <div className="d-flex justify-content-between">
                  <Link to="/" className="text-decoration-none">
                    ← Home
                  </Link>
                  <Link to="/login" className="text-decoration-none">
                    Change GSTIN
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
