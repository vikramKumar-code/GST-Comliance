import { TrendingUp, TrendingDown } from 'lucide-react';
import Card from './Card';

/**
 * Modern Ramp / Stripe style Financial Metric Card
 */
export function MetricCard({
  title,
  value,
  subvalue,
  icon: Icon,
  trend,
  trendType = 'up', // 'up' | 'down' | 'neutral'
  description,
  badge,
  className = '',
  onClick,
}) {
  const isClickable = Boolean(onClick);

  return (
    <Card
      hoverable={isClickable}
      onClick={onClick}
      className={`p-5 flex flex-col justify-between ${
        isClickable ? 'cursor-pointer' : ''
      } ${className}`}
    >
      {/* Top Header: Title & Icon */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {title}
          </span>
          {badge && <div className="mt-1">{badge}</div>}
        </div>

        {Icon && (
          <div className="w-9 h-9 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-600 shrink-0">
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Main Metric Value */}
      <div className="mt-3">
        <div className="text-2xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
          {value}
        </div>
        {subvalue && (
          <div className="text-xs text-slate-500 mt-0.5 font-mono">{subvalue}</div>
        )}
      </div>

      {/* Bottom Footer: Trend & Helper description */}
      {(trend || description) && (
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
          {trend && (
            <div
              className={`flex items-center gap-1 font-medium ${
                trendType === 'up'
                  ? 'text-emerald-700'
                  : trendType === 'down'
                  ? 'text-rose-700'
                  : 'text-slate-600'
              }`}
            >
              {trendType === 'up' ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : trendType === 'down' ? (
                <TrendingDown className="w-3.5 h-3.5" />
              ) : null}
              <span>{trend}</span>
            </div>
          )}

          {description && (
            <span className="text-slate-400 text-[11px] truncate">{description}</span>
          )}
        </div>
      )}
    </Card>
  );
}

export default MetricCard;
