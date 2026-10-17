const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema(
  {
    gstin: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    type: {
      type: String,
      required: true,
      enum: ['GSTR1', 'GSTR2B', 'GSTR3B']
    },
    period: {
      type: String,
      required: true,
      trim: true // e.g., '092026'
    },
    dataEnc: {
      type: String,
      required: true // AES-256-GCM encrypted ReturnData
    },
    fetchedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// Compound unique index ensuring one record per GSTIN + Return Type + Period
returnSchema.index({ gstin: 1, type: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('Return', returnSchema);
