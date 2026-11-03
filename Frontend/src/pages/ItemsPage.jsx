import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Package,
  Plus,
  Search,
  Tag,
  Edit2,
  Trash2,
  Layers,
} from 'lucide-react';
import {
  listItems,
  createItem,
  updateItem,
  deleteItem,
} from '../api/items.api';
import Loader from '../components/common/Loader';
import ErrorMessage from '../components/ErrorMessage';
import ConfirmDialog from '../components/common/ConfirmDialog';
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  Modal,
  Badge,
} from '../components/ui';
import { formatCurrency } from '../utils/format';

const INITIAL_ITEM = {
  name: '',
  type: 'goods',
  hsnSac: '',
  unit: 'PCS',
  sellingPrice: '',
  purchasePrice: '',
  gstRate: 18,
  description: '',
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

  // Delete dialog
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
      description: item.description || '',
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
      description: formData.description.trim(),
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

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      await deleteItem(deleteTargetId);
      setDeleteTargetId(null);
      fetchItems(searchQuery, typeFilter);
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
        title="Items & HSN"
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenCreate}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            New Item
          </Button>
        }
      />

      <ErrorMessage error={error} onRetry={() => fetchItems(searchQuery, typeFilter)} />

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
                placeholder="Search items by name, HSN/SAC code..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 transition"
              />
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-hidden focus:border-indigo-600"
            >
              <option value="">All Types</option>
              <option value="goods">Goods (HSN)</option>
              <option value="services">Services (SAC)</option>
            </select>
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Showing <strong className="font-mono text-slate-700">{items.length}</strong> items
          </div>
        </div>
      </Card>

      {/* Items Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16">
            <Loader message="Loading items catalog..." />
          </div>
        ) : items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Item Name
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    HSN / SAC
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Type
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider">
                    Unit
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">
                    Selling Price
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">
                    Purchase Price
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-center">
                    GST Rate
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {items.map((it) => (
                  <tr key={it._id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{it.name}</div>
                      {it.description && (
                        <div className="text-[11px] text-slate-400 truncate max-w-xs">
                          {it.description}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {it.hsnSac ? (
                        <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-800">
                          {it.hsnSac}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Unspecified</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        variant={it.type === 'services' ? 'purple' : 'blue'}
                        size="xs"
                      >
                        {it.type === 'services' ? 'Service' : 'Goods'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {it.unit || 'PCS'}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium text-right tabular-nums text-slate-900">
                      {it.sellingPrice ? formatCurrency(it.sellingPrice) : '—'}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 text-right tabular-nums">
                      {it.purchasePrice ? formatCurrency(it.purchasePrice) : '—'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 font-mono">
                        {it.gstRate || 0}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(it)}
                          className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                          title="Edit Item"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTargetId(it._id)}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                          title="Delete Item"
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
            <Package className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <h4 className="text-sm font-semibold text-slate-700">No items found</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Add products or services with HSN/SAC codes to auto-populate invoices.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenCreate}
              className="mt-4"
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Add First Item
            </Button>
          </div>
        )}
      </Card>

      {/* Add / Edit Item Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingItem ? 'Edit Item / Product' : 'Add New Item / Service'}
        subtitle="Used for automatic HSN tax calculations in sales invoices"
        size="md"
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
              {editingItem ? 'Save Changes' : 'Create Item'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Item / Service Name *"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. Dell UltraSharp 27 Monitor"
            required
          />

          <div className="grid grid-cols-2 gap-3.5">
            <Select
              label="Item Classification"
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            >
              <option value="goods">Goods (Physical Product)</option>
              <option value="services">Services (Professional / Consulting)</option>
            </Select>

            <Input
              label="HSN / SAC Code"
              value={formData.hsnSac}
              onChange={(e) => setFormData({ ...formData, hsnSac: e.target.value })}
              placeholder="e.g. 84713010 or 998311"
              className="font-mono"
            />
          </div>

          <div className="grid grid-cols-3 gap-3.5">
            <Select
              label="GST Tax Rate (%)"
              value={formData.gstRate}
              onChange={(e) =>
                setFormData({ ...formData, gstRate: Number(e.target.value) })
              }
            >
              <option value={0}>0% (Nil / Exempt)</option>
              <option value={5}>5%</option>
              <option value={12}>12%</option>
              <option value={18}>18% (Standard)</option>
              <option value={28}>28% (Luxury / Sin)</option>
            </Select>

            <Input
              label="Selling Price (₹)"
              type="number"
              step="0.01"
              value={formData.sellingPrice}
              onChange={(e) =>
                setFormData({ ...formData, sellingPrice: e.target.value })
              }
              placeholder="0.00"
              className="font-mono"
            />

            <Select
              label="Unit of Measure"
              value={formData.unit}
              onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
            >
              <option value="PCS">PCS (Pieces)</option>
              <option value="NOS">NOS (Numbers)</option>
              <option value="KGS">KGS (Kilograms)</option>
              <option value="BOX">BOX (Box)</option>
              <option value="HRS">HRS (Hours)</option>
              <option value="MTR">MTR (Meters)</option>
              <option value="SET">SET (Sets)</option>
            </Select>
          </div>

          <Input
            label="Purchase Price (₹)"
            type="number"
            step="0.01"
            value={formData.purchasePrice}
            onChange={(e) =>
              setFormData({ ...formData, purchasePrice: e.target.value })
            }
            placeholder="0.00"
            className="font-mono"
          />

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Description / Notes
            </label>
            <textarea
              className="w-full text-xs font-normal text-slate-900 bg-white rounded-lg border border-slate-300 p-2.5 focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10"
              rows={2}
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Product details, technical specifications..."
            />
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTargetId)}
        title="Delete Item"
        message="Are you sure you want to delete this item? It will no longer appear in invoice suggestions."
        confirmLabel="Delete Item"
        cancelLabel="Cancel"
        isDestructive={true}
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}
