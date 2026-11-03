import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  ShoppingCart,
  Plus,
  Search,
  Scale,
  Trash2,
  Calendar,
  CheckCircle2,
  Clock,
  Building2,
  Filter,
} from 'lucide-react';
import {
  listBills,
  createBill,
  updateBill,
  deleteBill,
} from '../api/bills.api';
import Loader from '../components/common/Loader';
import ErrorMessage from '../components/ErrorMessage';
import ConfirmDialog from '../components/common/ConfirmDialog';
import StatusBadge from '../components/common/StatusBadge';
import ItcReconciliationModal from '../components/ItcReconciliationModal';
import {
  PageHeader,
  Card,
  MetricCard,
  Button,
  Input,
  Select,
  Modal,
  Badge,
} from '../components/ui';
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
  notes: '',
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

  // Confirm delete dialog state
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  // Derived financial statistics
  const stats = useMemo(() => {
    let total = 0;
    let paid = 0;
    let unpaid = 0;
    for (const b of bills) {
      const amt = Number(b.grandTotal || b.totalAmount || 0);
      total += amt;
      if (b.status?.toLowerCase() === 'paid') {
        paid += amt;
      } else {
        unpaid += amt;
      }
    }
    return { total, paid, unpaid };
  }, [bills]);

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
          gstRate: Number(formData.gstRate) || 0,
        },
      ],
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

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      await deleteBill(deleteTargetId);
      setDeleteTargetId(null);
      fetchBills(searchQuery, categoryFilter);
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
        title="Purchase Bills"
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowReconcileModal(true)}
              leftIcon={<Scale className="w-3.5 h-3.5 text-indigo-600" />}
            >
              Reconcile ITC
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenCreate}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Record Bill
            </Button>
          </div>
        }
      />

      <ErrorMessage error={error} onRetry={() => fetchBills(searchQuery, categoryFilter)} />

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          title="Total Purchases & Inward Supplies"
          value={formatCurrency(stats.total)}
          subvalue={`${bills.length} bills recorded`}
          icon={ShoppingCart}
        />
        <MetricCard
          title="Paid Vendor Invoices"
          value={formatCurrency(stats.paid)}
          subvalue="Fully settled purchases"
          icon={CheckCircle2}
          badge={<Badge status="PAID">Settled</Badge>}
        />
        <MetricCard
          title="Outstanding / Due Amount"
          value={formatCurrency(stats.unpaid)}
          subvalue="Payable to suppliers"
          icon={Clock}
          badge={<Badge status={stats.unpaid > 0 ? 'OVERDUE' : 'PAID'}>Outstanding</Badge>}
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
                placeholder="Search by bill #, vendor name, GSTIN..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 transition"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-hidden focus:border-indigo-600"
            >
              <option value="">All Categories</option>
              <option value="Expense">Expense</option>
              <option value="Asset">Capital Goods (Asset)</option>
              <option value="Raw Material">Raw Material</option>
              <option value="Service">Inward Service</option>
            </select>
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Showing <strong className="font-mono text-slate-700">{bills.length}</strong> purchase bills
          </div>
        </div>
      </Card>

      {/* Bills Data Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16">
            <Loader message="Loading purchase bills..." />
          </div>
        ) : bills.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Bill #
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Vendor Details
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Date & Due
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Category
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">
                    Total Amount
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-center">
                    Status
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {bills.map((b) => (
                  <tr key={b._id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      {b.billNumber}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{b.vendorName}</div>
                      {b.vendorGstin ? (
                        <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                          GSTIN: {b.vendorGstin}
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-400">Unregistered Vendor</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      <div>{formatDate(b.billDate)}</div>
                      {b.dueDate && (
                        <div className="text-[10px] text-amber-700 font-mono">
                          Due: {formatDate(b.dueDate)}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="neutral" size="xs">
                        {b.category || 'Expense'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-right tabular-nums text-slate-900">
                      {formatCurrency(b.grandTotal || b.totalAmount || 0)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <select
                        value={b.status || 'Draft'}
                        onChange={(e) => handleStatusChange(b._id, e.target.value)}
                        className={`text-xs px-2 py-0.5 rounded-md border font-medium focus:outline-hidden cursor-pointer ${
                          b.status?.toLowerCase() === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        <option value="Draft">Draft</option>
                        <option value="Unpaid">Unpaid</option>
                        <option value="Paid">Paid</option>
                      </select>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(b._id)}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                        title="Delete Bill"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-16 text-center text-slate-400">
            <ShoppingCart className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <h4 className="text-sm font-semibold text-slate-700">No purchase bills recorded</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Record supplier bills to auto-calculate input tax credit and reconcile against GSTR-2B.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenCreate}
              className="mt-4"
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Record First Bill
            </Button>
          </div>
        )}
      </Card>

      {/* Record Bill Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Record Purchase Bill"
        subtitle="Inward supplies will contribute to your eligible Input Tax Credit pool"
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
              Save Purchase Bill
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Input
              label="Supplier / Vendor Bill Number *"
              value={formData.billNumber}
              onChange={(e) =>
                setFormData({ ...formData, billNumber: e.target.value })
              }
              placeholder="e.g. BILL-2026-091"
              required
              className="font-mono uppercase"
            />
            <Input
              label="Supplier / Vendor Name *"
              value={formData.vendorName}
              onChange={(e) =>
                setFormData({ ...formData, vendorName: e.target.value })
              }
              placeholder="e.g. Reliance Corporate IT Ltd"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <Input
              label="Vendor GSTIN"
              value={formData.vendorGstin}
              onChange={(e) =>
                setFormData({ ...formData, vendorGstin: e.target.value.toUpperCase() })
              }
              placeholder="27AAACR5055K1ZI"
              maxLength={15}
              className="font-mono uppercase"
            />
            <Input
              label="Bill Date *"
              type="date"
              value={formData.billDate}
              onChange={(e) =>
                setFormData({ ...formData, billDate: e.target.value })
              }
              required
            />
            <Input
              label="Payment Due Date"
              type="date"
              value={formData.dueDate}
              onChange={(e) =>
                setFormData({ ...formData, dueDate: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Select
              label="Accounting Category"
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value })
              }
            >
              <option value="Expense">Operational Expense</option>
              <option value="Asset">Capital Goods / Assets</option>
              <option value="Raw Material">Raw Material / Inventory</option>
              <option value="Service">Inward Services</option>
            </Select>
            <Input
              label="Expense / Line Description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="e.g. Office Cloud Hosting Servers"
            />
          </div>

          <div className="grid grid-cols-3 gap-3.5 p-3.5 rounded-lg bg-slate-50 border border-slate-200/80">
            <Input
              label="Quantity"
              type="number"
              step="1"
              value={formData.quantity}
              onChange={(e) =>
                setFormData({ ...formData, quantity: e.target.value })
              }
              className="font-mono"
            />
            <Input
              label="Taxable Rate (₹)"
              type="number"
              step="0.01"
              value={formData.rate}
              onChange={(e) =>
                setFormData({ ...formData, rate: e.target.value })
              }
              className="font-mono"
            />
            <Select
              label="GST Tax Rate (%)"
              value={formData.gstRate}
              onChange={(e) =>
                setFormData({ ...formData, gstRate: Number(e.target.value) })
              }
            >
              <option value={0}>0%</option>
              <option value={5}>5%</option>
              <option value={12}>12%</option>
              <option value={18}>18%</option>
              <option value={28}>28%</option>
            </Select>
          </div>

          <div className="flex justify-between items-center text-xs px-1">
            <span className="text-slate-500">Estimated Total Amount:</span>
            <span className="font-mono font-bold text-sm text-slate-900">
              {formatCurrency(
                (Number(formData.quantity) || 1) *
                  (Number(formData.rate) || 0) *
                  (1 + (Number(formData.gstRate) || 0) / 100)
              )}
            </span>
          </div>
        </form>
      </Modal>

      {/* ITC Reconciliation Modal */}
      <ItcReconciliationModal
        isOpen={showReconcileModal}
        onClose={() => setShowReconcileModal(false)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTargetId)}
        title="Delete Purchase Bill"
        message="Are you sure you want to delete this bill? This action cannot be undone."
        confirmLabel="Delete Bill"
        cancelLabel="Cancel"
        isDestructive={true}
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}
