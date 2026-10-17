const mongoose = require('mongoose');

const consentSchema = new mongoose.Schema(
  {
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

module.exports = mongoose.model('Consent', consentSchema);
