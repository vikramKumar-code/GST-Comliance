const mongoose = require('mongoose');

const workspaceMemberSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: ['OWNER', 'ADMIN', 'MEMBER', 'CA', 'ACCOUNTANT', 'VIEWER'],
      default: 'CA',
      required: true
    },
    subRole: {
      type: String,
      enum: ['CA', 'ACCOUNTANT', 'STAFF', 'VIEWER'],
      default: function () {
        if (this.role === 'CA' || this.role === 'OWNER' || this.role === 'ADMIN') return 'CA';
        if (this.role === 'ACCOUNTANT') return 'ACCOUNTANT';
        if (this.role === 'VIEWER') return 'VIEWER';
        return 'CA';
      }
    },
    permissions: {
      type: [String],
      default: function () {
        if (this.role === 'OWNER' || this.role === 'CA' || this.role === 'ADMIN' || this.subRole === 'CA') {
          return ['ALL', 'GSTR_FILE', 'GSTR_VIEW', 'INVOICE_MANAGE', 'SETTINGS_MANAGE', 'USER_INVITE', 'CLIENT_MANAGE'];
        }
        if (this.role === 'ACCOUNTANT' || this.subRole === 'ACCOUNTANT') {
          return ['INVOICE_MANAGE', 'BILL_MANAGE', 'REPORT_VIEW', 'GSTR_VIEW'];
        }
        if (this.role === 'VIEWER' || this.subRole === 'VIEWER') {
          return ['REPORT_VIEW', 'GSTR_VIEW'];
        }
        return ['INVOICE_MANAGE', 'GSTR_VIEW'];
      }
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'REVOKED'],
      default: 'ACTIVE',
      required: true
    }
  },
  { timestamps: true }
);

workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

workspaceMemberSchema.methods.canFileReturns = function () {
  return (
    ['OWNER', 'CA', 'ADMIN'].includes(this.role) ||
    this.subRole === 'CA' ||
    (Array.isArray(this.permissions) && (this.permissions.includes('GSTR_FILE') || this.permissions.includes('ALL')))
  );
};

workspaceMemberSchema.methods.canManageBilling = function () {
  return (
    ['OWNER', 'CA', 'ACCOUNTANT', 'ADMIN', 'MEMBER'].includes(this.role) ||
    ['CA', 'ACCOUNTANT'].includes(this.subRole) ||
    (Array.isArray(this.permissions) && (this.permissions.includes('INVOICE_MANAGE') || this.permissions.includes('ALL')))
  );
};

module.exports = mongoose.model('WorkspaceMember', workspaceMemberSchema);
