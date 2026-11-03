/**
 * Reusable StatusBadge component supporting GST invoices, E-Invoices, roles, and plan statuses
 */
export default function StatusBadge({ status, type = 'default', size = 'sm', className = '' }) {
  if (!status) return null;

  const raw = String(status).toUpperCase();

  const STYLE_MAP = {
    // Invoice & Payment Statuses
    PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-emerald-500/10',
    SENT: 'bg-blue-50 text-blue-700 border-blue-200 ring-blue-500/10',
    DRAFT: 'bg-slate-100 text-slate-700 border-slate-200 ring-slate-500/10',
    CANCELLED: 'bg-rose-50 text-rose-700 border-rose-200 ring-rose-500/10',
    OVERDUE: 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-500/10',

    // E-Invoice Statuses
    GENERATED: 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-emerald-500/20 font-mono',
    FAILED: 'bg-rose-50 text-rose-800 border-rose-300 ring-rose-500/20 font-mono',

    // Reconciliation Buckets
    MATCHED: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-emerald-500/10',
    MISMATCHED: 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-500/10',
    MISMATCHED_VALUE: 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-500/10',
    MISSING_IN_2B: 'bg-rose-50 text-rose-700 border-rose-200 ring-rose-500/10',
    EXTRA_IN_2B: 'bg-purple-50 text-purple-700 border-purple-200 ring-purple-500/10',

    // Four-Role Model
    OWNER: 'bg-indigo-50 text-indigo-700 border-indigo-200 font-bold',
    ADMIN: 'bg-purple-50 text-purple-700 border-purple-200 font-bold',
    MEMBER: 'bg-blue-50 text-blue-700 border-blue-200 font-medium',
    VIEWER: 'bg-slate-100 text-slate-600 border-slate-200 font-medium',

    // Subscription Plans
    FREE: 'bg-slate-100 text-slate-700 border-slate-300',
    PRO: 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold',
    ENTERPRISE: 'bg-gradient-to-r from-amber-50 to-orange-50 text-amber-900 border-amber-300 font-bold',

    // Default Fallback
    DEFAULT: 'bg-slate-50 text-slate-700 border-slate-200',
  };

  const badgeStyle = STYLE_MAP[raw] || STYLE_MAP.DEFAULT;

  const sizeClasses = {
    xs: 'text-[10px] px-1.5 py-0.5',
    sm: 'text-xs px-2.5 py-1',
    md: 'text-sm px-3 py-1.5',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium leading-none tracking-wide shadow-2xs ${badgeStyle} ${sizeClasses[size] || sizeClasses.sm} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" />
      <span>{status}</span>
    </span>
  );
}
