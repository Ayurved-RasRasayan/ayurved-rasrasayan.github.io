const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Order = require('../models/Order');
const { generateOTP } = require('../utils/helpers');
const { sendOTPEmail, sendResetEmail } = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'natura_botanica_super_secret_key_123';

// ==========================================
// Helper: Generate JWT
// ==========================================
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, isVerified: user.isVerified },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// ==========================================
// SIGNUP (No username, email only)
// ==========================================
exports.signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    if (password.length < 8 || password.length > 30) {
      return res.status(400).json({ error: 'Password must be between 8 and 30 characters.' });
    }

    const existingUser = await User.findOne({ 
      email: email.toLowerCase(), 
      isDeleted: { $ne: true } 
    });

    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const otp = generateOTP();

    const user = new User({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      isVerified: false,
      verificationCode: otp,
      verificationExpires: new Date(Date.now() + 5 * 60 * 1000),
      cart: []
    });

    await user.save();
    await sendOTPEmail(email, name, otp);

    res.status(201).json({
      success: true,
      message: 'Account created! Check your email for a 6-digit verification code.'
    });

  } catch (e) {
    console.error('Signup error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

// ==========================================
// SIGNIN (Email only, no username)
// ==========================================
exports.signin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // .select('+password') because password has select:false in model
    const user = await User.findOne({ 
      email: email.toLowerCase(), 
      isDeleted: { $ne: true } 
    }).select('+password');

    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isVerified: user.isVerified,
        cart: user.cart || []
      }
    });

  } catch (e) {
    console.error('Signin error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

// ==========================================
// VERIFY OTP (Signup verification)
// ==========================================
exports.verifyOTP = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required.' });
    }

    const user = await User.findOne({ 
      email: email.toLowerCase(), 
      isDeleted: { $ne: true } 
    }).select('+verificationCode +verificationExpires');

    if (!user) {
      return res.status(400).json({ error: 'User not found.' });
    }

    if (user.isVerified) {
      return res.status(400).json({ error: 'Email is already verified.' });
    }

    if (user.verificationCode !== code) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    if (user.verificationExpires < new Date()) {
      user.verificationCode = undefined;
      user.verificationExpires = undefined;
      await user.save();
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationExpires = undefined;
    await user.save();

    const token = generateToken(user);

    res.json({
      success: true,
      message: 'Email verified successfully!',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isVerified: true,
        cart: user.cart || []
      }
    });

  } catch (e) {
    console.error('Verify OTP error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

// ==========================================
// RESEND OTP (Signup)
// ==========================================
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = await User.findOne({ 
      email: email.toLowerCase(), 
      isDeleted: { $ne: true } 
    }).select('+verificationCode +verificationExpires');

    if (!user) {
      return res.status(400).json({ error: 'User not found.' });
    }

    if (user.isVerified) {
      return res.status(400).json({ error: 'Email is already verified.' });
    }

    const otp = generateOTP();
    user.verificationCode = otp;
    user.verificationExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    await sendOTPEmail(email, user.name, otp);

    res.json({
      success: true,
      message: 'A new 6-digit code has been sent to your email.'
    });

  } catch (e) {
    console.error('Resend OTP error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

// ==========================================
// FORGOT PASSWORD - Send reset OTP
// ==========================================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = await User.findOne({ 
      email: email.toLowerCase(), 
      isDeleted: { $ne: true } 
    }).select('+verificationCode +verificationExpires');

    // Always return same message whether user exists or not (security)
    if (!user) {
      return res.status(200).json({
        message: 'If an account with that email exists, a reset code has been sent.'
      });
    }

    const otp = generateOTP();
    user.verificationCode = otp;
    user.verificationExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    // Use sendResetEmail (not sendOTPEmail) for password reset
    await sendResetEmail(email, user.name, otp);

    res.status(200).json({
      message: 'If an account with that email exists, a reset code has been sent.'
    });

  } catch (e) {
    console.error('Forgot password error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

// ==========================================
// RESET PASSWORD - Verify OTP & set new password
// ==========================================
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required.' });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'OTP must be exactly 6 digits.' });
    }

    if (newPassword.length < 8 || newPassword.length > 30) {
      return res.status(400).json({ error: 'Password must be between 8 and 30 characters.' });
    }

    // Need password + verification fields from DB
    const user = await User.findOne({ 
      email: email.toLowerCase(), 
      isDeleted: { $ne: true } 
    }).select('+password +verificationCode +verificationExpires');

    if (!user) {
      return res.status(400).json({ error: 'Invalid email or reset code.' });
    }

    if (!user.verificationCode) {
      return res.status(400).json({ error: 'No reset code was requested. Please request a new one.' });
    }

    if (user.verificationCode !== otp) {
      return res.status(400).json({ error: 'Invalid reset code.' });
    }

    if (user.verificationExpires < new Date()) {
      user.verificationCode = undefined;
      user.verificationExpires = undefined;
      await user.save();
      return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    user.verificationCode = undefined;
    user.verificationExpires = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successfully! You can now sign in with your new password.'
    });

  } catch (e) {
    console.error('Reset password error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

// ==========================================
// GET CURRENT USER
// ==========================================
exports.getMe = async (req, res) => {
  try {
    const user = await User.findOne({
      _id: req.user.id,
      isDeleted: { $ne: true }
    }).select('-password -verificationCode -verificationExpires');

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json(user);

  } catch (e) {
    console.error('GetMe error:', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
};

// ==========================================
// SYNC CART
// ==========================================
exports.syncCart = async (req, res) => {
  try {
    if (!req.user.isVerified) {
      return res.status(403).json({ error: 'Please verify your email first.' });
    }

    const user = await User.findOne({
      _id: req.user.id,
      isDeleted: { $ne: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const localCart = req.body.cart;
    if (!localCart || !Array.isArray(localCart)) {
      return res.status(400).json({ error: 'Invalid cart data.' });
    }

    let dbCart = [...(user.cart || [])];

    for (const localItem of localCart) {
      const existingIndex = dbCart.findIndex(
        i => String(i.id) === String(localItem.id) && i.unit === localItem.unit && i.form === localItem.form
      );

      if (existingIndex >= 0) {
        dbCart[existingIndex].qty += localItem.qty;
      } else {
        dbCart.push(localItem);
      }
    }

    user.cart = dbCart;
    await user.save();

    res.json({ success: true, cart: user.cart });

  } catch (e) {
    console.error('Cart sync error:', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
};

// ==========================================
// GET MY ORDERS
// ==========================================
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      'clientDetails.email': req.user.email
    }).sort({ timestamp: -1 });

    res.json(orders);

  } catch (e) {
    console.error('Get orders error:', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
};

// ==========================================
// ADMIN: GET ALL USERS
// ==========================================
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ isDeleted: { $ne: true } })
      .sort({ _id: -1 })
      .select('-password -verificationCode -verificationExpires');

    res.json({ success: true, users });

  } catch (e) {
    console.error('Get users error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
};

// ==========================================
// ADMIN: DELETE USER (Soft Delete)
// ==========================================
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        isDeleted: true,
        deletedAt: new Date(),
        password: '$2b$10$DELETED.ACCOUNT.NO.LONGER.VALID',
        verificationCode: undefined,
        verificationExpires: undefined,
        cart: []
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    res.json({ success: true, message: 'User account has been deactivated.' });

  } catch (e) {
    console.error('Delete user error:', e.message);
    res.status(500).json({ success: false, error: 'Server error.' });
  }
};
