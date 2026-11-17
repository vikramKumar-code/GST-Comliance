const mongoose = require('mongoose');

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const GSTIN_REGEX =
  /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}[Zz1-9A-Ja-j]{1}[0-9A-Za-z]{1}$/;

// Strict MMYYYY with plausible century.
const PERIOD_REGEX = /^(0[1-9]|1[0-2])(19|20)\d{2}$/;

// SHA-256 hex produced by crypto.createHash('sha256').digest('hex')
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

const PORTAL_STATUS_MAP = {
  P: 'P',
  PE: 'PE',
  ER: 'ER',
  IP: 'IP',
  PROCESSED: 'P',
  PROCESSED_WITH_ERRORS: 'PE',
  ERROR: 'ER',
  IN_PROGRESS: 'IP',
  'IN-PROGRESS': 'IP'
};

const REFERENCE_REQUIRED_STATUSES = new Set([
  'Saved',
  'ReadyToEVC',
  'Submitted'
]);

const SUMMARY_FIELDS = [
  'taxable',
  'igst',
  'cgst',
  'sgst',
  'cess',
  'totalTax',
  'rcmTax',
  'eligibleItc',
  'netCashPayable'
];

const BASIC_MODES = new Set(['EVC', 'DSC', 'ONLINE']);

const MAX_LEN = {
  arn: 64,
  referenceId: 128,
  providerRef: 128,
  idempotencyKey: 128,
  payloadHash: 64,
  notes: 2000,
  userAgent: 512,
  signedInvoiceUrl: 2048,
  lastRequestIp: 45,
  lockedBy: 128,
  errorMessage: 1000,
  errorCode: 64,
  errorCd: 64
};

/* -------------------------------------------------------------------------- */
/* Normalizers                                                                */
/* -------------------------------------------------------------------------- */

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function normalizeUpperString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim().toUpperCase();
  return str.length ? str : null;
}

function normalizeStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;

  const upper = raw.toUpperCase();

  const map = {
    DRAFT: 'Draft',
    SAVED: 'Saved',
    INPROGRESS: 'InProgress',
    'IN-PROGRESS': 'InProgress',
    PROCESSING: 'InProgress',
    READYTOEVC: 'ReadyToEVC',
    READY_TO_EVC: 'ReadyToEVC',
    SUBMITTED: 'Submitted',
    FILED: 'Filed',
    FAILED: 'Failed',
    PENDING: 'Pending',
    CANCELLED: 'Cancelled',
    CANCELED: 'Cancelled'
  };

  return map[upper] || raw;
}

function normalizeMode(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;

  const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');

  const map = {
    EVC: 'EVC',
    DSC: 'DSC',
    ONLINE: 'ONLINE',
    NILEVC: 'NIL_EVC',
    NIL_EVC: 'NIL_EVC',
    NILDSC: 'NIL_DSC',
    NIL_DSC: 'NIL_DSC',
    NILONLINE: 'NIL_ONLINE',
    NIL_ONLINE: 'NIL_ONLINE'
  };

  return map[upper] || raw;
}

function normalizePortalStatus(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;
  return PORTAL_STATUS_MAP[raw] || null;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function normalizeStringArray(value) {
  if (value === undefined || value === null) return [];

  let arr = [];

  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === 'string') {
    arr = value.split(',');
  } else {
    arr = [value];
  }

  const seen = new Set();
  const out = [];

  for (const item of arr) {
    const s = String(item ?? '').trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }

  return out;
}

function normalizeSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const out = {};

  for (const field of SUMMARY_FIELDS) {
    out[field] = round2(value[field]);
  }

  return out;
}

function normalizeOffsetDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      offsetId: null,
      offsetDate: null,
      cashPaid: 0,
      itcUsed: 0
    };
  }

  const out = {
    offsetId: normalizeOptionalString(value.offsetId),
    offsetDate: value.offsetDate ? new Date(value.offsetDate) : null,
    cashPaid: round2(value.cashPaid),
    itcUsed: round2(value.itcUsed)
  };

  if (out.offsetDate && Number.isNaN(out.offsetDate.getTime())) {
    out.offsetDate = null;
  }

  return out;
}

