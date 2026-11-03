import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users,
  Plus,
  Search,
  Building2,
  Phone,
  Mail,
  MapPin,
  Edit2,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from '../api/customers.api';
import { searchGstin } from '../api/auth.api';
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Button,
  Input,
  Select,
  Modal,
  Badge,
} from '../components/ui';

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
  billingPincode: '',
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

  // Confirm delete dialog state
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Live GSTIN Public Verification & Profiler State
  const [verifyingGstin, setVerifyingGstin] = useState(false);
  const [gstinVerifySuccess, setGstinVerifySuccess] = useState(null);
  const [gstinVerifyError, setGstinVerifyError] = useState(null);

  const handleVerifyGstin = async () => {
    if (!formData.gstin || formData.gstin.trim().length < 15) {
      setGstinVerifyError('Please enter a valid 15-character GSTIN first.');
      return;
    }
    setVerifyingGstin(true);
    setGstinVerifyError(null);
    setGstinVerifySuccess(null);
    try {
      const cleanGstin = formData.gstin.trim().toUpperCase();
      const res = await searchGstin(cleanGstin);
      const tp = res?.taxpayer || res;
      const legalName = tp?.legalName || tp?.tradeName || 'Registered Taxpayer';
      const tradeName = tp?.tradeName || legalName;
      const addr = tp?.pradr?.addr || {};
      const stateCode = cleanGstin.slice(0, 2);

      const street = [addr.bno, addr.bnm, addr.st].filter(Boolean).join(', ');
      const city = addr.loc || addr.dst || '';
      const state = addr.stcd || '';
      const pincode = addr.pncd || '';

      setFormData((prev) => ({
        ...prev,
        gstin: cleanGstin,
        name: legalName || prev.name,
        companyName: tradeName || prev.companyName,
        placeOfSupply: stateCode || prev.placeOfSupply,
        billingStreet: street || prev.billingStreet,
        billingCity: city || prev.billingCity,
        billingState: state || prev.billingState,
        billingStateCode: stateCode || prev.billingStateCode,
        billingPincode: pincode || prev.billingPincode,
        gstType: tp?.dty?.toLowerCase()?.includes('composition') ? 'Composition' : 'Regular'
      }));

      setGstinVerifySuccess(`Verified: ${legalName} • Status: ${tp?.status || 'Active'}`);
    } catch (err) {
      setGstinVerifyError(err?.message || 'Taxpayer details could not be retrieved from GSTN.');
    } finally {
      setVerifyingGstin(false);
    }
  };

  const handleOpenCreate = useCallback(() => {
    setEditingCustomer(null);
    setFormData(INITIAL_FORM);
    setGstinVerifySuccess(null);
    setGstinVerifyError(null);
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
      billingPincode: customer.billingAddress?.pincode || '',
    });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setSaving(true);
    setError(null);

    const pos =
      formData.placeOfSupply.trim() ||
      (formData.gstin ? formData.gstin.slice(0, 2) : '');

    const payload = {
      name: formData.name.trim(),
      companyName: formData.companyName.trim(),
      gstin: formData.gstin.trim().toUpperCase(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      gstType: formData.gstType,
      placeOfSupply: pos,
      billingAddress: {
        street: formData.billingStreet,
        city: formData.billingCity,
        state: formData.billingState,
        stateCode: formData.billingStateCode || pos,
        pincode: formData.billingPincode,
        country: 'India',
      },
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

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      await deleteCustomer(deleteTargetId);
      setDeleteTargetId(null);
      fetchCustomers(searchQuery);
    } catch (err) {
      setError(err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Customers"
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenCreate}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            New Customer
          </Button>
        }
      />

      <ErrorMessage error={error} onRetry={() => fetchCustomers(searchQuery)} />

      {/* Search Bar & Counter */}
      <Card className="p-3.5 bg-slate-50/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer name, company, GSTIN, phone..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 transition"
            />
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Showing <strong className="font-mono text-slate-700">{customers.length}</strong> registered clients
          </div>
        </div>
      </Card>

      {/* Customers Data Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16">
            <Loader message="Loading customer records..." />
          </div>
        ) : customers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Customer Name
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Company Name
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    GSTIN
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    State / POS
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-center">
                    GST Type
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {customers.map((c) => (
                  <tr key={c._id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {c.name}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {c.companyName || '—'}
                    </td>
                    <td className="py-3 px-4">
                      {c.gstin ? (
                        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-800">
                          {c.gstin}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Unregistered</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {c.placeOfSupply
                        ? `State Code ${c.placeOfSupply}`
                        : c.billingAddress?.state || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      <div>{c.phone || '—'}</div>
                      {c.email && (
                        <div className="text-[11px] text-slate-400">{c.email}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={c.gstType === 'Composition' ? 'warning' : 'neutral'} size="xs">
                        {c.gstType || 'Regular'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(c)}
                          className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                          title="Edit Customer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTargetId(c._id)}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                          title="Delete Customer"
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
            <Users className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <h4 className="text-sm font-semibold text-slate-700">No customers found</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {searchQuery
                ? `No customers matching "${searchQuery}". Try a different keyword.`
                : 'Start by creating your first customer to streamline invoicing.'}
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenCreate}
              className="mt-4"
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Add First Customer
            </Button>
          </div>
        )}
      </Card>

      {/* Add / Edit Customer Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingCustomer ? 'Edit Customer Profile' : 'Add New Customer'}
        subtitle="Customer details will auto-populate during invoice creation"
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowModal(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              isLoading={saving}
            >
              {editingCustomer ? 'Save Changes' : 'Create Customer'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Input
              label="Contact / Primary Name *"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Rajesh Kumar"
              required
            />
            <Input
              label="Company / Trade Name"
              value={formData.companyName}
              onChange={(e) =>
                setFormData({ ...formData, companyName: e.target.value })
              }
              placeholder="e.g. Acme Enterprises Ltd"
            />
          </div>

          {gstinVerifySuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-semibold">{gstinVerifySuccess}</span>
            </div>
          )}

          {gstinVerifyError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{gstinVerifyError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                GSTIN (15 Alphanumeric)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={formData.gstin}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setFormData({
                      ...formData,
                      gstin: val,
                      placeOfSupply:
                        val.length >= 2 && !formData.placeOfSupply
                          ? val.slice(0, 2)
                          : formData.placeOfSupply,
                    });
                  }}
                  placeholder="29AABCU9603R1Z2"
                  maxLength={15}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-surface-border font-mono uppercase bg-white focus:outline-hidden focus:border-indigo-600"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleVerifyGstin}
                  disabled={verifyingGstin || !formData.gstin || formData.gstin.length < 15}
                  className="shrink-0 text-xs px-2.5 py-2 border-indigo-200 bg-indigo-50/60 text-indigo-700 hover:bg-indigo-100"
                  title="Verify with GST Portal & Auto-fill Address"
                >
                  {verifyingGstin ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                  )}
                  <span className="ml-1 text-[11px] font-bold">Verify</span>
                </Button>
              </div>
            </div>
            <Input
              label="Place of Supply (POS Code)"
              value={formData.placeOfSupply}
              onChange={(e) =>
                setFormData({ ...formData, placeOfSupply: e.target.value })
              }
              placeholder="e.g. 29 for Karnataka"
              maxLength={2}
              className="font-mono"
            />
            <Select
              label="GST Registration Type"
              value={formData.gstType}
              onChange={(e) =>
                setFormData({ ...formData, gstType: e.target.value })
              }
            >
              <option value="Regular">Regular Taxpayer</option>
              <option value="Composition">Composition Scheme</option>
              <option value="Unregistered">Unregistered Consumer</option>
              <option value="SEZ">Special Economic Zone (SEZ)</option>
              <option value="Overseas">Export / Overseas</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Input
              label="Email Address"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="billing@company.com"
            />
            <Input
              label="Phone Number"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+91 98765 43210"
            />
          </div>

          <div className="pt-2 border-t border-slate-100">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2 block">
              Billing Address Details
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2">
                <Input
                  label="Street Address"
                  value={formData.billingStreet}
                  onChange={(e) =>
                    setFormData({ ...formData, billingStreet: e.target.value })
                  }
                  placeholder="Plot No, Industrial Area, Main Road"
                />
              </div>
              <Input
                label="City"
                value={formData.billingCity}
                onChange={(e) =>
                  setFormData({ ...formData, billingCity: e.target.value })
                }
                placeholder="Bengaluru"
              />
              <Input
                label="State"
                value={formData.billingState}
                onChange={(e) =>
                  setFormData({ ...formData, billingState: e.target.value })
                }
                placeholder="Karnataka"
              />
              <Input
                label="State Code"
                value={formData.billingStateCode}
                onChange={(e) =>
                  setFormData({ ...formData, billingStateCode: e.target.value })
                }
                placeholder="29"
                maxLength={2}
                className="font-mono"
              />
              <Input
                label="PIN Code"
                value={formData.billingPincode}
                onChange={(e) =>
                  setFormData({ ...formData, billingPincode: e.target.value })
                }
                placeholder="560001"
                maxLength={6}
                className="font-mono"
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTargetId)}
        title="Delete Customer"
        message="Are you sure you want to delete this customer? This action cannot be undone."
        confirmLabel="Delete Customer"
        cancelLabel="Cancel"
        isDestructive={true}
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}
