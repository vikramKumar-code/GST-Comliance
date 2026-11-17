import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getLastMonthPeriod } from '../hooks/useReturns';

// Custom Hooks
import { useReturnData } from '../hooks/useReturnData';
import useFocusTrap from '../hooks/useFocusTrap';
import usePagination from '../hooks/usePagination';

// Utilities
import {
  getDueDateDisplay,
  totalTaxForRows,
  buildSectionCards
} from '../utils/returnHelpers';
import {
  isValidPeriod,
  isFuturePeriod,
  getCurrentIstPeriod,
  normalizeNilReturnType
} from '../utils/validators';

// Layout & UI Components
import PageHeader from '../components/ui/PageHeader';
import PeriodSelector from '../components/PeriodSelector';
import Button from '../components/ui/Button';
import DrcAuditSimulator from '../components/compliance/DrcAuditSimulator';
import {
  Calendar,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  X,
  RefreshCw
} from 'lucide-react';

// Returns Modular Components
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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function normalizeReturnKey(value) {
  const raw = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (raw === 'gstr1' || raw === 'r1' || raw === '1') return 'gstr1';
  if (raw === 'gstr2b' || raw === 'r2b' || raw === '2b') return 'gstr2b';
  if (raw === 'gstr3b' || raw === 'r3b' || raw === '3b' || raw === 'gstr3') {
    return 'gstr3b';
  }

  return null;
}

function normalizeReturnType(value) {
  const normalized = normalizeNilReturnType(value);

  if (normalized === 'GSTR1' || normalized === 'R1') return 'GSTR1';
  if (normalized === 'GSTR3B' || normalized === 'R3B' || normalized === 'GSTR3') {
    return 'GSTR3B';
  }

  return normalized || 'GSTR1';
}

