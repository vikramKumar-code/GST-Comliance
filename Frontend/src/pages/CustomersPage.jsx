import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listCustomers, createCustomer, updateCustomer, deleteCustomer } from '../api/customers.api';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';

const INITIAL_FORM = {
  name: '',
  companyName: '',
  gstin: '',
  email: '',
  phone: '',
  gstType: 'Regular',
  placeOfSupply: '',
  billingStreet: '',
  billingCity: '',
  billingState: '',
  billingStateCode: '',
  billingPincode: ''
};

export default function CustomersPage() {
  const [searchParams] = useSearchParams();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  const handleOpenCreate = useCallback(() => {
    setEditingCustomer(null);
    setFormData(INITIAL_FORM);
    setShowModal(true);
  }, []);

  const fetchCustomers = useCallback(async (query = '') => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCustomers({ q: query });
      setCustomers(res.data || []);
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
        fetchCustomers(searchQuery);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [fetchCustomers, searchQuery]);

  // Open modal if URL has ?action=new
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

  const handleOpenEdit = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name || '',
      companyName: customer.companyName || '',
      gstin: customer.gstin || '',
      email: customer.email || '',
      phone: customer.phone || '',
      gstType: customer.gstType || 'Regular',
      placeOfSupply: customer.placeOfSupply || '',
      billingStreet: customer.billingAddress?.street || '',
      billingCity: customer.billingAddress?.city || '',
      billingState: customer.billingAddress?.state || '',
      billingStateCode: customer.billingAddress?.stateCode || '',
      billingPincode: customer.billingAddress?.pincode || ''
    });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setSaving(true);
    setError(null);

    const payload = {
      name: formData.name.trim(),
      companyName: formData.companyName.trim(),
      gstin: formData.gstin.trim().toUpperCase(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      gstType: formData.gstType,
      placeOfSupply: formData.placeOfSupply || (formData.gstin ? formData.gstin.slice(0, 2) : ''),
      billingAddress: {
        street: formData.billingStreet,
        city: formData.billingCity,
        state: formData.billingState,
        stateCode: formData.billingStateCode || (formData.gstin ? formData.gstin.slice(0, 2) : ''),
        pincode: formData.billingPincode,
        country: 'India'
      }
    };

    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer._id, payload);
      } else {
        await createCustomer(payload);
      }
      setShowModal(false);
      fetchCustomers(searchQuery);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this customer?')) return;
    try {
      await deleteCustomer(id);
      fetchCustomers(searchQuery);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <div className="zoho-page-header d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3">
        <div>
          <h1 className="fw-bold fs-4 text-dark mb-1">Customers</h1>
          <p className="text-secondary small mb-0">
            Manage client profiles, GSTINs, and default places of supply.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm d-flex align-items-center gap-1.5 fw-semibold px-3 py-1.5"
          onClick={handleOpenCreate}
        >
          <span>+ New Customer</span>
        </button>
      </div>

      <div className="zoho-page-body">
        <ErrorMessage error={error} onRetry={() => fetchCustomers(searchQuery)} />

        {/* Filter & Search Bar */}
        <div className="card border shadow-sm p-3 mb-4 bg-white">
          <div className="row g-2 align-items-center">
            <div className="col-12 col-md-5">
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-white border-end-0">🔍</span>
                <input
                  type="text"
                  className="form-control border-start-0"
                  placeholder="Search by customer name, GSTIN, phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="col-12 col-md-7 text-md-end text-muted small">
              Total Customers: <strong className="text-dark">{customers.length}</strong>
            </div>
          </div>
        </div>

        {/* Customers Table */}
        <div className="card border shadow-sm bg-white overflow-hidden">
          {loading ? (
            <div className="p-4">
              <Loader message="Loading customers..." />
            </div>
          ) : customers.length > 0 ? (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th className="ps-3.5">Customer Name</th>
                    <th>Company</th>
                    <th>GSTIN</th>
                    <th>State / POS</th>
                    <th>Phone</th>
                    <th>GST Type</th>
                    <th className="text-end pe-3.5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c._id}>
                      <td className="ps-3.5 fw-semibold text-dark">{c.name}</td>
                      <td className="text-muted">{c.companyName || '—'}</td>
                      <td className="font-monospace small">
                        {c.gstin ? (
                          <span className="badge bg-light text-dark border font-monospace">
                            {c.gstin}
                          </span>
                        ) : (
                          <span className="text-muted">Unregistered</span>
                        )}
                      </td>
                      <td className="text-dark small">
                        {c.placeOfSupply ? `Code ${c.placeOfSupply}` : c.billingAddress?.state || '—'}
                      </td>
                      <td className="text-muted small">{c.phone || '—'}</td>
                      <td>
                        <span className="badge bg-secondary-subtle text-secondary small">
                          {c.gstType || 'Regular'}
                        </span>
                      </td>
                      <td className="text-end pe-3.5">
                        <button
                          type="button"
                          className="btn btn-sm btn-link text-primary text-decoration-none p-1 me-2"
                          onClick={() => handleOpenEdit(c)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-link text-danger text-decoration-none p-1"
                          onClick={() => handleDelete(c._id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-5">
              <div className="fs-1 mb-2">👥</div>
              <h3 className="fs-6 fw-bold text-dark">No customers found</h3>
              <p className="text-muted small mb-3">Add customers to issue tax invoices and track balances.</p>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={handleOpenCreate}
              >
                + Add Customer
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Customer Create/Edit Modal */}
      {showModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content border-0 shadow-lg">
              <form onSubmit={handleSave}>
                <div className="modal-header border-bottom py-3 px-4">
                  <h5 className="modal-title fw-bold text-dark fs-6">
                    {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
                  </h5>
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
                      <label className="form-label small fw-semibold text-secondary">
                        Primary Contact / Name *
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Ramesh Patel"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        disabled={saving}
                      />
                    </div>
                    <div className="col-12 col-md-6">
                      <label className="form-label small fw-semibold text-secondary">
                        Company / Trade Name
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Patel Enterprises Pvt Ltd"
                        value={formData.companyName}
                        onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                        disabled={saving}
                      />
                    </div>
                    <div className="col-12 col-md-6">
                      <label className="form-label small fw-semibold text-secondary">
                        Customer GSTIN (15-Digit)
                      </label>
                      <input
                        type="text"
                        className="form-control font-monospace text-uppercase"
                        placeholder="e.g. 29ABCDE1234F1Z5"
                        maxLength={15}
                        value={formData.gstin}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          setFormData({
                            ...formData,
                            gstin: val,
                            placeOfSupply: val.length >= 2 ? val.slice(0, 2) : formData.placeOfSupply
                          });
                        }}
                        disabled={saving}
                      />
                    </div>
                    <div className="col-12 col-md-6">
                      <label className="form-label small fw-semibold text-secondary">
                        GST Treatment
                      </label>
                      <select
                        className="form-select"
                        value={formData.gstType}
                        onChange={(e) => setFormData({ ...formData, gstType: e.target.value })}
                        disabled={saving}
                      >
                        <option value="Regular">Registered Business - Regular</option>
                        <option value="Composition">Registered Business - Composition</option>
                        <option value="Consumer">Consumer</option>
                        <option value="Unregistered">Unregistered Business</option>
                        <option value="Overseas">Overseas / SEZ</option>
                      </select>
                    </div>
                    <div className="col-12 col-md-4">
                      <label className="form-label small fw-semibold text-secondary">
                        Email Address
                      </label>
                      <input
                        type="email"
                        className="form-control"
                        placeholder="billing@example.com"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        disabled={saving}
                      />
                    </div>
                    <div className="col-12 col-md-4">
                      <label className="form-label small fw-semibold text-secondary">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        className="form-control"
                        placeholder="9876543210"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        disabled={saving}
                      />
                    </div>
                    <div className="col-12 col-md-4">
                      <label className="form-label small fw-semibold text-secondary">
                        Place of Supply (POS State Code)
                      </label>
                      <input
                        type="text"
                        className="form-control font-monospace"
                        placeholder="e.g. 29"
                        maxLength={2}
                        value={formData.placeOfSupply}
                        onChange={(e) => setFormData({ ...formData, placeOfSupply: e.target.value })}
                        disabled={saving}
                      />
                    </div>

                    <div className="col-12 mt-3">
                      <div className="fw-semibold text-dark small border-bottom pb-1 mb-2">Billing Address</div>
                      <div className="row g-2">
                        <div className="col-12">
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Street Address / Building"
                            value={formData.billingStreet}
                            onChange={(e) => setFormData({ ...formData, billingStreet: e.target.value })}
                            disabled={saving}
                          />
                        </div>
                        <div className="col-12 col-md-4">
                          <input
                            type="text"
                            className="form-control"
                            placeholder="City"
                            value={formData.billingCity}
                            onChange={(e) => setFormData({ ...formData, billingCity: e.target.value })}
                            disabled={saving}
                          />
                        </div>
                        <div className="col-12 col-md-4">
                          <input
                            type="text"
                            className="form-control"
                            placeholder="State"
                            value={formData.billingState}
                            onChange={(e) => setFormData({ ...formData, billingState: e.target.value })}
                            disabled={saving}
                          />
                        </div>
                        <div className="col-12 col-md-4">
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Pincode"
                            value={formData.billingPincode}
                            onChange={(e) => setFormData({ ...formData, billingPincode: e.target.value })}
                            disabled={saving}
                          />
                        </div>
                      </div>
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
                    {saving ? 'Saving...' : editingCustomer ? 'Update Customer' : 'Save Customer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
