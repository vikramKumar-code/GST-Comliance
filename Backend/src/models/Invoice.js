const mongoose = require('mongoose');

const invoiceLineItemSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      default: null
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    hsnSac: {
      type: String,
      trim: true,
      default: '',
      // Automatically trim whitespace from HSN code
      set: (v) => (v ? String(v).trim() : '')
    },
    unit: {
      type: String,
      trim: true,
      default: 'PCS',
      // Normalize unit quantity code to uppercase
      set: (v) => (v ? String(v).trim().toUpperCase() : 'PCS')
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
    discount: {
      type: Number,
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
    // Tax preference classification for GSTR-1 Table 8
    taxPreference: {
      type: String,
      enum: ['TAXABLE', 'NIL', 'EXEMPT', 'NON_GST'],
      default: 'TAXABLE'
    },
    cgstRate: { type: Number, default: 0 },
    sgstRate: { type: Number, default: 0 },
    igstRate: { type: Number, default: 0 },
    cgstAmount: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      // Automatically trim whitespace from invoice number
      set: (v) => (v ? String(v).trim() : '')
    },
    documentType: {
      type: String,
      enum: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'],
      default: 'INVOICE',
      index: true
    },
    originalInvoiceNumber: {
      type: String,
      trim: true,
      default: ''
    },
    originalInvoiceDate: {
      type: Date,
      default: null
    },
    noteReason: {
      type: String,
      trim: true,
      default: ''
    },
    invoiceDate: {
      type: Date,
      required: true,
      default: Date.now
    },
    dueDate: {
      type: Date
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null
    },
    customerName: {
      type: String,
      required: true,
      trim: true
    },
    // Normalize customer GSTIN to 15 uppercase characters
    customerGstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
      set: function (v) {
        if (typeof v !== 'string') return '';
        const cleaned = v.trim().toUpperCase();
        // Return empty string if invalid format (prevents garbage data)
        if (!cleaned || cleaned.length < 15) return '';
        return cleaned;
      }
    },
    // Extract 2-digit state code for Place of Supply
    placeOfSupply: {
      type: String,
      required: true,
      trim: true,
      set: function (v) {
        if (!v) return '00';
        const str = String(v).trim();
        // Extract first 2 digits if present (e.g., "06-HARYANA" -> "06")
        const match = str.match(/^([0-9]{2})/);
        if (match) return match[1];
        // If only 2 chars, return as-is (uppercase)
        if (str.length === 2 && /^[0-9]{2}$/.test(str)) return str;
        // Fallback for invalid input
        return '00';
      }
    },
    // Reverse Charge Mechanism flag for Table 4 / Table 9B
    isReverseCharge: {
      type: Boolean,
      default: false
    },
    // Export classification flags for Table 6A
    isExport: {
      type: Boolean,
      default: false
    },
    exportType: {
      type: String,
      enum: ['WPAY', 'WOPAY', ''], // With Payment / Without Payment
      default: ''
    },
    billingAddress: {
      street: { type: String, default: '', trim: true },
      city: { type: String, default: '', trim: true },
      state: { type: String, default: '', trim: true },
      stateCode: {
        type: String,
        default: '',
        trim: true,
        set: (v) => (v ? String(v).trim().slice(0, 2) : '')
      },
      pincode: {
        type: String,
        default: '',
        trim: true,
        set: (v) => (v ? String(v).trim().slice(0, 6) : '')
      },
      country: { type: String, default: 'India', trim: true }
    },
    lineItems: [invoiceLineItemSchema],
    subTotal: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    totalCgst: { type: Number, min: 0, default: 0 },
    totalSgst: { type: Number, min: 0, default: 0 },
    totalIgst: { type: Number, min: 0, default: 0 },
    totalTax: { type: Number, min: 0, default: 0 },
    grandTotal: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    status: {
      type: String,
      enum: ['Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled'],
      default: 'Draft',
      index: true
    },

    // --- E-Invoice (IRN) fields ---
    irn: { type: String, trim: true, default: '', index: true },
    ackNo: { type: String, trim: true, default: '' },
    ackDate: { type: Date, default: null },
    signedInvoice: { type: String, default: '' },
    signedQrCode: { type: String, default: '' },
    qrCodeImage: { type: String, default: '' },
    einvoiceStatus: {
      type: String,
      enum: ['Not Generated', 'Generated', 'Cancelled', 'Failed'],
      default: 'Not Generated',
      index: true
    },
    einvoiceError: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    cancelRemarks: { type: String, default: '' },
    cancelledAt: { type: Date, default: null },

    // --- E-Way Bill fields ---
    ewayBillNo: { type: String, trim: true, default: '', index: true },
    ewayBillDate: { type: Date, default: null },
    ewayBillValidUpto: { type: Date, default: null },
    transporterId: { type: String, trim: true, default: '' },
    transporterName: { type: String, trim: true, default: '' },
    vehicleNo: { type: String, trim: true, default: '' },
    transportMode: { type: String, default: '1' },

    notes: { type: String, trim: true, default: 'Thanks for your business.' },
    terms: { type: String, trim: true, default: 'Payment due upon receipt.' }
  },
  { timestamps: true }
);

// ✅ Virtual property for quick status checks in JS
invoiceSchema.virtual('isCancelled').get(function () {
  return this.status === 'Cancelled';
});
invoiceSchema.set('toJSON', { virtuals: true });
invoiceSchema.set('toObject', { virtuals: true });

// --- INDEXES ---
// ✅ Compound unique index: prevents clashes between Invoice "001" and Credit Note "001"
invoiceSchema.index(
  { workspaceId: 1, documentType: 1, invoiceNumber: 1 },
  { unique: true, name: 'idx_workspace_doctype_invnum' }
);

// Performance indexes for listing and filtering
invoiceSchema.index({ workspaceId: 1, invoiceDate: -1 });
invoiceSchema.index({ workspaceId: 1, status: 1 });
invoiceSchema.index({ workspaceId: 1, einvoiceStatus: 1 });
invoiceSchema.index({ workspaceId: 1, customerId: 1 });

// ✅ Specialized Compound Index for Lightning-Fast GSTR-1/3B Preparation
// This exact index matches the query in Gstr1Service.preparePayload
invoiceSchema.index(
  { workspaceId: 1, invoiceDate: 1, status: 1, documentType: 1 },
  { name: 'idx_gstr_return_preparation' }
);

// ✅ Index for B2B GSTIN-based queries (reconciliation, search)
invoiceSchema.index({ customerGstin: 1 });

// ✅ Index for place of supply queries (inter-state vs intra-state)
invoiceSchema.index({ placeOfSupply: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);