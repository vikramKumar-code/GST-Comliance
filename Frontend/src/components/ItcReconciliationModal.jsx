import { useState, useEffect, useCallback } from 'react';
import { getItcReconciliation, getRefundEstimate } from '../api/reconciliation.api';
import Loader from './Loader';
import ErrorMessage from './ErrorMessage';
import { formatCurrency, formatDate, formatPeriod } from '../utils/format';
import {
  Scale,
  CheckCircle2,
  AlertTriangle,
  FileQuestion,
  Layers,
  Coins,
  ArrowRight,
  X,
  RefreshCw,
  TrendingUp,
  ShieldCheck,
  Building2,
  FileText
} from 'lucide-react';
import Button from './ui/Button';
import Badge from './ui/Badge';
import MetricCard from './ui/MetricCard';

export default function ItcReconciliationModal({ isOpen, onClose, initialPeriod = '092026' }) {
  const [period, setPeriod] = useState(initialPeriod);
  const [activeTab, setActiveTab] = useState('RECONCILIATION'); // 'RECONCILIATION' | 'REFUND_ESTIMATE'
  const [filterBucket, setFilterBucket] = useState('ALL'); // 'ALL' | 'MATCHED' | 'MISSING_IN_2B' | 'MISMATCHED_VALUE' | 'EXTRA_IN_2B'
  const [reconciliation, setReconciliation] = useState(null);
  const [refundEstimate, setRefundEstimate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async (p) => {
    if (!p) return;
    setLoading(true);
    setError(null);
    try {
      const [recRes, refRes] = await Promise.all([
        getItcReconciliation(p),
        getRefundEstimate(p),
      ]);
      setReconciliation(recRes);
      setRefundEstimate(refRes);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleClose = () => {
    setReconciliation(null);
    setRefundEstimate(null);
    setError(null);
    onClose();
  };

  useEffect(() => {
    if (!isOpen || !period) return;
    let ignore = false;

    Promise.resolve().then(() => {
      if (ignore) return;
      fetchData(period);
    });

    return () => {
      ignore = true;
    };
  }, [isOpen, period, fetchData]);

  if (!isOpen) return null;

  const summary = reconciliation?.summary || {};
  const eligibleItc = summary.eligibleItc || {};
  const atRiskItc = summary.atRiskItc || {};

  // Build combined item list for reconciliation table
  const allItems = [];
  if (reconciliation) {
    (reconciliation.matched || []).forEach((item) => allItems.push({ ...item, bucket: 'MATCHED' }));
    (reconciliation.missingIn2b || []).forEach((item) => allItems.push({ ...item, bucket: 'MISSING_IN_2B' }));
    (reconciliation.mismatched || []).forEach((item) => allItems.push({ ...item, bucket: 'MISMATCHED_VALUE' }));
    (reconciliation.extraIn2b || []).forEach((item) => allItems.push({ ...item, bucket: 'EXTRA_IN_2B' }));
  }

  const displayedItems = filterBucket === 'ALL'
    ? allItems
    : allItems.filter((item) => item.bucket === filterBucket);

  const netPos = refundEstimate?.netPosition || {};
  const isRefund = netPos.status === 'REFUND_OR_CARRY_FORWARD';

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
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  ITC Reconciliation & GST Refund Estimator
                </h2>
                <Badge variant="fintech" size="sm" className="font-mono">
                  {formatPeriod(period)}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Reconcile purchase invoices against vendor-filed GSTR-2B inward statements
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-surface-border bg-white text-slate-700 focus:outline-none focus:border-brand-500"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              disabled={loading}
            >
              <option value="102026">Oct 2026</option>
              <option value="092026">Sep 2026</option>
              <option value="082026">Aug 2026</option>
              <option value="072026">Jul 2026</option>
            </select>
            <button
              type="button"
              className="w-8 h-8 rounded-full border border-surface-border bg-white hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 transition cursor-pointer"
              aria-label="Close"
              onClick={handleClose}
              disabled={loading}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-surface-border bg-white flex gap-6">
          <button
            type="button"
            className={`py-3 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'RECONCILIATION'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
            onClick={() => setActiveTab('RECONCILIATION')}
          >
            <Scale className="w-4 h-4" />
            <span>ITC 2B Reconciliation</span>
          </button>
          <button
            type="button"
            className={`py-3 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'REFUND_ESTIMATE'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
            onClick={() => setActiveTab('REFUND_ESTIMATE')}
          >
            <Coins className="w-4 h-4" />
            <span>GST Refund & Liability Estimator</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && <ErrorMessage error={error} onRetry={() => fetchData(period)} />}

          {loading && (
            <div className="py-12 text-center">
              <Loader message={`Reconciling purchase bills with GSTR-2B for period ${period}...`} />
            </div>
          )}

          {!loading && activeTab === 'RECONCILIATION' && reconciliation && (
            <div className="space-y-5">
              {/* 4 KPI Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div
                  className={`p-4 rounded-xl border transition cursor-pointer ${
                    filterBucket === 'MATCHED'
                      ? 'border-success-500 bg-success-50/50 ring-2 ring-success-500/20 shadow-xs'
                      : 'border-surface-border bg-white hover:border-slate-300'
                  }`}
                  onClick={() => setFilterBucket(filterBucket === 'MATCHED' ? 'ALL' : 'MATCHED')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Matched Invoices</span>
                    <CheckCircle2 className="w-4 h-4 text-success-600" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-success-700 mt-2">
                    {summary.matchedCount || 0}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Claimable ITC: <strong className="text-slate-900">{formatCurrency(eligibleItc.total || 0)}</strong>
                  </div>
                </div>

                <div
                  className={`p-4 rounded-xl border transition cursor-pointer ${
                    filterBucket === 'MISSING_IN_2B'
                      ? 'border-danger-500 bg-danger-50/50 ring-2 ring-danger-500/20 shadow-xs'
                      : 'border-surface-border bg-white hover:border-slate-300'
                  }`}
                  onClick={() => setFilterBucket(filterBucket === 'MISSING_IN_2B' ? 'ALL' : 'MISSING_IN_2B')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Missing in GSTR-2B</span>
                    <AlertTriangle className="w-4 h-4 text-danger-600" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-danger-700 mt-2">
                    {summary.missingIn2bCount || 0}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    At-Risk ITC: <strong className="text-slate-900">{formatCurrency(atRiskItc.total || 0)}</strong>
                  </div>
                </div>

                <div
                  className={`p-4 rounded-xl border transition cursor-pointer ${
                    filterBucket === 'MISMATCHED_VALUE'
                      ? 'border-amber-500 bg-amber-50/50 ring-2 ring-amber-500/20 shadow-xs'
                      : 'border-surface-border bg-white hover:border-slate-300'
                  }`}
                  onClick={() => setFilterBucket(filterBucket === 'MISMATCHED_VALUE' ? 'ALL' : 'MISMATCHED_VALUE')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Value Discrepancies</span>
                    <RefreshCw className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-amber-700 mt-2">
                    {summary.mismatchedCount || 0}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Amount differs from 2B
                  </div>
                </div>

                <div
                  className={`p-4 rounded-xl border transition cursor-pointer ${
                    filterBucket === 'EXTRA_IN_2B'
                      ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20 shadow-xs'
                      : 'border-surface-border bg-white hover:border-slate-300'
                  }`}
                  onClick={() => setFilterBucket(filterBucket === 'EXTRA_IN_2B' ? 'ALL' : 'EXTRA_IN_2B')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Extra in 2B</span>
                    <FileQuestion className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-blue-700 mt-2">
                    {summary.extraIn2bCount || 0}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Unrecorded in books
                  </div>
                </div>
              </div>

              {/* Filter Pills */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-slate-400 font-medium mr-1">Filter:</span>
                  <button
                    type="button"
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                      filterBucket === 'ALL'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    onClick={() => setFilterBucket('ALL')}
                  >
                    All ({allItems.length})
                  </button>
                  <button
                    type="button"
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                      filterBucket === 'MATCHED'
                        ? 'bg-success-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    onClick={() => setFilterBucket('MATCHED')}
                  >
                    Matched ({summary.matchedCount || 0})
                  </button>
                  <button
                    type="button"
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                      filterBucket === 'MISSING_IN_2B'
                        ? 'bg-danger-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    onClick={() => setFilterBucket('MISSING_IN_2B')}
                  >
                    Missing in 2B ({summary.missingIn2bCount || 0})
                  </button>
                  <button
                    type="button"
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                      filterBucket === 'MISMATCHED_VALUE'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    onClick={() => setFilterBucket('MISMATCHED_VALUE')}
                  >
                    Discrepancies ({summary.mismatchedCount || 0})
                  </button>
                  <button
                    type="button"
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                      filterBucket === 'EXTRA_IN_2B'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    onClick={() => setFilterBucket('EXTRA_IN_2B')}
                  >
                    Extra in 2B ({summary.extraIn2bCount || 0})
                  </button>
                </div>
                <span className="text-xs text-slate-400">
                  Showing <strong>{displayedItems.length}</strong> records
                </span>
              </div>

              {/* Items Table */}
              <div className="overflow-x-auto rounded-xl border border-surface-border bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                    <tr>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3">Vendor / Supplier</th>
                      <th className="py-3 px-3">Bill / Inv #</th>
                      <th className="py-3 px-3">Date</th>
                      <th className="py-3 px-3 text-right">Books Tax (₹)</th>
                      <th className="py-3 px-3 text-right">2B Tax (₹)</th>
                      <th className="py-3 px-3">Compliance Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedItems.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="text-center py-8 text-slate-400">
                          No records found in this reconciliation filter.
                        </td>
                      </tr>
                    ) : (
                      displayedItems.map((item, idx) => (
                        <tr key={item.billId || item.invoiceNumber || idx} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-2.5 px-3">
                            {item.bucket === 'MATCHED' && (
                              <Badge variant="success" size="sm">MATCHED</Badge>
                            )}
                            {item.bucket === 'MISSING_IN_2B' && (
                              <Badge variant="danger" size="sm">MISSING IN 2B</Badge>
                            )}
                            {item.bucket === 'MISMATCHED_VALUE' && (
                              <Badge variant="warning" size="sm">MISMATCH</Badge>
                            )}
                            {item.bucket === 'EXTRA_IN_2B' && (
                              <Badge variant="info" size="sm">EXTRA IN 2B</Badge>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900">
                              {item.vendorName || item.supplierGstin || 'Supplier'}
                            </div>
                            <div className="font-mono text-[11px] text-slate-400">
                              {item.vendorGstin || item.supplierGstin || 'Unregistered'}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                            {item.billNumber || item.invoiceNumber}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500">
                            {item.billDate ? formatDate(item.billDate) : item.invoiceDate || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900">
                            {item.totalTax !== undefined ? formatCurrency(item.totalTax) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-brand-600">
                            {item.gstr2b?.totalTax !== undefined
                              ? formatCurrency(item.gstr2b.totalTax)
                              : item.totalTax !== undefined && item.bucket === 'EXTRA_IN_2B'
                              ? formatCurrency(item.totalTax)
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 max-w-[280px]">
                            {item.bucket === 'MATCHED' && (
                              <span className="text-success-700 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Exact match. 100% Eligible ITC claimable.</span>
                              </span>
                            )}
                            {item.bucket === 'MISSING_IN_2B' && (
                              <span className="text-danger-700 flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span>Vendor hasn't filed GSTR-1. ITC blocked.</span>
                              </span>
                            )}
                            {item.bucket === 'MISMATCHED_VALUE' && (
                              <span className="text-amber-700">
                                Diff: {formatCurrency(item.discrepancy?.diffTax || 0)} (Verify line items)
                              </span>
                            )}
                            {item.bucket === 'EXTRA_IN_2B' && (
                              <span className="text-blue-700">
                                Recorded on GSTN. Add to books to claim ITC.
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!loading && activeTab === 'REFUND_ESTIMATE' && refundEstimate && (
            <div className="space-y-5">
              {/* Highlighted Net Position Banner */}
              <div
                className={`p-6 rounded-2xl border ${
                  isRefund
                    ? 'bg-success-50/70 border-success-200 text-success-950'
                    : 'bg-brand-50/70 border-brand-200 text-brand-950'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                      {isRefund ? '🎉 Estimated GST Refund Position' : '💳 Net Cash Tax Payable'}
                    </span>
                    <h3 className={`text-3xl font-bold font-mono ${isRefund ? 'text-success-700' : 'text-brand-700'}`}>
                      {formatCurrency(isRefund ? netPos.estimatedRefundAmount : netPos.estimatedTaxPayable)}
                    </h3>
                    <p className="text-xs text-slate-600 mt-2 max-w-xl leading-relaxed">
                      {netPos.explanation}
                    </p>
                  </div>
                  <Badge
                    variant={isRefund ? 'success' : 'fintech'}
                    size="md"
                    className="shrink-0 self-start sm:self-center font-bold"
                  >
                    {isRefund ? 'RFD-01 Eligible' : 'GSTR-3B Table 6.1'}
                  </Badge>
                </div>
              </div>

              {/* Side-by-side Breakdown Table */}
              <div className="rounded-xl border border-surface-border overflow-hidden bg-white">
                <div className="px-5 py-3 border-b border-surface-border bg-slate-50">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Tax Offsetting & Net Position Breakdown
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                      <tr>
                        <th className="py-2.5 px-4">Component</th>
                        <th className="py-2.5 px-4 text-right">CGST (₹)</th>
                        <th className="py-2.5 px-4 text-right">SGST (₹)</th>
                        <th className="py-2.5 px-4 text-right">IGST (₹)</th>
                        <th className="py-2.5 px-4 text-right">Total Tax (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">
                            1. Output Tax Liability (Sales)
                          </div>
                          <div className="text-[11px] text-slate-400">
                            From {refundEstimate.outputLiability?.totalInvoices || 0} sales invoices
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono">{formatCurrency(refundEstimate.outputLiability?.cgst || 0)}</td>
                        <td className="py-3 px-4 text-right font-mono">{formatCurrency(refundEstimate.outputLiability?.sgst || 0)}</td>
                        <td className="py-3 px-4 text-right font-mono">{formatCurrency(refundEstimate.outputLiability?.igst || 0)}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">{formatCurrency(refundEstimate.outputLiability?.total || 0)}</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-success-700">
                            2. Less: Eligible Input Tax Credit (Purchases)
                          </div>
                          <div className="text-[11px] text-slate-400">
                            From {refundEstimate.inputTaxCredit?.matchedBills || 0} matched GSTR-2B inward bills
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-success-700">{formatCurrency(refundEstimate.inputTaxCredit?.cgst || 0)}</td>
                        <td className="py-3 px-4 text-right font-mono text-success-700">{formatCurrency(refundEstimate.inputTaxCredit?.sgst || 0)}</td>
                        <td className="py-3 px-4 text-right font-mono text-success-700">{formatCurrency(refundEstimate.inputTaxCredit?.igst || 0)}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-success-700">{formatCurrency(refundEstimate.inputTaxCredit?.total || 0)}</td>
                      </tr>
                      <tr className="bg-slate-50 font-bold border-t-2 border-surface-border">
                        <td className="py-3 px-4 text-slate-900">
                          Net Balance ({isRefund ? 'Surplus Credit / Refund' : 'Cash Payable'})
                        </td>
                        <td className="py-3 px-4 text-right font-mono">{formatCurrency(Math.abs(netPos.cgst || 0))}</td>
                        <td className="py-3 px-4 text-right font-mono">{formatCurrency(Math.abs(netPos.sgst || 0))}</td>
                        <td className="py-3 px-4 text-right font-mono">{formatCurrency(Math.abs(netPos.igst || 0))}</td>
                        <td className={`py-3 px-4 text-right font-mono text-sm ${isRefund ? 'text-success-700' : 'text-brand-700'}`}>
                          {formatCurrency(Math.abs(netPos.total || 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-surface-border bg-slate-50 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-brand-600" />
            <span>Reconciled with active workspace purchase records & GSTR-2B data</span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClose}
            disabled={loading}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
