const mongoose = require('mongoose');

const consentSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null,
      index: true
    },
    // ✅ FIX 1: Track exactly which user gave the consent
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    gstin: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true
    },
    purpose: {
      type: String,
      required: true,
      default: 'GST return fetch, ITC reconciliation, and compliance filing',
      trim: true
    },
    // ✅ FIX 4: Track which version of consent text was accepted
    consentVersion: {
      type: String,
      default: 'v1.0',
      trim: true
    },
    // ✅ FIX 2: Track consent lifecycle (Granted -> Revoked/Expired)
    status: {
      type: String,
      enum: ['ACTIVE', 'REVOKED', 'EXPIRED'],
      default: 'ACTIVE',
      index: true
    },
    grantedAt: {
      type: Date,
      default: Date.now
    },
    revokedAt: {
      type: Date,
      default: null
    },
    // ✅ FIX 3: Consent validity period (default: 1 year)
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      index: true
    },
    ip: {
      type: String,
      default: null,
      trim: true
    },
    userAgent: {
      type: String,
      default: null,
      trim: true
    }
  },
  { timestamps: true }
);

// Optimized compound indexes for fast compliance queries
consentSchema.index({ gstin: 1, status: 1, grantedAt: -1 });
consentSchema.index({ workspaceId: 1, status: 1, grantedAt: -1 });
consentSchema.index({ userId: 1, grantedAt: -1 });

module.exports = mongoose.model('Consent', consentSchema);