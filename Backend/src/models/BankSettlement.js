const mongoose = require('mongoose');

const bankSettlementSchema = new mongoose.Schema(
  {
    // ✅ FIX 1: Multi-tenancy ke liye workspaceId add kiya
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    settlementId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },
    utr: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },
    // ✅ FIX 2: Hardcoded defaults hata diye, taaki dynamic bank details save ho sakein
    bankName: {
      type: String,
      required: true,
      trim: true
    },
    accountMasked: {
      type: String,
      required: true,
      trim: true
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
      enum: ['SETTLED', 'PROCESSING', 'FAILED', 'REVERSED'], // 'REVERSED' add kiya chargebacks ke liye
      default: 'PROCESSING',
      index: true
    },
    settledAt: {
      type: Date,
      default: Date.now,
      index: true // Yahan index lagana kaafi hai
    },
    transactionCount: {
      type: Number,
      default: 1,
      min: 0
    },
    notes: {
      type: String,
      default: 'Automated Payment Gateway Batch Payout to Linked Business Current Account',
      trim: true
    },
    // Gateway ka raw response future reference/debugging ke liye
    rawResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  {
    timestamps: true // createdAt aur updatedAt automatically add honge
  }
);

// ✅ FIX 3: Compound index for fast dashboard queries (Workspace ke hisaab se latest settlements)
bankSettlementSchema.index({ workspaceId: 1, settledAt: -1 });
bankSettlementSchema.index({ workspaceId: 1, status: 1 });

module.exports = mongoose.model('BankSettlement', bankSettlementSchema);