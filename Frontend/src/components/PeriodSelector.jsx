import { useMemo } from 'react';

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
  { value: '12', label: 'December' },
];

/**
 * PeriodSelector with month and year dropdowns.
 * Defaults to last month, future months are not selectable, emits MMYYYY.
 */
export default function PeriodSelector({ selectedPeriod, onPeriodChange }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1; // 1 to 12

  // Default last month calculation
  const defaultPeriod = useMemo(() => {
    let m = currentMonthNum - 1;
    let y = currentYear;
    if (m === 0) {
      m = 12;
      y = currentYear - 1;
    }
    return `${String(m).padStart(2, '0')}${y}`;
  }, [currentMonthNum, currentYear]);

  const activePeriod = selectedPeriod || defaultPeriod;
  const currentSelectedMonth = activePeriod.slice(0, 2);
  const currentSelectedYear = activePeriod.slice(2, 6);

  // Available years: from 2020 to current year
  const years = useMemo(() => {
    const list = [];
    for (let y = currentYear; y >= 2020; y -= 1) {
      list.push(String(y));
    }
    return list;
  }, [currentYear]);

  const handleMonthChange = (e) => {
    const newMonth = e.target.value;
    const newPeriod = `${newMonth}${currentSelectedYear}`;
    onPeriodChange?.(newPeriod);
  };

  const handleYearChange = (e) => {
    const newYear = e.target.value;
    let newMonth = currentSelectedMonth;
    // If switching to current year and selected month is in the future, clamp to current/last month
    if (parseInt(newYear, 10) === currentYear && parseInt(newMonth, 10) > currentMonthNum) {
      newMonth = String(currentMonthNum).padStart(2, '0');
    }
    const newPeriod = `${newMonth}${newYear}`;
    onPeriodChange?.(newPeriod);
  };

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
          value={currentSelectedMonth}
          onChange={handleMonthChange}
          style={{ width: 'auto', minWidth: '130px' }}
        >
          {MONTHS.map((m) => {
            const isFuture =
              parseInt(currentSelectedYear, 10) === currentYear &&
              parseInt(m.value, 10) > currentMonthNum;
            return (
              <option key={m.value} value={m.value} disabled={isFuture}>
                {m.label} {isFuture ? '(Future)' : ''}
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
          value={currentSelectedYear}
          onChange={handleYearChange}
          style={{ width: 'auto', minWidth: '95px' }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
