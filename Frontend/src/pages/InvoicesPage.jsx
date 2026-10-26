import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { listInvoices, createInvoice, updateInvoice, deleteInvoice } from '../api/invoices.api';
import { listCustomers } from '../api/customers.api';
import { listItems } from '../api/items.api';
import { useAuth } from '../context/AuthContext';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import { formatCurrency, formatDate } from '../utils/format';

const DEFAULT_LINE_ITEM = {
  itemId: '',
  name: '',
  description: '',
  hsnSac: '',
  unit: 'PCS',
  quantity: 1,
  rate: 0,
  discount: 0,
  gstRate: 18
};

export default function InvoicesPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [availableItems, setAvailableItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // View / Modal state
  const [isCreating, setIsCreating] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [lineItems, setLineItems] = useState([{ ...DEFAULT_LINE_ITEM }]);
  const [notes, setNotes] = useState('Thanks for your business.');
  const [status, setStatus] = useState('Draft');

  const sellerState = (user?.gstin && user.gstin.length >= 2) ? user.gstin.slice(0, 2) : '29';

  const fetchInvoices = useCallback(async (q = '', st = '') => {
    setLoading(true);
    setError(null);
    try {
      const res = await listInvoices({ q, status: st });
      setInvoices(res.data || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReferenceData = useCallback(async () => {
    try {
      const [custRes, itemRes] = await Promise.all([
        listCustomers({ limit: 100 }),
        listItems()
      ]);
      setCustomers(custRes.data || []);
      setAvailableItems(itemRes.data || []);
    } catch {
      // Non-critical reference load failure
    }
  }, []);

  const handleOpenCreate = useCallback(() => {
    setCustomerId('');
    setCustomerName('');
    setCustomerGstin('');
    setPlaceOfSupply(sellerState);
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setDueDate('');
    setLineItems([{ ...DEFAULT_LINE_ITEM }]);
    setStatus('Draft');
    setIsCreating(true);
  }, [sellerState]);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) {
        fetchInvoices(searchQuery, statusFilter);
        loadReferenceData();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [fetchInvoices, loadReferenceData, searchQuery, statusFilter]);

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

  const handleCustomerSelect = (id) => {
    setCustomerId(id);
    const selected = customers.find((c) => c._id === id);
    if (selected) {
      setCustomerName(selected.companyName || selected.name);
      setCustomerGstin(selected.gstin || '');
      const pos = selected.placeOfSupply || (selected.gstin ? selected.gstin.slice(0, 2) : sellerState);
      setPlaceOfSupply(pos);
    }
  };

  const handleItemSelect = (index, itemId) => {
    const selected = availableItems.find((it) => it._id === itemId);
    const updated = [...lineItems];
    if (selected) {
      updated[index] = {
        ...updated[index],
        itemId: selected._id,
        name: selected.name,
        hsnSac: selected.hsnSac || '',
        rate: selected.sellingPrice || 0,
        gstRate: selected.gstRate !== undefined ? selected.gstRate : 18,
        unit: selected.unit || 'PCS'
      };
    } else {
      updated[index].itemId = '';
    }
    setLineItems(updated);
  };

  const updateLineItem = (index, field, value) => {
    const updated = [...lineItems];
    updated[index][field] = value;
    setLineItems(updated);
  };

  const addLineItemRow = () => {
    setLineItems([...lineItems, { ...DEFAULT_LINE_ITEM }]);
  };

  const removeLineItemRow = (index) => {
    if (lineItems.length === 1) return;
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  // Real-time tax calculations
  const invoiceCalculations = useMemo(() => {
    const pos = placeOfSupply || sellerState;
    const isIntraState = !pos || !sellerState || pos === sellerState;

    const computedItems = lineItems.map((item) => {
      const qty = Math.max(0, Number(item.quantity) || 1);
      const rate = Math.max(0, Number(item.rate) || 0);
      const discount = Math.max(0, Number(item.discount) || 0);
      const taxable = Math.max(0, (qty * rate) - discount);
      const gstRate = Math.max(0, Number(item.gstRate) || 0);

      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (isIntraState) {
        cgst = Math.round((taxable * ((gstRate / 2) / 100)) * 100) / 100;
        sgst = Math.round((taxable * ((gstRate / 2) / 100)) * 100) / 100;
      } else {
        igst = Math.round((taxable * (gstRate / 100)) * 100) / 100;
      }

      const totalTax = Math.round((cgst + sgst + igst) * 100) / 100;
      const totalAmount = Math.round((taxable + totalTax) * 100) / 100;

      return {
        ...item,
        taxableAmount: taxable,
        cgstAmount: cgst,
        sgstAmount: sgst,
        igstAmount: igst,
        totalTax,
        totalAmount
      };
    });

    const subTotal = Math.round(computedItems.reduce((acc, it) => acc + it.taxableAmount, 0) * 100) / 100;
    const totalCgst = Math.round(computedItems.reduce((acc, it) => acc + it.cgstAmount, 0) * 100) / 100;
    const totalSgst = Math.round(computedItems.reduce((acc, it) => acc + it.sgstAmount, 0) * 100) / 100;
    const totalIgst = Math.round(computedItems.reduce((acc, it) => acc + it.igstAmount, 0) * 100) / 100;
    const totalTax = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100;
    const grandTotal = Math.round((subTotal + totalTax) * 100) / 100;

    return {
      computedItems,
      subTotal,
      totalCgst,
      totalSgst,
      totalIgst,
      totalTax,
      grandTotal,
      isIntraState
    };
  }, [lineItems, placeOfSupply, sellerState]);

  const handleSaveInvoice = async (e) => {
    e.preventDefault();
    if (!customerName.trim()) {
      alert('Please enter or select a customer.');
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      invoiceNumber: invoiceNumber.trim() || undefined,
      invoiceDate,
      dueDate: dueDate || undefined,
      customerId: customerId || undefined,
      customerName: customerName.trim(),
      customerGstin: customerGstin.trim().toUpperCase(),
      placeOfSupply: placeOfSupply || sellerState,
      lineItems: invoiceCalculations.computedItems,
      status,
      notes
    };

    try {
      await createInvoice(payload);
      setIsCreating(false);
      fetchInvoices(searchQuery, statusFilter);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateInvoice(id, { status: newStatus });
      fetchInvoices(searchQuery, statusFilter);
      if (viewingInvoice && viewingInvoice._id === id) {
        setViewingInvoice({ ...viewingInvoice, status: newStatus });
      }
    } catch (err) {
      setError(err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this invoice?')) return;
    try {
      await deleteInvoice(id);
      fetchInvoices(searchQuery, statusFilter);
      if (viewingInvoice && viewingInvoice._id === id) {
        setViewingInvoice(null);
      }
    } catch (err) {
      setError(err);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div>
      {/* Header */}
      <div className="zoho-page-header d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3">
        <div>
          <h1 className="fw-bold fs-4 text-dark mb-1">Sales Invoices</h1>
          <p className="text-secondary small mb-0">
            Create tax invoices, compute CGST/SGST vs IGST, and manage receivables.
          </p>
        </div>
        {!isCreating && (
          <div className="d-flex align-items-center gap-2">
            <Link
              to="/returns/gstr1"
              className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1.5 fw-semibold px-3 py-1.5"
            >
              <span>📋 File GSTR-1</span>
            </Link>
            <button
              type="button"
              className="btn btn-primary btn-sm d-flex align-items-center gap-1.5 fw-semibold px-3 py-1.5"
              onClick={handleOpenCreate}
            >
              <span>+ New Invoice</span>
            </button>
          </div>
        )}
      </div>

      <div className="zoho-page-body">
        <ErrorMessage error={error} onRetry={() => fetchInvoices(searchQuery, statusFilter)} />

        {/* Create Invoice Form View */}
        {isCreating ? (
          <div className="card border shadow-sm p-4 bg-white mb-4">
            <div className="d-flex justify-content-between align-items-center pb-3 mb-4 border-bottom">
              <h2 className="fs-5 fw-bold text-dark mb-0">Create New Tax Invoice</h2>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setIsCreating(false)}
                disabled={saving}
              >
                ✕ Cancel
              </button>
            </div>

            <form onSubmit={handleSaveInvoice}>
              <div className="row g-3 mb-4">
                {/* Customer Selector */}
                <div className="col-12 col-md-5">
                  <label className="form-label small fw-semibold text-secondary">Customer *</label>
                  <select
                    className="form-select mb-1"
                    value={customerId}
                    onChange={(e) => handleCustomerSelect(e.target.value)}
                    disabled={saving}
                  >
                    <option value="">-- Choose Existing Customer or type below --</option>
                    {customers.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name} {c.companyName ? `(${c.companyName})` : ''} {c.gstin ? `[${c.gstin}]` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Customer Name / Business Name *"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    required
                    disabled={saving}
                  />
                </div>

                {/* Customer GSTIN */}
                <div className="col-12 col-md-4">
                  <label className="form-label small fw-semibold text-secondary">Customer GSTIN</label>
                  <input
                    type="text"
                    className="form-control font-monospace text-uppercase"
                    placeholder="e.g. 29ABCDE1234F1Z5"
                    maxLength={15}
                    value={customerGstin}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      setCustomerGstin(val);
                      if (val.length >= 2) setPlaceOfSupply(val.slice(0, 2));
                    }}
                    disabled={saving}
                  />
                </div>

                {/* Place of Supply (POS) */}
                <div className="col-12 col-md-3">
                  <label className="form-label small fw-semibold text-secondary">
                    Place of Supply (POS) *
                  </label>
                  <input
                    type="text"
                    className="form-control font-monospace"
                    placeholder="e.g. 29"
                    maxLength={2}
                    value={placeOfSupply}
                    onChange={(e) => setPlaceOfSupply(e.target.value)}
                    required
                    disabled={saving}
                  />
                  <div className="form-text small text-muted">
                    Seller State: <code>{sellerState}</code> •{' '}
                    {invoiceCalculations.isIntraState ? (
                      <span className="text-success fw-semibold">Intra-state (CGST + SGST)</span>
                    ) : (
                      <span className="text-primary fw-semibold">Inter-state (IGST)</span>
                    )}
                  </div>
                </div>

                {/* Invoice Number */}
                <div className="col-12 col-md-4">
                  <label className="form-label small fw-semibold text-secondary">Invoice Number</label>
                  <input
                    type="text"
                    className="form-control font-monospace"
                    placeholder="Auto-generated (e.g. INV-202610-0001)"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value.toUpperCase())}
                    disabled={saving}
                  />
                </div>

                {/* Invoice Date */}
                <div className="col-12 col-md-4">
                  <label className="form-label small fw-semibold text-secondary">Invoice Date *</label>
                  <input
                    type="date"
                    className="form-control"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    required
                    disabled={saving}
                  />
                </div>

                {/* Due Date */}
                <div className="col-12 col-md-4">
                  <label className="form-label small fw-semibold text-secondary">Due Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>

              {/* Line Items Table */}
              <div className="mb-4">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h3 className="fs-6 fw-bold text-dark mb-0">Item Details & Tax Slabs</h3>
                  <span className="badge bg-light text-secondary border">
                    {invoiceCalculations.isIntraState ? 'Tax Mode: CGST + SGST' : 'Tax Mode: IGST'}
                  </span>
                </div>

                <div className="table-responsive border rounded-3 bg-white">
                  <table className="table table-bordered align-middle mb-0">
                    <thead className="table-light small">
                      <tr>
                        <th style={{ width: '28%' }}>Item / Description</th>
                        <th style={{ width: '12%' }}>HSN / SAC</th>
                        <th style={{ width: '10%' }}>Qty</th>
                        <th style={{ width: '14%' }}>Rate (₹)</th>
                        <th style={{ width: '10%' }}>Disc (₹)</th>
                        <th style={{ width: '12%' }}>GST Rate</th>
                        <th style={{ width: '14%' }}>Amount (₹)</th>
                        <th style={{ width: '4%' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceCalculations.computedItems.map((item, idx) => (
                        <tr key={idx}>
                          <td>
                            {availableItems.length > 0 && (
                              <select
                                className="form-select form-select-sm mb-1"
                                value={item.itemId || ''}
                                onChange={(e) => handleItemSelect(idx, e.target.value)}
                                disabled={saving}
                              >
                                <option value="">-- Select Saved Item --</option>
                                {availableItems.map((it) => (
                                  <option key={it._id} value={it._id}>
                                    {it.name} (₹{it.sellingPrice})
                                  </option>
                                ))}
                              </select>
                            )}
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              placeholder="Item name / details *"
                              value={item.name}
                              onChange={(e) => updateLineItem(idx, 'name', e.target.value)}
                              required
                              disabled={saving}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="form-control form-control-sm font-monospace"
                              placeholder="HSN"
                              value={item.hsnSac}
                              onChange={(e) => updateLineItem(idx, 'hsnSac', e.target.value)}
                              disabled={saving}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="1"
                              className="form-control form-control-sm font-monospace"
                              value={item.quantity}
                              onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)}
                              required
                              disabled={saving}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              className="form-control form-control-sm font-monospace"
                              value={item.rate}
                              onChange={(e) => updateLineItem(idx, 'rate', e.target.value)}
                              required
                              disabled={saving}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              className="form-control form-control-sm font-monospace"
                              value={item.discount}
                              onChange={(e) => updateLineItem(idx, 'discount', e.target.value)}
                              disabled={saving}
                            />
                          </td>
                          <td>
                            <select
                              className="form-select form-select-sm"
                              value={item.gstRate}
                              onChange={(e) => updateLineItem(idx, 'gstRate', Number(e.target.value))}
                              disabled={saving}
                            >
                              <option value={0}>0%</option>
                              <option value={5}>5%</option>
                              <option value={12}>12%</option>
                              <option value={18}>18%</option>
                              <option value={28}>28%</option>
                            </select>
                          </td>
                          <td className="text-end fw-bold font-monospace pe-3">
                            <div>{formatCurrency(item.totalAmount)}</div>
                            <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                              Taxable: {formatCurrency(item.taxableAmount)}
                            </div>
                          </td>
                          <td className="text-center">
                            {lineItems.length > 1 && (
                              <button
                                type="button"
                                className="btn btn-sm btn-link text-danger p-0"
                                onClick={() => removeLineItemRow(idx)}
                                title="Remove row"
                                disabled={saving}
                              >
                                ✕
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm mt-2"
                  onClick={addLineItemRow}
                  disabled={saving}
                >
                  + Add Item Row
                </button>
              </div>

              {/* Bottom Summary & Notes */}
              <div className="row g-4 justify-content-between mb-4">
                <div className="col-12 col-md-6">
                  <label className="form-label small fw-semibold text-secondary">Customer Notes</label>
                  <textarea
                    className="form-control mb-3"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={saving}
                  />
                  <div className="d-flex align-items-center gap-3">
                    <label className="form-label small fw-semibold text-secondary mb-0">Initial Status:</label>
                    <select
                      className="form-select form-select-sm w-auto"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      disabled={saving}
                    >
                      <option value="Draft">Draft</option>
                      <option value="Sent">Sent</option>
                      <option value="Paid">Paid</option>
                    </select>
                  </div>
                </div>

                {/* Totals Breakdown */}
                <div className="col-12 col-md-5">
                  <div className="p-3 bg-light rounded-3 border">
                    <div className="d-flex justify-content-between py-1 small">
                      <span className="text-secondary">Subtotal (Taxable Value):</span>
                      <strong className="font-monospace">{formatCurrency(invoiceCalculations.subTotal)}</strong>
                    </div>

                    {invoiceCalculations.isIntraState ? (
                      <>
                        <div className="d-flex justify-content-between py-1 small">
                          <span className="text-secondary">CGST:</span>
                          <span className="font-monospace">{formatCurrency(invoiceCalculations.totalCgst)}</span>
                        </div>
                        <div className="d-flex justify-content-between py-1 small">
                          <span className="text-secondary">SGST:</span>
                          <span className="font-monospace">{formatCurrency(invoiceCalculations.totalSgst)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="d-flex justify-content-between py-1 small">
                        <span className="text-secondary">IGST:</span>
                        <span className="font-monospace">{formatCurrency(invoiceCalculations.totalIgst)}</span>
                      </div>
                    )}

                    <div className="d-flex justify-content-between py-1 small border-top mt-1 pt-1">
                      <span className="text-secondary">Total Tax:</span>
                      <strong className="font-monospace text-primary">{formatCurrency(invoiceCalculations.totalTax)}</strong>
                    </div>

                    <div className="d-flex justify-content-between py-2 border-top mt-2 pt-2 fs-5">
                      <strong className="text-dark">Grand Total:</strong>
                      <strong className="text-dark font-monospace">{formatCurrency(invoiceCalculations.grandTotal)}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="d-flex justify-content-end gap-2 pt-3 border-top">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => setIsCreating(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary px-4 fw-semibold"
                  disabled={saving}
                >
                  {saving ? 'Saving to Database...' : 'Save Invoice'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <>
            {/* Search and Status Filter */}
            <div className="card border shadow-sm p-3 mb-4 bg-white">
              <div className="row g-2 align-items-center">
                <div className="col-12 col-md-5">
                  <div className="input-group input-group-sm">
                    <span className="input-group-text bg-white border-end-0">🔍</span>
                    <input
                      type="text"
                      className="form-control border-start-0"
                      placeholder="Search invoice #, customer name, GSTIN..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="col-6 col-md-3">
                  <select
                    className="form-select form-select-sm"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">All Statuses</option>
                    <option value="Draft">Draft</option>
                    <option value="Sent">Sent</option>
                    <option value="Paid">Paid</option>
                    <option value="Overdue">Overdue</option>
                  </select>
                </div>
                <div className="col-6 col-md-4 text-end text-muted small">
                  Invoices: <strong className="text-dark">{invoices.length}</strong>
                </div>
              </div>
            </div>

            {/* Invoices List Table */}
            <div className="card border shadow-sm bg-white overflow-hidden">
              {loading ? (
                <div className="p-4">
                  <Loader message="Loading invoices..." />
                </div>
              ) : invoices.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead>
                      <tr>
                        <th className="ps-3.5">Invoice #</th>
                        <th>Customer</th>
                        <th>Date</th>
                        <th>Due Date</th>
                        <th>Taxable (₹)</th>
                        <th>Tax (₹)</th>
                        <th>Grand Total (₹)</th>
                        <th>Status</th>
                        <th className="text-end pe-3.5">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv._id}>
                          <td className="ps-3.5 font-monospace fw-bold">
                            <button
                              type="button"
                              className="btn btn-link text-primary text-decoration-none p-0 fw-bold font-monospace"
                              onClick={() => setViewingInvoice(inv)}
                            >
                              {inv.invoiceNumber}
                            </button>
                          </td>
                          <td className="fw-medium text-dark">
                            <div>{inv.customerName}</div>
                            {inv.customerGstin && (
                              <span className="badge bg-light text-secondary border font-monospace" style={{ fontSize: '0.7rem' }}>
                                {inv.customerGstin}
                              </span>
                            )}
                          </td>
                          <td className="text-muted small">{formatDate(inv.invoiceDate)}</td>
                          <td className="text-muted small">{inv.dueDate ? formatDate(inv.dueDate) : '—'}</td>
                          <td className="font-monospace small">{formatCurrency(inv.subTotal)}</td>
                          <td className="font-monospace small text-primary">{formatCurrency(inv.totalTax)}</td>
                          <td className="font-monospace fw-bold text-dark">{formatCurrency(inv.grandTotal)}</td>
                          <td>
                            <span className={`zoho-badge-status zoho-status-${inv.status?.toLowerCase()}`}>
                              {inv.status}
                            </span>
                          </td>
                          <td className="text-end pe-3.5">
                            <button
                              type="button"
                              className="btn btn-sm btn-link text-primary text-decoration-none p-1 me-1"
                              onClick={() => setViewingInvoice(inv)}
                            >
                              View
                            </button>
                            {inv.status !== 'Paid' && (
                              <button
                                type="button"
                                className="btn btn-sm btn-link text-success text-decoration-none p-1 me-1"
                                onClick={() => handleStatusChange(inv._id, 'Paid')}
                              >
                                Mark Paid
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm btn-link text-danger text-decoration-none p-1"
                              onClick={() => handleDelete(inv._id)}
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
                  <div className="fs-1 mb-2">📄</div>
                  <h3 className="fs-6 fw-bold text-dark">No sales invoices found</h3>
                  <p className="text-muted small mb-3">Create your first tax invoice with automated GST split.</p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleOpenCreate}
                  >
                    + Create Invoice
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Invoice Detail / Print Modal */}
      {viewingInvoice && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1055 }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header border-bottom py-2.5 px-4 bg-light d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center gap-2">
                  <span className="fw-bold text-dark fs-6">Tax Invoice:</span>
                  <span className="font-monospace fw-bold text-primary">{viewingInvoice.invoiceNumber}</span>
                  <span className={`zoho-badge-status zoho-status-${viewingInvoice.status?.toLowerCase()}`}>
                    {viewingInvoice.status}
                  </span>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={handlePrint}
                  >
                    🖨️ Print
                  </button>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setViewingInvoice(null)}
                  />
                </div>
              </div>

              <div className="modal-body p-4" id="printableInvoice">
                {/* Invoice Header */}
                <div className="d-flex justify-content-between align-items-start border-bottom pb-4 mb-4">
                  <div>
                    <h2 className="fs-4 fw-bold text-dark mb-1">TAX INVOICE</h2>
                    <div className="small text-muted font-monospace">Invoice #: <strong>{viewingInvoice.invoiceNumber}</strong></div>
                    <div className="small text-muted">Invoice Date: <strong>{formatDate(viewingInvoice.invoiceDate)}</strong></div>
                    {viewingInvoice.dueDate && (
                      <div className="small text-muted">Due Date: <strong>{formatDate(viewingInvoice.dueDate)}</strong></div>
                    )}
                  </div>
                  <div className="text-end">
                    <div className="fw-bold fs-5 text-primary mb-1">CandidTax</div>
                    <div className="small font-monospace">GSTIN: {user?.gstin || 'Taxpayer'}</div>
                    <div className="small text-muted">State Code: {sellerState}</div>
                  </div>
                </div>

                {/* Billed To / Shipped To */}
                <div className="row g-3 mb-4">
                  <div className="col-12 col-md-6">
                    <div className="text-muted small text-uppercase fw-semibold mb-1">Billed To (Customer):</div>
                    <div className="fw-bold text-dark fs-6">{viewingInvoice.customerName}</div>
                    {viewingInvoice.customerGstin && (
                      <div className="small font-monospace text-secondary">GSTIN: {viewingInvoice.customerGstin}</div>
                    )}
                    <div className="small text-muted">
                      Place of Supply: <strong>{viewingInvoice.placeOfSupply}</strong>
                    </div>
                  </div>
                  <div className="col-12 col-md-6 text-md-end">
                    <div className="text-muted small text-uppercase fw-semibold mb-1">Tax Computation:</div>
                    <span className="badge bg-light text-dark border font-monospace">
                      {viewingInvoice.totalIgst > 0 ? 'Inter-state Supply (IGST)' : 'Intra-state Supply (CGST + SGST)'}
                    </span>
                  </div>
                </div>

                {/* Line Items */}
                <div className="table-responsive border rounded-2 mb-4">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light small">
                      <tr>
                        <th className="ps-3">Item</th>
                        <th>HSN</th>
                        <th className="text-center">Qty</th>
                        <th className="text-end">Rate</th>
                        <th className="text-end">Taxable</th>
                        <th className="text-center">GST %</th>
                        <th className="text-end pe-3">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewingInvoice.lineItems?.map((it, idx) => (
                        <tr key={idx}>
                          <td className="ps-3">
                            <div className="fw-semibold text-dark">{it.name}</div>
                            {it.description && <div className="text-muted small">{it.description}</div>}
                          </td>
                          <td className="font-monospace small text-muted">{it.hsnSac || '—'}</td>
                          <td className="text-center font-monospace">{it.quantity}</td>
                          <td className="text-end font-monospace">{formatCurrency(it.rate)}</td>
                          <td className="text-end font-monospace">{formatCurrency(it.taxableAmount)}</td>
                          <td className="text-center font-monospace small">{it.gstRate}%</td>
                          <td className="text-end font-monospace fw-bold pe-3">{formatCurrency(it.totalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="row justify-content-end">
                  <div className="col-12 col-md-5">
                    <div className="p-3 bg-light rounded-2 border">
                      <div className="d-flex justify-content-between py-1 small">
                        <span>Taxable Value:</span>
                        <span className="font-monospace">{formatCurrency(viewingInvoice.subTotal)}</span>
                      </div>
                      {viewingInvoice.totalCgst > 0 && (
                        <div className="d-flex justify-content-between py-1 small">
                          <span>CGST:</span>
                          <span className="font-monospace">{formatCurrency(viewingInvoice.totalCgst)}</span>
                        </div>
                      )}
                      {viewingInvoice.totalSgst > 0 && (
                        <div className="d-flex justify-content-between py-1 small">
                          <span>SGST:</span>
                          <span className="font-monospace">{formatCurrency(viewingInvoice.totalSgst)}</span>
                        </div>
                      )}
                      {viewingInvoice.totalIgst > 0 && (
                        <div className="d-flex justify-content-between py-1 small">
                          <span>IGST:</span>
                          <span className="font-monospace">{formatCurrency(viewingInvoice.totalIgst)}</span>
                        </div>
                      )}
                      <div className="d-flex justify-content-between py-1.5 border-top mt-1 fw-bold fs-6">
                        <span>Total (INR):</span>
                        <span className="font-monospace">{formatCurrency(viewingInvoice.grandTotal)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {viewingInvoice.notes && (
                  <div className="mt-4 pt-3 border-top small text-muted">
                    <strong>Notes:</strong> {viewingInvoice.notes}
                  </div>
                )}
              </div>

              <div className="modal-footer border-top py-2.5 px-4 bg-light">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setViewingInvoice(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
