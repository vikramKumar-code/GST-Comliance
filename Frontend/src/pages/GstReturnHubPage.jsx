import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getLastMonthPeriod } from '../hooks/useReturns';

// 3 Custom Hooks from ../hooks/
import { useReturnData } from '../hooks/useReturnData';
import useFocusTrap from '../hooks/useFocusTrap';
import usePagination from '../hooks/usePagination';

// Utilities from ../utils/returnHelpers
import { getDueDateDisplay, totalTaxForRows, buildSectionCards } from '../utils/returnHelpers';

// Layout & UI Components
import PageHeader from '../components/ui/PageHeader';
import PeriodSelector from '../components/PeriodSelector';
import Button from '../components/ui/Button';
import DrcAuditSimulator from '../components/compliance/DrcAuditSimulator';
import { Calendar, ShieldCheck } from 'lucide-react';

// All 10 Returns Modular Components from ../components/returns/
import AuthScreen from '../components/returns/AuthScreen';
import ReturnSelector from '../components/returns/ReturnSelector';
import Gstr1Dashboard from '../components/returns/Gstr1Dashboard';
import Gstr2bView from '../components/returns/Gstr2bView';
import Gstr3bView from '../components/returns/Gstr3bView';
import SectionCards from '../components/returns/SectionCards';
import ActionBar from '../components/returns/ActionBar';
import InvoiceDrilldownModal from '../components/returns/InvoiceDrilldownModal';
import JsonViewerModal from '../components/returns/JsonViewerModal';
import EmptyStates from '../components/returns/EmptyStates';

// Existing Child Modals
import NilReturnModal from '../components/NilReturnModal';
import ItcReconciliationModal from '../components/ItcReconciliationModal';
import Gstr1EvcModal from '../components/Gstr1EvcModal';

/**
 * GstReturnHubPage - Refactored Orchestrator Component for GST Return Hub
 */
