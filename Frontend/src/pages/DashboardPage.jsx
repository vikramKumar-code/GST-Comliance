import { Link } from 'react-router-dom';
import useReturns from '../hooks/useReturns';
import PeriodSelector from '../components/PeriodSelector';
import SummaryCards from '../components/SummaryCards';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import EmptyState from '../components/EmptyState';
import { formatDate } from '../utils/format';

export default function DashboardPage() {
  const {
    period,
    setPeriod,
    dashboardData,
    loading,
    error,
    isDataNotAvailable,
    isStale,
    updatedAt,
    refresh,
  } = useReturns();

  return (
    <div className="container py-4">
      {/* Top Header & Period Selector */}
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 mb-4">
        <div>
          <h1 className="fw-bold fs-2 text-dark mb-1">Taxpayer Compliance Dashboard</h1>
          <p className="text-secondary small mb-0">
            Real-time reconciliation of outward sales, eligible ITC, and tax liabilities.
          </p>
        </div>
        <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
      </div>

      {/* Stale Cache Notice */}
      {isStale && dashboardData && (
        <div
          className="alert alert-warning py-2 px-3 mb-4 d-flex align-items-center gap-2 small rounded-3"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">⚠️</span>
          <span>
            Showing cached data from <strong>{formatDate(updatedAt)}</strong>. Live GST service is currently unavailable.
          </span>
        </div>
      )}

      {/* Error Message for genuine errors (not 404 DATA_NOT_AVAILABLE) */}
      <ErrorMessage error={error} onRetry={refresh} />

      {/* Loading Indicator */}
      {loading && (
        <div className="py-4">
          <Loader message="Fetching return summaries and dashboard metrics..." />
        </div>
      )}

      {/* 404 DATA_NOT_AVAILABLE Calm Empty State (PeriodSelector stays visible) */}
      {!loading && isDataNotAvailable && (
        <EmptyState
          title="Return Data Not Available"
          message="Data for this period is not available yet. Try another month."
          action={
            <button type="button" onClick={refresh} className="btn btn-outline-primary btn-sm">
              Check Again
            </button>
          }
        />
      )}

      {/* Live Dashboard Data Content */}
      {!loading && !isDataNotAvailable && dashboardData && (
        <>
          <SummaryCards data={dashboardData} />

          <div className="card shadow-sm border mb-4 bg-white">
            <div className="card-body p-4">
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                <div>
                  <h2 className="fw-bold fs-5 text-dark mb-0">GST Returns Breakdown</h2>
                  <p className="text-secondary small mb-0">
                    Detailed line items and table summaries for period {period}:
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refresh}
                  className="btn btn-outline-secondary btn-sm"
                  title="Refresh return data"
                >
                  ↻ Refresh Data
                </button>
              </div>

              <div className="row g-3">
                {/* GSTR-1 */}
                <div className="col-12 col-md-4">
                  <Link to={`/returns/gstr1?period=${period}`} className="text-decoration-none">
                    <div className="card h-100 p-3 return-hover-card">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h3 className="fw-bold fs-6 mb-0 text-dark">GSTR-1</h3>
                        <span className="badge bg-primary-subtle text-primary border border-primary-subtle">
                          Outward Supplies
                        </span>
                      </div>
                      <p className="text-muted small mb-0">
                        Details of sales, B2B invoices, and export supplies
                      </p>
                    </div>
                  </Link>
                </div>

                {/* GSTR-2B */}
                <div className="col-12 col-md-4">
                  <Link to={`/returns/gstr2b?period=${period}`} className="text-decoration-none">
                    <div className="card h-100 p-3 return-hover-card">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h3 className="fw-bold fs-6 mb-0 text-dark">GSTR-2B</h3>
                        <span className="badge bg-info-subtle text-info-emphasis border border-info-subtle">
                          Inward Supplies
                        </span>
                      </div>
                      <p className="text-muted small mb-0">
                        Auto-drafted ITC statement from supplier filings
                      </p>
                    </div>
                  </Link>
                </div>

                {/* GSTR-3B */}
                <div className="col-12 col-md-4">
                  <Link to={`/returns/gstr3b?period=${period}`} className="text-decoration-none">
                    <div className="card h-100 p-3 return-hover-card">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h3 className="fw-bold fs-6 mb-0 text-dark">GSTR-3B</h3>
                        <span className="badge bg-success-subtle text-success border border-success-subtle">
                          Tax Summary
                        </span>
                      </div>
                      <p className="text-muted small mb-0">
                        Monthly summary of tax liability and ITC offsetting
                      </p>
                    </div>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
