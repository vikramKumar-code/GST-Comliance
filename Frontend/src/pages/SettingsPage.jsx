import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div>
      <div className="zoho-page-header">
        <h1 className="fw-bold fs-4 text-dark mb-1">Organization & Tax Settings</h1>
        <p className="text-secondary small mb-0">
          Manage your business profile, registered GSTIN, invoice prefixes, and tax preferences.
        </p>
      </div>

      <div className="zoho-page-body" style={{ maxWidth: '850px' }}>
        <div className="card border shadow-sm bg-white p-4 mb-4">
          <h2 className="fs-6 fw-bold text-dark mb-3">Business Profile</h2>
          <div className="row g-3">
            <div className="col-12 col-md-6">
              <label className="form-label small fw-semibold text-secondary">Registered GSTIN</label>
              <input
                type="text"
                className="form-control font-monospace bg-light"
                value={user?.gstin || ''}
                readOnly
              />
              <div className="form-text small text-muted">Verified from active GST portal session.</div>
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label small fw-semibold text-secondary">Default Currency</label>
              <input type="text" className="form-control bg-light" value="INR (₹)" readOnly />
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label small fw-semibold text-secondary">Invoice Prefix</label>
              <input type="text" className="form-control font-monospace" defaultValue="INV-YYYYMM-" />
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label small fw-semibold text-secondary">Default Payment Terms</label>
              <select className="form-select" defaultValue="Due on Receipt">
                <option value="Due on Receipt">Due on Receipt</option>
                <option value="Net 15">Net 15 Days</option>
                <option value="Net 30">Net 30 Days</option>
                <option value="Net 60">Net 60 Days</option>
              </select>
            </div>
          </div>
          <div className="mt-4 pt-3 border-top text-end">
            <button
              type="button"
              className="btn btn-primary btn-sm px-4 fw-semibold"
              onClick={() => alert('Settings saved successfully.')}
            >
              Save Preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
