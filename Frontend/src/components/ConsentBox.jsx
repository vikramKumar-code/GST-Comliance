export default function ConsentBox({ checked, onChange, disabled }) {
  return (
    <div className="form-check my-3 text-start">
      <input
        type="checkbox"
        id="consent-checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className="form-check-input"
        style={{ cursor: 'pointer' }}
        required
      />
      <label
        htmlFor="consent-checkbox"
        className="form-check-label small text-secondary user-select-none"
        style={{ cursor: 'pointer' }}
      >
        I authorize the application to fetch GST returns and tax compliance data on my behalf from the GST Portal via authorized GST Suvidha Provider (GSP).
      </label>
    </div>
  );
}
