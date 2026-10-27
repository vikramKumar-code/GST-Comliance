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
    <div
      className="d-flex align-items-center justify-content-center min-vh-100 py-5 px-3"
      style={{
        background: 'radial-gradient(ellipse at 50% 20%, rgba(17, 105, 87, 0.08), transparent 70%), #f8fafc'
      }}
    >
      <div className="w-100" style={{ maxWidth: '440px' }}>
        {/* Brand Header */}
        <div className="text-center mb-4">
          <Link to="/" className="text-decoration-none d-inline-flex align-items-center gap-2 mb-3">
            <span
              className="d-inline-flex align-items-center justify-content-center text-white fw-bold rounded-3 shadow-sm"
              style={{
                width: '42px',
                height: '42px',
                background: 'linear-gradient(135deg, #116957 0%, #0d5345 100%)',
                fontSize: '1.1rem'
              }}
            >
              CT
            </span>
            <span className="fs-3 fw-bold tracking-tight text-dark">CandidTax</span>
          </Link>
          <h1 className="fs-4 fw-bold text-dark mb-1">Welcome back</h1>
          <p className="text-muted small mb-0">Sign in to your GST billing & compliance suite</p>
        </div>

        {/* Card */}
        <div className="card shadow-md border-0 rounded-4 overflow-hidden">
          <div className="card-body p-4 p-sm-4.5">
            {/* Pill Tabs */}
            <div className="d-flex p-1 bg-light rounded-3 mb-4 border" style={{ borderColor: '#e2e8f0' }}>
              <button
                type="button"
                onClick={() => { setActiveTab('account'); setError(''); }}
                className={`btn btn-sm flex-fill fw-semibold py-2 border-0 ${
                  activeTab === 'account'
                    ? 'btn-primary shadow-xs'
                    : 'text-secondary bg-transparent'
                }`}
                style={{ borderRadius: '7px' }}
              >
                Email / Google
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('gstin'); setError(''); }}
                className={`btn btn-sm flex-fill fw-semibold py-2 border-0 ${
                  activeTab === 'gstin'
                    ? 'btn-primary shadow-xs'
                    : 'text-secondary bg-transparent'
                }`}
                style={{ borderRadius: '7px' }}
              >
                GSTIN OTP
              </button>
            </div>

            {error && (
              <div className="alert alert-danger py-2.5 px-3 small rounded-3 mb-3 d-flex align-items-center gap-2" role="alert">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {activeTab === 'account' ? (
              <div>
                <GoogleLoginButton onError={(err) => setError(err?.message || 'Google sign-in failed')} />

                {/* Divider */}
                <div className="d-flex align-items-center my-3.5">
                  <div className="flex-grow-1 border-bottom" style={{ borderColor: '#e2e8f0' }} />
                  <span
                    className="px-3 text-muted fw-bold text-uppercase text-nowrap"
                    style={{ fontSize: '0.68rem', letterSpacing: '0.08em' }}
                  >
                    Or sign in with email
                  </span>
                  <div className="flex-grow-1 border-bottom" style={{ borderColor: '#e2e8f0' }} />
                </div>

                <form onSubmit={handleAccountSubmit}>
                  <div className="mb-3">
                    <label className="form-label">Email Address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="form-control"
                    />
                  </div>

                  <div className="mb-3.5">
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <label className="form-label mb-0">Password</label>
                    </div>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="form-control"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn btn-primary w-100 py-2.5 fw-semibold shadow-xs"
                  >
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>

                <div className="text-center mt-4 pt-3 border-top small" style={{ borderColor: '#e2e8f0' }}>
                  <p className="text-muted mb-2">
                    Don&apos;t have an account?{' '}
                    <Link to="/signup" className="fw-semibold text-primary text-decoration-none">
                      Create Account
                    </Link>
                  </p>
                  <Link to="/" className="text-secondary text-decoration-none small">
                    ← Back to Home
                  </Link>
                </div>
              </div>
            ) : (
              <div>
                <GstinForm key={queryGstin} initialGstin={queryGstin} onOtpSent={handleOtpSent} />

                <div className="text-center mt-4 pt-3 border-top small" style={{ borderColor: '#e2e8f0' }}>
                  <p className="text-muted mb-2">
                    Prefer password login?{' '}
                    <button
                      type="button"
                      onClick={() => setActiveTab('account')}
                      className="btn btn-link p-0 fw-semibold text-primary text-decoration-none small"
                    >
                      Use Email or Google
                    </button>
                  </p>
                  <Link to="/" className="text-secondary text-decoration-none small">
                    ← Back to Home
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
