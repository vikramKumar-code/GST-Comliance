import { Link } from 'react-router-dom';

/**
 * Reusable AuthLayout for authentication and onboarding pages
 */
export default function AuthLayout({ children, title, subtitle }) {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between relative overflow-hidden select-none">
      {/* Subtle Background Glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Navbar */}
      <header className="p-6 flex items-center justify-between max-w-7xl mx-auto w-full relative z-10">
        <Link to="/" className="flex items-center gap-2.5 text-decoration-none" title="CandidTax Home">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-extrabold text-sm shadow-md"
            style={{ background: 'linear-gradient(135deg, #10b981 0%, #0d6e59 100%)' }}
          >
            CT
          </span>
          <div className="flex flex-col">
            <span className="text-white font-bold text-base tracking-tight leading-none">CandidTax</span>
            <span className="text-emerald-400 text-[10px] tracking-wider uppercase font-mono mt-0.5">
              GST Compliance ERP
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2 text-xs">
          <Link
            to="/pricing"
            className="text-slate-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-800/60 transition text-decoration-none"
          >
            Pricing
          </Link>
          <Link
            to="/"
            className="text-slate-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-800/60 transition text-decoration-none"
          >
            Home
          </Link>
        </div>
      </header>

      {/* Main Card Container */}
      <main className="flex-1 flex items-center justify-center p-4 relative z-10">
        <div className="w-full max-w-md">
          {(title || subtitle) && (
            <div className="text-center mb-6">
              {title && <h1 className="text-2xl font-extrabold text-white tracking-tight">{title}</h1>}
              {subtitle && <p className="text-xs text-slate-400 mt-1.5">{subtitle}</p>}
            </div>
          )}
          {children}
        </div>
      </main>

      {/* Bottom Footer & Compliance Badges */}
      <footer className="p-6 text-center text-xs text-slate-500 relative z-10 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between max-w-7xl mx-auto w-full gap-3">
        <div className="flex items-center gap-2">
          <span className="text-emerald-500">🛡️</span>
          <span>Bank-Grade 256-Bit SSL • GSTN & NIC Compliant</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/privacy" className="text-slate-400 hover:text-slate-200 text-decoration-none">
            Privacy Policy
          </Link>
          <Link to="/terms" className="text-slate-400 hover:text-slate-200 text-decoration-none">
            Terms of Service
          </Link>
          <span>© {new Date().getFullYear()} CandidTax</span>
        </div>
      </footer>
    </div>
  );
}
