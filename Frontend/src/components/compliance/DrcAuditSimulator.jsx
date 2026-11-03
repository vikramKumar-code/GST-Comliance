import { ShieldCheck, AlertTriangle, AlertCircle, Scale, CheckCircle2, Info } from 'lucide-react';
import { formatCurrency } from '../../utils/format';

/**
 * DRC-01B & DRC-01C Automated Pre-Filing Statutory Audit Simulator
 * References:
 * - CGST Rule 88C (Form DRC-01B): GSTR-1 vs GSTR-3B Outward Tax Liability
 * - CGST Rule 88D (Form DRC-01C): GSTR-3B vs GSTR-2B Input Tax Credit
 */
export default function DrcAuditSimulator({
  gstr1Tax = 0,
  gstr3bTax = 0,
  gstr2bItc = 0,
  gstr3bItc = 0,
}) {
  // DRC-01B Calculation: GSTR-1 vs GSTR-3B
  const outwardDiff = Math.max(0, gstr1Tax - gstr3bTax);
  const outwardDiffPct = gstr1Tax > 0 ? (outwardDiff / gstr1Tax) * 100 : 0;
  const isDrc01bBreached = outwardDiff > 2500000 || outwardDiffPct > 20;

  // DRC-01C Calculation: GSTR-3B ITC claimed vs GSTR-2B ITC available
  const itcExcess = Math.max(0, gstr3bItc - gstr2bItc);
  const itcExcessPct = gstr2bItc > 0 ? (itcExcess / gstr2bItc) * 100 : 0;
  const isDrc01cBreached = itcExcess > 2500000 || itcExcessPct > 20;

  const overallSafe = !isDrc01bBreached && !isDrc01cBreached && outwardDiff === 0 && itcExcess === 0;

  return (
    <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
            overallSafe ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-amber-50 text-amber-600 border border-amber-200'
          }`}>
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">DRC-01 Statutory Risk Simulator</h3>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                overallSafe
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}>
                {overallSafe ? 'Zero Notice Risk' : 'Audit Scrutiny Active'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Pre-filing threshold validation under CGST Rules 88C (DRC-01B) & 88D (DRC-01C)
            </p>
          </div>
        </div>

        <div className="text-right sm:block hidden">
          <span className="text-[11px] text-slate-400 font-mono">GSTN Rule Threshold: 20% or ₹25 Lakh</span>
        </div>
      </div>

      {/* Two Comparison Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Rule 88C / DRC-01B */}
        <div className={`p-4 rounded-xl border ${
          isDrc01bBreached
            ? 'bg-rose-50/60 border-rose-200 text-rose-950'
            : outwardDiff > 0
            ? 'bg-amber-50/60 border-amber-200 text-amber-950'
            : 'bg-slate-50/70 border-slate-200 text-slate-900'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">
              Rule 88C: Outward Tax Liability (DRC-01B)
            </span>
            {isDrc01bBreached ? (
              <span className="flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md">
                <AlertCircle className="w-3 h-3" /> DRC-01B Risk
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
                <CheckCircle2 className="w-3 h-3" /> Safe
              </span>
            )}
          </div>

          <div className="flex items-baseline justify-between mt-2">
            <div>
              <span className="text-[11px] text-slate-500 block">GSTR-1 Outward</span>
              <strong className="text-sm font-bold text-slate-900 font-mono">{formatCurrency(gstr1Tax)}</strong>
            </div>
            <div className="text-center">
              <span className="text-[11px] text-slate-500 block">GSTR-3B Declared</span>
              <strong className="text-sm font-bold text-slate-900 font-mono">{formatCurrency(gstr3bTax)}</strong>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-slate-500 block">Variance</span>
              <strong className={`text-sm font-bold font-mono ${outwardDiff > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {outwardDiff > 0 ? `+${formatCurrency(outwardDiff)} (${outwardDiffPct.toFixed(1)}%)` : '₹0.00 (0%)'}
              </strong>
            </div>
          </div>
        </div>

        {/* Card 2: Rule 88D / DRC-01C */}
        <div className={`p-4 rounded-xl border ${
          isDrc01cBreached
            ? 'bg-rose-50/60 border-rose-200 text-rose-950'
            : itcExcess > 0
            ? 'bg-amber-50/60 border-amber-200 text-amber-950'
            : 'bg-slate-50/70 border-slate-200 text-slate-900'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">
              Rule 88D: Input Tax Credit (DRC-01C)
            </span>
            {isDrc01cBreached ? (
              <span className="flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md">
                <AlertCircle className="w-3 h-3" /> DRC-01C Risk
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
                <CheckCircle2 className="w-3 h-3" /> Safe
              </span>
            )}
          </div>

          <div className="flex items-baseline justify-between mt-2">
            <div>
              <span className="text-[11px] text-slate-500 block">GSTR-2B Available</span>
              <strong className="text-sm font-bold text-slate-900 font-mono">{formatCurrency(gstr2bItc)}</strong>
            </div>
            <div className="text-center">
              <span className="text-[11px] text-slate-500 block">GSTR-3B Claimed</span>
              <strong className="text-sm font-bold text-slate-900 font-mono">{formatCurrency(gstr3bItc)}</strong>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-slate-500 block">Excess Claim</span>
              <strong className={`text-sm font-bold font-mono ${itcExcess > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {itcExcess > 0 ? `+${formatCurrency(itcExcess)} (${itcExcessPct.toFixed(1)}%)` : '₹0.00 (0%)'}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
