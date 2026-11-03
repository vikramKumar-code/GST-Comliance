const mongoose = require('mongoose');

const bankSettlementSchema = new mongoose.Schema(
  {
    settlementId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    utr: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    bankName: {
      type: String,
      default: 'HDFC Bank Ltd'
    },
    accountMasked: {
      type: String,
      default: 'Current A/C Ending in **8492'
    },
    grossAmount: {
      type: Number,
      required: true,
      min: 0
    },
    gatewayFees: {
      type: Number,
      default: 0,
      min: 0
    },
    taxOnFees: {
      type: Number,
      default: 0,
      min: 0
    },
    netAmount: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ['SETTLED', 'PROCESSING', 'FAILED'],
      default: 'SETTLED',
      index: true
    },
    settledAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    transactionCount: {
      type: Number,
      default: 1
    },
    notes: {
      type: String,
      default: 'Automated Razorpay T+2 Batch Payout to Linked Business Current Account'
    }
  },
  {
    timestamps: true
  }
);

bankSettlementSchema.index({ settledAt: -1 });

module.exports = mongoose.model('BankSettlement', bankSettlementSchema);
