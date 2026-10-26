import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getGstrComparison, getSalesRegister, getPurchaseRegister } from '../api/reports.api';
import { getLastMonthPeriod } from '../hooks/useReturns';
import PeriodSelector from '../components/PeriodSelector';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import EmptyState from '../components/EmptyState';
import { formatCurrency, formatPeriod } from '../utils/format';

function downloadCsv(filename, headers, rows) {
  const escapeCsv = (str) => `"${String(str ?? '').replace(/"/g, '""')}"`;
  const csvContent = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState(null); // null | 'GSTR_COMPARISON' | 'SALES_REGISTER' | 'PURCHASE_REGISTER'

  // Report 1: GSTR Comparison state
  const [comparisonPeriod, setComparisonPeriod] = useState(getLastMonthPeriod());
  const [comparisonData, setComparisonData] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState(null);

  // Report 2: Sales Register state
  const [salesFrom, setSalesFrom] = useState('');
  const [salesTo, setSalesTo] = useState('');
  const [salesData, setSalesData] = useState(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState(null);

  // Report 3: Purchase Register state
  const [purchaseFrom, setPurchaseFrom] = useState('');
  const [purchaseTo, setPurchaseTo] = useState('');
  const [purchaseData, setPurchaseData] = useState(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState(null);

  // Fetch GSTR Comparison
  const fetchComparison = useCallback(async (p) => {
    setComparisonLoading(true);
    setComparisonError(null);
    try {
      const data = await getGstrComparison(p);
      setComparisonData(data);
    } catch (err) {
      setComparisonError(err);
    } finally {
      setComparisonLoading(false);
    }
  }, []);

  // Fetch Sales Register
  const fetchSalesRegister = useCallback(async (from, to) => {
    setSalesLoading(true);
    setSalesError(null);
    try {
      const data = await getSalesRegister({ from, to });
      setSalesData(data);
    } catch (err) {
      setSalesError(err);
    } finally {
      setSalesLoading(false);
    }
  }, []);

  // Fetch Purchase Register
  const fetchPurchaseRegister = useCallback(async (from, to) => {
    setPurchaseLoading(true);
    setPurchaseError(null);
    try {
      const data = await getPurchaseRegister({ from, to });
      setPurchaseData(data);
    } catch (err) {
      setPurchaseError(err);
    } finally {
      setPurchaseLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(() => {
      if (ignore) return;
      if (activeReport === 'GSTR_COMPARISON') {
        fetchComparison(comparisonPeriod);
      } else if (activeReport === 'SALES_REGISTER') {
        fetchSalesRegister(salesFrom, salesTo);
      } else if (activeReport === 'PURCHASE_REGISTER') {
        fetchPurchaseRegister(purchaseFrom, purchaseTo);
      }
    });
    return () => {
      ignore = true;
    };
  }, [activeReport, comparisonPeriod, salesFrom, salesTo, purchaseFrom, purchaseTo, fetchComparison, fetchSalesRegister, fetchPurchaseRegister]);

  // Export Sales Register CSV
  const handleExportSales = () => {
    if (!salesData?.rows) return;
    const headers = [
      'Invoice #',
      'Date',
      'Customer Name',
      'Customer GSTIN',
      'Place of Supply',
      'Taxable Value (₹)',
      'CGST (₹)',
      'SGST (₹)',
      'IGST (₹)',
      'Total Tax (₹)',
      'Grand Total (₹)',
      'Status'
    ];
    const rows = salesData.rows.map((r) => [
      r.invoiceNumber,
      r.invoiceDate,
      r.customerName,
      r.customerGstin,
      r.placeOfSupply,
      r.taxableAmount,
      r.cgst,
      r.sgst,
      r.igst,
      r.totalTax,
      r.grandTotal,
      r.status
    ]);
    downloadCsv(`sales_register_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  // Export Purchase Register CSV
  const handleExportPurchase = () => {
    if (!purchaseData?.rows) return;
    const headers = [
      'Bill #',
      'Date',
      'Vendor Name',
      'Vendor GSTIN',
      'Category',
      'Taxable Value (₹)',
      'CGST (₹)',
      'SGST (₹)',
      'IGST (₹)',
      'Total Tax (₹)',
      'Grand Total (₹)',
      'Status'
    ];
    const rows = purchaseData.rows.map((r) => [
      r.billNumber,
      r.billDate,
      r.vendorName,
      r.vendorGstin,
      r.category,
      r.taxableAmount,
      r.cgst,
      r.sgst,
      r.igst,
      r.totalTax,
      r.grandTotal,
      r.status
    ]);
    downloadCsv(`purchase_register_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  return (
    <div>
      {/* Page Header */}
      <div className="zoho-page-header d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3">
        <div>
          <div className="d-flex align-items-center gap-2 mb-1">
            {activeReport && (
              <button
                type="button"
                className="btn btn-sm btn-link text-primary text-decoration-none p-0 fw-semibold"
                onClick={() => setActiveReport(null)}
              >
                ← All Reports /
              </button>
            )}
            <h1 className="fw-bold fs-4 text-dark mb-0">
              {activeReport === 'GSTR_COMPARISON'
                ? 'GSTR-1 vs GSTR-3B Tax Comparison'
                : activeReport === 'SALES_REGISTER'
                ? 'Outward Sales Register'
                : activeReport === 'PURCHASE_REGISTER'
                ? 'Inward Purchase Register'
                : 'Financial & GST Reports'}
            </h1>
          </div>
          <p className="text-secondary small mb-0">
            {activeReport === 'GSTR_COMPARISON'
              ? 'Reconcile outward tax liability reported in GSTR-1 with tax declared in GSTR-3B.'
              : activeReport === 'SALES_REGISTER'
              ? 'Complete list of sales invoices with tax breakdown and CSV export.'
              : activeReport === 'PURCHASE_REGISTER'
              ? 'Complete list of vendor purchase bills with ITC breakdown and CSV export.'
              : 'Executive audit summaries, reconciliation reports, and tax liabilities.'}
          </p>
        </div>

        {activeReport === 'GSTR_COMPARISON' && (
          <PeriodSelector
            selectedPeriod={comparisonPeriod}
            onPeriodChange={(newP) => setComparisonPeriod(newP)}
          />
        )}
      </div>

      <div className="zoho-page-body">
        {/* VIEW 0: Reports Catalog */}
        {!activeReport && (
          <div className="row g-3">
            <div className="col-12 col-md-6">
              <div className="card h-100 border shadow-sm p-4 bg-white">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <span className="fs-5">⚖️</span>
                  <h2 className="fs-6 fw-bold text-dark mb-0">GSTR-1 vs GSTR-3B Tax Comparison</h2>
                </div>
                <p className="text-muted small mb-3">
                  Reconcile outward tax liability reported in GSTR-1 with tax declared in GSTR-3B to identify DRC-01B notice risks.
                </p>
                <div className="mt-auto">
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => setActiveReport('GSTR_COMPARISON')}
                  >
                    Generate Report →
                  </button>
                </div>
              </div>
            </div>

            <div className="col-12 col-md-6">
              <div className="card h-100 border shadow-sm p-4 bg-white">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <span className="fs-5">📋</span>
                  <h2 className="fs-6 fw-bold text-dark mb-0">Outward Sales Register & CSV Export</h2>
                </div>
                <p className="text-muted small mb-3">
                  Detailed register of all sales invoices with customer GSTIN, intra/inter-state tax splits, and export.
                </p>
                <div className="mt-auto">
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => setActiveReport('SALES_REGISTER')}
                  >
                    Generate Report →
                  </button>
                </div>
              </div>
            </div>

            <div className="col-12 col-md-6">
              <div className="card h-100 border shadow-sm p-4 bg-white">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <span className="fs-5">📥</span>
                  <h2 className="fs-6 fw-bold text-dark mb-0">Inward Purchase Register & CSV Export</h2>
                </div>
                <p className="text-muted small mb-3">
                  Complete register of supplier bills, expenses, and input tax credits with CSV download.
                </p>
                <div className="mt-auto">
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => setActiveReport('PURCHASE_REGISTER')}
                  >
                    Generate Report →
                  </button>
                </div>
              </div>
            </div>

            <div className="col-12 col-md-6">
              <div className="card h-100 border shadow-sm p-4 bg-white">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <span className="fs-5">🔍</span>
                  <h2 className="fs-6 fw-bold text-dark mb-0">GSTR-2B vs Purchase Register (ITC Reconciliation)</h2>
                </div>
                <p className="text-muted small mb-3">
                  Compare auto-drafted ITC from supplier filings against internal books to prevent ineligible credit.
                </p>
                <div className="mt-auto">
                  <Link to="/purchases/bills" className="btn btn-outline-primary btn-sm">
                    Open ITC Reconciliation →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 1: GSTR-1 vs GSTR-3B Comparison */}
        {activeReport === 'GSTR_COMPARISON' && (
          <div>
            <ErrorMessage error={comparisonError} onRetry={() => fetchComparison(comparisonPeriod)} />

            {comparisonLoading && (
              <div className="py-4 text-center">
                <Loader message={`Comparing GSTR-1 and GSTR-3B for period ${comparisonPeriod}...`} />
              </div>
            )}

            {!comparisonLoading && comparisonData && (
              <div>
                {/* Risk Banner */}
                <div
                  className={`alert ${
                    comparisonData.status === 'MATCHED'
                      ? 'alert-success border-success'
                      : 'alert-warning border-warning'
                  } d-flex align-items-center gap-3 p-3 mb-4 rounded-3 shadow-sm`}
                  role="status"
                >
                  <span className="fs-4">{comparisonData.status === 'MATCHED' ? '✅' : '⚠️'}</span>
                  <div className="flex-grow-1">
                    <div className="fw-bold">
                      {comparisonData.status === 'MATCHED'
                        ? 'Reconciliation Status: MATCHED (Low Risk)'
                        : 'Reconciliation Status: VARIANCE DETECTED (High Notice Risk)'}
                    </div>
                    <div className="small">{comparisonData.explanation}</div>
                  </div>
                  <span
                    className={`badge ${
                      comparisonData.status === 'MATCHED' ? 'bg-success' : 'bg-warning text-dark'
                    } px-2.5 py-1.5`}
                  >
                    {formatPeriod(comparisonPeriod)}
                  </span>
                </div>

                {/* Comparison Table */}
                <div className="card border shadow-sm bg-white overflow-hidden mb-4">
                  <div className="table-responsive">
                    <table className="table table-bordered align-middle mb-0 small">
                      <thead className="table-light">
                        <tr>
                          <th className="ps-3.5">Tax Component</th>
                          <th className="text-end">GSTR-1 Outward (₹)</th>
                          <th className="text-end">GSTR-3B Declared (₹)</th>
                          <th className="text-end pe-3.5">Variance / Difference (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="ps-3.5 fw-semibold text-dark">Taxable Value</td>
                          <td className="text-end font-monospace">{formatCurrency(comparisonData.gstr1?.taxable || 0)}</td>
                          <td className="text-end font-monospace">{formatCurrency(comparisonData.gstr3b?.taxable || 0)}</td>
                          <td className={`text-end font-monospace fw-bold pe-3.5 ${comparisonData.difference?.taxable !== 0 ? 'text-danger' : 'text-success'}`}>
                            {formatCurrency(comparisonData.difference?.taxable || 0)}
                          </td>
                        </tr>
                        <tr>
                          <td className="ps-3.5 fw-semibold text-dark">Central Tax (CGST)</td>
                          <td className="text-end font-monospace">{formatCurrency(comparisonData.gstr1?.cgst || 0)}</td>
                          <td className="text-end font-monospace">{formatCurrency(comparisonData.gstr3b?.cgst || 0)}</td>
                          <td className={`text-end font-monospace fw-bold pe-3.5 ${comparisonData.difference?.cgst !== 0 ? 'text-danger' : 'text-success'}`}>
                            {formatCurrency(comparisonData.difference?.cgst || 0)}
                          </td>
                        </tr>
                        <tr>
                          <td className="ps-3.5 fw-semibold text-dark">State Tax (SGST)</td>
                          <td className="text-end font-monospace">{formatCurrency(comparisonData.gstr1?.sgst || 0)}</td>
                          <td className="text-end font-monospace">{formatCurrency(comparisonData.gstr3b?.sgst || 0)}</td>
                          <td className={`text-end font-monospace fw-bold pe-3.5 ${comparisonData.difference?.sgst !== 0 ? 'text-danger' : 'text-success'}`}>
                            {formatCurrency(comparisonData.difference?.sgst || 0)}
                          </td>
                        </tr>
                        <tr>
                          <td className="ps-3.5 fw-semibold text-dark">Integrated Tax (IGST)</td>
                          <td className="text-end font-monospace">{formatCurrency(comparisonData.gstr1?.igst || 0)}</td>
                          <td className="text-end font-monospace">{formatCurrency(comparisonData.gstr3b?.igst || 0)}</td>
                          <td className={`text-end font-monospace fw-bold pe-3.5 ${comparisonData.difference?.igst !== 0 ? 'text-danger' : 'text-success'}`}>
                            {formatCurrency(comparisonData.difference?.igst || 0)}
                          </td>
                        </tr>
                        <tr className="table-light border-top border-2">
                          <td className="ps-3.5 fw-bold text-dark">Total Tax Liability</td>
                          <td className="text-end font-monospace fw-bold">{formatCurrency(comparisonData.gstr1?.totalTax || 0)}</td>
                          <td className="text-end font-monospace fw-bold">{formatCurrency(comparisonData.gstr3b?.totalTax || 0)}</td>
                          <td className={`text-end font-monospace fw-bold pe-3.5 ${comparisonData.difference?.totalTax !== 0 ? 'text-danger' : 'text-success'}`}>
                            {formatCurrency(comparisonData.difference?.totalTax || 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: Sales Register */}
        {activeReport === 'SALES_REGISTER' && (
          <div>
            <ErrorMessage error={salesError} onRetry={() => fetchSalesRegister(salesFrom, salesTo)} />

            {/* Filter Bar */}
            <div className="card border shadow-sm p-3 mb-4 bg-white">
              <div className="row g-2 align-items-center">
                <div className="col-12 col-sm-4">
                  <label htmlFor="salesFromDate" className="form-label small text-muted mb-1">From Date</label>
                  <input
                    id="salesFromDate"
                    type="date"
                    className="form-control form-control-sm"
                    value={salesFrom}
                    onChange={(e) => setSalesFrom(e.target.value)}
                  />
                </div>
                <div className="col-12 col-sm-4">
                  <label htmlFor="salesToDate" className="form-label small text-muted mb-1">To Date</label>
                  <input
                    id="salesToDate"
                    type="date"
                    className="form-control form-control-sm"
                    value={salesTo}
                    onChange={(e) => setSalesTo(e.target.value)}
                  />
                </div>
                <div className="col-12 col-sm-4 d-flex align-items-end justify-content-end gap-2 mt-sm-auto">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => { setSalesFrom(''); setSalesTo(''); }}
                  >
                    Clear Filter
                  </button>
                  <button
                    type="button"
                    className="btn btn-success btn-sm fw-semibold d-flex align-items-center gap-1.5"
                    onClick={handleExportSales}
                    disabled={!salesData?.rows || salesData.rows.length === 0}
                  >
                    <span>⬇ Export CSV</span>
                  </button>
                </div>
              </div>
            </div>

            {salesLoading && (
              <div className="py-4 text-center">
                <Loader message="Loading sales register..." />
              </div>
            )}

            {!salesLoading && salesData?.rows?.length === 0 && (
              <EmptyState
                title="No Sales Invoices Found"
                message="There are no sales invoices matching the selected date range."
              />
            )}

            {!salesLoading && salesData?.rows?.length > 0 && (
              <div className="card border shadow-sm bg-white overflow-hidden">
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0 small">
                    <thead className="table-light">
                      <tr>
                        <th className="ps-3.5">Invoice #</th>
                        <th>Date</th>
                        <th>Customer</th>
                        <th>POS</th>
                        <th className="text-end">Taxable (₹)</th>
                        <th className="text-end">CGST (₹)</th>
                        <th className="text-end">SGST (₹)</th>
                        <th className="text-end">IGST (₹)</th>
                        <th className="text-end pe-3.5">Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesData.rows.map((row) => (
                        <tr key={row.id}>
                          <td className="ps-3.5 font-monospace fw-semibold text-primary">{row.invoiceNumber}</td>
                          <td className="text-muted">{row.invoiceDate}</td>
                          <td>
                            <div className="fw-semibold text-dark">{row.customerName}</div>
                            <div className="font-monospace text-muted" style={{ fontSize: '0.75rem' }}>{row.customerGstin}</div>
                          </td>
                          <td className="text-muted">{row.placeOfSupply}</td>
                          <td className="text-end font-monospace">{formatCurrency(row.taxableAmount)}</td>
                          <td className="text-end font-monospace">{formatCurrency(row.cgst)}</td>
                          <td className="text-end font-monospace">{formatCurrency(row.sgst)}</td>
                          <td className="text-end font-monospace">{formatCurrency(row.igst)}</td>
                          <td className="text-end font-monospace fw-bold text-dark pe-3.5">{formatCurrency(row.grandTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: Purchase Register */}
        {activeReport === 'PURCHASE_REGISTER' && (
          <div>
            <ErrorMessage error={purchaseError} onRetry={() => fetchPurchaseRegister(purchaseFrom, purchaseTo)} />

            {/* Filter Bar */}
            <div className="card border shadow-sm p-3 mb-4 bg-white">
              <div className="row g-2 align-items-center">
                <div className="col-12 col-sm-4">
                  <label htmlFor="purchaseFromDate" className="form-label small text-muted mb-1">From Date</label>
                  <input
                    id="purchaseFromDate"
                    type="date"
                    className="form-control form-control-sm"
                    value={purchaseFrom}
                    onChange={(e) => setPurchaseFrom(e.target.value)}
                  />
                </div>
                <div className="col-12 col-sm-4">
                  <label htmlFor="purchaseToDate" className="form-label small text-muted mb-1">To Date</label>
                  <input
                    id="purchaseToDate"
                    type="date"
                    className="form-control form-control-sm"
                    value={purchaseTo}
                    onChange={(e) => setPurchaseTo(e.target.value)}
                  />
                </div>
                <div className="col-12 col-sm-4 d-flex align-items-end justify-content-end gap-2 mt-sm-auto">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => { setPurchaseFrom(''); setPurchaseTo(''); }}
                  >
                    Clear Filter
                  </button>
                  <button
                    type="button"
                    className="btn btn-success btn-sm fw-semibold d-flex align-items-center gap-1.5"
                    onClick={handleExportPurchase}
                    disabled={!purchaseData?.rows || purchaseData.rows.length === 0}
                  >
                    <span>⬇ Export CSV</span>
                  </button>
                </div>
              </div>
            </div>

            {purchaseLoading && (
              <div className="py-4 text-center">
                <Loader message="Loading purchase register..." />
              </div>
            )}

            {!purchaseLoading && purchaseData?.rows?.length === 0 && (
              <EmptyState
                title="No Purchase Bills Found"
                message="There are no vendor purchase bills matching the selected date range."
              />
            )}

            {!purchaseLoading && purchaseData?.rows?.length > 0 && (
              <div className="card border shadow-sm bg-white overflow-hidden">
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0 small">
                    <thead className="table-light">
                      <tr>
                        <th className="ps-3.5">Bill #</th>
                        <th>Date</th>
                        <th>Vendor</th>
                        <th>Category</th>
                        <th className="text-end">Taxable (₹)</th>
                        <th className="text-end">CGST (₹)</th>
                        <th className="text-end">SGST (₹)</th>
                        <th className="text-end">IGST (₹)</th>
                        <th className="text-end pe-3.5">Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseData.rows.map((row) => (
                        <tr key={row.id}>
                          <td className="ps-3.5 font-monospace fw-semibold text-primary">{row.billNumber}</td>
                          <td className="text-muted">{row.billDate}</td>
                          <td>
                            <div className="fw-semibold text-dark">{row.vendorName}</div>
                            <div className="font-monospace text-muted" style={{ fontSize: '0.75rem' }}>{row.vendorGstin}</div>
                          </td>
                          <td>
                            <span className="badge bg-light text-dark border">
                              {row.category}
                            </span>
                          </td>
                          <td className="text-end font-monospace">{formatCurrency(row.taxableAmount)}</td>
                          <td className="text-end font-monospace">{formatCurrency(row.cgst)}</td>
                          <td className="text-end font-monospace">{formatCurrency(row.sgst)}</td>
                          <td className="text-end font-monospace">{formatCurrency(row.igst)}</td>
                          <td className="text-end font-monospace fw-bold text-dark pe-3.5">{formatCurrency(row.grandTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
