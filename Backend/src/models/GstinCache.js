const mongoose = require('mongoose');

const gstinCacheSchema = new mongoose.Schema(
  {
    gstin: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      // ✅ FIX 1: Strict GSTIN format validation
      match: [
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
        'Please provide a valid 15-character GSTIN'
      ]
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    expiresAt: {
      type: Date,
    },
    // ✅ FIX 2: Track cache hits for analytics (kaunsa vendor sabse zyada search hota hai)
    hitCount: {
      type: Number,
      default: 0
    },
    // ✅ FIX 3: Track data source for future multi-provider support
    source: {
      type: String,
      default: 'TAXPRO',
      trim: true,
      uppercase: true
    }
  },
  { timestamps: true }
);

// TTL index to automatically purge cached search records after expiresAt
gstinCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Application-level expiry check (useful before MongoDB's background thread deletes it)
gstinCacheSchema.methods.isExpired = function () {
  return new Date() > this.expiresAt;
};

// ✅ Helper method to increment hit count asynchronously
gstinCacheSchema.methods.recordHit = function () {
  this.hitCount += 1;
  // Fire and forget (doesn't block the main API response)
  return this.save().catch((err) => {
    console.warn('Failed to update GstinCache hitCount:', err.message);
  });
};


module.exports = mongoose.model('GstinCache', gstinCacheSchema);