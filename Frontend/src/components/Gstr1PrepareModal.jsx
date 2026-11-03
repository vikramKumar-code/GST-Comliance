import { useState, useEffect, useCallback } from 'react';
import { prepareGstr1, saveGstr1 } from '../api/returns.api';
import { formatCurrency, formatPeriod } from '../utils/format';
import Loader from './Loader';
import ErrorMessage from './ErrorMessage';
import {
  FileSpreadsheet,
  Building2,
  ShoppingBag,
  Tag,
  Files,
  Zap,
  UploadCloud,
  CheckCircle2,
  X,
  ShieldCheck,
  TrendingUp,
  RefreshCw
} from 'lucide-react';
import Button from './ui/Button';
import Badge from './ui/Badge';
import MetricCard from './ui/MetricCard';

export default function Gstr1PrepareModal({ isOpen, onClose, period, onOpenNilModal }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [activeTab, setActiveTab] = useState('b2b');

  const fetchPayload = useCallback(async (p) => {
    if (!p) return;
    setLoading(true);
    setError(null);
    setSaveResult(null);
    try {
      const res = await prepareGstr1(p);
      setData(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleClose = () => {
    setData(null);
    setError(null);
    setSaveResult(null);
    onClose();
  };

  useEffect(() => {
    if (!isOpen || !period) return;
    let ignore = false;

    Promise.resolve().then(() => {
      if (ignore) return;
      fetchPayload(period);
    });

    return () => {
      ignore = true;
    };
  }, [isOpen, period, fetchPayload]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await saveGstr1(period);
      setSaveResult(res);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const summary = data?.summary || {};
  const payload = data?.payload || {};

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-5xl max-h-[92vh] bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-surface-border animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-200 text-brand-600 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Prepare & File GSTR-1</h2>
                <Badge variant="fintech" size="sm" className="font-mono">
                  {formatPeriod(period)}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Auto-generate official GSTN return tables from active workspace sales invoices
              </p>
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 rounded-full border border-surface-border bg-white hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 transition cursor-pointer"
            aria-label="Close"
            onClick={handleClose}
            disabled={saving}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && <ErrorMessage error={error} onRetry={() => fetchPayload(period)} />}

          {/* Success Status Banner */}
          {saveResult && (
            <div
              className="p-4 rounded-xl border border-success-200 bg-success-50 text-success-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              role="status"
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0" />
                <div className="text-xs">
                  <strong className="block font-semibold">{saveResult.message}</strong>
                  <span className="text-slate-600">
                    Tax period: <strong>{saveResult.period}</strong> • GSTIN: <strong>{saveResult.gstin}</strong>
                  </span>
                </div>
              </div>
              <Badge variant="neutral" size="sm" className="font-mono">
                Ref ID: {saveResult.ref_id}
              </Badge>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center">
              <Loader message={`Building GSTR-1 payload from sales invoices for ${formatPeriod(period)}...`} />
            </div>
          ) : data ? (
            <>
              {summary.totalInvoices === 0 && (
                <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-xs">
                    <Zap className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <strong className="block font-semibold">Zero Sales Invoices for {formatPeriod(period)}</strong>
                      <span className="opacity-90">
                        No outward sales recorded for this period. You qualify for instant 1-Click Nil GSTR-1 filing under CGST Rule 67A.
                      </span>
                    </div>
                  </div>
                  {typeof onOpenNilModal === 'function' && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        handleClose();
                        onOpenNilModal();
                      }}
                      className="shrink-0"
                    >
                      <Zap className="w-3.5 h-3.5 mr-1" />
                      <span>File Nil GSTR-1</span>
                    </Button>
                  )}
                </div>
              )}

              {/* Metrics Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-surface-border">
                  <span className="text-xs font-semibold text-slate-500">Active Invoices</span>
                  <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                    {summary.totalInvoices || 0}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">
                    {summary.cancelledInvoices || 0} cancelled
                  </span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-surface-border">
                  <span className="text-xs font-semibold text-slate-500">Total Taxable Value</span>
                  <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                    {formatCurrency(summary.totalTaxable)}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">Gross Turnover</span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-surface-border">
                  <span className="text-xs font-semibold text-slate-500">Integrated Tax (IGST)</span>
                  <div className="text-xl font-bold font-mono text-brand-600 mt-1">
                    {formatCurrency(summary.totalIgst)}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">Inter-state supplies</span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-surface-border">
                  <span className="text-xs font-semibold text-slate-500">Central + State (CGST/SGST)</span>
                  <div className="text-xl font-bold font-mono text-brand-600 mt-1">
                    {formatCurrency((summary.totalCgst || 0) + (summary.totalSgst || 0))}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">Intra-state supplies</span>
                </div>
              </div>

              {/* Section Navigation Tabs */}
              <div className="flex border-b border-surface-border gap-6">
                <button
                  type="button"
                  className={`py-2.5 text-xs font-bold border-b-2 transition cursor-pointer ${
                    activeTab === 'b2b'
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                  onClick={() => setActiveTab('b2b')}
                >
                  Table 4A - B2B Invoices ({payload.b2b?.length || 0})
                </button>
                <button
                  type="button"
                  className={`py-2.5 text-xs font-bold border-b-2 transition cursor-pointer ${
                    activeTab === 'b2cs'
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                  onClick={() => setActiveTab('b2cs')}
                >
                  Table 7 - B2C Small ({payload.b2cs?.length || 0})
                </button>
                <button
                  type="button"
                  className={`py-2.5 text-xs font-bold border-b-2 transition cursor-pointer ${
                    activeTab === 'hsn'
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                  onClick={() => setActiveTab('hsn')}
                >
                  Table 12 - HSN Summary ({payload.hsn?.data?.length || 0})
                </button>
                <button
                  type="button"
                  className={`py-2.5 text-xs font-bold border-b-2 transition cursor-pointer ${
                    activeTab === 'doc'
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                  onClick={() => setActiveTab('doc')}
                >
                  Table 13 - Documents Issued
                </button>
              </div>

              {/* Tab Contents */}
              {activeTab === 'b2b' && (
                <div className="rounded-xl border border-surface-border overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                        <tr>
                          <th className="py-2.5 px-3">Recipient GSTIN</th>
                          <th className="py-2.5 px-3">Invoice No</th>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">POS</th>
                          <th className="py-2.5 px-3 text-right">Invoice Value</th>
                          <th className="py-2.5 px-3 text-right">Taxable Amount</th>
                          <th className="py-2.5 px-3 text-right">Tax Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payload.b2b && payload.b2b.length > 0 ? (
                          payload.b2b.flatMap((buyer) =>
                            (buyer.inv || []).map((inv) => {
                              const taxable = (inv.itms || []).reduce(
                                (acc, itm) => acc + (itm.itm_det?.txval || 0),
                                0
                              );
                              const tax = (inv.itms || []).reduce(
                                (acc, itm) =>
                                  acc +
                                  (itm.itm_det?.iamt || 0) +
                                  (itm.itm_det?.camt || 0) +
                                  (itm.itm_det?.samt || 0),
                                0
                              );
                              return (
                                <tr key={`${buyer.ctin}_${inv.inum}`} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="py-2 px-3 font-mono font-semibold text-slate-900">{buyer.ctin}</td>
                                  <td className="py-2 px-3 font-mono text-slate-700">{inv.inum}</td>
                                  <td className="py-2 px-3 text-slate-500">{inv.idt}</td>
                                  <td className="py-2 px-3 text-slate-600">State {inv.pos}</td>
                                  <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">{formatCurrency(inv.val)}</td>
                                  <td className="py-2 px-3 text-right font-mono text-slate-700">{formatCurrency(taxable)}</td>
                                  <td className="py-2 px-3 text-right font-mono font-bold text-brand-600">{formatCurrency(tax)}</td>
                                </tr>
                              );
                            })
                          )
                        ) : (
                          <tr>
                            <td colSpan={7} className="text-center py-6 text-slate-400">
                              No B2B registered invoices found for this tax period.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'b2cs' && (
                <div className="rounded-xl border border-surface-border overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                        <tr>
                          <th className="py-2.5 px-3">Supply Type</th>
                          <th className="py-2.5 px-3">POS</th>
                          <th className="py-2.5 px-3 text-right">GST Rate (%)</th>
                          <th className="py-2.5 px-3 text-right">Taxable Value</th>
                          <th className="py-2.5 px-3 text-right">IGST</th>
                          <th className="py-2.5 px-3 text-right">CGST</th>
                          <th className="py-2.5 px-3 text-right">SGST</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payload.b2cs && payload.b2cs.length > 0 ? (
                          payload.b2cs.map((r, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-2 px-3">
                                <Badge variant={r.sply_ty === 'INTRA' ? 'success' : 'fintech'} size="sm">
                                  {r.sply_ty}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-slate-600">State {r.pos}</td>
                              <td className="py-2 px-3 text-right font-mono">{r.rt}%</td>
                              <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">{formatCurrency(r.txval)}</td>
                              <td className="py-2 px-3 text-right font-mono text-slate-600">{formatCurrency(r.iamt)}</td>
                              <td className="py-2 px-3 text-right font-mono text-slate-600">{formatCurrency(r.camt)}</td>
                              <td className="py-2 px-3 text-right font-mono text-slate-600">{formatCurrency(r.samt)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={7} className="text-center py-6 text-slate-400">
                              No B2C small retail invoices found for this period.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'hsn' && (
                <div className="rounded-xl border border-surface-border overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                        <tr>
                          <th className="py-2.5 px-3">HSN/SAC</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3">Unit (UQC)</th>
                          <th className="py-2.5 px-3 text-right">Qty</th>
                          <th className="py-2.5 px-3 text-right">Tax Rate</th>
                          <th className="py-2.5 px-3 text-right">Taxable Value</th>
                          <th className="py-2.5 px-3 text-right">Total Tax</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payload.hsn?.data && payload.hsn.data.length > 0 ? (
                          payload.hsn.data.map((h) => (
                            <tr key={h.num} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-2 px-3 font-mono font-semibold text-slate-900">{h.hsn_sc}</td>
                              <td className="py-2 px-3 text-slate-700">{h.desc}</td>
                              <td className="py-2 px-3 text-slate-500">{h.uqc}</td>
                              <td className="py-2 px-3 text-right font-mono">{h.qty}</td>
                              <td className="py-2 px-3 text-right font-mono">{h.rt}%</td>
                              <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">{formatCurrency(h.txval)}</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-brand-600">
                                {formatCurrency((h.iamt || 0) + (h.camt || 0) + (h.samt || 0))}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={7} className="text-center py-6 text-slate-400">
                              No HSN summary items available for this period.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'doc' && (
                <div className="p-4 rounded-xl border border-surface-border bg-slate-50">
                  <h6 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                    Document Range Summary
                  </h6>
                  {payload.doc_issue?.doc_det?.[0]?.docs?.[0] ? (
                    (() => {
                      const d = payload.doc_issue.doc_det[0].docs[0];
                      return (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          <div>
                            <span className="text-slate-400 block text-[11px]">Starting Invoice No:</span>
                            <div className="font-mono font-bold text-slate-900 mt-1">{d.from}</div>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">Ending Invoice No:</span>
                            <div className="font-mono font-bold text-slate-900 mt-1">{d.to}</div>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">Total Generated:</span>
                            <div className="font-mono font-bold text-slate-900 mt-1 text-sm">{d.totnum}</div>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">Net Issued:</span>
                            <div className="font-mono font-bold text-brand-600 mt-1 text-sm">{d.net_issue}</div>
                            <span className="text-danger-600 text-[10px]">({d.canc} cancelled)</span>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <span className="text-xs text-slate-400">No document series data available.</span>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-surface-border bg-slate-50 flex items-center justify-between">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-brand-600" />
            <span>Safe compliance engine with dry-run verification</span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={saving}
            >
              Close
            </Button>
            {summary.totalInvoices === 0 && typeof onOpenNilModal === 'function' ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  handleClose();
                  onOpenNilModal();
                }}
              >
                <Zap className="w-3.5 h-3.5 mr-1" />
                <span>File Nil GSTR-1</span>
              </Button>
            ) : (
              <Button
                variant="fintech"
                size="sm"
                onClick={handleSave}
                disabled={loading || saving || !data || summary.totalInvoices === 0}
              >
                <UploadCloud className="w-3.5 h-3.5 mr-1.5" />
                <span>{saving ? 'Uploading to GSTN...' : 'Save / Upload GSTR-1'}</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
