import { useEffect, useMemo, useRef } from 'react';
import {
  getCurrentIstPeriod,
  getLastMonthPeriod,
  isValidPeriod,
  isFuturePeriod
} from '../utils/validators';

const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' }
];

/**
 * IST-aware Period Selector.
 *
 * Emits MMYYYY.
 * Future periods are blocked.
 * Current period is allowed by default, but shown with warning.
 *
 * Props:
 * - selectedPeriod: string MMYYYY
 * - onPeriodChange: (period: string) => void
 * - allowCurrentPeriod: boolean, default true
 * - autoCorrectInvalidPeriod: boolean, default true
 * - minYear: number, default 2018
 */
export default function PeriodSelector({
  selectedPeriod,
  onPeriodChange,
  allowCurrentPeriod = true,
  autoCorrectInvalidPeriod = true,
  minYear = 2018
}) {
  const onPeriodChangeRef = useRef(onPeriodChange);

  useEffect(() => {
    onPeriodChangeRef.current = onPeriodChange;
  }, [onPeriodChange]);

  /* ------------------------------------------------------------------------ */
  /* IST current/fallback periods                                             */
  /* ------------------------------------------------------------------------ */

  const currentPeriod = useMemo(() => getCurrentIstPeriod(), []);
  const fallbackPeriod = useMemo(() => getLastMonthPeriod(), []);

  const currentYear = Number(currentPeriod.slice(2));
  const currentMonth = currentPeriod.slice(0, 2);

  /* ------------------------------------------------------------------------ */
  /* Validation helper                                                        */
  /* ------------------------------------------------------------------------ */

  const isAllowedPeriod = useMemo(() => {
    return (value) => {
      const period = String(value || '').trim();

      if (!isValidPeriod(period)) {
        return false;
      }

      if (!allowCurrentPeriod && period === currentPeriod) {
        return false;
      }

      return true;
    };
  }, [allowCurrentPeriod, currentPeriod]);

  /* ------------------------------------------------------------------------ */
  /* Active period                                                            */
  /* ------------------------------------------------------------------------ */

  const activePeriod = useMemo(() => {
    return isAllowedPeriod(selectedPeriod)
      ? String(selectedPeriod).trim()
      : fallbackPeriod;
  }, [selectedPeriod, fallbackPeriod, isAllowedPeriod]);

  const selectedMonth = activePeriod.slice(0, 2);
  const selectedYear = activePeriod.slice(2, 6);

  /* ------------------------------------------------------------------------ */
  /* Auto-correct invalid/future/disallowed parent period                     */
  /* ------------------------------------------------------------------------ */

  const correctionRef = useRef(null);

  useEffect(() => {
    const hasSelectedPeriod = Boolean(selectedPeriod);
    const invalidOrDisallowed =
      hasSelectedPeriod && !isAllowedPeriod(selectedPeriod);

    if (!autoCorrectInvalidPeriod || !invalidOrDisallowed) {
      correctionRef.current = null;
      return;
    }

    if (correctionRef.current === fallbackPeriod) {
      return;
    }

    correctionRef.current = fallbackPeriod;
    onPeriodChangeRef.current?.(fallbackPeriod);
  }, [
    selectedPeriod,
    autoCorrectInvalidPeriod,
    fallbackPeriod,
    isAllowedPeriod
  ]);

  /* ------------------------------------------------------------------------ */
  /* Year list                                                                */
  /* ------------------------------------------------------------------------ */

  const years = useMemo(() => {
    const set = new Set();

    const safeMinYear = Math.min(Number(minYear) || 2018, currentYear);

    for (let y = currentYear; y >= safeMinYear; y -= 1) {
      set.add(String(y));
    }

    // Include selected year if parent passed an older valid period.
    if (selectedYear && /^\d{4}$/.test(selectedYear)) {
      set.add(selectedYear);
    }

    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [currentYear, minYear, selectedYear]);

  /* ------------------------------------------------------------------------ */
  /* Candidate resolver                                                       */
  /* ------------------------------------------------------------------------ */

  const resolveCandidate = (candidate) => {
    const period = String(candidate || '').trim();

    if (!isValidPeriod(period)) {
      return null;
    }

    if (!allowCurrentPeriod && period === currentPeriod) {
      return fallbackPeriod;
    }

    return period;
  };

  /* ------------------------------------------------------------------------ */
  /* Handlers                                                                 */
  /* ------------------------------------------------------------------------ */

  const handleMonthChange = (event) => {
    const month = event.target.value;
    const candidate = `${month}${selectedYear}`;
    const resolved = resolveCandidate(candidate);

    if (resolved) {
      onPeriodChangeRef.current?.(resolved);
    }
  };

  const handleYearChange = (event) => {
    const newYear = event.target.value;
    let candidate = `${selectedMonth}${newYear}`;

    // If selected month becomes future after year change, clamp safely.
    if (!isValidPeriod(candidate)) {
      candidate = allowCurrentPeriod ? currentPeriod : fallbackPeriod;
    }

    const resolved = resolveCandidate(candidate);

    if (resolved) {
      onPeriodChangeRef.current?.(resolved);
    }
  };

  /* ------------------------------------------------------------------------ */
  /* Render helpers                                                           */
  /* ------------------------------------------------------------------------ */

  const isCurrentPeriodSelected = activePeriod === currentPeriod;

  return (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      <span className="text-secondary small fw-semibold">Period:</span>

      {/* Month Dropdown */}
      <div className="d-inline-flex align-items-center">
        <label htmlFor="period-month-select" className="visually-hidden">
          Return Month
        </label>

        <select
          id="period-month-select"
          className="form-select form-select-sm"
          value={selectedMonth}
          onChange={handleMonthChange}
          style={{ width: 'auto', minWidth: '150px' }}
          aria-describedby="period-selector-help"
        >
          {MONTHS.map((m) => {
            const periodForMonth = `${m.value}${selectedYear}`;
            const future = isFuturePeriod(periodForMonth);
            const isCurrent =
              m.value === currentMonth && selectedYear === String(currentYear);

            const disabled = future || (!allowCurrentPeriod && isCurrent);

            const suffix = future
              ? ' (Future)'
              : isCurrent
                ? ' (Current)'
                : '';

            return (
              <option
                key={m.value}
                value={m.value}
                disabled={disabled}
              >
                {m.label}
                {suffix}
              </option>
            );
          })}
        </select>
      </div>

      {/* Year Dropdown */}
      <div className="d-inline-flex align-items-center">
        <label htmlFor="period-year-select" className="visually-hidden">
          Return Year
        </label>

        <select
          id="period-year-select"
          className="form-select form-select-sm font-monospace"
          value={selectedYear}
          onChange={handleYearChange}
          style={{ width: 'auto', minWidth: '110px' }}
          aria-describedby="period-selector-help"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
              {y === String(currentYear) ? ' (Current)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Help / Warning */}
      <div
        id="period-selector-help"
        className="w-100 small text-secondary"
      >
        {isCurrentPeriodSelected ? (
          <span className="text-warning fw-semibold">
            Current tax period is not closed. Filing may be premature if
            transactions can still occur in this period.
          </span>
        ) : (
          <span>
            Selected: <strong className="font-monospace">{activePeriod}</strong>
          </span>
        )}
      </div>
    </div>
  );
}