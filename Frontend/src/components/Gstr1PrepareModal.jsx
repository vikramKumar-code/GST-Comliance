import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import useFocusTrap from '../hooks/useFocusTrap';
import { prepareGstr1, saveGstr1 } from '../api/returns.api';
import { formatCurrency, formatPeriod } from '../utils/format';
import Loader from './Loader';
import ErrorMessage from './ErrorMessage';
import {
  FileSpreadsheet,
  Zap,
  UploadCloud,
  CheckCircle2,
  X,
  ShieldCheck,
  RefreshCw,
  Download,
  Search,
  AlertTriangle,
  Info,
  Filter,
  FileCheck,
  ChevronDown
} from 'lucide-react';
import Button from './ui/Button';
import Badge from './ui/Badge';

export default function Gstr1PrepareModal({ isOpen, onClose, period, onOpenNilModal, onOpenEvcModal }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [activeTab, setActiveTab] = useState('b2b');
  const [excludedInvoiceIds, setExcludedInvoiceIds] = useState(new Set());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const saveButtonRef = useRef(null);

  const fetchPayload = useCallback(async (p, silent = false) => {
    if (!p) return;
    if (!silent) setLoading(true);
    setError(null);
    setSaveResult(null);
    try {
      const res = await prepareGstr1(p);
      setData(res);
      setExcludedInvoiceIds(new Set()); // Reset exclusions on refresh
    } catch (err) {
      setError(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const handleClose = () => {
    if (saving) {
      if (!window.confirm('Save is in progress. Are you sure you want to close?')) {
        return;
      }
    }
    setData(null);
    setError(null);
    setSaveResult(null);
    setExcludedInvoiceIds(new Set());
    setSearchQuery('');
    onClose();
  };

  const modalRef = useFocusTrap(isOpen && !saving && !loading, () => handleClose());

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

  const summary = data?.summary || {};
  const payload = data?.payload || {};

  // ✅ Combine HSN data
  const hsnData = useMemo(() => [
    ...(payload.hsn?.hsn_b2b || []).map(h => ({ ...h, _type: 'B2B' })),
    ...(payload.hsn?.hsn_b2c || []).map(h => ({ ...h, _type: 'B2C' }))
  ], [payload.hsn]);

  // ✅ Flatten B2B invoices for easier manipulation
  const b2bInvoices = useMemo(() => {
    if (!payload.b2b) return [];
    return payload.b2b.flatMap(buyer =>
      (buyer.inv || []).map(inv => ({
        ...inv,
        ctin: buyer.ctin,
        trdnm: buyer.trdnm,
        _id: `${buyer.ctin}_${inv.inum}`
      }))
    );
  }, [payload.b2b]);

  // ✅ Filter invoices based on search
  const filteredB2bInvoices = useMemo(() => {
    if (!searchQuery.trim()) return b2bInvoices;
    const query = searchQuery.toLowerCase();
    return b2bInvoices.filter(inv =>
      inv.inum?.toLowerCase().includes(query) ||
      inv.ctin?.toLowerCase().includes(query) ||
      inv.trdnm?.toLowerCase().includes(query)
    );
  }, [b2bInvoices, searchQuery]);

  const handleToggleExclusion = (invoiceId) => {
    setExcludedInvoiceIds(prev => {
      const next = new Set(prev);
      if (next.has(invoiceId)) {
        next.delete(invoiceId);
      } else {
        next.add(invoiceId);
      }
      return next;
    });
    // Clear save result since payload changed
    setSaveResult(null);
  };

  const handleSaveClick = () => {
    if (excludedInvoiceIds.size > 0) {
      setShowConfirmDialog(true);
    } else {
      handleSave();
    }
  };

  const handleSave = async () => {
    setShowConfirmDialog(false);
    setSaving(true);
    setError(null);
    try {
      const excludedArray = Array.from(excludedInvoiceIds);
      const res = await saveGstr1(period, excludedArray);
      setSaveResult(res);

      // Disable save button after successful save
      if (saveButtonRef.current) {
        saveButtonRef.current.disabled = true;
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPayload = () => {
    if (!payload) return;
    const payloadToExport = {
      ...payload,
      _metadata: {
        exportedAt: new Date().toISOString(),
        period,
        excludedInvoiceIds: Array.from(excludedInvoiceIds),
        exportedBy: 'CandidTax'
      }
    };
    const blob = new Blob([JSON.stringify(payloadToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_${period}_payload_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const excludedCount = excludedInvoiceIds.size;
  const canSave = data && summary.totalInvoices > 0 && !saveResult;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gstr1-prepare-title"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-6xl max-h-[92vh] bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-surface-border animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-200 text-brand-600 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="gstr1-prepare-title" className="text-base font-bold text-slate-900">
                  Prepare & Review GSTR-1
                </h2>
                <Badge variant="fintech" size="sm" className="font-mono">
                  {formatPeriod(period)}
                </Badge>
                {excludedCount > 0 && (
                  <Badge variant="warning" size="sm">
                    {excludedCount} Excluded
                  </Badge>
                )}
                {saveResult && (
                  <Badge variant="success" size="sm">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Saved
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Review auto-generated GSTN return tables before filing
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="p-2 rounded-lg border border-surface-border bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition"
              aria-label="Refresh data"
              onClick={() => fetchPayload(period, true)}
              disabled={loading || saving}
              title="Refresh from latest invoices"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              className="w-8 h-8 rounded-full border border-surface-border bg-white hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 transition disabled:opacity-50"
              aria-label="Close"
              onClick={handleClose}
              disabled={saving}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && <ErrorMessage error={error} onRetry={() => fetchPayload(period)} />}

          {/* Success Banner */}
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
                    {saveResult.dryRun && <span className="ml-2 text-amber-700">(Dry Run)</span>}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="neutral" size="sm" className="font-mono">
                  Ref ID: {saveResult.ref_id}
                </Badge>
                {typeof onOpenEvcModal === 'function' && !saveResult.dryRun && (
                  <Button
                    variant="fintech"
                    size="sm"
                    onClick={() => {
                      handleClose();
                      onOpenEvcModal();
                    }}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                    Proceed to File with EVC
                  </Button>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center">
              <Loader message={`Building GSTR-1 payload from sales invoices for ${formatPeriod(period)}...`} />
            </div>
          ) : data ? (
            <>
              {/* Zero Invoices Banner */}
              {summary.totalInvoices === 0 && (
                <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-xs">
                    <Zap className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <strong className="block font-semibold">Zero Sales Invoices for {formatPeriod(period)}</strong>
                      <span className="opacity-90">
                        No outward sales recorded. You qualify for instant 1-Click Nil GSTR-1 filing under CGST Rule 67A.
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
                  <span className="text-xs font-semibold text-slate-500">Included Invoices</span>
                  <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                    {(summary.includedInvoices ?? summary.totalInvoices ?? 0) - excludedCount}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">
                    {excludedCount > 0 && <span className="text-amber-600">{excludedCount} excluded</span>}
                    {excludedCount === 0 && `${summary.cancelledInvoices || 0} cancelled`}
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
                  <span className="text-xs font-semibold text-slate-500">CGST + SGST</span>
                  <div className="text-xl font-bold font-mono text-brand-600 mt-1">
                    {formatCurrency((summary.totalCgst || 0) + (summary.totalSgst || 0))}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">Intra-state supplies</span>
                </div>
              </div>

              {/* Search & Filters Bar */}
              {activeTab === 'b2b' && b2bInvoices.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search by invoice number, GSTIN, or customer name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-surface-border bg-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFilters(!showFilters)}
                    className="px-3 py-2 text-xs font-semibold rounded-lg border border-surface-border bg-white hover:bg-slate-50 flex items-center gap-1.5"
                  >
                    <Filter className="w-3.5 h-3.5" />
                    Filters
                    <ChevronDown className={`w-3 h-3 transition ${showFilters ? 'rotate-180' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPayload}
                    className="px-3 py-2 text-xs font-semibold rounded-lg border border-surface-border bg-white hover:bg-slate-50 flex items-center gap-1.5"
                    title="Download payload JSON"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export JSON
                  </button>
                </div>
              )}

              {/* Section Navigation Tabs */}
              <div className="flex border-b border-surface-border gap-6 overflow-x-auto">
                {[
                  { id: 'b2b', label: 'Table 4A - B2B Invoices', count: payload.b2b?.length || 0 },
                  { id: 'b2cl', label: 'Table 5 - B2C Large', count: payload.b2cl?.length || 0 },
                  { id: 'b2cs', label: 'Table 7 - B2C Small', count: payload.b2cs?.length || 0 },
                  { id: 'cdnr', label: 'Table 9B - Credit/Debit Notes', count: payload.cdnr?.length || 0 },
                  { id: 'exp', label: 'Table 6A - Exports', count: payload.exp?.length || 0 },
                  { id: 'hsn', label: 'Table 12 - HSN Summary', count: hsnData.length },
                  { id: 'doc', label: 'Table 13 - Documents', count: payload.doc_issue ? 1 : 0 }
                ].map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`py-2.5 text-xs font-bold border-b-2 transition whitespace-nowrap ${activeTab === tab.id
                        ? 'border-brand-600 text-brand-700'
                        : 'border-transparent text-slate-500 hover:text-slate-900'
                      }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>

              {/* Tab Contents */}
              {activeTab === 'b2b' && (
                <div className="rounded-xl border border-surface-border overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                        <tr>
                          <th className="py-2.5 px-3 w-10">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300"
                              onChange={(e) => {
                                if (e.target.checked) {
                                  // Select all visible
                                  const allIds = filteredB2bInvoices.map(i => i._id);
                                  setExcludedInvoiceIds(new Set(allIds));
                                } else {
                                  setExcludedInvoiceIds(new Set());
                                }
                                setSaveResult(null);
                              }}
                              checked={filteredB2bInvoices.length > 0 && filteredB2bInvoices.every(i => excludedInvoiceIds.has(i._id))}
                              aria-label="Select all invoices"
                            />
                          </th>
                          <th className="py-2.5 px-3">Exclude</th>
                          <th className="py-2.5 px-3">Recipient GSTIN</th>
                          <th className="py-2.5 px-3">Invoice No</th>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">POS</th>
                          <th className="py-2.5 px-3">RCM</th>
                          <th className="py-2.5 px-3 text-right">Invoice Value</th>
                          <th className="py-2.5 px-3 text-right">Taxable</th>
                          <th className="py-2.5 px-3 text-right">IGST</th>
                          <th className="py-2.5 px-3 text-right">CGST</th>
                          <th className="py-2.5 px-3 text-right">SGST</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredB2bInvoices.length > 0 ? (
                          filteredB2bInvoices.map((inv) => {
                            const taxable = (inv.itms || []).reduce((acc, itm) => acc + (itm.itm_det?.txval || 0), 0);
                            const igst = (inv.itms || []).reduce((acc, itm) => acc + (itm.itm_det?.iamt || 0), 0);
                            const cgst = (inv.itms || []).reduce((acc, itm) => acc + (itm.itm_det?.camt || 0), 0);
                            const sgst = (inv.itms || []).reduce((acc, itm) => acc + (itm.itm_det?.samt || 0), 0);
                            const isExcluded = excludedInvoiceIds.has(inv._id);

                            return (
                              <tr
                                key={inv._id}
                                className={`transition-colors ${isExcluded ? 'bg-rose-50/50 opacity-60' : 'hover:bg-slate-50/50'
                                  }`}
                              >
                                <td className="py-2 px-3">
                                  <input
                                    type="checkbox"
                                    checked={isExcluded}
                                    onChange={() => handleToggleExclusion(inv._id)}
                                    className="rounded border-slate-300 text-rose-600"
                                    aria-label={`Exclude invoice ${inv.inum}`}
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  {isExcluded && (
                                    <Badge variant="danger" size="sm">Excluded</Badge>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-mono font-semibold text-slate-900">{inv.ctin}</td>
                                <td className="py-2 px-3 font-mono text-slate-700">{inv.inum}</td>
                                <td className="py-2 px-3 text-slate-500">{inv.idt}</td>
                                <td className="py-2 px-3">
                                  <Badge variant="neutral" size="sm">{inv.inv_typ || 'R'}</Badge>
                                </td>
                                <td className="py-2 px-3 text-slate-600">{inv.pos}</td>
                                <td className="py-2 px-3">
                                  {inv.rchrg === 'Y' ? (
                                    <Badge variant="warning" size="sm">RCM</Badge>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">
                                  {formatCurrency(inv.val)}
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-slate-700">
                                  {formatCurrency(taxable)}
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-slate-600">
                                  {formatCurrency(igst)}
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-slate-600">
                                  {formatCurrency(cgst)}
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-slate-600">
                                  {formatCurrency(sgst)}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={13} className="text-center py-6 text-slate-400">
                              {searchQuery ? 'No invoices match your search.' : 'No B2B registered invoices found for this tax period.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'b2cl' && (
                <div className="rounded-xl border border-surface-border overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                        <tr>
                          <th className="py-2.5 px-3">POS</th>
                          <th className="py-2.5 px-3">Invoice Count</th>
                          <th className="py-2.5 px-3 text-right">Total Taxable</th>
                          <th className="py-2.5 px-3 text-right">Total IGST</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payload.b2cl && payload.b2cl.length > 0 ? (
                          payload.b2cl.map((group, idx) => {
                            const invTotal = (group.inv || []).reduce((acc, inv) => acc + (inv.val || 0), 0);
                            const igstTotal = (group.inv || []).reduce((acc, inv) => {
                              return acc + (inv.itms || []).reduce((a, itm) => a + (itm.itm_det?.iamt || 0), 0);
                            }, 0);
                            return (
                              <tr key={idx} className="hover:bg-slate-50/50">
                                <td className="py-2 px-3 text-slate-600">State {group.pos}</td>
                                <td className="py-2 px-3 font-mono">{group.inv?.length || 0} invoices</td>
                                <td className="py-2 px-3 text-right font-mono font-semibold">{formatCurrency(invTotal)}</td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-brand-600">{formatCurrency(igstTotal)}</td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={4} className="text-center py-6 text-slate-400">
                              No B2C Large (inter-state &gt; ₹2.5L) invoices found.
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
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="py-2 px-3">
                                <Badge variant={r.sply_ty === 'INTRA' ? 'success' : 'fintech'} size="sm">
                                  {r.sply_ty}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-slate-600">{r.pos}</td>
                              <td className="py-2 px-3 text-right font-mono">{r.rt}%</td>
                              <td className="py-2 px-3 text-right font-mono font-semibold">{formatCurrency(r.txval)}</td>
                              <td className="py-2 px-3 text-right font-mono">{formatCurrency(r.iamt)}</td>
                              <td className="py-2 px-3 text-right font-mono">{formatCurrency(r.camt)}</td>
                              <td className="py-2 px-3 text-right font-mono">{formatCurrency(r.samt)}</td>
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

              {activeTab === 'cdnr' && (
                <div className="rounded-xl border border-surface-border overflow-hidden bg-white p-4">
                  {payload.cdnr && payload.cdnr.length > 0 ? (
                    <div className="space-y-3">
                      {payload.cdnr.map((party, idx) => (
                        <div key={idx} className="p-3 rounded-lg border border-surface-border">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <div className="font-mono font-semibold text-slate-900">{party.ctin}</div>
                              <div className="text-xs text-slate-500">{party.nt?.length || 0} note(s)</div>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {(party.nt || []).map((nt, nIdx) => (
                              <div key={nIdx} className="text-xs flex items-center gap-2 py-1 border-t border-slate-100">
                                <Badge variant={nt.ntty === 'C' ? 'success' : 'warning'} size="sm">
                                  {nt.ntty === 'C' ? 'Credit Note' : 'Debit Note'}
                                </Badge>
                                <span className="font-mono">{nt.nt_num}</span>
                                <span className="text-slate-500">{nt.nt_dt}</span>
                                <span className="ml-auto font-mono font-semibold">{formatCurrency(nt.val)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center py-6 text-slate-400 text-xs">No credit/debit notes found.</p>
                  )}
                </div>
              )}

              {activeTab === 'exp' && (
                <div className="rounded-xl border border-surface-border overflow-hidden bg-white p-4">
                  {payload.exp && payload.exp.length > 0 ? (
                    <div className="space-y-3">
                      {payload.exp.map((group, idx) => (
                        <div key={idx} className="p-3 rounded-lg border border-surface-border">
                          <Badge variant="fintech" size="sm" className="mb-2">
                            {group.exp_typ === 'WPAY' ? 'With Payment of Tax' : 'Without Payment of Tax'}
                          </Badge>
                          <div className="text-xs text-slate-600">{group.inv?.length || 0} export invoice(s)</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center py-6 text-slate-400 text-xs">No export supplies found.</p>
                  )}
                </div>
              )}

              {activeTab === 'hsn' && (
                <div className="rounded-xl border border-surface-border overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                        <tr>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">HSN/SAC</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3">UQC</th>
                          <th className="py-2.5 px-3 text-right">Qty</th>
                          <th className="py-2.5 px-3 text-right">Rate</th>
                          <th className="py-2.5 px-3 text-right">Taxable</th>
                          <th className="py-2.5 px-3 text-right">Total Tax</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {hsnData.length > 0 ? (
                          hsnData.map((h, idx) => (
                            <tr key={`${h._type}_${h.hsn_sc}_${idx}`} className="hover:bg-slate-50/50">
                              <td className="py-2 px-3">
                                <Badge variant={h._type === 'B2B' ? 'success' : 'neutral'} size="sm">
                                  {h._type}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 font-mono font-semibold text-slate-900">{h.hsn_sc}</td>
                              <td className="py-2 px-3 text-slate-700 max-w-xs truncate">{h.desc || h.user_desc}</td>
                              <td className="py-2 px-3 text-slate-500">{h.uqc}</td>
                              <td className="py-2 px-3 text-right font-mono">{h.qty}</td>
                              <td className="py-2 px-3 text-right font-mono">{h.rt}%</td>
                              <td className="py-2 px-3 text-right font-mono font-semibold">{formatCurrency(h.txval)}</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-brand-600">
                                {formatCurrency((h.iamt || 0) + (h.camt || 0) + (h.samt || 0) + (h.csamt || 0))}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={8} className="text-center py-6 text-slate-400">
                              No HSN summary items available.
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
                    <DocumentRangeCard doc={payload.doc_issue.doc_det[0].docs[0]} />
                  ) : (
                    <span className="text-xs text-slate-400">No document series data available.</span>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-surface-border bg-slate-50 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-brand-600" />
            <span>Safe compliance engine with pre-filing verification</span>
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
                ref={saveButtonRef}
                variant="fintech"
                size="sm"
                onClick={handleSaveClick}
                disabled={loading || saving || !canSave}
              >
                <UploadCloud className="w-3.5 h-3.5 mr-1.5" />
                <span>
                  {saving ? 'Uploading to GSTN...' :
                    saveResult ? 'Already Saved' :
                      excludedCount > 0 ? `Save ${b2bInvoices.length - excludedCount} Invoices` :
                        'Save / Upload GSTR-1'}
                </span>
              </Button>
            )}
          </div>
        </div>

        {/* Confirmation Dialog */}
        {showConfirmDialog && (
          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-10">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Confirm Exclusion</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    You are about to exclude <strong>{excludedCount} invoice(s)</strong> from this GSTR-1 filing.
                    These invoices will NOT be uploaded to the GST portal.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 mb-4 text-xs text-slate-700">
                <Info className="w-4 h-4 inline mr-1 text-slate-400" />
                You can file these excluded invoices in a subsequent return or amend them later.
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConfirmDialog(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="fintech"
                  size="sm"
                  onClick={handleSave}
                  className="flex-1"
                >
                  <FileCheck className="w-3.5 h-3.5 mr-1" />
                  Yes, Save with Exclusions
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (!isOpen) return null;

  return createPortal(modalContent, document.body);
}

// Helper component
function DocumentRangeCard({ doc }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <div>
        <span className="text-slate-400 block text-[11px]">Starting Invoice No:</span>
        <div className="font-mono font-bold text-slate-900 mt-1">{doc.from}</div>
      </div>
      <div>
        <span className="text-slate-400 block text-[11px]">Ending Invoice No:</span>
        <div className="font-mono font-bold text-slate-900 mt-1">{doc.to}</div>
      </div>
      <div>
        <span className="text-slate-400 block text-[11px]">Total Generated:</span>
        <div className="font-mono font-bold text-slate-900 mt-1 text-sm">{doc.totnum}</div>
      </div>
      <div>
        <span className="text-slate-400 block text-[11px]">Net Issued:</span>
        <div className="font-mono font-bold text-brand-600 mt-1 text-sm">{doc.net_issue}</div>
        <span className="text-danger-600 text-[10px]">({doc.canc} cancelled)</span>
      </div>
    </div>
  );
}