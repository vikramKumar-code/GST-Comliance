import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import ErrorMessage from '../ErrorMessage';
import ActionBar from './ActionBar';
import SectionCards from './SectionCards';
import EmptyStates, { PortalGstr1EmptyState, LocalGstr1EmptyState, SeedSuccessAlert } from './EmptyStates';

/**
 * Main GSTR-1 view container
 * @param {Object} props
 * @param {string} props.period
 * @param {boolean} props.gstr1Loading
 * @param {Error|null} props.gstr1Error
 * @param {Object|null} props.prepareData
 * @param {Object|null} props.liveGstr1Data
 * @param {string} props.gstr1ViewMode 'local' | 'taxpro'
 * @param {Function} props.setGstr1ViewMode
 * @param {Set|Array} props.excludedIds
 * @param {Function} props.fetchGstr1Data
 * @param {Function} props.onOpenNilModal
 * @param {Function} props.onOpenJsonModal
 * @param {Function} props.onOpenEvcModal
 * @param {Object|null} props.saveResult
 * @param {Object} props.summary
 * @param {Object} props.sectionDetails
 * @param {Array} props.SECTION_CARDS
 * @param {Function} props.onSectionCardClick
 * @param {boolean} props.seeding
 * @param {string|null} props.seedSuccessMsg
 * @param {Function} props.handleSeedSampleInvoices
 * @param {React.ComponentType} [props.ActionBarComponent]
 * @param {React.ComponentType} [props.SectionCardsComponent]
 * @param {React.ComponentType} [props.EmptyStatesComponent]
 */
