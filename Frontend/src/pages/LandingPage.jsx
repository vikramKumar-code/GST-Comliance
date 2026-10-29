import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import './landing.css';

export default function LandingPage() {
  const [gstinInput, setGstinInput] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [contactStatus, setContactStatus] = useState(null);
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const handleGstinSubmit = (e) => {
    e.preventDefault();
    const trimmed = gstinInput.trim().toUpperCase();
    if (trimmed) {
      navigate(`/login?gstin=${encodeURIComponent(trimmed)}`);
    } else {
      navigate('/login');
    }
  };

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setContactSubmitting(true);
    setContactStatus(null);
    try {
      const result = await client.post('/contact', contactForm);
      setContactStatus({ success: true, message: result?.message || 'Thank you! Our compliance team will get in touch with you shortly.' });
      setContactForm({ name: '', email: '', subject: '', message: '' });
    } catch (error) {
      setContactStatus({ success: false, message: error.message || 'Could not send your message. Please try again.' });
    } finally {
      setContactSubmitting(false);
    }
  };

  return (
    <div className="landing-wrapper">
      {/* ====================================================================
          STICKY ENTERPRISE NAVBAR
          ==================================================================== */}
      <header className="landing-navbar">
        <div className="container d-flex justify-content-between align-items-center">
          <Link to="/" className="landing-brand">
            <span className="brand-mark">CT</span>
            <div className="brand-copy">
              CandidTax
              <small>Enterprise GST & Compliance</small>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="landing-nav-links d-none d-lg-flex">
            <a href="#features" className="landing-nav-link">Features</a>
            <a href="#workflow" className="landing-nav-link">How it Works</a>
            <a href="#security" className="landing-nav-link">Security</a>
            <a href="#contact" className="landing-nav-link">Contact</a>
          </nav>

          {/* Desktop Auth CTAs */}
          <div className="d-none d-lg-flex align-items-center gap-2.5">
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn btn-primary px-3.5 shadow-sm">
                <span>Go to Dashboard</span>
                <span>→</span>
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-outline-primary px-3">
                  Sign In
                </Link>
                <Link to="/signup" className="btn btn-primary px-3.5 shadow-sm">
                  <span>Get Started Free</span>
                  <span>→</span>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Hamburger Toggle Button */}
          <button
            type="button"
            className="btn btn-light d-lg-none p-2 border"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Collapsible Mobile Nav Drawer */}
        {mobileMenuOpen && (
          <div className="mobile-nav-drawer d-lg-none mt-2 px-3 py-3 border-top">
            <div className="d-flex flex-column gap-1 mb-3">
              <a
                href="#features"
                className="mobile-nav-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                Features
              </a>
              <a
                href="#workflow"
                className="mobile-nav-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                How it Works
              </a>
              <a
                href="#security"
                className="mobile-nav-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                Security & Compliance
              </a>
              <a
                href="#contact"
                className="mobile-nav-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                Contact Support
              </a>
            </div>
            <div className="d-flex flex-column gap-2 pt-2 border-top">
              {isAuthenticated ? (
                <Link
                  to="/dashboard"
                  className="btn btn-primary w-100 py-2.5 fw-semibold"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Go to Dashboard →
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="btn btn-outline-primary w-100 py-2.5 fw-semibold"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/signup"
                    className="btn btn-primary w-100 py-2.5 fw-semibold shadow-sm"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Get Started Free →
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ====================================================================
          HERO SECTION
          ==================================================================== */}
      <section className="hero-section">
        <div className="container">
          <div className="row align-items-center g-4 g-lg-5">
            {/* Left Content Column */}
            <div className="col-12 col-lg-7 text-center text-lg-start">
              {/* Trust Pill */}
              <div className="d-inline-flex align-items-center gap-2 px-3 py-1.5 rounded-pill bg-white border shadow-xs small fw-bold mb-3">
                <span className="badge rounded-circle bg-success p-1 d-inline-block" style={{ width: '8px', height: '8px' }} />
                <span className="text-dark">Official GSTN Suvidha Integration</span>
                <span className="text-muted d-none d-sm-inline">• TaxPro & FinAGG</span>
              </div>

              {/* Main Headline */}
              <h1 className="hero-title mb-3">
                Enterprise GST Compliance & <br className="d-none d-sm-inline" />
                <span className="gradient-text">Input Tax Credit Automation</span>
              </h1>

              {/* Subtitle */}
              <p className="hero-subtitle mb-4 text-secondary">
                Direct GSTN API sync for GSTR-1, GSTR-2B, and GSTR-3B. Stop manual portal uploads, eliminate DRC-01B notice risks, and reconcile ₹ Crores with zero manual leakage.
              </p>

              {/* Primary Action Buttons */}
              <div className="d-flex align-items-center justify-content-center justify-content-lg-start flex-wrap gap-2.5 mb-4">
                <Link to="/signup" className="btn btn-primary btn-lg px-4 shadow-sm fw-semibold">
                  Start 14-Day Free Trial →
                </Link>
                <Link to="/login" className="btn btn-outline-secondary btn-lg px-3.5 fw-semibold bg-white">
                  Sign In with Email / Google
                </Link>
              </div>

              {/* Value Highlights */}
              <div className="d-flex align-items-center justify-content-center justify-content-lg-start flex-wrap gap-3 text-muted small">
                <span className="d-inline-flex align-items-center gap-1.5">
                  <span className="text-success fw-bold">✓</span> No credit card required
                </span>
                <span className="d-inline-flex align-items-center gap-1.5">
                  <span className="text-success fw-bold">✓</span> 60-second GSTIN setup
                </span>
                <span className="d-inline-flex align-items-center gap-1.5">
                  <span className="text-success fw-bold">✓</span> Bank-grade encryption
                </span>
              </div>
            </div>

            {/* Right Interactive GSTIN Card Column */}
            <div className="col-12 col-lg-5">
              <div className="hero-action-card p-4 p-sm-4 bg-white text-start">
                <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom">
                  <div>
                    <h6 className="fw-bold text-dark mb-0.5">Quick GSTIN Verification</h6>
                    <small className="text-muted">Instant cryptographic handshake</small>
                  </div>
                  <span className="badge bg-success-subtle text-success border border-success-subtle font-monospace small">
                    Live Portal
                  </span>
                </div>

                <form onSubmit={handleGstinSubmit}>
                  <div className="mb-3">
                    <label htmlFor="landing-gstin-input" className="form-label text-dark fw-semibold small mb-1.5">
                      Enter 15-Digit GSTIN
                    </label>
                    <div className="input-group">
                      <input
                        id="landing-gstin-input"
                        type="text"
                        className="form-control font-monospace text-uppercase"
                        placeholder="e.g. 29ABCDE1234F1Z5"
                        maxLength={15}
                        value={gstinInput}
                        onChange={(e) => setGstinInput(e.target.value.toUpperCase())}
                        aria-label="GSTIN Input"
                        style={{ letterSpacing: '0.04em', fontSize: '0.98rem' }}
                      />
                    </div>
                    <div className="form-text small text-muted mt-1.5">
                      We will verify your trade name and dispatch a portal OTP.
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary w-100 py-2.5 fw-semibold shadow-xs mb-3"
                  >
                    Inspect Taxpayer & Returns →
                  </button>
                </form>

                <div className="p-2.5 rounded-3 bg-light border small text-muted text-center">
                  🔒 256-bit SSL encrypted • Official GSTN API gateway integration
                </div>
              </div>
            </div>
          </div>

          {/* Enterprise Metric Counters Strip */}
          <div className="row g-3 mt-4 pt-2">
            <div className="col-6 col-md-3">
              <div className="hero-stat-badge">
                <span className="text-muted small fw-bold text-uppercase mb-1" style={{ letterSpacing: '0.05em' }}>
                  Invoices Processed
                </span>
                <span className="fs-3 fw-bold text-dark font-monospace">₹1,400+ Cr</span>
                <small className="text-success fw-semibold mt-1">Across Indian enterprises</small>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="hero-stat-badge">
                <span className="text-muted small fw-bold text-uppercase mb-1" style={{ letterSpacing: '0.05em' }}>
                  ITC Reconciled
                </span>
                <span className="fs-3 fw-bold text-dark font-monospace">100%</span>
                <small className="text-success fw-semibold mt-1">Zero unclaimed credit</small>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="hero-stat-badge">
                <span className="text-muted small fw-bold text-uppercase mb-1" style={{ letterSpacing: '0.05em' }}>
                  Session Handshake
                </span>
                <span className="fs-3 fw-bold text-dark font-monospace">6 Hours</span>
                <small className="text-primary fw-semibold mt-1">Encrypted GSTN 2FA</small>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="hero-stat-badge">
                <span className="text-muted small fw-bold text-uppercase mb-1" style={{ letterSpacing: '0.05em' }}>
                  Notice Shield
                </span>
                <span className="fs-3 fw-bold text-dark font-monospace">DRC-01B/C</span>
                <small className="text-danger fw-semibold mt-1">Mismatch alerts</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          TRUST STRIP
          ==================================================================== */}
      <section className="trust-strip">
        <div className="container">
          <div className="row g-2 align-items-center text-center text-md-start">
            <div className="col-12 col-md-3 trust-item justify-content-center justify-content-md-start">
              <div className="fs-3">🛡️</div>
              <div>
                <strong className="d-block text-dark small">ISO 27001 Certified</strong>
                <small className="text-muted">Enterprise information security</small>
              </div>
            </div>
            <div className="col-12 col-md-3 trust-item justify-content-center justify-content-md-start">
              <div className="fs-3">🔒</div>
              <div>
                <strong className="d-block text-dark small">AES-256 Vault</strong>
                <small className="text-muted">Cryptographic token security</small>
              </div>
            </div>
            <div className="col-12 col-md-3 trust-item justify-content-center justify-content-md-start">
              <div className="fs-3">⚡</div>
              <div>
                <strong className="d-block text-dark small">99.99% Portal SLA</strong>
                <small className="text-muted">Direct GSP API high availability</small>
              </div>
            </div>
            <div className="col-12 col-md-3 trust-item justify-content-center justify-content-md-start">
              <div className="fs-3">⚖️</div>
              <div>
                <strong className="d-block text-dark small">NIC & GSTN Compliant</strong>
                <small className="text-muted">Certified filing protocols</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          RETURN MODULES & COMPLIANCE FEATURES
          ==================================================================== */}
      <section id="features" className="py-5 bg-white border-bottom">
        <div className="container text-center py-3">
          <div className="d-inline-flex align-items-center gap-2 px-3 py-1 rounded-pill bg-primary-subtle text-primary border border-primary-subtle small fw-bold mb-2">
            <span>📊</span>
            <span>Comprehensive GST Stack</span>
          </div>
          <h2 className="fw-bold text-dark mb-2">Automate Every Aspect of GST Compliance</h2>
          <p className="text-secondary mx-auto mb-5" style={{ maxWidth: '640px' }}>
            Built for modern CFOs, finance teams, and Chartered Accountants who need absolute accuracy and direct government portal synchronization.
          </p>

          <div className="row g-4 text-start">
            {/* GSTR-1 */}
            <div className="col-12 col-md-6 col-lg-4">
              <div className="card h-100 p-4 return-hover-card">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="rounded-3 p-2 fs-4" style={{ background: '#ecfdf5', color: '#059669' }}>
                    📈
                  </div>
                  <span className="badge bg-success-subtle text-success border border-success-subtle fw-semibold">
                    Outward Sales
                  </span>
                </div>
                <h3 className="fs-5 fw-bold text-dark mb-2">GSTR-1 Outward Supplies</h3>
                <p className="text-secondary small mb-3">
                  Auto-aggregate sales invoices grouped by tax slab rate (IGST, CGST, SGST, Cess) with instant B2B, B2C, and export turnover breakdowns.
                </p>
                <ul className="list-unstyled small text-muted mb-0 pt-2 border-top">
                  <li className="mb-1">✓ Real-time HSN/SAC summary aggregation</li>
                  <li>✓ 1-Click bulk payload preparation for GSTN</li>
                </ul>
              </div>
            </div>

            {/* GSTR-2B */}
            <div className="col-12 col-md-6 col-lg-4">
              <div className="card h-100 p-4 return-hover-card">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="rounded-3 p-2 fs-4" style={{ background: '#eff6ff', color: '#2563eb' }}>
                    📥
                  </div>
                  <span className="badge bg-info-subtle text-info-emphasis border border-info-subtle fw-semibold">
                    Inward ITC
                  </span>
                </div>
                <h3 className="fs-5 fw-bold text-dark mb-2">GSTR-2B Auto-Reconciliation</h3>
                <p className="text-secondary small mb-3">
                  Auto-drafted purchase statement matching supplier filings to verify eligible Input Tax Credit and flag non-compliant vendors instantly.
                </p>
                <ul className="list-unstyled small text-muted mb-0 pt-2 border-top">
                  <li className="mb-1">✓ Prevent ITC leakage before filing month-end</li>
                  <li>✓ Zero-error supplier matching & match-status</li>
                </ul>
              </div>
            </div>

            {/* GSTR-3B */}
            <div className="col-12 col-md-6 col-lg-4">
              <div className="card h-100 p-4 return-hover-card">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="rounded-3 p-2 fs-4" style={{ background: '#fef3c7', color: '#d97706' }}>
                    📑
                  </div>
                  <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle fw-semibold">
                    Tax Liabilities
                  </span>
                </div>
                <h3 className="fs-5 fw-bold text-dark mb-2">GSTR-3B Tax Summary</h3>
                <p className="text-secondary small mb-3">
                  Monthly summary statement calculating net cash tax payable after automatically offsetting eligible inward ITC balances.
                </p>
                <ul className="list-unstyled small text-muted mb-0 pt-2 border-top">
                  <li className="mb-1">✓ Section-wise breakdown of tax & interest</li>
                  <li>✓ Exact net cash liability forecast</li>
                </ul>
              </div>
            </div>

            {/* E-Invoicing */}
            <div className="col-12 col-md-6 col-lg-4">
              <div className="card h-100 p-4 return-hover-card">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="rounded-3 p-2 fs-4" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
                    ⚡
                  </div>
                  <span className="badge bg-primary-subtle text-primary border border-primary-subtle fw-semibold">
                    IRP Gateway
                  </span>
                </div>
                <h3 className="fs-5 fw-bold text-dark mb-2">E-Invoice & IRN Generation</h3>
                <p className="text-secondary small mb-3">
                  Generate 64-character Invoice Reference Numbers (IRN) and signed QR codes in milliseconds directly from your billing records.
                </p>
                <ul className="list-unstyled small text-muted mb-0 pt-2 border-top">
                  <li className="mb-1">✓ Instant QR-embedded PDF tax invoices</li>
                  <li>✓ 100% compliant with e-invoicing mandates</li>
                </ul>
              </div>
            </div>

            {/* E-Way Bills */}
            <div className="col-12 col-md-6 col-lg-4">
              <div className="card h-100 p-4 return-hover-card">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="rounded-3 p-2 fs-4" style={{ background: '#fff1f2', color: '#e11d48' }}>
                    🚚
                  </div>
                  <span className="badge bg-danger-subtle text-danger border border-danger-subtle fw-semibold">
                    Logistics
                  </span>
                </div>
                <h3 className="fs-5 fw-bold text-dark mb-2">1-Click E-Way Bill Dispatch</h3>
                <p className="text-secondary small mb-3">
                  Auto-calculate postal pin-code distances and generate official 12-digit E-Way Bills alongside tax invoices for seamless transit.
                </p>
                <ul className="list-unstyled small text-muted mb-0 pt-2 border-top">
                  <li className="mb-1">✓ Auto pin-to-pin distance resolution</li>
                  <li>✓ Part-A and Part-B vehicle assignment</li>
                </ul>
              </div>
            </div>

            {/* Multi-Tenant Workspace */}
            <div className="col-12 col-md-6 col-lg-4">
              <div className="card h-100 p-4 return-hover-card">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="rounded-3 p-2 fs-4" style={{ background: '#f0fdf4', color: '#16a34a' }}>
                    🏢
                  </div>
                  <span className="badge bg-success-subtle text-success border border-success-subtle fw-semibold">
                    CA & Enterprise
                  </span>
                </div>
                <h3 className="fs-5 fw-bold text-dark mb-2">Multi-GSTIN Workspaces</h3>
                <p className="text-secondary small mb-3">
                  Manage multiple branch GSTINs, subsidiaries, and client organizations with seamless 1-click workspace switching and audit trails.
                </p>
                <ul className="list-unstyled small text-muted mb-0 pt-2 border-top">
                  <li className="mb-1">✓ Role-based permissions (Admin, Accountant)</li>
                  <li>✓ Excel & Tally-compatible import / export</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          HOW IT WORKS (3 SIMPLE STEPS)
          ==================================================================== */}
      <section id="workflow" className="py-5 bg-light border-bottom">
        <div className="container text-center py-3">
          <div className="d-inline-flex align-items-center gap-2 px-3 py-1 rounded-pill bg-primary-subtle text-primary border border-primary-subtle small fw-bold mb-2">
            <span>🔄</span>
            <span>Simple Workflow</span>
          </div>
          <h2 className="fw-bold text-dark mb-2">How It Works in 3 Simple Steps</h2>
          <p className="text-secondary mx-auto mb-5" style={{ maxWidth: '580px' }}>
            From GSTIN lookup to automated reconciliation in less than 2 minutes.
          </p>

          <div className="row g-4 text-center">
            <div className="col-12 col-md-4">
              <div className="workflow-step-card h-100">
                <div className="workflow-step-number">1</div>
                <h4 className="fs-5 fw-bold text-dark mb-2">Enter GSTIN & Trade Name</h4>
                <p className="text-secondary small mb-0">
                  Input your 15-character GSTIN. CandidTax connects with the GSTN registry to fetch verified legal taxpayer metadata instantly.
                </p>
              </div>
            </div>

            <div className="col-12 col-md-4">
              <div className="workflow-step-card h-100">
                <div className="workflow-step-number">2</div>
                <h4 className="fs-5 fw-bold text-dark mb-2">Secure OTP Handshake</h4>
                <p className="text-secondary small mb-0">
                  Authenticate your 6-digit OTP received on the registered authorized signatory mobile. Creates an encrypted 6-hour working session.
                </p>
              </div>
            </div>

            <div className="col-12 col-md-4">
              <div className="workflow-step-card h-100">
                <div className="workflow-step-number">3</div>
                <h4 className="fs-5 fw-bold text-dark mb-2">Auto-Audit & Reconcile</h4>
                <p className="text-secondary small mb-0">
                  View aggregated sales, ITC eligible credits, calculate exact tax payable, and generate invoices with automatic GST return mapping.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          ENTERPRISE SECURITY & ARCHITECTURE SECTION
          ==================================================================== */}
      <section id="security" className="py-5 bg-white border-bottom">
        <div className="container py-2">
          <div className="card border bg-light-subtle rounded-4 p-4 p-md-5 shadow-xs">
            <div className="row align-items-center g-4">
              <div className="col-12 col-lg-7 text-start">
                <span className="badge bg-secondary-subtle text-secondary border px-2.5 py-1 mb-2 font-monospace">
                  ENTERPRISE SECURITY & COMPLIANCE
                </span>
                <h3 className="fw-bold text-dark fs-3 mb-2">Direct GSTN Gateway Integration</h3>
                <p className="text-secondary small mb-3">
                  Enterprise-grade security architecture with end-to-end encryption for e-Invoice, e-Way Bill, GSTR-1, and 2B ITC automated reconciliation:
                </p>
                <div className="d-flex flex-wrap gap-2 small">
                  <span className="badge bg-white text-dark border px-3 py-2 font-monospace">
                    ✓ <strong>ISO 27001 Security</strong>
                  </span>
                  <span className="badge bg-white text-dark border px-3 py-2 font-monospace">
                    ✓ <strong>Multi-Factor 2FA</strong>
                  </span>
                  <span className="badge bg-white text-dark border px-3 py-2 font-monospace">
                    ✓ <strong>E-Invoice (IRN) Ready</strong>
                  </span>
                  <span className="badge bg-white text-dark border px-3 py-2 font-monospace">
                    ✓ <strong>Tenant Data Isolation</strong>
                  </span>
                </div>
              </div>
              <div className="col-12 col-lg-5 text-lg-end">
                <button
                  type="button"
                  className="btn btn-primary btn-lg rounded-3 fw-semibold px-4 shadow-sm"
                  onClick={() => navigate('/login')}
                >
                  Access Taxpayer Portal →
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          CONTACT & ENTERPRISE INQUIRIES
          ==================================================================== */}
      <section id="contact" className="py-5 bg-light">
        <div className="container py-3">
          <div className="row justify-content-center">
            <div className="col-12 col-lg-8">
              <div className="contact-card p-4 p-sm-5 bg-white">
                <div className="text-center mb-4">
                  <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-1.5 rounded-pill small fw-semibold mb-2">
                    Enterprise Support
                  </span>
                  <h3 className="fw-bold text-dark fs-3 mb-1">Talk to Our Compliance Specialists</h3>
                  <p className="text-secondary small mb-0">
                    Questions regarding GSP API integration, multi-branch setups, or high-volume invoice generation? Let us know.
                  </p>
                </div>

                {contactStatus && (
                  <div
                    className={`alert ${contactStatus.success ? 'alert-success' : 'alert-danger'} d-flex align-items-center mb-4 py-2.5 px-3 small rounded-3`}
                    role="status"
                    aria-live="polite"
                  >
                    <span className="me-2 fs-5">{contactStatus.success ? '✓' : '⚠️'}</span>
                    <div className="fw-medium">{contactStatus.message}</div>
                  </div>
                )}

                <form onSubmit={handleContactSubmit}>
                  <div className="row g-3">
                    <div className="col-12 col-sm-6 text-start">
                      <label htmlFor="contact-name" className="form-label text-dark small fw-semibold">
                        Your Full Name
                      </label>
                      <input
                        id="contact-name"
                        type="text"
                        maxLength={120}
                        className="form-control"
                        placeholder="e.g. Rajesh Sharma"
                        required
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                      />
                    </div>
                    <div className="col-12 col-sm-6 text-start">
                      <label htmlFor="contact-email" className="form-label text-dark small fw-semibold">
                        Work Email Address
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        maxLength={254}
                        className="form-control"
                        placeholder="rajesh@company.in"
                        required
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                      />
                    </div>
                    <div className="col-12 text-start">
                      <label htmlFor="contact-subject" className="form-label text-dark small fw-semibold">
                        Subject
                      </label>
                      <input
                        id="contact-subject"
                        type="text"
                        maxLength={200}
                        className="form-control"
                        placeholder="e.g. TaxPro GSP Production Onboarding"
                        required
                        value={contactForm.subject}
                        onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                      />
                    </div>
                    <div className="col-12 text-start">
                      <label htmlFor="contact-message" className="form-label text-dark small fw-semibold">
                        Requirements Details
                      </label>
                      <textarea
                        id="contact-message"
                        rows={4}
                        maxLength={5000}
                        className="form-control"
                        placeholder="Tell us about your organization's GST volume, branch count, or integration requirements..."
                        required
                        value={contactForm.message}
                        onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                      />
                    </div>
                    <div className="col-12 text-center mt-3">
                      <button
                        type="submit"
                        disabled={contactSubmitting}
                        className="btn btn-primary px-5 py-2.5 fw-semibold shadow-xs"
                      >
                        {contactSubmitting ? 'Submitting Inquiry…' : 'Send Message →'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          ENTERPRISE FOOTER
          ==================================================================== */}
      <footer className="landing-footer mt-auto">
        <div className="container">
          <div className="row g-4">
            <div className="col-12 col-md-5">
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="brand-mark" style={{ width: '36px', height: '36px', fontSize: '0.8rem' }}>CT</span>
                <span className="fs-5 fw-bold text-white tracking-tight">CandidTax Enterprise</span>
              </div>
              <p className="text-secondary small mb-3" style={{ maxWidth: '380px', lineHeight: 1.6 }}>
                Secure, identity-verified GST return automation and invoice intelligence engineered for modern Indian enterprises and Chartered Accountants.
              </p>
              <div className="d-flex align-items-center gap-2 text-secondary small">
                <span>🛡️ GSP Gateway</span>
                <span>•</span>
                <span>🔒 AES-256 Storage</span>
                <span>•</span>
                <span>⚡ 99.99% Uptime</span>
              </div>
            </div>

            <div className="col-6 col-md-2 offset-md-1">
              <h6 className="text-white fw-bold small text-uppercase mb-3" style={{ letterSpacing: '0.06em' }}>
                Platform
              </h6>
              <div className="d-flex flex-column gap-2 small">
                <Link to="/">Home</Link>
                <Link to="/dashboard">Dashboard</Link>
                <a href="#features">GSTR Modules</a>
                <a href="#workflow">Workflow</a>
                <a href="#security">Enterprise Security</a>
              </div>
            </div>

            <div className="col-6 col-md-2">
              <h6 className="text-white fw-bold small text-uppercase mb-3" style={{ letterSpacing: '0.06em' }}>
                Compliance
              </h6>
              <div className="d-flex flex-column gap-2 small">
                <Link to="/login">Taxpayer 2FA</Link>
                <Link to="/taxpayer-search">Search GSTIN</Link>
                <Link to="/excel-import">Excel Import</Link>
                <Link to="/reports">Audit Reports</Link>
              </div>
            </div>

            <div className="col-12 col-md-2">
              <h6 className="text-white fw-bold small text-uppercase mb-3" style={{ letterSpacing: '0.06em' }}>
                Legal & Security
              </h6>
              <div className="d-flex flex-column gap-2 small">
                <Link to="/privacy">Privacy Policy</Link>
                <Link to="/terms">Terms of Service</Link>
                <a href="#contact">Contact Support</a>
              </div>
            </div>
          </div>

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 pt-4 mt-4 border-top text-secondary small" style={{ fontSize: '0.8rem' }}>
            <span>© {new Date().getFullYear()} CandidTax Systems Pvt Ltd. All rights reserved.</span>
            <div className="d-flex gap-3">
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms</Link>
              <a href="#contact">Support</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
