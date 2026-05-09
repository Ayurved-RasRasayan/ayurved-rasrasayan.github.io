const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// ─── ENVIRONMENT VARIABLES CHECK ────────────────────────────────────────
const requiredEnvVars = ['MONGO_URI', 'EMAIL_PASS', 'ADMIN_USER', 'ADMIN_PASSWORD', 'RECEIVER_EMAIL', 'JWT_SECRET', 'FRONTEND_URL'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`❌ FATAL: Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// ─── MIDDLEWARE ────────────────────────────────────────────────
// Dynamic CORS to allow credentials from frontend
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:5500', 'http://127.0.0.1:5500'];
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true // ESSENTIAL FOR COOKIES
};

app.use(express.json({ limit: '10mb' }));
app.use(cors(corsOptions));
app.use(cookieParser()); // ESSENTIAL FOR READING COOKIES

// ─── HELPERS & MIDDLEWARE ────────────────────────────────────────────────
function checkAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication Required');
  }
  try {
    const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD) return next();
  } catch (e) {}
  res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('Access Denied');
}

// Customer JWT Auth Middleware
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id: user._id }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function validateOrder(data) {
  const errors = [];
  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) errors.push('Items array is required');
  else data.items.forEach((item, i) => {
    if (!item.name) errors.push(`Item ${i}: missing name`);
    if (typeof item.price !== 'number' || item.price < 0) errors.push(`Item ${i}: invalid price`);
  });
  if (typeof data.totalUSD !== 'number' || data.totalUSD < 0) errors.push('Invalid totalUSD');
  if (!data.clientDetails || typeof data.clientDetails !== 'object') errors.push('Client details required');
  else {
    if (!data.clientDetails.name || typeof data.clientDetails.name !== 'string') errors.push('Client name required');
    if (!data.clientDetails.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.clientDetails.email)) errors.push('Valid email required');
    if (!data.clientDetails.phone) errors.push('Phone number required');
  }
  return errors;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress;
}

// ─── EMAIL FUNCTIONS ─────────────────────────────────────────────────────────
async function sendClientEmail(toEmail, toName, orderId, status) {
  try {
    let displayStatus = status === 'Success' ? 'Payment Successful' : status;
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: toEmail, name: toName }],
      subject: `Order Update: #${orderId}`,
      htmlContent: `<h3>Hello ${toName},</h3><p>Your order #${orderId} is now: <strong>${displayStatus}</strong>.</p><p>Thank you!</p>`
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    return true;
  } catch (e) { console.error('[EMAIL] ❌ Error:', e.response?.data || e.message); return false; }
}

async function sendAdminAlert(orderId, data) {
  try {
    let itemsHtml = '<table style="width:100%;border-collapse:collapse;margin-top:10px;"><tr style="background:#f9fafb;"><th style="border:1px solid #e5e7eb;padding:8px;">Item</th><th style="border:1px solid #e5e7eb;padding:8px;">Qty</th><th style="border:1px solid #e5e7eb;padding:8px;">Price</th></tr>';
    (data.items || []).forEach(i => { itemsHtml += `<tr><td style="border:1px solid #e5e7eb;padding:8px;">${i.name}</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:center;">${i.qty||1}</td><td style="border:1px solid #e5e7eb;padding:8px;">$${i.price||0}</td></tr>`; });
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: 'sales.naturabotanica20@gmail.com', name: 'Sales Team' }],
      subject: `🛒 NEW ORDER: #${orderId} - ${data.clientDetails.name}`,
      htmlContent: `<div style="font-family:Arial;color:#333;"><h2 style="color:#2d4a22;">New Order (#${orderId})</h2><p><b>Name:</b> ${data.clientDetails.name}<br><b>Email:</b> ${data.clientDetails.email}<br><b>Phone:</b> ${data.clientDetails.phone}</p><p><b>Total:</b> $${data.totalUSD} (${data.totalNPR} NPR)</p>${itemsHtml}${data.paymentScreenshot ? `<p>📸 <a href="${data.paymentScreenshot}" target="_blank">View Screenshot</a></p>` : ''}</div>`
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
  } catch (e) { console.error('Admin Alert Error:', e.message); }
}

