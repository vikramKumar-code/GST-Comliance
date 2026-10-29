const mongoose = require('mongoose');

const filingSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    gstin: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true
    },
    type: {
      type: String,
      required: true,
      enum: ['GSTR1', 'GSTR2B', 'GSTR3B'],
      uppercase: true
    },
    period: {
      type: String,
      required: true,
      trim: true // e.g. '102026'
    },
    arn: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    status: {
      type: String,
      required: true,
      default: 'Filed'
    },
    mode: {
      type: String,
      required: true,
      default: 'NIL_ONLINE' // 'ONLINE', 'NIL_ONLINE', 'NIL_EVC'
    },
    isNil: {
      type: Boolean,
      default: true
    },
    filingDate: {
      type: Date,
      default: Date.now
    },
    dateStr: {
      type: String, // e.g. '29/10/2026'
      default: ''
    },
    declarationAccepted: {
      type: Boolean,
      default: true
    },
    summary: {
      taxable: { type: Number, default: 0 },
      igst: { type: Number, default: 0 },
      cgst: { type: Number, default: 0 },
      sgst: { type: Number, default: 0 },
      cess: { type: Number, default: 0 },
      totalTax: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

filingSchema.index({ workspaceId: 1, type: 1, period: 1 }, { unique: true });
filingSchema.index({ gstin: 1, period: -1 });

module.exports = mongoose.model('Filing', filingSchema);
