import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getReturnsSummary } from '../api/returns.api';
import { getLastMonthPeriod } from '../hooks/useReturns';
import PeriodSelector from '../components/PeriodSelector';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import EmptyState from '../components/EmptyState';
import { formatPeriod } from '../utils/format';

export default function FilingHistoryPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(getLastMonthPeriod());
  const [filings, setFilings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHistory = useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getReturnsSummary(p);
      setFilings(data?.filings || []);
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
      fetchHistory(period);
    });
    return () => {
      ignore = true;
    };
  }, [fetchHistory, period]);

  return (
    <div>
      <div className="zoho-page-header d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        <div>
          <h1 className="fw-bold fs-4 text-dark mb-1">GST Filing History & Track Status</h1>
          <p className="text-secondary small mb-0">
            Official Application Reference Numbers (ARN) and filing acknowledgments for GSTIN {user?.gstin}.
          </p>
        </div>
        <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
      </div>

      <div className="zoho-page-body">
        <ErrorMessage error={error} onRetry={() => fetchHistory(period)} />

        {loading && (
          <div className="py-4">
            <Loader message="Fetching filing history and tracking records..." />
          </div>
        )}

        {!loading && !error && filings.length === 0 && (
          <EmptyState
            title="No Filing Records"
            message="No return filing acknowledgments found for this period. Try another financial period or check back after filing."
            action={
              <button
                type="button"
                onClick={() => fetchHistory(period)}
                className="btn btn-outline-primary btn-sm"
              >
                ↻ Refresh
              </button>
            }
          />
        )}

        {!loading && filings.length > 0 && (
          <div className="card border shadow-sm bg-white overflow-hidden">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light small">
                  <tr>
                    <th className="ps-3.5">Return Form</th>
                    <th>Period</th>
                    <th>ARN (Ack Reference #)</th>
                    <th>Filing Date</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th className="text-end pe-3.5">Action</th>
                  </tr>
                </thead>
                <tbody className="small">
                  {filings.map((f, idx) => {
                    const cleanType = String(f.type || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    return (
                      <tr key={f.arn || idx}>
                        <td className="ps-3.5 fw-bold text-dark">{f.type}</td>
                        <td className="font-monospace">{formatPeriod(f.period)}</td>
                        <td className="font-monospace fw-semibold text-primary">{f.arn}</td>
                        <td className="text-muted">{f.date}</td>
                        <td className="text-muted">{f.mode}</td>
                        <td>
                          <span className="badge bg-success-subtle text-success border border-success-subtle">
                            {f.status}
                          </span>
                        </td>
                        <td className="text-end pe-3.5">
                          <Link
                            to={`/returns/${cleanType}?period=${f.period}`}
                            className="btn btn-sm btn-link text-primary text-decoration-none p-0 fw-semibold"
                          >
                            View Data →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
