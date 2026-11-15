import { Link } from 'react-router-dom';
import {
  FileText,
  Receipt,
  Inbox,
  Scale,
  RefreshCw,
  Plus,
  UploadCloud,
  Search,
  BarChart3,
  ArrowRight,
  ShieldAlert,
  Crown,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import useReturns from '../hooks/useReturns';
import { useAuth } from '../context/AuthContext';
import PeriodSelector from '../components/PeriodSelector';
import Loader from '../components/common/Loader';
import ErrorMessage from '../components/ErrorMessage';
import StatusBadge from '../components/common/StatusBadge';
import {
  PageHeader,
  MetricCard,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Button,
  Badge,
} from '../components/ui';
import { formatCurrency, formatDate } from '../utils/format';

export default function DashboardPage() {
  const { user } = useAuth();
  const {
    period,
    setPeriod,
    dashboardData,
    loading,
    error,
    refresh,
  } = useReturns();

  const billing = dashboardData?.billing || {};
  const totalSales = billing.totalSales || 0;
  const paidSales = billing.paidSales || 0;
  const pendingSales = billing.pendingSales || 0;
  const invoiceCount = billing.invoiceCount || 0;

  const totalPurchases = billing.totalPurchases || 0;
  const paidPurchases = billing.paidPurchases || 0;
  const pendingPurchases = billing.pendingPurchases || 0;
  const billCount = billing.billCount || 0;

  const salesReturnTax =
    (dashboardData?.sales?.cgst || 0) +
    (dashboardData?.sales?.sgst || 0) +
    (dashboardData?.sales?.igst || 0);
  const itcAvailable = dashboardData?.itc?.available || 0;
  const netTaxPayable =
    dashboardData?.taxPayable !== undefined
      ? dashboardData.taxPayable
      : Math.max(0, salesReturnTax - itcAvailable);

  const hasGstin = Boolean(user?.gstin || dashboardData?.gstin);
  const activeGstin = user?.gstin || dashboardData?.gstin || '';

  return (
    <div className="space-y-6">
      {/* Super Admin / Platform Owner Quick Navigation Banner */}
      {user?.isSuperAdmin && (
        <div className="rounded-2xl p-4 bg-gradient-to-r from-amber-500/10 via-amber-500/20 to-orange-500/10 border border-amber-300 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-amber-950 uppercase tracking-wider">Software Owner Mode</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200/60 text-amber-900 border border-amber-300">Super Admin</span>
              </div>
              <p className="text-[11px] text-amber-900/80 font-medium">
                You are logged in with a Platform Super Admin account. Manage all client organizations, subscriptions, payments & platform metrics.
              </p>
            </div>
          </div>
          <Link
            to="/admin"
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs shadow-md shadow-amber-900/20 transition-all hover:scale-[1.02]"
          >
            <span>Open Super Admin Deck</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}
      {/* ====================================================================
          STANDARDIZED PAGE HEADER & PERIOD SELECTION
          ==================================================================== */}
      <PageHeader
        title="Business Dashboard"
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              title="Refresh dashboard metrics"
            >
              Refresh
            </Button>
          </div>
        }
      />

      <ErrorMessage error={error} onRetry={refresh} />

      {/* GSTIN Link Banner for Non-Linked Accounts */}
      {!hasGstin && (
        <Card className="border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-indigo-50/40 to-white p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-900">
                  Operating in Billing & Invoicing Mode
                </h4>
                <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
                  You can create tax invoices, bills, and track customers. Connect your 15-digit GSTIN to auto-sync official GSTR-1, GSTR-2B, and GSTR-3B filings.
                </p>
              </div>
            </div>
            <Link to="/taxpayer-search">
              <Button variant="primary" size="sm" className="whitespace-nowrap">
                + Link GSTIN
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="py-16">
          <Loader message="Loading business metrics and return records..." />
        </div>
      ) : (
        <>
          {/* ====================================================================
              4 KEY BUSINESS & TAX METRIC CARDS (Ramp / Stripe Style)
              ==================================================================== */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Card 1: Total Sales Invoices */}
            <MetricCard
              title="Total Sales (Invoices)"
              value={formatCurrency(totalSales)}
              subvalue={
                <div className="flex justify-between items-center text-[11px] text-slate-500 mt-1">
                  <span>Collected: <strong className="text-emerald-700 font-mono">{formatCurrency(paidSales)}</strong></span>
                  <span>Due: <strong className="text-amber-700 font-mono">{formatCurrency(pendingSales)}</strong></span>
                </div>
              }
              icon={FileText}
              badge={<Badge status="PAID">{invoiceCount} Invoices</Badge>}
              description={
                totalSales > 0 ? (
                  <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
                    <div
                      className="bg-indigo-600 h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, (paidSales / totalSales) * 100)}%` }}
                    />
                  </div>
                ) : null
              }
            />

            {/* Card 2: Purchases & Expenses */}
            <MetricCard
              title="Purchases & Bills"
              value={formatCurrency(totalPurchases)}
              subvalue={
                <div className="flex justify-between items-center text-[11px] text-slate-500 mt-1">
                  <span>Paid: <strong className="text-emerald-700 font-mono">{formatCurrency(paidPurchases)}</strong></span>
                  <span>Payable: <strong className="text-rose-700 font-mono">{formatCurrency(pendingPurchases)}</strong></span>
                </div>
              }
              icon={Receipt}
              badge={<Badge status="SENT">{billCount} Bills</Badge>}
              description={
                totalPurchases > 0 ? (
                  <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
                    <div
                      className="bg-sky-500 h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, (paidPurchases / totalPurchases) * 100)}%` }}
                    />
                  </div>
                ) : null
              }
            />

            {/* Card 3: Eligible Input Tax Credit (ITC) */}
            <MetricCard
              title="Eligible ITC (GSTR-2B)"
              value={formatCurrency(itcAvailable)}
              subvalue="Auto-drafted purchase tax credits"
              icon={Inbox}
              badge={<Badge status="VERIFIED">Period {period}</Badge>}
              trend="View 2B"
              trendType="neutral"
              onClick={() => {}}
              description={
                <Link
                  to={`/returns?period=${period}&return=gstr2b`}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-decoration-none mt-1"
                >
                  <span>Reconcile ITC</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              }
            />

            {/* Card 4: Net GST Payable */}
            <MetricCard
              title="Net GST Payable"
              value={formatCurrency(netTaxPayable)}
              subvalue={`Output Tax: ${formatCurrency(salesReturnTax)}`}
              icon={Scale}
              badge={
                <Badge status={netTaxPayable > 0 ? 'OVERDUE' : 'PAID'}>
                  {netTaxPayable > 0 ? 'Tax Due' : 'Zero Liability'}
                </Badge>
              }
              description={
                <Link
                  to={`/returns?period=${period}&return=gstr3b`}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-decoration-none mt-1"
                >
                  <span>View GSTR-3B Tax Offset</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              }
            />
          </div>

          {/* ====================================================================
              QUICK ACTION LAUNCHPAD
              ==================================================================== */}
          <Card className="p-3.5 bg-slate-50/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center flex-wrap gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mr-1">
                  Quick Actions:
                </span>
                <Link to="/sales/invoices">
                  <Button variant="primary" size="xs" leftIcon={<Plus className="w-3 h-3" />}>
                    New Invoice
                  </Button>
                </Link>
                <Link to="/purchases/bills">
                  <Button variant="outline" size="xs" leftIcon={<Plus className="w-3 h-3" />}>
                    Record Bill
                  </Button>
                </Link>
                <Link to="/customers">
                  <Button variant="outline" size="xs" leftIcon={<Plus className="w-3 h-3" />}>
                    New Customer
                  </Button>
                </Link>
                <Link to="/excel-import">
                  <Button variant="outline" size="xs" leftIcon={<UploadCloud className="w-3 h-3" />}>
                    Excel Import
                  </Button>
                </Link>
              </div>

              <div className="flex items-center gap-2">
                <Link to="/taxpayer-search">
                  <Button variant="ghost" size="xs" leftIcon={<Search className="w-3 h-3" />}>
                    Verify GSTIN
                  </Button>
                </Link>
                <Link to="/reports">
                  <Button variant="ghost" size="xs" leftIcon={<BarChart3 className="w-3 h-3" />}>
                    Audit Reports
                  </Button>
                </Link>
              </div>
            </div>
          </Card>

          {/* ====================================================================
              TWO-COLUMN LAYOUT: RECENT INVOICES & STATUTORY RETURNS
              ==================================================================== */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Recent Sales Invoices */}
            <div className="lg:col-span-2">
              <Card className="overflow-hidden">
                <CardHeader>
                  <div>
                    <CardTitle>Recent Sales Invoices</CardTitle>
                    <CardDescription>
                      Latest generated invoices with GST breakdown
                    </CardDescription>
                  </div>
                  <Link
                    to="/sales/invoices"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition flex items-center gap-1 text-decoration-none"
                  >
                    <span>View All ({invoiceCount})</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </CardHeader>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                          Invoice #
                        </th>
                        <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                          Customer
                        </th>
                        <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                          Date
                        </th>
                        <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">
                          Amount
                        </th>
                        <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-center">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {billing.recentInvoices && billing.recentInvoices.length > 0 ? (
                        billing.recentInvoices.map((inv) => (
                          <tr key={inv._id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 font-mono font-medium text-indigo-600">
                              <Link
                                to={`/sales/invoices?id=${inv._id}`}
                                className="text-indigo-600 hover:underline"
                              >
                                {inv.invoiceNumber}
                              </Link>
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-900">
                              {inv.customerName}
                            </td>
                            <td className="py-3 px-4 text-slate-500">
                              {formatDate(inv.invoiceDate)}
                            </td>
                            <td className="py-3 px-4 font-mono font-semibold text-right tabular-nums text-slate-900">
                              {formatCurrency(inv.grandTotal)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <StatusBadge status={inv.status} size="xs" />
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-slate-400">
                            <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                            <p className="text-xs font-medium text-slate-600 mb-2">
                              No invoices created yet
                            </p>
                            <Link to="/sales/invoices">
                              <Button variant="primary" size="xs">
                                + Create your first invoice
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* Right 1 Col: GST Return Compliance Breakdown */}
            <div>
              <Card className="h-full flex flex-col justify-between">
                <div>
                  <CardHeader>
                    <div>
                      <CardTitle>GST Return Statements</CardTitle>
                      <CardDescription>
                        Statutory filings for Period {period}
                      </CardDescription>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    {/* GSTR-1 Outward Supplies */}
                    <div className="p-3.5 rounded-lg border border-slate-200/90 bg-slate-50/60 hover:bg-slate-50 hover:border-slate-300 transition">
                      <div className="flex items-center justify-between mb-1.5">
                        <strong className="text-xs font-semibold text-slate-900">
                          GSTR-1 (Outward Sales)
                        </strong>
                        <Badge status="PAID" size="xs">Sales</Badge>
                      </div>
                      <div className="text-xs text-slate-500 mb-2">
                        Taxable Turnover: <strong className="font-mono text-slate-800">{formatCurrency(dashboardData?.sales?.taxable || 0)}</strong>
                      </div>
                      <Link
                        to={`/returns?period=${period}&return=gstr1`}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-decoration-none"
                      >
                        <span>Inspect GSTR-1 Breakdown</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>

                    {/* GSTR-2B Inward Supplies */}
                    <div className="p-3.5 rounded-lg border border-slate-200/90 bg-slate-50/60 hover:bg-slate-50 hover:border-slate-300 transition">
                      <div className="flex items-center justify-between mb-1.5">
                        <strong className="text-xs font-semibold text-slate-900">
                          GSTR-2B (Inward ITC)
                        </strong>
                        <Badge status="SENT" size="xs">Input Credit</Badge>
                      </div>
                      <div className="text-xs text-slate-500 mb-2">
                        Eligible ITC: <strong className="font-mono text-slate-800">{formatCurrency(itcAvailable)}</strong>
                      </div>
                      <Link
                        to={`/returns?period=${period}&return=gstr2b`}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-decoration-none"
                      >
                        <span>Inspect GSTR-2B ITC Match</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>

                    {/* GSTR-3B Monthly Summary */}
                    <div className="p-3.5 rounded-lg border border-slate-200/90 bg-slate-50/60 hover:bg-slate-50 hover:border-slate-300 transition">
                      <div className="flex items-center justify-between mb-1.5">
                        <strong className="text-xs font-semibold text-slate-900">
                          GSTR-3B (Tax Summary)
                        </strong>
                        <Badge status="DRAFT" size="xs">Net Liability</Badge>
                      </div>
                      <div className="text-xs text-slate-500 mb-2">
                        Net Cash Due: <strong className="font-mono text-slate-800">{formatCurrency(netTaxPayable)}</strong>
                      </div>
                      <Link
                        to={`/returns?period=${period}&return=gstr3b`}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-decoration-none"
                      >
                        <span>Inspect GSTR-3B Tax Offset</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </CardContent>
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50/80 rounded-b-xl flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Active Period: {period}</span>
                  </span>
                  <Link
                    to="/returns"
                    className="font-semibold text-indigo-600 hover:text-indigo-800 text-decoration-none"
                  >
                    Launch Hub →
                  </Link>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
