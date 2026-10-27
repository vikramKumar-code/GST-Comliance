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
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="auth-split-wrapper">
      {/* ====================================================================
          LEFT SHOWCASE PANEL (Enterprise Brand & Value Proposition)
          ==================================================================== */}
      <div className="auth-showcase-panel d-none d-lg-flex">
        {/* Top Branding */}
        <div style={{ position: 'relative', zIndex: 2 }}>
          <Link to="/" className="text-decoration-none d-inline-flex align-items-center gap-2 mb-4">
            <span
              className="d-inline-flex align-items-center justify-content-center text-white fw-bold rounded-3 shadow"
              style={{
                width: '44px',
                height: '44px',
                background: 'linear-gradient(135deg, #1fa689 0%, #116957 100%)',
                fontSize: '1.2rem',
                border: '1px solid rgba(255, 255, 255, 0.25)'
              }}
            >
              CT
            </span>
            <span className="fs-3 fw-bold text-white tracking-tight">CandidTax</span>
            <span
              className="badge rounded-pill text-white ms-2 px-2.5 py-1"
              style={{
                background: 'rgba(31, 166, 137, 0.25)',
                border: '1px solid rgba(31, 166, 137, 0.4)',
                fontSize: '0.68rem',
                letterSpacing: '0.04em'
              }}
            >
              GSP Certified
            </span>
          </Link>

          <h2 className="display-6 fw-bold text-white tracking-tight mb-3" style={{ lineHeight: 1.25 }}>
            Automate GST billing, ITC audits & statutory returns.
          </h2>
          <p className="text-white-50 fs-6 mb-5" style={{ maxWidth: '460px', lineHeight: 1.6 }}>
            The enterprise tax compliance platform built for Indian enterprises, MSMEs, and Chartered Accountants.
          </p>

          {/* 3 Pillars of Trust & Capability */}
          <div className="d-flex flex-column gap-3 mb-5">
            <div className="auth-feature-pill">
              <div className="auth-feature-icon">⚡</div>
              <div>
                <h6 className="fw-bold text-white mb-0.5" style={{ fontSize: '0.92rem' }}>
                  Direct GSTN API Gateway
                </h6>
                <p className="text-white-50 small mb-0">
                  Instant secure OTP handshake to auto-fetch GSTR-1, GSTR-3B & 2B without manual portal uploads.
                </p>
              </div>
            </div>

            <div className="auth-feature-pill">
              <div className="auth-feature-icon">🛡️</div>
              <div>
                <h6 className="fw-bold text-white mb-0.5" style={{ fontSize: '0.92rem' }}>
                  DRC-01B & 01C Notice Shield
                </h6>
                <p className="text-white-50 small mb-0">
                  Automated reconciliation flags mismatches in real-time before departmental notices are triggered.
                </p>
              </div>
            </div>

            <div className="auth-feature-pill">
              <div className="auth-feature-icon">🔒</div>
              <div>
                <h6 className="fw-bold text-white mb-0.5" style={{ fontSize: '0.92rem' }}>
                  Bank-Grade Cryptographic Vault
                </h6>
                <p className="text-white-50 small mb-0">
                  AES-256 session token encryption, role-based team permissions, and tamper-proof audit trails.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Social Proof & Trust Card */}
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div
            className="p-3.5 rounded-3 mb-4"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(10px)'
            }}
          >
            <div className="d-flex align-items-center gap-2 mb-1.5">
              <div className="text-warning small">★★★★★</div>
              <span className="text-white fw-bold small">4.9 / 5 Rating</span>
              <span className="text-white-50 small">• 1,200+ Verified CAs</span>
            </div>
            <p className="text-white-50 small mb-0" style={{ lineHeight: 1.5 }}>
              &ldquo;CandidTax cut down our monthly GST reconciliation from 3 full days to under 15 minutes. An indispensable tool for serious tax professionals.&rdquo;
            </p>
          </div>

          <div className="d-flex align-items-center justify-content-between text-white-50 small pt-3 border-top border-white-10">
            <span>ISO 27001 Certified</span>
            <span>•</span>
            <span>SOC 2 Type II Compliant</span>
            <span>•</span>
            <span>99.99% Uptime SLA</span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          RIGHT INTERACTIVE AUTHENTICATION PANEL
          ==================================================================== */}
      <div className="auth-form-panel">
        {/* Top Utility Bar */}
        <div className="d-flex align-items-center justify-content-between pb-3">
          <Link
            to="/"
            className="text-decoration-none text-muted small fw-semibold d-inline-flex align-items-center gap-1.5 transition-all"
            style={{ transition: 'color 0.15s ease' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M12 8a.5.5 0 0 1-.5.5H5.707l3.147 3.146a.5.5 0 0 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L5.707 7.5H11.5a.5.5 0 0 1 .5.5z"/>
            </svg>
            Back to Home
          </Link>

          <div className="small">
            <span className="text-muted">Don&apos;t have an account? </span>
            <Link to="/signup" className="fw-semibold text-primary text-decoration-none">
              Sign up
            </Link>
          </div>
        </div>

        {/* Center Auth Form Container */}
        <div className="auth-form-container my-auto py-4">
          {/* Mobile Brand Indicator */}
          <div className="d-flex d-lg-none align-items-center gap-2 mb-4">
            <span
              className="d-inline-flex align-items-center justify-content-center text-white fw-bold rounded-3 shadow-sm"
              style={{
                width: '38px',
                height: '38px',
                background: 'linear-gradient(135deg, #116957 0%, #0d5345 100%)',
                fontSize: '1rem'
              }}
            >
              CT
            </span>
            <span className="fs-4 fw-bold text-dark tracking-tight">CandidTax</span>
          </div>

          <div className="mb-4">
            <h1 className="fs-3 fw-bold text-dark tracking-tight mb-1">Sign in to CandidTax</h1>
            <p className="text-muted small mb-0">
              Access your compliance workspaces, automated filings, and tax registers.
            </p>
          </div>

          {/* Segmented Auth Method Switcher */}
          <div
            className="d-flex p-1 bg-light rounded-3 mb-4 border"
            style={{ borderColor: '#e2e8f0', background: '#f1f5f9' }}
          >
            <button
              type="button"
              onClick={() => { setActiveTab('account'); setError(''); }}
              className={`btn btn-sm flex-fill fw-semibold py-2 border-0 transition-all ${
                activeTab === 'account'
                  ? 'btn-primary shadow-xs'
                  : 'text-secondary bg-transparent'
              }`}
              style={{ borderRadius: '7px' }}
            >
              <span className="me-1.5">✉️</span> Email & Google
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('gstin'); setError(''); }}
              className={`btn btn-sm flex-fill fw-semibold py-2 border-0 transition-all ${
                activeTab === 'gstin'
                  ? 'btn-primary shadow-xs'
                  : 'text-secondary bg-transparent'
              }`}
              style={{ borderRadius: '7px' }}
            >
              <span className="me-1.5">🏢</span> GSTIN Portal OTP
            </button>
          </div>

          {error && (
            <div className="alert alert-danger py-2.5 px-3 small rounded-3 mb-3.5 d-flex align-items-center gap-2" role="alert">
              <span className="fs-6">⚠️</span>
              <span className="fw-medium">{error}</span>
            </div>
          )}

          {activeTab === 'account' ? (
            <div>
              {/* Google OAuth Button */}
              <GoogleLoginButton onError={(err) => setError(err?.message || 'Google sign-in failed')} />

              {/* Elegant Divider */}
              <div className="d-flex align-items-center my-3.5">
                <div className="flex-grow-1 border-bottom" style={{ borderColor: '#e2e8f0' }} />
                <span
                  className="px-3 text-muted fw-bold text-uppercase text-nowrap"
                  style={{ fontSize: '0.68rem', letterSpacing: '0.08em' }}
                >
                  Or continue with email
                </span>
                <div className="flex-grow-1 border-bottom" style={{ borderColor: '#e2e8f0' }} />
              </div>

              <form onSubmit={handleAccountSubmit}>
                {/* Email Field with Icon */}
                <div className="mb-3">
                  <label className="form-label">Email Address</label>
                  <div className="auth-input-wrapper">
                    <span className="auth-input-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="form-control"
                      autoComplete="username"
                    />
                  </div>
                </div>

                {/* Password Field with Eye Toggle */}
                <div className="mb-3.5">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <label className="form-label mb-0">Password</label>
                    <span className="text-muted small" style={{ fontSize: '0.78rem' }}>
                      Forgot password?
                    </span>
                  </div>
                  <div className="auth-input-wrapper">
                    <span className="auth-input-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="form-control"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="auth-eye-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Remember Device Checkbox */}
                <div className="form-check mb-4">
                  <input className="form-check-input" type="checkbox" id="rememberMe" defaultChecked />
                  <label className="form-check-label small text-secondary" htmlFor="rememberMe">
                    Remember this device for 30 days
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary w-100 py-2.5 fw-semibold shadow-xs"
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign In to Portal
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="ms-2">
                        <path fillRule="evenodd" d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z"/>
                      </svg>
                    </>
                  )}
                </button>
              </form>
            </div>
          ) : (
            <div>
              <GstinForm key={queryGstin} initialGstin={queryGstin} onOtpSent={handleOtpSent} />
            </div>
          )}
        </div>

        {/* Bottom Trust & Legal Footer */}
        <div className="pt-4 border-top" style={{ borderColor: '#e2e8f0' }}>
          <div className="d-flex flex-column flex-sm-row align-items-center justify-content-between gap-2 text-muted small" style={{ fontSize: '0.78rem' }}>
            <span className="d-flex align-items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-success">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Bank-grade 256-bit SSL encrypted
            </span>
            <span>&copy; {new Date().getFullYear()} CandidTax Systems Pvt Ltd</span>
          </div>
        </div>
      </div>
    </div>
  );
}
