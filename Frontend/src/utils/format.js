/**
 * Format currency amount in Indian Rupee format
 * @param {number|string} amount
 * @returns {string}
 */
export const formatCurrency = (amount) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(num);
};

/**
 * Format period string "MMYYYY" to human readable format (e.g., "092026" -> "Sep 2026")
 * @param {string} period
 * @returns {string}
 */
export const formatPeriod = (period) => {
  if (!period || period.length !== 6) return period || '';
  const monthNum = parseInt(period.slice(0, 2), 10);
  const year = period.slice(2, 6);
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const month = monthNames[monthNum - 1] || period.slice(0, 2);
  return `${month} ${year}`;
};

/**
 * Format ISO date string to localized date/time
 * @param {string} dateString
 * @returns {string}
 */
export const formatDate = (dateString) => {
  if (!dateString) return '—';
  try {
    return new Date(dateString).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return dateString;
  }
};
