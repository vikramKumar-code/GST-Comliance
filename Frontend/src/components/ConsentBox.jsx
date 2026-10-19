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
      />
      <label htmlFor="consent-checkbox" className="form-check-label small text-secondary">
        I authorize the application to fetch GST returns and tax compliance data on my behalf from the GST Portal via FinAGG GSP.
      </label>
    </div>
  );
}
