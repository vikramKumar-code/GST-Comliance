const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: 'My Organization'
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED'],
      default: 'ACTIVE',
      required: true
    },
    subscription: {
      plan: {
        type: String,
        enum: ['FREE', 'PRO', 'ENTERPRISE'],
        default: 'FREE'
      },
      status: {
        type: String,
        enum: ['ACTIVE', 'TRIAL', 'EXPIRED', 'CANCELLED'],
        default: 'TRIAL'
      },
      billingCycle: {
        type: String,
        enum: ['MONTHLY', 'YEARLY'],
        default: 'MONTHLY'
      },
      validUntil: {
        type: Date,
        default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      },
      paymentProvider: {
        type: String,
        default: 'RAZORPAY'
      },
      paymentId: {
        type: String,
        default: ''
      },
      orderId: {
        type: String,
        default: ''
      }
    }
  },
  { timestamps: true }
);

workspaceSchema.index(
  { gstin: 1 },
  {
    unique: true,
    partialFilterExpression: { gstin: { $type: 'string' } }
  }
);

module.exports = mongoose.model('Workspace', workspaceSchema);

