const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
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
    gstTokenEnc: {
      type: String,
      required: true
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
