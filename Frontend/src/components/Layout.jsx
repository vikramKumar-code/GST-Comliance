import { useState, useEffect, useCallback } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { checkBackendHealth } from '../api/health.api';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const [salesExpanded, setSalesExpanded] = useState(true);
  const [purchasesExpanded, setPurchasesExpanded] = useState(true);
  const [returnsExpanded, setReturnsExpanded] = useState(true);
  const [health, setHealth] = useState({ ok: null, status: 0, latency: null, checking: false });

  const runHealth = useCallback(async () => {
    setHealth((prev) => ({ ...prev, checking: true }));
    const res = await checkBackendHealth();
    setHealth({ ok: res.ok, status: res.status, latency: res.latency, checking: false });
  }, []);

  useEffect(() => {
    let isMounted = true;
    checkBackendHealth().then((res) => {
      if (isMounted) {
        setHealth({ ok: res.ok, status: res.status, latency: res.latency, checking: false });
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) setSidebarOpen(false);
    });
    return () => {
      isMounted = false;
    };
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="zoho-app-shell">
      {/* Sidebar Mobile Backdrop */}
      {sidebarOpen && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-50"
          style={{ zIndex: 1035 }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Zoho Books Style Left Sidebar */}
      <aside className={`zoho-sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* Brand Header */}
        <div className="zoho-sidebar-header">
          <Link to="/dashboard" className="text-decoration-none d-flex align-items-center gap-2">
            <span className="badge bg-primary fs-6 px-2 py-1 rounded-2">GST</span>
            <span className="fw-bold text-white fs-5 tracking-tight">CandidTax</span>
          </Link>
          <button
            type="button"
            className="btn btn-sm btn-link text-white-50 d-lg-none p-0"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        {/* Navigation Menu */}
        <div className="zoho-sidebar-nav">
          <NavLink
            to="/dashboard"
            className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
          >
            <span>📊</span>
            <span>Dashboard</span>
          </NavLink>

          <NavLink
            to="/taxpayer-search"
            className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
          >
            <span>🔍</span>
            <span>Taxpayer Search</span>
          </NavLink>

          <NavLink
            to="/customers"
            className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
          >
            <span>👥</span>
            <span>Customers</span>
          </NavLink>

          <NavLink
            to="/items"
            className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
          >
            <span>📦</span>
            <span>Items & Services</span>
          </NavLink>

          {/* Sales Group */}
          <div className="mt-2">
            <div
              className="zoho-nav-group-title d-flex justify-content-between align-items-center cursor-pointer"
              style={{ cursor: 'pointer' }}
              onClick={() => setSalesExpanded(!salesExpanded)}
            >
              <span>Sales</span>
              <span style={{ fontSize: '0.65rem' }}>{salesExpanded ? '▲' : '▼'}</span>
            </div>
            {salesExpanded && (
              <div className="ps-2">
                <NavLink
                  to="/sales/invoices"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span>📄</span>
                  <span>Invoices</span>
                </NavLink>
                <NavLink
                  to="/sales/credit-notes"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span>📝</span>
                  <span>Credit Notes</span>
                </NavLink>
              </div>
            )}
          </div>

          {/* Purchases Group */}
          <div className="mt-2">
            <div
              className="zoho-nav-group-title d-flex justify-content-between align-items-center cursor-pointer"
              style={{ cursor: 'pointer' }}
              onClick={() => setPurchasesExpanded(!purchasesExpanded)}
            >
              <span>Purchases</span>
              <span style={{ fontSize: '0.65rem' }}>{purchasesExpanded ? '▲' : '▼'}</span>
            </div>
            {purchasesExpanded && (
              <div className="ps-2">
                <NavLink
                  to="/purchases/bills"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span>🧾</span>
                  <span>Bills</span>
                </NavLink>
                <NavLink
                  to="/purchases/expenses"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span>💳</span>
                  <span>Expenses</span>
                </NavLink>
              </div>
            )}
          </div>

          {/* GST Returns Group */}
          <div className="mt-2">
            <div
              className="zoho-nav-group-title d-flex justify-content-between align-items-center cursor-pointer"
              style={{ cursor: 'pointer' }}
              onClick={() => setReturnsExpanded(!returnsExpanded)}
            >
              <span>GST Returns</span>
              <span style={{ fontSize: '0.65rem' }}>{returnsExpanded ? '▲' : '▼'}</span>
            </div>
            {returnsExpanded && (
              <div className="ps-2">
                <NavLink
                  to="/returns/gstr1"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span>📈</span>
                  <span>GSTR-1</span>
                </NavLink>
                <NavLink
                  to="/returns/gstr2b"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span>📥</span>
                  <span>GSTR-2B</span>
                </NavLink>
                <NavLink
                  to="/returns/gstr3b"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span>📊</span>
                  <span>GSTR-3B</span>
                </NavLink>
                <NavLink
                  to="/returns/summary"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span>📋</span>
                  <span>Return Summary</span>
                </NavLink>
                <NavLink
                  to="/returns/filing-history"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span>📜</span>
                  <span>Filing History</span>
                </NavLink>
              </div>
            )}
          </div>

          {/* Tools & Settings */}
          <div className="mt-2">
            <div className="zoho-nav-group-title">Analytics & Tools</div>
            <NavLink
              to="/excel-import"
              className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>📤</span>
              <span>Excel Import</span>
            </NavLink>
            <NavLink
              to="/reports"
              className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>📑</span>
              <span>Reports</span>
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>⚙️</span>
              <span>Settings</span>
            </NavLink>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="zoho-main-content">
        {/* Zoho Books Top Header Bar */}
        <header className="zoho-topbar">
          <div className="d-flex align-items-center gap-3">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary d-lg-none"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              ☰
            </button>
            <div className="d-flex align-items-center gap-2">
              <span className="badge bg-light text-secondary border px-2.5 py-1.5 font-monospace" style={{ fontSize: '0.8rem' }}>
                GSTIN: <span className="text-primary fw-bold">{user?.gstin || 'Taxpayer'}</span>
              </span>
            </div>
          </div>

          <div className="d-flex align-items-center gap-3">
            {/* Quick Action + New Dropdown */}
            <div className="dropdown position-relative">
              <button
                className="btn btn-primary btn-sm dropdown-toggle fw-semibold px-3"
                type="button"
                id="quickActionDropdown"
                onClick={() => setQuickActionOpen(!quickActionOpen)}
                aria-expanded={quickActionOpen}
              >
                + New
              </button>
              {quickActionOpen && (
                <ul className="dropdown-menu dropdown-menu-end shadow-sm show position-absolute end-0 mt-1" aria-labelledby="quickActionDropdown">
                  <li>
                    <Link
                      to="/sales/invoices?action=new"
                      className="dropdown-item py-1.5"
                      onClick={() => setQuickActionOpen(false)}
                    >
                      📄 New Invoice
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/purchases/bills?action=new"
                      className="dropdown-item py-1.5"
                      onClick={() => setQuickActionOpen(false)}
                    >
                      🧾 New Purchase Bill
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/customers?action=new"
                      className="dropdown-item py-1.5"
                      onClick={() => setQuickActionOpen(false)}
                    >
                      👥 New Customer
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/items?action=new"
                      className="dropdown-item py-1.5"
                      onClick={() => setQuickActionOpen(false)}
                    >
                      📦 New Item / Service
                    </Link>
                  </li>
                </ul>
              )}
            </div>

            {/* Health Status Indicator */}
            <button
              type="button"
              className="btn btn-sm btn-light border d-flex align-items-center gap-1.5 font-monospace py-1 px-2.5 rounded-pill"
              onClick={runHealth}
              disabled={health.checking}
              title="Backend API Connection"
              style={{ fontSize: '0.75rem' }}
            >
              <span
                className={`rounded-circle d-inline-block ${health.ok === true ? 'bg-success' : health.ok === false ? 'bg-danger' : 'bg-warning'
                  }`}
                style={{ width: '7px', height: '7px' }}
              />
              <span>{health.ok ? 'Online' : 'Checking'}</span>
            </button>

            {/* User Profile & Logout */}
            <div className="d-flex align-items-center gap-2 ps-2 border-start">
              <button
                type="button"
                onClick={handleLogout}
                className="btn btn-outline-danger btn-sm py-1 px-2.5 rounded-2"
                style={{ fontSize: '0.8rem' }}
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {/* Dynamic Page Views */}
        <main className="flex-grow-1">
          {children}
        </main>

        <footer className="bg-white border-top py-2.5 px-4 text-secondary small d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span className="text-muted">© {new Date().getFullYear()} CandidTax • GST Billing & Return Filing Edition</span>
          <div className="d-flex gap-3">
            <Link to="/privacy" className="text-secondary text-decoration-none">Privacy</Link>
            <Link to="/terms" className="text-secondary text-decoration-none">Terms</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
