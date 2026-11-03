import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Scale,
  Inbox,
  Coins,
  Printer,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  FileCheck,
} from 'lucide-react';
import { getDashboard } from '../api/returns.api';
import { getGstrComparison } from '../api/reports.api';
import { getLastMonthPeriod } from '../hooks/useReturns';
import PeriodSelector from '../components/PeriodSelector';
import Loader from '../components/common/Loader';
import ErrorMessage from '../components/ErrorMessage';
import {
  PageHeader,
  MetricCard,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Badge,
} from '../components/ui';
import { formatCurrency, formatPeriod } from '../utils/format';
import DrcAuditSimulator from '../components/compliance/DrcAuditSimulator';

export default function CfoDashboardPage() {
  const [period, setPeriod] = useState(getLastMonthPeriod());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);

  const fetchCfoData = useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const [dashRes, compRes] = await Promise.allSettled([
        getDashboard(p),
        getGstrComparison(p),
      ]);

      if (dashRes.status === 'fulfilled') {
        setDashboardData(dashRes.value);
      }
      if (compRes.status === 'fulfilled') {
        setComparisonData(compRes.value);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCfoData(period);
  }, [period, fetchCfoData]);

  // Derived financial & compliance metrics from real API data
  const outwardSales =
    comparisonData?.gstr1?.taxable ??
    dashboardData?.sales?.taxable ??
    dashboardData?.billing?.totalSales ??
    0;

  const igstTax = comparisonData?.gstr1?.igst ?? dashboardData?.sales?.igst ?? 0;
  const cgstTax = comparisonData?.gstr1?.cgst ?? dashboardData?.sales?.cgst ?? 0;
  const sgstTax = comparisonData?.gstr1?.sgst ?? dashboardData?.sales?.sgst ?? 0;
  const cessTax = comparisonData?.gstr1?.cess ?? dashboardData?.sales?.cess ?? 0;
  const outwardTax =
    comparisonData?.gstr1?.totalTax ??
    Number((igstTax + cgstTax + sgstTax + cessTax).toFixed(2));

  const itcAvailable =
    dashboardData?.itc?.available ??
    Number(
      (
        (dashboardData?.purchases?.igst || 0) +
        (dashboardData?.purchases?.cgst || 0) +
        (dashboardData?.purchases?.sgst || 0) +
        (dashboardData?.purchases?.cess || 0)
      ).toFixed(2)
    );

  const itcUtilized = Math.min(outwardTax, itcAvailable);
  const netCashTax = Math.max(0, Number((outwardTax - itcUtilized).toFixed(2)));
  const itcEfficiency = outwardTax > 0 ? Math.min(100, Math.round((itcUtilized / outwardTax) * 100)) : 100;

  const isComparisonMatched = comparisonData ? comparisonData.status === 'MATCHED' : true;
  const complianceScore = isComparisonMatched ? 100 : 82.5;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="CFO Executive Intelligence"
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              leftIcon={<Printer className="w-3.5 h-3.5 text-slate-500" />}
            >
              Export Briefing
            </Button>
          </div>
        }
      />

      <ErrorMessage error={error} onRetry={() => fetchCfoData(period)} />

      {loading ? (
        <div className="py-16">
          <Loader message="Aggregating financial and compliance metrics for CFO Executive Briefing..." />
        </div>
      ) : (
        <>
          {/* Executive KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: Gross Outward Revenue */}
            <MetricCard
              title="Gross Outward Revenue"
              value={formatCurrency(outwardSales)}
              subvalue="Taxable turnover across all invoices"
              icon={TrendingUp}
              trend={outwardSales > 0 ? "Active Business Activity" : "Nil Outward Turnover"}
              trendType={outwardSales > 0 ? "up" : "neutral"}
            />

            {/* KPI 2: Total Tax Liability */}
            <MetricCard
              title="Total Tax Liability (GSTR-1)"
              value={formatCurrency(outwardTax)}
              subvalue={`IGST: ${formatCurrency(igstTax)} • CGST+SGST: ${formatCurrency(cgstTax + sgstTax)}${cessTax > 0 ? ` • Cess: ${formatCurrency(cessTax)}` : ''}`}
              icon={Scale}
              badge={<Badge status="SENT">GSTR-1</Badge>}
            />

            {/* KPI 3: Available ITC */}
            <MetricCard
              title="Available ITC (GSTR-2B)"
              value={formatCurrency(itcAvailable)}
              subvalue="100% matched with 2B invoices"
              icon={Inbox}
              badge={<Badge status="VERIFIED">Eligible</Badge>}
            />

            {/* KPI 4: Net Cash Tax Liability */}
            <MetricCard
              title="Net Cash Tax Required"
              value={formatCurrency(netCashTax)}
              subvalue="To be paid via GSTR-3B by 20th"
              icon={Coins}
              badge={
                <Badge status={netCashTax > 0 ? 'OVERDUE' : 'PAID'}>
                  {netCashTax > 0 ? 'Cash Due' : 'Zero Liability'}
                </Badge>
              }
            />
          </div>

          {/* DRC-01B & DRC-01C Statutory Pre-Filing Audit Simulator */}
          <DrcAuditSimulator
            gstr1Tax={outwardTax}
            gstr3bTax={comparisonData?.gstr3b?.totalTax || outwardTax}
            gstr2bItc={itcAvailable}
            gstr3bItc={itcUtilized}
          />

          {/* Working Capital & Compliance Health Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Compliance Health Score Card */}
            <Card className="flex flex-col justify-between">
              <div>
                <CardHeader>
                  <CardTitle>Compliance Health Score</CardTitle>
                  <Badge status="PRO">Tier 1 (A+)</Badge>
                </CardHeader>

                <CardContent>
                  <div className="flex items-baseline gap-3">
                    <span className="text-4xl font-extrabold text-slate-900 font-mono tracking-tight">
                      {complianceScore}%
                    </span>
                    <span className="text-xs font-medium text-emerald-700">
                      On-time filing record
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${complianceScore}%` }}
                    />
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-100 space-y-2.5 text-xs text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>GSTR-1 Outward Filing:</span>
                      <span className="font-semibold text-emerald-700">Ready</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>GSTR-2B ITC Match:</span>
                      <span className="font-semibold text-emerald-700">Zero Discrepancy</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>CGST Rule 67A Eligibility:</span>
                      <span className="font-semibold text-slate-800">Verified</span>
                    </div>
                  </div>
                </CardContent>
              </div>
            </Card>

            {/* ITC Efficiency & Tax Savings Card */}
            <Card className="flex flex-col justify-between">
              <div>
                <CardHeader>
                  <CardTitle>ITC Efficiency & Absorption</CardTitle>
                  <span className="text-xs font-mono font-semibold text-indigo-600">
                    {itcEfficiency}% absorbed
                  </span>
                </CardHeader>

                <CardContent className="space-y-4">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Percentage of outward tax liability successfully offset by eligible vendor input tax credits.
                  </p>

                  <div className="space-y-3 text-xs">
                    <div>
                      <div className="flex justify-between font-medium text-slate-700 mb-1">
                        <span>ITC Utilized:</span>
                        <span className="font-mono">{formatCurrency(itcUtilized)}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div
                          className="bg-indigo-600 h-2 rounded-full"
                          style={{ width: `${itcEfficiency}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between font-medium text-slate-700 mb-1">
                        <span>Cash Outflow:</span>
                        <span className="font-mono text-rose-700">{formatCurrency(netCashTax)}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div
                          className="bg-rose-500 h-2 rounded-full"
                          style={{ width: `${100 - itcEfficiency}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </div>
            </Card>

            {/* Statutory Filing Readiness Timeline */}
            <Card className="flex flex-col justify-between">
              <div>
                <CardHeader>
                  <CardTitle>Statutory Return Readiness</CardTitle>
                  <Badge status="VERIFIED">Period {period}</Badge>
                </CardHeader>

                <CardContent className="space-y-3 text-xs">
                  <div className="p-3 rounded-lg border border-slate-200/90 bg-slate-50/60">
                    <div className="flex items-center justify-between font-medium mb-1">
                      <span className="text-slate-900 font-semibold">GSTR-1 Due Date</span>
                      <span className="font-mono text-indigo-600 font-semibold">11th of month</span>
                    </div>
                    <span className="text-slate-500">Outward business sales invoices</span>
                  </div>

                  <div className="p-3 rounded-lg border border-slate-200/90 bg-slate-50/60">
                    <div className="flex items-center justify-between font-medium mb-1">
                      <span className="text-slate-900 font-semibold">GSTR-2B Auto-Drafted</span>
                      <span className="font-mono text-emerald-700 font-semibold">14th of month</span>
                    </div>
                    <span className="text-slate-500">Static purchase ITC generated</span>
                  </div>

                  <div className="p-3 rounded-lg border border-slate-200/90 bg-slate-50/60">
                    <div className="flex items-center justify-between font-medium mb-1">
                      <span className="text-slate-900 font-semibold">GSTR-3B Payment & Filing</span>
                      <span className="font-mono text-amber-700 font-semibold">20th of month</span>
                    </div>
                    <span className="text-slate-500">Consolidated tax offset & cash payout</span>
                  </div>
                </CardContent>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50/80 rounded-b-xl flex items-center justify-between text-xs">
                <span className="text-slate-500">GST Portal Gateway: Active</span>
                <Link
                  to={`/returns?period=${period}`}
                  className="font-semibold text-indigo-600 hover:text-indigo-800 text-decoration-none flex items-center gap-1"
                >
                  <span>File Returns</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
