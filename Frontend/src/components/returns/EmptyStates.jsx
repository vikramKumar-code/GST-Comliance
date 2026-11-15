import { Link } from 'react-router-dom';
import { Building2, FileText, Sparkles, Plus, Zap, CheckCircle2 } from 'lucide-react';
import Button from '../ui/Button';
import { formatPeriod } from '../../utils/format';

/**
 * Empty state when no live return is found on the GST portal
 */
export function PortalGstr1EmptyState({ period, onSwitchToLocal }) {
  return (
    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="text-xs">
          <strong className="font-semibold text-slate-900">
            No Filed Return on Govt Portal for {formatPeriod(period)}
          </strong>
          <p className="text-slate-600 mt-0.5">
            GSTR-1 has not been filed on the GST portal for this month yet. Switch to Local Invoices to prepare or file a return.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onSwitchToLocal}
        className="bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50 font-medium shrink-0"
      >
        <FileText className="w-3.5 h-3.5 mr-1 text-indigo-600" />
        <span>Switch to Local Invoices</span>
      </Button>
    </div>
  );
}

/**
 * Empty state when no local sales invoices exist for the selected period
 */
export function LocalGstr1EmptyState({ period, seeding, onSeed, onOpenNilModal }) {
  return (
    <div className="p-4 rounded-2xl bg-amber-50/90 border border-amber-200 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5" />
        </div>
        <div className="text-xs">
          <strong className="font-semibold text-amber-900">
            No Sales Invoices Recorded for {formatPeriod(period)}
          </strong>
          <p className="text-amber-800/90 mt-0.5">
            GSTR-1 auto-compiles from your sales invoices. Create an invoice or switch to a period with invoices.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={onSeed}
          disabled={seeding}
          className="bg-white text-slate-700 hover:bg-slate-50"
        >
          <Sparkles className="w-3.5 h-3.5 mr-1 text-indigo-600" />
          <span>{seeding ? 'Generating...' : 'Add Sample Data'}</span>
        </Button>
        <Link to="/sales/invoices">
          <Button variant="primary" size="sm">
            <Plus className="w-3.5 h-3.5 mr-1" />
            <span>Create Invoice</span>
          </Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenNilModal}
          className="bg-white text-slate-700"
        >
          <Zap className="w-3.5 h-3.5 mr-1 text-amber-600" />
          <span>File Nil Return</span>
        </Button>
      </div>
    </div>
  );
}

/**
 * Alert banner when sample invoice seeding succeeds
 */
export function SeedSuccessAlert({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div
      className="p-3.5 rounded-xl bg-success-50 border border-success-200 text-success-900 text-xs flex items-center justify-between gap-2"
      role="status"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-success-600 shrink-0" />
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-success-700 hover:text-success-900 font-bold cursor-pointer"
        aria-label="Dismiss message"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Empty state inside invoice drilldown table
 */
export function TableEmptyState({ period, title = 'Invoices', tableSearch, onAction }) {
  return (
    <div className="py-12 px-6 text-center max-w-lg mx-auto">
      <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-xs">
        <FileText className="w-7 h-7" />
      </div>
      <h4 className="text-base font-bold text-slate-900">
        {tableSearch ? 'No matching invoices found' : `No Invoices in ${title} Table`}
      </h4>
      <p className="text-xs text-slate-500 mt-2 leading-relaxed">
        {tableSearch ? (
          <>
            No invoices match search term &quot;<strong>{tableSearch}</strong>&quot;. Clear search bar to view all.
          </>
        ) : (
          <>
            GSTR-1 return populates from sales invoices in period <strong>{formatPeriod(period)}</strong>.
            No matching invoices exist in this active workspace for this period.
          </>
        )}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {tableSearch && onAction && (
          <Button variant="outline" size="sm" onClick={() => onAction('clear')}>
            Clear Search
          </Button>
        )}
        <Link to="/sales/invoices">
          <Button variant="primary" size="sm">
            <Plus className="w-3.5 h-3.5 mr-1" />
            <span>Create Sales Invoice</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}

/**
 * Universal EmptyStates component
 * @param {Object} props
 * @param {'no-portal-data' | 'no-invoices' | 'search-no-results' | 'seed-success'} props.type
 * @param {string} [props.period]
 * @param {Function} [props.onAction]
 * @param {string} [props.title]
 * @param {string} [props.tableSearch]
 * @param {boolean} [props.seeding]
 * @param {string} [props.message]
 * @param {Function} [props.onDismiss]
 */
export function EmptyStates({
  type,
  period,
  onAction,
  title = 'Invoices',
  tableSearch,
  seeding = false,
  message,
  onDismiss
}) {
  switch (type) {
    case 'no-portal-data':
      return (
        <PortalGstr1EmptyState
          period={period}
          onSwitchToLocal={() => onAction && onAction('switch-to-local')}
        />
      );
    case 'no-invoices':
      return (
        <LocalGstr1EmptyState
          period={period}
          seeding={seeding}
          onSeed={() => onAction && onAction('seed')}
          onOpenNilModal={() => onAction && onAction('nil')}
        />
      );
    case 'search-no-results':
      return (
        <TableEmptyState
          period={period}
          title={title}
          tableSearch={tableSearch}
          onAction={onAction}
        />
      );
    case 'seed-success':
      return <SeedSuccessAlert message={message} onDismiss={onDismiss || onAction} />;
    default:
      return null;
  }
}

EmptyStates.Portal = PortalGstr1EmptyState;
EmptyStates.Local = LocalGstr1EmptyState;
EmptyStates.Table = TableEmptyState;
EmptyStates.SeedSuccess = SeedSuccessAlert;

export default EmptyStates;
