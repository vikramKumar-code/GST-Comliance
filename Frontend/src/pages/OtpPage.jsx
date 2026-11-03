import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OtpForm from '../components/OtpForm';
import {
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  Smartphone,
  Lock,
  Building2
} from 'lucide-react';
import Badge from '../components/ui/Badge';

export default function OtpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { loginSuccess, checkAuth } = useAuth();

  const gstin = location.state?.gstin || '';
  const username = location.state?.username || '';
  const legalName = location.state?.legalName || '';

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
    <div className="min-h-screen flex bg-white">
      {/* ====================================================================
          LEFT SHOWCASE PANEL (Taxpayer 2FA Context & Security Overview)
          ==================================================================== */}
      <div className="hidden lg:flex lg:w-5/12 xl:w-5/12 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white p-12 flex-col justify-between relative overflow-hidden border-r border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none opacity-60" />
        <div className="absolute top-1/3 -left-20 w-80 h-80 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top Branding */}
        <div className="relative z-10">
          <Link to="/" className="inline-flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-brand-600 to-teal-500 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-brand-900/30 border border-white/20">
              CT
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">CandidTax</span>
            <Badge variant="fintech" size="sm" className="font-mono text-[10px]">
              GSTN Gateway 2FA
            </Badge>
          </Link>

          <h2 className="text-3xl font-extrabold tracking-tight text-white leading-tight mb-4">
            Two-Factor Taxpayer Authentication.
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-8 max-w-md">
            Direct cryptographic session handshake with the Goods & Services Tax Network (GSTN).
          </p>

          {/* Stepper overview */}
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-brand-500/20 text-brand-400 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white mb-0.5">
                  GSTIN Verified
                </h4>
                <p className="text-brand-300 font-mono text-[11px] font-bold">
                  {gstin || '29AABCU9603R1Z2'}
                </p>
                {legalName && (
                  <p className="text-slate-400 text-[10px] mt-0.5">{legalName}</p>
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-brand-500/10 border border-brand-500/30 backdrop-blur-xs flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-brand-500/30 text-brand-300 flex items-center justify-center shrink-0 mt-0.5">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white mb-0.5">
                  OTP Dispatched by Portal
                </h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Transmitted to the authorized signatory mobile & email registered on GSTN.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white mb-0.5">
                  6-Hour Secure Working Session
                </h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Auto-sync invoices, ITC reconciliations, and return ledgers with full audit trails.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Social Proof */}
        <div className="relative z-10 pt-6">
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs mb-4">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="info" size="sm">Direct GSP Channel</Badge>
              <span className="text-slate-400 text-xs">FinAgg Sandbox & Live Gateway</span>
            </div>
            <p className="text-slate-300 text-xs leading-relaxed italic mt-1.5">
              &ldquo;Cryptographic token validation ensures zero raw taxpayer credentials are ever persisted in storage.&rdquo;
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
          RIGHT OTP VERIFICATION PANEL
          ==================================================================== */}
      <div className="flex-1 flex flex-col justify-between p-6 sm:p-10 lg:p-14 overflow-y-auto">
        {/* Top Utility Bar */}
        <div className="flex items-center justify-between pb-6">
          <Link
            to="/login"
            className="text-slate-500 hover:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Sign In</span>
          </Link>

          <div className="text-xs text-slate-400 font-mono">
            Step 2 of 2
          </div>
        </div>

        {/* Center Auth Form Container */}
        <div className="w-full max-w-md mx-auto my-auto py-4">
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-100 text-brand-600 flex items-center justify-center mx-auto mb-3 shadow-xs">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Verify Two-Factor OTP</h1>
            <p className="text-xs text-slate-500 mt-1">
              GSTIN: <strong className="font-mono text-slate-800">{gstin || '29AABCU9603R1Z2'}</strong>
              {username && <span> • User: <strong>{username}</strong></span>}
            </p>
          </div>

          <div className="p-6 bg-white rounded-2xl border border-surface-border shadow-card">
            <OtpForm gstin={gstin} username={username} onSuccess={handleSuccess} />
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
