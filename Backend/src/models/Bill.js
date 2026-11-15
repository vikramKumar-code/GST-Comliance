const mongoose = require('mongoose');

const billLineItemSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: true,
      trim: true
    },
    hsnSac: {
      type: String,
      trim: true,
      default: ''
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 1
    },
    rate: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    taxableAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    gstRate: {
      type: Number,
      required: true,
      min: 0,
      default: 18
    },
    cgstAmount: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const billSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    billNumber: {
      type: String,
      required: true,
      trim: true
    },
    vendorName: {
      type: String,
      required: true,
      trim: true
    },
    vendorGstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    // Extract 2-digit Place of Supply from Vendor GSTIN or POS string
    placeOfSupply: {
      type: String,
      trim: true,
      default: '',
      set: function (v) {
        if (!v && this.vendorGstin && this.vendorGstin.length >= 2) {
          return this.vendorGstin.slice(0, 2);
        }
        if (!v) return '';
        const match = String(v).trim().match(/^([0-9]{2})/);
        return match ? match[1] : String(v).trim().slice(0, 2).toUpperCase();
      }
    },
    // Reverse Charge Mechanism flag for Table 3.1(d) cash liability
    isReverseCharge: {
      type: Boolean,
      default: false
    },
    billDate: {
      type: Date,
      required: true,
      default: Date.now
    },
    dueDate: {
      type: Date
    },
    category: {
      type: String,
      enum: ['Inventory', 'Expense', 'Asset', 'Service'],
      default: 'Expense'
    },
    lineItems: [billLineItemSchema],
    subTotal: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    totalCgst: { type: Number, default: 0 },
    totalSgst: { type: Number, default: 0 },
    totalIgst: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    grandTotal: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    status: {
      type: String,
      enum: ['Draft', 'Pending', 'Paid', 'Overdue'],
      default: 'Pending',
      index: true
    },
    // ITC Eligibility tracking for GSTR-2B vs Books reconciliation
    itcEligible: {
      type: Boolean,
      default: true
    },
    itcReason: {
      type: String,
      default: 'Eligible',
      trim: true
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    }
  },
  { timestamps: true }
);

// ✅ FIX 3: Unique Compound Index to prevent duplicate vendor bills in same workspace
billSchema.index({ workspaceId: 1, billNumber: 1 }, { unique: true });
billSchema.index({ workspaceId: 1, billDate: -1 });
billSchema.index({ workspaceId: 1, billDate: -1, status: 1 });
billSchema.index({ workspaceId: 1, vendorGstin: 1 }); // Crucial for fast GSTR-2B matching

module.exports = mongoose.model('Bill', billSchema);