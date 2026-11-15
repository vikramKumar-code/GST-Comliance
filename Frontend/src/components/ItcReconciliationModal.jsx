import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import useFocusTrap from '../hooks/useFocusTrap';
import { getItcReconciliation, getRefundEstimate } from '../api/reconciliation.api';
import Loader from './Loader';
import ErrorMessage from './ErrorMessage';
import { formatCurrency, formatDate, formatPeriod } from '../utils/format';
import {
  Scale,
  CheckCircle2,
  AlertTriangle,
  FileQuestion,
  Coins,
  X,
  RefreshCw,
  ShieldCheck,
  Search,
  Download,
  ArrowUpDown,
  Printer,
  Eye,
  FileText,
  Info
} from 'lucide-react';
import Button from './ui/Button';
import Badge from './ui/Badge';

// Pagination constants
const ITEMS_PER_PAGE = 50;

export default function ItcReconciliationModal({ isOpen, onClose, initialPeriod = '092026' }) {
  const [period, setPeriod] = useState(initialPeriod);
  const [activeTab, setActiveTab] = useState('RECONCILIATION');
  const [filterBucket, setFilterBucket] = useState('ALL');
  const [reconciliation, setReconciliation] = useState(null);
  const [refundEstimate, setRefundEstimate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [comparisonItem, setComparisonItem] = useState(null);
  const [availablePeriods, setAvailablePeriods] = useState([]);

  const modalRef = useFocusTrap(isOpen && !loading, () => handleClose());

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

      // Extract available periods from response
      if (recRes?.availablePeriods) {
        setAvailablePeriods(recRes.availablePeriods);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleClose() {
    setReconciliation(null);
    setRefundEstimate(null);
    setError(null);
    setSearchQuery('');
    setCurrentPage(1);
    setSelectedItems(new Set());
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

  const summary = reconciliation?.summary || {};
  const eligibleItc = summary.eligibleItc || {};
  const atRiskItc = summary.atRiskItc || {};

  // Build combined item list
  const allItems = useMemo(() => {
    const items = [];
    if (reconciliation) {
      (reconciliation.matched || []).forEach((item) => items.push({ ...item, bucket: 'MATCHED' }));
      (reconciliation.missingIn2b || []).forEach((item) => items.push({ ...item, bucket: 'MISSING_IN_2B' }));
      (reconciliation.mismatched || []).forEach((item) => items.push({ ...item, bucket: 'MISMATCHED_VALUE' }));
      (reconciliation.extraIn2b || []).forEach((item) => items.push({ ...item, bucket: 'EXTRA_IN_2B' }));
    }
    return items;
  }, [reconciliation]);

  // Filter items
  const filteredItems = useMemo(() => {
    let items = filterBucket === 'ALL' ? allItems : allItems.filter((item) => item.bucket === filterBucket);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      items = items.filter(item =>
        (item.vendorName || '').toLowerCase().includes(query) ||
        (item.vendorGstin || '').toLowerCase().includes(query) ||
        (item.billNumber || '').toLowerCase().includes(query) ||
        (item.invoiceNumber || '').toLowerCase().includes(query)
      );
    }

    return items;
  }, [allItems, filterBucket, searchQuery]);

  // Sort items
  const sortedItems = useMemo(() => {
    if (!sortConfig.key) return filteredItems;

    return [...filteredItems].sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === 'totalTax') {
        aVal = a.totalTax || 0;
        bVal = b.totalTax || 0;
      } else if (sortConfig.key === 'gstr2bTax') {
        aVal = a.gstr2b?.totalTax || 0;
        bVal = b.gstr2b?.totalTax || 0;
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredItems, sortConfig]);

  // Paginate items
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [sortedItems, currentPage]);

  const totalPages = Math.ceil(sortedItems.length / ITEMS_PER_PAGE);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleToggleSelection = (itemId) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedItems.size === paginatedItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(paginatedItems.map(item => item.billId || item.invoiceNumber)));
    }
  };

  const handleExportCSV = () => {
    const headers = ['Status', 'Vendor', 'GSTIN', 'Bill/Inv #', 'Date', 'Books Tax', '2B Tax', 'Note'];
    const rows = filteredItems.map(item => [
      item.bucket,
      item.vendorName || '',
      item.vendorGstin || '',
      item.billNumber || item.invoiceNumber || '',
      item.billDate || item.invoiceDate || '',
      item.totalTax || 0,
      item.gstr2b?.totalTax || 0,
      item.bucket === 'MATCHED' ? 'Exact match' :
        item.bucket === 'MISSING_IN_2B' ? 'Vendor hasn\'t filed GSTR-1' :
          item.bucket === 'MISMATCHED_VALUE' ? 'Value discrepancy' :
            'Extra in 2B'
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ITC_Reconciliation_${period}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleViewComparison = (item) => {
    setComparisonItem(item);
    setShowComparisonModal(true);
  };

  const netPos = refundEstimate?.netPosition || {};
  const isRefund = netPos.status === 'REFUND_OR_CARRY_FORWARD';

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="itc-reconciliation-title"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-6xl max-h-[92vh] bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-surface-border animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-200 text-brand-600 flex items-center justify-center">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="itc-reconciliation-title" className="text-base font-bold text-slate-900">
                  ITC Reconciliation & GST Refund Estimator
                </h2>
                <Badge variant="fintech" size="sm" className="font-mono">
                  {formatPeriod(period)}
                </Badge>
                {selectedItems.size > 0 && (
                  <Badge variant="info" size="sm">
                    {selectedItems.size} Selected
                  </Badge>
                )}
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
              aria-label="Select period"
            >
              {availablePeriods.length > 0 ? (
                availablePeriods.map(p => (
                  <option key={p} value={p}>{formatPeriod(p)}</option>
                ))
              ) : (
                <>
                  <option value="102026">Oct 2026</option>
                  <option value="092026">Sep 2026</option>
                  <option value="082026">Aug 2026</option>
                  <option value="072026">Jul 2026</option>
                </>
              )}
            </select>
            <button
              type="button"
              className="p-2 rounded-lg border border-surface-border bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition disabled:opacity-50"
              aria-label="Refresh data"
              onClick={() => fetchData(period)}
              disabled={loading}
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              className="w-8 h-8 rounded-full border border-surface-border bg-white hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 transition disabled:opacity-50"
              aria-label="Close"
              onClick={handleClose}
              disabled={loading}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-surface-border bg-white flex gap-6 shrink-0">
          <button
            type="button"
            className={`py-3 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${activeTab === 'RECONCILIATION'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            onClick={() => setActiveTab('RECONCILIATION')}
            aria-label="ITC 2B Reconciliation tab"
          >
            <Scale className="w-4 h-4" />
            <span>ITC 2B Reconciliation</span>
          </button>
          <button
            type="button"
            className={`py-3 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${activeTab === 'REFUND_ESTIMATE'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            onClick={() => setActiveTab('REFUND_ESTIMATE')}
            aria-label="GST Refund & Liability Estimator tab"
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
                <KpiCard
                  title="Matched Invoices"
                  count={summary.matchedCount || 0}
                  amount={eligibleItc.total || 0}
                  icon={<CheckCircle2 className="w-4 h-4 text-success-600" />}
                  color="success"
                  active={filterBucket === 'MATCHED'}
                  onClick={() => setFilterBucket(filterBucket === 'MATCHED' ? 'ALL' : 'MATCHED')}
                  label="Claimable ITC"
                />

                <KpiCard
                  title="Missing in GSTR-2B"
                  count={summary.missingIn2bCount || 0}
                  amount={atRiskItc.total || 0}
                  icon={<AlertTriangle className="w-4 h-4 text-danger-600" />}
                  color="danger"
                  active={filterBucket === 'MISSING_IN_2B'}
                  onClick={() => setFilterBucket(filterBucket === 'MISSING_IN_2B' ? 'ALL' : 'MISSING_IN_2B')}
                  label="At-Risk ITC"
                />

                <KpiCard
                  title="Value Discrepancies"
                  count={summary.mismatchedCount || 0}
                  icon={<RefreshCw className="w-4 h-4 text-amber-600" />}
                  color="amber"
                  active={filterBucket === 'MISMATCHED_VALUE'}
                  onClick={() => setFilterBucket(filterBucket === 'MISMATCHED_VALUE' ? 'ALL' : 'MISMATCHED_VALUE')}
                  label="Amount differs"
                />

                <KpiCard
                  title="Extra in 2B"
                  count={summary.extraIn2bCount || 0}
                  icon={<FileQuestion className="w-4 h-4 text-blue-600" />}
                  color="blue"
                  active={filterBucket === 'EXTRA_IN_2B'}
                  onClick={() => setFilterBucket(filterBucket === 'EXTRA_IN_2B' ? 'ALL' : 'EXTRA_IN_2B')}
                  label="Unrecorded in books"
                />
              </div>

              {/* Search & Actions Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search by vendor, GSTIN, or invoice..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-surface-border bg-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
                      aria-label="Search invoices"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCSV}
                    disabled={filteredItems.length === 0}
                    aria-label="Export to CSV"
                  >
                    <Download className="w-3.5 h-3.5 mr-1" />
                    Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.print()}
                    aria-label="Print report"
                  >
                    <Printer className="w-3.5 h-3.5 mr-1" />
                    Print
                  </Button>
                </div>
              </div>

              {/* Filter Pills */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter options">
                  <span className="text-xs text-slate-400 font-medium mr-1">Filter:</span>
                  {['ALL', 'MATCHED', 'MISSING_IN_2B', 'MISMATCHED_VALUE', 'EXTRA_IN_2B'].map(bucket => (
                    <FilterPill
                      key={bucket}
                      bucket={bucket}
                      count={bucket === 'ALL' ? allItems.length :
                        bucket === 'MATCHED' ? summary.matchedCount || 0 :
                          bucket === 'MISSING_IN_2B' ? summary.missingIn2bCount || 0 :
                            bucket === 'MISMATCHED_VALUE' ? summary.mismatchedCount || 0 :
                              summary.extraIn2bCount || 0}
                      active={filterBucket === bucket}
                      onClick={() => setFilterBucket(bucket)}
                    />
                  ))}
                </div>
                <span className="text-xs text-slate-400">
                  Showing <strong>{paginatedItems.length}</strong> of <strong>{filteredItems.length}</strong> records
                </span>
              </div>

              {/* Items Table */}
              <div className="overflow-x-auto rounded-xl border border-surface-border bg-white">
                <table className="w-full text-left text-xs border-collapse" role="table" aria-label="ITC reconciliation items">
                  <caption className="sr-only">ITC reconciliation items with status, vendor details, and tax amounts</caption>
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                    <tr>
                      <th className="py-3 px-3 w-10">
                        <input
                          type="checkbox"
                          checked={selectedItems.size === paginatedItems.length && paginatedItems.length > 0}
                          onChange={handleSelectAll}
                          className="rounded border-slate-300"
                          aria-label="Select all items"
                        />
                      </th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3">Vendor / Supplier</th>
                      <th className="py-3 px-3">Bill / Inv #</th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:bg-slate-100 transition"
                        onClick={() => handleSort('billDate')}
                      >
                        <div className="flex items-center gap-1">
                          Date
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th
                        className="py-3 px-3 text-right cursor-pointer hover:bg-slate-100 transition"
                        onClick={() => handleSort('totalTax')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Books Tax (₹)
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th
                        className="py-3 px-3 text-right cursor-pointer hover:bg-slate-100 transition"
                        onClick={() => handleSort('gstr2bTax')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          2B Tax (₹)
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th className="py-3 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedItems.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="text-center py-8 text-slate-400">
                          {searchQuery ? 'No records match your search.' : 'No records found in this reconciliation filter.'}
                        </td>
                      </tr>
                    ) : (
                      paginatedItems.map((item, idx) => {
                        const itemId = item.billId || item.invoiceNumber || idx;
                        return (
                          <tr
                            key={itemId}
                            className={`hover:bg-slate-50/50 transition-colors ${selectedItems.has(itemId) ? 'bg-brand-50/30' : ''
                              }`}
                          >
                            <td className="py-2.5 px-3">
                              <input
                                type="checkbox"
                                checked={selectedItems.has(itemId)}
                                onChange={() => handleToggleSelection(itemId)}
                                className="rounded border-slate-300"
                                aria-label={`Select ${item.billNumber || item.invoiceNumber}`}
                              />
                            </td>
                            <td className="py-2.5 px-3">
                              <StatusBadge bucket={item.bucket} />
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
                            <td className="py-2.5 px-3">
                              <button
                                type="button"
                                onClick={() => handleViewComparison(item)}
                                className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1"
                                aria-label={`View comparison for ${item.billNumber || item.invoiceNumber}`}
                              >
                                <Eye className="w-3 h-3" />
                                Compare
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-500">
                    Page {currentPage} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && activeTab === 'REFUND_ESTIMATE' && refundEstimate && (
            <RefundEstimateTab refundEstimate={refundEstimate} netPos={netPos} isRefund={isRefund} />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-surface-border bg-slate-50 flex items-center justify-between shrink-0">
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

        {/* Comparison Modal */}
        {showComparisonModal && comparisonItem && (
          <ComparisonModal
            item={comparisonItem}
            onClose={() => {
              setShowComparisonModal(false);
              setComparisonItem(null);
            }}
          />
        )}
      </div>
    </div>
  );

  if (!isOpen) return null;

  return createPortal(modalContent, document.body);
}

// Helper Components
function KpiCard({ title, count, amount, icon, color, active, onClick, label }) {
  const colorClasses = {
    success: active ? 'border-success-500 bg-success-50/50 ring-2 ring-success-500/20' : 'border-surface-border bg-white hover:border-slate-300',
    danger: active ? 'border-danger-500 bg-danger-50/50 ring-2 ring-danger-500/20' : 'border-surface-border bg-white hover:border-slate-300',
    amber: active ? 'border-amber-500 bg-amber-50/50 ring-2 ring-amber-500/20' : 'border-surface-border bg-white hover:border-slate-300',
    blue: active ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20' : 'border-surface-border bg-white hover:border-slate-300',
  };

  const textColor = {
    success: 'text-success-700',
    danger: 'text-danger-700',
    amber: 'text-amber-700',
    blue: 'text-blue-700',
  };

  return (
    <div
      className={`p-4 rounded-xl border transition cursor-pointer ${colorClasses[color]}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`${title}: ${count} items`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">{title}</span>
        {icon}
      </div>
      <div className={`text-2xl font-bold font-mono ${textColor[color]} mt-2`}>
        {count}
      </div>
      {amount !== undefined && (
        <div className="text-[11px] text-slate-500 mt-1">
          {label}: <strong className="text-slate-900">{formatCurrency(amount)}</strong>
        </div>
      )}
    </div>
  );
}

function FilterPill({ bucket, count, active, onClick }) {
  const labels = {
    ALL: 'All',
    MATCHED: 'Matched',
    MISSING_IN_2B: 'Missing in 2B',
    MISMATCHED_VALUE: 'Discrepancies',
    EXTRA_IN_2B: 'Extra in 2B',
  };

  const colors = {
    ALL: active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
    MATCHED: active ? 'bg-success-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
    MISSING_IN_2B: active ? 'bg-danger-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
    MISMATCHED_VALUE: active ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
    EXTRA_IN_2B: active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
  };

  return (
    <button
      type="button"
      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${colors[bucket]}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Filter by ${labels[bucket]}`}
    >
      {labels[bucket]} ({count})
    </button>
  );
}

function StatusBadge({ bucket }) {
  const config = {
    MATCHED: { variant: 'success', label: 'MATCHED' },
    MISSING_IN_2B: { variant: 'danger', label: 'MISSING IN 2B' },
    MISMATCHED_VALUE: { variant: 'warning', label: 'MISMATCH' },
    EXTRA_IN_2B: { variant: 'info', label: 'EXTRA IN 2B' },
  };

  const { variant, label } = config[bucket] || { variant: 'neutral', label: bucket };

  return <Badge variant={variant} size="sm">{label}</Badge>;
}

function RefundEstimateTab({ refundEstimate, netPos, isRefund }) {
  return (
    <div className="space-y-5">
      <div
        className={`p-6 rounded-2xl border ${isRefund
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

      <div className="rounded-xl border border-surface-border overflow-hidden bg-white">
        <div className="px-5 py-3 border-b border-surface-border bg-slate-50">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Tax Offsetting & Net Position Breakdown
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse" aria-label="Tax breakdown">
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
  );
}

function ComparisonModal({ item, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between bg-slate-50">
          <h3 className="text-base font-bold text-slate-900">
            Detailed Comparison: {item.billNumber || item.invoiceNumber}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-surface-border bg-white hover:bg-slate-100 flex items-center justify-center text-slate-500"
            aria-label="Close comparison"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-8rem)]">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Your Books
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Vendor:</span>
                  <span className="font-semibold">{item.vendorName || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">GSTIN:</span>
                  <span className="font-mono">{item.vendorGstin || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date:</span>
                  <span>{item.billDate ? formatDate(item.billDate) : '—'}</span>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-slate-500">Taxable Value:</span>
                  <span className="font-mono font-semibold">{formatCurrency(item.taxableValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">CGST:</span>
                  <span className="font-mono">{formatCurrency(item.cgst || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">SGST:</span>
                  <span className="font-mono">{formatCurrency(item.sgst || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">IGST:</span>
                  <span className="font-mono">{formatCurrency(item.igst || 0)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t font-bold">
                  <span>Total Tax:</span>
                  <span className="font-mono text-brand-600">{formatCurrency(item.totalTax || 0)}</span>
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                GSTR-2B
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Supplier:</span>
                  <span className="font-semibold">{item.gstr2b?.supplierName || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">GSTIN:</span>
                  <span className="font-mono">{item.gstr2b?.supplierGstin || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date:</span>
                  <span>{item.gstr2b?.invoiceDate ? formatDate(item.gstr2b.invoiceDate) : '—'}</span>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-slate-500">Taxable Value:</span>
                  <span className="font-mono font-semibold">{formatCurrency(item.gstr2b?.taxableValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">CGST:</span>
                  <span className="font-mono">{formatCurrency(item.gstr2b?.cgst || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">SGST:</span>
                  <span className="font-mono">{formatCurrency(item.gstr2b?.sgst || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">IGST:</span>
                  <span className="font-mono">{formatCurrency(item.gstr2b?.igst || 0)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t font-bold">
                  <span>Total Tax:</span>
                  <span className="font-mono text-brand-600">{formatCurrency(item.gstr2b?.totalTax || 0)}</span>
                </div>
              </div>
            </div>
          </div>
          {item.discrepancy && (
            <div className="mt-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 mt-0.5" />
                <div className="text-xs text-amber-900">
                  <strong>Discrepancy Detected:</strong> Tax difference of {formatCurrency(item.discrepancy.diffTax || 0)}.
                  Verify line items and tax rates with vendor.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}