export function Gstr1Dashboard({
  period,
  gstr1Loading,
  gstr1Error,
  liveGstr1Data,
  gstr1ViewMode,
  setGstr1ViewMode,
  excludedIds,
  fetchGstr1Data,
  onOpenNilModal,
  onOpenJsonModal,
  onOpenEvcModal,
  saveResult,
  summary,
  SECTION_CARDS,
  onSectionCardClick,
  seeding,
  seedSuccessMsg,
  handleSeedSampleInvoices,
  gstr1Filing = null,
  // Aliases for backwards compatibility
  cards,
  onSelectSection,
  // Component injection
  ActionBarComponent = ActionBar,
  SectionCardsComponent = SectionCards,
  EmptyStatesComponent = EmptyStates
}) {
  const [dismissedSeedMsg, setDismissedSeedMsg] = useState(false);

  const isPortalGstr1Active = gstr1ViewMode === 'taxpro';
  const hasPortalGstr1 = Boolean(
    (liveGstr1Data?.totals?.taxable || 0) > 0 ||
    (liveGstr1Data?.rows && liveGstr1Data.rows.length > 0) ||
    liveGstr1Data?.fetchedAt
  );

  const cardsToRender = SECTION_CARDS || cards || [];
  const handleCardClick = onSectionCardClick || onSelectSection;
  const ActiveActionBar = ActionBarComponent || ActionBar;
  const ActiveSectionCards = SectionCardsComponent || SectionCards;

  return (
    <div className="space-y-4 pt-1">
      {/* Official Filing Banner (if return already filed on portal) */}
      {gstr1Filing && (
        <div
          className="p-4 sm:p-5 rounded-2xl border border-emerald-300 bg-gradient-to-r from-emerald-50 via-teal-50/50 to-emerald-50 text-emerald-950 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs animate-in fade-in duration-200"
          role="status"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm sm:text-base text-slate-900">
                  GSTR-1 Officially Filed on GST Portal
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 uppercase tracking-wide">
                  {gstr1Filing.isNil ? 'Nil Return' : 'Filed'}
                </span>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-xs text-slate-600 mt-0.5">
                <span>
                  ARN: <strong className="font-mono text-emerald-800 font-bold text-xs sm:text-sm">{gstr1Filing.arn}</strong>
                </span>
                {gstr1Filing.date && (
                  <span>• Date: <strong className="text-slate-700">{gstr1Filing.date}</strong></span>
                )}
                {gstr1Filing.mode && (
                  <span>• Mode: <strong className="text-slate-700 font-semibold">{gstr1Filing.mode}</strong></span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/returns/filing-history"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition"
            >
              <span>View Certificate</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* Top Header & ActionBar component */}
      <ActiveActionBar
        period={period}
        isPortalGstr1Active={isPortalGstr1Active}
        gstr1Loading={gstr1Loading}
        liveGstr1Data={liveGstr1Data}
        gstr1Filing={gstr1Filing}
        onToggleViewMode={(mode) => {
          if (setGstr1ViewMode) setGstr1ViewMode(mode);
          if (mode === 'taxpro' && fetchGstr1Data) {
            fetchGstr1Data(period, excludedIds, true);
          }
        }}
        onRefresh={() => {
          if (fetchGstr1Data) fetchGstr1Data(period, excludedIds, true);
        }}
        onOpenJsonModal={onOpenJsonModal}
        onOpenNilModal={onOpenNilModal}
        onOpenEvcModal={onOpenEvcModal}
        canFileEvc={isPortalGstr1Active || summary?.includedInvoices > 0}
      />

      {/* SaveResult banner (if exists) */}
      {saveResult && (
        <div
          className="p-4 rounded-xl border border-success-200 bg-success-50 text-success-900 flex items-center justify-between gap-3"
          role="status"
        >
          <div className="flex items-center gap-3 text-xs">
            <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0" />
            <div>
              <strong>{saveResult.message}</strong>
              <div className="font-mono opacity-80 mt-0.5">
                Reference ID: {saveResult.ref_id} • GSTIN: {saveResult.gstin}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ErrorMessage (if exists) */}
      {gstr1Error && (
        <ErrorMessage
          error={gstr1Error}
          onRetry={() => {
            if (fetchGstr1Data) {
              fetchGstr1Data(period, excludedIds, isPortalGstr1Active);
            }
          }}
        />
      )}

      {/* EmptyState banner: Portal */}
      {isPortalGstr1Active && !hasPortalGstr1 && !gstr1Loading && (
        EmptyStatesComponent ? (
          <EmptyStatesComponent
            type="no-portal-data"
            period={period}
            onAction={() => setGstr1ViewMode && setGstr1ViewMode('local')}
          />
        ) : (
          <PortalGstr1EmptyState
            period={period}
            onSwitchToLocal={() => setGstr1ViewMode && setGstr1ViewMode('local')}
          />
        )
      )}

      {/* EmptyState banner: Local Invoices */}
      {!isPortalGstr1Active && summary?.totalInvoices === 0 && !gstr1Loading && (
        EmptyStatesComponent ? (
          <EmptyStatesComponent
            type="no-invoices"
            period={period}
            seeding={seeding}
            onAction={(actionType) => {
              if (actionType === 'seed' && handleSeedSampleInvoices) handleSeedSampleInvoices();
              if (actionType === 'nil' && onOpenNilModal) onOpenNilModal();
            }}
          />
        ) : (
          <LocalGstr1EmptyState
            period={period}
            seeding={seeding}
            onSeed={handleSeedSampleInvoices}
            onOpenNilModal={onOpenNilModal}
          />
        )
      )}

      {/* SeedSuccessMsg banner */}
      {seedSuccessMsg && !dismissedSeedMsg && (
        <SeedSuccessAlert
          message={seedSuccessMsg}
          onDismiss={() => setDismissedSeedMsg(true)}
        />
      )}

      {/* SectionCards grid (with internal Loader when loading) */}
      <ActiveSectionCards
        cards={cardsToRender}
        loading={gstr1Loading}
        period={period}
        onCardClick={handleCardClick}
      />
    </div>
  );
}

export default Gstr1Dashboard;