function getIssueLabel(issue, fallback = 'Unknown') {
  if (!issue) return fallback;
  if (typeof issue === 'string') return issue;

  return (
    issue.invoiceNumber ||
    issue.inum ||
    issue.hsn_sc ||
    issue.hsn ||
    issue._id ||
    issue.id ||
    fallback
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * GstReturnHubPage - Refactored Orchestrator Component for GST Return Hub
 *
 * Backend-aligned flow:
 * - GSTR-1 / GSTR-3B filing uses prepare-filing -> EVC OTP -> file-evc
 * - Nil filing uses statutory Rule 67A declaration + EVC
 * - Pending/timeout filing outcomes are shown as PENDING, not blind retry
 * - GSTR-1 local prepare blocking issues are surfaced before filing
 */
export default function GstReturnHubPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  /* ------------------------------------------------------------------------ */
  /* URL + Period + Return Selection                                          */
  /* ------------------------------------------------------------------------ */

  const urlPeriod = searchParams.get('period');
  const urlReturn = searchParams.get('return');

  const initialPeriod = useMemo(() => {
    const p = String(urlPeriod || '').trim();
    return isValidPeriod(p) ? p : getLastMonthPeriod();
  }, [urlPeriod]);

  const initialReturn = useMemo(
    () => normalizeReturnKey(urlReturn) || 'gstr1',
    [urlReturn]
  );

  const [period, setPeriod] = useState(initialPeriod);
  const [selectedReturn, setSelectedReturn] = useState(initialReturn);

  const periodRef = useRef(period);
  const selectedReturnRef = useRef(selectedReturn);

  useEffect(() => {
    periodRef.current = period;
  }, [period]);

  useEffect(() => {
    selectedReturnRef.current = selectedReturn;
  }, [selectedReturn]);

  // Sync local state -> URL
  useEffect(() => {
    const next = new URLSearchParams(searchParams);

    if (next.get('period') !== period) {
      next.set('period', period);
    }

    if (next.get('return') !== selectedReturn) {
      next.set('return', selectedReturn);
    }

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [period, selectedReturn, searchParams, setSearchParams]);

  // Sync external URL changes -> local state
  useEffect(() => {
    const p = String(urlPeriod || '').trim();

    if (isValidPeriod(p) && p !== periodRef.current) {
      setPeriod(p);
    }

    const r = normalizeReturnKey(urlReturn);

    if (r && r !== selectedReturnRef.current) {
      setSelectedReturn(r);
    }
  }, [urlPeriod, urlReturn]);

  /* ------------------------------------------------------------------------ */
  /* Page-level notices                                                       */
  /* ------------------------------------------------------------------------ */

  const [notice, setNotice] = useState(null);
  const [filingPending, setFilingPending] = useState(null);

  /* ------------------------------------------------------------------------ */
  /* Authentication / GSTN Portal Session State                               */
  /* ------------------------------------------------------------------------ */

  const authStateKey = user?.workspaceId || user?.gstin || 'no-workspace';

  const [verifiedState, setVerifiedState] = useState(null);
  const isVerified =
    verifiedState?.key === authStateKey
      ? verifiedState.value
      : Boolean(user?.hasPortalSession);

  const setIsVerified = useCallback(
    (value) => setVerifiedState({ key: authStateKey, value }),
    [authStateKey]
  );

  const [authGstinOverride, setAuthGstinOverride] = useState(null);
  const authGstin =
    authGstinOverride?.key === authStateKey
      ? authGstinOverride.value
      : user?.gstin || user?.currentWorkspace?.gstin || '';

  const setAuthGstin = useCallback(
    (value) => setAuthGstinOverride({ key: authStateKey, value }),
    [authStateKey]
  );

  const [authUsernameOverride, setAuthUsernameOverride] = useState(null);
  const authUsername =
    authUsernameOverride?.key === authStateKey
      ? authUsernameOverride.value
      : user?.portalUsername || user?.username || user?.email?.split('@')[0] || '';

  const setAuthUsername = useCallback(
    (value) => setAuthUsernameOverride({ key: authStateKey, value }),
    [authStateKey]
  );

  const [otpState, setOtpState] = useState(null);
  const otpSent = otpState?.key === authStateKey && otpState.sent;
  const otpInput = otpState?.key === authStateKey ? otpState.value : '';

  const setOtpSent = useCallback(
    (sent) => setOtpState({ key: authStateKey, sent, value: '' }),
    [authStateKey]
  );

  const setOtpInput = useCallback(
    (value) =>
      setOtpState((previous) => ({
        key: authStateKey,
        sent: previous?.key === authStateKey && previous.sent,
        value
      })),
    [authStateKey]
  );

  const [taxpayerLookup, setTaxpayerLookup] = useState(null);
  const taxpayerDetails =
    taxpayerLookup?.gstin === String(authGstin || '').trim().toUpperCase()
      ? taxpayerLookup.details
      : null;

  const setTaxpayerDetails = useCallback(
    (details) =>
      setTaxpayerLookup({
        gstin: String(authGstin || '').trim().toUpperCase(),
        details
      }),
    [authGstin]
  );

  const [verifyingGstin, setVerifyingGstin] = useState(false);
  const [authConsent, setAuthConsent] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authErrorMsg, setAuthErrorMsg] = useState(null);
  const [authSuccessMsg, setAuthSuccessMsg] = useState(null);

  /* ------------------------------------------------------------------------ */
  /* Modals and Active Section State                                          */
  /* ------------------------------------------------------------------------ */

  const [activeSectionKey, setActiveSectionKey] = useState(null);
  const [isNilModalOpen, setIsNilModalOpen] = useState(false);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
  const [isEvcModalOpen, setIsEvcModalOpen] = useState(false);

  const [evcReturnType, setEvcReturnType] = useState('GSTR1');
  const [nilReturnType, setNilReturnType] = useState('GSTR1');

  const anyModalOpen = Boolean(
    activeSectionKey ||
    isJsonModalOpen ||
    isNilModalOpen ||
    isReconcileModalOpen ||
    isEvcModalOpen
  );

  const closeAllModals = useCallback(() => {
    setActiveSectionKey(null);
    setIsJsonModalOpen(false);
    setIsNilModalOpen(false);
    setIsReconcileModalOpen(false);
    setIsEvcModalOpen(false);
  }, []);

  const modalContainerRef = useFocusTrap(anyModalOpen, closeAllModals);

  /* ------------------------------------------------------------------------ */
  /* Return Data Hook                                                         */
  /*                                                                          */
  /* Hook owns exclusions so InvoiceDrilldownModal toggle works correctly.    */
  /* ------------------------------------------------------------------------ */

  const {
    // GSTR-1 state
    gstr1Loading,
    gstr1Error,
    liveGstr1Error,
    prepareData,
    saveResult,
    setSaveResult,
    gstr1ViewMode,
    setGstr1ViewMode,
    liveGstr1Data,
    isDataNotAvailable,

    // GSTR-1 derived
    summary,
    sectionDetails,
    validationIssues,
    hasBlockingIssues,
    blockingIssueCount,
    gstr1Warnings,
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

    // GSTR-2B state
    gstr2bData,
    g2bTotals,
    g2bTotalTax,
    g2bCount,
    gstr2bListedItc,

    // GSTR-3B state
    gstr3bData,
    g3bOutwardRows,
    g3bItcRows,
    outwardLiability,
    outwardTaxableTurnover,
    g3bItcAvailable,

    // Other returns status
    otherReturnsLoading,
    otherReturnsError,
    setOtherReturnsError,

    // Actions
    fetchGstr1Data,
    fetchOtherReturns,

    // Exclusions
    excludedIds,
    canModifyExclusions,
    toggleExcludeInvoice,
    handleExcludeAll,
    handleIncludeAll,
    clearExclusions,

    // Seeding
    seeding,
    seedSuccessMsg,
    handleSeedSampleInvoices,

    // Filing history/status
    filings,
    gstr1Filing,
    gstr3bFiling,
    gstr1ReadyFiling,
    gstr3bReadyFiling
  } = useReturnData(period);

  /* ------------------------------------------------------------------------ */
  /* Auth handlers                                                            */
  /* ------------------------------------------------------------------------ */

  const handleAuthSuccess = useCallback(() => {
    setIsVerified(true);
    setAuthErrorMsg(null);
    setAuthSuccessMsg('GST portal session verified.');
    setNotice({
      type: 'success',
      message: 'GST portal session verified. Loading live return data...'
    });

    fetchGstr1Data(period, undefined, gstr1ViewMode === 'taxpro');
    fetchOtherReturns(period);
  }, [
    period,
    gstr1ViewMode,
    fetchGstr1Data,
    fetchOtherReturns,
    setIsVerified
  ]);

  const handleSwitchGstin = useCallback(() => {
    if (
      !window.confirm(
        'Switch GSTIN? This will clear all current return data and portal session state.'
      )
    ) {
      return;
    }

    setIsVerified(false);
    setOtpSent(false);
    setOtpInput('');
    setAuthSuccessMsg(null);
    setAuthErrorMsg(null);
    setSaveResult(null);
    setFilingPending(null);
    setNotice(null);
    clearExclusions();
    closeAllModals();
  }, [
    setIsVerified,
    setOtpSent,
    setOtpInput,
    setSaveResult,
    clearExclusions,
    closeAllModals
  ]);

  /* ------------------------------------------------------------------------ */
  /* Period / return handlers                                                 */
  /* ------------------------------------------------------------------------ */

  const handlePeriodChange = useCallback(
    (newPeriod) => {
      const p = String(newPeriod || '').trim();

      if (!isValidPeriod(p)) {
        setNotice({
          type: 'error',
          message: 'Invalid return period. Period must be MMYYYY and cannot be in the future.'
        });
        return;
      }

      if (isFuturePeriod(p)) {
        setNotice({
          type: 'error',
          message: 'Return period cannot be in the future.'
        });
        return;
      }

      setPeriod(p);
      clearExclusions();
      setSaveResult(null);
      setFilingPending(null);
      setActiveSectionKey(null);
      setNotice(null);

      if (isVerified) {
        fetchOtherReturns(p);
      }
    },
    [clearExclusions, setSaveResult, isVerified, fetchOtherReturns]
  );

  const handleSelectReturnCard = useCallback(
    (returnKey) => {
      const key = normalizeReturnKey(returnKey) || 'gstr1';
      setSelectedReturn(key);
      setNotice(null);

      if (key === 'gstr1' && !prepareData) {
        fetchGstr1Data(period, undefined, false);
      }
    },
    [period, prepareData, fetchGstr1Data]
  );

  /* ------------------------------------------------------------------------ */
  /* Filing refresh helpers                                                   */
  /* ------------------------------------------------------------------------ */

  const refreshAfterFiling = useCallback(
    (type) => {
      const filingType = normalizeReturnType(type);

      // Always refresh GSTR-1 prepare + summary/filings.
      fetchGstr1Data(
        period,
        undefined,
        gstr1ViewMode === 'taxpro' && isVerified
      );

      // Refresh GSTR-2B/GSTR-3B if portal session exists or filing was GSTR-3B.
      if (filingType === 'GSTR3B' || isVerified) {
        fetchOtherReturns(period);
      }
    },
    [
      period,
      gstr1ViewMode,
      isVerified,
      fetchGstr1Data,
      fetchOtherReturns
    ]
  );

  const handleEvcSuccess = useCallback(
    (result) => {
      const type = normalizeReturnType(result?.type || evcReturnType);
      const arn = result?.arn || null;

      setSaveResult({
        message:
          result?.message ||
          `${type} successfully filed with EVC verification!`,
        ref_id: arn,
        gstin: authGstin
      });

      setFilingPending(null);
      setNotice({
        type: 'success',
        message: arn
          ? `${type} filed successfully. ARN: ${arn}`
          : `${type} filed successfully.`
      });

      refreshAfterFiling(type);
    },
    [evcReturnType, authGstin, setSaveResult, refreshAfterFiling]
  );

  const handleEvcPending = useCallback(
    (pending) => {
      const type = normalizeReturnType(pending?.type || evcReturnType);

      setFilingPending({
        type,
        period,
        message:
          pending?.message ||
          'The GST portal did not confirm the filing yet. Please check filing status before retrying.',
        referenceId:
          pending?.referenceId ||
          pending?.reference_id ||
          pending?.refId ||
          null
      });

      setNotice(null);
    },
    [evcReturnType, period]
  );

  const handleNilSuccess = useCallback(
    (result) => {
      const type = normalizeReturnType(result?.type || nilReturnType);
      const arn = result?.arn || null;

      setSaveResult({
        message:
          result?.message ||
          `Nil ${type} successfully filed under CGST Rule 67A!`,
        ref_id: arn,
        gstin: authGstin
      });

      setFilingPending(null);
      setNotice({
        type: 'success',
        message: arn
          ? `Nil ${type} filed successfully. ARN: ${arn}`
          : `Nil ${type} filed successfully.`
      });

      refreshAfterFiling(type);
    },
    [nilReturnType, authGstin, setSaveResult, refreshAfterFiling]
  );

  const handleNilPending = useCallback(
    (pending) => {
      const type = normalizeReturnType(pending?.type || nilReturnType);

      setFilingPending({
        type,
        period,
        message:
          pending?.message ||
          'The GST portal did not confirm the nil filing yet. Please check filing status before retrying.',
        referenceId:
          pending?.referenceId ||
          pending?.reference_id ||
          pending?.refId ||
          null
      });

      setNotice(null);
    },
    [nilReturnType, period]
  );

  /* ------------------------------------------------------------------------ */
  /* Modal open handlers                                                      */
  /* ------------------------------------------------------------------------ */

  const openEvcModal = useCallback((type = 'GSTR1') => {
    setEvcReturnType(normalizeReturnType(type));
    setIsEvcModalOpen(true);
    setNotice(null);
  }, []);

  const openNilModal = useCallback(
    (type) => {
      const resolved = normalizeReturnType(
        type || (selectedReturn === 'gstr3b' ? 'GSTR3B' : 'GSTR1')
      );

      setNilReturnType(resolved);
      setIsNilModalOpen(true);
      setNotice(null);
    },
    [selectedReturn]
  );

  /* ------------------------------------------------------------------------ */
  /* Memoized section cards                                                   */
  /* ------------------------------------------------------------------------ */

  const sectionCards = useMemo(
    () =>
      buildSectionCards({
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
      }),
    [
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
    ]
  );

  const { paginatedItems: paginatedSectionCards } = usePagination(
    sectionCards,
    10
  );

  const activeSection = sectionCards.find((c) => c.key === activeSectionKey);

  /* ------------------------------------------------------------------------ */
  /* Due date                                                                 */
  /* ------------------------------------------------------------------------ */

  const dueDateDisplay = useMemo(() => getDueDateDisplay(period), [period]);
  const currentIstPeriod = useMemo(() => getCurrentIstPeriod(), []);
  const isCurrentPeriodSelected = period === currentIstPeriod;

  /* ------------------------------------------------------------------------ */
  /* Render helpers                                                           */
  /* ------------------------------------------------------------------------ */

  const renderNotice = () => {
    if (!notice) return null;

    const isError = notice.type === 'error';
    const isSuccess = notice.type === 'success';

    return (
      <div
        role={isError ? 'alert' : 'status'}
        className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${isError
            ? 'border-rose-200 bg-rose-50 text-rose-800'
            : isSuccess
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-indigo-200 bg-indigo-50 text-indigo-800'
          }`}
      >
        <div className="flex items-start gap-2">
          {isError ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : isSuccess ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{notice.message}</span>
        </div>

        <button
          type="button"
          onClick={() => setNotice(null)}
          className="shrink-0 rounded p-1 hover:bg-black/5"
          aria-label="Dismiss notice"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const renderPendingFilingBanner = () => {
    if (!filingPending) return null;

    return (
      <div
        role="status"
        className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <div className="flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">
              {filingPending.type} filing status is pending
            </div>
            <div className="mt-1 text-xs">
              {filingPending.message}
            </div>
            {filingPending.referenceId && (
              <div className="mt-1 font-mono text-[11px]">
                Reference: {filingPending.referenceId}
              </div>
            )}
            <div className="mt-1 text-[11px] font-semibold text-amber-800">
              Do not file again immediately. Please check Filing History or GST portal status.
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshAfterFiling(filingPending.type)}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Refresh Status
          </Button>
          <button
            type="button"
            onClick={() => setFilingPending(null)}
            className="rounded p-1 hover:bg-black/5"
            aria-label="Dismiss pending notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  const renderGstr1BlockingIssues = () => {
    if (selectedReturn !== 'gstr1') return null;
    if (!hasBlockingIssues) return null;

    const invalidInvoiceNumbers = validationIssues?.invalidInvoiceNumbers || [];
    const invalidDates = validationIssues?.invalidDates || [];
    const invalidHsn = validationIssues?.invalidHsn || [];
    const missingIrn = validationIssues?.missingIrn || [];
    const unclassifiedZeroRate = validationIssues?.unclassifiedZeroRate || [];
    const warnings = gstr1Warnings || [];

    return (
      <div
        role="alert"
        className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <div className="flex-1">
            <div className="font-semibold">
              GSTR-1 filing blocked: {blockingIssueCount} data issue(s) found.
            </div>

            <div className="mt-2 space-y-2 text-xs">
              {invalidInvoiceNumbers.length > 0 && (
                <div>
                  <strong>Invalid invoice numbers:</strong>{' '}
                  {invalidInvoiceNumbers
                    .slice(0, 5)
                    .map((x) => getIssueLabel(x, 'Unknown'))
                    .join(', ')}
                  {invalidInvoiceNumbers.length > 5 ? ' ...' : ''}
                </div>
              )}

              {invalidDates.length > 0 && (
                <div>
                  <strong>Invalid invoice dates:</strong>{' '}
                  {invalidDates
                    .slice(0, 5)
                    .map((x) => getIssueLabel(x, 'Unknown'))
                    .join(', ')}
                  {invalidDates.length > 5 ? ' ...' : ''}
                </div>
              )}

              {invalidHsn.length > 0 && (
                <div>
                  <strong>Invalid HSN/SAC:</strong>{' '}
                  {invalidHsn
                    .slice(0, 5)
                    .map((x) => getIssueLabel(x, 'Unknown'))
                    .join(', ')}
                  {invalidHsn.length > 5 ? ' ...' : ''}
                </div>
              )}

              {missingIrn.length > 0 && (
                <div>
                  <strong>Missing IRN:</strong>{' '}
                  {missingIrn
                    .slice(0, 5)
                    .map((x) => getIssueLabel(x, 'Unknown'))
                    .join(', ')}
                  {missingIrn.length > 5 ? ' ...' : ''}
                </div>
              )}

              {unclassifiedZeroRate.length > 0 && (
                <div>
                  <strong>Unclassified zero-rated supplies:</strong>{' '}
                  {unclassifiedZeroRate
                    .slice(0, 5)
                    .map((x) => getIssueLabel(x, 'Unknown'))
                    .join(', ')}
                  {unclassifiedZeroRate.length > 5 ? ' ...' : ''}
                </div>
              )}

              {warnings.length > 0 && (
                <div className="pt-1 text-slate-600">
                  <strong>Warnings:</strong>
                  <ul className="mt-1 list-disc pl-4">
                    {warnings.slice(0, 5).map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderErrorBanner = ({
    title,
    error,
    onRetry,
    retrying
  }) => {
    if (!error) return null;

    const message =
      error?.message ||
      error?.error ||
      'Request failed. Please try again.';

    const code = error?.code || null;
    const errorCd = error?.errorCd || error?.error_cd || null;
    const retryAfter = error?.rateLimit?.retryAfterSeconds || null;

    return (
      <div
        role="alert"
        className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
      >
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">{title}</div>
            <div className="mt-1 text-xs">{message}</div>

            {(code || errorCd || retryAfter) && (
              <div className="mt-1 space-x-2 font-mono text-[10px] text-rose-500">
                {code && <span>Code: {code}</span>}
                {errorCd && <span>GSTN: {errorCd}</span>}
                {retryAfter && <span>Retry after: {retryAfter}s</span>}
              </div>
            )}
          </div>
        </div>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="shrink-0 font-semibold underline disabled:opacity-50"
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
      </div>
    );
  };

  /* ------------------------------------------------------------------------ */
  /* RENDER: AUTH SCREEN                                                      */
  /* ------------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------------ */
  /* RENDER: MAIN DASHBOARD                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <PageHeader
        title="GST Return Hub"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-1.5 text-xs font-medium text-amber-900 shadow-2xs">
              <Calendar className="h-3.5 w-3.5 text-amber-600" />
              <span>
                Due:{' '}
                <strong className="font-semibold text-amber-700">
                  {dueDateDisplay}
                </strong>
              </span>
            </div>

            <PeriodSelector
              selectedPeriod={period}
              onPeriodChange={handlePeriodChange}
            />

            <Button
              variant="outline"
              size="sm"
              onClick={handleSwitchGstin}
              className="border-indigo-200 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-50"
              title="Authenticate with GST Portal OTP or re-verify credentials"
            >
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5 text-indigo-600" />
              <span>Portal Login (OTP)</span>
            </Button>
          </div>
        }
      />

      {/* Notices */}
      {renderNotice()}
      {renderPendingFilingBanner()}

      {/* Current period warning */}
      {isCurrentPeriodSelected && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <strong>Current tax period is not closed.</strong>{' '}
              Filing for an ongoing month may be premature if transactions can
              still occur in the same period.
            </div>
          </div>
        </div>
      )}

      {/* GSTR-1 local prepare error */}
      {selectedReturn === 'gstr1' &&
        renderErrorBanner({
          title: 'GSTR-1 preparation failed',
          error: gstr1Error,
          retrying: gstr1Loading,
          onRetry: () => fetchGstr1Data(period, undefined, false)
        })}

      {/* Live GSTR-1 portal error */}
      {selectedReturn === 'gstr1' &&
        gstr1ViewMode === 'taxpro' &&
        renderErrorBanner({
          title: 'Live GSTR-1 portal data failed',
          error: liveGstr1Error,
          retrying: gstr1Loading,
          onRetry: () => fetchGstr1Data(period, undefined, true)
        })}

      {/* Other returns error */}
      {renderErrorBanner({
        title: 'GSTR-2B / GSTR-3B data failed',
        error: otherReturnsError,
        retrying: otherReturnsLoading,
        onRetry: () => fetchOtherReturns(period)
      })}

      {/* GSTR-1 blocking validation issues */}
      {renderGstr1BlockingIssues()}

      {/* No data calm state */}
      {selectedReturn === 'gstr1' && isDataNotAvailable && !gstr1Loading && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          No GSTR-1 data is available for this period yet. Try another month or
          check invoice/bill records.
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
        isG1Ready={Boolean(gstr1ReadyFiling)}
        isG3bReady={Boolean(gstr3bReadyFiling)}
      />

      {/* DRC Audit Simulator */}
      {isPortalGstr1Active &&
        gstr3bData &&
        gstr2bData &&
        g3bOutwardRows.length &&
        g3bItcRows.length ? (
        <DrcAuditSimulator
          gstr1Tax={g1TotalTax}
          gstr3bTax={totalTaxForRows(g3bOutwardRows)}
          gstr2bItc={g2bTotalTax}
          gstr3bItc={g3bItcAvailable}
        />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Statutory risk comparison is unavailable until GSTR-1, GSTR-2B and
          GSTR-3B return data is loaded.
        </div>
      )}

      {/* GSTR-1 View */}
      {selectedReturn === 'gstr1' && (
        <Gstr1Dashboard
          period={period}
          gstr1Loading={gstr1Loading}
          gstr1Error={gstr1Error}
          liveGstr1Error={liveGstr1Error}
          prepareData={prepareData}
          liveGstr1Data={liveGstr1Data}
          gstr1ViewMode={gstr1ViewMode}
          setGstr1ViewMode={setGstr1ViewMode}
          excludedIds={excludedIds}
          canModifyExclusions={canModifyExclusions}
          fetchGstr1Data={fetchGstr1Data}
          onOpenNilModal={() => openNilModal('GSTR1')}
          onOpenJsonModal={() => setIsJsonModalOpen(true)}
          onOpenEvcModal={() => openEvcModal('GSTR1')}
          saveResult={saveResult}
          summary={summary}
          sectionDetails={sectionDetails}
          validationIssues={validationIssues}
          hasBlockingIssues={hasBlockingIssues}
          blockingIssueCount={blockingIssueCount}
          warnings={gstr1Warnings}
          isDataNotAvailable={isDataNotAvailable}
          SECTION_CARDS={paginatedSectionCards || sectionCards}
          onSectionCardClick={(key) => setActiveSectionKey(key)}
          seeding={seeding}
          seedSuccessMsg={seedSuccessMsg}
          handleSeedSampleInvoices={handleSeedSampleInvoices}
          ActionBarComponent={ActionBar}
          SectionCardsComponent={SectionCards}
          EmptyStatesComponent={EmptyStates}
          gstr1Filing={gstr1Filing}
          gstr1ReadyFiling={gstr1ReadyFiling}
        />
      )}

      {/* GSTR-2B View */}
      {selectedReturn === 'gstr2b' && (
        <Gstr2bView
          period={period}
          gstr2bData={gstr2bData}
          otherReturnsLoading={otherReturnsLoading}
          fetchGstr2bData={fetchOtherReturns}
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
          fetchGstr3bData={fetchOtherReturns}
          onOpenNilModal={(type = 'GSTR3B') => openNilModal(type)}
          onOpenEvcModal={(type = 'GSTR3B') => openEvcModal(type)}
          outwardLiability={outwardLiability}
          g3bItcAvailable={g3bItcAvailable}
          gstr3bFiling={gstr3bFiling}
          gstr3bReadyFiling={gstr3bReadyFiling}
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

        {/* Nil Return Modal */}
        <NilReturnModal
          isOpen={isNilModalOpen}
          onClose={() => setIsNilModalOpen(false)}
          initialPeriod={period}
          initialType={nilReturnType}
          gstin={authGstin}
          username={authUsername}
          onSuccess={handleNilSuccess}
          onPending={handleNilPending}
        />

        {/* ITC Reconciliation Modal */}
        <ItcReconciliationModal
          isOpen={isReconcileModalOpen}
          onClose={() => setIsReconcileModalOpen(false)}
          period={period}
        />

        {/* EVC Filing Modal */}
        <Gstr1EvcModal
          isOpen={isEvcModalOpen}
          onClose={() => setIsEvcModalOpen(false)}
          period={period}
          gstin={authGstin}
          username={authUsername}
          workspaceName={
            user?.workspaceName || user?.currentWorkspace?.name || ''
          }
          returnType={evcReturnType}
          summary={
            evcReturnType === 'GSTR3B'
              ? {
                totalTaxable: outwardTaxableTurnover,
                totalTax: outwardLiability
              }
              : summary
          }
          excludedInvoiceIds={excludedIds}
          requiresOffset={evcReturnType === 'GSTR3B'}
          alreadyPrepared={false}
          onSuccess={handleEvcSuccess}
          onPending={handleEvcPending}
        />
      </div>
    </div>
  );
}