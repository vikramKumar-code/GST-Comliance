/**
 * Standardized Fintech Page Header with title, description, badge, and action slots
 */
export function PageHeader({
  title,
  subtitle,
  badge = null,
  actions = null,
  breadcrumbs = null,
  className = '',
}) {
  return (
    <div className={`mb-6 flex flex-col gap-3 ${className}`}>
      {breadcrumbs && <div className="mb-0.5">{breadcrumbs}</div>}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 mb-0">
              {title}
            </h1>
            {badge && <div>{badge}</div>}
          </div>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-1 mb-0 max-w-2xl leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
