import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import EmptyState from './EmptyState';
import Loader from './Loader';
import Pagination from './Pagination';

/**
 * Reusable responsive DataTable component with search, pagination, and empty state
 */
export default function DataTable({
  columns = [],
  data = [],
  isLoading = false,
  searchPlaceholder = 'Search records...',
  searchFilterFn,
  pageSize = 10,
  emptyTitle = 'No records found',
  emptyDescription = 'There are no items to display.',
  emptyIcon = null,
  actionButton,
  className = '',
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Filtered data based on search input
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    if (searchFilterFn) {
      return data.filter((item) => searchFilterFn(item, searchTerm.toLowerCase()));
    }
    // Default search over string values
    return data.filter((item) => {
      const line = Object.values(item).filter(Boolean).join(' ').toLowerCase();
      return line.includes(searchTerm.toLowerCase());
    });
  }, [data, searchTerm, searchFilterFn]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage, pageSize]);

  return (
    <div className={`flex flex-col bg-white rounded-xl border border-slate-200/90 overflow-hidden shadow-card ${className}`}>
      {/* Top Search & Action Bar */}
      <div className="p-3.5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative flex-1 max-w-sm">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-3.5 h-3.5" />
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 transition"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 font-medium">
            Total <strong className="font-mono text-slate-700">{filteredData.length}</strong> items
          </span>
          {actionButton}
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-x-auto min-h-[220px]">
        {isLoading ? (
          <div className="py-16">
            <Loader message="Loading records..." />
          </div>
        ) : paginatedData.length === 0 ? (
          <EmptyState
            icon={emptyIcon}
            title={searchTerm ? 'No matching records' : emptyTitle}
            description={searchTerm ? `No results for "${searchTerm}". Try resetting search.` : emptyDescription}
          />
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key || col.header}
                    className={`py-3 px-4 text-[11px] font-semibold uppercase tracking-wider ${col.className || ''} ${
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginatedData.map((row, idx) => (
                <tr
                  key={row._id || row.id || idx}
                  className="hover:bg-slate-50/70 transition-colors"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key || col.header}
                      className={`py-3 px-4 ${col.className || ''} ${
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                      }`}
                    >
                      {col.render ? col.render(row, idx) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      {filteredData.length > pageSize && (
        <div className="p-3.5 border-t border-slate-100 bg-slate-50/50">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={filteredData.length}
            pageSize={pageSize}
          />
        </div>
      )}
    </div>
  );
}
