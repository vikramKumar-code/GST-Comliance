import { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Briefcase,
  Search,
  Users,
  Package,
  Receipt,
  ShoppingCart,
  Landmark,
  UploadCloud,
  BarChart3,
  Sparkles,
  Settings,
  ChevronDown,
  ChevronRight,
  X,
  ShieldCheck,
  ChevronLeft,
  Crown,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../common/StatusBadge';
import Tooltip from '../ui/Tooltip';

export default function Sidebar({ isOpen, onClose }) {
  const { user } = useAuth();
  const location = useLocation();

  const [salesExpanded, setSalesExpanded] = useState(true);
  const [purchasesExpanded, setPurchasesExpanded] = useState(true);
  const [returnsExpanded, setReturnsExpanded] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    onClose?.();
  }, [location.pathname, onClose]);

  const role = user?.workspaceRole || 'MEMBER';
  const userName = user?.name || user?.email?.split('@')[0] || 'Taxpayer';
  const userInitial = userName.charAt(0).toUpperCase();

  const navLinkClasses = ({ isActive }) =>
    `group relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 select-none ${
      isActive
        ? 'bg-indigo-600/15 text-white font-semibold shadow-2xs'
        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
    } ${isCollapsed ? 'justify-center px-2' : ''}`;

  const subNavLinkClasses = ({ isActive }) =>
    `block py-1.5 px-2.5 rounded-md text-xs transition-colors duration-150 select-none ${
      isActive
        ? 'bg-indigo-500/20 text-indigo-300 font-semibold'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
    }`;

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs lg:hidden transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Main Sidebar Shell */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 bg-slate-950 border-r border-slate-800/80 flex flex-col transition-all duration-200 select-none lg:sticky lg:top-0 lg:h-screen lg:shrink-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${isCollapsed ? 'w-18' : 'w-64'}`}
      >
        {/* Brand Header */}
        <div className="h-14 px-4 border-b border-slate-800/80 flex items-center justify-between shrink-0">
          <Link
            to="/dashboard"
            className="flex items-center gap-2.5 text-decoration-none group overflow-hidden"
            title="Go to CandidTax Dashboard"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white font-bold text-xs shadow-xs border border-indigo-400/30 shrink-0">
              CT
            </div>
            {!isCollapsed && (
              <div className="flex flex-col leading-tight overflow-hidden">
                <span className="font-bold text-white text-sm tracking-tight group-hover:text-indigo-300 transition-colors">
                  CandidTax
                </span>
                <span className="text-[10px] text-slate-400 font-medium tracking-wide">
                  Enterprise GST
                </span>
              </div>
            )}
          </Link>

          {/* Desktop Collapse Toggle */}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label="Toggle sidebar width"
          >
            <ChevronLeft
              className={`w-4 h-4 transition-transform duration-200 ${
                isCollapsed ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Mobile Close Button */}
          <button
            type="button"
            className="lg:hidden p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Navigation */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5 scrollbar-thin scrollbar-thumb-slate-800">
          {/* SECTION: OVERVIEW */}
          <div>
            {!isCollapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-slate-500">
                Overview
              </div>
            )}
            <div className="space-y-1">
              <Tooltip content={isCollapsed ? 'Dashboard' : null} position="right">
                <NavLink to="/dashboard" className={navLinkClasses}>
                  <LayoutDashboard className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-white" />
                  {!isCollapsed && <span>Dashboard</span>}
                </NavLink>
              </Tooltip>

              <Tooltip content={isCollapsed ? 'CFO Executive Summary' : null} position="right">
                <NavLink to="/cfo" className={navLinkClasses}>
                  <Briefcase className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-white" />
                  {!isCollapsed && <span>CFO Summary</span>}
                </NavLink>
              </Tooltip>

              <Tooltip content={isCollapsed ? 'Taxpayer Search' : null} position="right">
                <NavLink to="/taxpayer-search" className={navLinkClasses}>
                  <Search className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-white" />
                  {!isCollapsed && <span>Taxpayer Search</span>}
                </NavLink>
              </Tooltip>
            </div>
          </div>

          {/* SECTION: BUSINESS */}
          <div>
            {!isCollapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-slate-500">
                Business
              </div>
            )}
            <div className="space-y-1">
              <Tooltip content={isCollapsed ? 'Customers' : null} position="right">
                <NavLink to="/customers" className={navLinkClasses}>
                  <Users className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-white" />
                  {!isCollapsed && <span>Customers</span>}
                </NavLink>
              </Tooltip>

              <Tooltip content={isCollapsed ? 'Items & HSN' : null} position="right">
                <NavLink to="/items" className={navLinkClasses}>
                  <Package className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-white" />
                  {!isCollapsed && <span>Items & HSN</span>}
                </NavLink>
              </Tooltip>

              {/* Sales Sub-group */}
              {!isCollapsed ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setSalesExpanded(!salesExpanded)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2.5">
                      <Receipt className="w-4 h-4 text-slate-400" />
                      <span>Sales</span>
                    </div>
                    {salesExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </button>

                  {salesExpanded && (
                    <div className="ml-7 mt-1 pl-2.5 border-l border-slate-800 space-y-1">
                      <NavLink to="/sales/invoices" className={subNavLinkClasses}>
                        Invoices
                      </NavLink>
                      <NavLink to="/sales/credit-notes" className={subNavLinkClasses}>
                        Credit Notes
                      </NavLink>
                    </div>
                  )}
                </div>
              ) : (
                <Tooltip content="Sales Invoices" position="right">
                  <NavLink to="/sales/invoices" className={navLinkClasses}>
                    <Receipt className="w-4 h-4 shrink-0" />
                  </NavLink>
                </Tooltip>
              )}

              {/* Purchases Sub-group */}
              {!isCollapsed ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setPurchasesExpanded(!purchasesExpanded)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2.5">
                      <ShoppingCart className="w-4 h-4 text-slate-400" />
                      <span>Purchases</span>
                    </div>
                    {purchasesExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </button>

                  {purchasesExpanded && (
                    <div className="ml-7 mt-1 pl-2.5 border-l border-slate-800 space-y-1">
                      <NavLink to="/purchases/bills" className={subNavLinkClasses}>
                        Bills
                      </NavLink>
                      <NavLink to="/purchases/expenses" className={subNavLinkClasses}>
                        Expenses
                      </NavLink>
                    </div>
                  )}
                </div>
              ) : (
                <Tooltip content="Purchase Bills" position="right">
                  <NavLink to="/purchases/bills" className={navLinkClasses}>
                    <ShoppingCart className="w-4 h-4 shrink-0" />
                  </NavLink>
                </Tooltip>
              )}
            </div>
          </div>

          {/* SECTION: GST COMPLIANCE */}
          <div>
            {!isCollapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-slate-500">
                GST Compliance
              </div>
            )}
            <div className="space-y-1">
              {!isCollapsed ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setReturnsExpanded(!returnsExpanded)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2.5">
                      <Landmark className="w-4 h-4 text-slate-400" />
                      <span>GST Returns</span>
                    </div>
                    {returnsExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </button>

                  {returnsExpanded && (
                    <div className="ml-7 mt-1 pl-2.5 border-l border-slate-800 space-y-1">
                      <NavLink to="/returns" end className={subNavLinkClasses}>
                        Return Hub
                      </NavLink>
                      <NavLink to="/returns/summary" className={subNavLinkClasses}>
                        Annual Summary
                      </NavLink>
                      <NavLink to="/returns/filing-history" className={subNavLinkClasses}>
                        Filing History
                      </NavLink>
                    </div>
                  )}
                </div>
              ) : (
                <Tooltip content="GST Return Hub" position="right">
                  <NavLink to="/returns" className={navLinkClasses}>
                    <Landmark className="w-4 h-4 shrink-0" />
                  </NavLink>
                </Tooltip>
              )}
            </div>
          </div>

          {/* SECTION: DATA & TOOLS */}
          <div>
            {!isCollapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-slate-500">
                Data & Reports
              </div>
            )}
            <div className="space-y-1">
              <Tooltip content={isCollapsed ? 'Excel Import' : null} position="right">
                <NavLink to="/excel-import" className={navLinkClasses}>
                  <UploadCloud className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-white" />
                  {!isCollapsed && <span>Excel Import</span>}
                </NavLink>
              </Tooltip>

              <Tooltip content={isCollapsed ? 'Reports & Registers' : null} position="right">
                <NavLink to="/reports" className={navLinkClasses}>
                  <BarChart3 className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-white" />
                  {!isCollapsed && <span>Reports & Registers</span>}
                </NavLink>
              </Tooltip>
            </div>
          </div>

          {/* SECTION: PLATFORM OWNER (SUPER ADMIN) */}
          {user?.isSuperAdmin && (
            <div>
              {!isCollapsed && (
                <div className="px-2 mb-1.5 text-[10px] font-extrabold tracking-wider uppercase text-amber-400 flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                  <span>Platform Owner</span>
                </div>
              )}
              <div className="space-y-1">
                <Tooltip content={isCollapsed ? 'SaaS Control Deck' : null} position="right">
                  <NavLink
                    to="/admin"
                    className={({ isActive }) =>
                      `group relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all duration-150 select-none ${
                        isActive
                          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 shadow-xs'
                          : 'text-amber-200/80 hover:text-amber-100 hover:bg-amber-500/10'
                      } ${isCollapsed ? 'justify-center px-2' : ''}`
                    }
                  >
                    <Crown className="w-4 h-4 shrink-0 text-amber-400" />
                    {!isCollapsed && <span>SaaS Control Deck</span>}
                  </NavLink>
                </Tooltip>
              </div>
            </div>
          )}

          {/* SECTION: WORKSPACE / SETTINGS */}
          <div>
            {!isCollapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-slate-500">
                Workspace
              </div>
            )}
            <div className="space-y-1">
              <Tooltip content={isCollapsed ? 'Plans & Billing' : null} position="right">
                <NavLink to="/pricing" className={navLinkClasses}>
                  <Sparkles className="w-4 h-4 shrink-0 text-amber-400" />
                  {!isCollapsed && <span>Plans & Billing</span>}
                </NavLink>
              </Tooltip>

              <Tooltip content={isCollapsed ? 'Settings' : null} position="right">
                <NavLink to="/settings" className={navLinkClasses}>
                  <Settings className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-white" />
                  {!isCollapsed && <span>Settings</span>}
                </NavLink>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Bottom Workspace & User Card */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/80 shrink-0">
          <div
            className={`flex items-center gap-2.5 p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 ${
              isCollapsed ? 'justify-center' : ''
            }`}
          >
            <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-xs">
              {userInitial}
            </div>

            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-200 truncate">
                  {userName}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <StatusBadge status={role} size="xs" />
                  {user?.gstin && (
                    <span className="text-[10px] font-mono text-slate-400 truncate">
                      {user.gstin.slice(0, 7)}...
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
