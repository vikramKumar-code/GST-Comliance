import { useState, useMemo } from 'react';
import { ITEMS_PER_PAGE } from '../utils/returnHelpers';

/**
 * Custom hook for client-side pagination
 * @param {Array} [items]
 * @param {number} [itemsPerPage]
 * @returns {Object} {
 *   currentPage, totalPages, paginatedItems,
 *   goToPage, nextPage, prevPage, hasNextPage, hasPrevPage, resetPage
 * }
 */
export function usePagination(items = [], itemsPerPage = ITEMS_PER_PAGE) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil((items?.length || 0) / itemsPerPage));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedItems = useMemo(() => {
    if (!Array.isArray(items)) return [];
    const startIndex = (safeCurrentPage - 1) * itemsPerPage;
    return items.slice(startIndex, startIndex + itemsPerPage);
  }, [items, safeCurrentPage, itemsPerPage]);

  const hasNextPage = safeCurrentPage < totalPages;
  const hasPrevPage = safeCurrentPage > 1;

  const goToPage = (page) => {
    const pageNum = Number(page);
    if (isNaN(pageNum)) return;
    setCurrentPage(Math.min(Math.max(1, pageNum), totalPages));
  };

  const nextPage = () => {
    setCurrentPage((p) => (p < totalPages ? p + 1 : p));
  };

  const prevPage = () => {
    setCurrentPage((p) => (p > 1 ? p - 1 : p));
  };

  const resetPage = () => {
    setCurrentPage(1);
  };

  return {
    currentPage: safeCurrentPage,
    setCurrentPage,
    totalPages,
    paginatedItems,
    goToPage,
    nextPage,
    prevPage,
    hasNextPage,
    hasPrevPage,
    resetPage
  };
}

export default usePagination;
