const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      // ✅ FIX 1: Multi-tenancy strict enforcement
      required: true,
      index: true
    },
    gstin: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true
    },
    type: {
      type: String,
      required: true,
      // ✅ FIX 2: Added GSTR2A and GSTR4 for future-proofing
      enum: ['GSTR1', 'GSTR2A', 'GSTR2B', 'GSTR3B', 'GSTR4'],
      uppercase: true
    },
    period: {
      type: String,
      required: true,
      trim: true,
      // ✅ FIX 3: Strict MMYYYY format validation (e.g., '102026')
      match: [
        /^(0[1-9]|1[0-2])(19|20)\d{2}$/,
        'Return period must be in MMYYYY format (e.g., 102026)'
      ]
    },
    dataEnc: {
      type: String,
      required: true // AES-256-GCM encrypted ReturnData
    },
    fetchedAt: {
      type: Date,
      default: Date.now
    },
    // ✅ FIX 4: Track data size to monitor 16MB limit warnings
    dataSizeBytes: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

// Compound unique index ensuring one record per GSTIN + Return Type + Period
returnSchema.index({ gstin: 1, type: 1, period: 1 }, { unique: true });

// Fast dashboard queries for a specific workspace
returnSchema.index({ workspaceId: 1, type: 1, period: -1 });

module.exports = mongoose.model('Return', returnSchema);