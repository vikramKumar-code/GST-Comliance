import { Link } from 'react-router-dom';
import PeriodSelector from '../components/PeriodSelector';
import SummaryCards from '../components/SummaryCards';

export default function DashboardPage() {
  const dummyData = {
    sales: { total: 1250000 },
    purchases: { total: 840000 },
    itc: { available: 151200 },
    taxPayable: 73800,
  };

  return (
    <div className="container py-4">
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 mb-4">
        <div>
          <h2 className="fw-bold text-dark mb-1">Taxpayer Compliance Dashboard</h2>
          <p className="text-secondary small mb-0">Overview of sales, purchases, ITC reconciliation and tax summary.</p>
        </div>
        <PeriodSelector selectedPeriod="092026" onPeriodChange={() => {}} />
      </div>

      <SummaryCards data={dummyData} />

      <div className="card shadow-sm border mb-4 bg-white">
        <div className="card-body p-4">
          <h4 className="fw-bold text-dark mb-1">GST Returns Overview</h4>
          <p className="text-secondary small mb-4">Select a return category to view detailed transactions:</p>
          <div className="row g-3">
            <div className="col-12 col-md-4">
              <Link to="/returns/gstr1" className="text-decoration-none">
                <div className="card h-100 p-3 return-hover-card">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <h5 className="fw-bold mb-0 text-dark">GSTR-1</h5>
                    <span className="badge bg-primary-subtle text-primary border border-primary-subtle">Outward Supplies</span>
                  </div>
                  <p className="text-muted small mb-0">Details of sales and outward supplies</p>
                </div>
              </Link>
            </div>
            <div className="col-12 col-md-4">
              <Link to="/returns/gstr2b" className="text-decoration-none">
                <div className="card h-100 p-3 return-hover-card">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <h5 className="fw-bold mb-0 text-dark">GSTR-2B</h5>
                    <span className="badge bg-info-subtle text-info-emphasis border border-info-subtle">Inward Supplies</span>
                  </div>
                  <p className="text-muted small mb-0">Auto-drafted ITC statement from suppliers</p>
                </div>
              </Link>
            </div>
            <div className="col-12 col-md-4">
              <Link to="/returns/gstr3b" className="text-decoration-none">
                <div className="card h-100 p-3 return-hover-card">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <h5 className="fw-bold mb-0 text-dark">GSTR-3B</h5>
                    <span className="badge bg-success-subtle text-success border border-success-subtle">Tax Summary</span>
                  </div>
                  <p className="text-muted small mb-0">Monthly summary of tax liability and ITC</p>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
