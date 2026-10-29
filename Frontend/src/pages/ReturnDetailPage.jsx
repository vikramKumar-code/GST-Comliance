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
import NilReturnModal from '../components/NilReturnModal';

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
  const [isNilModalOpen, setIsNilModalOpen] = useState(false);

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
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <PeriodSelector selectedPeriod={period} onPeriodChange={handlePeriodChange} />
          {(formattedType === 'GSTR1' || formattedType === 'GSTR3B') && (
            <button
              type="button"
              className="btn btn-outline-success btn-sm d-flex align-items-center gap-1.5 text-nowrap fw-semibold px-3"
              onClick={() => setIsNilModalOpen(true)}
              title={`File Nil ${formattedType} return under CGST Rule 67A`}
            >
              <span>⚡ File Nil Return</span>
            </button>
          )}
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
        {/* Nil Return Filed Banner */}
        {returnData?.isNil && (
          <div className="alert alert-success border border-success-subtle py-2.5 px-3.5 mb-4 rounded-3 d-flex align-items-center justify-content-between flex-wrap gap-2 shadow-xs">
            <div className="d-flex align-items-center gap-2">
              <span className="fs-5">✅</span>
              <div>
                <strong className="d-block text-dark">
                  Nil {formattedType} Return Filed Successfully (CGST Rule 67A)
                </strong>
                <span className="text-secondary small">
                  Application Reference Number (ARN): <strong className="font-monospace text-primary">{returnData.arn}</strong> • Status: <strong>FILED</strong> • Mode: {returnData.filingMode || 'ONLINE'}
                </span>
              </div>
            </div>
            <span className="badge bg-success font-monospace px-2.5 py-1.5">ARN: {returnData.arn}</span>
          </div>
        )}
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

        {/* Workspace Unlinked Notice */}
        {returnData?.unlinked && (
          <div className="alert alert-info border border-info-subtle py-2.5 px-3 mb-4 rounded-3 d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div className="d-flex align-items-center gap-2">
              <span className="fs-5">ℹ️</span>
              <div>
                <strong className="d-block text-dark">Workspace GSTIN Unlinked</strong>
                <span className="text-secondary small">
                  This workspace has not linked a GSTIN yet. To download official returns from the GST Portal, link your GSTIN in Settings or sign in via GSTIN OTP.
                </span>
              </div>
            </div>
            {formattedType === 'GSTR1' && (
              <button
                type="button"
                className="btn btn-sm btn-outline-primary fw-semibold"
                onClick={() => setIsPrepareOpen(true)}
              >
                📋 Prepare GSTR-1 from Invoices
              </button>
            )}
          </div>
        )}

        {/* Empty Line Items Notice */}
        {!loading && returnData && !returnData.unlinked && (returnData.rows?.length === 0) && (
          <div className="alert alert-light border py-2.5 px-3 mb-4 rounded-3 d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div className="d-flex align-items-center gap-2">
              <span className="fs-5">📋</span>
              <div>
                <strong className="d-block text-dark">No Return Records for {formatPeriod(period)}</strong>
                <span className="text-muted small">
                  {formattedType === 'GSTR1'
                    ? 'No line items saved for this period yet. Create Sales Invoices and click "Prepare GSTR-1" to generate, or click "Fetch Return" to sync from the GST portal.'
                    : 'No return line items found for this period. Click "Fetch Return" to sync directly from the GST portal.'}
                </span>
              </div>
            </div>
            {formattedType === 'GSTR1' && (
              <button
                type="button"
                className="btn btn-sm btn-primary fw-semibold"
                onClick={() => setIsPrepareOpen(true)}
              >
                📋 Prepare GSTR-1
              </button>
            )}
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
          onOpenNilModal={() => setIsNilModalOpen(true)}
        />
      )}

      {formattedType === 'GSTR2B' && (
        <ItcReconciliationModal
          isOpen={isReconcileOpen}
          onClose={() => setIsReconcileOpen(false)}
          initialPeriod={period}
        />
      )}

      <NilReturnModal
        isOpen={isNilModalOpen}
        onClose={() => setIsNilModalOpen(false)}
        initialPeriod={period}
        initialType={formattedType}
        onSuccess={() => executeFetch(type, period)}
      />
    </div>
  );
}
