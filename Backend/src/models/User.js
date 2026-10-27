const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: null
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null
    },
    password: {
      type: String,
      default: null,
      select: false
    },
    authProvider: {
      type: String,
      enum: ['LOCAL', 'GOOGLE', 'GSTIN_OTP'],
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
      default: null
    },
    identityHash: {
      type: String,
      select: false
    }
  },
  { timestamps: true }
);

userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);
userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
);
userSchema.index(
  { identityHash: 1 },
  { unique: true, partialFilterExpression: { identityHash: { $type: 'string' } } }
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

module.exports = mongoose.model('User', userSchema);
