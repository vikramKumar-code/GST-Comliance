import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ConsentBox from '../components/ConsentBox';

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const queryGstin = (searchParams.get('gstin') || '').toUpperCase();
  const [userInputGstin, setUserInputGstin] = useState(null);
  const [consent, setConsent] = useState(false);

  const gstin = userInputGstin !== null ? userInputGstin : queryGstin;

  return (
    <div className="container min-vh-100 d-flex align-items-center justify-content-center py-5">
      <div className="row justify-content-center w-100">
        <div className="col-12 col-md-8 col-lg-5 col-xl-4">
          <div className="card shadow-sm border rounded-4 p-2 bg-white">
            <div className="card-body p-4">
              <div className="text-center mb-4">
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-2 fs-6 rounded-pill mb-3">
                  GST Portal Auth
                </span>
                <h2 className="fw-bold fs-3 text-dark mb-1">Taxpayer Login</h2>
                <p className="text-muted small mb-0">
                  Authenticate your GSTIN with official portal OTP
                </p>
              </div>

              <form onSubmit={(e) => e.preventDefault()}>
                <div className="mb-3">
                  <label htmlFor="gstin-input" className="form-label text-secondary small fw-semibold">
                    GSTIN
                  </label>
                  <input
                    id="gstin-input"
                    type="text"
                    placeholder="e.g. 29ABCDE1234F1Z5"
                    className="form-control form-control-lg text-uppercase font-monospace"
                    maxLength={15}
                    value={gstin}
                    onChange={(e) => setUserInputGstin(e.target.value.toUpperCase())}
                  />
                  {gstin && (
                    <div className="form-text text-muted small mt-1">
                      Length: {gstin.length}/15 characters
                    </div>
                  )}
                </div>

                <ConsentBox checked={consent} onChange={setConsent} />

                <button
                  type="button"
                  className="btn btn-primary btn-lg w-100 fw-semibold mt-2"
                  disabled={!gstin || !consent}
                >
                  Request OTP
                </button>
              </form>

              <div className="text-center mt-4 pt-3 border-top small">
                <p className="text-muted mb-2">Test credentials: 29ABCDE1234F1Z5 (OTP: 123456)</p>
                <div className="d-flex justify-content-between">
                  <Link to="/" className="text-decoration-none">
                    ← Home
                  </Link>
                  <Link to="/otp" className="text-decoration-none">
                    Go to OTP verification →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
