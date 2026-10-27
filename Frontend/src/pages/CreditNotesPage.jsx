import { Link } from 'react-router-dom';

export default function CreditNotesPage() {
  return (
    <div>
      <div className="zoho-page-header d-flex justify-content-between align-items-center">
        <div>
          <h1 className="fw-bold fs-4 text-dark mb-1">Credit Notes</h1>
          <p className="text-secondary small mb-0">
            Issue sales credit notes for returned goods, price discounts, or cancelled invoices.
          </p>
        </div>
      </div>

      <div className="zoho-page-body">
        <div className="card border shadow-sm bg-white p-5 text-center">
          <div className="fs-1 mb-2">📝</div>
          <h3 className="fs-6 fw-bold text-dark">No Credit Notes Issued</h3>
          <p className="text-muted small mb-3">
            Credit notes will reduce taxable liability in your GSTR-1 return filing.
          </p>
          <div>
            <Link to="/sales/invoices" className="btn btn-outline-primary btn-sm">
              View Invoices to Issue Credit Note
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
