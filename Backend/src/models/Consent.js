const mongoose = require('mongoose');

const consentSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null,
      index: true
    },
    gstin: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    purpose: {
      type: String,
      required: true,
      default: 'GST return fetch and compliance view'
    },
    grantedAt: {
      type: Date,
      default: Date.now
    },
    ip: {
      type: String,
      default: null
    },
    userAgent: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

consentSchema.index({ gstin: 1, grantedAt: -1 });
consentSchema.index({ workspaceId: 1, grantedAt: -1 });

module.exports = mongoose.model('Consent', consentSchema);