async function sendInquiryAlert(data) {
  try {
    const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: process.env.RECEIVER_EMAIL, name: 'Sales Team' }],
      subject: `📨 New Inquiry: ${fullName} (${data.company || 'Individual'})`,
      htmlContent: `<div style="font-family:Arial;color:#333;padding:20px;border:1px solid #eee;"><h2 style="color:#A3B14B;">New Inquiry Received</h2><p style="background:#f9fafb;padding:10px;border-radius:5px;"><strong>Name:</strong> ${fullName}<br><strong>Email:</strong> ${data.email}<br><strong>Company:</strong> ${data.company || 'N/A'}</p><div style="margin-top:20px;"><strong>Message:</strong><p style="background:#fff;padding:15px;border:1px solid #eee;margin-top:5px;">${data.message}</p></div></div>`
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    return true;
  } catch (e) { console.error('[INQUIRY EMAIL] ❌ Error:', e.response?.data || e.message); return false; }
}

async function sendVerificationEmail(email, name, token) {
  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email.html?token=${token}`; // Adjust path if needed
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email, name }],
      subject: 'NaturaBotanica - Verify Your Email',
      htmlContent: `<div style="font-family:Arial;color:#333;"><h2 style="color:#A3B14B;">Welcome to NaturaBotanica!</h2><p>Please verify your email address to activate your account:</p><a href="${verifyUrl}" style="background:#A3B14B;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">Verify Email</a><p style="margin-top:20px;font-size:12px;color:#666;">If you did not create an account, please ignore this email.</p></div>`
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
  } catch (e) { console.error('[VERIFY EMAIL] ❌ Error:', e.response?.data || e.message); }
}

async function sendPasswordResetEmail(email, name, token) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${token}`; // Adjust path if needed
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email, name }],
      subject: 'NaturaBotanica - Password Reset Request',
      htmlContent: `<div style="font-family:Arial;color:#333;"><h2 style="color:#A3B14B;">Password Reset</h2><p>You requested a password reset. Click the button below to set a new password. This link expires in 15 minutes.</p><a href="${resetUrl}" style="background:#1C1917;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">Reset Password</a><p style="margin-top:20px;font-size:12px;color:#666;">If you did not request this, please ignore this email.</p></div>`
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
  } catch (e) { console.error('[RESET EMAIL] ❌ Error:', e.response?.data || e.message); }
}

// ─── DATABASE CONNECT & SCHEMAS ────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ MongoDB Connected')).catch(err => { console.error('❌ MongoDB Error:', err); process.exit(1); });

const productSchema = new mongoose.Schema({ id: Number, name: String, sci: String, category: String, catLabel: String, price: Number, unit: String, moq: String, lead: String, img: String, desc: String, stock: { type: Number, default: 100 } });
const orderSchema = new mongoose.Schema({ items: Array, totalUSD: Number, totalNPR: Number, paidAmount: Number, currency: String, paymentMethod: String, paymentScreenshot: String, clientDetails: { name: String, phone: String, email: String, address: String }, status: { type: String, default: 'Pending' }, order_state: { type: String, default: 'Pending' }, emailStatus: { type: String, default: 'Queue' }, timestamp: { type: Date, default: Date.now } });
const inquirySchema = new mongoose.Schema({ firstName: String, lastName: String, email: String, company: String, message: String, timestamp: { type: Date, default: Date.now } });
const settingSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: mongoose.Schema.Types.Mixed });
const visitorSchema = new mongoose.Schema({ ip: { type: String, unique: true, index: true }, lastVisited: { type: Date, default: Date.now } });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  cart: [{ id: Number, name: String, price: Number, qty: Number, unit: String, form: String, img: String }],
  isVerified: { type: Boolean, default: false },
  verificationToken: String,
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  role: { type: String, default: 'customer' },
  timestamp: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Inquiry = mongoose.model('Inquiry', inquirySchema);
const Setting = mongoose.model('Setting', settingSchema);
const Visitor = mongoose.model('Visitor', visitorSchema);
const User = mongoose.model('User', userSchema);

