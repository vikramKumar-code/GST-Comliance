const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: null
    },
    username: {
      type: String,
      trim: true,
      default: null
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkspaceMember',
      default: null
    },
    gstTokenEnc: {
      type: String,
      default: null
    },
    authType: {
      type: String,
      enum: ['USER_AUTH', 'GSTIN_OTP'],
      default: 'GSTIN_OTP'
    },
    expiresAt: {
      type: Date,
      required: true
    }
  },
  { timestamps: true }
);

// TTL index to automatically remove document after expiresAt
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Helper to check expiration immediately in application logic
sessionSchema.methods.isExpired = function () {
  return new Date() > this.expiresAt;
};

module.exports = mongoose.model('Session', sessionSchema);
