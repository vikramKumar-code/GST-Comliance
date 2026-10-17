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
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
