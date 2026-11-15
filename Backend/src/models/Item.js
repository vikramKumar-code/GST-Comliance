const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    // ✅ FIX 1: Unique Item Code / SKU (Optional but Unique if present)
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    type: {
      type: String,
      enum: ['goods', 'service'],
      default: 'goods',
      required: true
    },
    hsnSac: {
      type: String,
      trim: true,
      default: '',
      // ✅ FIX 3: HSN/SAC Validation (4 to 8 digits)
      validate: {
        validator: function (v) {
          // Empty allowed hai, lekin agar value hai toh 4-8 digits hone chahiye
          return !v || /^[0-9]{4,8}$/.test(v);
        },
        message: 'HSN/SAC code must be 4 to 8 digits (e.g., 998313 or 850110)'
      }
    },
    unit: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'PCS',
      // Common GSTN UOMs: NOS, PCS, KGS, MTR, LTR, OTH, etc.
    },
    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    purchasePrice: {
      type: Number,
      min: 0,
      default: 0
    },
    gstRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 18,
      enum: [0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28] // Standard GST Slabs
    },
    cessRate: {
      type: Number,
      min: 0,
      default: 0
    },
    // ✅ FIX 2: Tax Preference for GSTR-1 Table 8 (Nil/Exempt/Non-GST)
    taxPreference: {
      type: String,
      enum: ['TAXABLE', 'NIL', 'EXEMPT', 'NON_GST'],
      default: 'TAXABLE'
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
      index: true
    },
    // ✅ FIX 4: Inventory Tracking Flag
    trackInventory: {
      type: Boolean,
      default: false
    },
    // Opening stock (useful for new businesses or migration)
    openingStock: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

// ✅ Indexes
// Unique SKU per workspace (Sparse index allows empty SKUs)
itemSchema.index({ workspaceId: 1, sku: 1 }, { unique: true, sparse: true });

// Fast search by name
itemSchema.index({ workspaceId: 1, name: 1 });

// Fast filtering by HSN (useful for HSN Summary reports)
itemSchema.index({ workspaceId: 1, hsnSac: 1 });

module.exports = mongoose.model('Item', itemSchema);