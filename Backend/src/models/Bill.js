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
    notes: {
      type: String,
      trim: true,
      default: ''
    }
  },
  { timestamps: true }
);

billSchema.index({ workspaceId: 1, billNumber: 1 });
billSchema.index({ workspaceId: 1, billDate: -1 });

module.exports = mongoose.model('Bill', billSchema);
