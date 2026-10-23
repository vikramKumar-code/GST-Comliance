const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema(
  {
    gstin: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true
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

module.exports = mongoose.model('Workspace', workspaceSchema);
