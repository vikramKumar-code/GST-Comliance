import { ArrowRight } from 'lucide-react';
import Loader from '../Loader';
import { formatCurrency, formatPeriod } from '../../utils/format';
import { SECTION_COLOR_CONFIG } from '../../utils/returnHelpers';

/**
 * Grid of 7 GSTR-1 section cards
 * @param {Object} props
 * @param {Array} props.cards Array of section card objects
 * @param {Function} props.onCardClick Callback when a section card is clicked
 * @param {boolean} [props.loading]
 * @param {string} [props.period]
 * @param {Function} [props.onSelectSection]
 */
export function SectionCards({
  cards = [],
  onCardClick,
  loading = false,
  period = '',
  onSelectSection
}) {
  const handleClick = (key) => {
    if (onCardClick) {
      onCardClick(key);
    } else if (onSelectSection) {
      onSelectSection(key);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center bg-white rounded-2xl border border-surface-border">
        <Loader message={`Distributing local sales invoices into GSTR-1 cards for ${formatPeriod(period)}...`} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
      {cards.map((section) => {
        const IconComponent = section.icon;
        const currentConfig = SECTION_COLOR_CONFIG[section.color] || SECTION_COLOR_CONFIG.indigo;

        return (
          <div
            key={section.key}
            onClick={() => handleClick(section.key)}
            className={`group relative flex flex-col justify-between p-5 rounded-2xl border border-slate-200/90 bg-white shadow-xs hover:shadow-lg ${currentConfig.border} hover:-translate-y-1 transition-all duration-200 cursor-pointer overflow-hidden min-h-[225px]`}
            role="button"
            tabIndex={0}
            aria-label={`View ${section.title} details`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick(section.key);
              }
            }}
          >
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all shrink-0 ${currentConfig.icon}`}
                  >
                    {IconComponent && <IconComponent className="w-5 h-5" />}
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block leading-none">
                      {section.tableCode}
                    </span>
                    <h3 className="font-bold text-slate-900 text-sm leading-snug group-hover:text-indigo-600 transition-colors mt-1 truncate">
                      {section.title}
                    </h3>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border shrink-0 ${currentConfig.badge}`}
                >
                  {section.count}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-3 line-clamp-2 leading-relaxed min-h-[32px]">
                {section.subtitle}
              </p>
              <div className="mt-3.5 p-3 rounded-xl bg-slate-50/90 border border-slate-100/90 space-y-1.5 group-hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Taxable:</span>
                  <span className="font-semibold text-slate-900 font-mono">
                    {formatCurrency(section.taxable)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Total Tax:</span>
                  <span className={`font-bold font-mono ${currentConfig.tax}`}>
                    {formatCurrency(section.tax)}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                <span>{section.included} included</span>
              </span>
              <span className="font-bold text-xs text-indigo-600 group-hover:text-indigo-700 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                <span>Inspect</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SectionCards;
