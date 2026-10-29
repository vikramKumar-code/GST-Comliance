import { useState, useEffect, useCallback } from 'react';
import { prepareGstr1, saveGstr1 } from '../api/returns.api';
import { formatCurrency, formatPeriod } from '../utils/format';
import Loader from './Loader';
import ErrorMessage from './ErrorMessage';

export default function Gstr1PrepareModal({ isOpen, onClose, period, onOpenNilModal }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [activeTab, setActiveTab] = useState('b2b');

  const fetchPayload = useCallback(async (p) => {
    if (!p) return;
    setLoading(true);
    setError(null);
    setSaveResult(null);
    try {
      const res = await prepareGstr1(p);
      setData(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleClose = () => {
    setData(null);
    setError(null);
    setSaveResult(null);
    onClose();
  };

  useEffect(() => {
    if (!isOpen || !period) return;
    let ignore = false;

    Promise.resolve().then(() => {
      if (ignore) return;
      fetchPayload(period);
    });

    return () => {
      ignore = true;
    };
  }, [isOpen, period, fetchPayload]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await saveGstr1(period);
      setSaveResult(res);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const summary = data?.summary || {};
  const payload = data?.payload || {};

  return (
    <div
      className="modal show d-block"
      tabIndex="-1"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1060 }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content shadow border-0 rounded-4">
          {/* Header */}
          <div className="modal-header border-bottom px-4 py-3 bg-light rounded-top-4">
            <div className="d-flex align-items-center gap-2">
              <span className="fs-5">📋</span>
              <h2 className="modal-title fs-5 fw-bold text-dark mb-0">Prepare & File GSTR-1</h2>
              <span className="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace px-2.5 py-1">
                {formatPeriod(period)}
              </span>
            </div>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={handleClose}
              disabled={saving}
            />
          </div>

          {/* Body */}
          <div className="modal-body p-4">
            {error && <ErrorMessage error={error} onRetry={() => fetchPayload(period)} />}

            {/* Success / Dry Run Status Banner */}
            {saveResult && (
              <div
                className={`alert ${saveResult.dryRun ? 'alert-info' : 'alert-success'} d-flex flex-column gap-1 mb-4 rounded-3 border`}
                role="status"
              >
                <div className="d-flex align-items-center justify-content-between">
                  <div className="d-flex align-items-center gap-2 fw-semibold">
                    <span>{saveResult.dryRun ? '🛡️' : '✅'}</span>
                    <span>{saveResult.message}</span>
                  </div>
                  <span className="badge bg-dark font-monospace">
                    Ref ID: {saveResult.ref_id}
                  </span>
                </div>
                <div className="small text-secondary">
                  Tax period: <strong>{saveResult.period}</strong> • GSTIN: <strong>{saveResult.gstin}</strong>
                </div>
              </div>
            )}

            {loading ? (
              <div className="py-5 text-center">
                <Loader message={`Building GSTR-1 payload from sales invoices for ${formatPeriod(period)}...`} />
              </div>
            ) : data ? (
              <>
                {summary.totalInvoices === 0 && (
                  <div className="alert alert-info border border-info-subtle d-flex align-items-center justify-content-between p-3 mb-4 rounded-3 flex-wrap gap-2">
                    <div className="d-flex align-items-center gap-2">
                      <span className="fs-5">ℹ️</span>
                      <div>
                        <strong className="d-block text-dark">Zero Sales Invoices for {formatPeriod(period)}</strong>
                        <span className="small text-secondary">
                          No outward sales recorded for this period. You qualify for instant 1-Click Nil GSTR-1 filing under CGST Rule 67A.
                        </span>
                      </div>
                    </div>
                    {typeof onOpenNilModal === 'function' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-success fw-semibold"
                        onClick={() => {
                          handleClose();
                          onOpenNilModal();
                        }}
                      >
                        ⚡ File Nil GSTR-1
                      </button>
                    )}
                  </div>
                )}

                {/* Metrics Cards */}
                <div className="row g-3 mb-4">
                  <div className="col-6 col-md-3">
                    <div className="card h-100 border-0 bg-light rounded-3 p-3 text-start">
                      <span className="text-secondary small fw-semibold">Active Invoices</span>
                      <span className="fs-4 fw-bold text-dark mt-1">{summary.totalInvoices || 0}</span>
                      <span className="text-muted small mt-0.5">
                        {summary.cancelledInvoices || 0} cancelled
                      </span>
                    </div>
                  </div>
                  <div className="col-6 col-md-3">
                    <div className="card h-100 border-0 bg-light rounded-3 p-3 text-start">
                      <span className="text-secondary small fw-semibold">Total Taxable Value</span>
                      <span className="fs-4 fw-bold text-dark mt-1">
                        {formatCurrency(summary.totalTaxable)}
                      </span>
                      <span className="text-muted small mt-0.5">Gross Turnover</span>
                    </div>
                  </div>
                  <div className="col-6 col-md-3">
                    <div className="card h-100 border-0 bg-light rounded-3 p-3 text-start">
                      <span className="text-secondary small fw-semibold">Integrated Tax (IGST)</span>
                      <span className="fs-4 fw-bold text-primary mt-1">
                        {formatCurrency(summary.totalIgst)}
                      </span>
                      <span className="text-muted small mt-0.5">Inter-state supplies</span>
                    </div>
                  </div>
                  <div className="col-6 col-md-3">
                    <div className="card h-100 border-0 bg-light rounded-3 p-3 text-start">
                      <span className="text-secondary small fw-semibold">Central + State (CGST/SGST)</span>
                      <span className="fs-4 fw-bold text-success mt-1">
                        {formatCurrency((summary.totalCgst || 0) + (summary.totalSgst || 0))}
                      </span>
                      <span className="text-muted small mt-0.5">Intra-state supplies</span>
                    </div>
                  </div>
                </div>

                {/* Section Navigation Tabs */}
                <ul className="nav nav-tabs mb-3" role="tablist">
                  <li className="nav-item" role="presentation">
                    <button
                      type="button"
                      className={`nav-link fw-semibold ${activeTab === 'b2b' ? 'active text-primary' : 'text-secondary'}`}
                      onClick={() => setActiveTab('b2b')}
                    >
                      Table 4A - B2B Invoices ({payload.b2b?.length || 0})
                    </button>
                  </li>
                  <li className="nav-item" role="presentation">
                    <button
                      type="button"
                      className={`nav-link fw-semibold ${activeTab === 'b2cs' ? 'active text-primary' : 'text-secondary'}`}
                      onClick={() => setActiveTab('b2cs')}
                    >
                      Table 7 - B2C Small ({payload.b2cs?.length || 0})
                    </button>
                  </li>
                  <li className="nav-item" role="presentation">
                    <button
                      type="button"
                      className={`nav-link fw-semibold ${activeTab === 'hsn' ? 'active text-primary' : 'text-secondary'}`}
                      onClick={() => setActiveTab('hsn')}
                    >
                      Table 12 - HSN Summary ({payload.hsn?.data?.length || 0})
                    </button>
                  </li>
                  <li className="nav-item" role="presentation">
                    <button
                      type="button"
                      className={`nav-link fw-semibold ${activeTab === 'doc' ? 'active text-primary' : 'text-secondary'}`}
                      onClick={() => setActiveTab('doc')}
                    >
                      Table 13 - Documents Issued
                    </button>
                  </li>
                </ul>

                {/* Tab Contents */}
                {activeTab === 'b2b' && (
                  <div className="border rounded-3 overflow-hidden">
                    <div className="table-responsive">
                      <table className="table table-hover table-striped mb-0 small">
                        <thead className="table-light">
                          <tr>
                            <th>Recipient GSTIN</th>
                            <th>Invoice No</th>
                            <th>Invoice Date</th>
                            <th>Place of Supply</th>
                            <th className="text-end">Invoice Value</th>
                            <th className="text-end">Taxable Amount</th>
                            <th className="text-end">Tax Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payload.b2b && payload.b2b.length > 0 ? (
                            payload.b2b.flatMap((buyer) =>
                              (buyer.inv || []).map((inv) => {
                                const taxable = (inv.itms || []).reduce(
                                  (acc, itm) => acc + (itm.itm_det?.txval || 0),
                                  0
                                );
                                const tax = (inv.itms || []).reduce(
                                  (acc, itm) =>
                                    acc +
                                    (itm.itm_det?.iamt || 0) +
                                    (itm.itm_det?.camt || 0) +
                                    (itm.itm_det?.samt || 0),
                                  0
                                );
                                return (
                                  <tr key={`${buyer.ctin}_${inv.inum}`}>
                                    <td className="font-monospace fw-semibold">{buyer.ctin}</td>
                                    <td className="font-monospace">{inv.inum}</td>
                                    <td>{inv.idt}</td>
                                    <td>State {inv.pos}</td>
                                    <td className="text-end fw-semibold">{formatCurrency(inv.val)}</td>
                                    <td className="text-end">{formatCurrency(taxable)}</td>
                                    <td className="text-end text-primary">{formatCurrency(tax)}</td>
                                  </tr>
                                );
                              })
                            )
                          ) : (
                            <tr>
                              <td colSpan="7" className="text-center py-4 text-muted">
                                No B2B registered invoices found for this tax period.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'b2cs' && (
                  <div className="border rounded-3 overflow-hidden">
                    <div className="table-responsive">
                      <table className="table table-hover table-striped mb-0 small">
                        <thead className="table-light">
                          <tr>
                            <th>Supply Type</th>
                            <th>Place of Supply (POS)</th>
                            <th className="text-end">GST Rate (%)</th>
                            <th className="text-end">Taxable Value</th>
                            <th className="text-end">IGST</th>
                            <th className="text-end">CGST</th>
                            <th className="text-end">SGST</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payload.b2cs && payload.b2cs.length > 0 ? (
                            payload.b2cs.map((r, idx) => (
                              <tr key={idx}>
                                <td>
                                  <span className={`badge ${r.sply_ty === 'INTRA' ? 'bg-success-subtle text-success' : 'bg-primary-subtle text-primary'}`}>
                                    {r.sply_ty}
                                  </span>
                                </td>
                                <td>State {r.pos}</td>
                                <td className="text-end">{r.rt}%</td>
                                <td className="text-end fw-semibold">{formatCurrency(r.txval)}</td>
                                <td className="text-end">{formatCurrency(r.iamt)}</td>
                                <td className="text-end">{formatCurrency(r.camt)}</td>
                                <td className="text-end">{formatCurrency(r.samt)}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan="7" className="text-center py-4 text-muted">
                                No B2C small retail invoices found for this period.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'hsn' && (
                  <div className="border rounded-3 overflow-hidden">
                    <div className="table-responsive">
                      <table className="table table-hover table-striped mb-0 small">
                        <thead className="table-light">
                          <tr>
                            <th>HSN/SAC</th>
                            <th>Description</th>
                            <th>Unit (UQC)</th>
                            <th className="text-end">Quantity</th>
                            <th className="text-end">Tax Rate</th>
                            <th className="text-end">Taxable Value</th>
                            <th className="text-end">Total Tax</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payload.hsn?.data && payload.hsn.data.length > 0 ? (
                            payload.hsn.data.map((h) => (
                              <tr key={h.num}>
                                <td className="font-monospace fw-semibold">{h.hsn_sc}</td>
                                <td>{h.desc}</td>
                                <td>{h.uqc}</td>
                                <td className="text-end">{h.qty}</td>
                                <td className="text-end">{h.rt}%</td>
                                <td className="text-end fw-semibold">{formatCurrency(h.txval)}</td>
                                <td className="text-end text-primary">
                                  {formatCurrency((h.iamt || 0) + (h.camt || 0) + (h.samt || 0))}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan="7" className="text-center py-4 text-muted">
                                No HSN summary items available for this period.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'doc' && (
                  <div className="card border p-3 rounded-3 bg-light">
                    <h6 className="fw-bold mb-3">Document Range Summary</h6>
                    {payload.doc_issue?.doc_det?.[0]?.docs?.[0] ? (
                      (() => {
                        const d = payload.doc_issue.doc_det[0].docs[0];
                        return (
                          <div className="row g-3">
                            <div className="col-md-3">
                              <span className="text-muted small">Starting Invoice No:</span>
                              <div className="fw-bold font-monospace mt-1">{d.from}</div>
                            </div>
                            <div className="col-md-3">
                              <span className="text-muted small">Ending Invoice No:</span>
                              <div className="fw-bold font-monospace mt-1">{d.to}</div>
                            </div>
                            <div className="col-md-3">
                              <span className="text-muted small">Total Invoices Generated:</span>
                              <div className="fw-bold fs-5 text-dark mt-1">{d.totnum}</div>
                            </div>
                            <div className="col-md-3">
                              <span className="text-muted small">Net Invoices Filed:</span>
                              <div className="fw-bold fs-5 text-success mt-1">{d.net_issue}</div>
                              <span className="text-danger small">({d.canc} cancelled)</span>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <span className="text-muted small">No document series data available.</span>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* Footer */}
          <div className="modal-footer border-top px-4 py-3 bg-light rounded-bottom-4 d-flex justify-content-between">
            <span className="small text-muted">
              🔒 Safe compliance engine with dry-run verification
            </span>
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm px-3"
                onClick={handleClose}
                disabled={saving}
              >
                Close
              </button>
              {summary.totalInvoices === 0 && typeof onOpenNilModal === 'function' ? (
                <button
                  type="button"
                  className="btn btn-success btn-sm fw-semibold px-4 d-flex align-items-center gap-1.5"
                  onClick={() => {
                    handleClose();
                    onOpenNilModal();
                  }}
                >
                  <span>⚡ File Nil GSTR-1</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-success btn-sm fw-semibold px-4 d-flex align-items-center gap-1.5"
                  onClick={handleSave}
                  disabled={loading || saving || !data || summary.totalInvoices === 0}
                >
                  {saving ? (
                    <>
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                      <span>Uploading to GSTN...</span>
                    </>
                  ) : (
                    <>
                      <span>🚀 Save / Upload GSTR-1</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
