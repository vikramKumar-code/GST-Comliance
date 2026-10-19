import { Link } from 'react-router-dom';

export default function PrivacyPage() {
  return (
    <div className="container py-5 my-4" style={{ maxWidth: '800px' }}>
      <div className="mb-4">
        <Link to="/" className="text-decoration-none small text-primary">
          ← Back to Home
        </Link>
      </div>

      <div className="card shadow-sm border bg-white p-4 p-md-5 rounded-4">
        <h1 className="fw-bold text-dark mb-3">Privacy Policy</h1>
        <p className="text-muted small mb-4">Last Updated: October 2026</p>

        <section className="mb-4">
          <h4 className="fw-bold text-dark mb-2">1. Information We Collect</h4>
          <p className="text-secondary">
            Our platform accesses GST taxpayer details solely upon your explicit consent. This includes GSTIN, entity registration details, and return filing metadata retrieved via GST Suvidha Provider (FinAGG) APIs.
          </p>
        </section>

        <section className="mb-4">
          <h4 className="fw-bold text-dark mb-2">2. Data Security & Encryption</h4>
          <p className="text-secondary">
            All stored return summaries, tokens, and sensitive compliance data are encrypted using industry-standard AES-256-GCM algorithms. We do not store taxpayer OTPs or unencrypted authorization secrets.
          </p>
        </section>

        <section className="mb-4">
          <h4 className="fw-bold text-dark mb-2">3. Taxpayer Consent & Purpose</h4>
          <p className="text-secondary">
            Compliance data is processed strictly for providing tax analytics, GSTR reconciliation, and Input Tax Credit auditing. We never sell or share taxpayer data with unauthorized third parties.
          </p>
        </section>

        <section className="mt-4 pt-3 border-top">
          <p className="text-muted small mb-0">
            For privacy inquiries, please contact our data protection team via the landing page contact form.
          </p>
        </section>
      </div>
    </div>
  );
}