export default function GstReturnHubPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Period & Return Selection State (synced with URL search params)
  const urlPeriod = searchParams.get('period');
  const urlReturn = searchParams.get('return');

  const [localPeriod, setLocalPeriod] = useState(null);
  const [localReturn, setLocalReturn] = useState(null);

  const period = localPeriod || urlPeriod || getLastMonthPeriod();
  const selectedReturn = localReturn || urlReturn || 'gstr1';

  const setPeriod = setLocalPeriod;
  const setSelectedReturn = setLocalReturn;

  // 2. Authentication / GSTN Portal Session State
  const authStateKey = user?.workspaceId || user?.gstin || 'no-workspace';
  const [verifiedState, setVerifiedState] = useState(null);
  const isVerified = verifiedState?.key === authStateKey
    ? verifiedState.value
    : Boolean(user?.hasPortalSession);
  const setIsVerified = (value) => setVerifiedState({ key: authStateKey, value });

  const [authGstinOverride, setAuthGstinOverride] = useState(null);
  const authGstin = authGstinOverride?.key === authStateKey
    ? authGstinOverride.value
    : user?.gstin || '';
  const setAuthGstin = (value) => setAuthGstinOverride({ key: authStateKey, value });

  const [authUsernameOverride, setAuthUsernameOverride] = useState(null);
  const authUsername = authUsernameOverride?.key === authStateKey
    ? authUsernameOverride.value
    : user?.portalUsername || user?.email?.split('@')[0] || '';
  const setAuthUsername = (value) => setAuthUsernameOverride({ key: authStateKey, value });

  const [otpState, setOtpState] = useState(null);
  const otpSent = otpState?.key === authStateKey && otpState.sent;
  const otpInput = otpState?.key === authStateKey ? otpState.value : '';
  const setOtpSent = (sent) => setOtpState({ key: authStateKey, sent, value: '' });
  const setOtpInput = (value) => setOtpState((previous) => ({
    key: authStateKey,
    sent: previous?.key === authStateKey && previous.sent,
    value,
  }));

  const [taxpayerLookup, setTaxpayerLookup] = useState(null);
  const taxpayerDetails = taxpayerLookup?.gstin === authGstin.trim().toUpperCase()
    ? taxpayerLookup.details
    : null;
  const setTaxpayerDetails = (details) => setTaxpayerLookup({
    gstin: authGstin.trim().toUpperCase(),
    details,
  });

  const [verifyingGstin, setVerifyingGstin] = useState(false);
  const [authConsent, setAuthConsent] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authErrorMsg, setAuthErrorMsg] = useState(null);
  const [authSuccessMsg, setAuthSuccessMsg] = useState(null);

  // 3. Modals and Active Section State
  const [activeSectionKey, setActiveSectionKey] = useState(null);
  const [isNilModalOpen, setIsNilModalOpen] = useState(false);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
  const [isEvcModalOpen, setIsEvcModalOpen] = useState(false);
  const [evcReturnType, setEvcReturnType] = useState('GSTR1');

  // Accessibility focus trap for active modal dialogs
  const anyModalOpen = Boolean(
    activeSectionKey ||
    isJsonModalOpen ||
    isNilModalOpen ||
    isReconcileModalOpen ||
    isEvcModalOpen
  );
  const modalContainerRef = useFocusTrap(anyModalOpen, () => {
    setActiveSectionKey(null);
    setIsJsonModalOpen(false);
    setIsNilModalOpen(false);
    setIsReconcileModalOpen(false);
    setIsEvcModalOpen(false);
  });

  // 4. Exclusions & Return Data Hook
  const [excludedIds, setExcludedIds] = useState(new Set());

  const {
    gstr1Loading,
    setGstr1Loading,
    gstr1Error,
    setGstr1Error,
    prepareData,
    setPrepareData,
    saveResult,
    setSaveResult,
    gstr1ViewMode,
    setGstr1ViewMode,
    liveGstr1Data,
    setLiveGstr1Data,
    summary,
    sectionDetails,
    isPortalGstr1Active,
    portalB2bItems,
    portalB2clItems,
    portalB2csItems,
    portalCdnrItems,
    portalExpItems,
    portalHsnItems,
    portalDocItems,
    portalAllInvoices,
    portalB2clTaxable,
    portalB2clTax,
    portalB2csTaxable,
    portalB2csTax,
    portalCdnrTaxable,
    portalCdnrTax,
    portalExpTaxable,
    portalExpTax,
    portalHsnTaxable,
    portalHsnTax,
    g1Taxable,
    g1TotalTax,
    g1InvoiceCount,
    gstr2bData,
    setGstr2bData,
    g2bTotals,
    g2bTotalTax,
    g2bCount,
    gstr2bListedItc,
    gstr3bData,
    setGstr3bData,
    g3bOutwardRows,
    g3bItcRows,
    outwardLiability,
    outwardTaxableTurnover,
    g3bItcAvailable,
    otherReturnsLoading,
    setOtherReturnsLoading,
    otherReturnsError,
    setOtherReturnsError,
    fetchGstr1Data,
    fetchGstr2bData,
    fetchGstr3bData,
    fetchOtherReturns,
    toggleExcludeInvoice,
    handleExcludeAll,
    handleIncludeAll,
    seeding,
    seedSuccessMsg,
    handleSeedSampleInvoices,
    gstr1Filing,
    gstr3bFiling
  } = useReturnData(period, excludedIds);

  // 5. Auth Success Handler
  const handleAuthSuccess = () => {
    setGstr1Loading(true);
    setOtherReturnsLoading(true);
    setGstr1Error(null);
    setOtherReturnsError(null);
    setPrepareData(null);
    setLiveGstr1Data(null);
    setGstr2bData(null);
    setGstr3bData(null);
    setIsVerified(true);
  };

  const handleSwitchGstin = () => {
    if (window.confirm('Switch GSTIN? This will clear all current return data.')) {
      setIsVerified(false);
      setOtpSent(false);
      setOtpInput('');
      setAuthSuccessMsg(null);
      setAuthErrorMsg(null);
    }
  };

  // 6. Navigation and Period Handlers
  const handlePeriodChange = (newPeriod) => {
    setGstr1Loading(selectedReturn === 'gstr1');
    setGstr1Error(null);
    setOtherReturnsLoading(false);
    setOtherReturnsError(null);
    setPrepareData(null);
    setGstr2bData(null);
    setGstr3bData(null);
    setPeriod(newPeriod);
    setSearchParams({ period: newPeriod, return: selectedReturn });
    setExcludedIds(new Set());
    setSaveResult(null);
    setLiveGstr1Data(null);
  };

  const handleSelectReturnCard = (returnKey) => {
    setSelectedReturn(returnKey);
    setSearchParams({ period, return: returnKey });
    if (returnKey === 'gstr1' && !prepareData) {
      fetchGstr1Data(period, excludedIds, false);
    }
  };

  // 7. Memoized Section Cards & Active Section
  const sectionCards = useMemo(() => buildSectionCards({
    isPortalGstr1Active,
    portalB2bItems,
    portalB2clItems,
    portalB2csItems,
    portalCdnrItems,
    portalExpItems,
    portalHsnItems,
    portalDocItems,
    portalAllInvoices,
    portalB2clTaxable,
    portalB2clTax,
    portalB2csTaxable,
    portalB2csTax,
    portalCdnrTaxable,
    portalCdnrTax,
    portalExpTaxable,
    portalExpTax,
    portalHsnTaxable,
    portalHsnTax,
    summary,
    sectionDetails,
    prepareData,
    g1Taxable,
    g1TotalTax
  }), [
    isPortalGstr1Active,
    portalB2bItems,
    portalB2clItems,
    portalB2csItems,
    portalCdnrItems,
    portalExpItems,
    portalHsnItems,
    portalDocItems,
    portalAllInvoices,
    portalB2clTaxable,
    portalB2clTax,
    portalB2csTaxable,
    portalB2csTax,
    portalCdnrTaxable,
    portalCdnrTax,
    portalExpTaxable,
    portalExpTax,
    portalHsnTaxable,
    portalHsnTax,
    summary,
    sectionDetails,
    prepareData,
    g1Taxable,
    g1TotalTax
  ]);

  // Section cards overview with pagination hook
  const { paginatedItems: paginatedSectionCards } = usePagination(sectionCards, 10);
  const activeSection = sectionCards.find((c) => c.key === activeSectionKey);

  // 8. Due date computation
  const dueDateDisplay = useMemo(() => getDueDateDisplay(period), [period]);

  // ============================================================================
  // RENDER: AUTH SCREEN
  // ============================================================================
  if (!isVerified) {
    return (
      <AuthScreen
        authGstin={authGstin}
        setAuthGstin={setAuthGstin}
        authUsername={authUsername}
        setAuthUsername={setAuthUsername}
        otpSent={otpSent}
        setOtpSent={setOtpSent}
        otpInput={otpInput}
        setOtpInput={setOtpInput}
        taxpayerDetails={taxpayerDetails}
        setTaxpayerDetails={setTaxpayerDetails}
        verifyingGstin={verifyingGstin}
        setVerifyingGstin={setVerifyingGstin}
        authConsent={authConsent}
        setAuthConsent={setAuthConsent}
        authLoading={authLoading}
        setAuthLoading={setAuthLoading}
        authErrorMsg={authErrorMsg}
        setAuthErrorMsg={setAuthErrorMsg}
        authSuccessMsg={authSuccessMsg}
        setAuthSuccessMsg={setAuthSuccessMsg}
        onVerifySuccess={handleAuthSuccess}
      />
    );
  }

  // ============================================================================
  // RENDER: MAIN DASHBOARD
  // ============================================================================
  return (
    <div className="space-y-6">
      {/* Top Header */}
      <PageHeader
        title="GST Return Hub"
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50/90 border border-amber-200/80 text-amber-900 text-xs font-medium shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-amber-600" />
              <span>Due: <strong className="font-semibold text-amber-700">{dueDateDisplay}</strong></span>
            </div>
            <PeriodSelector selectedPeriod={period} onPeriodChange={handlePeriodChange} />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSwitchGstin}
              className="text-indigo-700 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50"
              title="Authenticate with GST Portal OTP or re-verify credentials"
            >
              <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
              <span>Portal Login (OTP)</span>
            </Button>
          </div>
        }
      />

      {/* Other Returns Error Banner */}
      {otherReturnsError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span>{otherReturnsError.message || 'Could not load GSTR-2B / GSTR-3B data.'}</span>
          <button
            type="button"
            onClick={() => {
              setOtherReturnsLoading(true);
              setOtherReturnsError(null);
              fetchOtherReturns(period);
            }}
            disabled={otherReturnsLoading}
            className="shrink-0 font-semibold underline disabled:opacity-50 cursor-pointer"
          >
            {otherReturnsLoading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* Return Type Selector Cards */}
      <ReturnSelector
        selectedReturn={selectedReturn}
        onSelectReturn={handleSelectReturnCard}
        g1InvoiceCount={g1InvoiceCount}
        g2bCount={g2bCount}
        g2bTotalTax={g2bTotalTax}
        isG1Filed={Boolean(gstr1Filing)}
        isG3bFiled={Boolean(gstr3bFiling)}
      />

      {/* DRC Audit Simulator */}
      {isPortalGstr1Active && gstr3bData && gstr2bData && g3bOutwardRows.length && g3bItcRows.length ? (
        <DrcAuditSimulator
          gstr1Tax={g1TotalTax}
          gstr3bTax={totalTaxForRows(g3bOutwardRows)}
          gstr2bItc={g2bTotalTax}
          gstr3bItc={g3bItcAvailable}
        />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Statutory risk comparison is unavailable until GSTR-1, GSTR-2B and GSTR-3B return data is loaded.
        </div>
      )}

      {/* GSTR-1 View */}
      {selectedReturn === 'gstr1' && (
        <Gstr1Dashboard
          period={period}
          gstr1Loading={gstr1Loading}
          gstr1Error={gstr1Error}
          prepareData={prepareData}
          liveGstr1Data={liveGstr1Data}
          gstr1ViewMode={gstr1ViewMode}
          setGstr1ViewMode={setGstr1ViewMode}
          excludedIds={excludedIds}
          fetchGstr1Data={fetchGstr1Data}
          onOpenNilModal={() => setIsNilModalOpen(true)}
          onOpenJsonModal={() => setIsJsonModalOpen(true)}
          onOpenEvcModal={() => {
            setEvcReturnType('GSTR1');
            setIsEvcModalOpen(true);
          }}
          saveResult={saveResult}
          summary={summary}
          sectionDetails={sectionDetails}
          SECTION_CARDS={paginatedSectionCards || sectionCards}
          onSectionCardClick={(key) => setActiveSectionKey(key)}
          seeding={seeding}
          seedSuccessMsg={seedSuccessMsg}
          handleSeedSampleInvoices={handleSeedSampleInvoices}
          ActionBarComponent={ActionBar}
          SectionCardsComponent={SectionCards}
          EmptyStatesComponent={EmptyStates}
          gstr1Filing={gstr1Filing}
        />
      )}

      {/* GSTR-2B View */}
      {selectedReturn === 'gstr2b' && (
        <Gstr2bView
          period={period}
          gstr2bData={gstr2bData}
          otherReturnsLoading={otherReturnsLoading}
          fetchGstr2bData={fetchGstr2bData}
          onOpenReconcileModal={() => setIsReconcileModalOpen(true)}
          g2bTotals={g2bTotals}
          g2bTotalTax={g2bTotalTax}
          g2bCount={g2bCount}
          gstr2bListedItc={gstr2bListedItc}
        />
      )}

      {/* GSTR-3B View */}
      {selectedReturn === 'gstr3b' && (
        <Gstr3bView
          period={period}
          gstr3bData={gstr3bData}
          otherReturnsLoading={otherReturnsLoading}
          fetchGstr3bData={fetchGstr3bData}
          onOpenNilModal={(type = 'GSTR3B') => {
            setEvcReturnType(type);
            setIsNilModalOpen(true);
          }}
          onOpenEvcModal={(type = 'GSTR3B') => {
            setEvcReturnType(type);
            setIsEvcModalOpen(true);
          }}
          outwardLiability={outwardLiability}
          g3bItcAvailable={g3bItcAvailable}
        />
      )}

      {/* Modals Container rendered at the end */}
      <div ref={modalContainerRef}>
        {/* Invoice Drilldown Modal */}
        <InvoiceDrilldownModal
          activeSection={activeSection}
          isPortalGstr1Active={isPortalGstr1Active}
          period={period}
          onClose={() => setActiveSectionKey(null)}
          onToggleExclude={toggleExcludeInvoice}
          onExcludeAll={handleExcludeAll}
          onIncludeAll={handleIncludeAll}
        />

        {/* Raw JSON Viewer Modal */}
        <JsonViewerModal
          isOpen={isJsonModalOpen}
          onClose={() => setIsJsonModalOpen(false)}
          prepareData={prepareData}
          authGstin={authGstin}
          period={period}
        />

        {/* Child Modals */}
        <NilReturnModal
          isOpen={isNilModalOpen}
          onClose={() => {
            setIsNilModalOpen(false);
            fetchGstr1Data(period);
          }}
          initialPeriod={period}
          initialType={selectedReturn === 'gstr3b' ? 'GSTR3B' : 'GSTR1'}
          gstin={authGstin}
          username={authUsername}
          onSuccess={() => {
            fetchGstr1Data(period);
          }}
        />

        <ItcReconciliationModal
          isOpen={isReconcileModalOpen}
          onClose={() => setIsReconcileModalOpen(false)}
          period={period}
        />

        <Gstr1EvcModal
          isOpen={isEvcModalOpen}
          onClose={() => setIsEvcModalOpen(false)}
          period={period}
          gstin={authGstin}
          username={authUsername}
          workspaceName={user?.workspaceName || user?.currentWorkspace?.name}
          returnType={evcReturnType}
          summary={evcReturnType === 'GSTR3B' ? {
            totalTaxable: outwardTaxableTurnover,
            totalTax: outwardLiability
          } : summary}
          excludedInvoiceIds={excludedIds}
          onSuccess={(result) => {
            setSaveResult({
              message: result.message || `${evcReturnType} successfully filed with EVC verification!`,
              ref_id: result.arn,
              gstin: authGstin
            });
            if (evcReturnType === 'GSTR1') {
              setGstr1Loading(true);
              setGstr1Error(null);
              setPrepareData(null);
              fetchGstr1Data(period, excludedIds);
            } else {
              setOtherReturnsLoading(true);
              setOtherReturnsError(null);
              fetchOtherReturns(period);
            }
          }}
        />
      </div>
    </div>
  );
}
