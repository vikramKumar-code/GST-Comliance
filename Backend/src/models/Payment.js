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

    // ✅ FIX 4: Link to active subscription
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
      index: true
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
      enum: ['MONTHLY', 'YEARLY', 'LIFETIME'],
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

    // ✅ FIX 1: Gateway Agnostic + Idempotency
    gatewayProvider: {
      type: String,
      enum: ['RAZORPAY', 'STRIPE', 'CASHFREE', 'OFFLINE', 'MANUAL'],
      default: 'RAZORPAY',
      uppercase: true
    },

    // Order ID is created BEFORE payment (required)
    gatewayOrderId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    // Payment ID is generated AFTER successful payment (optional but unique)
    gatewayPaymentId: {
      type: String,
      trim: true,
      unique: true, // ✅ Prevents duplicate webhook processing
      sparse: true,  // Allows null/undefined for pending orders
      index: true
    },
    gatewaySignature: {
      type: String,
      default: null
    },

    // Legacy fields (kept for backward compatibility, map to gatewayOrderId/PaymentId)
    razorpayOrderId: { type: String, default: function () { return this.gatewayOrderId; } },
    razorpayPaymentId: { type: String, default: function () { return this.gatewayPaymentId; } },
    razorpaySignature: { type: String, default: function () { return this.gatewaySignature; } },

    paymentMethod: {
      type: String,
      enum: ['UPI', 'CARD', 'NETBANKING', 'WALLET', 'OFFLINE', 'NEFT/RTGS'],
      default: 'UPI'
    },
    status: {
      type: String,
      enum: ['CREATED', 'SUCCESS', 'PENDING', 'FAILED', 'REFUNDED', 'EXPIRED'],
      default: 'CREATED',
      index: true
    },

    receiptNumber: {
      type: String,
      unique: true,
      sparse: true,
      trim: true
    },

    // B2B Compliance: Tax Invoice Number
    taxInvoiceNumber: {
      type: String,
      default: null,
      trim: true
    },

    settlementStatus: {
      type: String,
      enum: ['SETTLED_TO_BANK', 'PENDING_SETTLEMENT', 'PROCESSING', 'NOT_APPLICABLE'],
      default: 'PENDING_SETTLEMENT',
      index: true
    },

    bankSettlement: {
      settlementId: { type: String, trim: true },
      utr: { type: String, trim: true },
      // ✅ FIX 3: Removed hardcoded default
      bankAccount: { type: String, trim: true },
      grossAmount: { type: Number },
      gatewayFee: { type: Number, default: 0 },
      gatewayTax: { type: Number, default: 0 }, // GST on gateway fees
      netWithdrawnToBank: { type: Number },
      settledAt: { type: Date }
    },

    // ✅ FIX 2: Refund Tracking
    refundDetails: {
      isRefunded: { type: Boolean, default: false },
      refundId: { type: String, trim: true },
      refundAmount: { type: Number, default: 0 },
      reason: { type: String, trim: true },
      refundedAt: { type: Date }
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

// Optimized Indexes for SaaS Dashboard
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ userEmail: 1, createdAt: -1 });
paymentSchema.index({ workspaceId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 }); // Fast query for "Failed Payments"

module.exports = mongoose.model('Payment', paymentSchema);