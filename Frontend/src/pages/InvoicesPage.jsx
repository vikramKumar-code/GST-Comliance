import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  FileText,
  Plus,
  Search,
  Printer,
  Truck,
  Copy,
  Check,
  Zap,
  RotateCcw,
  Trash2,
  Edit2,
  Eye,
  AlertTriangle,
  CheckCircle2,
  X,
  XCircle,
  Building2,
  Calendar,
  Layers,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import { searchGstin } from '../api/auth.api';
import {
  listInvoices,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  generateEInvoice,
  cancelEInvoice,
  generateEwayBill,
} from '../api/invoices.api';
import { listCustomers } from '../api/customers.api';
import { listItems } from '../api/items.api';
import { useAuth } from '../context/AuthContext';
import Loader from '../components/common/Loader';
import ErrorMessage from '../components/ErrorMessage';
import ConfirmDialog from '../components/common/ConfirmDialog';
import StatusBadge from '../components/common/StatusBadge';
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  MetricCard,
  Button,
  Input,
  Select,
  Modal,
  Tabs,
  Badge,
} from '../components/ui';
import {
  formatCurrency,
  formatDate,
  formatTallyDate,
  getStateName,
  numberToWords,
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
  gstRate: 18,
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
    transportMode: '1',
  });
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelForm, setCancelForm] = useState({
    reasonCode: '1',
    remarks: 'Data entry mistake',
  });
  const [copiedIrn, setCopiedIrn] = useState(false);

  // Confirm delete dialog
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
  const [verifyingCustomerGstin, setVerifyingCustomerGstin] = useState(false);

  const handleVerifyInvoiceCustomerGstin = async () => {
    if (!customerGstin || customerGstin.trim().length < 15) {
      setToast({ type: 'error', message: 'Enter a valid 15-character GSTIN to verify.' });
      return;
    }
    setVerifyingCustomerGstin(true);
    try {
      const clean = customerGstin.trim().toUpperCase();
      const res = await searchGstin(clean);
      const tp = res?.taxpayer || res;
      const legal = tp?.legalName || tp?.tradeName;
      if (legal) {
        setCustomerName(legal);
        if (clean.length >= 2) {
          setPlaceOfSupply(clean.slice(0, 2));
        }
        setToast({ type: 'success', message: `Verified: ${legal} (${tp?.status || 'Active'})` });
      } else {
        setToast({ type: 'warning', message: 'GSTIN verified, but legal name could not be resolved.' });
      }
    } catch (err) {
      setToast({ type: 'error', message: err?.message || 'Taxpayer lookup failed.' });
    } finally {
      setVerifyingCustomerGstin(false);
    }
  };

  const sellerState = user?.gstin && user.gstin.length >= 2 ? user.gstin.slice(0, 2) : '29';

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
        listItems(),
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [sellerState]);

  const handleOpenEdit = useCallback((inv) => {
    if (!inv) return;
    setEditingInvoiceId(inv._id);
    setCustomerId(inv.customerId || '');
    setCustomerName(inv.customerName || '');
    setCustomerGstin(inv.customerGstin || '');
    const pos =
      inv.placeOfSupply ||
      (inv.customerGstin && inv.customerGstin.length >= 2
        ? inv.customerGstin.slice(0, 2)
        : sellerState);
    setPlaceOfSupply(pos);
    setInvoiceNumber(inv.invoiceNumber || '');
    setInvoiceDate(
      inv.invoiceDate
        ? new Date(inv.invoiceDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10)
    );
    setDueDate(inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '');
    if (inv.lineItems && inv.lineItems.length > 0) {
      setLineItems(
        inv.lineItems.map((it) => ({
          itemId: it.itemId || '',
          name: it.name || '',
          description: it.description || '',
          hsnSac: it.hsnSac || '',
          unit: it.unit || 'PCS',
          quantity: it.quantity != null ? it.quantity : 1,
          rate: it.rate != null ? it.rate : 0,
          discount: it.discount != null ? it.discount : 0,
          gstRate: it.gstRate != null ? it.gstRate : 18,
        }))
      );
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
        unit: selected.unit || 'PCS',
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
      const taxable = Math.max(0, qty * rate - discount);
      const gstRate = Math.max(0, Number(item.gstRate) || 0);

      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (isIntraState) {
        cgst = Math.round(taxable * (gstRate / 2 / 100) * 100) / 100;
        sgst = Math.round(taxable * (gstRate / 2 / 100) * 100) / 100;
      } else {
        igst = Math.round(taxable * (gstRate / 100) * 100) / 100;
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
        totalAmount,
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
      isIntraState,
    };
  }, [lineItems, placeOfSupply, sellerState]);

  // Derived financial summary for list view
  const summaryStats = useMemo(() => {
    let totalRev = 0;
    let paidAmt = 0;
    let pendingAmt = 0;
    let eInvCount = 0;
    for (const inv of invoices) {
      const amt = Number(inv.grandTotal || 0);
      totalRev += amt;
      if (inv.status?.toLowerCase() === 'paid') {
        paidAmt += amt;
      } else {
        pendingAmt += amt;
      }
      if (inv.einvoiceStatus === 'Generated') {
        eInvCount++;
      }
    }
    return { totalRev, paidAmt, pendingAmt, eInvCount };
  }, [invoices]);

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
      notes,
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

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      await deleteInvoice(deleteTargetId);
      setDeleteTargetId(null);
      fetchInvoices(searchQuery, statusFilter);
      if (viewingInvoice && viewingInvoice._id === deleteTargetId) {
        setViewingInvoice(null);
      }
    } catch (err) {
      setError(err);
    } finally {
      setIsDeleting(false);
    }
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
      transportMode: viewingInvoice?.transportMode || '1',
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
      const taxable = Number(it.taxableAmount) || (Number(it.quantity) || 1) * (Number(it.rate) || 0);
      const cgstRate = it.cgstRate || (viewingInvoice.totalCgst > 0 ? (it.gstRate || 18) / 2 : 0);
      const sgstRate = it.sgstRate || (viewingInvoice.totalSgst > 0 ? (it.gstRate || 18) / 2 : 0);
      const igstRate = it.igstRate || (viewingInvoice.totalIgst > 0 ? it.gstRate || 18 : 0);

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
      const totalTax = Number(it.totalTax) || cgstAmt + sgstAmt + igstAmt;

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
          totalTax: 0,
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
      maximumFractionDigits: decimals,
    });
  };

  const sellerDisplayName = user?.companyName || user?.name || user?.tradeName || 'OM Enterprises';
  const sellerDisplayGstin = user?.gstin || '06AAHPB8621K1ZR';
  const sellerDisplayStateCode = sellerDisplayGstin.slice(0, 2) || '06';
  const sellerDisplayStateName = getStateName(sellerDisplayStateCode);
  const sellerDisplayAddress = user?.address || '548 Sector-7 Faridabad';

  const buyerDisplayName = viewingInvoice?.customerName || 'Bhayana Computer Stationery Forms Private Limited';
  const buyerDisplayGstin = viewingInvoice?.customerGstin || '';
  const buyerDisplayStateCode =
    viewingInvoice?.placeOfSupply && viewingInvoice.placeOfSupply.length === 2
      ? viewingInvoice.placeOfSupply
      : buyerDisplayGstin.length >= 2
      ? buyerDisplayGstin.slice(0, 2)
      : sellerDisplayStateCode;
  const buyerDisplayStateName = getStateName(buyerDisplayStateCode);
  const posDisplayName = getStateName(viewingInvoice?.placeOfSupply || buyerDisplayStateCode);

  const buyerAddressDisplay = [
    viewingInvoice?.billingAddress?.street,
    viewingInvoice?.billingAddress?.city,
    viewingInvoice?.billingAddress?.state,
    viewingInvoice?.billingAddress?.pincode,
  ]
    .filter(Boolean)
    .join(', ') || '123 Commercial Hub, Industrial Phase-1';

  return (
    <div className="space-y-6">
      {/* ====================================================================
          MODE 1: INVOICE BUILDER (CREATE / EDIT)
          ==================================================================== */}
      {isCreating ? (
        <div className="space-y-6">
          <PageHeader
            title={editingInvoiceId ? 'Edit Tax Invoice' : 'Create Sales Invoice'}
            subtitle="GST compliant tax invoice with automatic CGST, SGST, IGST calculation and HSN summaries."
            badge={
              editingInvoiceId ? (
                <Badge variant="indigo" size="sm">
                  #{invoiceNumber || 'Draft'}
                </Badge>
              ) : null
            }
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsCreating(false);
                  setEditingInvoiceId(null);
                }}
                disabled={saving}
              >
                ✕ Cancel
              </Button>
            }
          />

          <form onSubmit={handleSaveInvoice} className="space-y-6">
            {/* Top Cards: Customer & Invoice Details */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Customer Selector Card */}
              <Card className="lg:col-span-2 p-5 space-y-4">
                <CardTitle>Customer Information</CardTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Select Existing Customer
                    </label>
                    <select
                      className="w-full text-xs font-normal text-slate-900 bg-white rounded-lg border border-slate-300 p-2 focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10"
                      value={customerId}
                      onChange={(e) => handleCustomerSelect(e.target.value)}
                      disabled={saving}
                    >
                      <option value="">-- Choose Customer or Enter Below --</option>
                      {customers.map((c) => (
                        <option key={c._id} value={c._id}>
                          {c.name} {c.companyName ? `(${c.companyName})` : ''} {c.gstin ? `[${c.gstin}]` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <Input
                    label="Customer / Business Name *"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Acme Technologies Private Limited"
                    required
                    disabled={saving}
                  />

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Customer GSTIN (15 Digits)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={customerGstin}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          setCustomerGstin(val);
                          if (val.length >= 2) setPlaceOfSupply(val.slice(0, 2));
                        }}
                        placeholder="29ABCDE1234F1Z5"
                        maxLength={15}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-surface-border font-mono uppercase bg-white focus:outline-hidden focus:border-indigo-600"
                        disabled={saving}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleVerifyInvoiceCustomerGstin}
                        disabled={saving || verifyingCustomerGstin || !customerGstin || customerGstin.length < 15}
                        className="shrink-0 text-xs px-2.5 py-2 border-indigo-200 bg-indigo-50/60 text-indigo-700 hover:bg-indigo-100"
                        title="Verify GSTIN with Portal & Auto-fill Legal Name"
                      >
                        {verifyingCustomerGstin ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                        )}
                        <span className="ml-1 text-[11px] font-bold">Verify</span>
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Input
                      label="Place of Supply (POS Code) *"
                      value={placeOfSupply}
                      onChange={(e) => setPlaceOfSupply(e.target.value)}
                      placeholder="e.g. 29"
                      maxLength={2}
                      className="font-mono"
                      required
                      disabled={saving}
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      Tax Engine:{' '}
                      {invoiceCalculations.isIntraState ? (
                        <strong className="text-emerald-700">Intra-State (CGST + SGST)</strong>
                      ) : (
                        <strong className="text-indigo-700">Inter-State (IGST)</strong>
                      )}
                    </span>
                  </div>
                </div>
              </Card>

              {/* Invoice Numbers & Dates */}
              <Card className="p-5 space-y-4">
                <CardTitle>Invoice Details</CardTitle>
                <Input
                  label="Invoice Number"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value.toUpperCase())}
                  placeholder="Auto-generated if empty"
                  className="font-mono uppercase"
                  disabled={saving}
                />
                <Input
                  label="Invoice Date *"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  required
                  disabled={saving}
                />
                <Input
                  label="Payment Due Date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={saving}
                />
              </Card>
            </div>

            {/* Line Items Table Builder */}
            <Card className="overflow-hidden">
              <CardHeader>
                <div>
                  <CardTitle>Invoice Line Items</CardTitle>
                  <CardDescription>
                    Add products or services with applicable HSN and GST rates
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={addLineItemRow}
                  disabled={saving}
                  leftIcon={<Plus className="w-3 h-3" />}
                >
                  Add Row
                </Button>
              </CardHeader>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider w-8">#</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider min-w-[200px]">Item / Description</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider w-24">HSN/SAC</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider w-20">Unit</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider w-20">Qty</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider w-24">Rate (₹)</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider w-20">Disc (₹)</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider w-20">GST %</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-right w-28">Amount (₹)</th>
                      <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-center w-12">✕</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {lineItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2 px-3 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-2 px-3">
                          {availableItems.length > 0 && (
                            <select
                              className="w-full text-[11px] rounded border border-slate-200 p-1 mb-1 bg-white text-slate-700"
                              value={item.itemId || ''}
                              onChange={(e) => handleItemSelect(idx, e.target.value)}
                              disabled={saving}
                            >
                              <option value="">-- Choose item preset --</option>
                              {availableItems.map((it) => (
                                <option key={it._id} value={it._id}>
                                  {it.name} (₹{it.sellingPrice} | {it.gstRate}%)
                                </option>
                              ))}
                            </select>
                          )}
                          <input
                            type="text"
                            className="w-full text-xs rounded border border-slate-200 px-2 py-1 focus:border-indigo-600 focus:outline-hidden"
                            placeholder="Item name / service line *"
                            value={item.name}
                            onChange={(e) => updateLineItem(idx, 'name', e.target.value)}
                            required
                            disabled={saving}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            className="w-full text-xs rounded border border-slate-200 px-2 py-1 font-mono uppercase focus:border-indigo-600 focus:outline-hidden"
                            placeholder="8471"
                            value={item.hsnSac}
                            onChange={(e) => updateLineItem(idx, 'hsnSac', e.target.value)}
                            disabled={saving}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <select
                            className="w-full text-xs rounded border border-slate-200 p-1 bg-white"
                            value={item.unit}
                            onChange={(e) => updateLineItem(idx, 'unit', e.target.value)}
                            disabled={saving}
                          >
                            <option value="PCS">PCS</option>
                            <option value="NOS">NOS</option>
                            <option value="KGS">KGS</option>
                            <option value="BOX">BOX</option>
                            <option value="HRS">HRS</option>
                            <option value="MTR">MTR</option>
                          </select>
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            step="1"
                            min="1"
                            className="w-full text-xs rounded border border-slate-200 px-2 py-1 font-mono focus:border-indigo-600 focus:outline-hidden"
                            value={item.quantity}
                            onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)}
                            required
                            disabled={saving}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            step="0.01"
                            className="w-full text-xs rounded border border-slate-200 px-2 py-1 font-mono focus:border-indigo-600 focus:outline-hidden"
                            value={item.rate}
                            onChange={(e) => updateLineItem(idx, 'rate', e.target.value)}
                            required
                            disabled={saving}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            step="0.01"
                            className="w-full text-xs rounded border border-slate-200 px-2 py-1 font-mono focus:border-indigo-600 focus:outline-hidden"
                            value={item.discount}
                            onChange={(e) => updateLineItem(idx, 'discount', e.target.value)}
                            disabled={saving}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <select
                            className="w-full text-xs rounded border border-slate-200 p-1 bg-white font-mono"
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
                        <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                          {formatCurrency(
                            invoiceCalculations.computedItems[idx]?.totalAmount || 0
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {lineItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeLineItemRow(idx)}
                              className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                              title="Remove item"
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
            </Card>

            {/* Bottom Breakdown & Submission */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <Card className="p-5 space-y-4">
                <CardTitle>Customer Notes & Terms</CardTitle>
                <textarea
                  className="w-full text-xs font-normal text-slate-900 bg-white rounded-lg border border-slate-300 p-2.5 focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={saving}
                />
                <div className="flex items-center gap-3">
                  <label className="text-xs font-semibold text-slate-700">Initial Invoice Status:</label>
                  <select
                    className="text-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-slate-700"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    disabled={saving}
                  >
                    <option value="Draft">Draft</option>
                    <option value="Sent">Sent</option>
                    <option value="Paid">Paid</option>
                  </select>
                </div>
              </Card>

              {/* Total Calculation Card */}
              <Card className="p-5 space-y-2.5 bg-slate-50/60">
                <CardTitle>Invoice Summary</CardTitle>
                <div className="flex justify-between text-xs py-1 text-slate-600">
                  <span>Subtotal (Taxable Value):</span>
                  <strong className="font-mono">{formatCurrency(invoiceCalculations.subTotal)}</strong>
                </div>

                {invoiceCalculations.isIntraState ? (
                  <>
                    <div className="flex justify-between text-xs py-1 text-slate-600">
                      <span>Central Tax (CGST):</span>
                      <span className="font-mono font-medium">{formatCurrency(invoiceCalculations.totalCgst)}</span>
                    </div>
                    <div className="flex justify-between text-xs py-1 text-slate-600">
                      <span>State Tax (SGST):</span>
                      <span className="font-mono font-medium">{formatCurrency(invoiceCalculations.totalSgst)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-xs py-1 text-slate-600">
                    <span>Integrated Tax (IGST):</span>
                    <span className="font-mono font-medium">{formatCurrency(invoiceCalculations.totalIgst)}</span>
                  </div>
                )}

                <div className="flex justify-between text-xs py-1 text-slate-600">
                  <span>Total Tax Amount:</span>
                  <span className="font-mono font-medium">{formatCurrency(invoiceCalculations.totalTax)}</span>
                </div>

                <div className="pt-2.5 border-t border-slate-200 flex justify-between items-center text-sm">
                  <span className="font-bold text-slate-900">Total Invoice Amount:</span>
                  <span className="font-mono font-extrabold text-base text-indigo-700">
                    {formatCurrency(invoiceCalculations.grandTotal)}
                  </span>
                </div>

                <div className="pt-4 flex items-center justify-end gap-2.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsCreating(false);
                      setEditingInvoiceId(null);
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    isLoading={saving}
                  >
                    {editingInvoiceId ? 'Update Invoice' : 'Save Invoice'}
                  </Button>
                </div>
              </Card>
            </div>
          </form>
        </div>
      ) : (
        /* ====================================================================
           MODE 2: INVOICES LIST VIEW
           ==================================================================== */
        <div className="space-y-6">
          <PageHeader
            title="Sales Invoices"
            actions={
              <Button
                variant="primary"
                size="sm"
                onClick={handleOpenCreate}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                New Invoice
              </Button>
            }
          />

          <ErrorMessage error={error} onRetry={() => fetchInvoices(searchQuery, statusFilter)} />

          {/* Metric Summary Widgets */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Sales Invoiced"
              value={formatCurrency(summaryStats.totalRev)}
              subvalue={`${invoices.length} invoices generated`}
              icon={FileText}
            />
            <MetricCard
              title="Collected Amount"
              value={formatCurrency(summaryStats.paidAmt)}
              subvalue="Received customer payments"
              icon={CheckCircle2}
              badge={<Badge status="PAID">Collected</Badge>}
            />
            <MetricCard
              title="Outstanding / Due"
              value={formatCurrency(summaryStats.pendingAmt)}
              subvalue="Pending collection"
              icon={Calendar}
              badge={
                <Badge status={summaryStats.pendingAmt > 0 ? 'OVERDUE' : 'PAID'}>
                  {summaryStats.pendingAmt > 0 ? 'Pending' : 'Zero Due'}
                </Badge>
              }
            />
            <MetricCard
              title="Registered E-Invoices"
              value={summaryStats.eInvCount}
              subvalue="NIC IRN verified with QR code"
              icon={Zap}
              badge={<Badge status="GENERATED">NIC IRN</Badge>}
            />
          </div>

          {/* Filter & Search Bar */}
          <Card className="p-3.5 bg-slate-50/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 max-w-lg">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Search className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by invoice #, customer name, GSTIN..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 transition"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-hidden focus:border-indigo-600"
                >
                  <option value="">All Statuses</option>
                  <option value="Draft">Draft</option>
                  <option value="Sent">Sent</option>
                  <option value="Paid">Paid</option>
                  <option value="Overdue">Overdue</option>
                </select>
              </div>

              <div className="text-xs text-slate-500 font-medium">
                Total <strong className="font-mono text-slate-700">{invoices.length}</strong> invoices
              </div>
            </div>
          </Card>

          {/* Invoices List Table */}
          <Card className="overflow-hidden">
            {loading ? (
              <div className="py-16">
                <Loader message="Loading invoices records..." />
              </div>
            ) : invoices.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">Invoice #</th>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">Customer</th>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">Date</th>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">Taxable (₹)</th>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">Total Tax (₹)</th>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">Grand Total (₹)</th>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-center">Status</th>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-center">E-Invoice</th>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {invoices.map((inv) => (
                      <tr key={inv._id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-indigo-600">
                          <button
                            type="button"
                            onClick={() => setViewingInvoice(inv)}
                            className="hover:underline cursor-pointer"
                          >
                            {inv.invoiceNumber}
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{inv.customerName}</div>
                          {inv.customerGstin && (
                            <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                              {inv.customerGstin}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-500">{formatDate(inv.invoiceDate)}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-600 tabular-nums">
                          {formatCurrency(inv.subTotal)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-indigo-600 tabular-nums">
                          {formatCurrency(inv.totalTax)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                          {formatCurrency(inv.grandTotal)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <StatusBadge status={inv.status} size="xs" />
                        </td>
                        <td className="py-3 px-4 text-center">
                          {inv.einvoiceStatus === 'Generated' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span>IRN Active</span>
                            </span>
                          ) : inv.einvoiceStatus === 'Failed' ? (
                            <button
                              type="button"
                              onClick={() => handleGenerateEInvoice(inv._id)}
                              disabled={generatingInvoiceId === inv._id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition cursor-pointer"
                              title={inv.einvoiceError || 'Click to retry generation'}
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Retry IRN</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleGenerateEInvoice(inv._id)}
                              disabled={generatingInvoiceId === inv._id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition cursor-pointer"
                            >
                              <Zap className="w-3 h-3 text-indigo-500" />
                              <span>Generate</span>
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingInvoice(inv)}
                              className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                              title="View & Print Invoice"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(inv)}
                              className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                              title="Edit Invoice"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTargetId(inv._id)}
                              className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                              title="Delete Invoice"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-16 text-center text-slate-400">
                <FileText className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                <h4 className="text-sm font-semibold text-slate-700">No sales invoices found</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Create your first invoice to generate IRN, QR codes, and prepare GSTR-1 returns.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleOpenCreate}
                  className="mt-4"
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Create First Invoice
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ====================================================================
          MODE 3: INVOICE PREVIEW & PRINT MODAL (Authentic Tally Prime)
          ==================================================================== */}
      {viewingInvoice && (
        <Modal
          isOpen={Boolean(viewingInvoice)}
          onClose={() => setViewingInvoice(null)}
          title={`Invoice #${viewingInvoice.invoiceNumber}`}
          subtitle={`Customer: ${viewingInvoice.customerName} • Grand Total: ${formatCurrency(viewingInvoice.grandTotal)}`}
          size="xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                {viewingInvoice.einvoiceStatus === 'Generated' ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenEwbModal}
                      leftIcon={<Truck className="w-3.5 h-3.5 text-indigo-600" />}
                    >
                      {viewingInvoice.ewayBillNo ? 'Update E-Way Bill' : 'Generate E-Way Bill'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCancelModal(true)}
                      className="text-rose-600 hover:bg-rose-50"
                    >
                      Cancel IRN
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleGenerateEInvoice(viewingInvoice._id)}
                    isLoading={eInvLoading}
                    leftIcon={<Zap className="w-3.5 h-3.5" />}
                  >
                    Generate E-Invoice (IRN)
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.print()}
                  leftIcon={<Printer className="w-3.5 h-3.5" />}
                >
                  Print / Export
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setViewingInvoice(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            {/* E-Invoice Notification Banners */}
            {eInvSuccess && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{eInvSuccess}</span>
              </div>
            )}
            {eInvError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{eInvError}</span>
              </div>
            )}

            {/* Official IRN Status Card when generated */}
            {viewingInvoice.einvoiceStatus === 'Generated' && (
              <Card className="p-3.5 bg-indigo-50/50 border-indigo-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                        Government E-Invoice Verified (NIC)
                      </span>
                      <span className="px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                        ACTIVE
                      </span>
                    </div>
                    <div className="font-mono text-xs text-slate-800 break-all select-all flex items-center gap-1.5">
                      <span><strong>IRN:</strong> {viewingInvoice.irn}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyIrn(viewingInvoice.irn)}
                        className="text-indigo-600 hover:text-indigo-800 transition"
                        title="Copy IRN"
                      >
                        {copiedIrn ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Ack No: {viewingInvoice.ackNo} | Ack Date: {formatDate(viewingInvoice.ackDate)}
                    </div>
                  </div>
                  {viewingInvoice.qrCodeImage && (
                    <img
                      src={`data:image/png;base64,${viewingInvoice.qrCodeImage}`}
                      alt="NIC Signed QR"
                      className="w-16 h-16 rounded border border-slate-200 bg-white p-0.5 object-contain"
                    />
                  )}
                </div>
              </Card>
            )}

            {/* Authentic Tally Prime Tax Invoice Container (Preserved Layout) */}
            <div
              id="printableInvoice"
              className="tally-printable-invoice bg-white text-black p-2 max-w-[820px] mx-auto text-[11.5px] leading-tight select-text"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
            >
              <div style={{ border: '1.5px solid #000' }}>
                <div
                  style={{
                    position: 'relative',
                    textAlign: 'center',
                    padding: '4px 8px',
                    borderBottom: '1px solid #000',
                    fontWeight: 'bold',
                    fontSize: '15px',
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
                      fontSize: '11px',
                    }}
                  >
                    (ORIGINAL FOR RECIPIENT)
                  </span>
                </div>

                {/* Seller & Buyer grid */}
                <div style={{ display: 'flex', borderBottom: '1px solid #000' }}>
                  <div style={{ width: '55%', borderRight: '1px solid #000', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '6px 8px', borderBottom: '1px solid #000' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{sellerDisplayName}</div>
                      <div>{sellerDisplayAddress}</div>
                      <div>GSTIN/UIN: <strong>{sellerDisplayGstin}</strong></div>
                      <div>State Name: {sellerDisplayStateName}, Code: {sellerDisplayStateCode}</div>
                    </div>
                    <div style={{ padding: '6px 8px', flexGrow: 1 }}>
                      <div style={{ fontSize: '10.5px' }}>Buyer (Bill to)</div>
                      <div style={{ fontWeight: 'bold', fontSize: '12.5px' }}>{buyerDisplayName}</div>
                      <div>{buyerAddressDisplay}</div>
                      <div>GSTIN/UIN: <strong>{buyerDisplayGstin || '—'}</strong></div>
                      <div>Place of Supply: {posDisplayName}</div>
                    </div>
                  </div>

                  <div style={{ width: '45%', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', borderBottom: '1px solid #000', minHeight: '34px' }}>
                      <div style={{ width: '50%', padding: '3px 6px', borderRight: '1px solid #000' }}>
                        <div style={{ fontSize: '10px' }}>Invoice No.</div>
                        <div style={{ fontWeight: 'bold' }}>{viewingInvoice.invoiceNumber}</div>
                      </div>
                      <div style={{ width: '50%', padding: '3px 6px' }}>
                        <div style={{ fontSize: '10px' }}>Dated</div>
                        <div style={{ fontWeight: 'bold' }}>{formatTallyDate(viewingInvoice.invoiceDate)}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', borderBottom: '1px solid #000', minHeight: '34px' }}>
                      <div style={{ width: '50%', padding: '3px 6px', borderRight: '1px solid #000' }}>
                        <div style={{ fontSize: '10px' }}>Delivery Note</div>
                        <div>—</div>
                      </div>
                      <div style={{ width: '50%', padding: '3px 6px' }}>
                        <div style={{ fontSize: '10px' }}>Mode/Terms of Payment</div>
                        <div>Due on Receipt</div>
                      </div>
                    </div>
                    <div style={{ padding: '3px 6px' }}>
                      <div style={{ fontSize: '10px' }}>Buyer&apos;s Order No. & Date</div>
                      <div>—</div>
                    </div>
                  </div>
                </div>

                {/* Line Items Table */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #000', backgroundColor: '#fcfcfc' }}>
                      <th style={{ padding: '4px', textAlign: 'center', width: '30px', borderRight: '1px solid #000' }}>Sl</th>
                      <th style={{ padding: '4px', textAlign: 'left', borderRight: '1px solid #000' }}>Description of Goods</th>
                      <th style={{ padding: '4px', textAlign: 'center', width: '70px', borderRight: '1px solid #000' }}>HSN/SAC</th>
                      <th style={{ padding: '4px', textAlign: 'right', width: '60px', borderRight: '1px solid #000' }}>Qty</th>
                      <th style={{ padding: '4px', textAlign: 'right', width: '70px', borderRight: '1px solid #000' }}>Rate</th>
                      <th style={{ padding: '4px', textAlign: 'right', width: '80px' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingInvoice.lineItems?.map((it, idx) => (
                      <tr key={idx}>
                        <td style={{ padding: '4px', textAlign: 'center', borderRight: '1px solid #000' }}>{idx + 1}</td>
                        <td style={{ padding: '4px', borderRight: '1px solid #000', fontWeight: 'bold' }}>{it.name}</td>
                        <td style={{ padding: '4px', textAlign: 'center', borderRight: '1px solid #000', fontFamily: 'monospace' }}>{it.hsnSac || '—'}</td>
                        <td style={{ padding: '4px', textAlign: 'right', borderRight: '1px solid #000' }}>{it.quantity} {it.unit || defaultUnit}</td>
                        <td style={{ padding: '4px', textAlign: 'right', borderRight: '1px solid #000' }}>{formatTallyNum(it.rate)}</td>
                        <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold' }}>{formatTallyNum(it.totalAmount || (it.quantity * it.rate))}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '1px solid #000', fontWeight: 'bold' }}>
                      <td colSpan={3} style={{ padding: '5px', textAlign: 'right', borderRight: '1px solid #000' }}>Total:</td>
                      <td style={{ padding: '5px', textAlign: 'right', borderRight: '1px solid #000' }}>{totalInvoiceQty} {defaultUnit}</td>
                      <td style={{ padding: '5px', borderRight: '1px solid #000' }} />
                      <td style={{ padding: '5px', textAlign: 'right' }}>₹{formatTallyNum(viewingInvoice.grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Amount in Words */}
                <div style={{ padding: '6px 8px', borderTop: '1px solid #000', fontSize: '11px' }}>
                  Amount Chargeable (in words):<br />
                  <strong>INR {numberToWords(viewingInvoice.grandTotal)} Only</strong>
                </div>

                {/* HSN Tax Summary */}
                <div style={{ borderTop: '1px solid #000', padding: '6px 8px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Tax Summary</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10.5px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #000' }}>
                        <th style={{ textAlign: 'left', padding: '2px 4px' }}>HSN/SAC</th>
                        <th style={{ textAlign: 'right', padding: '2px 4px' }}>Taxable Value</th>
                        <th style={{ textAlign: 'right', padding: '2px 4px' }}>Central Tax</th>
                        <th style={{ textAlign: 'right', padding: '2px 4px' }}>State Tax</th>
                        <th style={{ textAlign: 'right', padding: '2px 4px' }}>Integrated Tax</th>
                        <th style={{ textAlign: 'right', padding: '2px 4px' }}>Total Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hsnBreakdown.map((h, i) => (
                        <tr key={i}>
                          <td style={{ padding: '2px 4px', fontFamily: 'monospace' }}>{h.hsn}</td>
                          <td style={{ textAlign: 'right', padding: '2px 4px' }}>{formatTallyNum(h.taxable)}</td>
                          <td style={{ textAlign: 'right', padding: '2px 4px' }}>{formatTallyNum(h.cgstAmount)}</td>
                          <td style={{ textAlign: 'right', padding: '2px 4px' }}>{formatTallyNum(h.sgstAmount)}</td>
                          <td style={{ textAlign: 'right', padding: '2px 4px' }}>{formatTallyNum(h.igstAmount)}</td>
                          <td style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 'bold' }}>{formatTallyNum(h.totalTax)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer Signatures */}
                <div style={{ display: 'flex', borderTop: '1px solid #000', minHeight: '60px' }}>
                  <div style={{ width: '55%', padding: '6px 8px', borderRight: '1px solid #000', fontSize: '10.5px' }}>
                    Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
                  </div>
                  <div style={{ width: '45%', padding: '6px 8px', textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>for <strong>{sellerDisplayName}</strong></div>
                    <div style={{ fontSize: '10.5px', marginTop: '30px' }}>Authorized Signatory</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* E-Way Bill Modal */}
      <Modal
        isOpen={showEwbModal}
        onClose={() => setShowEwbModal(false)}
        title="Generate Government E-Way Bill"
        subtitle="Registers vehicle transit linked to active IRN"
        size="md"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowEwbModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleGenerateEwbSubmit} isLoading={ewbLoading}>
              Generate E-Way Bill
            </Button>
          </>
        }
      >
        <form onSubmit={handleGenerateEwbSubmit} className="space-y-4">
          <Input
            label="Vehicle Registration Number *"
            value={ewbForm.vehicleNo}
            onChange={(e) => setEwbForm({ ...ewbForm, vehicleNo: e.target.value.toUpperCase() })}
            placeholder="e.g. DL01AB1234"
            required
            className="font-mono uppercase"
          />
          <Input
            label="Approx Transit Distance (km)"
            type="number"
            value={ewbForm.distance}
            onChange={(e) => setEwbForm({ ...ewbForm, distance: Number(e.target.value) })}
            placeholder="e.g. 150"
            className="font-mono"
          />
          <Input
            label="Transporter Name"
            value={ewbForm.transporterName}
            onChange={(e) => setEwbForm({ ...ewbForm, transporterName: e.target.value })}
            placeholder="e.g. VRL Logistics"
          />
          <Input
            label="Transporter GSTIN / ID"
            value={ewbForm.transporterId}
            onChange={(e) => setEwbForm({ ...ewbForm, transporterId: e.target.value.toUpperCase() })}
            placeholder="29AAAAL1234A1Z5"
            className="font-mono uppercase"
          />
        </form>
      </Modal>

      {/* Cancel E-Invoice Modal */}
      <Modal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Cancel E-Invoice (IRN)"
        subtitle="Cannot be undone. Government NIC allows cancellation within 24 hours of generation."
        size="md"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowCancelModal(false)}>
              Keep IRN Active
            </Button>
            <Button variant="danger" size="sm" onClick={handleCancelEInvoiceSubmit} isLoading={cancelLoading}>
              Confirm Cancellation
            </Button>
          </>
        }
      >
        <form onSubmit={handleCancelEInvoiceSubmit} className="space-y-4">
          <Select
            label="Statutory Cancellation Reason *"
            value={cancelForm.reasonCode}
            onChange={(e) => setCancelForm({ ...cancelForm, reasonCode: e.target.value })}
          >
            <option value="1">1 - Duplicate Invoice</option>
            <option value="2">2 - Data Entry Mistake</option>
            <option value="3">3 - Order Cancelled by Buyer</option>
            <option value="4">4 - Other Business Reason</option>
          </Select>
          <Input
            label="Remarks / Explanation *"
            value={cancelForm.remarks}
            onChange={(e) => setCancelForm({ ...cancelForm, remarks: e.target.value })}
            placeholder="Explain reason for cancellation"
            required
          />
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTargetId)}
        title="Delete Invoice"
        message="Are you sure you want to delete this invoice? This will remove the record from billing and GSTR-1 calculation."
        confirmLabel="Delete Invoice"
        cancelLabel="Cancel"
        isDestructive={true}
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}
