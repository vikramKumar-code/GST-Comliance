import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signup } from '../api/auth.api';
import { useAuth } from '../context/AuthContext';
import GoogleLoginButton from '../components/GoogleLoginButton';
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Building2,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Check
} from 'lucide-react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';

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
    <div className="min-h-screen flex bg-white">
      {/* ====================================================================
          LEFT SHOWCASE PANEL (Enterprise Brand & Value Proposition)
          ==================================================================== */}
      <div className="hidden lg:flex lg:w-5/12 xl:w-5/12 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white p-12 flex-col justify-between relative overflow-hidden border-r border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none opacity-60" />
        <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top Branding */}
        <div className="relative z-10">
          <Link to="/" className="inline-flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-brand-600 to-teal-500 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-brand-900/30 border border-white/20">
              CT
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">CandidTax</span>
            <Badge variant="fintech" size="sm" className="font-mono text-[10px]">
              14-Day Free Trial
            </Badge>
          </Link>

          <h2 className="text-3xl font-extrabold tracking-tight text-white leading-tight mb-4">
            Empower your business with next-gen GST intelligence.
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-8 max-w-md">
            Set up in 60 seconds. Connect your GSTIN, invite your accountant team, and reconcile ₹ Crores with zero manual errors.
          </p>

          {/* 3 Pillars of Trust & Capability */}
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-brand-500/20 text-brand-400 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white mb-0.5">
                  No Credit Card Required
                </h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Full enterprise tier access unlocked instantly for 14 days. Seamlessly cancel anytime.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white mb-0.5">
                  Multi-GSTIN Workspace Hierarchy
                </h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Manage multiple state branches, clients, or group companies with isolated access roles.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white mb-0.5">
                  Direct GSP Gateway Handshake
                </h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Official FinAgg / TaxPro pipeline for live e-invoicing, IRN generation, and e-way bills.
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
              <span className="text-slate-400 text-xs">• Enterprise Scale</span>
            </div>
            <p className="text-slate-300 text-xs leading-relaxed italic">
              &ldquo;The fastest onboarding in Indian B2B fintech. We connected our Karnataka and Maharashtra GSTINs in 2 minutes.&rdquo;
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
          RIGHT REGISTRATION FORM PANEL
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
            <span className="text-slate-500">Already have an account? </span>
            <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700 hover:underline">
              Sign in
            </Link>
          </div>
        </div>

        {/* Center Auth Form Container */}
        <div className="w-full max-w-md mx-auto my-auto py-2">
          {/* Mobile Brand Indicator */}
          <div className="flex lg:hidden items-center justify-between mb-6">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-brand-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
                CT
              </div>
              <span className="text-xl font-bold tracking-tight text-slate-900">CandidTax</span>
            </div>
            <Badge variant="fintech" size="sm">14-Day Trial</Badge>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your CandidTax Account</h1>
            <p className="text-xs text-slate-500 mt-1">
              Start your 14-day free trial. No credit card required.
            </p>
          </div>

          {/* Registration Error Notification */}
          {error && (
            <div className="p-3.5 rounded-xl bg-danger-50 border border-danger-200 text-danger-700 text-xs flex items-center gap-2.5 mb-4">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-4">
            {/* Google OAuth Button */}
            <GoogleLoginButton onError={(err) => setError(err?.message || 'Google signup failed')} />

            {/* Divider */}
            <div className="relative flex items-center justify-center my-3.5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-surface-border" />
              </div>
              <span className="relative bg-white px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Or register with email
              </span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Full Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Full Name
                </label>
                <div className="relative flex items-center">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Vikram Kumar"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-surface-border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
                  />
                </div>
              </div>

              {/* Work Email */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Work Email Address
                </label>
                <div className="relative flex items-center">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="vikram@enterprise.com"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-surface-border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full pl-9 pr-10 py-2 text-xs rounded-xl border border-surface-border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 p-0.5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Confirm Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-surface-border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              {/* Terms Checkbox */}
              <div className="flex items-start gap-2 pt-1 text-xs">
                <input
                  type="checkbox"
                  id="agreeTerms"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-0.5 rounded border-surface-border text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
                <label htmlFor="agreeTerms" className="text-[11px] text-slate-600 leading-snug select-none cursor-pointer">
                  I agree to the{' '}
                  <Link to="/terms" className="text-brand-600 hover:underline">Terms of Service</Link>{' '}
                  and{' '}
                  <Link to="/privacy" className="text-brand-600 hover:underline">Privacy Policy</Link>.
                </label>
              </div>

              <Button
                type="submit"
                variant="fintech"
                className="w-full justify-center py-2.5 mt-2"
                disabled={loading}
              >
                {loading ? (
                  <span>Creating Workspace...</span>
                ) : (
                  <>
                    <span>Create Free Workspace</span>
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