function normalizeErrorLog(value, status) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};

  const out = {
    errorCode: normalizeOptionalString(source.errorCode),
    errorMessage: normalizeOptionalString(source.errorMessage),
    errorCd: normalizeOptionalString(source.errorCd),
    failedAt: source.failedAt ? new Date(source.failedAt) : null
  };

  if (out.failedAt && Number.isNaN(out.failedAt.getTime())) {
    out.failedAt = null;
  }

  const hasError = Boolean(out.errorCode || out.errorMessage || out.errorCd);

  if (!out.failedAt && (hasError || status === 'Failed')) {
    out.failedAt = new Date();
  }

  return out;
}

function normalizeProviderRefs(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};

  return {
    saveReferenceId: normalizeOptionalString(source.saveReferenceId),
    submitReferenceId: normalizeOptionalString(source.submitReferenceId),
    proceedReferenceId: normalizeOptionalString(source.proceedReferenceId),
    fileReferenceId: normalizeOptionalString(source.fileReferenceId)
  };
}

function formatIstDisplayDate(dateValue) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (!d || Number.isNaN(d.getTime())) return '';

  const tzOffsetMin = Number(process.env.GST_TZ_OFFSET_MIN || 330);
  const local = new Date(d.getTime() + tzOffsetMin * 60 * 1000);

  const day = String(local.getUTCDate()).padStart(2, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const year = local.getUTCFullYear();

  return `${day}/${month}/${year}`;
}

function normalizeNilMode(mode, isNil) {
  const normalized = normalizeMode(mode);

  if (!normalized) {
    return normalized;
  }

  if (isNil === true) {
    if (BASIC_MODES.has(normalized)) {
      return `NIL_${normalized}`;
    }
    return normalized;
  }

  if (isNil === false && normalized.startsWith('NIL_')) {
    return normalized.slice(4);
  }

  return normalized;
}

/* -------------------------------------------------------------------------- */
/* Update normalization                                                       */
/* -------------------------------------------------------------------------- */

