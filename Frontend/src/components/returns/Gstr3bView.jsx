import { Scale, RefreshCw, Zap, ShieldCheck, TrendingUp, CheckCircle2 } from 'lucide-react';
import Button from '../ui/Button';
import MetricCard from '../ui/MetricCard';
import { formatCurrency, formatPeriod } from '../../utils/format';

/**
 * GSTR-3B summary view
 * @param {Object} props
 * @param {string} props.period
 * @param {Object|null} props.gstr3bData
 * @param {boolean} props.otherReturnsLoading
 * @param {Function} props.fetchGstr3bData
 * @param {Function} props.onOpenNilModal
 * @param {Function} props.onOpenEvcModal
 * @param {number|null} props.outwardLiability
 * @param {number|null} props.g3bItcAvailable
 */
export function Gstr3bView({
  period,
  gstr3bData,
  otherReturnsLoading = false,
  fetchGstr3bData,
  onOpenNilModal,
  onOpenEvcModal,
  outwardLiability,
  g3bItcAvailable,
  onFetchGstr3b
}) {
  const handleRefresh = () => {
    if (fetchGstr3bData) {
      fetchGstr3bData(period);
    } else if (onFetchGstr3b) {
      onFetchGstr3b();
    }
  };

  const handleNil = () => {
    if (onOpenNilModal) onOpenNilModal('GSTR3B');
  };

  const handleEvc = () => {
    if (onOpenEvcModal) onOpenEvcModal('GSTR3B');
  };

  return (
    <div className="space-y-4 pt-1">
      {/* Info banner with refresh + nil + EVC buttons */}
      <div className="p-4 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs">
          <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <strong className="text-sm">GSTR-3B Summary Return & Tax Offsetting</strong>
            <p className="opacity-80 mt-0.5">
              GSTR-3B reports outward liability, ITC and payment details. Reconcile these entries with your books and portal data before filing.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={otherReturnsLoading}
            className="shrink-0 border-purple-300 text-purple-800 bg-white hover:bg-purple-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${otherReturnsLoading ? 'animate-spin' : ''}`} />
            <span>{gstr3bData ? 'Refresh 3B from Portal' : 'Fetch 3B from Portal'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNil}
            className="shrink-0 border-purple-300 text-purple-800 bg-white hover:bg-purple-50"
          >
            <Zap className="w-3.5 h-3.5 mr-1" />
            <span>File Nil GSTR-3B</span>
          </Button>
          <Button
            variant="fintech"
            size="sm"
            onClick={handleEvc}
            className="bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-xs shrink-0"
          >
            <ShieldCheck className="w-4 h-4 mr-1.5" />
            <span>File GSTR-3B with EVC</span>
          </Button>
        </div>
      </div>

      {/* 4 MetricCards (liability, ITC, utilized, payable) */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <MetricCard
          title="Table 3.1 Outward Liability"
          value={outwardLiability == null ? 'Not available' : formatCurrency(outwardLiability)}
          subtitle="From GSTR-3B rows only"
          variant="default"
          icon={TrendingUp}
        />
        <MetricCard
          title="Table 4 ITC reported"
          value={g3bItcAvailable == null ? 'Not available' : formatCurrency(g3bItcAvailable)}
          subtitle="Eligibility is not determined by this summary"
          variant="fintech"
          icon={CheckCircle2}
        />
        <MetricCard
          title="ITC Utilized"
          value="Not available"
          subtitle="GSTR-3B Table 6.1 allocation not returned"
          variant="default"
          icon={Scale}
        />
        <MetricCard
          title="Table 6.1 Net Cash Payable"
          value="Not available"
          subtitle="Requires actual Table 6.1 data"
          variant="default"
          icon={Zap}
        />
      </div>

      {/* Payment ledger table placeholder */}
      <div className="bg-white rounded-xl border border-surface-border overflow-hidden shadow-xs mt-4">
        <div className="p-3.5 bg-slate-50 border-b border-surface-border flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800">Table 6.1 Payment of Tax Settlement Ledger</span>
          <span className="text-xs text-slate-500 font-mono">Period: {formatPeriod(period)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/50 text-slate-600 font-semibold border-b border-surface-border">
              <tr>
                <th className="py-2.5 px-3.5 text-left">Tax settlement data</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-600">
                  Table 6.1 payment allocation was not included in the returned GSTR-3B data. No ITC utilization or cash payable estimate is shown.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Gstr3bView;
