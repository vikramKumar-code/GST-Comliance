import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

export default function OtpPage() {
  const [otp, setOtp] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const handleVerify = (e) => {
    e.preventDefault();
    const targetUrl = location.state?.from?.pathname || '/dashboard';
    navigate(targetUrl);
  };

  return (
    <div className="container min-vh-100 d-flex align-items-center justify-content-center py-5">
      <div className="row justify-content-center w-100">
        <div className="col-12 col-md-8 col-lg-5 col-xl-4">
          <div className="card shadow-sm border rounded-4 p-2 bg-white">
            <div className="card-body p-4">
              <div className="text-center mb-4">
                <span className="badge bg-info-subtle text-info-emphasis border border-info-subtle px-3 py-2 fs-6 rounded-pill mb-3">
                  Verification
                </span>
                <h2 className="fw-bold fs-3 text-dark mb-1">Enter OTP</h2>
                <p className="text-muted small mb-0">
                  Enter the 6-digit OTP sent to registered mobile/email
                </p>
              </div>

              <form onSubmit={handleVerify}>
                <div className="mb-4">
                  <label htmlFor="otp-input" className="form-label text-secondary small fw-semibold text-center d-block">
                    One-Time Password
                  </label>
                  <input
                    id="otp-input"
                    type="text"
                    placeholder="123456"
                    className="form-control form-control-lg text-center font-monospace fs-3 letter-spacing-lg"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                  />
                  <div className="text-center text-muted small mt-1">Mock OTP: 123456</div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-lg w-100 fw-semibold mb-3"
                  disabled={otp.length < 4}
                >
                  Verify & Open Dashboard
                </button>

                <div className="d-grid">
                  <button type="button" className="btn btn-outline-secondary btn-sm" disabled>
                    Resend OTP (30s)
                  </button>
                </div>
              </form>

              <div className="text-center mt-4 pt-3 border-top small">
                <div className="d-flex justify-content-between">
                  <Link to="/" className="text-decoration-none">
                    ← Home
                  </Link>
                  <Link to="/login" className="text-decoration-none">
                    Back to Login
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