function normalizeSetTarget(target, options = {}) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return;
  }

  const statusValue =
    target.status !== undefined
      ? normalizeStatus(target.status)
      : options.status;

  if (target.status !== undefined) {
    target.status = statusValue;
  }

  if (target.gstin !== undefined) {
    target.gstin = normalizeUpperString(target.gstin);
  }

  if (target.type !== undefined) {
    target.type = normalizeUpperString(target.type);
  }

  if (target.period !== undefined) {
    target.period = normalizeOptionalString(target.period) ?? target.period;
  }

  if (target.mode !== undefined) {
    target.mode = normalizeNilMode(target.mode, target.isNil);
  }

  if (target.isNil !== undefined) {
    target.isNil = Boolean(target.isNil);

    // If isNil becomes true/false and mode is already present, normalize again.
    if (target.mode !== undefined) {
      target.mode = normalizeNilMode(target.mode, target.isNil);
    }
  }

  if (target.declarationAccepted !== undefined) {
    target.declarationAccepted = Boolean(target.declarationAccepted);
  }

  if (target.arn !== undefined) {
    target.arn = normalizeOptionalString(target.arn);
  }

  if (target.referenceId !== undefined) {
    target.referenceId = normalizeOptionalString(target.referenceId);
  }

  if (target.payloadHash !== undefined) {
    const hash = normalizeOptionalString(target.payloadHash);
    target.payloadHash = hash ? hash.toLowerCase() : null;
  }

  if (target.idempotencyKey !== undefined) {
    target.idempotencyKey = normalizeOptionalString(target.idempotencyKey);
  }

  if (target.lockedBy !== undefined) {
    target.lockedBy = normalizeOptionalString(target.lockedBy);
  }

  if (target.lastRequestIp !== undefined) {
    target.lastRequestIp = normalizeOptionalString(target.lastRequestIp);
  }

  if (target.userAgent !== undefined) {
    target.userAgent = normalizeOptionalString(target.userAgent);
  }

  if (target.notes !== undefined) {
    target.notes = normalizeOptionalString(target.notes);
  }

  if (target.signedInvoiceUrl !== undefined) {
    target.signedInvoiceUrl = normalizeOptionalString(target.signedInvoiceUrl);
  }

  if (target.portalStatus !== undefined) {
    target.portalStatus = normalizePortalStatus(target.portalStatus);
  }

  if (target.excludedInvoiceIds !== undefined) {
    target.excludedInvoiceIds = normalizeStringArray(target.excludedInvoiceIds);
  }

  if (target.summary !== undefined) {
    target.summary = normalizeSummary(target.summary);
  }

  if (target.offsetDetails !== undefined) {
    target.offsetDetails = normalizeOffsetDetails(target.offsetDetails);
  }

  if (target.errorLog !== undefined) {
    target.errorLog = normalizeErrorLog(target.errorLog, statusValue);
  }

  if (target.providerRefs !== undefined) {
    target.providerRefs = normalizeProviderRefs(target.providerRefs);
  }

  // Support dotted update paths like "summary.taxable", "errorLog.errorMessage".
  for (const key of Object.keys(target)) {
    if (key.startsWith('summary.')) {
      const field = key.slice('summary.'.length);
      if (SUMMARY_FIELDS.includes(field)) {
        target[key] = round2(target[key]);
      }
    } else if (key.startsWith('errorLog.')) {
      const field = key.slice('errorLog.'.length);
      if (field === 'failedAt') {
        target[key] = target[key] ? new Date(target[key]) : null;
      } else {
        target[key] = normalizeOptionalString(target[key]);
      }
    } else if (key.startsWith('providerRefs.')) {
      target[key] = normalizeOptionalString(target[key]);
    } else if (key.startsWith('offsetDetails.')) {
      const field = key.slice('offsetDetails.'.length);
      if (field === 'cashPaid' || field === 'itcUsed') {
        target[key] = round2(target[key]);
      } else if (field === 'offsetDate') {
        target[key] = target[key] ? new Date(target[key]) : null;
      } else {
        target[key] = normalizeOptionalString(target[key]);
      }
    }
  }

  // Derived state defaults for regular $set updates.
  if (!options.isInsert) {
    if (statusValue === 'ReadyToEVC' && !('preparedAt' in target)) {
      target.preparedAt = new Date();
    }

    if (statusValue === 'Filed') {
      if (!('filingDate' in target)) {
        target.filingDate = new Date();
      }

      if (
        target.filingDate &&
        (!('dateStr' in target) || target.dateStr === null || target.dateStr === '')
      ) {
        target.dateStr = formatIstDisplayDate(target.filingDate);
      }

      // Filed is terminal; clear stale in-flight locks unless explicitly provided.
      if (!('lockedAt' in target)) target.lockedAt = null;
      if (!('lockedBy' in target)) target.lockedBy = null;
      if (!('lockExpiresAt' in target)) target.lockExpiresAt = null;
    }
  }

  // Reference id fallback from providerRefs.
  if (
    REFERENCE_REQUIRED_STATUSES.has(statusValue) &&
    !target.referenceId
  ) {
    if (target.providerRefs?.saveReferenceId) {
      target.referenceId = target.providerRefs.saveReferenceId;
    } else if (
      statusValue === 'Submitted' &&
      target.providerRefs?.submitReferenceId
    ) {
      target.referenceId = target.providerRefs.submitReferenceId;
    }
  }
}

