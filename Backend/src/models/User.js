const mongoose = require('mongoose');

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
    mobile: {
      type: String,
      trim: true,
      default: null
    },
    identityHash: {
      type: String,
      default: null,
      select: false
    }
  },
  { timestamps: true }
);

userSchema.index({ identityHash: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('User', userSchema);
