import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import GstinForm from '../components/GstinForm';
import GoogleLoginButton from '../components/GoogleLoginButton';
import { signin } from '../api/auth.api';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const queryGstin = (searchParams.get('gstin') || '').toUpperCase();
  const defaultTab = queryGstin ? 'gstin' : 'account';
  const [activeTab, setActiveTab] = useState(defaultTab);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const navigate = useNavigate();
  const { loginSuccess } = useAuth();

  const handleOtpSent = (stateData) => {
    navigate('/otp', { state: stateData });
  };

  const handleAccountSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await signin({ email, password });
      if (res && res.success) {
        loginSuccess(res);
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err?.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container min-vh-100 d-flex align-items-center justify-content-center py-5">
      <div className="row justify-content-center w-100">
        <div className="col-12 col-md-8 col-lg-6 col-xl-5">
          <div className="card shadow-sm border rounded-4 p-2 bg-white">
            <div className="card-body p-4 p-sm-5">
              <div className="text-center mb-4">
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-2 fs-6 rounded-pill mb-3">
                  Authentication Portal
                </span>
                <h1 className="fw-bold fs-3 text-dark mb-1">Welcome Back</h1>
                <p className="text-muted small mb-0">
                  Access your GST compliance suite and filings
                </p>
              </div>

              {/* Navigation Tabs */}
              <ul className="nav nav-pills nav-fill bg-light p-1 rounded-3 mb-4">
                <li className="nav-item">
                  <button
                    type="button"
                    onClick={() => { setActiveTab('account'); setError(''); }}
                    className={`nav-link py-2 small fw-semibold ${activeTab === 'account' ? 'active shadow-sm' : 'text-secondary'}`}
                  >
                    Email / Google
                  </button>
                </li>
                <li className="nav-item">
                  <button
                    type="button"
                    onClick={() => { setActiveTab('gstin'); setError(''); }}
                    className={`nav-link py-2 small fw-semibold ${activeTab === 'gstin' ? 'active shadow-sm' : 'text-secondary'}`}
                  >
                    GSTIN OTP
                  </button>
                </li>
              </ul>

              {error && (
                <div className="alert alert-danger py-2 px-3 small rounded-3 mb-3" role="alert">
                  {error}
                </div>
              )}

              {activeTab === 'account' ? (
                <div>
                  <GoogleLoginButton onError={(err) => setError(err?.message || 'Google sign-in failed')} />

                  <div className="position-relative my-4 text-center">
                    <hr className="text-muted" />
                    <span className="position-absolute top-50 start-50 translate-middle bg-white px-3 text-muted small">
                      OR SIGN IN WITH EMAIL
                    </span>
                  </div>

                  <form onSubmit={handleAccountSubmit}>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold text-secondary">Email Address</label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="form-control py-2"
                      />
                    </div>

                    <div className="mb-4">
                      <label className="form-label small fw-semibold text-secondary">Password</label>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="form-control py-2"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="btn btn-primary w-100 py-2 fw-semibold rounded-3 shadow-sm"
                    >
                      {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                  </form>

                  <div className="text-center mt-4 pt-3 border-top small">
                    <p className="text-muted mb-2">
                      Don&apos;t have an account?{' '}
                      <Link to="/signup" className="text-decoration-none fw-semibold">
                        Create Account
                      </Link>
                    </p>
                    <Link to="/" className="text-muted text-decoration-none">
                      ← Back to Home
                    </Link>
                  </div>
                </div>
              ) : (
                <div>
                  <GstinForm key={queryGstin} initialGstin={queryGstin} onOtpSent={handleOtpSent} />

                  <div className="text-center mt-4 pt-3 border-top small">
                    <p className="text-muted mb-2">
                      <strong>Sandbox Mock:</strong> GSTIN: <code>29ABCDE1234F1Z5</code> • OTP: <code>123456</code>
                    </p>
                    <div className="d-flex justify-content-between">
                      <Link to="/" className="text-decoration-none">
                        ← Back to Home
                      </Link>
                      <Link to="/otp" className="text-decoration-none">
                        Already have OTP? Verify →
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
