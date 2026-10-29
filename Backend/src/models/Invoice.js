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
      default: ''
    },
    unit: {
      type: String,
      trim: true,
      default: 'PCS'
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
      trim: true
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
    customerGstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    placeOfSupply: {
      type: String,
      required: true,
      trim: true
    },
    billingAddress: {
      street: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      stateCode: { type: String, default: '' },
      pincode: { type: String, default: '' },
      country: { type: String, default: 'India' }
    },
    lineItems: [invoiceLineItemSchema],
    subTotal: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    totalCgst: {
      type: Number,
      min: 0,
      default: 0
    },
    totalSgst: {
      type: Number,
      min: 0,
      default: 0
    },
    totalIgst: {
      type: Number,
      min: 0,
      default: 0
    },
    totalTax: {
      type: Number,
      min: 0,
      default: 0
    },
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
    // E-Invoice (IRN) fields
    irn: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    ackNo: {
      type: String,
      trim: true,
      default: ''
    },
    ackDate: {
      type: Date,
      default: null
    },
    signedInvoice: {
      type: String,
      default: ''
    },
    signedQrCode: {
      type: String,
      default: ''
    },
    qrCodeImage: {
      type: String,
      default: ''
    },
    einvoiceStatus: {
      type: String,
      enum: ['Not Generated', 'Generated', 'Cancelled', 'Failed'],
      default: 'Not Generated',
      index: true
    },
    einvoiceError: {
      type: String,
      default: ''
    },
    cancelReason: {
      type: String,
      default: ''
    },
    cancelRemarks: {
      type: String,
      default: ''
    },
    cancelledAt: {
      type: Date,
      default: null
    },
    // E-Way Bill fields
    ewayBillNo: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    ewayBillDate: {
      type: Date,
      default: null
    },
    ewayBillValidUpto: {
      type: Date,
      default: null
    },
    transporterId: {
      type: String,
      trim: true,
      default: ''
    },
    transporterName: {
      type: String,
      trim: true,
      default: ''
    },
    vehicleNo: {
      type: String,
      trim: true,
      default: ''
    },
    transportMode: {
      type: String,
      default: '1'
    },
    notes: {
      type: String,
      trim: true,
      default: 'Thanks for your business.'
    },
    terms: {
      type: String,
      trim: true,
      default: 'Payment due upon receipt.'
    }
  },
  { timestamps: true }
);

invoiceSchema.index({ workspaceId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ workspaceId: 1, invoiceDate: -1 });
invoiceSchema.index({ workspaceId: 1, status: 1 });
invoiceSchema.index({ workspaceId: 1, einvoiceStatus: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
