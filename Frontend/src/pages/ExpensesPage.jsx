import { Link } from 'react-router-dom';

export default function ExpensesPage() {
  return (
    <div>
      <div className="zoho-page-header d-flex justify-content-between align-items-center">
        <div>
          <h1 className="fw-bold fs-4 text-dark mb-1">Direct Business Expenses</h1>
          <p className="text-secondary small mb-0">
            Track operational expenses, fuel, rent, and utility disbursements.
          </p>
        </div>
        <Link to="/purchases/bills?action=new" className="btn btn-primary btn-sm fw-semibold">
          + Record Expense Bill
        </Link>
      </div>

      <div className="zoho-page-body">
        <div className="card border shadow-sm bg-white p-5 text-center">
          <div className="fs-1 mb-2">💳</div>
          <h3 className="fs-6 fw-bold text-dark">Track Operational Expenses</h3>
          <p className="text-muted small mb-3">
            All expenses recorded under Purchase Bills appear automatically in your expense ledger.
          </p>
          <div>
            <Link to="/purchases/bills" className="btn btn-outline-primary btn-sm">
              View All Purchase Bills & Expenses
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
