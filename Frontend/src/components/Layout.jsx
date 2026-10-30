import { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { checkBackendHealth } from '../api/health.api';
import WorkspaceDropdown from './WorkspaceDropdown';

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
  const quickActionRef = useRef(null);

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

  // Close quick action on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (quickActionRef.current && !quickActionRef.current.contains(event.target)) {
        setQuickActionOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const userName = user?.name || user?.email?.split('@')[0] || 'User';
  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <div className="zoho-app-shell">
      {/* Sidebar Mobile Backdrop */}
      {sidebarOpen && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-50"
          style={{ zIndex: 1035, backdropFilter: 'blur(2px)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Enterprise Left Sidebar */}
      <aside className={`zoho-sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* Brand Header */}
        <div className="zoho-sidebar-header">
          <Link to="/dashboard" className="text-decoration-none d-flex align-items-center gap-2.5" title="Go to CandidTax Dashboard">
            <span
              className="d-flex align-items-center justify-content-center text-white fw-bold rounded-2 shadow-xs"
              style={{
                width: '32px',
                height: '32px',
                background: 'linear-gradient(135deg, #10b981 0%, #0d6e59 100%)',
                fontSize: '0.9rem'
              }}
            >
              CT
            </span>
            <div className="d-flex flex-column" style={{ lineHeight: 1.15 }}>
              <span className="fw-bold text-white fs-6 tracking-tight">CandidTax</span>
              <span className="text-muted" style={{ fontSize: '0.65rem' }}>Enterprise Edition</span>
            </div>
          </Link>
          <button
            type="button"
            className="btn btn-sm btn-link text-white-50 d-lg-none p-0 text-decoration-none"
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
            <span style={{ fontSize: '1.05rem' }}>📊</span>
            <span>Dashboard</span>
          </NavLink>

          <NavLink
            to="/taxpayer-search"
            className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
          >
            <span style={{ fontSize: '1.05rem' }}>🔍</span>
            <span>Taxpayer Search</span>
          </NavLink>

          <NavLink
            to="/customers"
            className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
          >
            <span style={{ fontSize: '1.05rem' }}>👥</span>
            <span>Customers</span>
          </NavLink>

          <NavLink
            to="/items"
            className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
          >
            <span style={{ fontSize: '1.05rem' }}>📦</span>
            <span>Items & Services</span>
          </NavLink>

          {/* Sales Group */}
          <div className="mt-2.5">
            <div
              className="zoho-nav-group-title"
              style={{ cursor: 'pointer' }}
              onClick={() => setSalesExpanded(!salesExpanded)}
            >
              <span>Sales</span>
              <span style={{ fontSize: '0.65rem', transition: 'transform 0.2s' }}>
                {salesExpanded ? '▾' : '▸'}
              </span>
            </div>
            {salesExpanded && (
              <div className="ps-2">
                <NavLink
                  to="/sales/invoices"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span style={{ fontSize: '0.95rem' }}>📄</span>
                  <span>Invoices</span>
                </NavLink>
                <NavLink
                  to="/sales/credit-notes"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span style={{ fontSize: '0.95rem' }}>📝</span>
                  <span>Credit Notes</span>
                </NavLink>
              </div>
            )}
          </div>

          {/* Purchases Group */}
          <div className="mt-2.5">
            <div
              className="zoho-nav-group-title"
              style={{ cursor: 'pointer' }}
              onClick={() => setPurchasesExpanded(!purchasesExpanded)}
            >
              <span>Purchases</span>
              <span style={{ fontSize: '0.65rem', transition: 'transform 0.2s' }}>
                {purchasesExpanded ? '▾' : '▸'}
              </span>
            </div>
            {purchasesExpanded && (
              <div className="ps-2">
                <NavLink
                  to="/purchases/bills"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span style={{ fontSize: '0.95rem' }}>🧾</span>
                  <span>Bills</span>
                </NavLink>
                <NavLink
                  to="/purchases/expenses"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span style={{ fontSize: '0.95rem' }}>💳</span>
                  <span>Expenses</span>
                </NavLink>
              </div>
            )}
          </div>

          {/* GST Returns Group */}
          <div className="mt-2.5">
            <div
              className="zoho-nav-group-title"
              style={{ cursor: 'pointer' }}
              onClick={() => setReturnsExpanded(!returnsExpanded)}
            >
              <span>GST Returns</span>
              <span style={{ fontSize: '0.65rem', transition: 'transform 0.2s' }}>
                {returnsExpanded ? '▾' : '▸'}
              </span>
            </div>
            {returnsExpanded && (
              <div className="ps-2">
                <NavLink
                  to="/returns/gstr1"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span style={{ fontSize: '0.95rem' }}>📈</span>
                  <span>GSTR-1</span>
                </NavLink>
                <NavLink
                  to="/returns/gstr2b"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span style={{ fontSize: '0.95rem' }}>📥</span>
                  <span>GSTR-2B</span>
                </NavLink>
                <NavLink
                  to="/returns/gstr3b"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span style={{ fontSize: '0.95rem' }}>📊</span>
                  <span>GSTR-3B</span>
                </NavLink>
                <NavLink
                  to="/returns/summary"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span style={{ fontSize: '0.95rem' }}>📋</span>
                  <span>Return Summary</span>
                </NavLink>
                <NavLink
                  to="/returns/filing-history"
                  className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
                >
                  <span style={{ fontSize: '0.95rem' }}>📜</span>
                  <span>Filing History</span>
                </NavLink>
              </div>
            )}
          </div>

          {/* Analytics & Tools */}
          <div className="mt-2.5">
            <div className="zoho-nav-group-title">Analytics & Tools</div>
            <NavLink
              to="/excel-import"
              className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
            >
              <span style={{ fontSize: '0.95rem' }}>📤</span>
              <span>Excel Import</span>
            </NavLink>
            <NavLink
              to="/reports"
              className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
            >
              <span style={{ fontSize: '0.95rem' }}>📑</span>
              <span>Reports</span>
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
            >
              <span style={{ fontSize: '0.95rem' }}>⚙️</span>
              <span>Settings</span>
            </NavLink>
            <NavLink
              to="/pricing"
              className={({ isActive }) => `zoho-nav-link ${isActive ? 'active' : ''}`}
            >
              <span style={{ fontSize: '0.95rem' }}>💎</span>
              <span className="d-flex align-items-center justify-content-between w-100">
                <span>Plans & Billing</span>
                <span className="badge bg-warning text-dark font-monospace" style={{ fontSize: '0.62rem' }}>PRO</span>
              </span>
            </NavLink>
          </div>

          {/* External Public Portal Link */}
          <div className="pt-3 mt-3 border-top" style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}>
            <Link
              to="/"
              className="zoho-nav-link text-white-50 small"
              title="Open CandidTax Public Landing Page"
            >
              <span style={{ fontSize: '0.9rem' }}>🌐</span>
              <span style={{ fontSize: '0.78rem' }}>Public Website ↗</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div className="zoho-main-content">
        {/* Top Header Bar */}
        <header className="zoho-topbar">
          <div className="d-flex align-items-center gap-2.5">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary d-lg-none py-1 px-2.5"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              ☰
            </button>
            <WorkspaceDropdown />
          </div>

          <div className="d-flex align-items-center gap-3 gap-lg-3.5">
            <Link
              to="/pricing"
              className="ct-topbar-upgrade-btn d-none d-sm-inline-flex"
              title="View Subscription & Upgrade Plan"
            >
              <span className="star-icon">⭐</span>
              <span>Upgrade Plan</span>
            </Link>

            {/* Quick Action + New */}
            <div className="position-relative" ref={quickActionRef}>
              <button
                className="ct-topbar-new-btn"
                type="button"
                id="quickActionDropdown"
                onClick={() => setQuickActionOpen(!quickActionOpen)}
                aria-expanded={quickActionOpen}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>New</span>
                <span className="chevron-icon" style={{ transform: quickActionOpen ? 'rotate(180deg)' : 'none' }}>▼</span>
              </button>
              {quickActionOpen && (
                <ul
                  className="dropdown-menu dropdown-menu-end shadow-lg show position-absolute end-0 mt-2 py-1.5 rounded-3 border"
                  style={{ minWidth: '200px', zIndex: 1050, borderColor: '#e2e8f0' }}
                  aria-labelledby="quickActionDropdown"
                >
                  <li>
                    <Link
                      to="/sales/invoices?action=new"
                      className="dropdown-item py-2 px-3 small d-flex align-items-center gap-2.5"
                      onClick={() => setQuickActionOpen(false)}
                    >
                      <span style={{ fontSize: '1.05rem' }}>📄</span>
                      <span className="fw-medium">New Invoice</span>
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/purchases/bills?action=new"
                      className="dropdown-item py-2 px-3 small d-flex align-items-center gap-2.5"
                      onClick={() => setQuickActionOpen(false)}
                    >
                      <span style={{ fontSize: '1.05rem' }}>🧾</span>
                      <span className="fw-medium">New Purchase Bill</span>
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/customers?action=new"
                      className="dropdown-item py-2 px-3 small d-flex align-items-center gap-2.5"
                      onClick={() => setQuickActionOpen(false)}
                    >
                      <span style={{ fontSize: '1.05rem' }}>👥</span>
                      <span className="fw-medium">New Customer</span>
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/items?action=new"
                      className="dropdown-item py-2 px-3 small d-flex align-items-center gap-2.5"
                      onClick={() => setQuickActionOpen(false)}
                    >
                      <span style={{ fontSize: '1.05rem' }}>📦</span>
                      <span className="fw-medium">New Item / Service</span>
                    </Link>
                  </li>
                </ul>
              )}
            </div>

            {/* Health Status Indicator */}
            <button
              type="button"
              className="ct-topbar-health-btn"
              onClick={runHealth}
              disabled={health.checking}
              title={`Backend Connection: ${health.ok ? 'Online' : 'Checking'}${health.latency ? ` (${health.latency}ms)` : ''}`}
            >
              <span
                className={`rounded-circle d-inline-block ${
                  health.ok === true ? 'bg-success' : health.ok === false ? 'bg-danger' : 'bg-warning'
                }`}
                style={{ width: '8px', height: '8px' }}
              />
              <span className="fw-medium d-none d-sm-inline">{health.ok ? 'Online' : 'Checking'}</span>
            </button>

            {/* User Profile & Logout */}
            <div className="d-flex align-items-center gap-2.5 ps-3 ms-1 border-start" style={{ borderColor: '#e2e8f0' }}>
              <div
                className="ct-topbar-user-capsule"
                title={user?.email || userName}
              >
                <span className="ct-topbar-user-avatar">
                  {userInitial}
                </span>
                <span className="ct-topbar-user-name d-none d-md-inline">
                  {userName}
                </span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="ct-topbar-logout-btn"
                title="Sign out of CandidTax"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="flex-grow-1">
          {children}
        </main>

        <footer className="bg-white border-top py-3 px-4 text-secondary small d-flex justify-content-between align-items-center flex-wrap gap-2" style={{ borderColor: '#e2e8f0' }}>
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>
            © {new Date().getFullYear()} CandidTax • GST Billing & Compliance Platform
          </span>
          <div className="d-flex gap-3" style={{ fontSize: '0.8rem' }}>
            <Link to="/privacy" className="text-secondary text-decoration-none">Privacy</Link>
            <Link to="/terms" className="text-secondary text-decoration-none">Terms</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
