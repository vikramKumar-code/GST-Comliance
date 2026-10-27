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
    <div className="container min-vh-100 d-flex align-items-center justify-content-center py-5">
      <div className="row justify-content-center w-100">
        <div className="col-12 col-md-8 col-lg-6 col-xl-5">
          <div className="card shadow-sm border rounded-4 p-2 bg-white">
            <div className="card-body p-4 p-sm-5">
              <div className="text-center mb-4">
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-2 fs-6 rounded-pill mb-3">
                  Account Registration
                </span>
                <h1 className="fw-bold fs-3 text-dark mb-1">Get Started</h1>
                <p className="text-muted small mb-0">
                  Create your CandidTax account to manage GST compliance
                </p>
              </div>

              {error && (
                <div className="alert alert-danger py-2 px-3 small rounded-3 mb-3" role="alert">
                  {error}
                </div>
              )}

              <GoogleLoginButton onError={(err) => setError(err?.message || 'Google signup failed')} />

              <div className="position-relative my-4 text-center">
                <hr className="text-muted" />
                <span className="position-absolute top-50 start-50 translate-middle bg-white px-3 text-muted small">
                  OR CONTINUE WITH EMAIL
                </span>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label className="form-label small fw-semibold text-secondary">Full Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Vikram Kumar"
                    className="form-control py-2"
                  />
                </div>

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

                <div className="mb-3">
                  <label className="form-label small fw-semibold text-secondary">Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="form-control py-2"
                  />
                </div>

                <div className="mb-4">
                  <label className="form-label small fw-semibold text-secondary">Confirm Password</label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    className="form-control py-2"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary w-100 py-2 fw-semibold rounded-3 shadow-sm"
                >
                  {loading ? 'Creating Account...' : 'Create Account'}
                </button>
              </form>

              <div className="text-center mt-4 pt-3 border-top small">
                <p className="text-muted mb-2">
                  Already have an account?{' '}
                  <Link to="/login" className="text-decoration-none fw-semibold">
                    Sign In
                  </Link>
                </p>
                <Link to="/" className="text-muted text-decoration-none">
                  ← Back to Home
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
