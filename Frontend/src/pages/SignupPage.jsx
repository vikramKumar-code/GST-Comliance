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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { loginSuccess } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

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
    <div
      className="d-flex align-items-center justify-content-center min-vh-100 py-5 px-3"
      style={{
        background: 'radial-gradient(ellipse at 50% 20%, rgba(17, 105, 87, 0.08), transparent 70%), #f8fafc'
      }}
    >
      <div className="w-100" style={{ maxWidth: '460px' }}>
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
          <h1 className="fs-4 fw-bold text-dark mb-1">Create your account</h1>
          <p className="text-muted small mb-0">Start managing your GST invoices and automated returns</p>
        </div>

        {/* Card */}
        <div className="card shadow-md border-0 rounded-4 overflow-hidden">
          <div className="card-body p-4 p-sm-4.5">
            {error && (
              <div className="alert alert-danger py-2.5 px-3 small rounded-3 mb-3 d-flex align-items-center gap-2" role="alert">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <GoogleLoginButton onError={(err) => setError(err?.message || 'Google signup failed')} />

            {/* Divider */}
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

            <form onSubmit={handleSubmit}>
              <div className="mb-3">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Vikram Kumar"
                  className="form-control"
                />
              </div>

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

              <div className="row g-2 mb-3.5">
                <div className="col-12 col-sm-6">
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 chars"
                    className="form-control"
                  />
                </div>
                <div className="col-12 col-sm-6">
                  <label className="form-label">Confirm</label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="form-control"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-100 py-2.5 fw-semibold shadow-xs"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            <div className="text-center mt-4 pt-3 border-top small" style={{ borderColor: '#e2e8f0' }}>
              <p className="text-muted mb-2">
                Already have an account?{' '}
                <Link to="/login" className="fw-semibold text-primary text-decoration-none">
                  Sign In
                </Link>
              </p>
              <Link to="/" className="text-secondary text-decoration-none small">
                ← Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
