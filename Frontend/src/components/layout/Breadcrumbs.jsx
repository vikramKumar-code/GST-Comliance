import { useLocation, Link } from 'react-router-dom';
import { Home, ChevronRight } from 'lucide-react';

const PATH_TITLES = {
  dashboard: 'Dashboard',
  cfo: 'CFO Executive Summary',
  'taxpayer-search': 'Taxpayer Search',
  customers: 'Customers',
  items: 'Items & HSN',
  sales: 'Sales',
  invoices: 'Invoices',
  'credit-notes': 'Credit Notes',
  purchases: 'Purchases',
  bills: 'Bills',
  expenses: 'Expenses',
  returns: 'GST Returns',
  summary: 'Annual Summary',
  'filing-history': 'Filing History',
  gstr1: 'GSTR-1 Hub',
  prepare: 'Prepare',
  'excel-import': 'Excel Ingestion',
  reports: 'Reports & Registers',
  settings: 'Organization Settings',
  pricing: 'Plans & Billing',
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
};

/**
 * Dynamic Breadcrumbs component for the CandidTax dashboard shell
 */
export default function Breadcrumbs({ className = '' }) {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter(Boolean);

  if (pathnames.length === 0 || (pathnames.length === 1 && pathnames[0] === 'dashboard')) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center text-xs text-slate-500 mb-4 ${className}`}>
      <ol className="flex items-center flex-wrap gap-1.5 list-none p-0 m-0">
        <li>
          <Link
            to="/dashboard"
            className="text-slate-400 hover:text-indigo-600 transition flex items-center gap-1 text-decoration-none"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Home</span>
          </Link>
        </li>

        {pathnames.map((segment, index) => {
          const routeTo = `/${pathnames.slice(0, index + 1).join('/')}`;
          const isLast = index === pathnames.length - 1;
          const label = PATH_TITLES[segment] || decodeURIComponent(segment);

          return (
            <li key={routeTo} className="flex items-center gap-1.5">
              <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
              {isLast ? (
                <span className="font-semibold text-slate-800" aria-current="page">
                  {label}
                </span>
              ) : (
                <Link
                  to={routeTo}
                  className="text-slate-500 hover:text-indigo-600 transition text-decoration-none"
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
