import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Menu,
  Plus,
  ChevronDown,
  FileText,
  Users,
  Package,
  ShoppingCart,
  LogOut,
  Settings,
  ShieldCheck,
  User,
  Crown
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import WorkspaceDropdown from '../WorkspaceDropdown';
import Button from '../ui/Button';

export default function Header({ onOpenSidebar }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const quickActionRef = useRef(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  // Close quick action & profile on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (quickActionRef.current && !quickActionRef.current.contains(event.target)) {
        setQuickActionOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const userName = user?.name || user?.email?.split('@')[0] || 'User';
  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <header className="h-14 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30 shadow-2xs">
      {/* Left Area: Mobile Menu + Workspace Switcher + Verified GSTIN */}
      <div className="flex items-center gap-3">
        {/* Mobile Toggle Button */}
        <button
          type="button"
          className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
          onClick={onOpenSidebar}
          aria-label="Open navigation sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Multi-Tenant Workspace Selector */}
        <WorkspaceDropdown />
      </div>

      {/* Right Area: Quick Action + User Profile */}
      <div className="flex items-center gap-3">
        {/* Quick Action Button (+ New) */}
        <div className="relative" ref={quickActionRef}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setQuickActionOpen(!quickActionOpen)}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            rightIcon={<ChevronDown className="w-3 h-3 opacity-70" />}
            title="Create new business record"
          >
            <span>New</span>
          </Button>

          {quickActionOpen && (
            <div
              className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-popover border border-slate-200/90 p-1 z-50 animate-in fade-in text-xs"
              role="menu"
            >
              <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100 mb-1">
                Quick Actions
              </div>
              <Link
                to="/sales/invoices"
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-slate-700 hover:text-indigo-600 hover:bg-indigo-50/50 transition font-medium text-decoration-none"
                onClick={() => setQuickActionOpen(false)}
              >
                <FileText className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                <span>New Invoice</span>
              </Link>
              <Link
                to="/customers"
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-slate-700 hover:text-indigo-600 hover:bg-indigo-50/50 transition font-medium text-decoration-none"
                onClick={() => setQuickActionOpen(false)}
              >
                <Users className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                <span>New Customer</span>
              </Link>
              <Link
                to="/items"
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-slate-700 hover:text-indigo-600 hover:bg-indigo-50/50 transition font-medium text-decoration-none"
                onClick={() => setQuickActionOpen(false)}
              >
                <Package className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                <span>New Item / HSN</span>
              </Link>
              <Link
                to="/purchases/bills"
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-slate-700 hover:text-indigo-600 hover:bg-indigo-50/50 transition font-medium text-decoration-none"
                onClick={() => setQuickActionOpen(false)}
              >
                <ShoppingCart className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                <span>New Bill</span>
              </Link>
            </div>
          )}
        </div>

        {/* CA / User Profile Avatar & Dropdown */}
        {/* Super Admin / Software Owner Quick Deck Link */}
        {user?.isSuperAdmin && (
          <Link
            to="/admin"
            className="flex items-center gap-1.5 py-1 px-2.5 rounded-xl bg-gradient-to-r from-amber-500/10 via-amber-500/20 to-orange-500/10 text-amber-900 border border-amber-300 font-extrabold text-[11px] shadow-2xs hover:bg-amber-100 transition"
            title="Open Software Owner / Super Admin Control Deck"
          >
            <Crown className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">Owner Admin</span>
          </Link>
        )}

        {/* Profile Popover Menu */}
        <div className="relative pl-2 border-l border-slate-200" ref={profileRef}>
          <button
            type="button"
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex items-center gap-2 py-1 px-2 rounded-xl hover:bg-slate-100 transition cursor-pointer border border-transparent hover:border-slate-200"
            title="View CA Profile & Managed Clients"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-700 via-indigo-600 to-indigo-500 text-white font-bold text-xs flex items-center justify-center shadow-xs border-2 border-white ring-1 ring-indigo-200 shrink-0">
              {userInitial}
            </div>
            <div className="hidden md:flex flex-col text-left leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-900 truncate max-w-[130px]">
                  {userName}
                </span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                    user?.isSuperAdmin
                      ? 'bg-amber-50 text-amber-800 border-amber-300'
                      : user?.workspaceRole === 'ACCOUNTANT'
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200/80'
                  }`}
                >
                  {user?.isSuperAdmin ? 'Owner' : user?.workspaceRole === 'ACCOUNTANT' ? 'Accountant' : 'CA / Pro'}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 truncate max-w-[140px]">
                {user?.email || 'Authenticated User'}
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block shrink-0" />
          </button>

          {profileOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-popover border border-slate-200/90 p-2 z-50 animate-in fade-in text-xs divide-y divide-slate-100">
              <div className="p-3">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-9 h-9 rounded-full bg-indigo-600 text-white font-bold text-sm flex items-center justify-center shrink-0">
                    {userInitial}
                  </div>
                  <div className="min-w-0">
                    <strong className="block text-xs font-bold text-slate-900 truncate">
                      {userName}
                    </strong>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {user?.email}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                    ✓ Verified Account
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-semibold">
                    {user?.workspaceRole || 'OWNER'}
                  </span>
                </div>
              </div>

              {/* Super Admin Quick Link */}
              {user?.isSuperAdmin && (
                <div className="p-1">
                  <Link
                    to="/admin"
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-amber-900 bg-amber-50/80 hover:bg-amber-100 transition font-bold"
                    onClick={() => setProfileOpen(false)}
                  >
                    <Crown className="w-4 h-4 text-amber-600" />
                    <span>Software Owner Admin Deck</span>
                  </Link>
                </div>
              )}

              <div className="p-2 space-y-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Active Client Managed:
                </div>
                <div className="px-2.5 py-2 bg-indigo-50/60 rounded-xl border border-indigo-100/90">
                  <span className="font-semibold text-slate-900 block truncate text-xs">
                    {user?.workspaceName || user?.currentWorkspace?.name || 'Active Client'}
                  </span>
                  <span className="font-mono text-[10px] text-indigo-700 font-semibold block mt-0.5">
                    {user?.gstin ? `GSTIN: ${user.gstin}` : 'No GSTIN Linked'}
                  </span>
                </div>
              </div>

              <div className="p-1 space-y-0.5">
                <Link
                  to="/settings"
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-slate-700 hover:bg-slate-50 hover:text-indigo-600 transition font-medium"
                  onClick={() => setProfileOpen(false)}
                >
                  <Settings className="w-4 h-4 text-slate-400" />
                  <span>Account & Client Settings</span>
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-rose-600 hover:bg-rose-50 transition cursor-pointer font-medium text-left"
                >
                  <LogOut className="w-4 h-4 text-rose-500" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
