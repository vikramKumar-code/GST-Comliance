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
      trim: true
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
      max: 3
    },
    expiresAt: {
      type: Date,
      required: true
    }
  },
  { timestamps: true }
);

// TTL index to automatically purge expired OTP states
otpStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpStateSchema.index({ gstin: 1, username: 1 });

otpStateSchema.methods.isExpired = function () {
  return new Date() > this.expiresAt;
};

module.exports = mongoose.model('OtpState', otpStateSchema);
