export default function GstinForm({ onSearch, loading }) {
  return (
    <div className="card gstin-form-placeholder">
      <h3>GSTIN Search</h3>
      <p className="placeholder-subtext">GSTIN input and business search component placeholder (Task F2).</p>
      {loading && <p className="loading-hint">Searching...</p>}
      <button
        type="button"
        style={{ display: 'none' }}
        onClick={() => onSearch?.('')}
        aria-hidden="true"
      >
        Search
      </button>
    </div>
  );
}
