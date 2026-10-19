export default function PeriodSelector({ selectedPeriod, onPeriodChange, availablePeriods = [] }) {
  return (
    <div className="d-flex align-items-center gap-2">
      <label htmlFor="period-select" className="form-label mb-0 text-nowrap fw-semibold small text-secondary">
        Return Period:
      </label>
      <select
        id="period-select"
        value={selectedPeriod}
        onChange={(e) => onPeriodChange?.(e.target.value)}
        className="form-select form-select-sm font-monospace"
        style={{ width: 'auto', minWidth: '160px' }}
      >
        {availablePeriods.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
        {availablePeriods.length === 0 && (
          <option value="092026">092026 (Sep 2026)</option>
        )}
      </select>
    </div>
  );
}
