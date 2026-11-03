import { lazy } from 'react';
import { Navigate } from 'react-router-dom';

// Public Marketing & Legal Pages (Lazy loaded)
const LandingPage = lazy(() => import('../../pages/LandingPage'));
const LoginPage = lazy(() => import('../../pages/LoginPage'));
const SignupPage = lazy(() => import('../../pages/SignupPage'));
const OtpPage = lazy(() => import('../../pages/OtpPage'));
const PrivacyPage = lazy(() => import('../../pages/PrivacyPage'));
const TermsPage = lazy(() => import('../../pages/TermsPage'));

// Protected Business & Compliance Pages (Lazy loaded)
const DashboardPage = lazy(() => import('../../pages/DashboardPage'));
const CfoDashboardPage = lazy(() => import('../../pages/CfoDashboardPage'));
const TaxpayerSearchPage = lazy(() => import('../../pages/TaxpayerSearchPage'));
const CustomersPage = lazy(() => import('../../pages/CustomersPage'));
const ItemsPage = lazy(() => import('../../pages/ItemsPage'));
const InvoicesPage = lazy(() => import('../../pages/InvoicesPage'));
const CreditNotesPage = lazy(() => import('../../pages/CreditNotesPage'));
const BillsPage = lazy(() => import('../../pages/BillsPage'));
const ExpensesPage = lazy(() => import('../../pages/ExpensesPage'));
const GstReturnHubPage = lazy(() => import('../../pages/GstReturnHubPage'));
const ReturnSummaryPage = lazy(() => import('../../pages/ReturnSummaryPage'));
const FilingHistoryPage = lazy(() => import('../../pages/FilingHistoryPage'));
const ReturnDetailPage = lazy(() => import('../../pages/ReturnDetailPage'));
const ExcelImportPage = lazy(() => import('../../pages/ExcelImportPage'));
const ReportsPage = lazy(() => import('../../pages/ReportsPage'));
const SettingsPage = lazy(() => import('../../pages/SettingsPage'));
const PricingPage = lazy(() => import('../../pages/PricingPage'));
const SuperAdminPage = lazy(() => import('../../pages/SuperAdminPage'));
const NotFoundPage = lazy(() => import('../../pages/NotFoundPage'));

/**
 * Declarative route configuration for CandidTax
 */
export const publicRoutes = [
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/register', element: <SignupPage /> },
  { path: '/otp', element: <OtpPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/terms', element: <TermsPage /> },
];

export const protectedRoutes = [
  // Dashboard & Executive Views
  { path: '/dashboard', element: <DashboardPage /> },
  { path: '/cfo', element: <CfoDashboardPage /> },

  // Super Admin / Software Owner Platform Deck
  { path: '/admin', element: <SuperAdminPage /> },
  { path: '/super-admin', element: <SuperAdminPage /> },

  // Master Data
  { path: '/taxpayer-search', element: <TaxpayerSearchPage /> },
  { path: '/customers', element: <CustomersPage /> },
  { path: '/items', element: <ItemsPage /> },

  // Sales
  { path: '/sales/invoices', element: <InvoicesPage /> },
  { path: '/sales/credit-notes', element: <CreditNotesPage /> },

  // Purchases
  { path: '/purchases/bills', element: <BillsPage /> },
  { path: '/purchases/expenses', element: <ExpensesPage /> },

  // GST Return Main Hub (Blueprint 3-Phase Workflow)
  { path: '/returns', element: <GstReturnHubPage /> },
  { path: '/returns/summary', element: <ReturnSummaryPage /> },
  { path: '/returns/filing-history', element: <FilingHistoryPage /> },
  { path: '/returns/gstr1', element: <GstReturnHubPage /> },
  { path: '/returns/gstr1/prepare', element: <GstReturnHubPage /> },
  { path: '/returns/:type', element: <ReturnDetailPage /> },

  // Ingestion, Reports & Management
  { path: '/excel-import', element: <ExcelImportPage /> },
  { path: '/reports', element: <ReportsPage /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/pricing', element: <PricingPage /> },
];

export const redirectRoutes = [
  { path: '/invoices', to: '/sales/invoices' },
  { path: '/bills', to: '/purchases/bills' },
  { path: '/superadmin', to: '/admin' },
];

export const fallbackRoute = { path: '*', element: <NotFoundPage /> };
