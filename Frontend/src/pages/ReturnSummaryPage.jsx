import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getReturnsSummary } from '../api/returns.api';
import { getLastMonthPeriod } from '../hooks/useReturns';
import PeriodSelector from '../components/PeriodSelector';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import EmptyState from '../components/EmptyState';
import { formatCurrency, formatPeriod } from '../utils/format';
import NilReturnModal from '../components/NilReturnModal';

export default function ReturnSummaryPage() {
  const [period, setPeriod] = useState(getLastMonthPeriod());
  const [summaryData, setSummaryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nilModalOpen, setNilModalOpen] = useState(false);

  const fetchSummary = useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getReturnsSummary(p);
      setSummaryData(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(() => {
      if (ignore) return;
      fetchSummary(period);
    });
    return () => {
      ignore = true;
    };
  }, [fetchSummary, period]);

  const returns = summaryData?.returns || [];
  const periods = summaryData?.availablePeriods || [];

  return (
    <div>
      <div className="zoho-page-header d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        <div>
          <h1 className="fw-bold fs-4 text-dark mb-1">Unified GST Return Summary</h1>
          <p className="text-secondary small mb-0">
            Combined reconciliation of GSTR-1, GSTR-2B, and GSTR-3B for tax period {formatPeriod(period)}.
          </p>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-outline-success btn-sm d-flex align-items-center gap-1.5 text-nowrap fw-semibold px-3"
            onClick={() => setNilModalOpen(true)}
            title="File Nil GSTR-1 or GSTR-3B under CGST Rule 67A"
          >
            <span>⚡ File Nil Return</span>
          </button>
          <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
        </div>
      </div>

      <div className="zoho-page-body">
        <ErrorMessage error={error} onRetry={() => fetchSummary(period)} />

        {loading && (
          <div className="py-4">
            <Loader message="Fetching unified return summary..." />
          </div>
        )}

        {!loading && !error && returns.length === 0 && (
          <EmptyState
            title="No Return Summary for this Period"
            message="Return data for this month has not been fetched yet. Open the return breakdowns to fetch data from GST portal."
            action={
              <div className="d-flex align-items-center gap-2">
                <Link to={`/returns/gstr1?period=${period}`} className="btn btn-primary btn-sm">
                  Fetch GSTR-1 →
                </Link>
                <Link to={`/returns/gstr2b?period=${period}`} className="btn btn-outline-primary btn-sm">
                  Fetch GSTR-2B →
                </Link>
                <button
                  type="button"
                  className="btn btn-outline-success btn-sm"
                  onClick={() => setNilModalOpen(true)}
                >
                  ⚡ File Nil Return
                </button>
              </div>
            }
          />
        )}

        {!loading && returns.length > 0 && (
          <div className="card border shadow-sm bg-white overflow-hidden mb-4">
            <div className="card-header bg-light py-2.5 px-3.5 border-bottom">
              <h2 className="fs-6 fw-bold text-dark mb-0">Monthly Tax Liabilities & ITC Comparison</h2>
            </div>
            <div className="table-responsive">
              <table className="table table-bordered align-middle mb-0">
                <thead className="table-light small">
                  <tr>
                    <th className="ps-3.5">Return Type</th>
                    <th>Period</th>
                    <th className="text-end">Taxable Value (₹)</th>
                    <th className="text-end">IGST (₹)</th>
                    <th className="text-end">CGST (₹)</th>
                    <th className="text-end">SGST (₹)</th>
                    <th className="text-end pe-3.5">Total Tax (₹)</th>
                  </tr>
                </thead>
                <tbody className="small">
                  {returns.map((ret, idx) => (
                    <tr key={idx}>
                      <td className="ps-3.5 fw-bold text-dark">{ret.type}</td>
                      <td className="font-monospace">{formatPeriod(ret.period)}</td>
                      <td className="text-end font-monospace">{formatCurrency(ret.totals?.taxable || 0)}</td>
                      <td className="text-end font-monospace">{formatCurrency(ret.totals?.igst || 0)}</td>
                      <td className="text-end font-monospace">{formatCurrency(ret.totals?.cgst || 0)}</td>
                      <td className="text-end font-monospace">{formatCurrency(ret.totals?.sgst || 0)}</td>
                      <td className="text-end font-monospace fw-bold text-dark pe-3.5">
                        {formatCurrency((ret.totals?.igst || 0) + (ret.totals?.cgst || 0) + (ret.totals?.sgst || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Available Return Periods & Filing Status Grid */}
        {!loading && periods.length > 0 && (
          <div className="card border shadow-sm bg-white overflow-hidden">
            <div className="card-header bg-light py-2.5 px-3.5 border-bottom">
              <h3 className="fs-6 fw-bold text-dark mb-0">Return Periods & Official Status Tracker</h3>
            </div>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0 small">
                <thead className="table-light">
                  <tr>
                    <th className="ps-3.5">Tax Period</th>
                    <th>Financial Year</th>
                    <th>GSTR-1 Status</th>
                    <th>GSTR-2B Status</th>
                    <th>GSTR-3B Status</th>
                    <th className="text-end pe-3.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p, idx) => (
                    <tr key={p.period || idx}>
                      <td className="ps-3.5 font-monospace fw-bold text-dark">{formatPeriod(p.period)}</td>
                      <td className="text-muted">{p.financialYear}</td>
                      <td>
                        <span
                          className={`badge ${
                            p.gstr1 === 'FILED' ? 'bg-success-subtle text-success border border-success-subtle' : 'bg-secondary-subtle text-secondary'
                          }`}
                        >
                          {p.gstr1}
                        </span>
                      </td>
                      <td>
                        <span className="badge bg-info-subtle text-info border border-info-subtle">
                          {p.gstr2b}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            p.gstr3b === 'FILED' ? 'bg-success-subtle text-success border border-success-subtle' : 'bg-secondary-subtle text-secondary'
                          }`}
                        >
                          {p.gstr3b}
                        </span>
                      </td>
                      <td className="text-end pe-3.5">
                        <Link
                          to={`/returns/gstr1?period=${p.period}`}
                          className="btn btn-sm btn-link text-primary text-decoration-none p-0 fw-semibold"
                        >
                          View Breakdown →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <NilReturnModal
        isOpen={nilModalOpen}
        onClose={() => setNilModalOpen(false)}
        initialPeriod={period}
        initialType="GSTR1"
        onSuccess={() => fetchSummary(period)}
      />
    </div>
  );
}
