import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  listInvoices,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  generateEInvoice,
  cancelEInvoice,
  generateEwayBill
} from '../api/invoices.api';
import { listCustomers } from '../api/customers.api';
import { listItems } from '../api/items.api';
import { useAuth } from '../context/AuthContext';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import {
  formatCurrency,
  formatDate,
  formatTallyDate,
  getStateName,
  numberToWords
} from '../utils/format';

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
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [saving, setSaving] = useState(false);

  // E-Invoice & E-Way Bill state
  const [eInvLoading, setEInvLoading] = useState(false);
  const [generatingInvoiceId, setGeneratingInvoiceId] = useState(null);
  const [ewbLoading, setEwbLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [eInvError, setEInvError] = useState(null);
  const [eInvSuccess, setEInvSuccess] = useState(null);
  const [showEwbModal, setShowEwbModal] = useState(false);
  const [ewbForm, setEwbForm] = useState({
    vehicleNo: '',
    transporterId: '',
    transporterName: '',
    distance: 0,
    transportMode: '1'
  });
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelForm, setCancelForm] = useState({
    reasonCode: '1',
    remarks: 'Data entry mistake'
  });
  const [copiedIrn, setCopiedIrn] = useState(false);

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
    setEditingInvoiceId(null);
    setCustomerId('');
    setCustomerName('');
    setCustomerGstin('');
    setPlaceOfSupply(sellerState);
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setDueDate('');
    setLineItems([{ ...DEFAULT_LINE_ITEM }]);
    setStatus('Draft');
    setNotes('Thanks for your business.');
    setIsCreating(true);
  }, [sellerState]);

  const handleOpenEdit = useCallback((inv) => {
    if (!inv) return;
    setEditingInvoiceId(inv._id);
    setCustomerId(inv.customerId || '');
    setCustomerName(inv.customerName || '');
    setCustomerGstin(inv.customerGstin || '');
    const pos = inv.placeOfSupply || (inv.customerGstin && inv.customerGstin.length >= 2 ? inv.customerGstin.slice(0, 2) : sellerState);
    setPlaceOfSupply(pos);
    setInvoiceNumber(inv.invoiceNumber || '');
    setInvoiceDate(inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    setDueDate(inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '');
    if (inv.lineItems && inv.lineItems.length > 0) {
      setLineItems(inv.lineItems.map((it) => ({
        itemId: it.itemId || '',
        name: it.name || '',
        description: it.description || '',
        hsnSac: it.hsnSac || '',
        unit: it.unit || 'PCS',
        quantity: it.quantity != null ? it.quantity : 1,
        rate: it.rate != null ? it.rate : 0,
        discount: it.discount != null ? it.discount : 0,
        gstRate: it.gstRate != null ? it.gstRate : 18
      })));
    } else {
      setLineItems([{ ...DEFAULT_LINE_ITEM }]);
    }
    setStatus(inv.status || 'Draft');
    setNotes(inv.notes != null ? inv.notes : 'Thanks for your business.');
    setViewingInvoice(null);
    setIsCreating(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

    const cleanGstin = customerGstin.trim().toUpperCase();
    if (cleanGstin) {
      const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!GSTIN_REGEX.test(cleanGstin)) {
        alert('Customer GSTIN is invalid. According to GST rules, GSTIN must be exactly 15 alphanumeric characters (e.g. 29ABCDE1234F1Z5) or left blank for B2C consumer sales.');
        return;
      }
    }

    const trimmedInvNum = invoiceNumber.trim().toUpperCase();
    if (trimmedInvNum && trimmedInvNum.length > 16) {
      alert('Invoice number cannot exceed 16 characters as per Rule 46(b) of CGST Rules.');
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
      if (editingInvoiceId) {
        const res = await updateInvoice(editingInvoiceId, payload);
        const updated = res.data || res;
        setInvoices((prev) => prev.map((inv) => (inv._id === editingInvoiceId ? updated : inv)));
        if (viewingInvoice && viewingInvoice._id === editingInvoiceId) {
          setViewingInvoice(updated);
        }
      } else {
        await createInvoice(payload);
      }
      setIsCreating(false);
      setEditingInvoiceId(null);
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

  const handleGenerateEInvoice = async (invoiceId) => {
    setGeneratingInvoiceId(invoiceId);
    setEInvLoading(true);
    setEInvError(null);
    setEInvSuccess(null);
    try {
      const res = await generateEInvoice(invoiceId);
      const updated = res.data || res;
      if (updated && updated._id) {
        if (viewingInvoice && viewingInvoice._id === updated._id) {
          setViewingInvoice(updated);
        }
        setInvoices((prev) => prev.map((inv) => (inv._id === updated._id ? updated : inv)));
        setEInvSuccess('E-Invoice (IRN) generated successfully!');
      }
    } catch (err) {
      const msg = err.data?.message || err.message || 'Failed to generate E-Invoice.';
      setEInvError(msg);
      if (msg.includes('already generated')) {
        fetchInvoices(searchQuery, statusFilter);
      }
    } finally {
      setEInvLoading(false);
      setGeneratingInvoiceId(null);
    }
  };

  const handleOpenEwbModal = () => {
    setEwbForm({
      vehicleNo: viewingInvoice?.vehicleNo || '',
      transporterId: viewingInvoice?.transporterId || '',
      transporterName: viewingInvoice?.transporterName || '',
      distance: 0,
      transportMode: viewingInvoice?.transportMode || '1'
    });
    setEInvError(null);
    setEInvSuccess(null);
    setShowEwbModal(true);
  };

  const handleGenerateEwbSubmit = async (e) => {
    e.preventDefault();
    if (!viewingInvoice) return;
    setEwbLoading(true);
    setEInvError(null);
    try {
      const res = await generateEwayBill(viewingInvoice._id, ewbForm);
      const updated = res.data || res;
      if (updated && updated._id) {
        setViewingInvoice(updated);
        setInvoices((prev) => prev.map((inv) => (inv._id === updated._id ? updated : inv)));
        setShowEwbModal(false);
        setEInvSuccess(`E-Way Bill #${updated.ewayBillNo} generated successfully!`);
      }
    } catch (err) {
      setEInvError(err.message || err.data?.message || 'Failed to generate E-Way Bill.');
    } finally {
      setEwbLoading(false);
    }
  };

  const handleCancelEInvoiceSubmit = async (e) => {
    e.preventDefault();
    if (!viewingInvoice) return;
    setCancelLoading(true);
    setEInvError(null);
    try {
      const res = await cancelEInvoice(viewingInvoice._id, cancelForm);
      const updated = res.data || res;
      if (updated && updated._id) {
        setViewingInvoice(updated);
        setInvoices((prev) => prev.map((inv) => (inv._id === updated._id ? updated : inv)));
        setShowCancelModal(false);
        setEInvSuccess('E-Invoice (IRN) cancelled successfully.');
      }
    } catch (err) {
      setEInvError(err.message || err.data?.message || 'Failed to cancel E-Invoice.');
    } finally {
      setCancelLoading(false);
    }
  };

  const handleCopyIrn = (irnText) => {
    if (!irnText) return;
    navigator.clipboard.writeText(irnText).then(() => {
      setCopiedIrn(true);
      setTimeout(() => setCopiedIrn(false), 2500);
    });
  };

  // Tally invoice computed properties
  const hsnBreakdown = useMemo(() => {
    if (!viewingInvoice?.lineItems) return [];
    const map = {};
    for (const it of viewingInvoice.lineItems) {
      const hsn = it.hsnSac || '3923';
      const taxable = Number(it.taxableAmount) || ((Number(it.quantity) || 1) * (Number(it.rate) || 0));
      const cgstRate = it.cgstRate || (viewingInvoice.totalCgst > 0 ? ((it.gstRate || 18) / 2) : 0);
      const sgstRate = it.sgstRate || (viewingInvoice.totalSgst > 0 ? ((it.gstRate || 18) / 2) : 0);
      const igstRate = it.igstRate || (viewingInvoice.totalIgst > 0 ? (it.gstRate || 18) : 0);

      let cgstAmt = Number(it.cgstAmount) || 0;
      let sgstAmt = Number(it.sgstAmount) || 0;
      let igstAmt = Number(it.igstAmount) || 0;

      if (!cgstAmt && !sgstAmt && !igstAmt) {
        if (viewingInvoice.totalIgst > 0) {
          igstAmt = Math.round(taxable * (igstRate / 100) * 100) / 100;
        } else {
          cgstAmt = Math.round(taxable * (cgstRate / 100) * 100) / 100;
          sgstAmt = Math.round(taxable * (sgstRate / 100) * 100) / 100;
        }
      }
      const totalTax = Number(it.totalTax) || (cgstAmt + sgstAmt + igstAmt);

      if (!map[hsn]) {
        map[hsn] = {
          hsn,
          taxable: 0,
          cgstRate,
          cgstAmount: 0,
          sgstRate,
          sgstAmount: 0,
          igstRate,
          igstAmount: 0,
          totalTax: 0
        };
      }
      map[hsn].taxable += taxable;
      map[hsn].cgstAmount += cgstAmt;
      map[hsn].sgstAmount += sgstAmt;
      map[hsn].igstAmount += igstAmt;
      map[hsn].totalTax += totalTax;
    }
    return Object.values(map);
  }, [viewingInvoice]);

  const totalInvoiceQty = useMemo(() => {
    if (!viewingInvoice?.lineItems) return 0;
    return viewingInvoice.lineItems.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
  }, [viewingInvoice]);

  const defaultUnit = viewingInvoice?.lineItems?.[0]?.unit || 'kg';

  const formatTallyNum = (val, decimals = 2) => {
    const n = Number(val) || 0;
    return n.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };

  const viewingTotalTax = (viewingInvoice?.totalTax != null && viewingInvoice.totalTax > 0)
    ? viewingInvoice.totalTax
    : ((Number(viewingInvoice?.totalCgst) || 0) + (Number(viewingInvoice?.totalSgst) || 0) + (Number(viewingInvoice?.totalIgst) || 0));

  const sellerDisplayName = user?.companyName || user?.name || user?.tradeName || 'OM Enterprises';
  const sellerDisplayGstin = user?.gstin || '06AAHPB8621K1ZR';
  const sellerDisplayStateCode = sellerDisplayGstin.slice(0, 2) || '06';
  const sellerDisplayStateName = getStateName(sellerDisplayStateCode);
  const sellerDisplayAddress = user?.address || '548 Sector-7 Faridabad';

  const buyerDisplayName = viewingInvoice?.customerName || 'Bhayana Computer Stationery Forms Private Limited';
  const buyerDisplayGstin = viewingInvoice?.customerGstin || '';
  const buyerDisplayStateCode = (viewingInvoice?.placeOfSupply && viewingInvoice.placeOfSupply.length === 2)
    ? viewingInvoice.placeOfSupply
    : (buyerDisplayGstin.length >= 2 ? buyerDisplayGstin.slice(0, 2) : sellerDisplayStateCode);
  const buyerDisplayStateName = getStateName(buyerDisplayStateCode);
  const posDisplayName = getStateName(viewingInvoice?.placeOfSupply || buyerDisplayStateCode);

  const buyerAddressDisplay = [
    viewingInvoice?.billingAddress?.street,
    viewingInvoice?.billingAddress?.city,
    viewingInvoice?.billingAddress?.pincode
  ].filter(Boolean).join(', ') || '2N-14B, Near 2 & 3Chowk, NIT Faridabad';


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

        {/* Create / Edit Invoice Form View */}
        {isCreating ? (
          <div className="card border shadow-sm p-4 bg-white mb-4">
            <div className="d-flex justify-content-between align-items-center pb-3 mb-4 border-bottom">
              <div>
                <h2 className="fs-5 fw-bold text-dark mb-0">
                  {editingInvoiceId ? 'Edit Tax Invoice' : 'Create New Tax Invoice'}
                </h2>
                {editingInvoiceId && (
                  <div className="small text-muted mt-1 font-monospace">
                    Editing <span className="fw-bold text-primary">#{invoiceNumber || 'Draft'}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => {
                  setIsCreating(false);
                  setEditingInvoiceId(null);
                }}
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
                  onClick={() => {
                    setIsCreating(false);
                    setEditingInvoiceId(null);
                  }}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary px-4 fw-semibold"
                  disabled={saving}
                >
                  {saving
                    ? (editingInvoiceId ? 'Updating Invoice...' : 'Saving to Database...')
                    : (editingInvoiceId ? 'Update Invoice' : 'Save Invoice')}
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
                        <th>E-Invoice (IRN)</th>
                        <th className="text-end pe-3.5" style={{ minWidth: '220px', whiteSpace: 'nowrap' }}>Actions</th>
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
                          <td>
                            {inv.einvoiceStatus === 'Generated' ? (
                              <div>
                                <span className="ct-badge-irn-active" title={`IRN: ${inv.irn || ''}`}>
                                  <span className="ct-badge-irn-pulse" />
                                  <span>IRN Active</span>
                                </span>
                                {inv.ewayBillNo && (
                                  <div className="small text-secondary font-monospace mt-1 d-flex align-items-center gap-1" style={{ fontSize: '0.72rem' }}>
                                    <span>🚚</span>
                                    <span>EWB: {inv.ewayBillNo}</span>
                                  </div>
                                )}
                              </div>
                            ) : inv.einvoiceStatus === 'Cancelled' ? (
                              <span className="badge bg-danger-subtle text-danger border border-danger-subtle px-2.5 py-1 rounded-pill fw-semibold" style={{ fontSize: '0.74rem' }}>
                                ✕ Cancelled
                              </span>
                            ) : inv.einvoiceStatus === 'Failed' ? (
                              <button
                                type="button"
                                className="ct-btn-irn-quick text-danger border-danger-subtle bg-danger-subtle"
                                onClick={() => handleGenerateEInvoice(inv._id)}
                                disabled={generatingInvoiceId === inv._id}
                                title={inv.einvoiceError || 'Click to retry generation'}
                              >
                                {generatingInvoiceId === inv._id ? (
                                  <>
                                    <span className="spinner-border spinner-border-sm" style={{ width: '0.7rem', height: '0.7rem' }} />
                                    <span>Retrying...</span>
                                  </>
                                ) : (
                                  <>
                                    <span>⚠️</span>
                                    <span>Retry IRN</span>
                                  </>
                                )}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="ct-btn-irn-quick"
                                onClick={() => handleGenerateEInvoice(inv._id)}
                                disabled={generatingInvoiceId === inv._id}
                                title="Generate Government E-Invoice (IRN) & Signed QR Code"
                              >
                                {generatingInvoiceId === inv._id ? (
                                  <>
                                    <span className="spinner-border spinner-border-sm" style={{ width: '0.7rem', height: '0.7rem' }} />
                                    <span>Generating...</span>
                                  </>
                                ) : (
                                  <>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                    </svg>
                                    <span>Generate IRN</span>
                                  </>
                                )}
                              </button>
                            )}
                          </td>
                          <td className="text-end pe-3.5" style={{ minWidth: '220px', whiteSpace: 'nowrap' }}>
                            <div className="ct-action-group">
                              <button
                                type="button"
                                className="ct-action-btn ct-action-btn-view"
                                onClick={() => setViewingInvoice(inv)}
                                title="View & Print Invoice"
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                                <span>View</span>
                              </button>

                              <button
                                type="button"
                                className="ct-action-btn ct-action-btn-edit"
                                onClick={() => handleOpenEdit(inv)}
                                title="Edit invoice details"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                  <path d="m15 5 4 4" />
                                </svg>
                                <span>Edit</span>
                              </button>

                              {inv.status !== 'Paid' && (
                                <button
                                  type="button"
                                  className="ct-action-btn ct-action-btn-paid"
                                  onClick={() => handleStatusChange(inv._id, 'Paid')}
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
                                onClick={() => handleDelete(inv._id)}
                                title="Delete Invoice"
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
          <div className="modal-dialog modal-dialog-centered modal-xl" style={{ maxWidth: '880px' }}>
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header border-bottom py-2.5 px-4 bg-light d-flex justify-content-between align-items-center d-print-none">
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
                    className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1.5 fw-semibold"
                    onClick={() => handleOpenEdit(viewingInvoice)}
                  >
                    <span>✏️</span> Edit Invoice
                  </button>
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

              <div className="modal-body p-4">
                {/* E-Invoice Feedback Alerts */}
                {eInvError && (
                  <div className="alert alert-danger alert-dismissible fade show d-flex align-items-center gap-2 py-2 px-3 small mb-3">
                    <span>⚠️</span>
                    <div className="flex-grow-1">{eInvError}</div>
                    <button type="button" className="btn-close py-2" onClick={() => setEInvError(null)} />
                  </div>
                )}
                {eInvSuccess && (
                  <div className="alert alert-success alert-dismissible fade show d-flex align-items-center gap-2 py-2 px-3 small mb-3">
                    <span>✓</span>
                    <div className="flex-grow-1">{eInvSuccess}</div>
                    <button type="button" className="btn-close py-2" onClick={() => setEInvSuccess(null)} />
                  </div>
                )}

                {/* E-Invoice Interactive Status & Operations Card */}
                <div className="card border mb-4 bg-light shadow-sm">
                  <div className="card-body p-3">
                    {viewingInvoice.einvoiceStatus === 'Generated' ? (
                      <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3">
                        <div className="d-flex align-items-center gap-3">
                          {viewingInvoice.qrCodeImage ? (
                            <img
                              src={`data:image/png;base64,${viewingInvoice.qrCodeImage}`}
                              alt="NIC Signed QR Code"
                              style={{ width: 90, height: 90, objectFit: 'contain' }}
                              className="rounded border bg-white p-1 shadow-sm flex-shrink-0"
                            />
                          ) : (
                            <div
                              className="rounded border bg-white d-flex align-items-center justify-content-center shadow-sm flex-shrink-0"
                              style={{ width: 90, height: 90, fontSize: '2rem' }}
                            >
                              📱
                            </div>
                          )}
                          <div>
                            <div className="d-flex align-items-center gap-2 mb-1">
                              <span className="badge bg-success text-white fw-semibold">⚡ IRN Active</span>
                              <span className="text-muted small">NIC Verified</span>
                            </div>
                            <div className="small font-monospace text-dark text-break mb-1" style={{ fontSize: '0.75rem', maxWidth: 440 }}>
                              <strong>IRN:</strong> {viewingInvoice.irn}
                              <button
                                type="button"
                                className="btn btn-sm btn-link p-0 ms-1.5 text-primary text-decoration-none font-sans"
                                onClick={() => handleCopyIrn(viewingInvoice.irn)}
                              >
                                {copiedIrn ? '✓ Copied' : '📋 Copy'}
                              </button>
                            </div>
                            <div className="small text-muted">
                              Ack No: <strong className="text-dark font-monospace">{viewingInvoice.ackNo}</strong> • Date:{' '}
                              <strong className="text-dark">{formatDate(viewingInvoice.ackDate)}</strong>
                            </div>
                            {viewingInvoice.ewayBillNo && (
                              <div className="small text-primary mt-1 font-monospace">
                                🚚 E-Way Bill: <strong>#{viewingInvoice.ewayBillNo}</strong>
                                {viewingInvoice.vehicleNo && ` • Vehicle: ${viewingInvoice.vehicleNo}`}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="d-flex flex-column flex-sm-row align-items-stretch align-items-md-center gap-2 flex-shrink-0">
                          {!viewingInvoice.ewayBillNo && (
                            <button
                              type="button"
                              className="btn btn-outline-primary btn-sm d-flex align-items-center justify-content-center gap-1.5 fw-semibold"
                              onClick={handleOpenEwbModal}
                            >
                              <span>🚚</span> Generate E-Way Bill
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm d-flex align-items-center justify-content-center gap-1"
                            onClick={() => {
                              setShowCancelModal(true);
                              setEInvError(null);
                            }}
                          >
                            <span>✕</span> Cancel IRN
                          </button>
                        </div>
                      </div>
                    ) : viewingInvoice.einvoiceStatus === 'Cancelled' ? (
                      <div className="d-flex align-items-center justify-content-between">
                        <div className="d-flex align-items-center gap-2">
                          <span className="fs-4 text-danger">🚫</span>
                          <div>
                            <strong className="text-danger small">E-Invoice (IRN) Cancelled</strong>
                            <div className="text-muted small">
                              Reason: {viewingInvoice.cancelRemarks || 'Order cancelled'} • Cancelled on:{' '}
                              {formatDate(viewingInvoice.cancelledAt || viewingInvoice.updatedAt)}
                            </div>
                          </div>
                        </div>
                        <span className="badge bg-danger-subtle text-danger border border-danger-subtle">Cancelled</span>
                      </div>
                    ) : viewingInvoice.einvoiceStatus === 'Failed' ? (
                      <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3">
                        <div className="d-flex align-items-center gap-2.5">
                          <span className="fs-3">⚠️</span>
                          <div>
                            <div className="fw-bold text-danger small mb-0.5">E-Invoice Generation Failed</div>
                            <div className="text-secondary small">
                              {viewingInvoice.einvoiceError || 'NIC returned validation errors. Please edit invoice details (GSTIN / HSN) and retry.'}
                            </div>
                          </div>
                        </div>
                        <div className="d-flex align-items-center gap-2 flex-shrink-0">
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm px-3 fw-semibold"
                            onClick={() => handleOpenEdit(viewingInvoice)}
                          >
                            ✏️ Edit to Fix
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm px-3.5 py-1.5 fw-semibold shadow-sm d-flex align-items-center gap-1.5"
                            onClick={() => handleGenerateEInvoice(viewingInvoice._id)}
                            disabled={eInvLoading}
                          >
                            {eInvLoading ? (
                              <>
                                <span className="spinner-border spinner-border-sm" role="status" />
                                <span>Retrying...</span>
                              </>
                            ) : (
                              <>
                                <span>⚡</span>
                                <span>Retry IRN</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3">
                        <div className="d-flex align-items-center gap-2.5">
                          <span className="fs-3">⚡</span>
                          <div>
                            <div className="fw-bold text-dark small mb-0.5">Government E-Invoice (IRN) & QR Code</div>
                            <div className="text-secondary small">
                              Register with NIC E-Invoice portal via TaxPro Decrypted Gateway to get an authentic IRN and signed QR Code.
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm px-3.5 py-1.5 fw-semibold shadow-sm d-flex align-items-center gap-1.5 flex-shrink-0"
                          onClick={() => handleGenerateEInvoice(viewingInvoice._id)}
                          disabled={eInvLoading}
                        >
                          {eInvLoading ? (
                            <>
                              <span className="spinner-border spinner-border-sm" role="status" />
                              <span>Generating IRN...</span>
                            </>
                          ) : (
                            <>
                              <span>⚡</span>
                              <span>Generate E-Invoice (IRN)</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Printable Tally Prime GST Tax Invoice Container */}
                <div
                  id="printableInvoice"
                  style={{
                    backgroundColor: '#ffffff',
                    color: '#000000',
                    fontFamily: 'Arial, Helvetica, sans-serif',
                    fontSize: '11.5px',
                    lineHeight: '1.25',
                    padding: '8px',
                    margin: '0 auto',
                    maxWidth: '820px',
                    boxSizing: 'border-box'
                  }}
                >
                  {/* Outer Border */}
                  <div style={{ border: '1.5px solid #000' }}>
                    {/* Header: Centered "Tax Invoice" & Right-aligned "(ORIGINAL FOR RECIPIENT)" */}
                    <div
                      style={{
                        position: 'relative',
                        textAlign: 'center',
                        padding: '4px 8px',
                        borderBottom: '1px solid #000',
                        fontWeight: 'bold',
                        fontSize: '15px',
                        letterSpacing: '0.4px'
                      }}
                    >
                      Tax Invoice
                      <span
                        style={{
                          position: 'absolute',
                          right: '8px',
                          top: '5px',
                          fontStyle: 'italic',
                          fontWeight: 'normal',
                          fontSize: '11px'
                        }}
                      >
                        (ORIGINAL FOR RECIPIENT)
                      </span>
                    </div>

                    {/* Optional E-Invoice IRN Banner when generated */}
                    {viewingInvoice.einvoiceStatus === 'Generated' && (
                      <div
                        style={{
                          borderBottom: '1px solid #000',
                          padding: '6px 8px',
                          backgroundColor: '#fafafa',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {viewingInvoice.qrCodeImage && (
                            <img
                              src={`data:image/png;base64,${viewingInvoice.qrCodeImage}`}
                              alt="NIC Signed QR"
                              style={{ width: '70px', height: '70px', objectFit: 'contain' }}
                            />
                          )}
                          <div style={{ fontSize: '10.5px', fontFamily: 'monospace' }}>
                            <div style={{ fontWeight: 'bold', color: '#0d6efd', fontSize: '11px', marginBottom: '2px' }}>
                              GOVERNMENT OF INDIA • GST E-INVOICE
                            </div>
                            <div>
                              <strong>IRN:</strong> {viewingInvoice.irn}
                            </div>
                            <div>
                              <strong>Ack No:</strong> {viewingInvoice.ackNo} &nbsp;|&nbsp;{' '}
                              <strong>Ack Date:</strong> {formatDate(viewingInvoice.ackDate)}
                            </div>
                            {viewingInvoice.ewayBillNo && (
                              <div style={{ color: '#198754', fontWeight: 'bold' }}>
                                E-Way Bill: #{viewingInvoice.ewayBillNo}{' '}
                                {viewingInvoice.vehicleNo && `(Vehicle: ${viewingInvoice.vehicleNo})`}
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '10px', textTransform: 'uppercase', color: '#555' }}>
                          NIC IRN ACTIVE<br />
                          <span style={{ color: '#198754', fontWeight: 'bold' }}>VERIFIED</span>
                        </div>
                      </div>
                    )}

                    {/* Section 1: Top 2-Column Split (Seller & Buyer 55% | 5-Row Dispatch Grid 45%) */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #000' }}>
                      {/* Left: Seller & Buyer Details */}
                      <div style={{ width: '55%', borderRight: '1px solid #000', display: 'flex', flexDirection: 'column' }}>
                        {/* Seller */}
                        <div style={{ padding: '6px 8px', borderBottom: '1px solid #000' }}>
                          <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{sellerDisplayName}</div>
                          <div>{sellerDisplayAddress}</div>
                          <div>
                            GSTIN/UIN: <span style={{ fontWeight: 'bold' }}>{sellerDisplayGstin}</span>
                          </div>
                          <div>
                            State Name : {sellerDisplayStateName}, Code : {sellerDisplayStateCode}
                          </div>
                        </div>

                        {/* Buyer */}
                        <div style={{ padding: '6px 8px', flexGrow: 1 }}>
                          <div style={{ fontSize: '10.5px' }}>Buyer (Bill to)</div>
                          <div style={{ fontWeight: 'bold', fontSize: '12.5px' }}>{buyerDisplayName}</div>
                          <div>{buyerAddressDisplay}</div>
                          <table style={{ borderCollapse: 'collapse', marginTop: '2px', width: '100%', fontSize: '11.5px' }}>
                            <tbody>
                              <tr>
                                <td style={{ width: '95px', padding: '1px 0' }}>GSTIN/UIN</td>
                                <td style={{ padding: '1px 0' }}>: <span style={{ fontWeight: 'bold' }}>{buyerDisplayGstin || '—'}</span></td>
                              </tr>
                              <tr>
                                <td style={{ padding: '1px 0' }}>State Name</td>
                                <td style={{ padding: '1px 0' }}>: {buyerDisplayStateName}, Code : {buyerDisplayStateCode}</td>
                              </tr>
                              <tr>
                                <td style={{ padding: '1px 0' }}>Place of Supply</td>
                                <td style={{ padding: '1px 0' }}>: {posDisplayName}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Right: 5-Row Dispatch / Reference Table */}
                      <div style={{ width: '45%', display: 'flex', flexDirection: 'column' }}>
                        {/* Row 1: Invoice No & Dated */}
                        <div style={{ display: 'flex', borderBottom: '1px solid #000', minHeight: '34px' }}>
                          <div style={{ width: '50%', padding: '3px 6px', borderRight: '1px solid #000' }}>
                            <div style={{ fontSize: '10px' }}>Invoice No.</div>
                            <div style={{ fontWeight: 'bold', fontSize: '12px' }}>{viewingInvoice.invoiceNumber}</div>
                          </div>
                          <div style={{ width: '50%', padding: '3px 6px' }}>
                            <div style={{ fontSize: '10px' }}>Dated</div>
                            <div style={{ fontWeight: 'bold', fontSize: '12px' }}>{formatTallyDate(viewingInvoice.invoiceDate)}</div>
                          </div>
                        </div>

                        {/* Row 2: Delivery Note & Mode/Terms of Payment */}
                        <div style={{ display: 'flex', borderBottom: '1px solid #000', minHeight: '32px' }}>
                          <div style={{ width: '50%', padding: '3px 6px', borderRight: '1px solid #000' }}>
                            <div style={{ fontSize: '10px' }}>Delivery Note</div>
                            <div>{viewingInvoice.deliveryNote || ''}</div>
                          </div>
                          <div style={{ width: '50%', padding: '3px 6px' }}>
                            <div style={{ fontSize: '10px' }}>Mode/Terms of Payment</div>
                            <div>{viewingInvoice.terms || viewingInvoice.paymentTerms || ''}</div>
                          </div>
                        </div>

                        {/* Row 3: Buyer's Order No. & Dated */}
                        <div style={{ display: 'flex', borderBottom: '1px solid #000', minHeight: '32px' }}>
                          <div style={{ width: '50%', padding: '3px 6px', borderRight: '1px solid #000' }}>
                            <div style={{ fontSize: '10px' }}>Buyer's Order No.</div>
                            <div>{viewingInvoice.buyerOrderNo || ''}</div>
                          </div>
                          <div style={{ width: '50%', padding: '3px 6px' }}>
                            <div style={{ fontSize: '10px' }}>Dated</div>
                            <div>{viewingInvoice.buyerOrderDate ? formatTallyDate(viewingInvoice.buyerOrderDate) : ''}</div>
                          </div>
                        </div>

                        {/* Row 4: Dispatch Doc No. & Delivery Note Date */}
                        <div style={{ display: 'flex', borderBottom: '1px solid #000', minHeight: '32px' }}>
                          <div style={{ width: '50%', padding: '3px 6px', borderRight: '1px solid #000' }}>
                            <div style={{ fontSize: '10px' }}>Dispatch Doc No.</div>
                            <div>{viewingInvoice.dispatchDocNo || ''}</div>
                          </div>
                          <div style={{ width: '50%', padding: '3px 6px' }}>
                            <div style={{ fontSize: '10px' }}>Delivery Note Date</div>
                            <div>{viewingInvoice.deliveryNoteDate ? formatTallyDate(viewingInvoice.deliveryNoteDate) : ''}</div>
                          </div>
                        </div>

                        {/* Row 5: Dispatched through & Destination */}
                        <div style={{ display: 'flex', minHeight: '32px', flexGrow: 1 }}>
                          <div style={{ width: '50%', padding: '3px 6px', borderRight: '1px solid #000' }}>
                            <div style={{ fontSize: '10px' }}>Dispatched through</div>
                            <div>{viewingInvoice.dispatchedThrough || viewingInvoice.transporterName || viewingInvoice.vehicleNo || ''}</div>
                          </div>
                          <div style={{ width: '50%', padding: '3px 6px' }}>
                            <div style={{ fontSize: '10px' }}>Destination</div>
                            <div>{viewingInvoice.destination || posDisplayName || ''}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Section 2: Line Items / Goods Table */}
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        borderBottom: '1px solid #000',
                        tableLayout: 'fixed',
                        fontSize: '11.5px'
                      }}
                    >
                      <thead>
                        <tr style={{ borderBottom: '1px solid #000', fontSize: '10.5px' }}>
                          <th style={{ width: '4%', borderRight: '1px solid #000', padding: '3px 2px', fontWeight: 'bold', textAlign: 'center' }}>
                            Sl<br />No.
                          </th>
                          <th style={{ width: '48%', borderRight: '1px solid #000', padding: '3px 6px', fontWeight: 'bold', textAlign: 'center' }}>
                            Description of Goods
                          </th>
                          <th style={{ width: '13%', borderRight: '1px solid #000', padding: '3px 4px', fontWeight: 'bold', textAlign: 'center' }}>
                            Quantity
                          </th>
                          <th style={{ width: '11%', borderRight: '1px solid #000', padding: '3px 4px', fontWeight: 'bold', textAlign: 'center' }}>
                            Rate
                          </th>
                          <th style={{ width: '6%', borderRight: '1px solid #000', padding: '3px 2px', fontWeight: 'bold', textAlign: 'center' }}>
                            per
                          </th>
                          <th style={{ width: '18%', padding: '3px 6px', fontWeight: 'bold', textAlign: 'center' }}>
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Goods Rows */}
                        {viewingInvoice.lineItems && viewingInvoice.lineItems.length > 0 ? (
                          viewingInvoice.lineItems.map((it, idx) => (
                            <tr key={idx} style={{ verticalAlign: 'top' }}>
                              <td style={{ borderRight: '1px solid #000', padding: '5px 3px', textAlign: 'center', fontWeight: 'bold' }}>
                                {idx + 1}
                              </td>
                              <td style={{ borderRight: '1px solid #000', padding: '5px 8px' }}>
                                <div style={{ fontWeight: 'bold', textTransform: 'uppercase' }}>{it.name}</div>
                                {it.description && <div style={{ fontSize: '10.5px', color: '#444' }}>{it.description}</div>}
                              </td>
                              <td style={{ borderRight: '1px solid #000', padding: '5px 6px', textAlign: 'right', fontWeight: 'bold' }}>
                                {formatTallyNum(it.quantity, 3)} {it.unit || 'kg'}
                              </td>
                              <td style={{ borderRight: '1px solid #000', padding: '5px 6px', textAlign: 'right' }}>
                                {formatTallyNum(it.rate, 2)}
                              </td>
                              <td style={{ borderRight: '1px solid #000', padding: '5px 2px', textAlign: 'center' }}>
                                {it.unit || 'kg'}
                              </td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 'bold' }}>
                                {formatTallyNum(it.taxableAmount || ((Number(it.quantity) || 1) * (Number(it.rate) || 0)), 2)}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr style={{ verticalAlign: 'top' }}>
                            <td style={{ borderRight: '1px solid #000', padding: '5px 3px', textAlign: 'center', fontWeight: 'bold' }}>1</td>
                            <td style={{ borderRight: '1px solid #000', padding: '5px 8px' }}>
                              <div style={{ fontWeight: 'bold', textTransform: 'uppercase' }}>PLASTIC PACKAGING MATERIAL</div>
                            </td>
                            <td style={{ borderRight: '1px solid #000', padding: '5px 6px', textAlign: 'right', fontWeight: 'bold' }}>200.000 kg</td>
                            <td style={{ borderRight: '1px solid #000', padding: '5px 6px', textAlign: 'right' }}>210.00</td>
                            <td style={{ borderRight: '1px solid #000', padding: '5px 2px', textAlign: 'center' }}>kg</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 'bold' }}>42,000.00</td>
                          </tr>
                        )}

                        {/* Tax Lines & Journal Allocation embedded in table */}
                        <tr style={{ verticalAlign: 'top' }}>
                          <td style={{ borderRight: '1px solid #000', padding: '4px' }}></td>
                          <td style={{ borderRight: '1px solid #000', padding: '6px 8px 4px 8px' }}>
                            {viewingInvoice.totalCgst > 0 && (
                              <div style={{ textAlign: 'right', fontStyle: 'italic', fontWeight: 'bold', paddingRight: '18px' }}>
                                Cgst
                              </div>
                            )}
                            {viewingInvoice.totalSgst > 0 && (
                              <div style={{ textAlign: 'right', fontStyle: 'italic', fontWeight: 'bold', paddingRight: '18px' }}>
                                Sgst
                              </div>
                            )}
                            {viewingInvoice.totalIgst > 0 && (
                              <div style={{ textAlign: 'right', fontStyle: 'italic', fontWeight: 'bold', paddingRight: '18px' }}>
                                Igst
                              </div>
                            )}
                            <div style={{ marginTop: '10px' }}>
                              <span style={{ textDecoration: 'underline', fontWeight: 'bold', fontSize: '11px' }}>
                                Bill Details:
                              </span>
                              <div style={{ display: 'flex', justifyContent: 'space-between', width: '250px', marginTop: '3px', fontSize: '11px' }}>
                                <span>On Account</span>
                                <span style={{ fontWeight: 'bold' }}>{formatTallyNum(viewingInvoice.grandTotal, 2)} &nbsp; Dr</span>
                              </div>
                            </div>
                          </td>
                          <td style={{ borderRight: '1px solid #000', padding: '4px' }}></td>
                          <td style={{ borderRight: '1px solid #000', padding: '4px' }}></td>
                          <td style={{ borderRight: '1px solid #000', padding: '4px' }}></td>
                          <td style={{ padding: '6px 8px 4px 8px', textAlign: 'right' }}>
                            {viewingInvoice.totalCgst > 0 && (
                              <div style={{ fontWeight: 'bold' }}>{formatTallyNum(viewingInvoice.totalCgst, 2)}</div>
                            )}
                            {viewingInvoice.totalSgst > 0 && (
                              <div style={{ fontWeight: 'bold' }}>{formatTallyNum(viewingInvoice.totalSgst, 2)}</div>
                            )}
                            {viewingInvoice.totalIgst > 0 && (
                              <div style={{ fontWeight: 'bold' }}>{formatTallyNum(viewingInvoice.totalIgst, 2)}</div>
                            )}
                          </td>
                        </tr>

                        {/* Spacer Row for authentic Tally ledger look */}
                        <tr style={{ height: '35px' }}>
                          <td style={{ borderRight: '1px solid #000' }}></td>
                          <td style={{ borderRight: '1px solid #000' }}></td>
                          <td style={{ borderRight: '1px solid #000' }}></td>
                          <td style={{ borderRight: '1px solid #000' }}></td>
                          <td style={{ borderRight: '1px solid #000' }}></td>
                          <td></td>
                        </tr>

                        {/* Total Row */}
                        <tr style={{ borderTop: '1px solid #000', fontWeight: 'bold' }}>
                          <td style={{ borderRight: '1px solid #000', padding: '4px' }}></td>
                          <td style={{ borderRight: '1px solid #000', padding: '4px 8px', textAlign: 'right' }}>
                            Total
                          </td>
                          <td style={{ borderRight: '1px solid #000', padding: '4px 6px', textAlign: 'right' }}>
                            {formatTallyNum(totalInvoiceQty || 200, 3)} {defaultUnit}
                          </td>
                          <td style={{ borderRight: '1px solid #000', padding: '4px' }}></td>
                          <td style={{ borderRight: '1px solid #000', padding: '4px' }}></td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: '12.5px' }}>
                            ₹ {formatTallyNum(viewingInvoice.grandTotal, 2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Section 3: Amount Chargeable in words */}
                    <div style={{ padding: '4px 8px', borderBottom: '1px solid #000' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: '#333' }}>
                        <span>Amount Chargeable (in words)</span>
                        <span style={{ fontStyle: 'italic', fontWeight: 'bold' }}>E. & O.E</span>
                      </div>
                      <div style={{ fontWeight: 'bold', fontSize: '12px', marginTop: '2px' }}>
                        {numberToWords(viewingInvoice.grandTotal)}
                      </div>
                    </div>

                    {/* Section 4: HSN/SAC Tax Summary Table */}
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        borderBottom: '1px solid #000',
                        tableLayout: 'fixed',
                        fontSize: '11px'
                      }}
                    >
                      <thead>
                        <tr style={{ borderBottom: '1px solid #000', textAlign: 'center' }}>
                          <th rowSpan={2} style={{ width: '22%', borderRight: '1px solid #000', padding: '3px 4px', fontWeight: 'bold' }}>
                            HSN/SAC
                          </th>
                          <th rowSpan={2} style={{ width: '18%', borderRight: '1px solid #000', padding: '3px 4px', fontWeight: 'bold' }}>
                            Taxable<br />Value
                          </th>
                          {viewingInvoice.totalIgst > 0 ? (
                            <th colSpan={2} style={{ width: '42%', borderRight: '1px solid #000', padding: '3px 4px', fontWeight: 'bold' }}>
                              Integrated Tax
                            </th>
                          ) : (
                            <>
                              <th colSpan={2} style={{ width: '23%', borderRight: '1px solid #000', padding: '3px 4px', fontWeight: 'bold' }}>
                                CGST
                              </th>
                              <th colSpan={2} style={{ width: '23%', borderRight: '1px solid #000', padding: '3px 4px', fontWeight: 'bold' }}>
                                SGST/UTGST
                              </th>
                            </>
                          )}
                          <th rowSpan={2} style={{ width: '16%', padding: '3px 4px', fontWeight: 'bold' }}>
                            Total<br />Tax Amount
                          </th>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #000', textAlign: 'center' }}>
                          {viewingInvoice.totalIgst > 0 ? (
                            <>
                              <th style={{ borderRight: '1px solid #000', padding: '2px 4px', fontWeight: 'bold', width: '14%' }}>Rate</th>
                              <th style={{ borderRight: '1px solid #000', padding: '2px 4px', fontWeight: 'bold', width: '28%' }}>Amount</th>
                            </>
                          ) : (
                            <>
                              <th style={{ borderRight: '1px solid #000', padding: '2px 4px', fontWeight: 'bold', width: '8%' }}>Rate</th>
                              <th style={{ borderRight: '1px solid #000', padding: '2px 4px', fontWeight: 'bold', width: '15%' }}>Amount</th>
                              <th style={{ borderRight: '1px solid #000', padding: '2px 4px', fontWeight: 'bold', width: '8%' }}>Rate</th>
                              <th style={{ borderRight: '1px solid #000', padding: '2px 4px', fontWeight: 'bold', width: '15%' }}>Amount</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {hsnBreakdown.map((row, idx) => (
                          <tr key={idx} style={{ textAlign: 'right' }}>
                            <td style={{ borderRight: '1px solid #000', padding: '3px 6px', textAlign: 'left' }}>{row.hsn}</td>
                            <td style={{ borderRight: '1px solid #000', padding: '3px 6px' }}>{formatTallyNum(row.taxable, 2)}</td>
                            {viewingInvoice.totalIgst > 0 ? (
                              <>
                                <td style={{ borderRight: '1px solid #000', padding: '3px 4px', textAlign: 'center' }}>{row.igstRate}%</td>
                                <td style={{ borderRight: '1px solid #000', padding: '3px 6px' }}>{formatTallyNum(row.igstAmount, 2)}</td>
                              </>
                            ) : (
                              <>
                                <td style={{ borderRight: '1px solid #000', padding: '3px 4px', textAlign: 'center' }}>{row.cgstRate}%</td>
                                <td style={{ borderRight: '1px solid #000', padding: '3px 6px' }}>{formatTallyNum(row.cgstAmount, 2)}</td>
                                <td style={{ borderRight: '1px solid #000', padding: '3px 4px', textAlign: 'center' }}>{row.sgstRate}%</td>
                                <td style={{ borderRight: '1px solid #000', padding: '3px 6px' }}>{formatTallyNum(row.sgstAmount, 2)}</td>
                              </>
                            )}
                            <td style={{ padding: '3px 6px' }}>{formatTallyNum(row.totalTax, 2)}</td>
                          </tr>
                        ))}
                        {/* HSN Total Row */}
                        <tr style={{ borderTop: '1px solid #000', fontWeight: 'bold', textAlign: 'right' }}>
                          <td style={{ borderRight: '1px solid #000', padding: '3px 6px', textAlign: 'right' }}>Total</td>
                          <td style={{ borderRight: '1px solid #000', padding: '3px 6px' }}>{formatTallyNum(viewingInvoice.subTotal, 2)}</td>
                          {viewingInvoice.totalIgst > 0 ? (
                            <>
                              <td style={{ borderRight: '1px solid #000', padding: '3px 4px' }}></td>
                              <td style={{ borderRight: '1px solid #000', padding: '3px 6px' }}>{formatTallyNum(viewingInvoice.totalIgst, 2)}</td>
                            </>
                          ) : (
                            <>
                              <td style={{ borderRight: '1px solid #000', padding: '3px 4px' }}></td>
                              <td style={{ borderRight: '1px solid #000', padding: '3px 6px' }}>{formatTallyNum(viewingInvoice.totalCgst, 2)}</td>
                              <td style={{ borderRight: '1px solid #000', padding: '3px 4px' }}></td>
                              <td style={{ borderRight: '1px solid #000', padding: '3px 6px' }}>{formatTallyNum(viewingInvoice.totalSgst, 2)}</td>
                            </>
                          )}
                          <td style={{ padding: '3px 6px' }}>{formatTallyNum(viewingTotalTax, 2)}</td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Section 5: Tax Amount in Words */}
                    <div style={{ padding: '4px 8px', borderBottom: '1px solid #000', fontSize: '11px' }}>
                      <span>Tax Amount (in words) : &nbsp;</span>
                      <strong style={{ fontSize: '12px' }}>{numberToWords(viewingTotalTax)}</strong>
                    </div>

                    {/* Section 6: Declaration & Bank Details / Signatures */}
                    <div style={{ display: 'flex' }}>
                      {/* Left: Declaration */}
                      <div
                        style={{
                          width: '50%',
                          borderRight: '1px solid #000',
                          padding: '6px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          minHeight: '130px'
                        }}
                      >
                        <div>
                          <div style={{ textDecoration: 'underline', fontSize: '10.5px', marginBottom: '2px' }}>
                            Declaration
                          </div>
                          <div style={{ fontSize: '10.5px', color: '#111', lineHeight: '1.3' }}>
                            We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
                          </div>
                        </div>
                        <div style={{ fontSize: '11px', fontWeight: '500', paddingTop: '24px' }}>
                          Customer's Seal and Signature
                        </div>
                      </div>

                      {/* Right: Bank Details & Authorised Signatory */}
                      <div
                        style={{
                          width: '50%',
                          padding: '6px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          minHeight: '130px'
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '11px', marginBottom: '2px' }}>
                            Company's Bank Details
                          </div>
                          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '10.5px' }}>
                            <tbody>
                              <tr>
                                <td style={{ width: '115px', padding: '1px 0' }}>A/c Holder's Name</td>
                                <td style={{ padding: '1px 0' }}>: <span style={{ fontWeight: 'bold' }}>{sellerDisplayName}</span></td>
                              </tr>
                              <tr>
                                <td style={{ padding: '1px 0' }}>Bank Name</td>
                                <td style={{ padding: '1px 0' }}>: <span style={{ fontWeight: 'bold' }}>ICICI Bank</span></td>
                              </tr>
                              <tr>
                                <td style={{ padding: '1px 0' }}>A/c No.</td>
                                <td style={{ padding: '1px 0' }}>: <span style={{ fontWeight: 'bold' }}>107905001106</span></td>
                              </tr>
                              <tr>
                                <td style={{ padding: '1px 0' }}>Branch & IFS Code</td>
                                <td style={{ padding: '1px 0' }}>: <span style={{ fontWeight: 'bold' }}>Faridabad Sec7 & ICIC0001079</span></td>
                              </tr>
                              <tr>
                                <td style={{ padding: '1px 0' }}>SWIFT Code</td>
                                <td style={{ padding: '1px 0' }}>: </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        <div style={{ textAlign: 'right', paddingTop: '10px' }}>
                          <div style={{ fontWeight: 'bold', fontSize: '11px' }}>
                            for {sellerDisplayName}
                          </div>
                          <div style={{ height: '35px' }}></div>
                          <div style={{ fontSize: '11px' }}>Authorised Signatory</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Computer Generated Disclaimer */}
                  <div style={{ textAlign: 'center', fontSize: '10px', marginTop: '6px', color: '#444' }}>
                    This is a Computer Generated Invoice
                  </div>
                </div>
              </div>

              <div className="modal-footer border-top py-2.5 px-4 bg-light d-print-none">
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

      {/* Submodal: Generate E-Way Bill */}
      {showEwbModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header py-2.5 px-3 bg-light border-bottom">
                <h5 className="modal-title fs-6 fw-bold text-dark d-flex align-items-center gap-1.5 mb-0">
                  <span>🚚</span> Generate E-Way Bill (NIC)
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowEwbModal(false)} />
              </div>
              <form onSubmit={handleGenerateEwbSubmit}>
                <div className="modal-body p-3">
                  <p className="small text-muted mb-3">
                    Generate Part-A and Part-B E-Way Bill for IRN:{' '}
                    <code className="text-dark font-monospace text-break">{viewingInvoice?.irn?.slice(0, 24)}...</code>
                  </p>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-secondary">Vehicle Number *</label>
                    <input
                      type="text"
                      className="form-control form-control-sm font-monospace text-uppercase"
                      placeholder="e.g. KA12ER1234"
                      value={ewbForm.vehicleNo}
                      onChange={(e) => setEwbForm({ ...ewbForm, vehicleNo: e.target.value.toUpperCase() })}
                      required
                    />
                    <div className="form-text small text-muted">Format: 2-letter state code + RTO + alphanumeric</div>
                  </div>

                  <div className="row g-2 mb-3">
                    <div className="col-12 col-sm-6">
                      <label className="form-label small fw-semibold text-secondary">Transporter GSTIN / ID</label>
                      <input
                        type="text"
                        className="form-control form-control-sm font-monospace text-uppercase"
                        placeholder="e.g. 29AWGPV7107B1Z1"
                        value={ewbForm.transporterId}
                        onChange={(e) => setEwbForm({ ...ewbForm, transporterId: e.target.value.toUpperCase() })}
                      />
                    </div>
                    <div className="col-12 col-sm-6">
                      <label className="form-label small fw-semibold text-secondary">Transporter Name</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="e.g. Rapid Transport"
                        value={ewbForm.transporterName}
                        onChange={(e) => setEwbForm({ ...ewbForm, transporterName: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="form-label small fw-semibold text-secondary">Approx Distance (KM)</label>
                    <input
                      type="number"
                      className="form-control form-control-sm font-monospace"
                      placeholder="Leave 0 for automatic Pin-Pin distance"
                      value={ewbForm.distance}
                      onChange={(e) => setEwbForm({ ...ewbForm, distance: Number(e.target.value) })}
                    />
                    <div className="form-text small text-muted">
                      Enter <code>0</code> to let NIC automatically calculate exact pin-to-pin distance.
                    </div>
                  </div>
                </div>
                <div className="modal-footer py-2 px-3 bg-light border-top">
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowEwbModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm fw-semibold" disabled={ewbLoading}>
                    {ewbLoading ? 'Generating EWB...' : 'Issue E-Way Bill'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Submodal: Cancel IRN */}
      {showCancelModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header py-2.5 px-3 bg-light border-bottom">
                <h5 className="modal-title fs-6 fw-bold text-danger d-flex align-items-center gap-1.5 mb-0">
                  <span>⚠️</span> Cancel E-Invoice (IRN)
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowCancelModal(false)} />
              </div>
              <form onSubmit={handleCancelEInvoiceSubmit}>
                <div className="modal-body p-3">
                  <div className="alert alert-warning py-2 px-3 small mb-3">
                    <strong>Note:</strong> IRN cancellation must be reported to the IRP portal within 24 hours of generation.
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-secondary">Cancellation Reason *</label>
                    <select
                      className="form-select form-select-sm"
                      value={cancelForm.reasonCode}
                      onChange={(e) => setCancelForm({ ...cancelForm, reasonCode: e.target.value })}
                      required
                    >
                      <option value="1">1 - Duplicate Invoice</option>
                      <option value="2">2 - Data Entry Mistake</option>
                      <option value="3">3 - Order Cancelled</option>
                      <option value="4">4 - Others</option>
                    </select>
                  </div>

                  <div className="mb-2">
                    <label className="form-label small fw-semibold text-secondary">Cancellation Remarks *</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="e.g. Incorrect quantity entered"
                      value={cancelForm.remarks}
                      onChange={(e) => setCancelForm({ ...cancelForm, remarks: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer py-2 px-3 bg-light border-top">
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowCancelModal(false)}>
                    Keep Active
                  </button>
                  <button type="submit" className="btn btn-danger btn-sm fw-semibold" disabled={cancelLoading}>
                    {cancelLoading ? 'Cancelling IRN...' : 'Confirm Cancellation'}
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
