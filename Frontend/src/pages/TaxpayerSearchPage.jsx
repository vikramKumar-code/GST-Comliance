import { useState } from 'react';
import { Link } from 'react-router-dom';
import { searchGstin } from '../api/auth.api';
import { isValidGstin } from '../utils/validators';
import ErrorMessage from '../components/ErrorMessage';

export default function TaxpayerSearchPage() {
  const [gstin, setGstin] = useState('');
  const [searching, setSearching] = useState(false);
  const [taxpayer, setTaxpayer] = useState(null);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    const clean = gstin.trim().toUpperCase();

    if (!isValidGstin(clean)) {
      setError({
        code: 'INVALID_GSTIN',
        message: 'Please enter a valid 15-digit GSTIN.'
      });
      return;
    }

    setSearching(true);
    setError(null);
    setTaxpayer(null);

    try {
      const data = await searchGstin(clean);
      setTaxpayer(data);
    } catch (err) {
      setError(err);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <div className="zoho-page-header">
        <h1 className="fw-bold fs-4 text-dark mb-1">Taxpayer Verification & Search</h1>
        <p className="text-secondary small mb-0">
          Verify registered taxpayer details and legal identities directly from the GST system.
        </p>
      </div>

      <div className="zoho-page-body" style={{ maxWidth: '900px' }}>
        {/* Guidance banner for users wanting to link their own GSTIN */}
        <div className="alert alert-info py-2.5 px-3 mb-4 rounded-3 d-flex align-items-center justify-content-between flex-wrap gap-2 shadow-xs">
          <div className="small">
            🏢 <strong>Need to link your organization GSTIN?</strong> Taxpayer Search is for looking up third-party clients and vendors. To link your own GSTIN to this workspace, please visit <strong>Organization Settings</strong>.
          </div>
          <Link to="/settings" className="btn btn-sm btn-primary py-1 px-3 text-nowrap shadow-xs">
            Link in Settings ⚙️
          </Link>
        </div>

        <div className="card border shadow-sm p-4 bg-white mb-4">
          <form onSubmit={handleSearch}>
            <label htmlFor="taxpayer-gstin-input" className="form-label text-secondary small fw-semibold">
              Enter 15-Digit GSTIN
            </label>
            <div className="input-group mb-2">
              <input
                id="taxpayer-gstin-input"
                type="text"
                className="form-control form-control-lg font-monospace text-uppercase"
                placeholder="e.g. 29ABCDE1234F1Z5"
                maxLength={15}
                value={gstin}
                onChange={(e) => {
                  setGstin(e.target.value.toUpperCase());
                  setError(null);
                }}
                disabled={searching}
                required
              />
              <button
                type="submit"
                className="btn btn-primary px-4 fw-semibold"
                disabled={gstin.length < 15 || searching}
              >
                {searching ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                    Searching...
                  </>
                ) : (
                  'Search Taxpayer'
                )}
              </button>
            </div>
            <div className="form-text small text-muted">
              Enter any 15-character Goods and Services Tax Identification Number (GSTIN) to verify registration status.
            </div>
          </form>
        </div>

        <ErrorMessage error={error} onRetry={() => setError(null)} />

        {taxpayer && (
          <div className="card border shadow-sm bg-white overflow-hidden">
            <div className="card-header bg-light py-3 px-4 d-flex justify-content-between align-items-center">
              <div>
                <span className="badge bg-success-subtle text-success border border-success-subtle me-2">
                  Verified Taxpayer
                </span>
                <span className="font-monospace fw-bold text-dark">{taxpayer.gstin || gstin}</span>
              </div>
              <span className={`badge ${taxpayer.status === 'Active' ? 'bg-success' : 'bg-secondary'}`}>
                {taxpayer.status || 'Active'}
              </span>
            </div>
            <div className="card-body p-4">
              <div className="row g-4">
                <div className="col-12 col-md-6">
                  <div className="text-muted small text-uppercase fw-semibold mb-1">Legal Name of Business</div>
                  <div className="fs-5 fw-bold text-dark">{taxpayer.legalName || 'N/A'}</div>
                </div>

                <div className="col-12 col-md-6">
                  <div className="text-muted small text-uppercase fw-semibold mb-1">Trade Name</div>
                  <div className="fs-5 text-dark">{taxpayer.tradeName || taxpayer.legalName || 'N/A'}</div>
                </div>

                <div className="col-12 col-md-4">
                  <div className="text-muted small text-uppercase fw-semibold mb-1">Constitution of Business</div>
                  <div className="text-dark fw-medium">{taxpayer.businessType || taxpayer.taxpayerType || 'Private Limited Company'}</div>
                </div>

                <div className="col-12 col-md-4">
                  <div className="text-muted small text-uppercase fw-semibold mb-1">Registration Date</div>
                  <div className="text-dark fw-medium">{taxpayer.regDate || 'Registered'}</div>
                </div>

                <div className="col-12 col-md-4">
                  <div className="text-muted small text-uppercase fw-semibold mb-1">Taxpayer Type</div>
                  <div className="text-dark fw-medium">{taxpayer.taxpayerType || 'Regular'}</div>
                </div>

                <div className="col-12">
                  <div className="text-muted small text-uppercase fw-semibold mb-1">Principal Place of Business</div>
                  <div className="text-dark p-3 bg-light rounded-2">
                    {taxpayer.address || taxpayer.principalAddress || 'Registered business address on GST portal records.'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
