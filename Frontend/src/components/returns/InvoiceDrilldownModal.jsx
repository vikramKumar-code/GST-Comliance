import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X, Search, Building2, Info } from 'lucide-react';
import Button from '../ui/Button';
import { TableEmptyState } from './EmptyStates';
import useFocusTrap from '../../hooks/useFocusTrap';
import usePagination from '../../hooks/usePagination';
import { formatCurrency, formatPeriod, formatDate } from '../../utils/format';

/**
 * Invoice Drilldown Modal with search filtering, focus trapping, and pagination
 */
export function InvoiceDrilldownModal({
  activeSection,
  isPortalGstr1Active,
  period,
  onClose,
  onToggleExclude,
  onExcludeAll,
  onIncludeAll
}) {
  const [tableSearch, setTableSearch] = useState('');

  const modalRef = useFocusTrap(Boolean(activeSection), onClose);

  // Filter items by search query
  const searchTerm = tableSearch.toLowerCase().trim();
  const modalFilteredItems = useMemo(() => {
    if (!activeSection) return [];
    if (!searchTerm) return activeSection.items || [];
    return (activeSection.items || []).filter((item) =>
      item.invoiceNumber?.toLowerCase().includes(searchTerm) ||
      item.customerName?.toLowerCase().includes(searchTerm) ||
      item.customerGstin?.toLowerCase().includes(searchTerm)
    );
  }, [activeSection, searchTerm]);

  // Pagination hook
  const {
    currentPage,
    totalPages,
    paginatedItems,
    nextPage,
    prevPage,
    hasNextPage,
    hasPrevPage
  } = usePagination(modalFilteredItems, 50);

  if (!activeSection) return null;

  const IconComp = activeSection.icon;
  const includedCount = modalFilteredItems.filter((i) => !i.isExcluded).length;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drilldown-title"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-6xl max-h-[92vh] bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-surface-border animate-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white border border-surface-border shadow-xs flex items-center justify-center text-slate-700">
              {IconComp && <IconComp className="w-5 h-5 text-brand-600" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold uppercase text-brand-700 bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                  {activeSection.tableCode}
                </span>
                <h3 id="drilldown-title" className="text-base font-bold text-slate-900">
                  {activeSection.title}
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {activeSection.subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 rounded-full border border-surface-border bg-white hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 transition cursor-pointer"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Bulk Actions Bar */}
        <div className="px-6 py-3 border-b border-surface-border bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search invoice number, buyer name, or GSTIN..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-surface-border focus:outline-none focus:border-brand-500 bg-white"
              aria-label="Search invoices"
            />
          </div>

          <div className="flex items-center gap-2 text-xs flex-wrap">
            {!isPortalGstr1Active && activeSection.key !== 'hsn' && activeSection.key !== 'docIssue' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onExcludeAll(modalFilteredItems)}
                  className="text-rose-700 border-rose-300 hover:bg-rose-50"
                >
                  Exclude All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onIncludeAll(modalFilteredItems)}
                  className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                >
                  Include All
                </Button>
                <span className="text-slate-300">|</span>
              </>
            )}
            <span className="text-slate-500">
              Showing <strong>{modalFilteredItems.length}</strong> items
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-brand-700 font-semibold">
              {includedCount} included in return
            </span>
          </div>
        </div>

        {/* Context Banner */}
        {isPortalGstr1Active ? (
          <div className="px-6 py-2.5 bg-emerald-50/80 border-b border-emerald-100 text-emerald-900 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                <strong>Government GST Portal Records:</strong> Viewing official filed return data retrieved from GSTN for {formatPeriod(period)}.
              </span>
            </div>
            <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
              GST Portal Filed
            </span>
          </div>
        ) : (
          <div className="px-6 py-2.5 bg-amber-50/80 border-b border-amber-100 text-amber-900 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Safe Invoice Exclusion:</strong> Clicking <strong>&quot;Exclude&quot;</strong> removes the invoice from this GSTR-1 return filing payload without deleting it from your database!
              </span>
            </div>
            <Link
              to="/sales/invoices"
              className="text-xs font-semibold text-amber-800 hover:underline shrink-0"
            >
              + Create Invoice
            </Link>
          </div>
        )}

        {/* Table Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeSection.key === 'docIssue' && activeSection.docRange && (
            <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-[11px] text-slate-500 font-medium">Serial Number Range</p>
                <p className="text-xs font-mono font-bold text-slate-800 truncate mt-0.5">
                  {activeSection.docRange.from || 'INV-001'} → {activeSection.docRange.to || 'INV-001'}
                </p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-[11px] text-slate-500 font-medium">Total Issued</p>
                <p className="text-sm font-bold text-slate-900 mt-0.5">
                  {activeSection.docRange.totnum || activeSection.items?.length || 0}
                </p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-[11px] text-slate-500 font-medium">Cancelled</p>
                <p className="text-sm font-bold text-rose-600 mt-0.5">
                  {activeSection.docRange.canc || 0}
                </p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-[11px] text-slate-500 font-medium">Net Valid Documents</p>
                <p className="text-sm font-bold text-emerald-600 mt-0.5">
                  {activeSection.docRange.net_issue || activeSection.items?.length || 0}
                </p>
              </div>
            </div>
          )}

          {paginatedItems.length === 0 ? (
            <TableEmptyState
              period={period}
              title={activeSection.title}
              tableSearch={tableSearch}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-surface-border">
              <table
                className="w-full text-left text-xs border-collapse"
                role="table"
                aria-label={`${activeSection.title} invoices`}
              >
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                  <tr>
                    <th className="py-3 px-3 w-12 text-center">Status</th>
                    <th className="py-3 px-3">Invoice #</th>
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Customer / Buyer</th>
                    <th className="py-3 px-3">GSTIN</th>
                    <th className="py-3 px-3 text-right">Taxable (₹)</th>
                    <th className="py-3 px-3 text-right">IGST (₹)</th>
                    <th className="py-3 px-3 text-right">CGST+SGST (₹)</th>
                    <th className="py-3 px-3 text-right">Grand Total (₹)</th>
                    <th className="py-3 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedItems.map((item) => {
                    const isExcluded = item.isExcluded;
                    return (
                      <tr
                        key={String(item._id)}
                        className={`transition-colors ${
                          isExcluded
                            ? 'bg-slate-50/80 opacity-60 text-slate-400'
                            : 'hover:bg-slate-50/50 text-slate-700'
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center">
                          {isExcluded ? (
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300"
                              title="Excluded from GSTR-1"
                              aria-label="Excluded"
                            />
                          ) : (
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full bg-brand-500"
                              title="Included in GSTR-1"
                              aria-label="Included"
                            />
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                          {item.invoiceNumber}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">
                          {item.dateFormatted || formatDate(item.invoiceDate)}
                        </td>
                        <td
                          className="py-2.5 px-3 font-medium text-slate-900 truncate max-w-[160px]"
                          title={item.customerName}
                        >
                          {item.customerName || 'Consumer'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                          {item.customerGstin || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium">
                          {formatCurrency(item.taxableAmount || 0)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                          {formatCurrency(item.igst || 0)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                          {formatCurrency((item.cgst || 0) + (item.sgst || 0))}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {formatCurrency(item.grandTotal || 0)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {item.isPortal ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              ✓ Filed on Portal
                            </span>
                          ) : item.isHsnRow || item.isDocRow ? (
                            <span className="text-[10px] text-slate-400 font-medium">System Row</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onToggleExclude(item._id)}
                              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition shadow-2xs cursor-pointer ${
                                isExcluded
                                  ? 'bg-brand-50 text-brand-700 border border-brand-300 hover:bg-brand-100'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                              }`}
                              title={
                                isExcluded
                                  ? 'Include this invoice back in the GSTR-1 return filing'
                                  : 'Exclude this invoice from GSTR-1 (Invoice stays safely saved in DB)'
                              }
                              aria-label={
                                isExcluded
                                  ? `Include ${item.invoiceNumber}`
                                  : `Exclude ${item.invoiceNumber}`
                              }
                            >
                              {isExcluded ? '✓ Include Back' : '✕ Exclude'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer with Pagination */}
        <div className="px-6 py-3 border-t border-surface-border bg-slate-50 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500">
            Active Section: <strong>{activeSection.title}</strong>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={prevPage}
                disabled={!hasPrevPage}
              >
                Previous
              </Button>
              <span className="text-xs text-slate-600 px-2">
                Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={nextPage}
                disabled={!hasNextPage}
              >
                Next
              </Button>
            </div>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
          >
            Close Table
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default InvoiceDrilldownModal;
