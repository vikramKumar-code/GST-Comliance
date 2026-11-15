const mongoose = require('mongoose');

const filingSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
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
      enum: ['GSTR1', 'GSTR2B', 'GSTR3B'],
      uppercase: true
    },
    period: {
      type: String,
      required: true,
      trim: true,
      match: [/^(0[1-9]|1[0-2])\d{4}$/, 'Period must be in MMYYYY format']
    },
    // ✅ FIX 1: ARN optional for draft/pending filings
    arn: {
      type: String,
      trim: true,
      sparse: true, // Only index non-null values
      unique: true
    },
    // ✅ FIX 4: Status enum with proper values
    status: {
      type: String,
      required: true,
      enum: ['Draft', 'Saved', 'ReadyToEVC', 'Filed', 'Failed', 'Pending'],
      default: 'Draft',
      index: true
    },
    // ✅ FIX 3: Mode enum defined
    mode: {
      type: String,
      enum: ['EVC', 'DSC', 'NIL_EVC', 'NIL_DSC', 'ONLINE'],
      default: 'EVC'
    },
    // ✅ FIX 2: isNil default false (most returns are regular, not nil)
    isNil: {
      type: Boolean,
      default: false
    },
    filingDate: {
      type: Date,
      default: Date.now
    },
    dateStr: {
      type: String,
      default: '',
      trim: true
    },
    declarationAccepted: {
      type: Boolean,
      default: false // User ko explicitly accept karna chahiye
    },
    // ✅ FIX 5: Track who filed the return
    filedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // ✅ FIX 6: Error tracking for failed filings
    errorLog: {
      errorCode: { type: String, default: null },
      errorMessage: { type: String, default: null },
      failedAt: { type: Date, default: null }
    },
    // ✅ FIX 7: Offset details for GSTR-3B
    offsetDetails: {
      offsetId: { type: String, default: null },
      offsetDate: { type: Date, default: null },
      cashPaid: { type: Number, default: 0 },
      itcUsed: { type: Number, default: 0 }
    },
    summary: {
      taxable: { type: Number, default: 0 },
      igst: { type: Number, default: 0 },
      cgst: { type: Number, default: 0 },
      sgst: { type: Number, default: 0 },
      cess: { type: Number, default: 0 },
      totalTax: { type: Number, default: 0 }
    },
    // ✅ FIX 8: Portal reference ID from RETSAVE
    referenceId: {
      type: String,
      default: null,
      trim: true
    },
    // ✅ FIX 8b: Payload hash & excluded invoice IDs for prepare-filing drift detection
    payloadHash: {
      type: String,
      default: null,
      trim: true
    },
    excludedInvoiceIds: {
      type: [String],
      default: []
    },
    // ✅ FIX 9: Signed invoice URL (for e-invoice integration)
    signedInvoiceUrl: {
      type: String,
      default: null,
      trim: true
    }
  },
  { timestamps: true }
);

// Unique compound index: same return type + period can only be filed once per workspace
filingSchema.index({ workspaceId: 1, type: 1, period: 1 }, { unique: true });

// Fast queries for dashboard: "Show all filings for this GSTIN"
filingSchema.index({ gstin: 1, period: -1 });

// Fast queries for: "Show all failed filings"
filingSchema.index({ workspaceId: 1, status: 1, filingDate: -1 });

// Fast queries for: "Show all filings by this user"
filingSchema.index({ filedBy: 1, filingDate: -1 });

module.exports = mongoose.model('Filing', filingSchema);