// ─── HELPER: Get/Set DB Setting ─────────────────────────────────────────────
async function getSetting(key, defaultVal) { const doc = await Setting.findOne({ key }); return doc ? doc.value : defaultVal; }
async function setSetting(key, value) { await Setting.updateOne({ key }, { value }, { upsert: true }); }

// ═══════════════════════════════════════════════════════════════════════════
// ─── AUTHENTICATION ROUTES ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) return res.status(400).json({ error: 'Password must be at least 8 characters, with uppercase, lowercase, number, and special character.' });

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already in use.' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const verifyToken = crypto.randomBytes(20).toString('hex');

    const user = new User({ name, email, password: hashedPassword, verificationToken: verifyToken });
    await user.save();
    await sendVerificationEmail(email, name, verifyToken);

    res.status(201).json({ success: true, message: 'Account created! Please check your email to verify your account.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, guestCart } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials.' });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials.' });
    if (!user.isVerified) return res.status(403).json({ error: 'Please verify your email address first.', needsVerification: true });

    // Merge Cart Logic
    if (guestCart && guestCart.length > 0) {
      let dbCart = user.cart || [];
      for (const gItem of guestCart) {
        const existingIndex = dbCart.findIndex(dbItem => dbItem.id === gItem.id && dbItem.unit === gItem.unit && dbItem.form === gItem.form);
        if (existingIndex >= 0) dbCart[existingIndex].qty += gItem.qty;
        else dbCart.push(gItem);
      }
      user.cart = dbCart;
      await user.save();
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'none', maxAge: 7 * 24 * 60 * 60 * 1000 });

    const { password: pw, verificationToken, resetPasswordToken, resetPasswordExpire, ...userData } = user._doc;
    res.json({ success: true, user: userData });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -verificationToken -resetPasswordToken -resetPasswordExpire');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'none' });
  res.json({ success: true });
});

app.post('/api/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    const user = await User.findOne({ verificationToken: token });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token.' });
    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ success: true, message: 'If an account exists, an email has been sent.' });
    if (user.isVerified) return res.status(400).json({ error: 'Account already verified.' });
    const verifyToken = crypto.randomBytes(20).toString('hex');
    user.verificationToken = verifyToken;
    await user.save();
    await sendVerificationEmail(user.email, user.name, verifyToken);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    
    const resetToken = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 mins
    await user.save();
    await sendPasswordResetEmail(user.email, user.name, resetToken);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) return res.status(400).json({ error: 'Password does not meet requirements.' });

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ resetPasswordToken: hashedToken, resetPasswordExpire: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token.' });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sync Cart when logged in
app.post('/api/auth/sync-cart', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.cart = req.body.cart || [];
    await user.save();
    res.json({ success: true, cart: user.cart });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── PRODUCT SYNC ENGINE ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

async function syncProductsToDB(productsArray, { removeOrphans = false, resetStock = false } = {}) {
  if (!Array.isArray(productsArray) || productsArray.length === 0) return { added: 0, updated: 0, removed: 0 };
  let added = 0, updated = 0, removed = 0;
  const incomingIds = new Set(productsArray.map(p => p.id));
  for (const p of productsArray) {
    const existing = await Product.findOne({ id: p.id });
    if (existing) { const updateData = { ...p }; if (!resetStock) updateData.stock = existing.stock; await Product.updateOne({ id: p.id }, { $set: updateData }); updated++; }
    else { const newProduct = { ...p, stock: p.stock ?? 100 }; await new Product(newProduct).save(); added++; }
  }
  if (removeOrphans) { const dbProducts = await Product.find({}, { id: 1 }); for (const dbp of dbProducts) { if (!incomingIds.has(dbp.id)) { await Product.deleteOne({ id: dbp.id }); removed++; } } }
  return { added, updated, removed };
}

async function syncDBToFile() {
  try { const products = await Product.find().sort({ id: 1 }).lean(); const clean = products.map(({ _id, __v, ...rest }) => rest); fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(clean, null, 2), 'utf8'); return true; } catch (e) { return false; }
}

