import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Building2,
  Users,
  CreditCard,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Sparkles,
  DollarSign,
  TrendingUp,
  FileText,
  Lock,
  Unlock,
  Sliders,
  ChevronRight,
  Layers,
  Crown,
  Activity,
  Clock,
  Radio,
  FileCheck,
  Landmark,
  ArrowDownToLine,
  Receipt,
  Wallet,
  Banknote,
  ArrowUpRight,
  Eye,
  Copy,
  Check
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getAdminMetrics,
  getAdminWorkspaces,
  updateWorkspaceStatus,
  updateWorkspaceSubscription,
  impersonateWorkspace,
  getAdminUsers,
  updateUserStatus,
  getAdminActivities,
  getAdminFinancials,
  createAdminBankWithdrawal
} from '../api/admin.api';
import Button from '../components/ui/Button';

export default function SuperAdminPage() {
  const { user, switchActiveWorkspace, checkAuth } = useAuth();
  const [activeTab, setActiveTab] = useState('financials'); // 'financials' | 'workspaces' | 'users' | 'plans' | 'activities'
  const [metrics, setMetrics] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  // Financials & Razorpay state
  const [financials, setFinancials] = useState(null);
  const [loadingFinancials, setLoadingFinancials] = useState(false);
  const [searchPayment, setSearchPayment] = useState('');
  const [filterPaymentPlan, setFilterPaymentPlan] = useState('ALL');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('ALL');
  const [financialSubTab, setFinancialSubTab] = useState('users_breakdown'); // 'users_breakdown' | 'transactions' | 'settlements'
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawNotes, setWithdrawNotes] = useState('');
  const [processingWithdrawal, setProcessingWithdrawal] = useState(false);
  const [selectedUserLedger, setSelectedUserLedger] = useState(null);
  const [copiedText, setCopiedText] = useState(null);

  // Workspaces state
  const [workspaces, setWorkspaces] = useState([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [searchWorkspace, setSearchWorkspace] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterPlan, setFilterPlan] = useState('ALL');

  // Users state
  const [usersList, setUsersList] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchUser, setSearchUser] = useState('');

  // Activities state
  const [activities, setActivities] = useState([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [searchActivity, setSearchActivity] = useState('');
  const [filterActivityAction, setFilterActivityAction] = useState('ALL');

  // Selected workspace for plan update modal
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [newPlan, setNewPlan] = useState('PRO');
  const [extendDays, setExtendDays] = useState(30);
  const [updatingPlan, setUpdatingPlan] = useState(false);

  // Status toggle action loading
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [notification, setNotification] = useState(null);
  const [apiError, setApiError] = useState(null);

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const loadMetrics = async () => {
    setLoadingMetrics(true);
    setApiError(null);
    try {
      const res = await getAdminMetrics();
      if (res?.metrics) {
        setMetrics(res.metrics);
      }
    } catch (err) {
      console.error('Failed to load admin metrics:', err);
      setApiError(err.message || 'Failed to load platform metrics.');
    } finally {
      setLoadingMetrics(false);
    }
  };

  const loadWorkspaces = async () => {
    setLoadingWorkspaces(true);
    try {
      const params = {};
      if (filterStatus !== 'ALL') params.status = filterStatus;
      if (filterPlan !== 'ALL') params.plan = filterPlan;
      if (searchWorkspace.trim()) params.search = searchWorkspace.trim();

      const res = await getAdminWorkspaces(params);
      if (res?.workspaces) {
        setWorkspaces(res.workspaces);
      }
    } catch (err) {
      console.error('Failed to load workspaces:', err);
      setApiError(err.message || 'Failed to load client workspaces.');
    } finally {
      setLoadingWorkspaces(false);
    }
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const params = {};
      if (searchUser.trim()) params.search = searchUser.trim();
      const res = await getAdminUsers(params);
      if (res?.users) {
        setUsersList(res.users);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadActivities = async () => {
    setLoadingActivities(true);
    try {
      const params = {};
      if (searchActivity.trim()) params.search = searchActivity.trim();
      if (filterActivityAction !== 'ALL') params.action = filterActivityAction;
      const res = await getAdminActivities(params);
      if (res?.activities) {
        setActivities(res.activities);
      }
    } catch (err) {
      console.error('Failed to load activities:', err);
    } finally {
      setLoadingActivities(false);
    }
  };

  const loadFinancials = async () => {
    setLoadingFinancials(true);
    try {
      const params = {};
      if (searchPayment.trim()) params.search = searchPayment.trim();
      if (filterPaymentPlan !== 'ALL') params.plan = filterPaymentPlan;
      if (filterPaymentStatus !== 'ALL') params.status = filterPaymentStatus;
      const res = await getAdminFinancials(params);
      if (res?.success) {
        setFinancials(res);
      }
    } catch (err) {
      console.error('Failed to load financials:', err);
    } finally {
      setLoadingFinancials(false);
    }
  };

  const handleCopy = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label || text);
    setTimeout(() => setCopiedText(null), 2500);
  };

  const handleBankWithdrawal = async (e) => {
    e.preventDefault();
    const amountNum = parseFloat(withdrawAmount);
    if (!amountNum || amountNum <= 0) {
      showNotification('Please enter a valid amount to withdraw.', 'error');
      return;
    }
    setProcessingWithdrawal(true);
    try {
      const res = await createAdminBankWithdrawal({
        amount: amountNum,
        bankName: 'HDFC Bank Ltd',
        accountMasked: 'Current A/C Ending in **8492',
        notes: withdrawNotes || 'Software Owner Payout to Linked Business Account'
      });
      showNotification(res.message || `₹${amountNum.toLocaleString('en-IN')} successfully settled to bank!`);
      setShowWithdrawalModal(false);
      setWithdrawAmount('');
      setWithdrawNotes('');
      await loadFinancials();
      await loadMetrics();
    } catch (err) {
      showNotification(err.message || 'Bank withdrawal failed', 'error');
    } finally {
      setProcessingWithdrawal(false);
    }
  };

  useEffect(() => {
    loadMetrics();
    loadWorkspaces();
    loadFinancials();
  }, []);

  useEffect(() => {
    if (activeTab === 'users' && usersList.length === 0) {
      loadUsers();
    }
    if (activeTab === 'activities') {
      loadActivities();
    }
    if (activeTab === 'financials') {
      loadFinancials();
    }
  }, [activeTab]);

  const handleToggleWorkspaceStatus = async (ws) => {
    const newStatus = ws.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setActionLoadingId(ws._id);
    try {
      await updateWorkspaceStatus(
        ws._id,
        newStatus,
        newStatus === 'SUSPENDED' ? 'Blocked by Software Owner via Super Admin Portal' : 'Reactivated'
      );
      showNotification(`Workspace "${ws.name}" is now ${newStatus}`);
      await loadWorkspaces();
      await loadMetrics();
    } catch (err) {
      showNotification(err.message || 'Failed to update status', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleSaveSubscription = async (e) => {
    e.preventDefault();
    if (!selectedWorkspace) return;
    setUpdatingPlan(true);
    try {
      await updateWorkspaceSubscription(selectedWorkspace._id, {
        plan: newPlan,
        validDays: Number(extendDays),
        status: 'ACTIVE'
      });
      showNotification(`Plan updated to ${newPlan} for "${selectedWorkspace.name}"`);
      setSelectedWorkspace(null);
      await loadWorkspaces();
      await loadMetrics();
    } catch (err) {
      showNotification(err.message || 'Failed to update subscription', 'error');
    } finally {
      setUpdatingPlan(false);
    }
  };

  const handleImpersonate = async (ws) => {
    setActionLoadingId(ws._id);
    try {
      await impersonateWorkspace(ws._id);
      await switchActiveWorkspace(ws._id);
      await checkAuth();
      showNotification(`Switched session to ${ws.name}!`);
    } catch (err) {
      showNotification(err.message || 'Failed to switch workspace', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleUserStatus = async (u) => {
    const newStatus = u.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE';
    setActionLoadingId(u._id);
    try {
      await updateUserStatus(u._id, { status: newStatus });
      showNotification(`User account is now ${newStatus}`);
      await loadUsers();
      await loadMetrics();
    } catch (err) {
      showNotification(err.message || 'Failed to update user', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl border flex items-center gap-2.5 animate-in slide-in-from-top-2 text-xs font-bold ${
            notification.type === 'error'
              ? 'bg-rose-50 border-rose-300 text-rose-800'
              : 'bg-emerald-50 border-emerald-300 text-emerald-800'
          }`}
        >
          {notification.type === 'error' ? (
            <XCircle className="w-4 h-4 text-rose-600" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          )}
          <span>{notification.msg}</span>
        </div>
      )}

      {/* API Error Notice */}
      {apiError && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Platform Notice:</strong> {apiError}
            </span>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setApiError(null);
              loadMetrics();
              loadWorkspaces();
            }}
            className="border-amber-300 bg-white hover:bg-amber-100 text-amber-900 font-bold"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Super Admin Executive Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 sm:p-8 shadow-xl border border-indigo-900/60">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase bg-amber-400 text-amber-950 flex items-center gap-1 shadow-xs">
                <Crown className="w-3.5 h-3.5" />
                Software Owner / God Mode
              </span>
              <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Platform Active
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              SaaS Control Deck & Revenue Hub
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              Global administration for all Chartered Accountants, client businesses, subscription access tiers, and platform revenue metrics.
            </p>
          </div>

          {/* Quick Stats Pill */}
          <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md border border-white/10 p-3.5 rounded-2xl shrink-0">
            <div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-indigo-200">
                Projected MRR
              </div>
              <div className="text-2xl font-black text-white">
                {metrics?.subscriptions?.formattedMrr || '₹0'}
              </div>
              <div className="text-[10px] text-emerald-300 font-semibold mt-0.5">
                ARR: {metrics?.subscriptions?.formattedArr || '₹0'} / yr
              </div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-indigo-500/30 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        </div>
      </div>

      {/* KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-md transition">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Total CAs & Users
            </span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            {loadingMetrics ? '...' : metrics?.totalUsers || 0}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Active platform accounts</p>
        </div>

        {/* Metric 2 */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-md transition">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Client Workspaces
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <span>{loadingMetrics ? '...' : metrics?.totalWorkspaces || 0}</span>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              {metrics?.activeWorkspaces || 0} Active
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {metrics?.suspendedWorkspaces || 0} Suspended / Blocked
          </p>
        </div>

        {/* Metric 3 */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-md transition">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Paid Subscriptions
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <span>
              {loadingMetrics
                ? '...'
                : (metrics?.subscriptions?.pro || 0) + (metrics?.subscriptions?.enterprise || 0)}
            </span>
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              Pro & Enterprise
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {metrics?.subscriptions?.free || 0} Free Community Workspaces
          </p>
        </div>

        {/* Metric 4 */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-md transition">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              System Invoices
            </span>
            <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            {loadingMetrics ? '...' : metrics?.totalInvoices || 0}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Invoices processed across all tenants</p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('financials')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'financials'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4 text-amber-300" />
          <span>Payments & Bank Settlements (Razorpay)</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-extrabold border border-emerald-400/30">
            {financials?.summary?.formattedGrossRevenue || 'Live'}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('workspaces')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'workspaces'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Client & CA Workspaces ({workspaces.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'users'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Registered CAs & Users</span>
        </button>

        <button
          onClick={() => setActiveTab('plans')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'plans'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Subscription Tiers & Gating</span>
        </button>

        <button
          onClick={() => setActiveTab('activities')}
          className={`py-2 px-4 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeTab === 'activities'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>Live User Activities</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
        </button>
      </div>

      {/* Tab: Razorpay Financials, User Plan Analytics & Bank Settlements */}
      {activeTab === 'financials' && (
        <div className="space-y-6">
          {/* Financial KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Received */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 text-white border border-indigo-800 shadow-md relative overflow-hidden">
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider">
                    Total Payment Received
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/30 border border-indigo-400/30 flex items-center justify-center text-indigo-200">
                    <CreditCard className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-3xl font-black text-white">
                  {loadingFinancials ? '...' : financials?.summary?.formattedGrossRevenue || '₹0'}
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-300 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Gross GMV across all subscription plans</span>
                </div>
              </div>
            </div>

            {/* Card 2: Bank Settled / Withdrawn */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-md transition">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Withdrawn / Settled to Bank
                </span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Landmark className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900">
                {loadingFinancials ? '...' : financials?.summary?.formattedBankWithdrawn || '₹0'}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-emerald-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Deposited into HDFC Bank A/C **8492</span>
              </div>
            </div>

            {/* Card 3: Gateway Fees & GST */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-md transition">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Razorpay Commission & GST
                </span>
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Banknote className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900">
                {loadingFinancials ? '...' : financials?.summary?.formattedGatewayFees || '₹0'}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                2% Gateway Fee + 18% GST auto-deducted
              </p>
            </div>

            {/* Card 4: Pending Gateway Balance */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-md transition">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Pending Gateway Balance
                </span>
                <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                  <Wallet className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900">
                {loadingFinancials ? '...' : financials?.summary?.formattedPendingBalance || '₹0'}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Rolling balance in transit (T+2 Batch settlement)
              </p>
            </div>
          </div>

          {/* Controls & Sub-tabs */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="p-4 bg-slate-50/80 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
              {/* Sub-tab pills */}
              <div className="flex items-center gap-1.5 bg-slate-200/70 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setFinancialSubTab('users_breakdown')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    financialSubTab === 'users_breakdown'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  👥 User Plan Purchases ({financials?.userPurchaseAnalytics?.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setFinancialSubTab('transactions')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    financialSubTab === 'transactions'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  💳 Razorpay Ledger ({financials?.transactions?.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setFinancialSubTab('settlements')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    financialSubTab === 'settlements'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  🏦 Bank Withdrawals ({financials?.bankSettlements?.length || 0})
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadFinancials}
                  disabled={loadingFinancials}
                  className="flex items-center gap-1.5 text-xs font-semibold"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingFinancials ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setShowWithdrawalModal(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 text-xs font-bold"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  <span>Withdraw to Bank</span>
                </Button>
              </div>
            </div>

            {/* Sub-Tab 1: Users Purchase Breakdown */}
            {financialSubTab === 'users_breakdown' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600 border-collapse">
                  <thead className="bg-slate-50/75 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">CA / User Details</th>
                      <th className="py-3 px-4">Workspace / Firm</th>
                      <th className="py-3 px-4">Current Plan</th>
                      <th className="py-3 px-4">Times Purchased</th>
                      <th className="py-3 px-4">Total Amount Paid</th>
                      <th className="py-3 px-4">Latest Payment</th>
                      <th className="py-3 px-4">Payment Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {financials?.userPurchaseAnalytics?.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400">
                          No user purchases found.
                        </td>
                      </tr>
                    ) : (
                      financials?.userPurchaseAnalytics?.map((u) => (
                        <tr key={u.userEmail} className="hover:bg-slate-50/70 transition">
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900">{u.userName || 'CA Taxpayer'}</div>
                            <div className="text-[11px] text-slate-400">{u.userEmail}</div>
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-800">
                            {u.workspaceName || 'Primary Workspace'}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                u.lastPlan === 'ENTERPRISE'
                                  ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                  : u.lastPlan === 'PRO'
                                  ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                  : 'bg-slate-100 text-slate-800'
                              }`}
                            >
                              {u.lastPlan || 'PRO'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                              {u.timesPurchased}x {u.timesPurchased > 1 ? 'Purchases' : 'Purchase'}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-black text-slate-900">
                            ₹{u.totalSpent ? u.totalSpent.toLocaleString('en-IN') : '0'}
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-slate-800 font-medium">
                              {u.lastPaymentDate ? new Date(u.lastPaymentDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                            </div>
                            <div className="text-[10px] text-slate-400">Via {u.lastPaymentMethod || 'UPI'}</div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              SUCCESS
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => {
                                const userTxs = financials?.transactions?.filter((t) => t.userEmail === u.userEmail) || [];
                                setSelectedUserLedger({ ...u, txs: userTxs });
                              }}
                              className="text-indigo-600 border-indigo-200 hover:bg-indigo-50 font-bold"
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              Ledger ({u.timesPurchased})
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub-Tab 2: Razorpay Transactions Ledger */}
            {financialSubTab === 'transactions' && (
              <div className="space-y-4 p-4">
                {/* Search & Filter */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-md">
                    <div className="relative w-full">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchPayment}
                        onChange={(e) => setSearchPayment(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && loadFinancials()}
                        placeholder="Search by receipt, user, payment ID, order ID..."
                        className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10"
                      />
                    </div>
                    <Button size="sm" variant="outline" onClick={loadFinancials}>
                      Filter
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={filterPaymentPlan}
                      onChange={(e) => {
                        setFilterPaymentPlan(e.target.value);
                        setTimeout(loadFinancials, 0);
                      }}
                      className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 bg-white font-medium text-slate-700"
                    >
                      <option value="ALL">All Plans</option>
                      <option value="PRO">Pro Tier</option>
                      <option value="ENTERPRISE">Enterprise</option>
                    </select>

                    <select
                      value={filterPaymentStatus}
                      onChange={(e) => {
                        setFilterPaymentStatus(e.target.value);
                        setTimeout(loadFinancials, 0);
                      }}
                      className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 bg-white font-medium text-slate-700"
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="SUCCESS">Success Only</option>
                      <option value="PENDING">Pending Only</option>
                      <option value="FAILED">Failed Only</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs text-slate-600 border-collapse">
                    <thead className="bg-slate-50 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4">Receipt / Invoice #</th>
                        <th className="py-3 px-4">Razorpay IDs</th>
                        <th className="py-3 px-4">Payer / User</th>
                        <th className="py-3 px-4">Plan & Cycle</th>
                        <th className="py-3 px-4">Amount</th>
                        <th className="py-3 px-4">Payment Mode</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Bank Settlement</th>
                        <th className="py-3 px-4">Date & Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {financials?.transactions?.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-12 text-center text-slate-400">
                            No payment transactions recorded yet.
                          </td>
                        </tr>
                      ) : (
                        financials?.transactions?.map((tx) => (
                          <tr key={tx._id} className="hover:bg-slate-50/70 transition">
                            <td className="py-3 px-4">
                              <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                                {tx.receiptNumber || `INV-${tx._id.slice(-6)}`}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-900">
                                <span>{tx.razorpayPaymentId}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(tx.razorpayPaymentId, 'Payment ID copied')}
                                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                                  title="Copy Razorpay Payment ID"
                                >
                                  {copiedText === tx.razorpayPaymentId ? (
                                    <Check className="w-3 h-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                Order: {tx.razorpayOrderId}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-bold text-slate-900">{tx.userName || 'User'}</div>
                              <div className="text-[11px] text-slate-400">{tx.userEmail}</div>
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-bold text-slate-800">{tx.planId}</span>
                              <span className="text-[10px] text-slate-400 block">{tx.billingCycle}</span>
                            </td>
                            <td className="py-3 px-4 font-black text-slate-900">
                              ₹{tx.amount.toLocaleString('en-IN')}
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                {tx.paymentMethod || 'UPI'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                {tx.status}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                <Landmark className="w-3 h-3" />
                                <span>₹{tx.bankSettlement?.netWithdrawnToBank ? Math.round(tx.bankSettlement.netWithdrawnToBank).toLocaleString('en-IN') : tx.amount}</span>
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                UTR: {tx.bankSettlement?.utr || 'Auto-Settled'}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-[11px] text-slate-500">
                              {new Date(tx.createdAt).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Sub-Tab 3: Bank Withdrawals & Settlements */}
            {financialSubTab === 'settlements' && (
              <div className="p-4 space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-bold text-slate-900">Linked Company Payout Bank Account</div>
                    <div className="text-slate-500">HDFC Bank Ltd • Current Account Ending in **8492 • IFSC: HDFC0000240</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-[10px] uppercase font-bold text-slate-400">Total Settled</div>
                      <div className="text-lg font-black text-emerald-700">
                        {financials?.summary?.formattedBankWithdrawn || '₹0'}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => setShowWithdrawalModal(true)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    >
                      <ArrowDownToLine className="w-3.5 h-3.5 mr-1" />
                      New Withdrawal
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs text-slate-600 border-collapse">
                    <thead className="bg-slate-50 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4">Settlement Batch ID</th>
                        <th className="py-3 px-4">Bank UTR Number</th>
                        <th className="py-3 px-4">Deposited Account</th>
                        <th className="py-3 px-4">Gross Collected</th>
                        <th className="py-3 px-4">Gateway Fees</th>
                        <th className="py-3 px-4">Net Deposited</th>
                        <th className="py-3 px-4">Settlement Date</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {financials?.bankSettlements?.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-slate-400">
                            No bank settlement records yet.
                          </td>
                        </tr>
                      ) : (
                        financials?.bankSettlements?.map((st) => (
                          <tr key={st._id} className="hover:bg-slate-50/70 transition">
                            <td className="py-3 px-4 font-mono font-bold text-slate-900">
                              {st.settlementId}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5 font-mono text-[11px] text-indigo-700 font-bold">
                                <span>{st.utr}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(st.utr, 'UTR copied')}
                                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                                  title="Copy UTR"
                                >
                                  {copiedText === st.utr ? (
                                    <Check className="w-3 h-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-900">{st.bankName || 'HDFC Bank Ltd'}</div>
                              <div className="text-[10px] text-slate-400">{st.accountMasked}</div>
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-800">
                              ₹{st.grossAmount ? st.grossAmount.toLocaleString('en-IN') : '0'}
                            </td>
                            <td className="py-3 px-4 text-amber-700">
                              -₹{st.gatewayFees ? (st.gatewayFees + (st.taxOnFees || 0)).toLocaleString('en-IN') : '0'}
                            </td>
                            <td className="py-3 px-4 font-black text-emerald-700">
                              ₹{st.netAmount ? st.netAmount.toLocaleString('en-IN') : '0'}
                            </td>
                            <td className="py-3 px-4 text-slate-500 text-[11px]">
                              {new Date(st.settledAt).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </td>
                            <td className="py-3 px-4">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                {st.status || 'SETTLED'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 1: Workspaces Management */}
      {activeTab === 'workspaces' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
          {/* Filters Bar */}
          <div className="p-4 bg-slate-50/80 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-md">
              <div className="relative w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchWorkspace}
                  onChange={(e) => setSearchWorkspace(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadWorkspaces()}
                  placeholder="Search workspace by name or GSTIN..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10"
                />
              </div>
              <Button size="sm" variant="outline" onClick={loadWorkspaces}>
                Filter
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  setTimeout(loadWorkspaces, 0);
                }}
                className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 bg-white font-medium text-slate-700"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active Only</option>
                <option value="SUSPENDED">Suspended Only</option>
              </select>

              <select
                value={filterPlan}
                onChange={(e) => {
                  setFilterPlan(e.target.value);
                  setTimeout(loadWorkspaces, 0);
                }}
                className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 bg-white font-medium text-slate-700"
              >
                <option value="ALL">All Plans</option>
                <option value="FREE">Free Tier</option>
                <option value="PRO">Pro Tier</option>
                <option value="ENTERPRISE">Enterprise</option>
              </select>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearchWorkspace('');
                  setFilterStatus('ALL');
                  setFilterPlan('ALL');
                  loadWorkspaces();
                }}
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingWorkspaces ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <th className="py-3 px-4">Business / Organization</th>
                  <th className="py-3 px-4">GSTIN & Verification</th>
                  <th className="py-3 px-4">Owner / CA</th>
                  <th className="py-3 px-4">Subscription Plan</th>
                  <th className="py-3 px-4">Invoices</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Owner Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingWorkspaces ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600" />
                      Loading workspaces...
                    </td>
                  </tr>
                ) : workspaces.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      No workspaces found matching filters.
                    </td>
                  </tr>
                ) : (
                  workspaces.map((ws) => (
                    <tr
                      key={ws._id}
                      className={`hover:bg-slate-50/80 transition ${
                        ws.status === 'SUSPENDED' ? 'bg-rose-50/30' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{ws.name}</div>
                        <div className="text-[10px] text-slate-400">
                          ID: {String(ws._id).slice(-8)}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono font-medium">
                        {ws.gstin ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-700">{ws.gstin}</span>
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                              ✓ Live
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Unlinked</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-800">
                          {ws.ownerUserId?.name || 'Assigned CA'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {ws.ownerUserId?.email || 'N/A'}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] border ${
                            ws.subscription?.plan === 'ENTERPRISE'
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : ws.subscription?.plan === 'PRO'
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {ws.subscription?.plan === 'ENTERPRISE' && (
                            <Sparkles className="w-2.5 h-2.5" />
                          )}
                          <span>{ws.subscription?.plan || 'FREE'}</span>
                        </span>
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          {ws.subscription?.validUntil
                            ? `Valid: ${new Date(ws.subscription.validUntil).toLocaleDateString()}`
                            : 'Active'}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-slate-700">
                        {ws.invoiceCount || 0}
                      </td>

                      <td className="py-3.5 px-4">
                        {ws.status === 'ACTIVE' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                            <span>Suspended</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* 1-Click Block / Unblock Button */}
                          <Button
                            size="xs"
                            variant={ws.status === 'ACTIVE' ? 'danger' : 'outline'}
                            onClick={() => handleToggleWorkspaceStatus(ws)}
                            disabled={actionLoadingId === ws._id}
                            title={ws.status === 'ACTIVE' ? 'Block Workspace' : 'Activate Workspace'}
                            className="font-bold text-[10px] px-2 py-1"
                          >
                            {ws.status === 'ACTIVE' ? (
                              <>
                                <Lock className="w-3 h-3 mr-1" /> Block
                              </>
                            ) : (
                              <>
                                <Unlock className="w-3 h-3 mr-1" /> Unblock
                              </>
                            )}
                          </Button>

                          {/* Upgrade / Plan Button */}
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => {
                              setSelectedWorkspace(ws);
                              setNewPlan(ws.subscription?.plan || 'PRO');
                            }}
                            className="text-[10px] px-2 py-1 font-semibold"
                            title="Manage Plan & Limits"
                          >
                            <Sliders className="w-3 h-3 mr-1" /> Plan
                          </Button>

                          {/* Switch Session */}
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => handleImpersonate(ws)}
                            disabled={actionLoadingId === ws._id}
                            title="Switch into workspace"
                            className="text-[10px] px-1.5 py-1 text-slate-500 hover:text-indigo-600"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Users & CAs Governance */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
          <div className="p-4 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="relative w-full max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadUsers()}
                placeholder="Search user by name, email, or mobile..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10"
              />
            </div>
            <Button size="sm" variant="outline" onClick={loadUsers}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingUsers ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <th className="py-3 px-4">User / CA</th>
                  <th className="py-3 px-4">Auth Provider</th>
                  <th className="py-3 px-4">System Role</th>
                  <th className="py-3 px-4">Workspaces Managed</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingUsers ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600" />
                      Loading users...
                    </td>
                  </tr>
                ) : usersList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  usersList.map((u) => (
                    <tr key={u._id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{u.name || 'User'}</div>
                        <div className="text-[10px] text-slate-400">{u.email || u.mobile || 'N/A'}</div>
                      </td>

                      <td className="py-3 px-4 font-mono text-slate-600">
                        {u.authProvider || 'LOCAL'}
                      </td>

                      <td className="py-3 px-4">
                        {u.systemRole === 'SUPER_ADMIN' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-300">
                            <Crown className="w-2.5 h-2.5" /> Super Admin
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            Standard CA / User
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 font-bold text-slate-800">
                        {u.workspaceCount || 0}
                      </td>

                      <td className="py-3 px-4">
                        {u.status === 'ACTIVE' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            ● Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                            ● Blocked
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <Button
                          size="xs"
                          variant={u.status === 'ACTIVE' ? 'danger' : 'outline'}
                          onClick={() => handleToggleUserStatus(u)}
                          disabled={actionLoadingId === u._id}
                          className="text-[10px] px-2 py-1"
                        >
                          {u.status === 'ACTIVE' ? 'Block Account' : 'Unblock Account'}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Subscription Plans & Gating Matrix */}
      {activeTab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Plan 1: Free */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                COMMUNITY
              </span>
              <span className="text-xl font-black text-slate-900">₹0</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Free Tier</h3>
              <p className="text-xs text-slate-500 mt-0.5">Basic access for small single taxpayers</p>
            </div>
            <ul className="space-y-2 text-xs text-slate-600 border-t border-slate-100 pt-4">
              <li className="flex items-center gap-2">✓ 1 Workspace / GSTIN</li>
              <li className="flex items-center gap-2">✓ Up to 50 Invoices / Month</li>
              <li className="flex items-center gap-2">✓ Manual Return Viewing</li>
              <li className="flex items-center gap-2 text-slate-400">✗ Automated 2B Reconciliation</li>
              <li className="flex items-center gap-2 text-slate-400">✗ Multi-Tenant CA Switcher</li>
            </ul>
          </div>

          {/* Plan 2: Pro */}
          <div className="p-6 rounded-2xl bg-gradient-to-b from-indigo-50/50 to-white border-2 border-indigo-500 shadow-md space-y-4 relative">
            <div className="absolute -top-3 right-4 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white shadow-xs">
              MOST POPULAR
            </div>
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">
                CA PRO
              </span>
              <span className="text-xl font-black text-slate-900">₹1,499<span className="text-xs font-normal text-slate-500">/mo</span></span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">CA Professional</h3>
              <p className="text-xs text-slate-500 mt-0.5">Designed for Chartered Accountants & Tax Firms</p>
            </div>
            <ul className="space-y-2 text-xs text-slate-700 border-t border-indigo-100 pt-4">
              <li className="flex items-center gap-2 font-semibold">✓ Up to 10 Client Workspaces</li>
              <li className="flex items-center gap-2 font-semibold">✓ 1,000 Invoices / Month</li>
              <li className="flex items-center gap-2 font-semibold">✓ Automated GSTR-2B Reconciliation</li>
              <li className="flex items-center gap-2 font-semibold">✓ E-Invoice & E-Way Bill Generation</li>
              <li className="flex items-center gap-2 font-semibold">✓ Multi-Client Switcher & Verification</li>
            </ul>
          </div>

          {/* Plan 3: Enterprise */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                ENTERPRISE
              </span>
              <span className="text-xl font-black text-slate-900">₹4,999<span className="text-xs font-normal text-slate-500">/mo</span></span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Large CA Firm / Corporate</h3>
              <p className="text-xs text-slate-500 mt-0.5">Unlimited clients and automated compliance</p>
            </div>
            <ul className="space-y-2 text-xs text-slate-600 border-t border-slate-100 pt-4">
              <li className="flex items-center gap-2">✓ Unlimited Client Workspaces</li>
              <li className="flex items-center gap-2">✓ Unlimited Invoices & Billing</li>
              <li className="flex items-center gap-2">✓ Direct GST Portal Automated Filing</li>
              <li className="flex items-center gap-2">✓ Team Roles (CA, Accountant, Staff)</li>
              <li className="flex items-center gap-2">✓ Priority SLA & Phone Support</li>
            </ul>
          </div>
        </div>
      )}

      {/* Tab 4: Live User & System Activity Stream */}
      {activeTab === 'activities' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
          {/* Header & Filter Controls */}
          <div className="p-4 bg-slate-50/80 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-md">
              <div className="relative w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchActivity}
                  onChange={(e) => setSearchActivity(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadActivities()}
                  placeholder="Filter by user, action, GSTIN, or invoice details..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10"
                />
              </div>
              <Button size="sm" variant="outline" onClick={loadActivities}>
                Filter
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filterActivityAction}
                onChange={(e) => {
                  setFilterActivityAction(e.target.value);
                  setTimeout(loadActivities, 0);
                }}
                className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 bg-white font-medium text-slate-700"
              >
                <option value="ALL">All Event Types</option>
                <option value="INVOICE_CREATE">Sales Invoices</option>
                <option value="GSTR1_FILE">GSTR-1 Filings</option>
                <option value="NIL_FILE">Nil Return Filings</option>
                <option value="USER_SIGNIN">User Logins</option>
                <option value="USER_SIGNUP">New Signups</option>
                <option value="CREATE_WORKSPACE">Client Workspaces Added</option>
                <option value="LINK_GSTIN">GSTINs Linked</option>
                <option value="ADMIN_SUSPEND_WORKSPACE">Workspaces Blocked</option>
              </select>

              <Button size="sm" variant="outline" onClick={loadActivities} title="Refresh Live Stream">
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingActivities ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </Button>
            </div>
          </div>

          {/* Activities Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <th className="py-3 px-4">Event Type</th>
                  <th className="py-3 px-4">User / CA</th>
                  <th className="py-3 px-4">Workspace / GSTIN</th>
                  <th className="py-3 px-4">Activity Details</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingActivities ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
                      Loading live activity stream...
                    </td>
                  </tr>
                ) : activities.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <Activity className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                      No activity logs match your filter criteria.
                    </td>
                  </tr>
                ) : (
                  activities.map((act) => {
                    const getBadge = (a) => {
                      if (a === 'INVOICE_CREATE')
                        return { label: 'Invoice Created', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: FileText };
                      if (a === 'GSTR1_FILE' || a === 'NIL_FILE')
                        return { label: 'Return Filed', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: FileCheck };
                      if (a === 'USER_SIGNIN' || a === 'USER_SIGNUP')
                        return { label: 'Authentication', color: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: Users };
                      if (a === 'CREATE_WORKSPACE' || a === 'LINK_GSTIN')
                        return { label: 'Client Workspace', color: 'bg-purple-50 text-purple-700 border-purple-200', icon: Building2 };
                      if (a === 'ADMIN_SUSPEND_WORKSPACE')
                        return { label: 'Workspace Blocked', color: 'bg-rose-50 text-rose-700 border-rose-200', icon: Lock };
                      if (a === 'ADMIN_ACTIVATE_WORKSPACE')
                        return { label: 'Workspace Activated', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: Unlock };
                      return { label: a, color: 'bg-slate-100 text-slate-700 border-slate-200', icon: Activity };
                    };

                    const badge = getBadge(act.action);
                    const IconComponent = badge.icon;

                    return (
                      <tr key={act._id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${badge.color}`}
                          >
                            <IconComponent className="w-3 h-3" />
                            <span>{badge.label}</span>
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">
                            {act.userName || act.userId?.name || 'Taxpayer / CA'}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {act.userEmail || act.userId?.email || 'N/A'}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-800">
                            {act.workspaceId?.name || (act.gstin ? `GSTIN: ${act.gstin}` : 'Platform Level')}
                          </div>
                          {act.gstin && (
                            <div className="text-[10px] font-mono text-slate-500">
                              {act.gstin}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 max-w-xs">
                          <div className="text-slate-700 font-medium truncate" title={act.details || act.action}>
                            {act.details || (act.period ? `Return Period: ${act.period}` : act.action)}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          {act.status === 'SUCCESS' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              ✓ Success
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                              ✕ Failed
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="text-slate-800 font-medium">
                            {new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {new Date(act.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Plan Update Modal */}
      {selectedWorkspace && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600" />
                <span>Adjust Subscription Tier</span>
              </h3>
              <button
                type="button"
                onClick={() => setSelectedWorkspace(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div>
              <div className="text-xs font-bold text-slate-800">{selectedWorkspace.name}</div>
              <div className="text-[11px] font-mono text-slate-500">
                GSTIN: {selectedWorkspace.gstin || 'Unlinked'}
              </div>
            </div>

            <form onSubmit={handleSaveSubscription} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Select Subscription Plan Tier:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['FREE', 'PRO', 'ENTERPRISE'].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNewPlan(p)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition ${
                        newPlan === p
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-500/10'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Extend Validity By (Days):
                </label>
                <select
                  value={extendDays}
                  onChange={(e) => setExtendDays(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                >
                  <option value={30}>+30 Days (1 Month)</option>
                  <option value={90}>+90 Days (Quarterly)</option>
                  <option value={180}>+180 Days (Half-Yearly)</option>
                  <option value={365}>+365 Days (1 Full Year)</option>
                </select>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedWorkspace(null)}
                  className="w-1/2"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  className="w-1/2 bg-indigo-600 hover:bg-indigo-700"
                  disabled={updatingPlan}
                  isLoading={updatingPlan}
                >
                  Save & Apply
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Bank Withdrawal & Payout */}
      {showWithdrawalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Landmark className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900">
                    Withdraw Revenue to Bank
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Direct Razorpay payout to linked current account
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowWithdrawalModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleBankWithdrawal} className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">
                  Destination Bank Account
                </div>
                <div className="font-bold text-slate-900">HDFC Bank Ltd</div>
                <div className="text-slate-500 text-[11px]">Current A/C Ending in **8492 • IFSC: HDFC0000240</div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Withdrawal Amount (₹):
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="e.g. 5000"
                    className="w-full pl-8 pr-3 py-2 text-sm font-bold rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/10"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Available Total Collected: {financials?.summary?.formattedGrossRevenue || '₹0'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Payout Note / Reference:
                </label>
                <input
                  type="text"
                  value={withdrawNotes}
                  onChange={(e) => setWithdrawNotes(e.target.value)}
                  placeholder="e.g. SaaS Subscription Payout - Nov 2026"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowWithdrawalModal(false)}
                  className="w-1/2"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  className="w-1/2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  disabled={processingWithdrawal}
                  isLoading={processingWithdrawal}
                >
                  Confirm Payout ➔
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Selected User Payment Ledger Drawer */}
      {selectedUserLedger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900">
                    Payment Ledger: {selectedUserLedger.userName || selectedUserLedger.userEmail}
                  </h3>
                  <div className="text-[11px] text-slate-400 flex items-center gap-2">
                    <span>{selectedUserLedger.userEmail}</span>
                    <span>•</span>
                    <span className="font-bold text-indigo-700">
                      Total {selectedUserLedger.timesPurchased} {selectedUserLedger.timesPurchased > 1 ? 'Purchases' : 'Purchase'}
                    </span>
                    <span>•</span>
                    <span className="font-black text-slate-900">
                      ₹{selectedUserLedger.totalSpent?.toLocaleString('en-IN') || 0}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserLedger(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto flex-1 border rounded-xl divide-y divide-slate-100">
              {selectedUserLedger.txs?.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  No individual transactions found for this user.
                </div>
              ) : (
                selectedUserLedger.txs?.map((tx) => (
                  <div key={tx._id} className="p-3.5 hover:bg-slate-50/70 transition flex items-center justify-between text-xs gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded text-[11px]">
                          {tx.receiptNumber || 'INV-RECEIPT'}
                        </span>
                        <span className="font-bold text-slate-900">
                          {tx.planName || tx.planId} ({tx.billingCycle})
                        </span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          {tx.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Payment: {tx.razorpayPaymentId} • Mode: {tx.paymentMethod || 'UPI'} • {new Date(tx.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                      {tx.bankSettlement?.utr && (
                        <div className="text-[10px] text-emerald-700 font-mono">
                          Bank Settled: ₹{tx.bankSettlement.netWithdrawnToBank} • UTR: {tx.bankSettlement.utr}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-black text-base text-slate-900">
                        ₹{tx.amount?.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 mt-2 border-t border-slate-100 flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedUserLedger(null)}
              >
                Close Ledger
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
