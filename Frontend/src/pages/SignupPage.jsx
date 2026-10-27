import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signup } from '../api/auth.api';
import { useAuth } from '../context/AuthContext';
import GoogleLoginButton from '../components/GoogleLoginButton';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { loginSuccess } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!agreeTerms) {
      setError('Please agree to the Terms of Service & Privacy Policy.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);
    try {
      const res = await signup({ name, email, password });
      if (res && res.success) {
        loginSuccess(res);
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err?.message || 'Registration failed. Please try again.');
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
              14-Day Free Trial
            </span>
          </Link>

          <h2 className="display-6 fw-bold text-white tracking-tight mb-3" style={{ lineHeight: 1.25 }}>
            Empower your business with next-gen GST intelligence.
          </h2>
          <p className="text-white-50 fs-6 mb-5" style={{ maxWidth: '460px', lineHeight: 1.6 }}>
            Set up in 60 seconds. Connect your GSTIN, invite your accountant team, and reconcile ₹ Crores with zero manual errors.
          </p>

          {/* 3 Pillars of Trust & Capability */}
          <div className="d-flex flex-column gap-3 mb-5">
            <div className="auth-feature-pill">
              <div className="auth-feature-icon">🚀</div>
              <div>
                <h6 className="fw-bold text-white mb-0.5" style={{ fontSize: '0.92rem' }}>
                  No Credit Card Required
                </h6>
                <p className="text-white-50 small mb-0">
                  Full enterprise tier access unlocked instantly for 14 days. Seamlessly cancel anytime.
                </p>
              </div>
            </div>

            <div className="auth-feature-pill">
              <div className="auth-feature-icon">🏢</div>
              <div>
                <h6 className="fw-bold text-white mb-0.5" style={{ fontSize: '0.92rem' }}>
                  Multi-GSTIN Workspace Hierarchy
                </h6>
                <p className="text-white-50 small mb-0">
                  Manage multiple state branches, clients, or group companies with isolated access roles.
                </p>
              </div>
            </div>

            <div className="auth-feature-pill">
              <div className="auth-feature-icon">⚡</div>
              <div>
                <h6 className="fw-bold text-white mb-0.5" style={{ fontSize: '0.92rem' }}>
                  Real-time GSTR-2B Reconciliation
                </h6>
                <p className="text-white-50 small mb-0">
                  Match supplier invoices down to line-item tax rates and maximize your Input Tax Credit.
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
              <span className="badge bg-success-subtle text-success border border-success-subtle px-2 py-0.5 rounded-pill small fw-bold">
                99.8% Match Accuracy
              </span>
              <span className="text-white-50 small">• Benchmark Audit Rate</span>
            </div>
            <p className="text-white-50 small mb-0" style={{ lineHeight: 1.5 }}>
              &ldquo;Transitioning to CandidTax eliminated ₹4.2 Lakhs in ineligible ITC claims within our first quarter alone.&rdquo;
            </p>
          </div>

          <div className="d-flex align-items-center justify-content-between text-white-50 small pt-3 border-top border-white-10">
            <span>ISO 27001 Certified</span>
            <span>•</span>
            <span>GST Suvidha Provider</span>
            <span>•</span>
            <span>AES-256 Storage</span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          RIGHT INTERACTIVE SIGNUP FORM PANEL
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
            <span className="text-muted">Already have an account? </span>
            <Link to="/login" className="fw-semibold text-primary text-decoration-none">
              Sign in
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
            <h1 className="fs-3 fw-bold text-dark tracking-tight mb-1">Create your account</h1>
            <p className="text-muted small mb-0">
              Get started with automated GST compliance and intelligent invoicing.
            </p>
          </div>

          {error && (
            <div className="alert alert-danger py-2.5 px-3 small rounded-3 mb-3.5 d-flex align-items-center gap-2" role="alert">
              <span className="fs-6">⚠️</span>
              <span className="fw-medium">{error}</span>
            </div>
          )}

          {/* Google Quick Signup */}
          <GoogleLoginButton onError={(err) => setError(err?.message || 'Google sign-up failed')} />

          {/* Elegant Divider */}
          <div className="d-flex align-items-center my-3.5">
            <div className="flex-grow-1 border-bottom" style={{ borderColor: '#e2e8f0' }} />
            <span
              className="px-3 text-muted fw-bold text-uppercase text-nowrap"
              style={{ fontSize: '0.68rem', letterSpacing: '0.08em' }}
            >
              Or register with email
            </span>
            <div className="flex-grow-1 border-bottom" style={{ borderColor: '#e2e8f0' }} />
          </div>

          <form onSubmit={handleSubmit}>
            {/* Full Name Field */}
            <div className="mb-3">
              <label className="form-label">Full Name</label>
              <div className="auth-input-wrapper">
                <span className="auth-input-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Vikram Kumar"
                  className="form-control"
                  autoComplete="name"
                />
              </div>
            </div>

            {/* Email Address Field */}
            <div className="mb-3">
              <label className="form-label">Work Email Address</label>
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
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="mb-3">
              <label className="form-label">Password</label>
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
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="form-control"
                  autoComplete="new-password"
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

            {/* Confirm Password Field */}
            <div className="mb-3.5">
              <label className="form-label">Confirm Password</label>
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
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="form-control"
                  autoComplete="new-password"
                />
              </div>
            </div>

            {/* Terms of Service Checkbox */}
            <div className="form-check mb-4">
              <input
                className="form-check-input"
                type="checkbox"
                id="agreeTerms"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                required
              />
              <label className="form-check-label small text-secondary" htmlFor="agreeTerms">
                I agree to the <span className="text-primary text-decoration-underline cursor-pointer">Terms of Service</span> and <span className="text-primary text-decoration-underline cursor-pointer">Privacy Policy</span>.
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
                  Creating Account...
                </>
              ) : (
                <>
                  Create Account Free
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="ms-2">
                    <path fillRule="evenodd" d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z"/>
                  </svg>
                </>
              )}
            </button>
          </form>
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
