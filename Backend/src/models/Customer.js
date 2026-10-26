const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
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
    companyName: {
      type: String,
      trim: true
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    gstType: {
      type: String,
      enum: ['Regular', 'Composition', 'Consumer', 'Unregistered', 'Overseas'],
      default: 'Regular'
    },
    placeOfSupply: {
      type: String,
      trim: true,
      default: ''
    },
    billingAddress: {
      street: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      stateCode: { type: String, default: '' },
      pincode: { type: String, default: '' },
      country: { type: String, default: 'India' }
    },
    shippingAddress: {
      street: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      stateCode: { type: String, default: '' },
      pincode: { type: String, default: '' },
      country: { type: String, default: 'India' }
    },
    currency: {
      type: String,
      default: 'INR'
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE'
    }
  },
  { timestamps: true }
);

customerSchema.index({ workspaceId: 1, name: 1 });
customerSchema.index({ workspaceId: 1, gstin: 1 });

module.exports = mongoose.model('Customer', customerSchema);
