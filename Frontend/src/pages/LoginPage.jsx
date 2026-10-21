import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import GstinForm from '../components/GstinForm';

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const queryGstin = (searchParams.get('gstin') || '').toUpperCase();
  const navigate = useNavigate();

  const handleOtpSent = (stateData) => {
    navigate('/otp', { state: stateData });
  };

  return (
    <div className="container min-vh-100 d-flex align-items-center justify-content-center py-5">
      <div className="row justify-content-center w-100">
        <div className="col-12 col-md-8 col-lg-6 col-xl-5">
          <div className="card shadow-sm border rounded-4 p-2 bg-white">
            <div className="card-body p-4 p-sm-5">
              <div className="text-center mb-4">
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-2 fs-6 rounded-pill mb-3">
                  GST Identity Verification
                </span>
                <h1 className="fw-bold fs-3 text-dark mb-1">Taxpayer Login</h1>
                <p className="text-muted small mb-0">
                  Authenticate your GSTIN with official portal OTP
                </p>
              </div>

              <GstinForm key={queryGstin} initialGstin={queryGstin} onOtpSent={handleOtpSent} />

              <div className="text-center mt-4 pt-3 border-top small">
                <p className="text-muted mb-2">
                  <strong>Sandbox Mock:</strong> GSTIN: <code>29ABCDE1234F1Z5</code> • OTP: <code>123456</code>
                </p>
                <div className="d-flex justify-content-between">
                  <Link to="/" className="text-decoration-none">
                    ← Back to Home
                  </Link>
                  <Link to="/otp" className="text-decoration-none">
                    Already have OTP? Verify →
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
