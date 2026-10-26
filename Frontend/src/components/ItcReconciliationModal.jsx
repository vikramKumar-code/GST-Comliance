import { useState, useEffect, useCallback } from 'react';
import { getItcReconciliation, getRefundEstimate } from '../api/reconciliation.api';
import Loader from './Loader';
import ErrorMessage from './ErrorMessage';
import { formatCurrency, formatDate, formatPeriod } from '../utils/format';

export default function ItcReconciliationModal({ isOpen, onClose, initialPeriod = '092026' }) {
  const [period, setPeriod] = useState(initialPeriod);
  const [activeTab, setActiveTab] = useState('RECONCILIATION'); // 'RECONCILIATION' | 'REFUND_ESTIMATE'
  const [filterBucket, setFilterBucket] = useState('ALL'); // 'ALL' | 'MATCHED' | 'MISSING_IN_2B' | 'MISMATCHED_VALUE' | 'EXTRA_IN_2B'
  const [reconciliation, setReconciliation] = useState(null);
  const [refundEstimate, setRefundEstimate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async (p) => {
    if (!p) return;
    setLoading(true);
    setError(null);
    try {
      const [recRes, refRes] = await Promise.all([
        getItcReconciliation(p),
        getRefundEstimate(p),
      ]);
      setReconciliation(recRes);
      setRefundEstimate(refRes);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleClose = () => {
    setReconciliation(null);
    setRefundEstimate(null);
    setError(null);
    onClose();
  };

  useEffect(() => {
    if (!isOpen || !period) return;
    let ignore = false;

    Promise.resolve().then(() => {
      if (ignore) return;
      fetchData(period);
    });

    return () => {
      ignore = true;
    };
  }, [isOpen, period, fetchData]);

  if (!isOpen) return null;

  const summary = reconciliation?.summary || {};
  const eligibleItc = summary.eligibleItc || {};
  const atRiskItc = summary.atRiskItc || {};

  // Build combined item list for reconciliation table
  const allItems = [];
  if (reconciliation) {
    (reconciliation.matched || []).forEach((item) => allItems.push({ ...item, bucket: 'MATCHED' }));
    (reconciliation.missingIn2b || []).forEach((item) => allItems.push({ ...item, bucket: 'MISSING_IN_2B' }));
    (reconciliation.mismatched || []).forEach((item) => allItems.push({ ...item, bucket: 'MISMATCHED_VALUE' }));
    (reconciliation.extraIn2b || []).forEach((item) => allItems.push({ ...item, bucket: 'EXTRA_IN_2B' }));
  }

  const displayedItems = filterBucket === 'ALL'
    ? allItems
    : allItems.filter((item) => item.bucket === filterBucket);

  const netPos = refundEstimate?.netPosition || {};
  const isRefund = netPos.status === 'REFUND_OR_CARRY_FORWARD';

  return (
    <div
      className="modal show d-block"
      tabIndex="-1"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)', zIndex: 1060 }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content shadow border-0 rounded-4">
          {/* Header */}
          <div className="modal-header border-bottom px-4 py-3 bg-light rounded-top-4">
            <div className="d-flex align-items-center gap-2">
              <span className="fs-5">⚖️</span>
              <h2 className="modal-title fs-5 fw-bold text-dark mb-0">
                ITC Reconciliation & GST Refund Estimator
              </h2>
              <span className="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace px-2.5 py-1">
                {formatPeriod(period)}
              </span>
            </div>
            <div className="d-flex align-items-center gap-2">
              <select
                className="form-select form-select-sm"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                style={{ width: '130px' }}
                disabled={loading}
              >
                <option value="102026">Oct 2026</option>
                <option value="092026">Sep 2026</option>
                <option value="082026">Aug 2026</option>
                <option value="072026">Jul 2026</option>
              </select>
              <button
                type="button"
                className="btn-close"
                aria-label="Close"
                onClick={handleClose}
                disabled={loading}
              />
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="px-4 pt-3 border-bottom bg-white">
            <ul className="nav nav-tabs border-0">
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link fw-semibold px-3 py-2 border-0 border-bottom border-2 ${
                    activeTab === 'RECONCILIATION'
                      ? 'border-primary text-primary active'
                      : 'border-transparent text-secondary'
                  }`}
                  onClick={() => setActiveTab('RECONCILIATION')}
                >
                  ⚖️ ITC 2B Reconciliation
                </button>
              </li>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link fw-semibold px-3 py-2 border-0 border-bottom border-2 ${
                    activeTab === 'REFUND_ESTIMATE'
                      ? 'border-primary text-primary active'
                      : 'border-transparent text-secondary'
                  }`}
                  onClick={() => setActiveTab('REFUND_ESTIMATE')}
                >
                  💰 GST Refund & Liability Estimator
                </button>
              </li>
            </ul>
          </div>

          {/* Modal Body */}
          <div className="modal-body p-4">
            {error && <ErrorMessage error={error} onRetry={() => fetchData(period)} />}

            {loading && (
              <div className="py-5 text-center">
                <Loader message={`Reconciling purchase bills with GSTR-2B for period ${period}...`} />
              </div>
            )}

            {!loading && activeTab === 'RECONCILIATION' && reconciliation && (
              <div>
                {/* 4 KPI Summary Cards */}
                <div className="row g-3 mb-4">
                  <div className="col-12 col-sm-6 col-lg-3">
                    <div
                      className={`card border shadow-sm p-3 rounded-3 h-100 cursor-pointer ${
                        filterBucket === 'MATCHED' ? 'border-success bg-success-subtle' : 'bg-white'
                      }`}
                      onClick={() => setFilterBucket(filterBucket === 'MATCHED' ? 'ALL' : 'MATCHED')}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="text-secondary small fw-medium mb-1">✅ Matched Invoices</div>
                      <div className="fs-4 fw-bold text-success mb-1">
                        {summary.matchedCount || 0}
                      </div>
                      <div className="small text-muted">
                        Claimable ITC: <strong>{formatCurrency(eligibleItc.total || 0)}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="col-12 col-sm-6 col-lg-3">
                    <div
                      className={`card border shadow-sm p-3 rounded-3 h-100 ${
                        filterBucket === 'MISSING_IN_2B' ? 'border-danger bg-danger-subtle' : 'bg-white'
                      }`}
                      onClick={() => setFilterBucket(filterBucket === 'MISSING_IN_2B' ? 'ALL' : 'MISSING_IN_2B')}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="text-secondary small fw-medium mb-1">⚠️ Missing in GSTR-2B</div>
                      <div className="fs-4 fw-bold text-danger mb-1">
                        {summary.missingIn2bCount || 0}
                      </div>
                      <div className="small text-muted">
                        At-Risk ITC: <strong>{formatCurrency(atRiskItc.total || 0)}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="col-12 col-sm-6 col-lg-3">
                    <div
                      className={`card border shadow-sm p-3 rounded-3 h-100 ${
                        filterBucket === 'MISMATCHED_VALUE' ? 'border-warning bg-warning-subtle' : 'bg-white'
                      }`}
                      onClick={() => setFilterBucket(filterBucket === 'MISMATCHED_VALUE' ? 'ALL' : 'MISMATCHED_VALUE')}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="text-secondary small fw-medium mb-1">🔄 Value Discrepancies</div>
                      <div className="fs-4 fw-bold text-warning mb-1">
                        {summary.mismatchedCount || 0}
                      </div>
                      <div className="small text-muted">Amount differs from 2B</div>
                    </div>
                  </div>

                  <div className="col-12 col-sm-6 col-lg-3">
                    <div
                      className={`card border shadow-sm p-3 rounded-3 h-100 ${
                        filterBucket === 'EXTRA_IN_2B' ? 'border-info bg-info-subtle' : 'bg-white'
                      }`}
                      onClick={() => setFilterBucket(filterBucket === 'EXTRA_IN_2B' ? 'ALL' : 'EXTRA_IN_2B')}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="text-secondary small fw-medium mb-1">📥 Extra in 2B</div>
                      <div className="fs-4 fw-bold text-info mb-1">
                        {summary.extraIn2bCount || 0}
                      </div>
                      <div className="small text-muted">Unrecorded in books</div>
                    </div>
                  </div>
                </div>

                {/* Filter Pills */}
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="d-flex align-items-center gap-1.5 flex-wrap">
                    <span className="small text-muted me-1">Filter:</span>
                    <button
                      type="button"
                      className={`btn btn-sm ${filterBucket === 'ALL' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => setFilterBucket('ALL')}
                    >
                      All ({allItems.length})
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${filterBucket === 'MATCHED' ? 'btn-success text-white' : 'btn-outline-secondary'}`}
                      onClick={() => setFilterBucket('MATCHED')}
                    >
                      Matched ({summary.matchedCount || 0})
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${filterBucket === 'MISSING_IN_2B' ? 'btn-danger text-white' : 'btn-outline-secondary'}`}
                      onClick={() => setFilterBucket('MISSING_IN_2B')}
                    >
                      Missing in 2B ({summary.missingIn2bCount || 0})
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${filterBucket === 'MISMATCHED_VALUE' ? 'btn-warning text-dark' : 'btn-outline-secondary'}`}
                      onClick={() => setFilterBucket('MISMATCHED_VALUE')}
                    >
                      Discrepancies ({summary.mismatchedCount || 0})
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${filterBucket === 'EXTRA_IN_2B' ? 'btn-info text-white' : 'btn-outline-secondary'}`}
                      onClick={() => setFilterBucket('EXTRA_IN_2B')}
                    >
                      Extra in 2B ({summary.extraIn2bCount || 0})
                    </button>
                  </div>
                  <span className="small text-muted">
                    Showing <strong>{displayedItems.length}</strong> records
                  </span>
                </div>

                {/* Items Table */}
                <div className="table-responsive border rounded-3 bg-white">
                  <table className="table table-hover align-middle mb-0 small">
                    <thead className="table-light">
                      <tr>
                        <th>Status</th>
                        <th>Vendor / Supplier</th>
                        <th>Bill / Inv #</th>
                        <th>Date</th>
                        <th className="text-end">Books Tax</th>
                        <th className="text-end">2B Tax</th>
                        <th>Compliance Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedItems.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="text-center py-4 text-muted">
                            No records found in this category.
                          </td>
                        </tr>
                      ) : (
                        displayedItems.map((item, idx) => (
                          <tr key={item.billId || item.invoiceNumber || idx}>
                            <td>
                              {item.bucket === 'MATCHED' && (
                                <span className="badge bg-success-subtle text-success border border-success-subtle">
                                  MATCHED
                                </span>
                              )}
                              {item.bucket === 'MISSING_IN_2B' && (
                                <span className="badge bg-danger-subtle text-danger border border-danger-subtle">
                                  MISSING IN 2B
                                </span>
                              )}
                              {item.bucket === 'MISMATCHED_VALUE' && (
                                <span className="badge bg-warning-subtle text-warning border border-warning-subtle">
                                  MISMATCH
                                </span>
                              )}
                              {item.bucket === 'EXTRA_IN_2B' && (
                                <span className="badge bg-info-subtle text-info border border-info-subtle">
                                  EXTRA IN 2B
                                </span>
                              )}
                            </td>
                            <td>
                              <div className="fw-semibold text-dark">
                                {item.vendorName || item.supplierGstin || 'Supplier'}
                              </div>
                              <div className="font-monospace text-muted" style={{ fontSize: '0.75rem' }}>
                                {item.vendorGstin || item.supplierGstin || 'Unregistered'}
                              </div>
                            </td>
                            <td className="font-monospace fw-medium text-dark">
                              {item.billNumber || item.invoiceNumber}
                            </td>
                            <td className="text-muted">
                              {item.billDate ? formatDate(item.billDate) : item.invoiceDate || '—'}
                            </td>
                            <td className="text-end fw-semibold text-dark">
                              {item.totalTax !== undefined ? formatCurrency(item.totalTax) : '—'}
                            </td>
                            <td className="text-end fw-semibold text-primary">
                              {item.gstr2b?.totalTax !== undefined
                                ? formatCurrency(item.gstr2b.totalTax)
                                : item.totalTax !== undefined && item.bucket === 'EXTRA_IN_2B'
                                ? formatCurrency(item.totalTax)
                                : '—'}
                            </td>
                            <td className="text-muted" style={{ maxWidth: '280px' }}>
                              {item.bucket === 'MATCHED' && (
                                <span className="text-success">
                                  ✓ Exact match. 100% Eligible ITC claimable in GSTR-3B.
                                </span>
                              )}
                              {item.bucket === 'MISSING_IN_2B' && (
                                <span className="text-danger">
                                  ⚠️ Vendor has not filed GSTR-1. ITC is blocked until reported.
                                </span>
                              )}
                              {item.bucket === 'MISMATCHED_VALUE' && (
                                <span className="text-warning">
                                  Diff: {formatCurrency(item.discrepancy?.diffTax || 0)} (Verify line items)
                                </span>
                              )}
                              {item.bucket === 'EXTRA_IN_2B' && (
                                <span className="text-info">
                                  Recorded by supplier on GSTN. Add to CandidTax to claim ITC.
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!loading && activeTab === 'REFUND_ESTIMATE' && refundEstimate && (
              <div>
                {/* Highlighted Net Position Banner */}
                <div
                  className={`card border shadow-sm p-4 rounded-4 mb-4 ${
                    isRefund ? 'bg-success-subtle border-success' : 'bg-primary-subtle border-primary'
                  }`}
                >
                  <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
                    <div>
                      <div className="small fw-semibold text-uppercase tracking-wide mb-1 text-secondary">
                        {isRefund ? '🎉 Estimated GST Refund Position' : '💳 Net Cash Tax Payable'}
                      </div>
                      <h3 className={`fs-2 fw-bold mb-1 ${isRefund ? 'text-success' : 'text-primary'}`}>
                        {formatCurrency(isRefund ? netPos.estimatedRefundAmount : netPos.estimatedTaxPayable)}
                      </h3>
                      <p className="small text-muted mb-0" style={{ maxWidth: '650px' }}>
                        {netPos.explanation}
                      </p>
                    </div>
                    <span className={`badge px-3 py-2 fs-6 rounded-pill ${isRefund ? 'bg-success text-white' : 'bg-primary text-white'}`}>
                      {isRefund ? 'RFD-01 Eligible' : 'GSTR-3B Table 6.1'}
                    </span>
                  </div>
                </div>

                {/* Side-by-side Breakdown Table */}
                <div className="card border shadow-sm rounded-4 overflow-hidden bg-white">
                  <div className="card-header bg-light py-3 px-4 border-bottom">
                    <h4 className="fs-6 fw-bold text-dark mb-0">Tax Offsetting & Net Position Breakdown</h4>
                  </div>
                  <div className="table-responsive">
                    <table className="table align-middle mb-0">
                      <thead className="table-light small">
                        <tr>
                          <th>Component</th>
                          <th className="text-end">CGST</th>
                          <th className="text-end">SGST</th>
                          <th className="text-end">IGST</th>
                          <th className="text-end">Total Tax</th>
                        </tr>
                      </thead>
                      <tbody className="small">
                        <tr>
                          <td className="fw-semibold text-dark">
                            1. Output Tax Liability (Sales)
                            <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                              From {refundEstimate.outputLiability?.totalInvoices || 0} sales invoices
                            </div>
                          </td>
                          <td className="text-end">{formatCurrency(refundEstimate.outputLiability?.cgst || 0)}</td>
                          <td className="text-end">{formatCurrency(refundEstimate.outputLiability?.sgst || 0)}</td>
                          <td className="text-end">{formatCurrency(refundEstimate.outputLiability?.igst || 0)}</td>
                          <td className="text-end fw-bold text-dark">{formatCurrency(refundEstimate.outputLiability?.total || 0)}</td>
                        </tr>
                        <tr>
                          <td className="fw-semibold text-success">
                            2. Less: Eligible Input Tax Credit (Purchases)
                            <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                              From {refundEstimate.inputTaxCredit?.matchedBills || 0} matched GSTR-2B inward bills
                            </div>
                          </td>
                          <td className="text-end text-success">{formatCurrency(refundEstimate.inputTaxCredit?.cgst || 0)}</td>
                          <td className="text-end text-success">{formatCurrency(refundEstimate.inputTaxCredit?.sgst || 0)}</td>
                          <td className="text-end text-success">{formatCurrency(refundEstimate.inputTaxCredit?.igst || 0)}</td>
                          <td className="text-end fw-bold text-success">{formatCurrency(refundEstimate.inputTaxCredit?.total || 0)}</td>
                        </tr>
                        <tr className="table-light border-top border-2">
                          <td className="fw-bold text-dark">
                            Net Balance ({isRefund ? 'Surplus Credit / Refund' : 'Cash Payable'})
                          </td>
                          <td className="text-end fw-bold">{formatCurrency(Math.abs(netPos.cgst || 0))}</td>
                          <td className="text-end fw-bold">{formatCurrency(Math.abs(netPos.sgst || 0))}</td>
                          <td className="text-end fw-bold">{formatCurrency(Math.abs(netPos.igst || 0))}</td>
                          <td className={`text-end fw-bold fs-6 ${isRefund ? 'text-success' : 'text-primary'}`}>
                            {formatCurrency(Math.abs(netPos.total || 0))}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="modal-footer border-top px-4 py-3 bg-light rounded-bottom-4 d-flex justify-content-between">
            <span className="small text-muted">
              🔒 Reconciled with active workspace purchase records & GSTR-2B data
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm px-4"
              onClick={handleClose}
              disabled={loading}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
