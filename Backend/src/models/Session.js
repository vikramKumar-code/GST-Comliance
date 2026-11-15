const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true // ✅ FIX 1: Fast lookup/deletion by User
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true // ✅ FIX 1: Fast lookup/deletion by GSTIN
    },
    username: {
      type: String,
      trim: true,
      default: null
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null,
      index: true // ✅ FIX 1: Fast lookup by Workspace
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkspaceMember',
      default: null
    },
    gstTokenEnc: {
      type: String,
      default: null
      // Note: Ensure your crypto.js utility stores IV and AuthTag along with the encrypted string
    },
    authType: {
      type: String,
      enum: ['USER_AUTH', 'GSTIN_OTP'],
      default: 'GSTIN_OTP',
      index: true
    },

    // ✅ FIX 2: Security & Audit Tracking
    ipAddress: {
      type: String,
      trim: true,
      default: null
    },
    userAgent: {
      type: String,
      trim: true,
      default: null
    },

    // ✅ FIX 3: Track last activity for sliding window expiration
    lastActiveAt: {
      type: Date,
      default: Date.now
    },

    expiresAt: {
      type: Date,
      required: true,
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