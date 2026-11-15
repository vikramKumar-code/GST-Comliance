const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ✅ FIX 1: Parse Super Admin emails ONCE at module load for performance & security
// Removed hardcoded personal emails. Add them to your .env file: SUPER_ADMIN_EMAILS=admin@company.com,dev@company.com
const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        'Please provide a valid email address'
      ]
    },
    password: {
      type: String,
      default: null,
      select: false, // Never return password in default queries
      minlength: [6, 'Password must be at least 6 characters long']
    },
    authProvider: {
      type: String,
      enum: ['LOCAL', 'GOOGLE', 'MICROSOFT'],
      default: 'LOCAL'
    },
    googleId: {
      type: String,
      default: null
    },
    avatar: {
      type: String,
      default: null
    },
    isEmailVerified: {
      type: Boolean,
      default: false
    },
    mobile: {
      type: String,
      trim: true,
      default: null,
      // Basic validation for Indian/International numbers
      match: [/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/, 'Invalid mobile number format']
    },
    systemRole: {
      type: String,
      enum: ['USER', 'SUPER_ADMIN'],
      default: 'USER'
    },
    professionalRole: {
      type: String,
      enum: ['CA', 'ACCOUNTANT', 'BUSINESS_OWNER', 'VIEWER'],
      default: 'BUSINESS_OWNER'
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'BLOCKED', 'SUSPENDED'],
      default: 'ACTIVE',
      index: true
    },

    // Used by TenantService to map GSTIN+Username to a specific platform user
    identityHash: {
      type: String,
      select: false,
    },

    // ✅ FIX 4: Audit & UX Fields
    lastLoginAt: {
      type: Date,
      default: null
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
      trim: true
    },
    preferredLanguage: {
      type: String,
      enum: ['en', 'hi', 'gu', 'mr', 'ta', 'te'],
      default: 'en'
    }
  },
  { timestamps: true }
);

// ✅ Optimized Indexes (Partial filters prevent duplicate null errors)
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);
userSchema.index(
  { googleId: 1 },
  { sparse: true, partialFilterExpression: { googleId: { $type: 'string' } } }
);
userSchema.index(
  { identityHash: 1 },
  { unique: true, sparse: true, partialFilterExpression: { identityHash: { $type: 'string' } } }
);

/**
 * Compare plain text candidate password with hashed password
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password || !candidatePassword) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Static helper to hash passwords with salt rounds 10
 */
userSchema.statics.hashPassword = async function (plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new Error('Password must be a valid non-empty string.');
  }
  return bcrypt.hash(plainPassword, 10);
};

/**
 * Helper to determine if user has Super Admin platform privileges
 * ✅ FIX 3: Uses pre-parsed Set for O(1) lookup performance
 */
userSchema.methods.isSuperAdmin = function () {
  if (this.systemRole === 'SUPER_ADMIN') return true;
  if (this.email && SUPER_ADMIN_EMAILS.has(this.email.trim().toLowerCase())) {
    return true;
  }
  return false;
};

/**
 * ✅ FIX 2: Pre-save hook for automatic password hashing & role promotion
 */
userSchema.pre('save', async function (next) {
  // 1. Auto-promote to Super Admin if email matches env list
  if (this.isSuperAdmin() && this.systemRole !== 'SUPER_ADMIN') {
    this.systemRole = 'SUPER_ADMIN';
  }

  // 2. Automatically hash password if it's new or modified
  // This prevents accidental plaintext password storage
  if (this.password && this.isModified('password')) {
    try {
      this.password = await bcrypt.hash(this.password, 10);
    } catch (err) {
      return next(err);
    }
  }

  next();
});

module.exports = mongoose.model('User', userSchema);