function normalizeUpdate(update) {
  if (!update) return;

  // Aggregation pipeline update.
  if (Array.isArray(update)) {
    for (const stage of update) {
      if (!stage || typeof stage !== 'object') continue;

      if (stage.$set) {
        normalizeSetTarget(stage.$set);
      }

      if (stage.$setOnInsert) {
        normalizeSetTarget(stage.$setOnInsert, { isInsert: true });
      }
    }

    return;
  }

  if (typeof update !== 'object') return;

  const keys = Object.keys(update);
  const hasOperators = keys.some((k) => k.startsWith('$'));

  if (hasOperators) {
    if (update.$set) {
      normalizeSetTarget(update.$set);
    }

    if (update.$setOnInsert) {
      normalizeSetTarget(update.$setOnInsert, { isInsert: true });
    }

    return;
  }

  // Replacement-style update document.
  normalizeSetTarget(update);
}

function normalizeQueryUpdate(next) {
  normalizeUpdate(this.getUpdate());
  next();
}

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

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
      maxlength: 15,
      match: [GSTIN_REGEX, 'Invalid GSTIN format.'],
      set: normalizeUpperString,
      index: true
    },

    type: {
      type: String,
      required: true,
      maxlength: 10,
      enum: ['GSTR1', 'GSTR2B', 'GSTR3B'],
      set: normalizeUpperString
    },

    period: {
      type: String,
      required: true,
      maxlength: 6,
      match: [PERIOD_REGEX, 'Period must be in MMYYYY format'],
      set: (v) => normalizeOptionalString(v) ?? v
    },

    /**
     * ARN is only meaningful for confirmed filed returns.
     * Empty string is normalized to null so partial unique index does not conflict.
     */
    arn: {
      type: String,
      default: null,
      maxlength: MAX_LEN.arn,
      set: normalizeOptionalString,
      validate: {
        validator: function validateArnForFiled(value) {
          if (this.status !== 'Filed') return true;
          return typeof value === 'string' && value.trim().length > 0;
        },
        message: 'ARN is required when filing status is Filed.'
      }
    },

    status: {
      type: String,
      required: true,
      default: 'Draft',
      maxlength: 20,
      enum: [
        'Draft',
        'Saved',
        'InProgress',
        'ReadyToEVC',
        'Submitted',
        'Filed',
        'Failed',
        'Pending',
        'Cancelled'
      ],
      set: normalizeStatus,
      index: true,
      validate: {
        validator: function validateReferenceForIntermediateStates(value) {
          if (!REFERENCE_REQUIRED_STATUSES.has(value)) return true;

          return Boolean(
            this.referenceId ||
            this.providerRefs?.saveReferenceId ||
            (value === 'Submitted' && this.providerRefs?.submitReferenceId)
          );
        },
        message:
          'referenceId is required for Saved, ReadyToEVC, and Submitted filing states because GSTN Save/Submit responses require reference_id.'
      }
    },

    mode: {
      type: String,
      maxlength: 20,
      enum: [
        'EVC',
        'DSC',
        'ONLINE',
        'NIL_EVC',
        'NIL_DSC',
        'NIL_ONLINE'
      ],
      default: 'EVC',
      set: (v) => normalizeNilMode(v, this?.isNil)
    },

    isNil: {
      type: Boolean,
      default: false
    },

    filingDate: {
      type: Date,
      default: null
    },

    dateStr: {
      type: String,
      default: '',
      maxlength: 10,
      trim: true
    },

    declarationAccepted: {
      type: Boolean,
      default: false,
      validate: {
        validator: function validateDeclarationForFiled(value) {
          if (this.status !== 'Filed') return true;
          return value === true;
        },
        message:
          'Statutory declaration must be accepted before marking filing as Filed.'
      }
    },

    /**
     * Track who initiated/filed the return.
     * If your app uses Member instead of User, change ref accordingly.
     */
    filedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member',
      default: null
    },

    errorLog: {
      errorCode: {
        type: String,
        default: null,
        maxlength: MAX_LEN.errorCode,
        set: normalizeOptionalString
      },
      errorMessage: {
        type: String,
        default: null,
        maxlength: MAX_LEN.errorMessage,
        set: normalizeOptionalString
      },
      errorCd: {
        type: String,
        default: null,
        maxlength: MAX_LEN.errorCd,
        set: normalizeOptionalString
      },
      failedAt: {
        type: Date,
        default: null
      }
    },

    offsetDetails: {
      offsetId: {
        type: String,
        default: null,
        maxlength: MAX_LEN.referenceId,
        set: normalizeOptionalString
      },
      offsetDate: {
        type: Date,
        default: null
      },
      cashPaid: {
        type: Number,
        default: 0
      },
      itcUsed: {
        type: Number,
        default: 0
      }
    },

    /**
     * Filing summary snapshot.
     * Includes GSTR-3B specific fields used by return.controller.
     */
    summary: {
      taxable: { type: Number, default: 0 },
      igst: { type: Number, default: 0 },
      cgst: { type: Number, default: 0 },
      sgst: { type: Number, default: 0 },
      cess: { type: Number, default: 0 },
      totalTax: { type: Number, default: 0 },
      rcmTax: { type: Number, default: 0 },
      eligibleItc: { type: Number, default: 0 },
      netCashPayable: { type: Number, default: 0 }
    },

    /**
     * Latest GSTN/provider reference id.
     * GSTN Save/Submit response schemas require reference_id.
     */
    referenceId: {
      type: String,
      default: null,
      maxlength: MAX_LEN.referenceId,
      set: normalizeOptionalString
    },

    /**
     * Optional granular provider refs for debugging/audit.
     */
    providerRefs: {
      saveReferenceId: {
        type: String,
        default: null,
        maxlength: MAX_LEN.providerRef,
        set: normalizeOptionalString
      },
      submitReferenceId: {
        type: String,
        default: null,
        maxlength: MAX_LEN.providerRef,
        set: normalizeOptionalString
      },
      proceedReferenceId: {
        type: String,
        default: null,
        maxlength: MAX_LEN.providerRef,
        set: normalizeOptionalString
      },
      fileReferenceId: {
        type: String,
        default: null,
        maxlength: MAX_LEN.providerRef,
        set: normalizeOptionalString
      }
    },

    /**
     * GSTN RETSTATUS normalized value.
     */
    portalStatus: {
      type: String,
      default: null,
      maxlength: 2,
      enum: [null, 'P', 'PE', 'ER', 'IP'],
      set: normalizePortalStatus
    },

    /**
     * Prepare-filing drift detection.
     */
    payloadHash: {
      type: String,
      default: null,
      maxlength: MAX_LEN.payloadHash,
      set: (v) => {
        const s = normalizeOptionalString(v);
        return s ? s.toLowerCase() : null;
      },
      validate: [
        {
          validator: (v) => !v || SHA256_HEX_REGEX.test(v),
          message: 'payloadHash must be a valid SHA-256 hex string.'
        },
        {
          validator: function validatePayloadHashForReadyToEVC(v) {
            if (this.status !== 'ReadyToEVC') return true;
            return Boolean(v);
          },
          message:
            'payloadHash is required when filing status is ReadyToEVC.'
        }
      ]
    },

    excludedInvoiceIds: {
      type: [String],
      default: [],
      set: normalizeStringArray
    },

    preparedAt: {
      type: Date,
      default: null
    },

    /**
     * Lightweight in-DB lock/support for multi-instance safety.
     * For strong multi-instance locking, still prefer Redis/DB atomic transition.
     */
    lockedAt: {
      type: Date,
      default: null
    },

    lockedBy: {
      type: String,
      default: null,
      maxlength: MAX_LEN.lockedBy,
      set: normalizeOptionalString
    },

    lockExpiresAt: {
      type: Date,
      default: null
    },

    /**
     * Client/server idempotency key to avoid duplicate filing attempts.
     */
    idempotencyKey: {
      type: String,
      default: null,
      maxlength: MAX_LEN.idempotencyKey,
      set: normalizeOptionalString
    },

    signedInvoiceUrl: {
      type: String,
      default: null,
      maxlength: MAX_LEN.signedInvoiceUrl,
      set: normalizeOptionalString
    },

    /**
     * Useful for support/audit.
     */
    lastRequestIp: {
      type: String,
      default: null,
      maxlength: MAX_LEN.lastRequestIp,
      set: normalizeOptionalString
    },

    userAgent: {
      type: String,
      default: null,
      maxlength: MAX_LEN.userAgent,
      set: normalizeOptionalString
    },

    notes: {
      type: String,
      default: null,
      maxlength: MAX_LEN.notes,
      set: normalizeOptionalString
    }
  },
  {
    timestamps: true,
    strict: true
  }
);

