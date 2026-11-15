const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkspaceMember',
      default: null
    },
    userName: {
      type: String,
      default: null,
      trim: true
    },
    userEmail: {
      type: String,
      default: null,
      trim: true
    },
    gstin: {
      type: String,
      default: null,
      trim: true,
      uppercase: true
    },
    action: {
      type: String,
      required: true,
      trim: true // e.g. 'USER_SIGNIN', 'INVOICE_CREATE', 'GSTR1_FILE', 'NIL_FILE', 'LINK_GSTIN'
    },
    details: {
      type: String,
      default: ''
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    period: {
      type: String,
      default: null,
      trim: true
    },
    status: {
      type: String,
      required: true,
      enum: ['SUCCESS', 'FAILURE', 'FAILED']
    },
    ipAddress: {
      type: String,
      default: null
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  { timestamps: false }
);

auditLogSchema.index({ workspaceId: 1, createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ gstin: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
