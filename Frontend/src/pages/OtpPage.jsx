import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OtpForm from '../components/OtpForm';

export default function OtpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { loginSuccess, checkAuth } = useAuth();

  const gstin = location.state?.gstin || '29ABCDE1234F1Z5';
  const username = location.state?.username || 'demouser';
  const legalName = location.state?.legalName || 'Shree Ganesh Enterprises Pvt Ltd';

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
    <div className="auth-split-wrapper">
      {/* ====================================================================
          LEFT SHOWCASE PANEL (Taxpayer 2FA Context & Security Overview)
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
              GSTN Gateway 2FA
            </span>
          </Link>

          <h2 className="display-6 fw-bold text-white tracking-tight mb-3" style={{ lineHeight: 1.25 }}>
            Two-Factor Taxpayer Authentication.
          </h2>
          <p className="text-white-50 fs-6 mb-5" style={{ maxWidth: '460px', lineHeight: 1.6 }}>
            Direct cryptographic session handshake with the Goods & Services Tax Network (GSTN).
          </p>

          {/* Stepper overview */}
          <div className="d-flex flex-column gap-3 mb-5">
            <div className="auth-feature-pill">
              <div className="auth-feature-icon text-success">✓</div>
              <div>
                <h6 className="fw-bold text-white mb-0.5" style={{ fontSize: '0.92rem' }}>
                  GSTIN Verified
                </h6>
                <p className="text-white-50 small mb-0 font-monospace">
                  {gstin}
                </p>
              </div>
            </div>

            <div className="auth-feature-pill" style={{ borderColor: 'rgba(31, 166, 137, 0.4)', background: 'rgba(31, 166, 137, 0.12)' }}>
              <div className="auth-feature-icon">📲</div>
              <div>
                <h6 className="fw-bold text-white mb-0.5" style={{ fontSize: '0.92rem' }}>
                  OTP Dispatched by Portal
                </h6>
                <p className="text-white-50 small mb-0">
                  Transmitted to the authorized signatory mobile & email registered on GSTN.
                </p>
              </div>
            </div>

            <div className="auth-feature-pill">
              <div className="auth-feature-icon">🔒</div>
              <div>
                <h6 className="fw-bold text-white mb-0.5" style={{ fontSize: '0.92rem' }}>
                  6-Hour Secure Working Session
                </h6>
                <p className="text-white-50 small mb-0">
                  Auto-sync invoices, ITC reconciliations, and return ledgers with full audit trails.
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
            <div className="d-flex align-items-center gap-2 mb-1">
              <span className="badge bg-info-subtle text-info border border-info-subtle px-2 py-0.5 rounded-pill small fw-bold">
                Direct GSP Channel
              </span>
              <span className="text-white-50 small">• Encrypted Handshake</span>
            </div>
            <p className="text-white-50 small mb-0" style={{ lineHeight: 1.5 }}>
              All communications are routed through authorized GST Suvidha Providers in full compliance with National Informatics Centre (NIC) guidelines.
            </p>
          </div>

          <div className="d-flex align-items-center justify-content-between text-white-50 small pt-3 border-top border-white-10">
            <span>ISO 27001 Certified</span>
            <span>•</span>
            <span>256-Bit TLS 1.3</span>
            <span>•</span>
            <span>Zero-Knowledge Storage</span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          RIGHT INTERACTIVE OTP VERIFICATION PANEL
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

          <Link
            to="/login"
            className="text-decoration-none text-primary small fw-semibold d-inline-flex align-items-center gap-1"
          >
            Change GSTIN
          </Link>
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
            <div className="d-inline-flex align-items-center gap-2 px-2.5 py-1 rounded-pill bg-primary-subtle text-primary border border-primary-subtle small fw-bold mb-2">
              <span>🔐</span>
              <span>2FA GST Verification</span>
            </div>
            <h1 className="fs-3 fw-bold text-dark tracking-tight mb-1">Enter GST Portal OTP</h1>
            <p className="text-muted small mb-0">
              Enter the 4-8 digit verification code sent to your GST-registered contact.
            </p>
          </div>

          {/* Taxpayer Information Summary Card */}
          <div
            className="p-3 mb-4 rounded-3 border"
            style={{
              backgroundColor: '#f8fafc',
              borderColor: '#e2e8f0'
            }}
          >
            <div className="d-flex align-items-center justify-content-between mb-1.5">
              <span className="text-muted small fw-medium">Target GSTIN:</span>
              <span className="badge bg-success-subtle text-success border border-success-subtle fw-semibold">
                ✓ Ready for Handshake
              </span>
            </div>
            <div className="d-flex justify-content-between align-items-center">
              <span className="font-monospace fw-bold text-dark fs-5 tracking-wide">{gstin}</span>
              <span className="badge bg-light text-secondary border font-monospace">{username}</span>
            </div>
            {legalName && (
              <div className="text-secondary small fw-medium mt-1 pt-1 border-top border-slate-200">
                🏢 {legalName}
              </div>
            )}
          </div>

          {/* OTP Verification Form */}
          <OtpForm gstin={gstin} username={username} onSuccess={handleSuccess} />
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
