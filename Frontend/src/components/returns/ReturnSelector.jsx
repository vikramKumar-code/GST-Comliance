import { TrendingUp, ArrowDownLeft, Scale } from 'lucide-react';
import { formatCurrency } from '../../utils/format';

/**
 * Return type selector cards for GSTR-1, GSTR-2B, and GSTR-3B
 */
export function ReturnSelector({
  selectedReturn,
  onSelectReturn,
  g1InvoiceCount = 0,
  g2bCount = 0,
  g2bTotalTax = 0,
  isG1Filed = false,
  isG3bFiled = false
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* GSTR-1 Card */}
      <button
        type="button"
        onClick={() => onSelectReturn('gstr1')}
        className={`relative group w-full p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer text-left flex items-center justify-between overflow-hidden ${
          selectedReturn === 'gstr1'
            ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 border-indigo-600 text-white shadow-lg shadow-indigo-600/25 ring-2 ring-indigo-500/40 translate-y-[-1px]'
            : 'bg-white hover:bg-gradient-to-r hover:from-blue-50/60 hover:to-indigo-50/40 border-slate-200 hover:border-indigo-300 text-slate-800 hover:shadow-xs'
        }`}
        aria-pressed={selectedReturn === 'gstr1'}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
              selectedReturn === 'gstr1'
                ? 'bg-white/20 text-white backdrop-blur-xs'
                : 'bg-indigo-50 text-indigo-600 border border-indigo-100'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="truncate">
            <span
              className={`text-sm font-bold block leading-tight ${
                selectedReturn === 'gstr1' ? 'text-white' : 'text-slate-900'
              }`}
            >
              GSTR-1
            </span>
            <span
              className={`text-[11px] font-medium leading-none block truncate mt-0.5 ${
                selectedReturn === 'gstr1' ? 'text-indigo-100' : 'text-slate-500'
              }`}
            >
              Outward Supplies
            </span>
          </div>
        </div>
        <span
          className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg shrink-0 ml-2 transition-colors ${
            isG1Filed
              ? selectedReturn === 'gstr1' ? 'bg-emerald-500 text-white shadow-xs' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
              : selectedReturn === 'gstr1'
              ? 'bg-white text-indigo-700 shadow-xs'
              : 'bg-indigo-50 text-indigo-700 border border-indigo-200/80'
          }`}
        >
          {isG1Filed ? 'Filed ✅' : `${g1InvoiceCount} Invoices`}
        </span>
      </button>

      {/* GSTR-2B Card */}
      <button
        type="button"
        onClick={() => onSelectReturn('gstr2b')}
        className={`relative group w-full p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer text-left flex items-center justify-between overflow-hidden ${
          selectedReturn === 'gstr2b'
            ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-teal-700 border-emerald-600 text-white shadow-lg shadow-emerald-600/25 ring-2 ring-emerald-500/40 translate-y-[-1px]'
            : 'bg-white hover:bg-gradient-to-r hover:from-emerald-50/60 hover:to-teal-50/40 border-slate-200 hover:border-emerald-300 text-slate-800 hover:shadow-xs'
        }`}
        aria-pressed={selectedReturn === 'gstr2b'}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
              selectedReturn === 'gstr2b'
                ? 'bg-white/20 text-white backdrop-blur-xs'
                : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
            }`}
          >
            <ArrowDownLeft className="w-4 h-4" />
          </div>
          <div className="truncate">
            <span
              className={`text-sm font-bold block leading-tight ${
                selectedReturn === 'gstr2b' ? 'text-white' : 'text-slate-900'
              }`}
            >
              GSTR-2B
            </span>
            <span
              className={`text-[11px] font-medium leading-none block truncate mt-0.5 ${
                selectedReturn === 'gstr2b' ? 'text-emerald-100' : 'text-slate-500'
              }`}
            >
              Inward ITC Statement
            </span>
          </div>
        </div>
        <span
          className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg shrink-0 ml-2 transition-colors ${
            selectedReturn === 'gstr2b'
              ? 'bg-white text-emerald-800 shadow-xs'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
          }`}
        >
          {g2bCount > 0 ? `${g2bCount} Bills` : `${formatCurrency(g2bTotalTax)} ITC`}
        </span>
      </button>

      {/* GSTR-3B Card */}
      <button
        type="button"
        onClick={() => onSelectReturn('gstr3b')}
        className={`relative group w-full p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer text-left flex items-center justify-between overflow-hidden ${
          selectedReturn === 'gstr3b'
            ? 'bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-700 border-purple-600 text-white shadow-lg shadow-purple-600/25 ring-2 ring-purple-500/40 translate-y-[-1px]'
            : 'bg-white hover:bg-gradient-to-r hover:from-purple-50/60 hover:to-violet-50/40 border-slate-200 hover:border-purple-300 text-slate-800 hover:shadow-xs'
        }`}
        aria-pressed={selectedReturn === 'gstr3b'}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
              selectedReturn === 'gstr3b'
                ? 'bg-white/20 text-white backdrop-blur-xs'
                : 'bg-purple-50 text-purple-600 border border-purple-100'
            }`}
          >
            <Scale className="w-4 h-4" />
          </div>
          <div className="truncate">
            <span
              className={`text-sm font-bold block leading-tight ${
                selectedReturn === 'gstr3b' ? 'text-white' : 'text-slate-900'
              }`}
            >
              GSTR-3B
            </span>
            <span
              className={`text-[11px] font-medium leading-none block truncate mt-0.5 ${
                selectedReturn === 'gstr3b' ? 'text-purple-100' : 'text-slate-500'
              }`}
            >
              Monthly Tax Summary
            </span>
          </div>
        </div>
        <span
          className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg shrink-0 ml-2 transition-colors ${
            isG3bFiled
              ? selectedReturn === 'gstr3b' ? 'bg-emerald-500 text-white shadow-xs' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
              : selectedReturn === 'gstr3b'
              ? 'bg-white text-purple-800 shadow-xs'
              : 'bg-purple-50 text-purple-700 border border-purple-200/80'
          }`}
        >
          {isG3bFiled ? 'Filed ✅' : 'Net: Not available'}
        </span>
      </button>
    </div>
  );
}

export default ReturnSelector;

