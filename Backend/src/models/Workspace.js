const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: 'My Organization'
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED'],
      default: 'ACTIVE',
      required: true
    }
  },
  { timestamps: true }
);

workspaceSchema.index(
  { gstin: 1 },
  {
    unique: true,
    partialFilterExpression: { gstin: { $type: 'string' } }
  }
);

module.exports = mongoose.model('Workspace', workspaceSchema);

