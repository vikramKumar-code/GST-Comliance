const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },
    userEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true
    },
    userName: {
      type: String,
      trim: true,
      default: ''
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    workspaceName: {
      type: String,
      trim: true,
      default: ''
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    planId: {
      type: String,
      required: true,
      enum: ['FREE', 'PRO', 'ENTERPRISE'],
      uppercase: true
    },
    planName: {
      type: String,
      required: true
    },
    billingCycle: {
      type: String,
      enum: ['MONTHLY', 'YEARLY'],
      default: 'MONTHLY'
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true
    },
    razorpayOrderId: {
      type: String,
      required: true,
      index: true
    },
    razorpayPaymentId: {
      type: String,
      required: true,
      index: true
    },
    razorpaySignature: {
      type: String,
      default: null
    },
    paymentMethod: {
      type: String,
      enum: ['UPI', 'CARD', 'NETBANKING', 'WALLET', 'OFFLINE'],
      default: 'UPI'
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'PENDING', 'FAILED', 'REFUNDED'],
      default: 'SUCCESS',
      index: true
    },
    receiptNumber: {
      type: String,
      unique: true,
      sparse: true
    },
    settlementStatus: {
      type: String,
      enum: ['SETTLED_TO_BANK', 'PENDING_SETTLEMENT', 'PROCESSING'],
      default: 'SETTLED_TO_BANK',
      index: true
    },
    bankSettlement: {
      settlementId: { type: String },
      utr: { type: String },
      bankAccount: { type: String, default: 'HDFC Bank - Current A/C **8492' },
      grossAmount: { type: Number },
      gatewayFee: { type: Number, default: 0 },
      tax: { type: Number, default: 0 },
      netWithdrawnToBank: { type: Number },
      settledAt: { type: Date }
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ userEmail: 1, createdAt: -1 });
paymentSchema.index({ workspaceId: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
