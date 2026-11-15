const mongoose = require('mongoose');

const otpStateSchema = new mongoose.Schema(
  {
    gstin: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true // GST usernames are generally case-insensitive
    },
    // ✅ FIX 1: Track the purpose of the OTP
    type: {
      type: String,
      enum: ['PORTAL_LOGIN', 'EVC_FILING', 'PAN_EVC'],
      default: 'PORTAL_LOGIN'
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0
      // ✅ FIX 2: Removed 'max: 3'. Let the service layer handle blocking logic 
      // to avoid Mongoose Validation crashes during edge cases.
    },
    // ✅ FIX 3: Track last sent time to enforce cooldowns (e.g., "Wait 30 seconds before requesting again")
    lastSentAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      required: true
    }
  },
  { timestamps: true }
);

// TTL index to automatically purge expired OTP states (Database level cleanup)
otpStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ✅ FIX 4: UNIQUE Compound Index to prevent race conditions on concurrent OTP requests
otpStateSchema.index(
  { gstin: 1, username: 1, type: 1 },
  { unique: true }
);

otpStateSchema.methods.isExpired = function () {
  return new Date() > this.expiresAt;
};

module.exports = mongoose.model('OtpState', otpStateSchema);