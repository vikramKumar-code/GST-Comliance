import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listBills, createBill, updateBill, deleteBill } from '../api/bills.api';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import ItcReconciliationModal from '../components/ItcReconciliationModal';
import { formatCurrency, formatDate } from '../utils/format';

const INITIAL_BILL = {
  billNumber: '',
  vendorName: '',
  vendorGstin: '',
  billDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
  category: 'Expense',
  description: 'Vendor Purchase / Service',
  quantity: 1,
  rate: 0,
  gstRate: 18,
  notes: ''
};

export default function BillsPage() {
  const [searchParams] = useSearchParams();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [formData, setFormData] = useState(INITIAL_BILL);
  const [saving, setSaving] = useState(false);

  const handleOpenCreate = useCallback(() => {
    setFormData(INITIAL_BILL);
    setShowModal(true);
  }, []);

  const fetchBills = useCallback(async (q = '', cat = '') => {
    setLoading(true);
    setError(null);
    try {
      const res = await listBills({ q, category: cat });
      setBills(res.data || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) {
        fetchBills(searchQuery, categoryFilter);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [fetchBills, searchQuery, categoryFilter]);

  useEffect(() => {
    let isMounted = true;
    if (searchParams.get('action') === 'new') {
      Promise.resolve().then(() => {
        if (isMounted) handleOpenCreate();
      });
    }
    return () => {
      isMounted = false;
    };
  }, [searchParams, handleOpenCreate]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.billNumber.trim() || !formData.vendorName.trim()) return;

    setSaving(true);
    setError(null);

    const payload = {
      billNumber: formData.billNumber.trim(),
      vendorName: formData.vendorName.trim(),
      vendorGstin: formData.vendorGstin.trim().toUpperCase(),
      billDate: formData.billDate,
      dueDate: formData.dueDate || undefined,
      category: formData.category,
      notes: formData.notes.trim(),
      lineItems: [
        {
          description: formData.description.trim() || 'Item',
          quantity: Number(formData.quantity) || 1,
          rate: Number(formData.rate) || 0,
          gstRate: Number(formData.gstRate) || 0
        }
      ]
    };

    try {
      await createBill(payload);
      setShowModal(false);
      fetchBills(searchQuery, categoryFilter);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateBill(id, { status: newStatus });
      fetchBills(searchQuery, categoryFilter);
    } catch (err) {
      setError(err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this bill?')) return;
    try {
      await deleteBill(id);
      fetchBills(searchQuery, categoryFilter);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <div className="zoho-page-header d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3">
        <div>
          <h1 className="fw-bold fs-4 text-dark mb-1">Purchases & Vendor Bills</h1>
          <p className="text-secondary small mb-0">
            Record supplier bills, track expenses, and reconcile eligible Input Tax Credit (ITC).
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button
            type="button"
            className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1.5 fw-semibold px-3 py-1.5"
            onClick={() => setShowReconcileModal(true)}
          >
            <span>⚖️ Reconcile ITC & Refund</span>
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm d-flex align-items-center gap-1.5 fw-semibold px-3 py-1.5"
            onClick={handleOpenCreate}
          >
            <span>+ New Purchase Bill</span>
          </button>
        </div>
      </div>

      <div className="zoho-page-body">
        <ErrorMessage error={error} onRetry={() => fetchBills(searchQuery, categoryFilter)} />

        {/* Filter bar */}
        <div className="card border shadow-sm p-3 mb-4 bg-white">
          <div className="row g-2 align-items-center">
            <div className="col-12 col-md-5">
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-white border-end-0">🔍</span>
                <input
                  type="text"
                  className="form-control border-start-0"
                  placeholder="Search by vendor, bill #, GSTIN..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="col-6 col-md-3">
              <select
                className="form-select form-select-sm"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                <option value="Expense">General Expense</option>
                <option value="Inventory">Inventory Goods</option>
                <option value="Asset">Capital Asset</option>
                <option value="Service">Professional Service</option>
              </select>
            </div>
            <div className="col-6 col-md-4 text-end text-muted small">
              Bills: <strong className="text-dark">{bills.length}</strong>
            </div>
          </div>
        </div>

        {/* Bills Table */}
        <div className="card border shadow-sm bg-white overflow-hidden">
          {loading ? (
            <div className="p-4">
              <Loader message="Loading purchase bills..." />
            </div>
          ) : bills.length > 0 ? (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th className="ps-3.5">Bill #</th>
                    <th>Vendor</th>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Taxable (₹)</th>
                    <th>Tax / ITC (₹)</th>
                    <th>Grand Total (₹)</th>
                    <th>Status</th>
                    <th className="text-end pe-3.5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b._id}>
                      <td className="ps-3.5 font-monospace fw-bold text-dark">{b.billNumber}</td>
                      <td className="fw-medium text-dark">
                        <div>{b.vendorName}</div>
                        {b.vendorGstin && (
                          <span className="badge bg-light text-secondary border font-monospace" style={{ fontSize: '0.7rem' }}>
                            {b.vendorGstin}
                          </span>
                        )}
                      </td>
                      <td className="text-muted small">{formatDate(b.billDate)}</td>
                      <td>
                        <span className="badge bg-secondary-subtle text-secondary small">
                          {b.category || 'Expense'}
                        </span>
                      </td>
                      <td className="font-monospace small">{formatCurrency(b.subTotal)}</td>
                      <td className="font-monospace small text-info-emphasis">{formatCurrency(b.totalTax)}</td>
                      <td className="font-monospace fw-bold text-dark">{formatCurrency(b.grandTotal)}</td>
                      <td>
                        <span className={`zoho-badge-status zoho-status-${b.status?.toLowerCase()}`}>
                          {b.status}
                        </span>
                      </td>
                      <td className="text-end pe-3.5" style={{ minWidth: '160px', whiteSpace: 'nowrap' }}>
                        <div className="ct-action-group">
                          {b.status !== 'Paid' && (
                            <button
                              type="button"
                              className="ct-action-btn ct-action-btn-paid"
                              onClick={() => handleStatusChange(b._id, 'Paid')}
                              title="Mark as Paid"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              <span>Paid</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="ct-action-btn ct-action-btn-delete"
                            onClick={() => handleDelete(b._id)}
                            title="Delete Bill"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18" />
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-5">
              <div className="fs-1 mb-2">🧾</div>
              <h3 className="fs-6 fw-bold text-dark">No purchase bills recorded</h3>
              <p className="text-muted small mb-3">Record supplier bills to accurately track business ITC.</p>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={handleOpenCreate}
              >
                + Add Bill
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bill Create Modal */}
      {showModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content border-0 shadow-lg">
              <form onSubmit={handleSave}>
                <div className="modal-header border-bottom py-3 px-4">
                  <h5 className="modal-title fw-bold text-dark fs-6">Record Purchase Bill</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setShowModal(false)}
                    disabled={saving}
                  />
                </div>
                <div className="modal-body p-4">
                  <div className="row g-3">
                    <div className="col-12 col-md-6">
                      <label className="form-label small fw-semibold text-secondary">Vendor Name *</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Amazon Web Services India"
                        value={formData.vendorName}
                        onChange={(e) => setFormData({ ...formData, vendorName: e.target.value })}
                        required
                        disabled={saving}
                      />
                    </div>
                    <div className="col-12 col-md-6">
                      <label className="form-label small fw-semibold text-secondary">Vendor GSTIN</label>
                      <input
                        type="text"
                        className="form-control font-monospace text-uppercase"
                        placeholder="e.g. 29ABCDE1234F1Z5"
                        maxLength={15}
                        value={formData.vendorGstin}
                        onChange={(e) => setFormData({ ...formData, vendorGstin: e.target.value.toUpperCase() })}
                        disabled={saving}
                      />
                    </div>
                    <div className="col-12 col-md-4">
                      <label className="form-label small fw-semibold text-secondary">Vendor Bill / Ref # *</label>
                      <input
                        type="text"
                        className="form-control font-monospace"
                        placeholder="e.g. BILL-9842"
                        value={formData.billNumber}
                        onChange={(e) => setFormData({ ...formData, billNumber: e.target.value })}
                        required
                        disabled={saving}
                      />
                    </div>
                    <div className="col-12 col-md-4">
                      <label className="form-label small fw-semibold text-secondary">Bill Date *</label>
                      <input
                        type="date"
                        className="form-control"
                        value={formData.billDate}
                        onChange={(e) => setFormData({ ...formData, billDate: e.target.value })}
                        required
                        disabled={saving}
                      />
                    </div>
                    <div className="col-12 col-md-4">
                      <label className="form-label small fw-semibold text-secondary">Category</label>
                      <select
                        className="form-select"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        disabled={saving}
                      >
                        <option value="Expense">Expense</option>
                        <option value="Inventory">Inventory</option>
                        <option value="Asset">Capital Asset</option>
                        <option value="Service">Professional Service</option>
                      </select>
                    </div>

                    <div className="col-12 mt-3">
                      <div className="fw-semibold text-dark small border-bottom pb-1 mb-2">Item & Pricing</div>
                      <div className="row g-2">
                        <div className="col-12 col-md-5">
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Description / Product Name"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            required
                            disabled={saving}
                          />
                        </div>
                        <div className="col-4 col-md-2">
                          <input
                            type="number"
                            min="1"
                            className="form-control font-monospace"
                            placeholder="Qty"
                            value={formData.quantity}
                            onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                            required
                            disabled={saving}
                          />
                        </div>
                        <div className="col-4 col-md-3">
                          <input
                            type="number"
                            step="0.01"
                            className="form-control font-monospace"
                            placeholder="Rate (₹)"
                            value={formData.rate}
                            onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                            required
                            disabled={saving}
                          />
                        </div>
                        <div className="col-4 col-md-2">
                          <select
                            className="form-select"
                            value={formData.gstRate}
                            onChange={(e) => setFormData({ ...formData, gstRate: Number(e.target.value) })}
                            disabled={saving}
                          >
                            <option value={0}>0%</option>
                            <option value={5}>5%</option>
                            <option value={12}>12%</option>
                            <option value={18}>18%</option>
                            <option value={28}>28%</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="col-12">
                      <label className="form-label small fw-semibold text-secondary">Notes</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Optional internal remarks"
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        disabled={saving}
                      />
                    </div>
                  </div>
                </div>
                <div className="modal-footer border-top py-2.5 px-4 bg-light">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => setShowModal(false)}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm px-4 fw-semibold"
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Purchase Bill'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <ItcReconciliationModal
        isOpen={showReconcileModal}
        onClose={() => setShowReconcileModal(false)}
      />
    </div>
  );
}
