import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { prepareGstr1, saveGstr1, getGstr1 } from '../api/returns.api';
import { getLastMonthPeriod } from '../hooks/useReturns';
import PeriodSelector from '../components/PeriodSelector';
import NilReturnModal from '../components/NilReturnModal';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import { formatCurrency, formatPeriod, formatDate } from '../utils/format';

export default function Gstr1PreparePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPeriod = searchParams.get('period') || getLastMonthPeriod();
  const [period, setPeriod] = useState(initialPeriod);

  // View mode: 'prepare' (Cards & Exclusion Table) vs 'portal' (GSTN Live Return)
  const [viewMode, setViewMode] = useState('prepare');

  // Prepare payload state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [prepareData, setPrepareData] = useState(null);
  const [saveResult, setSaveResult] = useState(null);

  // Set of excluded invoice IDs
  const [excludedIds, setExcludedIds] = useState(new Set());

  // Modal / Drawer state for section inspection
  const [activeSectionKey, setActiveSectionKey] = useState(null);
  const [tableSearch, setTableSearch] = useState('');

  // Nil return modal
  const [isNilModalOpen, setIsNilModalOpen] = useState(false);

  // Payload JSON viewer modal
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);

  // Portal data state (for raw GSTN download mode)
  const [portalData, setPortalData] = useState(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState(null);

  // Load GSTR-1 prepare data
  const fetchPrepare = useCallback(async (p, currentExcluded = excludedIds) => {
    if (!p) return;
    setLoading(true);
    setError(null);
    setSaveResult(null);
    try {
      const res = await prepareGstr1(p, Array.from(currentExcluded));
      setPrepareData(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [excludedIds]);

  useEffect(() => {
    fetchPrepare(period, excludedIds);
  }, [period]);

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    setSearchParams({ period: newPeriod });
    setExcludedIds(new Set());
    setSaveResult(null);
  };

  // Toggle invoice exclusion without deleting from DB
  const toggleExcludeInvoice = (invoiceId) => {
    const idStr = String(invoiceId);
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(idStr)) {
        next.delete(idStr);
      } else {
        next.add(idStr);
      }
      // Re-fetch or re-evaluate with updated exclusions
      fetchPrepare(period, next);
      return next;
    });
  };

  // Save / Upload GSTR-1 to GST Portal
  const handleSaveReturn = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await saveGstr1(period, Array.from(excludedIds));
      setSaveResult(res);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  // Fetch official portal data if user toggles to Portal View
  const fetchPortalData = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await getGstr1(period);
      setPortalData(res);
    } catch (err) {
      setPortalError(err);
    } finally {
      setPortalLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'portal' && !portalData) {
      fetchPortalData();
    }
  }, [viewMode, period]);

  const summary = prepareData?.summary || {};
  const sectionDetails = prepareData?.sectionDetails || {
    b2b: [],
    b2cl: [],
    b2cs: [],
    exp: [],
    cdnr: [],
    hsn: [],
    docIssue: []
  };
  const supplierDetails = prepareData?.supplierDetails || {
    gstin: user?.gstin || '29AABCU9603R1Z2',
    legalName: user?.name || 'CANDID COMPLIANCE TECH PVT LTD',
    tradeName: 'CandidTax Enterprise Solutions'
  };

  // Compute due date (11th of succeeding month)
  const dueDateDisplay = useMemo(() => {
    if (!period || period.length !== 6) return '11th of next month';
    const month = parseInt(period.slice(0, 2), 10);
    const year = parseInt(period.slice(2), 10);
    const nextDate = new Date(year, month, 11);
    return nextDate.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }, [period]);

  // Section cards definition as per Image 2
  const SECTION_CARDS = [
    {
      key: 'b2b',
      tableCode: 'Table 4A, 4B, 4C, 6B, 6C',
      title: 'B2B Invoices',
      subtitle: 'Taxable outward supplies to registered buyers',
      icon: '🏢',
      count: summary.sections?.b2bCount ?? sectionDetails.b2b?.length ?? 0,
      included: summary.sections?.b2bIncluded ?? sectionDetails.b2b?.filter((i) => !i.isExcluded).length ?? 0,
      taxable: summary.sections?.b2bTaxable ?? 0,
      tax: summary.sections?.b2bTax ?? 0,
      items: sectionDetails.b2b || [],
      color: 'blue'
    },
    {
      key: 'b2cl',
      tableCode: 'Table 5A, 5B',
      title: 'B2C (Large) Invoices',
      subtitle: 'Inter-state supplies to unregistered buyers > ₹2.5 Lakhs',
      icon: '🏛️',
      count: summary.sections?.b2clCount ?? sectionDetails.b2cl?.length ?? 0,
      included: summary.sections?.b2clIncluded ?? sectionDetails.b2cl?.filter((i) => !i.isExcluded).length ?? 0,
      taxable: summary.sections?.b2clTaxable ?? 0,
      tax: summary.sections?.b2clTax ?? 0,
      items: sectionDetails.b2cl || [],
      color: 'indigo'
    },
    {
      key: 'b2cs',
      tableCode: 'Table 7',
      title: 'B2C (Small) Invoices',
      subtitle: 'Intra-state & inter-state supplies <= ₹2.5 Lakhs',
      icon: '🛍️',
      count: summary.sections?.b2csCount ?? sectionDetails.b2cs?.length ?? 0,
      included: summary.sections?.b2csIncluded ?? sectionDetails.b2cs?.filter((i) => !i.isExcluded).length ?? 0,
      taxable: summary.sections?.b2csTaxable ?? 0,
      tax: summary.sections?.b2csTax ?? 0,
      items: sectionDetails.b2cs || [],
      color: 'teal'
    },
    {
      key: 'cdnr',
      tableCode: 'Table 9B',
      title: 'Credit / Debit Notes',
      subtitle: 'Registered buyer credit/debit notes & amendments',
      icon: '📝',
      count: summary.sections?.cdnrCount ?? sectionDetails.cdnr?.length ?? 0,
      included: sectionDetails.cdnr?.filter((i) => !i.isExcluded).length ?? 0,
      taxable: 0,
      tax: 0,
      items: sectionDetails.cdnr || [],
      color: 'amber'
    },
    {
      key: 'exp',
      tableCode: 'Table 6A',
      title: 'Exports Invoices (EXP)',
      subtitle: 'Supplies exported with or without payment of tax',
      icon: '✈️',
      count: summary.sections?.expCount ?? sectionDetails.exp?.length ?? 0,
      included: summary.sections?.expIncluded ?? sectionDetails.exp?.filter((i) => !i.isExcluded).length ?? 0,
      taxable: summary.sections?.expTaxable ?? 0,
      tax: summary.sections?.expTax ?? 0,
      items: sectionDetails.exp || [],
      color: 'purple'
    },
    {
      key: 'hsn',
      tableCode: 'Table 12',
      title: 'HSN Summary',
      subtitle: 'HSN/SAC wise summary of outward supplies',
      icon: '🏷️',
      count: summary.sections?.hsnCount ?? 0,
      included: summary.sections?.hsnCount ?? 0,
      taxable: summary.totalTaxable ?? 0,
      tax: summary.totalTax ?? 0,
      items: (prepareData?.payload?.hsn?.data || []).map((h) => ({
        _id: `hsn-${h.num}`,
        invoiceNumber: h.hsn_sc,
        customerName: h.desc,
        taxableAmount: h.txval,
        igst: h.iamt,
        cgst: h.camt,
        sgst: h.samt,
        grandTotal: h.txval + h.iamt + h.camt + h.samt,
        isHsnRow: true
      })),
      color: 'emerald'
    },
    {
      key: 'docIssue',
      tableCode: 'Table 13',
      title: 'Documents Issued',
      subtitle: 'Outward invoice & note numbering series',
      icon: '📑',
      count: summary.sections?.docRange?.totalCount ?? summary.totalInvoices ?? 0,
      included: summary.sections?.docRange?.totalCount ?? summary.totalInvoices ?? 0,
      taxable: 0,
      tax: 0,
      items: summary.sections?.docRange ? [{
        _id: 'doc-1',
        invoiceNumber: `${summary.sections.docRange.from} to ${summary.sections.docRange.to}`,
        customerName: 'Invoice Serial Series',
        taxableAmount: summary.sections.docRange.totalCount,
        grandTotal: summary.sections.docRange.totalCount,
        isDocRow: true
      }] : [],
      color: 'rose'
    }
  ];

  // Active section item for drilldown modal
  const activeSection = SECTION_CARDS.find((c) => c.key === activeSectionKey);

  // Filtered items in active modal
  const modalFilteredItems = useMemo(() => {
    if (!activeSection) return [];
    if (!tableSearch.trim()) return activeSection.items;
    const q = tableSearch.toLowerCase();
    return activeSection.items.filter((item) =>
      item.invoiceNumber?.toLowerCase().includes(q) ||
      item.customerName?.toLowerCase().includes(q) ||
      item.customerGstin?.toLowerCase().includes(q)
    );
  }, [activeSection, tableSearch]);

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              GSTR-1 Outward Supplies
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 font-mono">
              {formatPeriod(period)}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
              Monthly Return
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Prepare, exclude line items safely, inspect government tables, and file outward tax returns.
          </p>
        </div>

        {/* View Switcher & Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Switch Between Prepare vs Official Live Return */}
          <div className="inline-flex rounded-lg p-1 bg-slate-100 border border-slate-200 text-xs font-medium">
            <button
              type="button"
              className={`px-3 py-1.5 rounded-md transition-colors ${
                viewMode === 'prepare'
                  ? 'bg-white text-slate-900 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => setViewMode('prepare')}
            >
              📋 Section Preparation (7 Cards)
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 rounded-md transition-colors ${
                viewMode === 'portal'
                  ? 'bg-white text-slate-900 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => setViewMode('portal')}
            >
              🌐 GST Portal Data
            </button>
          </div>

          <PeriodSelector selectedPeriod={period} onPeriodChange={handlePeriodChange} />

          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors shadow-xs"
            onClick={() => setIsNilModalOpen(true)}
            title="File instant Nil GSTR-1 under CGST Rule 67A"
          >
            <span>⚡ Nil File GSTR-1</span>
          </button>

          <Link
            to="/excel-import"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-xs"
            title="Import invoices from Excel spreadsheet"
          >
            <span>📥 Import Excel</span>
          </Link>
        </div>
      </div>

      {/* Outward Supplier Details Header Card (Image 2 Blueprint) */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-5 shadow-sm">
        <div className="absolute -right-8 -top-8 w-44 h-44 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 flex-1">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 font-medium">GSTIN of Supplier</div>
              <div className="mt-1 font-mono font-bold text-base text-emerald-400">
                {supplierDetails.gstin}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 font-medium">Legal Name</div>
              <div className="mt-1 font-semibold text-sm text-slate-100 truncate" title={supplierDetails.legalName}>
                {supplierDetails.legalName}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 font-medium">Trade Name</div>
              <div className="mt-1 font-semibold text-sm text-slate-100 truncate" title={supplierDetails.tradeName}>
                {supplierDetails.tradeName}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 font-medium">Filing Due Date</div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-amber-400 font-bold text-sm">{dueDateDisplay}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300">Rule 59</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-4 lg:pt-0 border-t lg:border-t-0 border-slate-700/60 shrink-0">
            <div className="text-right">
              <span className="text-xs text-slate-400 block">Filing Readiness</span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {summary.includedInvoices > 0 ? 'Ready for GSTN Upload' : 'No Sales Recorded'}
              </span>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 transition shadow-md hover:shadow-lg disabled:opacity-50"
              onClick={handleSaveReturn}
              disabled={saving || loading || summary.includedInvoices === 0}
            >
              {saving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Uploading to GSTN...</span>
                </>
              ) : (
                <>
                  <span>🚀 Upload & Save to GST Portal</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Save / Dry-run Status Notification */}
      {saveResult && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
            saveResult.dryRun
              ? 'bg-blue-50 border-blue-200 text-blue-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{saveResult.dryRun ? '🛡️' : '✅'}</span>
            <div>
              <div className="font-bold text-sm">{saveResult.message}</div>
              <div className="text-xs opacity-80 mt-0.5 font-mono">
                Period: {saveResult.period} • GSTIN: {saveResult.gstin} • Reference ID: <strong>{saveResult.ref_id}</strong>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 transition"
            onClick={() => setIsJsonModalOpen(true)}
          >
            Inspect Payload JSON
          </button>
        </div>
      )}

      {error && <ErrorMessage error={error} onRetry={() => fetchPrepare(period)} />}

      {/* VIEW MODE 1: GSTR-1 SECTION CARDS PREPARATION (Blueprint Image 2) */}
      {viewMode === 'prepare' && (
        <>
          {/* Key Return Metric Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs font-medium text-slate-500">Total Active Invoices</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900">{summary.includedInvoices ?? 0}</span>
                <span className="text-xs text-slate-400">of {summary.totalInvoices ?? 0} total</span>
              </div>
              {excludedIds.size > 0 && (
                <div className="mt-1 text-[11px] font-medium text-amber-600">
                  ⚠️ {excludedIds.size} invoice(s) excluded from return
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs font-medium text-slate-500">Total Taxable Value</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {formatCurrency(summary.totalTaxable || 0)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">Net of discounts</div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs font-medium text-slate-500">Total Outward Tax</div>
              <div className="mt-1 text-2xl font-bold text-emerald-600">
                {formatCurrency(summary.totalTax || 0)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                IGST: {formatCurrency(summary.totalIgst || 0)} • CGST: {formatCurrency(summary.totalCgst || 0)} • SGST: {formatCurrency(summary.totalSgst || 0)}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs font-medium text-slate-500">Gross Outward Supplies</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {formatCurrency(summary.grandTotal || 0)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">Invoice value with tax</div>
            </div>
          </div>

          {/* Section Cards Grid Header */}
          <div className="flex items-center justify-between mt-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                GSTR-1 Section Tables
              </h2>
              <p className="text-xs text-slate-500">
                Click any section card to inspect its invoices or exclude specific items from this filing.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-xs text-slate-600 hover:text-slate-900 font-medium px-2.5 py-1 rounded border border-slate-200 bg-white"
                onClick={() => setIsJsonModalOpen(true)}
              >
                🔍 View Full JSON
              </button>
            </div>
          </div>

          {/* Loading state for Cards */}
          {loading ? (
            <div className="py-12 text-center bg-white rounded-2xl border border-slate-200">
              <Loader message={`Distributing outward sales into GSTR-1 government sections for ${formatPeriod(period)}...`} />
            </div>
          ) : (
            /* 7 Section Cards Grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {SECTION_CARDS.map((section) => (
                <div
                  key={section.key}
                  onClick={() => {
                    setActiveSectionKey(section.key);
                    setTableSearch('');
                  }}
                  className="group relative flex flex-col justify-between p-5 rounded-2xl border border-slate-200 bg-white shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl p-2 rounded-xl bg-slate-50 border border-slate-100 group-hover:scale-110 transition-transform">
                        {section.icon}
                      </span>
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                          {section.tableCode}
                        </span>
                        <h3 className="font-bold text-slate-900 text-sm leading-tight mt-0.5 group-hover:text-emerald-700 transition-colors">
                          {section.title}
                        </h3>
                      </div>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono">
                      {section.count}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 line-clamp-2 mt-3 min-h-[32px]">
                    {section.subtitle}
                  </p>

                  <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Taxable Value:</span>
                      <span className="font-semibold text-slate-900 font-mono">
                        {formatCurrency(section.taxable)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Total Tax:</span>
                      <span className="font-semibold text-emerald-600 font-mono">
                        {formatCurrency(section.tax)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">
                      {section.included} included
                    </span>
                    <span className="font-semibold text-emerald-600 group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                      <span>Inspect Table</span>
                      <span>→</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Action Bottom Bar */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xl">💡</span>
              <div className="text-xs text-slate-600">
                <strong>Need to exclude specific invoices from this return?</strong> Click any card above, click <strong>"Exclude from Return"</strong> on the invoice line item. The invoice remains safely saved in your database and won't be deleted!
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
                onClick={() => setIsJsonModalOpen(true)}
              >
                Inspect Official JSON
              </button>
              <button
                type="button"
                className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-xs"
                onClick={handleSaveReturn}
                disabled={saving || loading || summary.includedInvoices === 0}
              >
                Save & File to GSTN
              </button>
            </div>
          </div>
        </>
      )}

      {/* VIEW MODE 2: OFFICIAL GST PORTAL RETURN DATA */}
      {viewMode === 'portal' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 text-blue-900 flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs">
              <span className="text-xl">🌐</span>
              <div>
                <strong>Live Portal Fetch View</strong>: Displaying the officially filed return payload downloaded from the GSTN system.
              </div>
            </div>
            <button
              type="button"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
              onClick={fetchPortalData}
              disabled={portalLoading}
            >
              {portalLoading ? 'Fetching...' : '🔄 Refresh from GSTN'}
            </button>
          </div>

          {portalLoading && (
            <div className="py-12 text-center bg-white rounded-2xl border border-slate-200">
              <Loader message="Downloading official GSTR-1 records from GST System..." />
            </div>
          )}

          {portalError && <ErrorMessage error={portalError} onRetry={fetchPortalData} />}

          {!portalLoading && !portalError && portalData && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs p-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-slate-900">Official GSTN Return Summary</h3>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    GSTIN: {portalData.gstin || user?.gstin} • Return Period: {portalData.ret_period || period}
                  </div>
                </div>
                <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800">
                  {portalData.status || 'RECORDED'}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="text-xs text-slate-400">Total Taxable</div>
                  <div className="font-bold text-slate-900 mt-1">
                    {formatCurrency(portalData.totalTaxable || 0)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="text-xs text-slate-400">Total IGST</div>
                  <div className="font-bold text-slate-900 mt-1">
                    {formatCurrency(portalData.totalIgst || 0)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="text-xs text-slate-400">Total CGST + SGST</div>
                  <div className="font-bold text-slate-900 mt-1">
                    {formatCurrency((portalData.totalCgst || 0) + (portalData.totalSgst || 0))}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="text-xs text-slate-400">Total Tax Liability</div>
                  <div className="font-bold text-emerald-600 mt-1">
                    {formatCurrency(portalData.totalTax || 0)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION DETAIL MODAL / DRAWER (IMAGE 2 TABLE DRILLDOWN & EXCLUSION) */}
      {activeSection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <span className="text-2xl p-2 rounded-xl bg-white border border-slate-200 shadow-xs">
                  {activeSection.icon}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold uppercase text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {activeSection.tableCode}
                    </span>
                    <h3 className="text-base font-bold text-slate-900">
                      {activeSection.title}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {activeSection.subtitle}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 transition"
                  onClick={() => setActiveSectionKey(null)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Search & Exclusion Banner */}
            <div className="px-6 py-3 border-b border-slate-100 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">🔍</span>
                <input
                  type="text"
                  placeholder="Search invoice number, buyer name, or GSTIN..."
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">
                  Showing <strong>{modalFilteredItems.length}</strong> items
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-emerald-700 font-semibold">
                  {modalFilteredItems.filter((i) => !i.isExcluded).length} included in return
                </span>
              </div>
            </div>

            {/* Safe Exclusion Notice (Image 2 Key Requirement) */}
            <div className="px-6 py-2.5 bg-amber-50/80 border-b border-amber-100 text-amber-900 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>🛡️</span>
                <span>
                  <strong>Safe Invoice Exclusion:</strong> Clicking <strong>"Exclude"</strong> removes the invoice from this GSTR-1 return filing payload without deleting it from your database!
                </span>
              </div>
              <Link
                to="/sales/invoices"
                className="text-xs font-semibold text-amber-800 hover:underline shrink-0"
              >
                + Create New Invoice
              </Link>
            </div>

            {/* Table Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {modalFilteredItems.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  No line items found in this section for the selected period.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-3 w-12 text-center">Filing Status</th>
                        <th className="py-3 px-3">Invoice #</th>
                        <th className="py-3 px-3">Date</th>
                        <th className="py-3 px-3">Customer / Buyer</th>
                        <th className="py-3 px-3">GSTIN</th>
                        <th className="py-3 px-3 text-right">Taxable (₹)</th>
                        <th className="py-3 px-3 text-right">IGST (₹)</th>
                        <th className="py-3 px-3 text-right">CGST+SGST (₹)</th>
                        <th className="py-3 px-3 text-right">Grand Total (₹)</th>
                        <th className="py-3 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {modalFilteredItems.map((item) => {
                        const isExcluded = item.isExcluded;
                        return (
                          <tr
                            key={String(item._id)}
                            className={`transition-colors ${
                              isExcluded
                                ? 'bg-slate-50/80 opacity-60 text-slate-400'
                                : 'hover:bg-slate-50/50 text-slate-700'
                            }`}
                          >
                            <td className="py-2.5 px-3 text-center">
                              {isExcluded ? (
                                <span
                                  className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300"
                                  title="Excluded from GSTR-1"
                                />
                              ) : (
                                <span
                                  className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500"
                                  title="Included in GSTR-1"
                                />
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                              {item.invoiceNumber}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500">
                              {item.dateFormatted || formatDate(item.invoiceDate)}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900 truncate max-w-[160px]" title={item.customerName}>
                              {item.customerName || 'Consumer'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                              {item.customerGstin || '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-medium">
                              {formatCurrency(item.taxableAmount || 0)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                              {formatCurrency(item.igst || 0)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                              {formatCurrency((item.cgst || 0) + (item.sgst || 0))}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                              {formatCurrency(item.grandTotal || 0)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {item.isHsnRow || item.isDocRow ? (
                                <span className="text-[10px] text-slate-400 font-medium">System Row</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => toggleExcludeInvoice(item._id)}
                                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition shadow-2xs ${
                                    isExcluded
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                                      : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                                  }`}
                                  title={
                                    isExcluded
                                      ? 'Include this invoice back in the GSTR-1 return filing'
                                      : 'Exclude this invoice from GSTR-1 (Invoice stays safely saved in DB)'
                                  }
                                >
                                  {isExcluded ? '✓ Include Back' : '✕ Exclude'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="text-xs text-slate-500">
                Active Section: <strong>{activeSection.title}</strong>
              </div>
              <button
                type="button"
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition"
                onClick={() => setActiveSectionKey(null)}
              >
                Close Table
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RAW JSON VIEWER MODAL */}
      {isJsonModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl max-h-[85vh] bg-slate-900 text-slate-100 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-700">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-mono">{'{}'}</span>
                <h3 className="font-bold text-sm text-white">Official GSTN GSTR-1 Payload</h3>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-white"
                onClick={() => setIsJsonModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-emerald-300 bg-slate-950">
              <pre>{JSON.stringify(prepareData?.payload || {}, null, 2)}</pre>
            </div>
            <div className="px-6 py-3 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition"
                onClick={() => setIsJsonModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NIL RETURN FILING MODAL */}
      <NilReturnModal
        isOpen={isNilModalOpen}
        onClose={() => setIsNilModalOpen(false)}
        period={period}
        initialType="GSTR1"
        onSuccess={() => {
          setIsNilModalOpen(false);
          fetchPrepare(period);
        }}
      />
    </div>
  );
}
