import { Link } from 'react-router-dom';
import useReturns from '../hooks/useReturns';
import PeriodSelector from '../components/PeriodSelector';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import { formatCurrency, formatDate } from '../utils/format';

export default function DashboardPage() {
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

  return (
    <div>
      {/* Top Banner / Breadcrumb */}
      <div className="zoho-page-header d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        <div>
          <h1 className="fw-bold fs-4 text-dark mb-1">Business & GST Compliance Dashboard</h1>
          <p className="text-secondary small mb-0">
            Real-time sales invoices, purchase expenses, and GST return reconciliations.
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
          <button
            type="button"
            onClick={refresh}
            className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
            title="Refresh dashboard metrics"
          >
            <span>↻</span>
            <span className="d-none d-sm-inline">Refresh</span>
          </button>
        </div>
      </div>

      <div className="zoho-page-body">
        <ErrorMessage error={error} onRetry={refresh} />

        {loading && (
          <div className="py-4">
            <Loader message="Loading business metrics and return records..." />
          </div>
        )}

        {!loading && (
          <>
            {/* Top 4 Key Business Metric Cards (Zoho Books Style) */}
            <div className="row g-3 mb-4">
              {/* Total Sales Invoices */}
              <div className="col-12 col-sm-6 col-xl-3">
                <div className="card h-100 border p-3 bg-white shadow-sm">
                  <div className="d-flex justify-content-between align-items-center text-muted small mb-2">
                    <span className="fw-semibold text-uppercase" style={{ fontSize: '0.72rem' }}>Total Sales (Invoices)</span>
                    <span className="badge bg-success-subtle text-success">{invoiceCount} Invoices</span>
                  </div>
                  <div className="fs-3 fw-bold text-dark mb-2">
                    {formatCurrency(totalSales)}
                  </div>
                  <div className="small text-muted d-flex justify-content-between">
                    <span>Paid: <strong className="text-success">{formatCurrency(paidSales)}</strong></span>
                    <span>Pending: <strong className="text-warning">{formatCurrency(pendingSales)}</strong></span>
                  </div>
                  <div className="progress mt-2" style={{ height: '4px' }}>
                    <div
                      className="progress-bar bg-success"
                      role="progressbar"
                      style={{ width: `${totalSales > 0 ? (paidSales / totalSales) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Total Purchases & Bills */}
              <div className="col-12 col-sm-6 col-xl-3">
                <div className="card h-100 border p-3 bg-white shadow-sm">
                  <div className="d-flex justify-content-between align-items-center text-muted small mb-2">
                    <span className="fw-semibold text-uppercase" style={{ fontSize: '0.72rem' }}>Purchases & Bills</span>
                    <span className="badge bg-info-subtle text-info-emphasis">{billCount} Bills</span>
                  </div>
                  <div className="fs-3 fw-bold text-dark mb-2">
                    {formatCurrency(totalPurchases)}
                  </div>
                  <div className="small text-muted d-flex justify-content-between">
                    <span>Paid: <strong className="text-success">{formatCurrency(paidPurchases)}</strong></span>
                    <span>Pending: <strong className="text-danger">{formatCurrency(pendingPurchases)}</strong></span>
                  </div>
                  <div className="progress mt-2" style={{ height: '4px' }}>
                    <div
                      className="progress-bar bg-info"
                      role="progressbar"
                      style={{ width: `${totalPurchases > 0 ? (paidPurchases / totalPurchases) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Eligible Input Tax Credit (ITC) */}
              <div className="col-12 col-sm-6 col-xl-3">
                <div className="card h-100 border p-3 bg-white shadow-sm">
                  <div className="d-flex justify-content-between align-items-center text-muted small mb-2">
                    <span className="fw-semibold text-uppercase" style={{ fontSize: '0.72rem' }}>Eligible ITC (GSTR-2B)</span>
                    <span className="badge bg-primary-subtle text-primary">Period {period}</span>
                  </div>
                  <div className="fs-3 fw-bold text-primary mb-2">
                    {formatCurrency(itcAvailable)}
                  </div>
                  <div className="small text-muted">
                    Auto-drafted input tax credit available to offset liabilities.
                  </div>
                </div>
              </div>

              {/* Net Tax Payable */}
              <div className="col-12 col-sm-6 col-xl-3">
                <div className="card h-100 border p-3 bg-white shadow-sm">
                  <div className="d-flex justify-content-between align-items-center text-muted small mb-2">
                    <span className="fw-semibold text-uppercase" style={{ fontSize: '0.72rem' }}>Net GST Payable</span>
                    <span className={`badge ${netTaxPayable > 0 ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success'}`}>
                      {netTaxPayable > 0 ? 'Due' : 'Cleared'}
                    </span>
                  </div>
                  <div className="fs-3 fw-bold text-dark mb-2">
                    {formatCurrency(netTaxPayable)}
                  </div>
                  <div className="small text-muted">
                    Output Tax ({formatCurrency(salesReturnTax)}) minus eligible ITC.
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions & Navigation Bar */}
            <div className="card border shadow-sm p-3 mb-4 bg-white">
              <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div className="d-flex align-items-center gap-2">
                  <span className="text-secondary small fw-semibold">Quick Actions:</span>
                  <Link to="/sales/invoices?action=new" className="btn btn-outline-primary btn-sm py-1 px-2.5">
                    + Create Invoice
                  </Link>
                  <Link to="/purchases/bills?action=new" className="btn btn-outline-secondary btn-sm py-1 px-2.5">
                    + Record Purchase Bill
                  </Link>
                  <Link to="/customers?action=new" className="btn btn-outline-secondary btn-sm py-1 px-2.5">
                    + Add Customer
                  </Link>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <Link to="/taxpayer-search" className="btn btn-light border btn-sm py-1 px-2.5 text-secondary">
                    🔍 Verify GSTIN
                  </Link>
                  <Link to="/reports" className="btn btn-light border btn-sm py-1 px-2.5 text-secondary">
                    📊 View Reports
                  </Link>
                </div>
              </div>
            </div>

            {/* Two-Column Layout: Recent Invoices & Return Compliance */}
            <div className="row g-4 mb-4">
              {/* Recent Invoices Table */}
              <div className="col-12 col-lg-8">
                <div className="card border shadow-sm bg-white h-100">
                  <div className="card-header bg-white py-3 px-3.5 d-flex justify-content-between align-items-center border-bottom">
                    <div>
                      <h2 className="fs-6 fw-bold text-dark mb-0">Recent Sales Invoices</h2>
                      <span className="text-muted small">Latest generated invoices</span>
                    </div>
                    <Link to="/sales/invoices" className="btn btn-link btn-sm text-primary text-decoration-none p-0 fw-medium">
                      View All →
                    </Link>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead>
                        <tr>
                          <th className="ps-3.5">Invoice #</th>
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
                              <td className="ps-3.5 font-monospace fw-semibold">
                                <Link to={`/sales/invoices?id=${inv._id}`} className="text-primary text-decoration-none">
                                  {inv.invoiceNumber}
                                </Link>
                              </td>
                              <td className="fw-medium text-dark">{inv.customerName}</td>
                              <td className="text-muted small">{formatDate(inv.invoiceDate)}</td>
                              <td className="fw-bold text-dark">{formatCurrency(inv.grandTotal)}</td>
                              <td>
                                <span className={`zoho-badge-status zoho-status-${inv.status?.toLowerCase()}`}>
                                  {inv.status}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="text-center py-4 text-muted small">
                              No invoices created yet.{' '}
                              <Link to="/sales/invoices?action=new" className="text-primary">
                                Create your first invoice
                              </Link>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* GST Returns Overview */}
              <div className="col-12 col-lg-4">
                <div className="card border shadow-sm bg-white h-100">
                  <div className="card-header bg-white py-3 px-3.5 border-bottom">
                    <h2 className="fs-6 fw-bold text-dark mb-0">GST Returns Breakdown</h2>
                    <span className="text-muted small">Compliance status for period {period}</span>
                  </div>
                  <div className="p-3 d-flex flex-column gap-3">
                    {/* GSTR-1 */}
                    <div className="p-3 border rounded-3 bg-light">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <strong className="text-dark">GSTR-1 (Outward Sales)</strong>
                        <span className="badge bg-primary-subtle text-primary border border-primary-subtle">
                          Sales
                        </span>
                      </div>
                      <div className="small text-muted mb-2">
                        Taxable: {formatCurrency(dashboardData?.sales?.taxable || 0)}
                      </div>
                      <Link to={`/returns/gstr1?period=${period}`} className="small text-primary text-decoration-none fw-semibold">
                        View GSTR-1 Breakdown →
                      </Link>
                    </div>

                    {/* GSTR-2B */}
                    <div className="p-3 border rounded-3 bg-light">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <strong className="text-dark">GSTR-2B (Inward ITC)</strong>
                        <span className="badge bg-info-subtle text-info border border-info-subtle">
                          Input Credit
                        </span>
                      </div>
                      <div className="small text-muted mb-2">
                        Eligible ITC: {formatCurrency(itcAvailable)}
                      </div>
                      <Link to={`/returns/gstr2b?period=${period}`} className="small text-primary text-decoration-none fw-semibold">
                        View GSTR-2B Breakdown →
                      </Link>
                    </div>

                    {/* GSTR-3B */}
                    <div className="p-3 border rounded-3 bg-light">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <strong className="text-dark">GSTR-3B (Monthly Summary)</strong>
                        <span className="badge bg-success-subtle text-success border border-success-subtle">
                          Tax Liability
                        </span>
                      </div>
                      <div className="small text-muted mb-2">
                        Net Tax Due: {formatCurrency(netTaxPayable)}
                      </div>
                      <Link to={`/returns/gstr3b?period=${period}`} className="small text-primary text-decoration-none fw-semibold">
                        View GSTR-3B Breakdown →
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