/* -------------------------------------------------------------------------- */
/* Pre-validation normalization for save()                                    */
/* -------------------------------------------------------------------------- */

filingSchema.pre('validate', function normalizeBeforeValidate(next) {
  this.gstin = normalizeUpperString(this.gstin);
  this.type = normalizeUpperString(this.type);
  this.period = normalizeOptionalString(this.period) ?? this.period;
  this.status = normalizeStatus(this.status);
  this.mode = normalizeNilMode(this.mode, this.isNil);

  this.arn = normalizeOptionalString(this.arn);
  this.referenceId = normalizeOptionalString(this.referenceId);
  this.payloadHash = this.payloadHash
    ? String(this.payloadHash).trim().toLowerCase()
    : null;
  this.idempotencyKey = normalizeOptionalString(this.idempotencyKey);
  this.signedInvoiceUrl = normalizeOptionalString(this.signedInvoiceUrl);
  this.lockedBy = normalizeOptionalString(this.lockedBy);
  this.lastRequestIp = normalizeOptionalString(this.lastRequestIp);
  this.userAgent = normalizeOptionalString(this.userAgent);
  this.notes = normalizeOptionalString(this.notes);
  this.portalStatus = normalizePortalStatus(this.portalStatus);

  this.excludedInvoiceIds = normalizeStringArray(this.excludedInvoiceIds);
  this.summary = normalizeSummary(this.summary);
  this.offsetDetails = normalizeOffsetDetails(this.offsetDetails);
  this.errorLog = normalizeErrorLog(this.errorLog, this.status);
  this.providerRefs = normalizeProviderRefs(this.providerRefs);

  if (this.status === 'ReadyToEVC' && !this.preparedAt) {
    this.preparedAt = new Date();
  }

  if (this.status === 'Filed') {
    if (!this.filingDate) {
      this.filingDate = new Date();
    }

    // Keep display date synchronized with filingDate for terminal Filed records.
    this.dateStr = formatIstDisplayDate(this.filingDate);

    // Filed is terminal; clear stale locks.
    this.lockedAt = null;
    this.lockedBy = null;
    this.lockExpiresAt = null;
  }

  if (
    REFERENCE_REQUIRED_STATUSES.has(this.status) &&
    !this.referenceId
  ) {
    if (this.providerRefs?.saveReferenceId) {
      this.referenceId = this.providerRefs.saveReferenceId;
    } else if (
      this.status === 'Submitted' &&
      this.providerRefs?.submitReferenceId
    ) {
      this.referenceId = this.providerRefs.submitReferenceId;
    }
  }

  next();
});

