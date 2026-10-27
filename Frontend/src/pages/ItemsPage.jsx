import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listItems, createItem, updateItem, deleteItem } from '../api/items.api';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import { formatCurrency } from '../utils/format';

const INITIAL_ITEM = {
  name: '',
  type: 'goods',
  hsnSac: '',
  unit: 'PCS',
  sellingPrice: '',
  purchasePrice: '',
  gstRate: 18,
  description: ''
};

export default function ItemsPage() {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState(INITIAL_ITEM);
  const [saving, setSaving] = useState(false);

  const handleOpenCreate = useCallback(() => {
    setEditingItem(null);
    setFormData(INITIAL_ITEM);
    setShowModal(true);
  }, []);

  const fetchItems = useCallback(async (q = '', type = '') => {
    setLoading(true);
    setError(null);
    try {
      const res = await listItems({ q, type });
      setItems(res.data || []);
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
        fetchItems(searchQuery, typeFilter);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [fetchItems, searchQuery, typeFilter]);

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

  const handleOpenEdit = (item) => {
    setEditingItem(item);
    setFormData({
      name: item.name || '',
      type: item.type || 'goods',
      hsnSac: item.hsnSac || '',
      unit: item.unit || 'PCS',
      sellingPrice: item.sellingPrice || '',
      purchasePrice: item.purchasePrice || '',
      gstRate: item.gstRate !== undefined ? item.gstRate : 18,
      description: item.description || ''
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
      type: formData.type,
      hsnSac: formData.hsnSac.trim(),
      unit: formData.unit.trim().toUpperCase(),
      sellingPrice: Number(formData.sellingPrice) || 0,
      purchasePrice: Number(formData.purchasePrice) || 0,
      gstRate: Number(formData.gstRate) || 0,
      description: formData.description.trim()
    };

    try {
      if (editingItem) {
        await updateItem(editingItem._id, payload);
      } else {
        await createItem(payload);
      }
      setShowModal(false);
      fetchItems(searchQuery, typeFilter);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;
    try {
      await deleteItem(id);
      fetchItems(searchQuery, typeFilter);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <div className="zoho-page-header d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3">
        <div>
          <h1 className="fw-bold fs-4 text-dark mb-1">Items & Services</h1>
          <p className="text-secondary small mb-0">
            Configure goods, services, HSN/SAC codes, pricing, and default GST rates.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm d-flex align-items-center gap-1.5 fw-semibold px-3 py-1.5"
          onClick={handleOpenCreate}
        >
          <span>+ New Item / Service</span>
        </button>
      </div>

      <div className="zoho-page-body">
        <ErrorMessage error={error} onRetry={() => fetchItems(searchQuery, typeFilter)} />

        {/* Search & Filter Toolbar */}
        <div className="card border shadow-sm p-3 mb-4 bg-white">
          <div className="row g-2 align-items-center">
            <div className="col-12 col-md-5">
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-white border-end-0">🔍</span>
                <input
                  type="text"
                  className="form-control border-start-0"
                  placeholder="Search item by name, HSN/SAC code..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="col-6 col-md-3">
              <select
                className="form-select form-select-sm"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All Types (Goods & Services)</option>
                <option value="goods">Goods Only</option>
                <option value="service">Services Only</option>
              </select>
            </div>
            <div className="col-6 col-md-4 text-end text-muted small">
              Total Items: <strong className="text-dark">{items.length}</strong>
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div className="card border shadow-sm bg-white overflow-hidden">
          {loading ? (
            <div className="p-4">
              <Loader message="Loading items..." />
            </div>
          ) : items.length > 0 ? (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th className="ps-3.5">Name</th>
                    <th>Type</th>
                    <th>HSN / SAC</th>
                    <th>Unit</th>
                    <th>Selling Price</th>
                    <th>GST Rate</th>
                    <th className="text-end pe-3.5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it._id}>
                      <td className="ps-3.5">
                        <div className="fw-semibold text-dark">{it.name}</div>
                        {it.description && <div className="text-muted small text-truncate" style={{ maxWidth: '240px' }}>{it.description}</div>}
                      </td>
                      <td>
                        <span className={`badge ${it.type === 'service' ? 'bg-info-subtle text-info-emphasis' : 'bg-primary-subtle text-primary'}`}>
                          {it.type === 'service' ? 'Service' : 'Goods'}
                        </span>
                      </td>
                      <td className="font-monospace small text-muted">{it.hsnSac || '—'}</td>
                      <td className="text-dark small">{it.unit || 'PCS'}</td>
                      <td className="fw-bold text-dark">{formatCurrency(it.sellingPrice)}</td>
                      <td>
                        <span className="badge bg-secondary-subtle text-secondary font-monospace">
                          {it.gstRate}%
                        </span>
                      </td>
                      <td className="text-end pe-3.5">
                        <button
                          type="button"
                          className="btn btn-sm btn-link text-primary text-decoration-none p-1 me-2"
                          onClick={() => handleOpenEdit(it)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-link text-danger text-decoration-none p-1"
                          onClick={() => handleDelete(it._id)}
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
              <div className="fs-1 mb-2">📦</div>
              <h3 className="fs-6 fw-bold text-dark">No items or services registered</h3>
              <p className="text-muted small mb-3">Add items to speed up line item entry during invoice creation.</p>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={handleOpenCreate}
              >
                + Add Item
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Item Create/Edit Modal */}
      {showModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg">
              <form onSubmit={handleSave}>
                <div className="modal-header border-bottom py-3 px-4">
                  <h5 className="modal-title fw-bold text-dark fs-6">
                    {editingItem ? 'Edit Item' : 'New Item / Service'}
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
                    <div className="col-12">
                      <label className="form-label small fw-semibold text-secondary">Type *</label>
                      <div className="d-flex gap-3">
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="radio"
                            name="itemType"
                            id="typeGoods"
                            value="goods"
                            checked={formData.type === 'goods'}
                            onChange={() => setFormData({ ...formData, type: 'goods' })}
                            disabled={saving}
                          />
                          <label className="form-check-label small" htmlFor="typeGoods">Goods</label>
                        </div>
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="radio"
                            name="itemType"
                            id="typeService"
                            value="service"
                            checked={formData.type === 'service'}
                            onChange={() => setFormData({ ...formData, type: 'service' })}
                            disabled={saving}
                          />
                          <label className="form-check-label small" htmlFor="typeService">Service</label>
                        </div>
                      </div>
                    </div>

                    <div className="col-12">
                      <label className="form-label small fw-semibold text-secondary">Item Name *</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Dell UltraSharp 27 Monitor"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        disabled={saving}
                      />
                    </div>

                    <div className="col-6">
                      <label className="form-label small fw-semibold text-secondary">HSN / SAC Code</label>
                      <input
                        type="text"
                        className="form-control font-monospace"
                        placeholder="e.g. 8471"
                        value={formData.hsnSac}
                        onChange={(e) => setFormData({ ...formData, hsnSac: e.target.value })}
                        disabled={saving}
                      />
                    </div>

                    <div className="col-6">
                      <label className="form-label small fw-semibold text-secondary">Unit</label>
                      <select
                        className="form-select"
                        value={formData.unit}
                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                        disabled={saving}
                      >
                        <option value="PCS">PCS (Pieces)</option>
                        <option value="NOS">NOS (Numbers)</option>
                        <option value="BOX">BOX (Boxes)</option>
                        <option value="KGS">KGS (Kilograms)</option>
                        <option value="MTR">MTR (Meters)</option>
                        <option value="HRS">HRS (Hours)</option>
                      </select>
                    </div>

                    <div className="col-6">
                      <label className="form-label small fw-semibold text-secondary">Selling Price (₹) *</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control font-monospace"
                        placeholder="0.00"
                        value={formData.sellingPrice}
                        onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value })}
                        required
                        disabled={saving}
                      />
                    </div>

                    <div className="col-6">
                      <label className="form-label small fw-semibold text-secondary">GST Tax Rate *</label>
                      <select
                        className="form-select"
                        value={formData.gstRate}
                        onChange={(e) => setFormData({ ...formData, gstRate: Number(e.target.value) })}
                        disabled={saving}
                      >
                        <option value={0}>0% (Nil / Exempt)</option>
                        <option value={5}>5%</option>
                        <option value={12}>12%</option>
                        <option value={18}>18% (Standard)</option>
                        <option value={28}>28%</option>
                      </select>
                    </div>

                    <div className="col-12">
                      <label className="form-label small fw-semibold text-secondary">Description</label>
                      <textarea
                        className="form-control"
                        rows={2}
                        placeholder="Optional details or specifications"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
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
                    {saving ? 'Saving...' : editingItem ? 'Update Item' : 'Save Item'}
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
