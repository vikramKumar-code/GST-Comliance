import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getReturnsSummary } from '../api/returns.api';
import { getLastMonthPeriod } from '../hooks/useReturns';
import { useAuth } from '../context/AuthContext'; // ✅ Added useAuth import
import PeriodSelector from '../components/PeriodSelector';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import EmptyState from '../components/EmptyState';
import { formatCurrency, formatPeriod } from '../utils/format';
import NilReturnModal from '../components/NilReturnModal';
import {
  FileText,
  Layers,
  Zap,
  TrendingUp,
  CheckCircle2,
  ArrowRight,
  Clock,
  Scale,
  Calendar
} from 'lucide-react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Card, { CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell
} from '../components/ui/Table';

export default function ReturnSummaryPage() {
  const { user } = useAuth(); // ✅ Extract user from Auth Context
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

  // ✅ Safe fallback in case API wraps response in a 'data' object
  const returns = summaryData?.returns || summaryData?.data?.returns || [];
  const periods = summaryData?.availablePeriods || summaryData?.data?.availablePeriods || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Unified Return Summary"
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
          </div>
        }
      />

      <ErrorMessage error={error} onRetry={() => fetchSummary(period)} />

      {loading && (
        <div className="py-12 bg-white rounded-2xl border border-surface-border text-center">
          <Loader message="Fetching unified return summary..." />
        </div>
      )}

      {!loading && !error && returns.length === 0 && (
        <EmptyState
          title="No Return Summary for this Period"
          message="Return data for this month has not been fetched yet. Open the return breakdowns to fetch data from GST portal."
          action={
            <div className="flex items-center justify-center gap-2.5 flex-wrap">
              <Link to={`/returns/gstr1?period=${period}`}>
                <Button variant="primary" size="sm">
                  Fetch GSTR-1 →
                </Button>
              </Link>
              <Link to={`/returns/gstr2b?period=${period}`}>
                <Button variant="outline" size="sm">
                  Fetch GSTR-2B →
                </Button>
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNilModalOpen(true)}
                className="text-brand-700 border-brand-200"
              >
                <Zap className="w-3.5 h-3.5 mr-1" />
                <span>File Nil Return</span>
              </Button>
            </div>
          }
        />
      )}

      {/* Monthly Tax Liabilities & ITC Comparison */}
      {!loading && returns.length > 0 && (
        <Card>
          <CardHeader className="py-3.5 px-5 border-b border-surface-border bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-brand-600" />
              <CardTitle className="text-sm">Monthly Tax Liabilities & ITC Comparison</CardTitle>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">Return Type</TableHead>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">Period</TableHead>
                  <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">Taxable Value (₹)</TableHead>
                  <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">IGST (₹)</TableHead>
                  <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">CGST (₹)</TableHead>
                  <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">SGST (₹)</TableHead>
                  <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">Total Tax (₹)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returns.map((ret, idx) => (
                  <TableRow key={ret.type || idx} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="py-3 px-4 font-bold text-slate-900">{ret.type}</TableCell>
                    <TableCell className="py-3 px-4 font-mono text-slate-600">{formatPeriod(ret.period)}</TableCell>
                    <TableCell className="text-right py-3 px-4 font-mono font-medium">{formatCurrency(ret.totals?.taxable || 0)}</TableCell>
                    <TableCell className="text-right py-3 px-4 font-mono text-slate-600">{formatCurrency(ret.totals?.igst || 0)}</TableCell>
                    <TableCell className="text-right py-3 px-4 font-mono text-slate-600">{formatCurrency(ret.totals?.cgst || 0)}</TableCell>
                    <TableCell className="text-right py-3 px-4 font-mono text-slate-600">{formatCurrency(ret.totals?.sgst || 0)}</TableCell>
                    <TableCell className="text-right py-3 px-4 font-mono font-bold text-brand-600">
                      {formatCurrency((ret.totals?.igst || 0) + (ret.totals?.cgst || 0) + (ret.totals?.sgst || 0))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Available Return Periods & Filing Status Grid */}
      {!loading && periods.length > 0 && (
        <Card>
          <CardHeader className="py-3.5 px-5 border-b border-surface-border bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand-600" />
              <CardTitle className="text-sm">Return Periods & Official Status Tracker</CardTitle>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">Tax Period</TableHead>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">Financial Year</TableHead>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">GSTR-1 Status</TableHead>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">GSTR-2B Status</TableHead>
                  <TableHead className="py-3 px-4 font-semibold text-slate-700">GSTR-3B Status</TableHead>
                  <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p, idx) => (
                  <TableRow key={p.period || idx} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="py-3 px-4 font-mono font-bold text-slate-900">{formatPeriod(p.period)}</TableCell>
                    <TableCell className="py-3 px-4 text-slate-500">{p.financialYear}</TableCell>
                    <TableCell className="py-3 px-4">
                      <Badge
                        variant={p.gstr1 === 'FILED' ? 'success' : 'neutral'}
                        size="sm"
                      >
                        {p.gstr1}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      <Badge variant="info" size="sm">
                        {p.gstr2b}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      <Badge
                        variant={p.gstr3b === 'FILED' ? 'success' : 'neutral'}
                        size="sm"
                      >
                        {p.gstr3b}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right py-3 px-4">
                      <Link
                        to={`/returns/gstr1?period=${p.period}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                      >
                        <span>View Breakdown</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
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
        onSuccess={() => fetchSummary(period)}
        gstin={user?.gstin}
        username={user?.portalUsername}
      />
    </div>
  );
}