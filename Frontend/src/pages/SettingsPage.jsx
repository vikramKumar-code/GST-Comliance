import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { linkGstin } from '../api/auth.api';
import { isValidGstin } from '../utils/validators';

export default function SettingsPage() {
  const { user, checkAuth } = useAuth();

  const [orgName, setOrgName] = useState('');
  const [gstinInput, setGstinInput] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('INV-YYYYMM-');
  const [paymentTerms, setPaymentTerms] = useState('Due on Receipt');

  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Tab navigation state
  const [settingsTab, setSettingsTab] = useState('profile');

  useEffect(() => {
    if (user) {
      if (user.gstin) setGstinInput(user.gstin);
      if (user.name) setOrgName(user.name);
    }
  }, [user]);

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanGstin = gstinInput.trim().toUpperCase();

    if (cleanGstin && !isValidGstin(cleanGstin)) {
      setErrorMsg('Invalid GSTIN format. Must be 15 alphanumeric characters (e.g. 33AANCS2882A1ZG).');
      return;
    }

    setSaving(true);
    try {
      const res = await linkGstin({
        gstin: cleanGstin,
        name: orgName.trim() || undefined
      });
      setSuccessMsg(res.message || 'Organization GSTIN updated successfully.');
      await checkAuth().catch(() => {});
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update organization GSTIN.');
    } finally {
      setSaving(false);
    }
  };

  const isLinked = Boolean(user?.gstin);

  const ROLE_DEFINITIONS = [
    {
      id: 'OWNER',
      title: '👑 Owner',
      desc: 'Full administrative control. Can delete workspace, link GSTIN, invite members, and file returns.',
      badgeClass: 'bg-success text-white'
    },
    {
      id: 'ADMIN',
      title: '🛡️ Admin',
      desc: 'Operations manager / Accountant. Can create invoices, E-Way bills, import spreadsheets, and reconcile ITC.',
      badgeClass: 'bg-primary text-white'
    },
    {
      id: 'MEMBER',
      title: '👤 Member',
      desc: 'Billing clerk. Can create and view sales invoices, purchase bills, and customer records.',
      badgeClass: 'bg-secondary text-white'
    },
    {
      id: 'VIEWER',
      title: '👁️ Viewer',
      desc: 'Auditor / CA Read-only. Can inspect invoices, tax registers, and return summaries without edit rights.',
      badgeClass: 'bg-light text-dark border'
    }
  ];

  return (
    <div>
      <div className="zoho-page-header">
        <h1 className="fw-bold fs-4 text-dark mb-1">Organization & Tax Settings</h1>
        <p className="text-secondary small mb-0">
          Manage your business profile, registered GSTIN, invoice prefixes, and team access roles.
        </p>
      </div>

      <div className="zoho-page-body" style={{ maxWidth: '850px' }}>
        {/* Status Alert Banner */}
        {successMsg && (
          <div className="alert alert-success d-flex align-items-center gap-2 py-2.5 px-3 mb-4 rounded-3 shadow-xs">
            <span className="fs-5">✅</span>
            <div className="small fw-semibold">{successMsg}</div>
          </div>
        )}

        {errorMsg && (
          <div className="alert alert-danger d-flex align-items-center gap-2 py-2.5 px-3 mb-4 rounded-3 shadow-xs">
            <span className="fs-5">⚠️</span>
            <div className="small fw-semibold">{errorMsg}</div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="d-flex gap-2 mb-4 pb-1 flex-wrap">
          <button
            type="button"
            className={`btn btn-sm px-3.5 py-1.5 rounded-pill fw-semibold shadow-xs d-flex align-items-center gap-1.5 ${
              settingsTab === 'profile' ? 'btn-primary' : 'btn-light border text-secondary'
            }`}
            onClick={() => setSettingsTab('profile')}
          >
            <span>🏢</span> Business Profile & GSTIN
          </button>
          <button
            type="button"
            className={`btn btn-sm px-3.5 py-1.5 rounded-pill fw-semibold shadow-xs d-flex align-items-center gap-1.5 ${
              settingsTab === 'roles' ? 'btn-primary' : 'btn-light border text-secondary'
            }`}
            onClick={() => setSettingsTab('roles')}
          >
            <span>🛡️</span> Role & Access Control (RBAC)
          </button>
        </div>

        {settingsTab === 'profile' && (
          <form onSubmit={handleSave}>
            <div className="card border shadow-sm bg-white p-4 mb-4">
              <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom">
                <div>
                  <h2 className="fs-6 fw-bold text-dark mb-0.5">Business & GSTIN Profile</h2>
                  <p className="text-muted small mb-0">
                    Link your 15-digit GSTIN to this workspace to enable automated billing, tax calculations, and return filings.
                  </p>
                </div>
                <span className={`badge px-2.5 py-1.5 rounded-pill ${isLinked ? 'bg-success-subtle text-success border border-success' : 'bg-warning-subtle text-dark border border-warning'}`}>
                  {isLinked ? `✓ Active: ${user.gstin}` : '⚠️ Unlinked GSTIN'}
                </span>
              </div>

            <div className="row g-3">
              <div className="col-12 col-md-6">
                <label className="form-label small fw-semibold text-secondary">
                  Organization / Business Name
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. Vikram Kumar's Enterprise"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                />
              </div>

              <div className="col-12 col-md-6">
                <label className="form-label small fw-semibold text-secondary">
                  Registered 15-Digit GSTIN
                </label>
                <input
                  type="text"
                  className="form-control font-monospace text-uppercase"
                  placeholder="e.g. 33AANCS2882A1ZG"
                  maxLength={15}
                  value={gstinInput}
                  onChange={(e) => setGstinInput(e.target.value.toUpperCase())}
                />
                <div className="form-text small text-muted">
                  {isLinked
                    ? 'Your organization is linked with this GSTIN.'
                    : 'Enter your 15-character GSTIN to link it to your account.'}
                </div>
              </div>

              <div className="col-12 col-md-6">
                <label className="form-label small fw-semibold text-secondary">Default Currency</label>
                <input type="text" className="form-control bg-light" value="INR (₹) - Indian Rupee" readOnly />
              </div>

              <div className="col-12 col-md-6">
                <label className="form-label small fw-semibold text-secondary">Invoice Number Prefix</label>
                <input
                  type="text"
                  className="form-control font-monospace"
                  value={invoicePrefix}
                  onChange={(e) => setInvoicePrefix(e.target.value)}
                />
              </div>

              <div className="col-12 col-md-6">
                <label className="form-label small fw-semibold text-secondary">Default Payment Terms</label>
                <select
                  className="form-select"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                >
                  <option value="Due on Receipt">Due on Receipt</option>
                  <option value="Net 15">Net 15 Days</option>
                  <option value="Net 30">Net 30 Days</option>
                  <option value="Net 60">Net 60 Days</option>
                </select>
              </div>
            </div>

            <div className="mt-4 pt-3 border-top text-end">
              <button
                type="submit"
                className="btn btn-primary btn-sm px-4 fw-semibold shadow-xs"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Organization & Link GSTIN'}
              </button>
            </div>
          </div>
        </form>
      )}

        {/* Role & Access Control Section */}
        {settingsTab === 'roles' && (
          <div className="card border shadow-sm bg-white p-4 mb-4" id="rbac-section">
            <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom flex-wrap gap-2">
              <div>
                <h2 className="fs-6 fw-bold text-dark mb-0.5">Role & Access Control (RBAC)</h2>
                <p className="text-muted small mb-0">
                  Overview of workspace roles and your current permissions tier.
                </p>
              </div>
              <span className="badge bg-success-subtle text-success border border-success px-2.5 py-1.5 rounded-pill fw-semibold">
                Active Role: {user?.workspaceRole || 'OWNER'}
              </span>
            </div>

            <div className="row g-3">
              {ROLE_DEFINITIONS.map((r) => {
                const isCurrent = (user?.workspaceRole || 'OWNER') === r.id;
                return (
                  <div key={r.id} className="col-12 col-sm-6">
                    <div
                      className={`border rounded-3 p-3 h-100 ${
                        isCurrent
                          ? 'border-success bg-success-subtle bg-opacity-25 shadow-xs'
                          : 'bg-white border-light-subtle'
                      }`}
                    >
                      <div className="d-flex align-items-center justify-content-between mb-1.5">
                        <span className="fw-bold text-dark small">{r.title}</span>
                        {isCurrent && (
                          <span className="badge bg-success text-white" style={{ fontSize: '0.7rem' }}>
                            ✓ Current Role
                          </span>
                        )}
                      </div>
                      <p className="text-secondary small mb-0" style={{ fontSize: '0.78rem', lineHeight: 1.45 }}>
                        {r.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


