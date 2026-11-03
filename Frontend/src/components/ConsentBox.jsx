export default function ConsentBox({ checked, onChange, disabled }) {
  return (
    <div className="flex items-start gap-2.5 my-3 text-left">
      <input
        type="checkbox"
        id="consent-checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 rounded border-surface-border text-brand-600 focus:ring-brand-500 cursor-pointer disabled:opacity-50"
        required
      />
      <label
        htmlFor="consent-checkbox"
        className="text-[11px] text-slate-500 leading-snug select-none cursor-pointer"
      >
        I authorize the application to fetch GST returns and tax compliance data on my behalf from the GST Portal via authorized GST Suvidha Provider (GSP).
      </label>
    </div>
  );
}
