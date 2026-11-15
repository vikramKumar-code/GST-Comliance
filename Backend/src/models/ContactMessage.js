const mongoose = require('mongoose');

const contactMessageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      // ✅ FIX 1: Email format validation
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        'Please provide a valid email address'
      ]
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000
    },
    // ✅ FIX 2: Admin workflow tracking
    status: {
      type: String,
      enum: ['NEW', 'READ', 'REPLIED', 'ARCHIVED', 'SPAM'],
      default: 'NEW',
      index: true
    },
    // ✅ FIX 3: Security & spam prevention
    ipAddress: {
      type: String,
      default: null,
      trim: true
    },
    // Kis page se message aaya (optional tracking)
    sourcePage: {
      type: String,
      default: '/contact',
      trim: true
    },
    // Agar logged-in user ne submit kiya, toh uska reference
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // Reply tracking
    repliedAt: {
      type: Date,
      default: null
    },
    repliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  { timestamps: true }
);

// TTL Index: 180 din baad auto-delete (unchanged - ye perfect hai)
contactMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

// ✅ FIX 4: Admin dashboard ke liye optimized indexes
contactMessageSchema.index({ status: 1, createdAt: -1 });
contactMessageSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model('ContactMessage', contactMessageSchema);