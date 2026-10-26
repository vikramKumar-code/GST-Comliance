import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getReturnByType } from '../api/returns.api';
import { getLastMonthPeriod } from '../hooks/useReturns';
import PeriodSelector from '../components/PeriodSelector';
import ReturnTable from '../components/ReturnTable';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import EmptyState from '../components/EmptyState';
import { formatDate, formatPeriod } from '../utils/format';
import Gstr1PrepareModal from '../components/Gstr1PrepareModal';
import ItcReconciliationModal from '../components/ItcReconciliationModal';

export default function ReturnDetailPage() {
  const { type } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const formattedType = type ? type.toUpperCase() : 'GSTR1';
  const initialPeriod = searchParams.get('period') || getLastMonthPeriod();
  const [period, setPeriod] = useState(initialPeriod);

  const [returnData, setReturnData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDataNotAvailable, setIsDataNotAvailable] = useState(false);
  const [isPrepareOpen, setIsPrepareOpen] = useState(false);
  const [isReconcileOpen, setIsReconcileOpen] = useState(false);

  // Counter to ignore stale responses on fast period changes
  const requestIdRef = useRef(0);

  const executeFetch = useCallback((selectedType, selectedPeriod) => {
    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setIsDataNotAvailable(false);

    return getReturnByType(selectedType, selectedPeriod)
      .then((data) => {
        if (currentRequestId !== requestIdRef.current) return;
        setReturnData(data);
      })
      .catch((err) => {
        if (currentRequestId !== requestIdRef.current) return;
        if (err?.code === 'DATA_NOT_AVAILABLE' || err?.status === 404) {
          setIsDataNotAvailable(true);
          setReturnData(null);
          setError(null);
        } else {
          setError(err);
          setReturnData(null);
        }
      })
      .finally(() => {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    if (!type || !period) return;
    let ignore = false;
    const currentRequestId = ++requestIdRef.current;

    Promise.resolve().then(() => {
      if (ignore) return;
      setLoading(true);
      setError(null);
      setIsDataNotAvailable(false);

      getReturnByType(type, period)
        .then((data) => {
          if (ignore || currentRequestId !== requestIdRef.current) return;
          setReturnData(data);
        })
        .catch((err) => {
          if (ignore || currentRequestId !== requestIdRef.current) return;
          if (err?.code === 'DATA_NOT_AVAILABLE' || err?.status === 404) {
            setIsDataNotAvailable(true);
            setReturnData(null);
            setError(null);
          } else {
            setError(err);
            setReturnData(null);
          }
        })
        .finally(() => {
          if (!ignore && currentRequestId === requestIdRef.current) {
            setLoading(false);
          }
        });
    });

    return () => {
      ignore = true;
    };
  }, [type, period]);

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    setSearchParams({ period: newPeriod });
  };

  const isStale = Boolean(returnData?.stale);
  const timestamp = returnData?.fetchedAt || returnData?.updatedAt;

  return (
    <div>
      {/* Header and Period Selector */}
      <div className="zoho-page-header d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        <div>
          <div className="d-flex align-items-center gap-2 mb-1">
            <h1 className="fw-bold fs-4 text-dark mb-0">{formattedType} Return Breakdown</h1>
            <span className="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace">
              {formatPeriod(period)}
            </span>
          </div>
          <p className="text-secondary small mb-0">
            Official line items, tax slabs, and liabilities for {formattedType}.
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <PeriodSelector selectedPeriod={period} onPeriodChange={handlePeriodChange} />
          {formattedType === 'GSTR1' && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1.5 text-nowrap fw-semibold px-3"
              onClick={() => setIsPrepareOpen(true)}
              title="Prepare GSTR-1 return from sales invoices"
            >
              <span>📋 Prepare GSTR-1</span>
            </button>
          )}
          {formattedType === 'GSTR2B' && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1.5 text-nowrap fw-semibold px-3"
              onClick={() => setIsReconcileOpen(true)}
              title="Reconcile GSTR-2B inward supplies with purchase bills"
            >
              <span>⚖️ Reconcile ITC</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm d-flex align-items-center gap-1.5 text-nowrap fw-semibold px-3"
            onClick={() => executeFetch(type, period)}
            disabled={loading}
            title="Fetch return data from GST System"
          >
            {loading ? (
              <>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                <span>Fetching...</span>
              </>
            ) : (
              <>
                <span>⬇ Fetch Return</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="zoho-page-body">
        {/* Stale Cache Notice */}
        {isStale && returnData && (
          <div
            className="alert alert-warning py-2 px-3 mb-4 d-flex align-items-center gap-2 small rounded-3"
            role="status"
            aria-live="polite"
          >
            <span aria-hidden="true">⚠️</span>
            <span>
              Showing cached return data from <strong>{formatDate(timestamp)}</strong>. Live GST service is currently unavailable.
            </span>
          </div>
        )}

        {/* Error Message for real failures */}
        <ErrorMessage error={error} onRetry={() => executeFetch(type, period)} />

        {/* Loading Indicator */}
        {loading && (
          <div className="py-4">
            <Loader message={`Fetching ${formattedType} return data for period ${period}...`} />
          </div>
        )}

        {/* 404 DATA_NOT_AVAILABLE Calm Empty State (PeriodSelector stays visible) */}
        {!loading && isDataNotAvailable && (
          <EmptyState
            title={`No ${formattedType} Data Available`}
            message="Data for this period is not available yet. Try another month."
            action={
              <button
                type="button"
                onClick={() => executeFetch(type, period)}
                className="btn btn-outline-primary btn-sm"
              >
                Retry Period
              </button>
            }
          />
        )}

        {/* Return Table Content */}
        {!loading && !isDataNotAvailable && returnData && (
          <div className="card border shadow-sm bg-white overflow-hidden">
            <div className="d-flex justify-content-between align-items-center py-2.5 px-3.5 border-bottom bg-light small text-muted">
              <span>
                Total Rows: <strong className="text-dark">{returnData.rows?.length || 0}</strong> • Last synchronized:{' '}
                {formatDate(timestamp)}
              </span>
              <button
                type="button"
                onClick={() => executeFetch(type, period)}
                className="btn btn-outline-secondary btn-sm py-0.5 px-2"
                title="Refresh return data"
              >
                ↻ Refresh
              </button>
            </div>
            <ReturnTable rows={returnData.rows || []} totals={returnData.totals || null} />
          </div>
        )}
      </div>

      {formattedType === 'GSTR1' && (
        <Gstr1PrepareModal
          isOpen={isPrepareOpen}
          onClose={() => setIsPrepareOpen(false)}
          period={period}
        />
      )}

      {formattedType === 'GSTR2B' && (
        <ItcReconciliationModal
          isOpen={isReconcileOpen}
          onClose={() => setIsReconcileOpen(false)}
          initialPeriod={period}
        />
      )}
    </div>
  );
}
