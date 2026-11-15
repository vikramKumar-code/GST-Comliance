import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; // ✅ Added useAuth import
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
import {
  FileText,
  Zap,
  RefreshCw,
  Scale,
  Download,
  CheckCircle2,
  AlertTriangle,
  Info,
  Calendar,
  Layers,
  FileSpreadsheet
} from 'lucide-react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Card, { CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';

export default function ReturnDetailPage() {
  const { user } = useAuth(); // ✅ Extract user from Auth Context
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
    <div className="space-y-6">
      {/* Header and Actions */}
      <PageHeader
        title={`${formattedType} Return Breakdown`}
        subtitle={`Official line items, tax slabs, and liabilities for ${formattedType}`}
        badge={`Period: ${formatPeriod(period)}`}
        badgeVariant="fintech"
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <PeriodSelector selectedPeriod={period} onPeriodChange={handlePeriodChange} />

            {(formattedType === 'GSTR1' || formattedType === 'GSTR3B') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsNilModalOpen(true)}
                className="text-brand-700 border-brand-200 bg-brand-50/50 hover:bg-brand-50"
                title={`File Nil ${formattedType} return under CGST Rule 67A`}
              >
                <Zap className="w-3.5 h-3.5 mr-1 text-brand-600" />
                <span>File Nil Return</span>
              </Button>
            )}

            {formattedType === 'GSTR1' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPrepareOpen(true)}
                title="Prepare GSTR-1 return from sales invoices"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
                <span>Prepare GSTR-1</span>
              </Button>
            )}

            {formattedType === 'GSTR2B' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsReconcileOpen(true)}
                title="Reconcile GSTR-2B inward supplies with purchase bills"
              >
                <Scale className="w-3.5 h-3.5 mr-1.5" />
                <span>Reconcile ITC</span>
              </Button>
            )}

            <Button
              variant="primary"
              size="sm"
              onClick={() => executeFetch(type, period)}
              disabled={loading}
              title="Fetch return data from GST System"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Fetching...' : 'Fetch Return'}</span>
            </Button>
          </div>
        }
      />

      {/* Nil Return Filed Banner */}
      {returnData?.isNil && (
        <div className="p-4 rounded-xl border border-success-200 bg-success-50/80 text-success-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0" />
            <div className="text-xs">
              <strong className="block text-sm font-semibold">
                Nil {formattedType} Return Filed Successfully (CGST Rule 67A)
              </strong>
              <span className="opacity-90">
                Application Reference Number (ARN): <strong className="font-mono text-brand-700">{returnData.arn}</strong> • Status: <strong>FILED</strong> • Mode: {returnData.filingMode || 'ONLINE'}
              </span>
            </div>
          </div>
          <Badge variant="success" size="md" className="font-mono font-bold shrink-0 self-start sm:self-center">
            ARN: {returnData.arn}
          </Badge>
        </div>
      )}

      {/* Stale Cache Notice */}
      {isStale && returnData && (
        <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/80 text-amber-900 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Showing cached return data from <strong>{formatDate(timestamp)}</strong>. Live GST service is currently unavailable.
          </span>
        </div>
      )}

      {/* Workspace Unlinked Notice */}
      {returnData?.unlinked && (
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/80 text-blue-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs">
            <Info className="w-5 h-5 text-blue-600 shrink-0" />
            <div>
              <strong className="block text-sm font-semibold">Workspace GSTIN Unlinked</strong>
              <span className="opacity-90">
                This workspace has not linked a GSTIN yet. To download official returns from the GST Portal, link your GSTIN in Settings or sign in via GSTIN OTP.
              </span>
            </div>
          </div>
          {formattedType === 'GSTR1' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPrepareOpen(true)}
              className="shrink-0 bg-white"
            >
              Prepare GSTR-1 from Invoices
            </Button>
          )}
        </div>
      )}

      {/* Empty Line Items Notice */}
      {!loading && returnData && !returnData.unlinked && (returnData.rows?.length === 0) && (
        <div className="p-4 rounded-xl border border-surface-border bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs">
            <FileText className="w-5 h-5 text-slate-500 shrink-0" />
            <div>
              <strong className="block text-sm font-semibold text-slate-900">
                No Return Records for {formatPeriod(period)}
              </strong>
              <span className="text-slate-500">
                {formattedType === 'GSTR1'
                  ? 'No line items saved for this period yet. Create Sales Invoices and click "Prepare GSTR-1" to generate, or click "Fetch Return" to sync from the GST portal.'
                  : 'No return line items found for this period. Click "Fetch Return" to sync directly from the GST portal.'}
              </span>
            </div>
          </div>
          {formattedType === 'GSTR1' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsPrepareOpen(true)}
              className="shrink-0"
            >
              Prepare GSTR-1
            </Button>
          )}
        </div>
      )}

      {/* Error Message */}
      <ErrorMessage error={error} onRetry={() => executeFetch(type, period)} />

      {/* Loading Indicator */}
      {loading && (
        <div className="py-12 bg-white rounded-2xl border border-surface-border text-center">
          <Loader message={`Fetching ${formattedType} return data for period ${period}...`} />
        </div>
      )}

      {/* 404 DATA_NOT_AVAILABLE Calm Empty State */}
      {!loading && isDataNotAvailable && (
        <EmptyState
          title={`No ${formattedType} Data Available`}
          message="Data for this period is not available yet. Try another month or sync from the government portal."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => executeFetch(type, period)}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              <span>Retry Period</span>
            </Button>
          }
        />
      )}

      {/* Return Table Content */}
      {!loading && !isDataNotAvailable && returnData && (
        <Card className="overflow-hidden">
          <div className="flex justify-between items-center py-2.5 px-4 border-b border-surface-border bg-slate-50 text-xs text-slate-500">
            <span>
              Total Rows: <strong className="text-slate-900">{returnData.rows?.length || 0}</strong> • Last synchronized:{' '}
              {formatDate(timestamp)}
            </span>
            <button
              type="button"
              onClick={() => executeFetch(type, period)}
              className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 font-semibold cursor-pointer"
              title="Refresh return data"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </button>
          </div>
          <ReturnTable rows={returnData.rows || []} totals={returnData.totals || null} />
        </Card>
      )}

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

      {/* ✅ FIX: Added gstin and username props required by NilReturnModal */}
      <NilReturnModal
        isOpen={isNilModalOpen}
        onClose={() => setIsNilModalOpen(false)}
        initialPeriod={period}
        initialType={formattedType}
        onSuccess={() => executeFetch(type, period)}
        gstin={user?.gstin}
        username={user?.portalUsername}
      />
    </div>
  );
}