/* -------------------------------------------------------------------------- */
/* Query update normalization                                                 */
/* -------------------------------------------------------------------------- */

filingSchema.pre('findOneAndUpdate', normalizeQueryUpdate);
filingSchema.pre('findByIdAndUpdate', normalizeQueryUpdate);
filingSchema.pre('updateOne', normalizeQueryUpdate);
filingSchema.pre('updateMany', normalizeQueryUpdate);

/* -------------------------------------------------------------------------- */
/* Indexes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Primary business uniqueness:
 * One filing record per workspace + return type + period.
 *
 * IMPORTANT:
 * If your Workspace can legitimately contain multiple GSTINs/branches,
 * change this to:
 * filingSchema.index({ workspaceId: 1, gstin: 1, type: 1, period: 1 }, { unique: true });
 * and update ALL Filing findOne/findOneAndUpdate filters to include gstin.
 */
filingSchema.index(
  { workspaceId: 1, type: 1, period: 1 },
  { unique: true, name: 'workspace_type_period_unique' }
);

/**
 * ARN uniqueness:
 * Only non-null string ARNs are indexed.
 * This avoids unique conflicts on draft/pending records where arn is null.
 *
 * Production GSTN ARNs are globally unique. If mock/test data reuses ARNs
 * across workspaces, either generate unique mock ARNs or change this to:
 * filingSchema.index({ workspaceId: 1, arn: 1 }, { unique: true, partialFilterExpression: { arn: { $type: 'string' } } });
 */
