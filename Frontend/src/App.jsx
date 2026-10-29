import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import OtpPage from './pages/OtpPage';
import DashboardPage from './pages/DashboardPage';
import TaxpayerSearchPage from './pages/TaxpayerSearchPage';
import CustomersPage from './pages/CustomersPage';
import ItemsPage from './pages/ItemsPage';
import InvoicesPage from './pages/InvoicesPage';
import CreditNotesPage from './pages/CreditNotesPage';
import BillsPage from './pages/BillsPage';
import ExpensesPage from './pages/ExpensesPage';
import ReturnDetailPage from './pages/ReturnDetailPage';
import ReturnSummaryPage from './pages/ReturnSummaryPage';
import FilingHistoryPage from './pages/FilingHistoryPage';
import ExcelImportPage from './pages/ExcelImportPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import PricingPage from './pages/PricingPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
          {/* Public Landing & Marketing */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/register" element={<SignupPage />} />
          <Route path="/otp" element={<OtpPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />

          {/* Protected Business & Compliance Routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Layout>
                  <DashboardPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/taxpayer-search"
            element={
              <ProtectedRoute>
                <Layout>
                  <TaxpayerSearchPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/customers"
            element={
              <ProtectedRoute>
                <Layout>
                  <CustomersPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/items"
            element={
              <ProtectedRoute>
                <Layout>
                  <ItemsPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Sales Routes */}
          <Route
            path="/sales/invoices"
            element={
              <ProtectedRoute>
                <Layout>
                  <InvoicesPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/sales/credit-notes"
            element={
              <ProtectedRoute>
                <Layout>
                  <CreditNotesPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Purchases Routes */}
          <Route
            path="/purchases/bills"
            element={
              <ProtectedRoute>
                <Layout>
                  <BillsPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/purchases/expenses"
            element={
              <ProtectedRoute>
                <Layout>
                  <ExpensesPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* GST Returns Routes */}
          <Route
            path="/returns/summary"
            element={
              <ProtectedRoute>
                <Layout>
                  <ReturnSummaryPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/returns/filing-history"
            element={
              <ProtectedRoute>
                <Layout>
                  <FilingHistoryPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/returns/:type"
            element={
              <ProtectedRoute>
                <Layout>
                  <ReturnDetailPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Tools & Analytics */}
          <Route
            path="/excel-import"
            element={
              <ProtectedRoute>
                <Layout>
                  <ExcelImportPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <Layout>
                  <ReportsPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Layout>
                  <SettingsPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/pricing"
            element={
              <ProtectedRoute>
                <Layout>
                  <PricingPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Backward Compatibility Redirects */}
          <Route path="/invoices" element={<Navigate to="/sales/invoices" replace />} />
          <Route path="/bills" element={<Navigate to="/purchases/bills" replace />} />

          {/* 404 Catch-All */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </ErrorBoundary>
  );
}
