const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    gstin: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    action: {
      type: String,
      required: true,
      trim: true // e.g. 'SEARCH_GSTIN', 'OTP_REQUEST', 'OTP_VERIFY', 'FETCH_RETURN', 'LOGOUT'
    },
    period: {
      type: String,
      default: null,
      trim: true
    },
    status: {
      type: String,
      required: true,
      enum: ['SUCCESS', 'FAILURE']
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: false }
);

auditLogSchema.index({ gstin: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