filingSchema.index(
  { arn: 1 },
  {
    unique: true,
    name: 'arn_unique',
    partialFilterExpression: {
      arn: { $type: 'string' }
    }
  }
);

/**
 * Idempotency key uniqueness:
 * Workspace-scoped, only when provided.
 *
 * This allows the same idempotency key in different workspaces,
 * but prevents replay within the same workspace.
 */
filingSchema.index(
  { workspaceId: 1, idempotencyKey: 1 },
  {
    unique: true,
    name: 'workspace_idempotency_key_unique',
    partialFilterExpression: {
      idempotencyKey: { $type: 'string' }
    }
  }
);

/**
 * Lookup by idempotency key alone for support/debug.
 * Non-unique.
 */
filingSchema.index(
  { idempotencyKey: 1 },
  {
    name: 'idempotency_key_lookup',
    partialFilterExpression: {
      idempotencyKey: { $type: 'string' }
    }
  }
);

/**
 * Dashboard/query helpers.
 */
filingSchema.index({ gstin: 1, period: -1 });
filingSchema.index({ workspaceId: 1, status: 1, updatedAt: -1 });
filingSchema.index({ workspaceId: 1, type: 1, status: 1 });
filingSchema.index({ workspaceId: 1, type: 1, period: 1, status: 1 });
filingSchema.index({ filedBy: 1, filingDate: -1 });
filingSchema.index({ memberId: 1, filingDate: -1 });
filingSchema.index({ status: 1, preparedAt: -1 });

/**
 * Stale lock cleanup/support.
 */
filingSchema.index({ status: 1, lockExpiresAt: 1 });
filingSchema.index({ lockedBy: 1, lockExpiresAt: 1 });

/* -------------------------------------------------------------------------- */
/* Static helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Atomic-ish guard for marking a filing as InProgress.
 *
 * Usage:
 * const locked = await Filing.acquireFilingLock({
 *   workspaceId,
 *   type,
 *   period,
 *   gstin,
 *   lockedBy: process.pid || requestId,
 *   ttlMs: 90000
 * });
 *
 * This does not replace Redis distributed lock, but gives DB-level protection
 * for single-instance or as a secondary guard.
 */
filingSchema.statics.acquireFilingLock = async function acquireFilingLock({
  workspaceId,
  type,
  period,
  gstin,
  lockedBy,
  ttlMs = 90000,
  allowReadyToEVC = true
}) {
  const now = new Date();
  const lockExpiresAt = new Date(now.getTime() + ttlMs);

  const blockedStatuses = ['Filed', 'Submitted'];
  if (!allowReadyToEVC) blockedStatuses.push('ReadyToEVC');

  const normalizedType = String(type || '').toUpperCase();
  const normalizedGstin = String(gstin || '').toUpperCase();
  const normalizedLockedBy = normalizeOptionalString(lockedBy);

  const filter = {
    workspaceId,
    type: normalizedType,
    period,
    status: { $nin: blockedStatuses },
    $or: [
      { lockExpiresAt: null },
      { lockExpiresAt: { $lt: now } },
      { lockedBy: normalizedLockedBy }
    ]
  };

  const update = {
    $set: {
      status: 'InProgress',
      lockedAt: now,
      lockedBy: normalizedLockedBy,
      lockExpiresAt,
      gstin: normalizedGstin
    },
    $setOnInsert: {
      workspaceId,
      type: normalizedType,
      period,
      gstin: normalizedGstin,
      status: 'InProgress'
    }
  };

  try {
    return await this.findOneAndUpdate(filter, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true
    });
  } catch (err) {
    // Concurrent upsert race on unique index.
    if (err?.code === 11000) {
      return null;
    }

    throw err;
  }
};

