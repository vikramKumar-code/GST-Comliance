/**
 * Modern fintech Badge component with dot indicator and clean contrast
 */
export function Badge({
  children,
  variant = 'neutral',
  status = null,
  size = 'sm',
  dot = true,
  className = '',
  ...props
}) {
  const rawStatus = (status || (typeof children === 'string' ? children : '')).toUpperCase();

  const STATUS_VARIANT_MAP = {
    // Invoices & Payments
    PAID: 'success',
    ACTIVE: 'success',
    FILED: 'success',
    VERIFIED: 'success',
    MATCHED: 'success',
    GENERATED: 'success',

    // Pending / In-progress
    SENT: 'info',
    PENDING: 'warning',
    DRAFT: 'neutral',
    PROCESSING: 'info',

    // Warnings & Mismatches
    MISMATCHED: 'warning',
    MISMATCHED_VALUE: 'warning',
    OVERDUE: 'warning',

    // Errors & Rejections
    CANCELLED: 'danger',
    FAILED: 'danger',
    REJECTED: 'danger',
    MISSING_IN_2B: 'danger',
    EXTRA_IN_2B: 'purple',

    // 4-Role Model
    OWNER: 'indigo',
    ADMIN: 'purple',
    MEMBER: 'blue',
    VIEWER: 'neutral',

    // Subscription Tiers
    FREE: 'neutral',
    PRO: 'indigo',
    ENTERPRISE: 'amber',
  };

  const resolvedVariant = status ? STATUS_VARIANT_MAP[rawStatus] || variant : variant;

  const VARIANT_STYLES = {
    neutral: 'bg-slate-100 text-slate-700 border-slate-200/80',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
    blue: 'bg-sky-50 text-sky-700 border-sky-200/80',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    warning: 'bg-amber-50 text-amber-800 border-amber-200/80',
    danger: 'bg-rose-50 text-rose-700 border-rose-200/80',
    purple: 'bg-purple-50 text-purple-700 border-purple-200/80',
    amber: 'bg-amber-50 text-amber-800 border-amber-200/80',
  };

  const DOT_COLORS = {
    neutral: 'bg-slate-500',
    indigo: 'bg-indigo-600',
    blue: 'bg-sky-600',
    success: 'bg-emerald-600',
    warning: 'bg-amber-600',
    danger: 'bg-rose-600',
    purple: 'bg-purple-600',
    amber: 'bg-amber-600',
  };

  const SIZE_STYLES = {
    xs: 'text-[10px] px-1.5 py-0.5 gap-1',
    sm: 'text-xs px-2 py-0.5 gap-1.5',
    md: 'text-xs px-2.5 py-1 gap-1.5 font-medium',
  };

  const currentVariant = VARIANT_STYLES[resolvedVariant] || VARIANT_STYLES.neutral;
  const currentDot = DOT_COLORS[resolvedVariant] || DOT_COLORS.neutral;

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium leading-none tracking-tight select-none ${currentVariant} ${
        SIZE_STYLES[size] || SIZE_STYLES.sm
      } ${className}`}
      {...props}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${currentDot}`} aria-hidden="true" />}
      <span>{children}</span>
    </span>
  );
}

export default Badge;
