import { useState } from 'react';
import { TrendingUp, Building2, FileText, RefreshCw, FileCode2, Zap, ShieldCheck, CheckCircle2, Sparkles } from 'lucide-react';
import Button from '../ui/Button';
import { formatDate } from '../../utils/format';
import { generateSummary } from '../../api/returns.api';

/**
 * Action buttons bar for GSTR-1
 * @param {Object} props
 * @param {boolean} props.isPortalGstr1Active
 * @param {boolean} props.gstr1Loading
 * @param {Object|null} props.liveGstr1Data
 * @param {Function} props.onToggleViewMode
 * @param {Function} props.onRefresh
 * @param {Function} props.onOpenJsonModal
 * @param {Function} props.onOpenNilModal
 * @param {Function} props.onOpenEvcModal
 * @param {boolean} [props.canFileEvc]
 * @param {Object|null} [props.gstr1Filing]
 * @param {string} [props.period]
 */
export function ActionBar({
  isPortalGstr1Active = false,
  gstr1Loading = false,
  liveGstr1Data = null,
  gstr1Filing = null,
  period = '',
  onToggleViewMode,
  onRefresh,
  onOpenJsonModal,
  onOpenNilModal,
  onOpenEvcModal,
  canFileEvc,
  // Backwards compatibility aliases
  onSwitchMode,
  onRefreshPortal,
  setGstr1ViewMode,
  summary
}) {
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryMsg, setSummaryMsg] = useState(null);

  const handleModeToggle = (mode) => {
    if (onToggleViewMode) onToggleViewMode(mode);
    else if (onSwitchMode) onSwitchMode(mode);
    else if (setGstr1ViewMode) setGstr1ViewMode(mode);
  };

  const handleRefreshClick = () => {
    if (onRefresh) onRefresh();
    else if (onRefreshPortal) onRefreshPortal();
  };

  const handleGenerateSummary = async () => {
    if (!period) return;
    setGeneratingSummary(true);
    setSummaryMsg(null);
    try {
      const res = await generateSummary(period, { returnType: 'GSTR1' });
      setSummaryMsg(res.message || 'Summary generation requested on GST Portal.');
      setTimeout(() => setSummaryMsg(null), 6000);
      setTimeout(() => {
        if (onRefresh) onRefresh();
        else if (onRefreshPortal) onRefreshPortal();
      }, 3000);
    } catch (err) {
      alert(err?.message || 'Failed to request summary generation on GST portal.');
    } finally {
      setGeneratingSummary(false);
    }
  };

  const isEvcDisabled = gstr1Loading || (
    canFileEvc !== undefined
      ? !canFileEvc
      : (!isPortalGstr1Active && summary?.includedInvoices === 0)
  );

  return (
    <div className="space-y-2">
      {summaryMsg && (
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold flex items-center gap-2 animate-in fade-in shadow-2xs">
          <Sparkles className="w-4 h-4 text-blue-600 animate-pulse shrink-0" />
          <span>{summaryMsg}</span>
        </div>
      )}
      <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      {/* Header with Title and Badges */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100/80 flex items-center justify-center text-indigo-600 shrink-0">
          <TrendingUp className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-none">
              GSTR-1 Outward Supplies
            </h2>
            {isPortalGstr1Active ? (
              <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Govt GST Portal Data
              </span>
            ) : (
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                7 Tables
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {isPortalGstr1Active
              ? `Official filed return data retrieved from GST System (TaxPro API) • Fetched: ${
                  liveGstr1Data?.fetchedAt ? formatDate(liveGstr1Data.fetchedAt) : 'Synced'
                }`
              : 'Categorized outward supply tables. Click any card to inspect invoices.'}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2.5 flex-wrap shrink-0">
        {/* View mode toggle (Govt Portal / Local Invoices) */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-medium border border-slate-200">
          <button
            type="button"
            onClick={() => handleModeToggle('taxpro')}
            disabled={gstr1Loading && !isPortalGstr1Active}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 cursor-pointer ${
              isPortalGstr1Active
                ? 'bg-white text-emerald-700 shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {gstr1Loading && !isPortalGstr1Active ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
            )}
            <span>{gstr1Loading && !isPortalGstr1Active ? 'Fetching...' : 'Govt Portal'}</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeToggle('local')}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 cursor-pointer ${
              !isPortalGstr1Active
                ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-indigo-600" />
            <span>Local Invoices</span>
          </button>
        </div>

        {/* Refresh button (if portal mode) */}
        {isPortalGstr1Active && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshClick}
            disabled={gstr1Loading}
            className="bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${gstr1Loading ? 'animate-spin' : ''}`} />
            <span>{liveGstr1Data ? 'Refresh Portal' : 'Fetch Portal GSTR-1'}</span>
          </Button>
        )}

        {/* Generate Portal Summary Button (1-click trigger from software) */}
        {!gstr1Filing && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateSummary}
            disabled={generatingSummary || gstr1Loading}
            className="bg-blue-50/80 border-blue-300 text-blue-700 hover:bg-blue-100 hover:border-blue-400 text-xs font-semibold shadow-2xs"
            title="Generate official return summary on GST Portal"
          >
            <Sparkles className={`w-3.5 h-3.5 mr-1 text-blue-600 ${generatingSummary ? 'animate-spin' : ''}`} />
            <span>{generatingSummary ? 'Generating...' : 'Generate Summary'}</span>
          </Button>
        )}

        {/* JSON Payload button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenJsonModal}
          className="text-slate-700 border-slate-200 hover:bg-slate-50"
        >
          <FileCode2 className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
          <span>JSON Payload</span>
        </Button>

        {/* Filing Action buttons or Already Filed indicator */}
        {gstr1Filing ? (
          <Button
            variant="outline"
            size="sm"
            disabled={true}
            className="text-emerald-800 border-emerald-300 bg-emerald-50 font-semibold shadow-2xs opacity-90 cursor-not-allowed"
            title={`Return already filed with official ARN: ${gstr1Filing.arn}`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
            <span>Already Filed ({gstr1Filing.arn.slice(0, 8)}...)</span>
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenNilModal}
              className="text-amber-800 border-amber-300 bg-amber-50/70 hover:bg-amber-100 hover:border-amber-400 font-semibold shadow-2xs"
            >
              <Zap className="w-3.5 h-3.5 mr-1.5 text-amber-600 fill-amber-500" />
              <span>File Nil Return</span>
            </Button>

            <Button
              variant="fintech"
              size="sm"
              onClick={onOpenEvcModal}
              disabled={isEvcDisabled}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-xs"
            >
              <ShieldCheck className="w-4 h-4 mr-1.5" />
              <span>File with EVC (Aadhaar/PAN)</span>
            </Button>
          </>
        )}
      </div>
    </div>
  </div>
  );
}

export default ActionBar;
