const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // ==========================================
  // BASIC INFO (Username removed, email only)
  // ==========================================
  name: { 
    type: String, 
    required: [true, 'Name is required'], 
    trim: true 
  },
  email: { 
    type: String, 
    required: [true, 'Email is required'], 
    unique: true, 
    lowercase: true, 
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  password: { 
    type: String, 
    required: [true, 'Password is required'], 
    minlength: 8, 
    maxlength: 30,
    select: false  // Excluded from queries by default for security
  },

  // ==========================================
  // VERIFICATION (6-digit OTP, 5 min expiry)
  // ==========================================
  isVerified: { 
    type: Boolean, 
    default: false 
  },
  verificationCode: { 
    type: String, 
    select: false  // Never return OTP in queries unless explicitly asked
  },
  verificationExpires: { 
    type: Date, 
    select: false 
  },

  // ==========================================
  // CART
  // ==========================================
  cart: { 
    type: Array, 
    default: [] 
  },

  // ==========================================
  // SOFT DELETE (Admin deletion support)
  // ==========================================
  isDeleted: { 
    type: Boolean, 
    default: false, 
    index: true  // Index for faster queries filtering out deleted users
  },
  deletedAt: { 
    type: Date 
  }

}, {
  // Automatically adds createdAt and updatedAt fields
  timestamps: true
});

// ==========================================
// INDEXES
// ==========================================
// Compound index to allow querying active users efficiently
userSchema.index({ email: 1, isDeleted: 1 });

module.exports = mongoose.model('User', userSchema);
