import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './landing.css';

export default function LandingPage() {
  const [gstinInput, setGstinInput] = useState('');
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [contactStatus, setContactStatus] = useState(null);
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
    // TODO: Submit to POST /api/contact once backend route is implemented
    setContactStatus({
      success: true,
      message: 'Thank you! Your message has been received. (TODO: POST /api/contact)',
    });
    setContactForm({ name: '', email: '', subject: '', message: '' });
  };

  return (
    <div className="landing-wrapper">
      {/* Navigation */}
      <header className="landing-navbar">
        <div className="container d-flex justify-content-between align-items-center">
          <Link to="/" className="landing-brand">
            <span className="badge bg-primary fs-6 px-3 py-2">CandidTech</span>
            <span>GST</span>
          </Link>
          <nav className="landing-nav-links">
            <a href="#features" className="landing-nav-link d-none d-md-inline">Features</a>
            <a href="#workflow" className="landing-nav-link d-none d-md-inline">How it Works</a>
            <a href="#contact" className="landing-nav-link d-none d-md-inline">Contact</a>
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn btn-outline-primary btn-sm px-3 py-2 fw-semibold">
                Open Dashboard →
              </Link>
            ) : (
              <Link to="/login" className="btn btn-primary btn-sm px-3 py-2 fw-semibold">
                Taxpayer Login
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-section text-center py-5">
        <div className="container">
          <div className="d-inline-flex align-items-center gap-2 bg-primary-subtle text-primary border border-primary-subtle px-3 py-1.5 rounded-pill small fw-semibold mb-3 shadow-xs">
            <span>🛡️</span> GST Suvidha Provider Integration (FinAGG & TaxPro)
          </div>

          <h1 className="hero-title fw-bolder text-dark mb-3">
            Enterprise GST Returns & <br className="d-none d-sm-inline" />
            <span className="text-primary">Input Tax Credit Analytics</span>
          </h1>

          <p className="hero-subtitle text-secondary mx-auto mb-4 lead fs-6" style={{ maxWidth: '640px' }}>
            Instant identity verification via GSTN OTP. Real-time reconciliation of <strong>GSTR-1</strong> outward sales, <strong>GSTR-2B</strong> eligible ITC, and <strong>GSTR-3B</strong> monthly tax liabilities.
          </p>

          {/* GSTIN Quick Entry Card */}
          <div className="card shadow-sm border rounded-4 p-3 p-sm-4 mx-auto mb-4 bg-white text-start" style={{ maxWidth: '600px' }}>
            <form onSubmit={handleGstinSubmit}>
              <label htmlFor="landing-gstin-input" className="form-label text-secondary small fw-bold mb-2">
                Enter your 15-character GSTIN to begin:
              </label>
              <div className="input-group input-group-lg">
                <input
                  id="landing-gstin-input"
                  type="text"
                  className="form-control font-monospace text-uppercase"
                  placeholder="e.g. 29ABCDE1234F1Z5"
                  maxLength={15}
                  value={gstinInput}
                  onChange={(e) => setGstinInput(e.target.value.toUpperCase())}
                  aria-label="GSTIN Input"
                />
                <button type="submit" className="btn btn-primary fw-semibold px-4 text-nowrap">
                  Check GSTIN →
                </button>
              </div>
            </form>

            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3 pt-2 border-top text-muted small">
              <span className="d-inline-flex align-items-center gap-1">
                <span className="text-success">●</span> Direct GSTN Suvidha integration
              </span>
              <button
                type="button"
                className="btn btn-link btn-sm text-decoration-none p-0 text-primary fw-medium"
                onClick={() => {
                  setGstinInput('29ABCDE1234F1Z5');
                  navigate('/login?gstin=29ABCDE1234F1Z5');
                }}
              >
                Use Demo GSTIN (29ABCDE1234F1Z5) →
              </button>
            </div>
          </div>

          {/* Quick Metrics / Highlights */}
          <div className="row g-3 justify-content-center mt-2 mx-auto" style={{ maxWidth: '820px' }}>
            <div className="col-6 col-md-3">
              <div className="card border-0 bg-white shadow-xs p-3 h-100 rounded-3">
                <div className="fs-4 mb-1">⚡</div>
                <div className="fw-bold text-dark fs-5 font-monospace">Instant</div>
                <div className="text-secondary small">OTP Verification</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card border-0 bg-white shadow-xs p-3 h-100 rounded-3">
                <div className="fs-4 mb-1">📊</div>
                <div className="fw-bold text-dark fs-5 font-monospace">100%</div>
                <div className="text-secondary small">Auto-Reconciled ITC</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card border-0 bg-white shadow-xs p-3 h-100 rounded-3">
                <div className="fs-4 mb-1">🔒</div>
                <div className="fw-bold text-dark fs-5 font-monospace">AES-256</div>
                <div className="text-secondary small">Encrypted Storage</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card border-0 bg-white shadow-xs p-3 h-100 rounded-3">
                <div className="fs-4 mb-1">📑</div>
                <div className="fw-bold text-dark fs-5 font-monospace">3 Returns</div>
                <div className="text-secondary small">GSTR-1 / 2B / 3B</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-5 bg-white border-top border-bottom">
        <div className="container text-center">
          <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-1.5 rounded-pill small fw-semibold mb-2">
            Return Analytics
          </span>
          <h2 className="fw-bold text-dark mb-2">Comprehensive GST Return Visibility</h2>
          <p className="text-secondary mx-auto mb-5 small" style={{ maxWidth: '600px' }}>
            Monitor compliance health, audit historical periods, and reconcile tax liabilities without complex spreadsheets.
          </p>

          <div className="row g-4 text-start">
            <div className="col-12 col-md-4">
              <div className="card h-100 p-4 border rounded-4 shadow-sm return-hover-card">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="bg-primary-subtle text-primary rounded-3 p-2 fs-4">📊</div>
                  <span className="badge bg-primary-subtle text-primary border border-primary-subtle">Outward Sales</span>
                </div>
                <h3 className="fs-5 fw-bold text-dark mb-2">GSTR-1 Outward Supplies</h3>
                <p className="text-secondary small mb-3">
                  Comprehensive outward sales and invoice details grouped by tax slab rate (IGST, CGST, SGST, Cess) with instant totals.
                </p>
                <div className="mt-auto pt-2 border-top small text-muted">
                  Includes B2B invoices, export supplies, and net turnover.
                </div>
              </div>
            </div>

            <div className="col-12 col-md-4">
              <div className="card h-100 p-4 border rounded-4 shadow-sm return-hover-card">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="bg-info-subtle text-info-emphasis rounded-3 p-2 fs-4">📥</div>
                  <span className="badge bg-info-subtle text-info-emphasis border border-info-subtle">Inward Supplies</span>
                </div>
                <h3 className="fs-5 fw-bold text-dark mb-2">GSTR-2B Eligible ITC</h3>
                <p className="text-secondary small mb-3">
                  Auto-drafted purchase statement matching supplier filings to verify eligible and claimed Input Tax Credit with zero leakage.
                </p>
                <div className="mt-auto pt-2 border-top small text-muted">
                  Auto-reconciliation against supplier GSTR-1 filings.
                </div>
              </div>
            </div>

            <div className="col-12 col-md-4">
              <div className="card h-100 p-4 border rounded-4 shadow-sm return-hover-card">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="bg-success-subtle text-success-emphasis rounded-3 p-2 fs-4">📑</div>
                  <span className="badge bg-success-subtle text-success border border-success-subtle">Tax Liabilities</span>
                </div>
                <h3 className="fs-5 fw-bold text-dark mb-2">GSTR-3B Tax Summary</h3>
                <p className="text-secondary small mb-3">
                  Monthly summary statement calculating net cash tax payable after offsetting eligible inward ITC balances.
                </p>
                <div className="mt-auto pt-2 border-top small text-muted">
                  Calculates net payable liabilities per tax component.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="workflow" className="py-5 bg-light border-bottom">
        <div className="container text-center">
          <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-1.5 rounded-pill small fw-semibold mb-2">
            Verification Workflow
          </span>
          <h2 className="fw-bold text-dark mb-2">How It Works in 3 Simple Steps</h2>
          <p className="text-secondary mx-auto mb-5 small" style={{ maxWidth: '580px' }}>
            Identity-verified taxpayer compliance analytics directly from GST portal data.
          </p>

          <div className="row g-4 text-center">
            <div className="col-12 col-md-4">
              <div className="card h-100 p-4 border bg-white rounded-4 shadow-sm">
                <div
                  className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center mx-auto mb-3 fw-bold fs-5 shadow-sm"
                  style={{ width: '48px', height: '48px' }}
                >
                  1
                </div>
                <h4 className="fs-5 fw-bold text-dark mb-2">Enter GSTIN & Consent</h4>
                <p className="text-secondary small mb-0">
                  Input your 15-character GSTIN. The system performs an instant lookup and confirms your registered legal trade name.
                </p>
              </div>
            </div>

            <div className="col-12 col-md-4">
              <div className="card h-100 p-4 border bg-white rounded-4 shadow-sm">
                <div
                  className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center mx-auto mb-3 fw-bold fs-5 shadow-sm"
                  style={{ width: '48px', height: '48px' }}
                >
                  2
                </div>
                <h4 className="fs-5 fw-bold text-dark mb-2">Authenticate via OTP</h4>
                <p className="text-secondary small mb-0">
                  Authorize compliance inspection and submit the official 6-digit OTP sent directly to your registered mobile/email.
                </p>
              </div>
            </div>

            <div className="col-12 col-md-4">
              <div className="card h-100 p-4 border bg-white rounded-4 shadow-sm">
                <div
                  className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center mx-auto mb-3 fw-bold fs-5 shadow-sm"
                  style={{ width: '48px', height: '48px' }}
                >
                  3
                </div>
                <h4 className="fs-5 fw-bold text-dark mb-2">Inspect & Audit</h4>
                <p className="text-secondary small mb-0">
                  Explore aggregate sales, ITC eligible credits, tax liability calculations, and detailed line-item tables for any monthly period.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mock & Sandbox Testing Helper Card */}
      <section className="py-5 bg-white border-bottom">
        <div className="container">
          <div className="card border bg-light-subtle rounded-4 p-4 shadow-xs">
            <div className="row align-items-center g-4">
              <div className="col-12 col-lg-7">
                <span className="badge bg-secondary-subtle text-secondary border px-2.5 py-1 mb-2">
                  Sandbox Testing Environment
                </span>
                <h3 className="fw-bold text-dark fs-4 mb-2">Pre-Configured Mock Mode Credentials</h3>
                <p className="text-secondary small mb-3">
                  This portal operates with full offline mock fidelity simulating FinAGG and TaxPro GSP sandbox responses:
                </p>
                <div className="d-flex flex-wrap gap-2 small">
                  <span className="badge bg-white text-dark border px-3 py-2 font-monospace">
                    Valid GSTIN: <strong>29ABCDE1234F1Z5</strong>
                  </span>
                  <span className="badge bg-white text-dark border px-3 py-2 font-monospace">
                    Mock OTP: <strong>123456</strong>
                  </span>
                  <span className="badge bg-white text-dark border px-3 py-2 font-monospace">
                    Ending with 0: <strong>Not Found (400)</strong>
                  </span>
                  <span className="badge bg-white text-dark border px-3 py-2 font-monospace">
                    Starting with 99: <strong>Provider Down (503)</strong>
                  </span>
                  <span className="badge bg-white text-dark border px-3 py-2 font-monospace">
                    GSTR-2B 012022: <strong>Empty State (404)</strong>
                  </span>
                </div>
              </div>
              <div className="col-12 col-lg-5 text-lg-end">
                <button
                  type="button"
                  className="btn btn-primary btn-lg rounded-3 fw-semibold px-4 shadow-sm"
                  onClick={() => navigate('/login?gstin=29ABCDE1234F1Z5')}
                >
                  Test Taxpayer Login Now →
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="py-5 bg-white">
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-12 col-lg-8">
              <div className="card border rounded-4 p-4 p-sm-5 shadow-sm bg-white">
                <div className="text-center mb-4">
                  <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-1.5 rounded-pill small fw-semibold mb-2">
                    Support
                  </span>
                  <h3 className="fw-bold text-dark fs-4 mb-1">Contact Compliance Team</h3>
                  <p className="text-secondary small mb-0">
                    Have questions regarding GSP APIs, audit trails, or sandbox connectivity? Send us a message.
                  </p>
                </div>

                {contactStatus && (
                  <div className="alert alert-success d-flex align-items-center mb-4 py-2 px-3 small rounded-3" role="status" aria-live="polite">
                    <span className="me-2 fs-5">✓</span>
                    <div>{contactStatus.message}</div>
                  </div>
                )}

                <form onSubmit={handleContactSubmit}>
                  <div className="row g-3">
                    <div className="col-12 col-sm-6">
                      <label htmlFor="contact-name" className="form-label text-secondary small fw-semibold">
                        Your Full Name
                      </label>
                      <input
                        id="contact-name"
                        type="text"
                        className="form-control"
                        placeholder="e.g. Rajesh Kumar"
                        required
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                      />
                    </div>
                    <div className="col-12 col-sm-6">
                      <label htmlFor="contact-email" className="form-label text-secondary small fw-semibold">
                        Business Email Address
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        className="form-control"
                        placeholder="rajesh@company.in"
                        required
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                      />
                    </div>
                    <div className="col-12">
                      <label htmlFor="contact-subject" className="form-label text-secondary small fw-semibold">
                        Subject
                      </label>
                      <input
                        id="contact-subject"
                        type="text"
                        className="form-control"
                        placeholder="e.g. TaxPro GSP Sandbox Onboarding Inquiry"
                        required
                        value={contactForm.subject}
                        onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                      />
                    </div>
                    <div className="col-12">
                      <label htmlFor="contact-message" className="form-label text-secondary small fw-semibold">
                        Message
                      </label>
                      <textarea
                        id="contact-message"
                        rows={4}
                        className="form-control"
                        placeholder="Tell us about your organization's GST compliance requirements..."
                        required
                        value={contactForm.message}
                        onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                      />
                    </div>
                    <div className="col-12 text-center mt-3">
                      <button type="submit" className="btn btn-primary px-5 py-2.5 fw-semibold rounded-3">
                        Send Message
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-top border-light-subtle py-5 mt-auto">
        <div className="container">
          <div className="row g-4">
            <div className="col-12 col-md-6">
              <div className="d-flex align-items-center gap-2 mb-2">
                <span className="badge bg-primary px-2.5 py-1.5 fs-6 rounded-3">GST</span>
                <span className="fs-5 fw-bold text-dark">Compliance Portal</span>
              </div>
              <p className="text-secondary small mb-0" style={{ maxWidth: '420px' }}>
                Secure taxpayer authentication and automated return reconciliation powered by authorized GST Suvidha Providers.
              </p>
            </div>
            <div className="col-6 col-md-3">
              <h6 className="text-dark fw-semibold small text-uppercase mb-3">Navigation</h6>
              <div className="d-flex flex-column gap-2 small">
                <Link to="/" className="text-secondary text-decoration-none">Home</Link>
                <Link to="/login" className="text-secondary text-decoration-none">Taxpayer Login</Link>
                <a href="#features" className="text-secondary text-decoration-none">Features</a>
                <a href="#contact" className="text-secondary text-decoration-none">Contact Support</a>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <h6 className="text-dark fw-semibold small text-uppercase mb-3">Legal & Terms</h6>
              <div className="d-flex flex-column gap-2 small">
                <Link to="/privacy" className="text-secondary text-decoration-none">Privacy Policy</Link>
                <Link to="/terms" className="text-secondary text-decoration-none">Terms of Service</Link>
              </div>
            </div>
          </div>

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 pt-4 mt-4 border-top border-light-subtle small text-secondary">
            <span>© {new Date().getFullYear()} GST Taxpayer Compliance & Analytics Portal. All rights reserved.</span>
            <div className="d-flex gap-3">
              <Link to="/privacy" className="text-secondary text-decoration-none">Privacy</Link>
              <Link to="/terms" className="text-secondary text-decoration-none">Terms</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
