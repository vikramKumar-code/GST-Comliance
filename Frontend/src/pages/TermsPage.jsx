import { Link } from 'react-router-dom';

export default function TermsPage() {
  return (
    <div className="container py-5 my-4" style={{ maxWidth: '800px' }}>
      <div className="mb-4">
        <Link to="/" className="text-decoration-none small text-primary">
          ← Back to Home
        </Link>
      </div>

      <div className="card shadow-sm border bg-white p-4 p-md-5 rounded-4">
        <h1 className="fw-bold text-dark mb-3">Terms of Service</h1>
        <p className="text-muted small mb-4">Last Updated: October 2026</p>

        <section className="mb-4">
          <h4 className="fw-bold text-dark mb-2">1. Acceptance of Terms</h4>
          <p className="text-secondary">
            By entering your GSTIN and authenticating with an OTP sent by the GST system, you agree to comply with and be bound by these Terms of Service.
          </p>
        </section>

        <section className="mb-4">
          <h4 className="fw-bold text-dark mb-2">2. GSP Authorized Data Access</h4>
          <p className="text-secondary">
            GST returns (GSTR-1, GSTR-2B, and GSTR-3B) are obtained through licensed GST Suvidha Providers (FinAGG). Taxpayers must ensure they are authorized representatives for the GSTIN provided.
          </p>
        </section>

        <section className="mb-4">
          <h4 className="fw-bold text-dark mb-2">3. Scope of Analytics</h4>
          <p className="text-secondary">
            The platform provides analytical reconciliation and visualization. Filing features, tax payments, and direct return submissions may be introduced in future platform phases.
          </p>
        </section>

        <section className="mt-4 pt-3 border-top">
          <p className="text-muted small mb-0">
            For terms and partnership inquiries, please contact our support team.
          </p>
        </section>
      </div>
    </div>
  );
}
