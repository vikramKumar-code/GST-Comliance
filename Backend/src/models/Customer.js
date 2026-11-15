const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    street: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    stateCode: { type: String, default: '', trim: true },
    pincode: { type: String, default: '', trim: true },
    country: { type: String, default: 'India', trim: true }
  },
  { _id: false }
);

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
      trim: true,
      maxlength: 200
    },
    companyName: {
      type: String,
      trim: true,
      maxlength: 200
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
      // ✅ FIX 1: GSTIN format validation (15 characters)
      match: [
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
        'Please provide a valid 15-character GSTIN'
      ]
    },
    // ✅ FIX 4: PAN field for B2C compliance (optional)
    pan: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
      match: [
        /^[A-Z]{5}[0-9]{4}[A-Z]$/,
        'Please provide a valid 10-character PAN'
      ]
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      maxlength: 254,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        'Please provide a valid email address'
      ]
    },
    phone: {
      type: String,
      trim: true,
      default: '',
      maxlength: 15
    },
    gstType: {
      type: String,
      // ✅ FIX 3: Added SEZ and Deemed Export
      enum: ['Regular', 'Composition', 'Consumer', 'Unregistered', 'Overseas', 'SEZ', 'Deemed Export'],
      default: 'Regular'
    },
    placeOfSupply: {
      type: String,
      trim: true,
      default: '',
      // ✅ FIX 2: Auto-extract 2-digit state code from GSTIN
      set: function (v) {
        // Agar explicit POS diya gaya hai, toh use karein
        if (v && String(v).trim().length >= 2) {
          const match = String(v).trim().match(/^([0-9]{2})/);
          return match ? match[1] : String(v).trim().slice(0, 2).toUpperCase();
        }
        // Warna, GSTIN se extract karein
        if (this.gstin && this.gstin.length >= 2) {
          return this.gstin.slice(0, 2);
        }
        return '';
      }
    },
    billingAddress: {
      type: addressSchema,
      default: () => ({})
    },
    shippingAddress: {
      type: addressSchema,
      default: () => ({})
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
      index: true
    },
    // ✅ FIX 5: Customer-specific notes/terms
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000
    },
    // ✅ FIX 6: Track last invoice date for customer activity
    lastInvoiceDate: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

// ✅ FIX 7: Partial filter expression - empty GSTIN ko index me include mat karein
customerSchema.index(
  { workspaceId: 1, gstin: 1 },
  {
    partialFilterExpression: { gstin: { $exists: true, $ne: '' } }
  }
);

// Name search ke liye (case-insensitive queries ke liye collation)
customerSchema.index(
  { workspaceId: 1, name: 1 },
  { collation: { locale: 'en', strength: 2 } }
);

// Status-based filtering ke liye
customerSchema.index({ workspaceId: 1, status: 1 });

module.exports = mongoose.model('Customer', customerSchema);