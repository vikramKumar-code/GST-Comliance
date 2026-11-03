import { Inbox } from 'lucide-react';
import Button from '../ui/Button';

/**
 * Reusable EmptyState component supporting both legacy and modern prop conventions
 */
export default function EmptyState({
  icon = null,
  title = 'No records found',
  description,
  message,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  action,
  children,
  className = '',
}) {
  const displayDesc = description || message || 'There are no items to display for the current filter or period.';

  return (
    <div className={`py-12 px-6 text-center max-w-md mx-auto ${className}`}>
      <div className="w-12 h-12 mx-auto mb-3.5 rounded-xl bg-slate-50 border border-slate-200/90 flex items-center justify-center text-slate-400 shadow-xs select-none">
        {icon ? (
          typeof icon === 'string' ? (
            <span className="text-xl">{icon}</span>
          ) : (
            icon
          )
        ) : (
          <Inbox className="w-6 h-6 text-slate-400" />
        )}
      </div>
      <h3 className="text-sm font-semibold text-slate-900 tracking-tight">{title}</h3>
      {displayDesc && (
        <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-sm mx-auto">
          {displayDesc}
        </p>
      )}

      {children}

      {action && <div className="mt-4 flex justify-center">{action}</div>}

      {(actionLabel || secondaryActionLabel) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {actionLabel && (
            <Button
              variant="primary"
              size="sm"
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          )}
          {secondaryActionLabel && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSecondaryAction}
            >
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
