import { ArrowDownLeft, RefreshCw, Scale, CheckCircle2, Lock, FileText } from 'lucide-react';
import Button from '../ui/Button';
import MetricCard from '../ui/MetricCard';
import { formatCurrency, formatPeriod } from '../../utils/format';

/**
 * GSTR-2B ITC statement view
 * @param {Object} props
 * @param {string} props.period
 * @param {Object|null} props.gstr2bData
 * @param {boolean} props.otherReturnsLoading
 * @param {Function} props.fetchGstr2bData
 * @param {Function} props.onOpenReconcileModal
 * @param {Object} props.g2bTotals
 * @param {number} props.g2bTotalTax
 * @param {number} props.g2bCount
 * @param {number} props.gstr2bListedItc
 */
export function Gstr2bView({
  period,
  gstr2bData,
  otherReturnsLoading = false,
  fetchGstr2bData,
  onOpenReconcileModal,
  g2bTotals = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
  g2bTotalTax,
  g2bCount = 0,
  gstr2bListedItc = 0,
  onFetchGstr2b
}) {
  const itcDisplayAmount = gstr2bListedItc || g2bTotalTax || 0;

  const handleRefresh = () => {
    if (fetchGstr2bData) {
      fetchGstr2bData(period);
    } else if (onFetchGstr2b) {
      onFetchGstr2b();
    }
  };

  return (
    <div className="space-y-4 pt-1">
      {/* Info banner with refresh + reconcile buttons */}
      <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs">
          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
            <ArrowDownLeft className="w-5 h-5" />
          </div>
          <div>
            <strong className="text-sm">GSTR-2B Auto-Drafted Input Tax Credit Statement</strong>
            <p className="opacity-80 mt-0.5">
              Reflects supplier-reported inward supplies. Reconcile these records and assess statutory eligibility separately before claiming ITC.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={otherReturnsLoading}
            className="shrink-0 bg-white hover:bg-slate-50 border-blue-300 text-blue-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${otherReturnsLoading ? 'animate-spin' : ''}`} />
            <span>{gstr2bData ? 'Refresh 2B from Portal' : 'Fetch 2B from Portal'}</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onOpenReconcileModal}
            className="shrink-0 bg-blue-600 hover:bg-blue-700"
          >
            <Scale className="w-3.5 h-3.5 mr-1.5" />
            <span>Reconcile with Purchase Bills</span>
          </Button>
        </div>
      </div>

      {/* On-demand Fetch Prompt (before user clicks Fetch) */}
      {!gstr2bData ? (
        <div className="p-8 bg-white rounded-xl border border-dashed border-blue-300 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
            <ArrowDownLeft className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h4 className="text-sm font-semibold text-slate-800">
              GSTR-2B Data Not Fetched Yet ({formatPeriod(period)})
            </h4>
            <p className="text-xs text-slate-500">
              To save GST API usage, GSTR-2B is only fetched when you click the button below.
            </p>
          </div>
          <div className="pt-1">
            <Button
              variant="primary"
              size="sm"
              onClick={handleRefresh}
              disabled={otherReturnsLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${otherReturnsLoading ? 'animate-spin' : ''}`} />
              <span>{otherReturnsLoading ? 'Fetching GSTR-2B...' : 'Fetch GSTR-2B from Govt Portal'}</span>
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* 3 MetricCards (ITC reported, eligibility, bills count) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard
              title="ITC reported in GSTR-2B"
              value={formatCurrency(itcDisplayAmount)}
              subtitle="Supplier-reported amount; eligibility not determined"
              variant="fintech"
              icon={CheckCircle2}
            />
            <MetricCard
              title="ITC eligibility"
              value="Not assessed"
              subtitle="Review blocked credits and statutory conditions"
              variant="default"
              icon={Lock}
            />
            <MetricCard
              title="Total Inward Supplier Bills"
              value={`${g2bCount} Inward Records`}
              subtitle="Verified with vendor filings"
              variant="default"
              icon={FileText}
            />
          </div>

          {/* ITC breakdown table (if data exists) */}
          {gstr2bData?.rows && gstr2bData.rows.length > 0 ? (
            <div className="bg-white rounded-xl border border-surface-border overflow-hidden shadow-xs mt-4">
              <div className="p-3.5 bg-slate-50 border-b border-surface-border flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">GSTR-2B ITC Line Item Breakdown</span>
                <span className="text-xs text-slate-500 font-mono">Period: {formatPeriod(period)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50/50 text-slate-600 font-semibold border-b border-surface-border">
                    <tr>
                      <th className="py-2.5 px-3.5">Table / Category</th>
                      <th className="text-right py-2.5 px-3">Taxable Value (₹)</th>
                      <th className="text-right py-2.5 px-3">IGST (₹)</th>
                      <th className="text-right py-2.5 px-3">CGST (₹)</th>
                      <th className="text-right py-2.5 px-3">SGST (₹)</th>
                      <th className="text-right py-2.5 px-3.5">Total Tax (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gstr2bData.rows.map((r, idx) => (
                      <tr key={idx} className="border-b border-surface-border/50 hover:bg-slate-50/50">
                        <td className="py-2.5 px-3.5 font-medium text-slate-800">{r.label}</td>
                        <td className="text-right py-2.5 px-3 font-mono">{formatCurrency(r.taxable || 0)}</td>
                        <td className="text-right py-2.5 px-3 font-mono text-slate-600">{formatCurrency(r.igst || 0)}</td>
                        <td className="text-right py-2.5 px-3 font-mono text-slate-600">{formatCurrency(r.cgst || 0)}</td>
                        <td className="text-right py-2.5 px-3 font-mono text-slate-600">{formatCurrency(r.sgst || 0)}</td>
                        <td className="text-right py-2.5 px-3.5 font-mono font-bold text-brand-700">
                          {formatCurrency((r.igst || 0) + (r.cgst || 0) + (r.sgst || 0) + (r.cess || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t-2 border-surface-border">
                    <tr>
                      <td className="py-2.5 px-3.5 text-slate-900">Total ITC reported in GSTR-2B</td>
                      <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(g2bTotals.taxable || 0)}</td>
                      <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(g2bTotals.igst || 0)}</td>
                      <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(g2bTotals.cgst || 0)}</td>
                      <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(g2bTotals.sgst || 0)}</td>
                      <td className="text-right py-2.5 px-3.5 font-mono text-brand-700">{formatCurrency(itcDisplayAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            /* Empty state (if fetched and no data) */
            <div className="p-6 bg-white rounded-xl border border-surface-border text-center text-xs text-slate-500">
              No auto-drafted vendor records found in GSTR-2B for {formatPeriod(period)}. Suppliers file GSTR-1 by 11th, and GSTR-2B auto-drafts by 14th.
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Gstr2bView;