/**
 * Release lock after filing attempt finishes.
 */
filingSchema.statics.releaseFilingLock = async function releaseFilingLock({
  workspaceId,
  type,
  period,
  lockedBy
}) {
  return this.findOneAndUpdate(
    {
      workspaceId,
      type: String(type || '').toUpperCase(),
      period,
      lockedBy: normalizeOptionalString(lockedBy)
    },
    {
      $set: {
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null
      }
    },
    { new: true }
  );
};

/**
 * Convenience helper to persist ReadyToEVC state atomically.
 * Keeps controller code cleaner and ensures payloadHash/referenceId contract.
 */
filingSchema.statics.markReadyToEVC = async function markReadyToEVC({
  workspaceId,
  gstin,
  type,
  period,
  referenceId,
  payloadHash,
  excludedInvoiceIds = [],
  summary = {},
  memberId = null,
  filedBy = null,
  lastRequestIp = null,
  userAgent = null,
  idempotencyKey = null
}) {
  const normalizedType = String(type || '').toUpperCase();
  const normalizedGstin = String(gstin || '').toUpperCase();

  return this.findOneAndUpdate(
    { workspaceId, type: normalizedType, period },
    {
      $set: {
        workspaceId,
        gstin: normalizedGstin,
        type: normalizedType,
        period,
        status: 'ReadyToEVC',
        referenceId: normalizeOptionalString(referenceId),
        payloadHash: normalizeOptionalString(payloadHash),
        excludedInvoiceIds: normalizeStringArray(excludedInvoiceIds),
        summary: normalizeSummary(summary),
        preparedAt: new Date(),
        memberId,
        filedBy,
        lastRequestIp: normalizeOptionalString(lastRequestIp),
        userAgent: normalizeOptionalString(userAgent),
        idempotencyKey: normalizeOptionalString(idempotencyKey)
      }
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true
    }
  );
};

/**
 * Convenience helper to persist Filed state atomically.
 */
filingSchema.statics.markFiled = async function markFiled({
  workspaceId,
  gstin,
  type,
  period,
  arn,
  mode = 'EVC',
  isNil = false,
  summary = {},
  declarationAccepted = true,
  filingDate = new Date(),
  referenceId = null,
  payloadHash = null,
  excludedInvoiceIds = [],
  memberId = null,
  filedBy = null,
  lastRequestIp = null,
  userAgent = null,
  idempotencyKey = null,
  signedInvoiceUrl = null
}) {
  const normalizedType = String(type || '').toUpperCase();
  const normalizedGstin = String(gstin || '').toUpperCase();
  const normalizedMode = normalizeNilMode(mode, isNil);
  const normalizedFilingDate = filingDate instanceof Date ? filingDate : new Date(filingDate);

  return this.findOneAndUpdate(
    { workspaceId, type: normalizedType, period },
    {
      $set: {
        workspaceId,
        gstin: normalizedGstin,
        type: normalizedType,
        period,
        arn: normalizeOptionalString(arn),
        status: 'Filed',
        mode: normalizedMode,
        isNil: Boolean(isNil),
        filingDate: normalizedFilingDate,
        dateStr: formatIstDisplayDate(normalizedFilingDate),
        declarationAccepted: Boolean(declarationAccepted),
        referenceId: normalizeOptionalString(referenceId),
        payloadHash: normalizeOptionalString(payloadHash),
        excludedInvoiceIds: normalizeStringArray(excludedInvoiceIds),
        summary: normalizeSummary(summary),
        memberId,
        filedBy,
        lastRequestIp: normalizeOptionalString(lastRequestIp),
        userAgent: normalizeOptionalString(userAgent),
        idempotencyKey: normalizeOptionalString(idempotencyKey),
        signedInvoiceUrl: normalizeOptionalString(signedInvoiceUrl),
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null
      }
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true
    }
  );
};

module.exports = mongoose.model('Filing', filingSchema);