const mongoose = require('mongoose');

const gstinCacheSchema = new mongoose.Schema(
  {
    gstin: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true
    }
  },
  { timestamps: true }
);

// TTL index to automatically purge cached search records after expiresAt
gstinCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

gstinCacheSchema.methods.isExpired = function () {
  return new Date() > this.expiresAt;
};

module.exports = mongoose.model('GstinCache', gstinCacheSchema);
