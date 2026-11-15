import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import GoogleLoginButton from '../components/GoogleLoginButton';
import { signin } from '../api/auth.api';
import { useAuth } from '../context/AuthContext';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Zap,
  AlertCircle,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const { loginSuccess } = useAuth();

  // ✅ Get redirect path from location state
  const from = location.state?.from?.pathname || '/dashboard';

  // ✅ Auto-clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // ✅ Email validation
  const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleAccountSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    // ✅ Client-side validation
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);

    try {
      const res = await signin({
        email,
        password,
        rememberMe // ✅ Pass remember preference to backend
      });

      if (res && res.success) {
        setSuccess(true);
        loginSuccess(res);

        // ✅ Show success message briefly before redirect
        setTimeout(() => {
          if (res.isSuperAdmin || res.user?.isSuperAdmin || res.user?.systemRole === 'SUPER_ADMIN') {
            navigate('/admin', { replace: true });
          } else {
            navigate(from, { replace: true }); // ✅ Redirect to intended page
          }
        }, 800);
      }
    } catch (err) {
      // ✅ More specific error messages
      const errorCode = err?.code || err?.response?.data?.code;
      let errorMessage = 'Invalid email or password. Please try again.';

      switch (errorCode) {
        case 'ACCOUNT_LOCKED':
          errorMessage = 'Your account has been locked due to too many failed attempts. Please try again in 15 minutes.';
          break;
        case 'EMAIL_NOT_VERIFIED':
          errorMessage = 'Please verify your email address before signing in.';
          break;
        case 'ACCOUNT_DISABLED':
          errorMessage = 'Your account has been disabled. Please contact support.';
          break;
        case 'INVALID_CREDENTIALS':
          errorMessage = 'Invalid email or password. Please check your credentials and try again.';
          break;
        case 'NETWORK_ERROR':
          errorMessage = 'Network error. Please check your internet connection and try again.';
          break;
        case 'SERVER_ERROR':
          errorMessage = 'Server is temporarily unavailable. Please try again in a few moments.';
          break;
        default:
          errorMessage = err?.message || errorMessage;
      }

      setError(errorMessage);

      // ✅ Focus on password field after error for quick retry
      document.getElementById('password')?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    // ✅ Navigate to forgot password page
    navigate('/forgot-password', {
      state: { email } // Pre-fill email if available
    });
  };

  return (
    <div className="min-h-screen flex bg-white">
      {/* ====================================================================
          LEFT SHOWCASE PANEL (Enterprise Fintech Theme)
          ==================================================================== */}
      <div className="hidden lg:flex lg:w-5/12 xl:w-5/12 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white p-12 flex-col justify-between relative overflow-hidden border-r border-slate-800">
        {/* Subtle grid background pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none opacity-60" />
        <div className="absolute top-1/4 -left-20 w-80 h-80 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top Branding */}
        <div className="relative z-10">
          <Link to="/" className="inline-flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-brand-600 to-teal-500 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-brand-900/30 border border-white/20">
              CT
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">CandidTax</span>
            <Badge variant="fintech" size="sm" className="font-mono text-[10px]">
              GSP Certified
            </Badge>
          </Link>

          <h2 className="text-3xl font-extrabold tracking-tight text-white leading-tight mb-4">
            Automate GST billing, ITC audits & statutory returns.
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-8 max-w-md">
            The enterprise tax compliance platform built for Indian enterprises, MSMEs, and Chartered Accountants.
          </p>

          {/* 3 Pillars of Trust & Capability */}
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-brand-500/20 text-brand-400 flex items-center justify-center shrink-0 mt-0.5">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white mb-0.5">
                  Direct GSTN API Gateway
                </h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Instant secure OTP handshake to auto-fetch GSTR-1, GSTR-3B & 2B without manual portal uploads.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white mb-0.5">
                  DRC-01B & 01C Notice Shield
                </h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Automated reconciliation flags mismatches in real-time before departmental notices are triggered.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white mb-0.5">
                  Bank-Grade Cryptographic Vault
                </h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  AES-256 session token encryption, role-based team permissions, and tamper-proof audit trails.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Social Proof */}
        <div className="relative z-10 pt-6">
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs mb-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex text-amber-400 text-xs">
                {'★'.repeat(5)}
              </div>
              <span className="text-white font-bold text-xs">4.9 / 5 Rating</span>
              <span className="text-slate-400 text-xs">• 1,200+ Verified CAs</span>
            </div>
            <p className="text-slate-300 text-xs leading-relaxed italic">
              &ldquo;CandidTax cut down our monthly GST reconciliation from 3 full days to under 15 minutes. An indispensable tool for serious tax professionals.&rdquo;
            </p>
          </div>

          <div className="flex items-center justify-between text-slate-500 text-[11px] pt-3 border-t border-white/10">
            <span>ISO 27001 Certified</span>
            <span>•</span>
            <span>SOC 2 Type II Compliant</span>
            <span>•</span>
            <span>99.99% Uptime SLA</span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          RIGHT AUTHENTICATION FORM PANEL
          ==================================================================== */}
      <div className="flex-1 flex flex-col justify-between p-6 sm:p-10 lg:p-14 overflow-y-auto">
        {/* Top Utility Bar */}
        <div className="flex items-center justify-between pb-6">
          <Link
            to="/"
            className="text-slate-500 hover:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Home</span>
          </Link>

          <div className="text-xs">
            <span className="text-slate-500">Don&apos;t have an account? </span>
            <Link to="/signup" className="font-semibold text-brand-600 hover:text-brand-700 hover:underline">
              Sign up
            </Link>
          </div>
        </div>

        {/* Center Auth Form Container */}
        <div className="w-full max-w-md mx-auto my-auto py-4">
          {/* Mobile Brand Indicator */}
          <div className="flex lg:hidden items-center justify-between mb-6">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-brand-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
                CT
              </div>
              <span className="text-xl font-bold tracking-tight text-slate-900">CandidTax</span>
            </div>
            <Badge variant="fintech" size="sm">GSP Certified</Badge>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to CandidTax</h1>
            <p className="text-xs text-slate-500 mt-1">
              Access your compliance workspaces, automated filings, and tax registers.
            </p>
          </div>

          {/* ✅ Success Notification */}
          {success && (
            <div
              className="p-3.5 rounded-xl bg-success-50 border border-success-200 text-success-700 text-xs flex items-center gap-2.5 mb-4"
              role="alert"
              aria-live="polite"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Login successful! Redirecting...</span>
            </div>
          )}

          {/* ✅ Error Notification with auto-dismiss */}
          {error && (
            <div
              className="p-3.5 rounded-xl bg-danger-50 border border-danger-200 text-danger-700 text-xs flex items-start gap-2.5 mb-4"
              role="alert"
              aria-live="assertive"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError('')}
                className="text-danger-500 hover:text-danger-700 font-bold"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          <div className="space-y-4">
            {/* Google OAuth Button */}
            <GoogleLoginButton onError={(err) => setError(err?.message || 'Google sign-in failed')} />

            {/* Divider */}
            <div className="relative flex items-center justify-center my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-surface-border" />
              </div>
              <span className="relative bg-white px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Or continue with email
              </span>
            </div>

            <form onSubmit={handleAccountSubmit} className="space-y-3.5" noValidate>
              {/* Email Field */}
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Email Address
                </label>
                <div className="relative flex items-center">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-surface-border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
                    autoComplete="username"
                    disabled={loading}
                    aria-invalid={error ? 'true' : 'false'}
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                </div>
              </div>

              {/* Password Field */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label htmlFor="password" className="block text-xs font-semibold text-slate-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-[11px] text-brand-600 hover:text-brand-700 font-semibold hover:underline focus:outline-none focus:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-9 pr-10 py-2.5 text-xs rounded-xl border border-surface-border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
                    autoComplete="current-password"
                    disabled={loading}
                    aria-invalid={error ? 'true' : 'false'}
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                  <button
                    type="button"
                    className="absolute right-3 p-0.5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* ✅ Remember Device Checkbox (Functional) */}
              <div className="flex items-center gap-2 pt-1 text-xs">
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-surface-border text-brand-600 focus:ring-brand-500 cursor-pointer"
                  disabled={loading}
                />
                <label htmlFor="rememberMe" className="text-[11px] text-slate-600 select-none cursor-pointer">
                  Remember this device for 30 days
                </label>
              </div>

              <Button
                type="submit"
                variant="fintech"
                className="w-full justify-center py-2.5"
                disabled={loading || success}
                aria-busy={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing in...</span>
                  </span>
                ) : success ? (
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Success! Redirecting...</span>
                  </span>
                ) : (
                  <>
                    <span>Sign In to Portal</span>
                    <ArrowRight className="w-4 h-4 ml-1.5" />
                  </>
                )}
              </Button>
            </form>
          </div>
        </div>

        {/* Bottom Trust & Legal Footer */}
        <div className="pt-6 border-t border-surface-border">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-slate-400 text-[11px]">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-brand-600" />
              <span>Bank-grade 256-bit SSL encrypted</span>
            </span>
            <span>&copy; {new Date().getFullYear()} CandidTax Systems Pvt Ltd</span>
          </div>
        </div>
      </div>
    </div>
  );
}