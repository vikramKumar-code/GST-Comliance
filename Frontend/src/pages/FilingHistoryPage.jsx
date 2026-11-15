import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getReturnsSummary } from '../api/returns.api';
import { getLastMonthPeriod } from '../hooks/useReturns';
import PeriodSelector from '../components/PeriodSelector';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import EmptyState from '../components/EmptyState';
import { formatPeriod, formatDate } from '../utils/format';
import NilReturnModal from '../components/NilReturnModal';
import FilingCertificateModal from '../components/FilingCertificateModal';
import {
  ArrowRight,
  Copy,
  Check,
  RefreshCw,
  Award,
} from 'lucide-react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell
} from '../components/ui/Table';

export default function FilingHistoryPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(getLastMonthPeriod());
  const [filings, setFilings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nilModalOpen, setNilModalOpen] = useState(false);
  const [copiedArn, setCopiedArn] = useState(null);
  const [selectedCertificate, setSelectedCertificate] = useState(null);

  const fetchHistory = useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getReturnsSummary(p);
      // ✅ FIX: Robust data extraction - handle both 'filings' and 'data.filings' keys
      const filingsData = data?.filings || data?.data?.filings || [];
      setFilings(Array.isArray(filingsData) ? filingsData : []);
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

  const handleCopyArn = (arn) => {
    if (arn) {
      navigator.clipboard.writeText(arn);
      setCopiedArn(arn);
      setTimeout(() => setCopiedArn(null), 2000);
    }
  };

  // ✅ FIX: Robust date display helper
  const getFilingDate = (f) => {
    if (f.date) return f.date;
    if (f.dateStr) return f.dateStr;
    if (f.filingDate) return formatDate(f.filingDate);
    return 'Not available';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="GST Filing History"
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
          </div>
        }
      />

      <ErrorMessage error={error} onRetry={() => fetchHistory(period)} />

      {loading && (
        <div className="py-12 bg-white rounded-2xl border border-surface-border text-center">
          <Loader message="Fetching filing history and tracking records..." />
        </div>
      )}

      {!loading && !error && filings.length === 0 && (
        <EmptyState
          title="No Filing Records for this Period"
          message="No return filing acknowledgments found for this tax period. Try another financial period or check back after filing."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchHistory(period)}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              <span>Refresh Records</span>
            </Button>
          }
        />
      )}

      {!loading && filings.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">Return Form</TableHead>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">Period</TableHead>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">ARN (Ack Reference #)</TableHead>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">Filing Date</TableHead>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">Mode</TableHead>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">Status</TableHead>
                  <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filings.map((f, idx) => {
                  const cleanType = String(f.type || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                  const isCopied = copiedArn === f.arn;
                  return (
                    <TableRow key={f.arn || idx} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="py-3 px-4 font-bold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span>{f.type}</span>
                          {f.isNil && (
                            <Badge variant="info" size="sm" className="font-mono text-[10px]">
                              NIL
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 px-4 font-mono text-slate-600">
                        {formatPeriod(f.period)}
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-brand-700">{f.arn || '—'}</span>
                          {f.arn && (
                            <button
                              type="button"
                              onClick={() => handleCopyArn(f.arn)}
                              className="p-1 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                              title="Copy ARN"
                            >
                              {isCopied ? <Check className="w-3.5 h-3.5 text-success-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </TableCell>
                      {/* ✅ FIX: Use robust date helper */}
                      <TableCell className="py-3 px-4 text-slate-500">{getFilingDate(f)}</TableCell>
                      <TableCell className="py-3 px-4 text-slate-500 font-medium">{f.mode || '—'}</TableCell>
                      <TableCell className="py-3 px-4">
                        <Badge variant="success" size="sm">
                          {f.status || 'Filed'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedCertificate(f)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 px-2.5 py-1 rounded-lg transition shadow-2xs cursor-pointer"
                            title="View / Print Official Filing Certificate"
                          >
                            <Award className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Certificate</span>
                          </button>
                          <Link
                            to={`/returns/${cleanType}?period=${f.period}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline px-1.5 py-1"
                          >
                            <span>Data</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* ✅ FIX: Added gstin and username props required by NilReturnModal */}
      <NilReturnModal
        isOpen={nilModalOpen}
        onClose={() => setNilModalOpen(false)}
        initialPeriod={period}
        initialType="GSTR1"
        gstin={user?.gstin}
        username={user?.portalUsername || user?.email?.split('@')[0]}
        onSuccess={() => fetchHistory(period)}
      />

      <FilingCertificateModal
        isOpen={Boolean(selectedCertificate)}
        onClose={() => setSelectedCertificate(null)}
        filing={selectedCertificate}
        workspace={{
          name: user?.workspaceName || user?.currentWorkspace?.name,
          gstin: user?.gstin
        }}
      />
    </div>
  );
}