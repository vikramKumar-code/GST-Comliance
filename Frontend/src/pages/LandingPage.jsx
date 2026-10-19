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
    // TODO: Submit to POST /api/contact
    console.log('Contact form payload (TODO: POST /api/contact):', contactForm);
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
            <span className="badge bg-primary fs-6 px-3 py-2">CandiTech</span>
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
      <section className="hero-section text-center">
        <div className="container">
          <div className="hero-pill">
            <span>🛡️</span> GST Suvidha Provider (FinAGG) Integration
          </div>
          <h1 className="hero-title">
            Enterprise GST Returns & <br />
            <span className="hero-gradient-text">Input Tax Credit Analytics</span>
          </h1>
          <p className="hero-subtitle">
            Seamlessly fetch, verify, and reconcile GSTR-1, GSTR-2B, and GSTR-3B filings with instant taxpayer OTP authentication and real-time ledger intelligence.
          </p>

          {/* GSTIN Quick Entry Form */}
          <div className="hero-gstin-card">
            <form onSubmit={handleGstinSubmit}>
              <label htmlFor="landing-gstin-input" className="form-label text-start d-block small fw-bold text-secondary mb-2">
                Enter your 15-character GSTIN to begin:
              </label>
              <div className="gstin-input-group">
                <input
                  id="landing-gstin-input"
                  type="text"
                  className="form-control form-control-lg gstin-search-input"
                  placeholder="e.g. 29ABCDE1234F1Z5"
                  maxLength={15}
                  value={gstinInput}
                  onChange={(e) => setGstinInput(e.target.value)}
                />
                <button type="submit" className="btn btn-primary btn-lg px-4 fw-semibold text-nowrap">
                  Check GSTIN →
                </button>
              </div>
            </form>
            <div className="d-flex justify-content-between align-items-center mt-3 pt-2 text-muted small border-top border-secondary">
              <span>🔒 Direct GSTN Suvidha integration</span>
              <span>⚡ Mock & Sandbox enabled</span>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="hero-stats-row">
            <div className="hero-stat-item">
              <div className="hero-stat-value">100%</div>
              <div className="hero-stat-label">Automated Inward Reconciliation</div>
            </div>
            <div className="hero-stat-item">
              <div className="hero-stat-value">AES-256</div>
              <div className="hero-stat-label">Encrypted Data Storage</div>
            </div>
            <div className="hero-stat-item">
              <div className="hero-stat-value">Instant</div>
              <div className="hero-stat-label">OTP Verification</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="features-section">
        <div className="container text-center">
          <span className="section-tag">Capabilities</span>
          <h2 className="section-heading">Designed for Modern Taxpayers & CFOs</h2>
          <p className="section-desc">
            Everything you need to monitor compliance status, audit returns, and maximize eligible Input Tax Credit without manual spreadsheets.
          </p>

          <div className="row g-4 text-start">
            <div className="col-12 col-md-4">
              <div className="feature-card">
                <div className="feature-icon-wrapper">📊</div>
                <h4>GSTR-1 Outward Supplies</h4>
                <p>
                  Comprehensive sales breakdowns by tax rate (IGST, CGST, SGST, Cess) with period-over-period tracking.
                </p>
              </div>
            </div>
            <div className="col-12 col-md-4">
              <div className="feature-card">
                <div className="feature-icon-wrapper">📥</div>
                <h4>GSTR-2B Eligible ITC</h4>
                <p>
                  Auto-drafted purchases and input tax credit claims verified against supplier filings for zero discrepancy.
                </p>
              </div>
            </div>
            <div className="col-12 col-md-4">
              <div className="feature-card">
                <div className="feature-icon-wrapper">📑</div>
                <h4>GSTR-3B Tax Summary</h4>
                <p>
                  Consolidated monthly liability statements showing net tax payable after eligible credit offsetting.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Workflow Section */}
      <section id="workflow" className="workflow-section">
        <div className="container text-center">
          <span className="section-tag">Process</span>
          <h2 className="section-heading">How It Works in 3 Simple Steps</h2>
          <p className="section-desc">
            Secure, identity-verified compliance analytics directly from GST portal data.
          </p>

          <div className="row g-4">
            <div className="col-12 col-md-4">
              <div className="step-card">
                <div className="step-number">1</div>
                <h5>Enter GSTIN</h5>
                <p>Input your company GSTIN to fetch business legal entity details from the registry.</p>
              </div>
            </div>
            <div className="col-12 col-md-4">
              <div className="step-card">
                <div className="step-number">2</div>
                <h5>Verify OTP</h5>
                <p>Provide consent and authenticate with the secure OTP sent to your registered GST mobile/email.</p>
              </div>
            </div>
            <div className="col-12 col-md-4">
              <div className="step-card">
                <div className="step-number">3</div>
                <h5>Access Dashboard</h5>
                <p>Explore return filings, monitor eligible ITC, and inspect detailed line items across all return periods.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="contact-section">
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-12 col-lg-8">
              <div className="contact-card">
                <div className="text-center mb-4">
                  <span className="section-tag">Get in Touch</span>
                  <h3 className="fw-bold text-white">Contact Compliance Support</h3>
                  <p className="text-secondary small">
                    Have questions about GSP integrations, sandbox testing, or high-volume filing? Send us a message.
                  </p>
                </div>

                {contactStatus && (
                  <div className="alert alert-success d-flex align-items-center mb-4" role="alert">
                    <span className="me-2">✓</span>
                    <div>{contactStatus.message}</div>
                  </div>
                )}

                <form onSubmit={handleContactSubmit} className="contact-form">
                  <div className="row g-3">
                    <div className="col-12 col-sm-6">
                      <label htmlFor="contact-name">Your Full Name</label>
                      <input
                        id="contact-name"
                        type="text"
                        className="form-control"
                        placeholder="e.g. John Doe"
                        required
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                      />
                    </div>
                    <div className="col-12 col-sm-6">
                      <label htmlFor="contact-email">Email Address</label>
                      <input
                        id="contact-email"
                        type="email"
                        className="form-control"
                        placeholder="john@company.com"
                        required
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                      />
                    </div>
                    <div className="col-12">
                      <label htmlFor="contact-subject">Subject</label>
                      <input
                        id="contact-subject"
                        type="text"
                        className="form-control"
                        placeholder="e.g. GST Reconciliation API Inquiry"
                        required
                        value={contactForm.subject}
                        onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                      />
                    </div>
                    <div className="col-12">
                      <label htmlFor="contact-message">Message</label>
                      <textarea
                        id="contact-message"
                        rows={4}
                        className="form-control"
                        placeholder="Tell us how we can assist your business..."
                        required
                        value={contactForm.message}
                        onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                      />
                    </div>
                    <div className="col-12 text-center mt-4">
                      <button type="submit" className="btn btn-primary btn-lg px-5 fw-semibold">
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
      <footer className="landing-footer">
        <div className="container">
          <div className="row g-4">
            <div className="col-12 col-md-6">
              <div className="footer-brand">GST Compliance Portal</div>
              <p className="footer-text mb-0" style={{ maxWidth: '420px' }}>
                Secure, automated GST returns tracking and ITC reconciliation system backed by authorized GST Suvidha Providers.
              </p>
            </div>
            <div className="col-6 col-md-3">
              <h6 className="text-white fw-bold mb-3">Navigation</h6>
              <div className="footer-link-group">
                <Link to="/" className="footer-link">Home</Link>
                <Link to="/login" className="footer-link">Taxpayer Login</Link>
                <a href="#features" className="footer-link">Features</a>
                <a href="#contact" className="footer-link">Contact</a>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <h6 className="text-white fw-bold mb-3">Legal</h6>
              <div className="footer-link-group">
                <Link to="/privacy" className="footer-link">Privacy Policy</Link>
                <Link to="/terms" className="footer-link">Terms of Service</Link>
              </div>
            </div>
          </div>

          <div className="footer-bottom">
            <p className="footer-bottom-text">
              © {new Date().getFullYear()} GST Taxpayer Compliance & Analytics. All rights reserved.
            </p>
            <div className="d-flex gap-3">
              <Link to="/privacy" className="footer-link small">Privacy</Link>
              <Link to="/terms" className="footer-link small">Terms</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
