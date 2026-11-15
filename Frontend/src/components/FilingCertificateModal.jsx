import { useState, useRef } from 'react';
import {
  ShieldCheck,
  Printer,
  Copy,
  Check,
  X,
  Award
} from 'lucide-react';
import { formatCurrency, formatPeriod, formatDate } from '../utils/format';
import Button from './ui/Button';
import Badge from './ui/Badge';

export default function FilingCertificateModal({
  isOpen,
  onClose,
  filing,
  workspace
}) {
  const [copied, setCopied] = useState(false);
  const printRef = useRef(null);

  if (!isOpen || !filing?.arn) return null;

  const arn = filing.arn;
  const period = filing.period;
  const returnType = filing.type || filing.returnType || 'GST return';
  const filingDate = filing.filingDate || filing.date;
  const dateStr = filing.dateStr || (filingDate ? formatDate(filingDate) : 'Not provided');
  const mode = filing.mode || filing.filingMode || 'Not provided';
  const isNil = Boolean(filing.isNil);
  const gstin = filing.gstin || workspace?.gstin || '';
  const legalName = filing.legalName || workspace?.name || '';
  const summary = filing.summary || {};

  const handleCopyArn = () => {
    navigator.clipboard.writeText(arn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 my-6">
        {/* Top Action Bar (Hidden in Print) */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            <span className="text-xs font-bold tracking-wide uppercase">
              GST Return Filing Summary
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="bg-white/10 text-white hover:bg-white/20 border-white/20 text-xs py-1"
            >
              <Printer className="w-3.5 h-3.5 mr-1" />
              <span>Print / Save PDF</span>
            </Button>
            <button
              type="button"
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable workspace filing summary */}
        <div ref={printRef} className="p-8 space-y-6 text-slate-900 bg-white">
          <div className="text-center pb-6 border-b-2 border-slate-800 space-y-2 relative">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-900 text-amber-400 mx-auto shadow-sm">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <h1 className="text-lg font-black tracking-wider uppercase text-slate-900 font-serif">
              GST Return Filing Summary
            </h1>
            <p className="text-xs font-semibold text-slate-600 tracking-wide uppercase">
              Filing details returned by the GST service provider
            </p>
            <div className="inline-block mt-1 px-3 py-1 bg-slate-100 rounded-md border border-slate-300 text-xs font-bold font-mono uppercase tracking-wider text-slate-800">
              Form GST {returnType} Filing Details
            </div>
          </div>

          {/* Provider-returned ARN */}
          <div className="p-4 rounded-xl bg-slate-50 border-2 border-indigo-900/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Application Reference Number (ARN):
              </span>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-xl font-black text-indigo-950 tracking-wider">
                  {arn}
                </span>
                <button
                  type="button"
                  onClick={handleCopyArn}
                  className="p-1 text-slate-400 hover:text-slate-600 transition cursor-pointer print:hidden"
                  title="Copy ARN"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Provider-confirmed ARN. Verify filing status on the GST portal.
              </span>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="w-16 h-16 border-2 border-slate-900 rounded-lg p-1 bg-white flex flex-col items-center justify-center text-center">
                <span className="font-mono text-[9px] font-bold text-slate-700">ARN</span>
                <span className="text-[7px] font-mono font-bold tracking-tight text-slate-500">ARN REF</span>
              </div>
              <div className="text-right">
                <Badge variant="success" size="sm" className="font-bold text-xs px-2.5 py-1">
                  ● ARN RECEIVED
                </Badge>
                <div className="text-[11px] text-slate-500 mt-1 font-mono font-medium">
                  {dateStr}
                </div>
              </div>
            </div>
          </div>

          {/* Taxpayer Information Grid */}
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                1. Workspace / Business Name
              </span>
              <strong className="text-sm text-slate-900 block font-semibold">
                {legalName || 'Not provided'}
              </strong>
              <span className="text-slate-500 text-[11px]">Name provided by the workspace</span>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                2. Goods & Services Tax ID (GSTIN)
              </span>
              <strong className="text-sm font-mono font-bold text-brand-700 block">
                {gstin || 'Not provided'}
              </strong>
              <span className="text-slate-500 text-[11px]">GSTIN state code: {gstin ? gstin.slice(0, 2) : 'Not provided'}</span>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                3. Return Form & Nature
              </span>
              <strong className="text-sm text-slate-900 block font-semibold">
                Form {returnType} {isNil ? '(Nil Return - Rule 67A)' : '(Standard Summary)'}
              </strong>
              <span className="text-slate-500 text-[11px]">Period: <strong>{period ? formatPeriod(period) : 'Not provided'}</strong> {period && `(${period})`}</span>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                4. Verification Method
              </span>
              <strong className="text-sm text-slate-900 block font-semibold">
                Verified via {mode}
              </strong>
              <span className="text-slate-500 text-[11px]">Timestamp: {filingDate ? new Date(filingDate).toLocaleString() : 'N/A'}</span>
            </div>
          </div>

          {/* Tax Liability / Supplies Statement Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Declared Financial & Tax Summary
              </span>
              <span className="text-[11px] font-mono text-slate-500">Amounts in Indian Rupees (₹)</span>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-3 text-left">Description / Tax Head</th>
                  <th className="py-2.5 px-3 text-right">Taxable Turnover</th>
                  <th className="py-2.5 px-3 text-right">IGST</th>
                  <th className="py-2.5 px-3 text-right">CGST</th>
                  <th className="py-2.5 px-3 text-right">SGST</th>
                  <th className="py-2.5 px-3 text-right font-bold text-slate-900">Total Tax Liability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2.5 px-3 font-medium text-slate-900">
                    {isNil ? 'Nil Outward Supplies (Under CGST Rule 67A)' : `Outward Supplies (${returnType})`}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono">{summary.taxable != null ? formatCurrency(summary.taxable) : '—'}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{summary.igst != null ? formatCurrency(summary.igst) : '—'}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{summary.cgst != null ? formatCurrency(summary.cgst) : '—'}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{summary.sgst != null ? formatCurrency(summary.sgst) : '—'}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-indigo-950">
                    {summary.totalTax != null ? formatCurrency(summary.totalTax) : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Statutory Verification Declaration & Digital Stamp */}
          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
            <div className="space-y-1 text-slate-500 max-w-md">
              <p className="font-semibold text-slate-700">Digital Verification Declaration:</p>
              <p className="text-[10px] leading-relaxed">
                This workspace-generated summary is not an official GSTN-issued acknowledgement. Use the ARN to verify filing status on the GST portal.
              </p>
            </div>

            {/* Provider response marker */}
            <div className="border-2 border-emerald-600/70 rounded-xl p-3 bg-emerald-50/50 text-center shrink-0 w-48">
              <div className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">
                PROVIDER RESPONSE
              </div>
              <div className="text-[9px] font-mono text-emerald-700 font-semibold mt-0.5">
                ARN RECEIVED
              </div>
              <div className="text-[8px] text-slate-400 mt-1 font-mono">
                {arn.slice(0, 10)}••• ARN
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer (Hidden in Print) */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between print:hidden">
          <span className="text-xs text-slate-500 font-mono">
          ARN reference: {arn.slice(0, 8)}...{arn.slice(-4)}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button variant="fintech" size="sm" onClick={handlePrint}>
              <Printer className="w-3.5 h-3.5 mr-1" />
              <span>Print Filing Summary</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
