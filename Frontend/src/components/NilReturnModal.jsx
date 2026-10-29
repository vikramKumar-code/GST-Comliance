import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkNilEligibility, fileNilReturn } from '../api/returns.api';
import { formatCurrency, formatPeriod } from '../utils/format';
import Loader from './Loader';
import ErrorMessage from './ErrorMessage';

export default function NilReturnModal({
  isOpen,
  onClose,
  initialPeriod,
  initialType = 'GSTR1',
  onSuccess
}) {
  const navigate = useNavigate();
  const [returnType, setReturnType] = useState(initialType);
  const [period, setPeriod] = useState(initialPeriod || '102026');
  const [checking, setChecking] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const [error, setError] = useState(null);

  const [declaration, setDeclaration] = useState(false);
  const [verificationMode, setVerificationMode] = useState('1_CLICK'); // '1_CLICK' | 'EVC'
  const [filing, setFiling] = useState(false);
  const [filingResult, setFilingResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialType) setReturnType(initialType.toUpperCase());
    if (initialPeriod) setPeriod(initialPeriod);
  }, [initialType, initialPeriod]);

  // Check eligibility on mount or when returnType / period changes
  const checkEligibility = useCallback(async (p, t) => {
    if (!p) return;
    setChecking(true);
    setError(null);
    setFilingResult(null);
    try {
      const res = await checkNilEligibility(p, t);
      setEligibility(res);
    } catch (err) {
      setError(err);
      setEligibility(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !period) return;
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) {
        checkEligibility(period, returnType);
      }
    });
    return () => {
      ignore = true;
    };
  }, [isOpen, period, returnType, checkEligibility]);

  if (!isOpen) return null;

  const handleClose = () => {
    setEligibility(null);
    setError(null);
    setFilingResult(null);
    setDeclaration(false);
    onClose();
  };

  const handleFile = async () => {
    if (!declaration) {
      setError({ message: 'You must check and accept the CGST Rule 67A statutory declaration before filing.' });
      return;
    }
    setFiling(true);
    setError(null);
    try {
      const res = await fileNilReturn({
        period,
        returnType,
        declarationAccepted: true,
        verificationMode
      });
      setFilingResult(res);
      if (typeof onSuccess === 'function') {
        onSuccess(res);
      }
    } catch (err) {
      setError(err);
    } finally {
      setFiling(false);
    }
  };

  const handleCopyArn = () => {
    if (filingResult?.arn) {
      navigator.clipboard.writeText(filingResult.arn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="modal show d-block"
      tabIndex="-1"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)', zIndex: 1070 }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content shadow-lg border-0 rounded-4 overflow-hidden">
          {/* Modal Header */}
          <div
            className="modal-header border-bottom px-4 py-3"
            style={{
              background: 'linear-gradient(135deg, #0d6e59 0%, #10b981 100%)',
              color: '#ffffff'
            }}
          >
            <div className="d-flex align-items-center gap-2">
              <span className="fs-5">⚡</span>
              <div>
                <h2 className="modal-title fs-5 fw-bold text-white mb-0">File Nil GST Return</h2>
                <span className="text-white-50 small">Under Rule 67A of CGST Rules, 2017</span>
              </div>
            </div>
            <button
              type="button"
              className="btn-close btn-close-white"
              aria-label="Close"
              onClick={handleClose}
              disabled={filing}
            />
          </div>

          {/* Modal Body */}
          <div className="modal-body p-4">
            <ErrorMessage error={error} onRetry={() => checkEligibility(period, returnType)} />

            {/* SUCCESS SCREEN */}
            {filingResult ? (
              <div className="text-center py-3">
                <div
                  className="rounded-circle d-inline-flex align-items-center justify-content-center mb-3 shadow-sm"
                  style={{ width: '68px', height: '68px', background: '#ecfdf5', color: '#059669', fontSize: '2rem' }}
                >
                  ✓
                </div>
                <h3 className="fs-4 fw-bold text-dark mb-1">Nil Return Filed Successfully!</h3>
                <p className="text-secondary small mb-4">
                  Your Nil <strong>{filingResult.type}</strong> return for <strong>{formatPeriod(filingResult.period)}</strong> has been formally filed and registered on the GST system.
                </p>

                {/* Digital Acknowledgement Certificate Card */}
                <div className="card border bg-light p-3.5 mb-4 text-start rounded-3 shadow-xs">
                  <div className="d-flex align-items-center justify-content-between border-bottom pb-2 mb-3">
                    <span className="fw-bold text-dark small text-uppercase tracking-wider">Official Acknowledgement</span>
                    <span className="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">
                      ● Status: FILED
                    </span>
                  </div>
                  <div className="row g-2.5 small">
                    <div className="col-sm-6">
                      <span className="text-muted d-block">Application Reference Number (ARN):</span>
                      <div className="d-flex align-items-center gap-2 mt-0.5">
                        <strong className="fs-6 text-primary font-monospace">{filingResult.arn}</strong>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary py-0 px-2"
                          onClick={handleCopyArn}
                          title="Copy ARN"
                        >
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    <div className="col-sm-6">
                      <span className="text-muted d-block">Filing Date & Time:</span>
                      <strong className="text-dark d-block mt-0.5">{filingResult.dateStr || 'Today'}</strong>
                    </div>
                    <div className="col-sm-6">
                      <span className="text-muted d-block">Return Form:</span>
                      <strong className="text-dark d-block mt-0.5">{filingResult.type} (Nil Outward / Liability)</strong>
                    </div>
                    <div className="col-sm-6">
                      <span className="text-muted d-block">Verification Mode:</span>
                      <strong className="text-dark d-block mt-0.5">{filingResult.mode || 'Electronic Verification (EVC)'}</strong>
                    </div>
                  </div>
                </div>

                <div className="d-flex align-items-center justify-content-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-primary px-4 fw-semibold"
                    onClick={() => {
                      handleClose();
                      navigate('/returns/filing-history');
                    }}
                  >
                    📜 View in Filing History
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary px-3"
                    onClick={handleClose}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* FORM CONTROLS: Return Type & Period */}
                <div className="row g-3 mb-4">
                  <div className="col-sm-6">
                    <label className="form-label small fw-semibold text-secondary mb-1">
                      Select GST Return Form
                    </label>
                    <div className="btn-group w-100" role="group">
                      <button
                        type="button"
                        className={`btn btn-sm ${returnType === 'GSTR1' ? 'btn-primary' : 'btn-outline-secondary'}`}
                        onClick={() => setReturnType('GSTR1')}
                        disabled={filing}
                      >
                        GSTR-1 (Outward Supplies)
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${returnType === 'GSTR3B' ? 'btn-primary' : 'btn-outline-secondary'}`}
                        onClick={() => setReturnType('GSTR3B')}
                        disabled={filing}
                      >
                        GSTR-3B (Monthly Summary)
                      </button>
                    </div>
                  </div>

                  <div className="col-sm-6">
                    <label className="form-label small fw-semibold text-secondary mb-1">
                      Tax Period
                    </label>
                    <div className="input-group input-group-sm">
                      <span className="input-group-text bg-white">📅</span>
                      <input
                        type="text"
                        className="form-control font-monospace"
                        value={`${formatPeriod(period)} (${period})`}
                        disabled
                      />
                    </div>
                  </div>
                </div>

                {/* ELIGIBILITY STATUS CARD */}
                {checking ? (
                  <div className="py-4 text-center">
                    <Loader message="Checking CGST Rule 67A eligibility..." />
                  </div>
                ) : eligibility ? (
                  <div className="mb-4">
                    {eligibility.alreadyFiled ? (
                      <div className="alert alert-warning border-warning d-flex align-items-start gap-2.5 p-3 rounded-3">
                        <span className="fs-5">⚠️</span>
                        <div>
                          <strong className="d-block text-dark">Return Already Filed!</strong>
                          <span className="small">
                            {eligibility.message} You do not need to file this period again.
                          </span>
                        </div>
                      </div>
                    ) : eligibility.hasBusinessActivity ? (
                      <div className="alert alert-warning border-warning p-3 rounded-3">
                        <div className="d-flex align-items-center gap-2 mb-1.5">
                          <span className="fs-5">⚠️</span>
                          <strong className="text-dark">Active Transactions Found in Software</strong>
                        </div>
                        <ul className="mb-2 ps-3 small text-secondary">
                          {eligibility.warnings.map((w, idx) => (
                            <li key={idx}>{w}</li>
                          ))}
                        </ul>
                        <div className="small text-muted border-top pt-2">
                          <strong>CGST Rule 67A Condition:</strong> A Nil Return is strictly meant for taxpayers with <em>zero outward supplies, zero reverse charge, and zero tax liability</em>. If you proceed with Nil filing, these transactions will NOT be submitted to the government.
                        </div>
                      </div>
                    ) : (
                      <div className="alert alert-success border-success d-flex align-items-start gap-2.5 p-3 rounded-3">
                        <span className="fs-5">✅</span>
                        <div>
                          <strong className="d-block text-dark">100% Eligible for Nil Filing</strong>
                          <span className="small text-secondary">
                            Zero sales invoices, zero liability, and zero ITC detected in your records for {formatPeriod(period)}. You qualify for instant 1-Click Nil Return filing under CGST Rule 67A.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* STATUTORY CHECKLIST (RULE 67A) */}
                <div className="card border bg-light p-3.5 rounded-3 mb-4">
                  <span className="fw-bold text-dark small text-uppercase tracking-wider d-block mb-2">
                    Statutory Criteria for Nil Filing (Rule 67A)
                  </span>
                  <div className="row g-2 small text-secondary">
                    <div className="col-12 col-md-6 d-flex align-items-center gap-2">
                      <span className="text-success">✓</span>
                      <span>No outward supplies (No sales invoices or exports)</span>
                    </div>
                    <div className="col-12 col-md-6 d-flex align-items-center gap-2">
                      <span className="text-success">✓</span>
                      <span>No supplies attracting Reverse Charge (RCM)</span>
                    </div>
                    <div className="col-12 col-md-6 d-flex align-items-center gap-2">
                      <span className="text-success">✓</span>
                      <span>No Input Tax Credit (ITC) to be availed</span>
                    </div>
                    <div className="col-12 col-md-6 d-flex align-items-center gap-2">
                      <span className="text-success">✓</span>
                      <span>No tax liability, interest, late fees, or penalty</span>
                    </div>
                  </div>
                </div>

                {/* VERIFICATION MODE SELECTOR */}
                <div className="mb-4">
                  <label className="form-label small fw-semibold text-secondary mb-1.5">
                    Authentication & Verification Mode
                  </label>
                  <div className="row g-2">
                    <div className="col-6">
                      <div
                        className={`card h-100 p-2.5 rounded-3 border text-start cursor-pointer ${
                          verificationMode === '1_CLICK' ? 'border-primary bg-primary-subtle text-primary' : 'bg-white'
                        }`}
                        onClick={() => setVerificationMode('1_CLICK')}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="d-flex align-items-center gap-2">
                          <input
                            type="radio"
                            name="vmode"
                            checked={verificationMode === '1_CLICK'}
                            onChange={() => setVerificationMode('1_CLICK')}
                          />
                          <strong className="small">⚡ 1-Click Nil Digital Filing</strong>
                        </div>
                        <span className="small text-muted mt-1 d-block ms-4">
                          Direct electronic authentication with instant ARN generation.
                        </span>
                      </div>
                    </div>

                    <div className="col-6">
                      <div
                        className={`card h-100 p-2.5 rounded-3 border text-start cursor-pointer ${
                          verificationMode === 'EVC' ? 'border-primary bg-primary-subtle text-primary' : 'bg-white'
                        }`}
                        onClick={() => setVerificationMode('EVC')}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="d-flex align-items-center gap-2">
                          <input
                            type="radio"
                            name="vmode"
                            checked={verificationMode === 'EVC'}
                            onChange={() => setVerificationMode('EVC')}
                          />
                          <strong className="small">📲 EVC OTP Verification</strong>
                        </div>
                        <span className="small text-muted mt-1 d-block ms-4">
                          Electronic Verification Code via registered mobile/email OTP.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* MANDATORY STATUTORY DECLARATION */}
                <div className="form-check p-3 bg-light rounded-3 border mb-4">
                  <input
                    className="form-check-input ms-0 me-2"
                    type="checkbox"
                    id="nilDeclaration"
                    checked={declaration}
                    onChange={(e) => setDeclaration(e.target.checked)}
                    disabled={filing || eligibility?.alreadyFiled}
                  />
                  <label className="form-check-label small text-dark fw-semibold" htmlFor="nilDeclaration" style={{ cursor: 'pointer' }}>
                    I hereby solemnly declare and affirm that for the tax period <strong>{formatPeriod(period)}</strong>, I have not made any outward supply, have not received any inward supply liable to reverse charge, have no liability to pay any tax, and have not claimed any input tax credit. I confirm that this Nil return is filed under <strong>CGST Rule 67A</strong>.
                  </label>
                </div>

                {/* MODAL ACTION BUTTONS */}
                <div className="d-flex align-items-center justify-content-between pt-2 border-top">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={handleClose}
                    disabled={filing}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-success btn-sm px-4 fw-semibold d-flex align-items-center gap-1.5"
                    onClick={handleFile}
                    disabled={!declaration || filing || eligibility?.alreadyFiled}
                  >
                    {filing ? (
                      <>
                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                        <span>Filing Nil Return...</span>
                      </>
                    ) : (
                      <>
                        <span>⚡ Submit & File Nil {returnType}</span>
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
