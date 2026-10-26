const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: ['goods', 'service'],
      default: 'goods',
      required: true
    },
    hsnSac: {
      type: String,
      trim: true,
      default: ''
    },
    unit: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'PCS'
    },
    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    purchasePrice: {
      type: Number,
      min: 0,
      default: 0
    },
    gstRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 18
    },
    cessRate: {
      type: Number,
      min: 0,
      default: 0
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE'
    }
  },
  { timestamps: true }
);

itemSchema.index({ workspaceId: 1, name: 1 });
itemSchema.index({ workspaceId: 1, hsnSac: 1 });

module.exports = mongoose.model('Item', itemSchema);