async function syncFileToDB({ removeOrphans = false, resetStock = false } = {}) {
  try { const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8'); const products = JSON.parse(raw); return await syncProductsToDB(products, { removeOrphans, resetStock }); } catch (e) { return null; }
}

let syncDebounce = null;
function startFileWatcher() {
  try { fs.watch(PRODUCTS_FILE, (eventType) => { if (eventType !== 'change') return; if (syncDebounce) clearTimeout(syncDebounce); syncDebounce = setTimeout(async () => { await syncFileToDB({ removeOrphans: true }); }, 500); }); } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── AUTO-SYNC EXCHANGE RATE ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
async function syncExchangeRate() {
  try { const apiRes = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 10000 }); if (apiRes.data?.result === 'success' && apiRes.data?.rates?.NPR) { const rate = apiRes.data.rates.NPR; await setSetting('exchange_rate', rate); await setSetting('rate_source', 'live'); return rate; } } catch (e) {}
  return null;
}
syncExchangeRate(); setInterval(syncExchangeRate, 6 * 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// ─── PUBLIC & DATA ROUTES ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/public/rate', async (req, res) => { try { const rate = await getSetting('exchange_rate', 133); res.json({ rate }); } catch (e) { res.status(500).json({ error: e.message }); } });

app.get('/api/public/visits', async (req, res) => {
  try { const ip = getClientIp(req); await Visitor.updateOne({ ip }, { $set: { lastVisited: new Date() } }, { upsert: true }); const baseCount = await getSetting('base_visitor_count', 5000); const uniqueCount = await Visitor.countDocuments({}); res.json({ count: baseCount + uniqueCount }); } catch (e) { res.json({ count: 5000 }); }
});

app.get('/api/health', async (req, res) => { try { await mongoose.connection.db.admin().ping(); res.json({ status: 'healthy' }); } catch (e) { res.status(503).json({ status: 'unhealthy' }); } });

// ═══════════════════════════════════════════════════════════════════════════
// ─── PRODUCTS ROUTES ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/products', async (req, res) => { try { const products = await Product.find().sort({ id: 1 }).lean(); res.json(products.map(({ _id, __v, ...rest }) => rest)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/products', checkAdminAuth, async (req, res) => { try { const newProduct = new Product({ ...req.body, stock: req.body.stock ?? 100 }); await newProduct.save(); await syncDBToFile(); res.status(201).json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/products/:id', checkAdminAuth, async (req, res) => { try { await Product.updateOne({ id: Number(req.params.id) }, { $set: req.body }); await syncDBToFile(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/products/:id', checkAdminAuth, async (req, res) => { try { await Product.deleteOne({ id: Number(req.params.id) }); await syncDBToFile(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/seed', checkAdminAuth, async (req, res) => { try { await Product.deleteMany({}); await Product.insertMany(require('./products.json')); res.json({ success: true }); } catch (e) { res.status(500).send(e.message); } });

// ═══════════════════════════════════════════════════════════════════════════
// ─── ORDERS & INQUIRIES ROUTES ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/orders', async (req, res) => {
  try { const errors = validateOrder(req.body); if (errors.length > 0) return res.status(400).json({ success: false, errors }); const savedOrder = await new Order(req.body).save(); await sendAdminAlert(savedOrder._id, req.body); res.status(201).json({ success: true, orderId: savedOrder._id }); } catch (e) { res.status(500).json({ success: false, error: 'Server error' }); }
});
app.get('/api/view-orders-data', checkAdminAuth, async (req, res) => { try { const orders = await Order.find().sort({ timestamp: -1 }).limit(100); res.json({ success: true, orders }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/update-status', checkAdminAuth, async (req, res) => { try { await Order.updateOne({ _id: req.body.id }, { status: req.body.status, emailStatus: 'Queue' }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/inquiries', async (req, res) => { try { await new Inquiry(req.body).save(); await sendInquiryAlert(req.body); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ═══════════════════════════════════════════════════════════════════════════
// ─── STARTUP ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
async function startup() { await syncFileToDB({ removeOrphans: true }); startFileWatcher(); }
startup();

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.listen(port, () => console.log(`🚀 Secure Server running on port ${port}`));
