import { Link } from 'react-router-dom';
import useReturns from '../hooks/useReturns';
import { useAuth } from '../context/AuthContext';
import PeriodSelector from '../components/PeriodSelector';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import { formatCurrency, formatDate } from '../utils/format';

export default function DashboardPage() {
  const { user } = useAuth();
  const {
    period,
    setPeriod,
    dashboardData,
    loading,
    error,
    refresh
  } = useReturns();

  const billing = dashboardData?.billing || {};
  const totalSales = billing.totalSales || 0;
  const paidSales = billing.paidSales || 0;
  const pendingSales = billing.pendingSales || 0;
  const invoiceCount = billing.invoiceCount || 0;

  const totalPurchases = billing.totalPurchases || 0;
  const paidPurchases = billing.paidPurchases || 0;
  const pendingPurchases = billing.pendingPurchases || 0;
  const billCount = billing.billCount || 0;

  const salesReturnTax = (dashboardData?.sales?.cgst || 0) + (dashboardData?.sales?.sgst || 0) + (dashboardData?.sales?.igst || 0);
  const itcAvailable = dashboardData?.itc?.available || 0;
  const netTaxPayable = dashboardData?.taxPayable || Math.max(0, salesReturnTax - itcAvailable);

  const hasGstin = Boolean(user?.gstin || dashboardData?.gstin);
  const activeGstin = user?.gstin || dashboardData?.gstin || '';

  return (
    <div>
      {/* ====================================================================
          TOP PAGE HEADER & PERIOD CONTROLS
          ==================================================================== */}
      <div className="zoho-page-header d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        <div>
          <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
            <h1 className="fw-bold fs-4 text-dark mb-0">Business & GST Compliance Dashboard</h1>
            {activeGstin && (
              <span className="badge bg-success-subtle text-success border border-success-subtle font-monospace px-2.5 py-1 small">
                ✓ {activeGstin}
              </span>
            )}
          </div>
          <p className="text-secondary small mb-0">
            Real-time sales invoices, purchase expenses, and GST return reconciliations.
          </p>
        </div>

        <div className="d-flex align-items-center gap-2 flex-wrap">
          <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
          <button
            type="button"
            onClick={refresh}
            className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1.5 shadow-xs"
            title="Refresh dashboard metrics"
          >
            <span>↻</span>
            <span className="d-none d-sm-inline">Refresh</span>
          </button>
        </div>
      </div>

      <div className="zoho-page-body">
        <ErrorMessage error={error} onRetry={refresh} />

        {/* GSTIN Link Banner for Non-Linked Accounts */}
        {!hasGstin && (
          <div className="card border-0 bg-primary-subtle text-primary p-3.5 mb-4 rounded-3 shadow-xs d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3">
              <span className="fs-3">💡</span>
              <div>
                <strong className="d-block mb-0.5 text-dark" style={{ fontSize: '0.92rem' }}>
                  Operating in Billing & Invoicing Mode
                </strong>
                <span className="small text-secondary">
                  You can create tax invoices, bills, and track customers. Connect your 15-digit GSTIN to auto-sync official GSTR-1, GSTR-2B, and GSTR-3B filings.
                </span>
              </div>
            </div>
            <Link to="/taxpayer-search" className="btn btn-primary btn-sm px-3.5 text-nowrap align-self-start align-self-md-center shadow-xs">
              + Link GSTIN
            </Link>
          </div>
        )}

        {loading && (
          <div className="py-5 text-center">
            <Loader message="Loading business metrics and return records..." />
          </div>
        )}

        {!loading && (
          <>
            {/* ====================================================================
                4 KEY BUSINESS & TAX METRIC CARDS
                ==================================================================== */}
            <div className="row g-3 mb-4">
              {/* Card 1: Total Sales Invoices */}
              <div className="col-12 col-sm-6 col-xl-3">
                <div className="metric-card">
                  <div>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <div className="d-flex align-items-center gap-1.5">
                        <span className="fs-6">📄</span>
                        <span className="metric-card-title">Total Sales (Invoices)</span>
                      </div>
                      <span className="status-badge status-paid">{invoiceCount} Invoices</span>
                    </div>
                    <div className="metric-card-value text-dark">
                      {formatCurrency(totalSales)}
                    </div>
                  </div>
                  <div>
                    <div className="small text-muted d-flex justify-content-between mb-1.5" style={{ fontSize: '0.78rem' }}>
                      <span>Collected: <strong className="text-success">{formatCurrency(paidSales)}</strong></span>
                      <span>Due: <strong className="text-warning">{formatCurrency(pendingSales)}</strong></span>
                    </div>
                    <div className="progress rounded-pill" style={{ height: '6px', backgroundColor: '#e2e8f0' }}>
                      <div
                        className="progress-bar rounded-pill"
                        role="progressbar"
                        style={{
                          width: `${totalSales > 0 ? Math.min(100, (paidSales / totalSales) * 100) : 0}%`,
                          background: 'linear-gradient(90deg, #10b981, #059669)'
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Purchases & Expenses */}
              <div className="col-12 col-sm-6 col-xl-3">
                <div className="metric-card">
                  <div>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <div className="d-flex align-items-center gap-1.5">
                        <span className="fs-6">🧾</span>
                        <span className="metric-card-title">Purchases & Bills</span>
                      </div>
                      <span className="status-badge status-sent">{billCount} Bills</span>
                    </div>
                    <div className="metric-card-value text-dark">
                      {formatCurrency(totalPurchases)}
                    </div>
                  </div>
                  <div>
                    <div className="small text-muted d-flex justify-content-between mb-1.5" style={{ fontSize: '0.78rem' }}>
                      <span>Paid: <strong className="text-success">{formatCurrency(paidPurchases)}</strong></span>
                      <span>Payable: <strong className="text-danger">{formatCurrency(pendingPurchases)}</strong></span>
                    </div>
                    <div className="progress rounded-pill" style={{ height: '6px', backgroundColor: '#e2e8f0' }}>
                      <div
                        className="progress-bar bg-info rounded-pill"
                        role="progressbar"
                        style={{ width: `${totalPurchases > 0 ? Math.min(100, (paidPurchases / totalPurchases) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Eligible Input Tax Credit (ITC) */}
              <div className="col-12 col-sm-6 col-xl-3">
                <div className="metric-card">
                  <div>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <div className="d-flex align-items-center gap-1.5">
                        <span className="fs-6">📥</span>
                        <span className="metric-card-title">Eligible ITC (GSTR-2B)</span>
                      </div>
                      <span className="status-badge status-active">Period {period}</span>
                    </div>
                    <div className="metric-card-value" style={{ color: '#0d6e59' }}>
                      {formatCurrency(itcAvailable)}
                    </div>
                  </div>
                  <div>
                    <div className="small text-muted d-flex align-items-center justify-content-between" style={{ fontSize: '0.78rem' }}>
                      <span>Auto-drafted purchase tax credits</span>
                      <Link to={`/returns/gstr2b?period=${period}`} className="text-primary text-decoration-none fw-semibold">
                        View 2B →
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 4: Net GST Payable */}
              <div className="col-12 col-sm-6 col-xl-3">
                <div className="metric-card">
                  <div>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <div className="d-flex align-items-center gap-1.5">
                        <span className="fs-6">⚖️</span>
                        <span className="metric-card-title">Net GST Payable</span>
                      </div>
                      <span className={`status-badge ${netTaxPayable > 0 ? 'status-overdue' : 'status-paid'}`}>
                        {netTaxPayable > 0 ? 'Tax Due' : 'Zero Liability'}
                      </span>
                    </div>
                    <div className="metric-card-value text-dark">
                      {formatCurrency(netTaxPayable)}
                    </div>
                  </div>
                  <div>
                    <div className="small text-muted d-flex align-items-center justify-content-between" style={{ fontSize: '0.78rem' }}>
                      <span>Output Tax: <strong>{formatCurrency(salesReturnTax)}</strong></span>
                      <Link to={`/returns/gstr3b?period=${period}`} className="text-primary text-decoration-none fw-semibold">
                        View 3B →
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ====================================================================
                QUICK ACTION LAUNCHPAD
                ==================================================================== */}
            <div className="card p-3 mb-4 bg-white shadow-xs">
              <div className="d-flex align-items-center justify-content-between flex-wrap gap-2.5">
                <div className="d-flex align-items-center flex-wrap gap-2">
                  <span className="text-secondary small fw-bold me-1 text-uppercase" style={{ fontSize: '0.74rem', letterSpacing: '0.04em' }}>
                    Quick Actions:
                  </span>
                  <Link to="/sales/invoices?action=new" className="btn btn-primary btn-sm py-1.5 px-3 shadow-xs">
                    + New Invoice
                  </Link>
                  <Link to="/purchases/bills?action=new" className="btn btn-outline-secondary btn-sm py-1.5 px-3">
                    + Record Purchase Bill
                  </Link>
                  <Link to="/customers?action=new" className="btn btn-outline-secondary btn-sm py-1.5 px-3">
                    + New Customer
                  </Link>
                  <Link to="/excel-import" className="btn btn-light btn-sm py-1.5 px-3 border">
                    📤 Excel Import
                  </Link>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <Link to="/taxpayer-search" className="btn btn-light btn-sm py-1.5 px-3 text-secondary border">
                    🔍 Verify GSTIN
                  </Link>
                  <Link to="/reports" className="btn btn-light btn-sm py-1.5 px-3 text-secondary border">
                    📊 Audit Reports
                  </Link>
                </div>
              </div>
            </div>

            {/* ====================================================================
                TWO-COLUMN LAYOUT: RECENT INVOICES & GST RETURN CARDS
                ==================================================================== */}
            <div className="row g-4 mb-4">
              {/* Left Column: Recent Sales Invoices */}
              <div className="col-12 col-lg-8">
                <div className="card h-100 shadow-sm overflow-hidden">
                  <div className="card-header d-flex justify-content-between align-items-center">
                    <div>
                      <h2 className="fs-6 fw-bold text-dark mb-0">Recent Sales Invoices</h2>
                      <span className="text-muted small">Latest generated invoices with GST details</span>
                    </div>
                    <Link to="/sales/invoices" className="btn btn-link btn-sm text-primary text-decoration-none p-0 fw-semibold">
                      View All ({invoiceCount}) →
                    </Link>
                  </div>

                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Invoice #</th>
                          <th>Customer</th>
                          <th>Date</th>
                          <th>Amount</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billing.recentInvoices && billing.recentInvoices.length > 0 ? (
                          billing.recentInvoices.map((inv) => (
                            <tr key={inv._id}>
                              <td className="font-monospace fw-semibold">
                                <Link to={`/sales/invoices?id=${inv._id}`} className="text-primary text-decoration-none">
                                  {inv.invoiceNumber}
                                </Link>
                              </td>
                              <td className="fw-medium text-dark">{inv.customerName}</td>
                              <td className="text-muted small">{formatDate(inv.invoiceDate)}</td>
                              <td className="fw-bold text-dark">{formatCurrency(inv.grandTotal)}</td>
                              <td>
                                <span className={`status-badge status-${inv.status?.toLowerCase()}`}>
                                  {inv.status}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="text-center py-5 text-muted small">
                              <div className="mb-2" style={{ fontSize: '2rem' }}>📄</div>
                              <p className="mb-2 fw-medium text-secondary">No invoices created yet</p>
                              <Link to="/sales/invoices?action=new" className="btn btn-primary btn-sm px-3.5">
                                + Create your first invoice
                              </Link>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Right Column: GST Returns Compliance Breakdown */}
              <div className="col-12 col-lg-4">
                <div className="card h-100 shadow-sm overflow-hidden">
                  <div className="card-header">
                    <h2 className="fs-6 fw-bold text-dark mb-0">GST Return Statements</h2>
                    <span className="text-muted small">Statutory filings for Period {period}</span>
                  </div>

                  <div className="p-3 d-flex flex-column gap-3">
                    {/* GSTR-1 Outward Supplies */}
                    <div className="p-3 border rounded-3 bg-light transition-all">
                      <div className="d-flex justify-content-between align-items-center mb-1.5">
                        <strong className="text-dark small">GSTR-1 (Outward Sales)</strong>
                        <span className="status-badge status-paid">Sales</span>
                      </div>
                      <div className="small text-muted mb-2">
                        Taxable Turnover: <strong>{formatCurrency(dashboardData?.sales?.taxable || 0)}</strong>
                      </div>
                      <Link to={`/returns/gstr1?period=${period}`} className="small text-primary text-decoration-none fw-semibold d-inline-flex align-items-center gap-1">
                        <span>Inspect GSTR-1 Breakdown</span>
                        <span>→</span>
                      </Link>
                    </div>

                    {/* GSTR-2B Inward Supplies */}
                    <div className="p-3 border rounded-3 bg-light transition-all">
                      <div className="d-flex justify-content-between align-items-center mb-1.5">
                        <strong className="text-dark small">GSTR-2B (Inward ITC)</strong>
                        <span className="status-badge status-sent">Input Credit</span>
                      </div>
                      <div className="small text-muted mb-2">
                        Eligible ITC: <strong>{formatCurrency(itcAvailable)}</strong>
                      </div>
                      <Link to={`/returns/gstr2b?period=${period}`} className="small text-primary text-decoration-none fw-semibold d-inline-flex align-items-center gap-1">
                        <span>Inspect GSTR-2B ITC Match</span>
                        <span>→</span>
                      </Link>
                    </div>

                    {/* GSTR-3B Monthly Summary */}
                    <div className="p-3 border rounded-3 bg-light transition-all">
                      <div className="d-flex justify-content-between align-items-center mb-1.5">
                        <strong className="text-dark small">GSTR-3B (Tax Summary)</strong>
                        <span className="status-badge status-active">Net Liability</span>
                      </div>
                      <div className="small text-muted mb-2">
                        Net Cash Due: <strong>{formatCurrency(netTaxPayable)}</strong>
                      </div>
                      <Link to={`/returns/gstr3b?period=${period}`} className="small text-primary text-decoration-none fw-semibold d-inline-flex align-items-center gap-1">
                        <span>Inspect GSTR-3B Tax Offset</span>
                        <span>→</span>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
