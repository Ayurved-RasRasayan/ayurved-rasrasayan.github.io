const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'natura_botanica_super_secret_key_123';

// ─── ENVIRONMENT VARIABLES CHECK ────────────────────────────────────────
const requiredEnvVars = ['MONGO_URI', 'EMAIL_PASS', 'ADMIN_USER', 'ADMIN_PASSWORD', 'RECEIVER_EMAIL'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`❌ FATAL: Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ─── MIDDLEWARE & HELPERS ────────────────────────────────────────────────
function checkAuth(req, res, next) {
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

function userAuth(req, res, next) {
  const token = req.header('Authorization');
  if (!token) return res.status(401).json({ error: 'No token, authorization denied' });
  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token is not valid' });
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

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
    let itemsHtml = '<table style="width:100%;border-collapse:collapse;margin-top:10px;"><tr style="background:#f9fafb;"><th style="border:1px solid #e5e7eb;padding:8px;">Item</th><th style="border:1px solid #e5e7eb;padding:8px;">Form</th><th style="border:1px solid #e5e7eb;padding:8px;">Unit</th><th style="border:1px solid #e5e7eb;padding:8px;">Qty</th><th style="border:1px solid #e5e7eb;padding:8px;">Price</th></tr>';
    (data.items || []).forEach(i => { 
      itemsHtml += `<tr><td style="border:1px solid #e5e7eb;padding:8px;">${i.name}</td><td style="border:1px solid #e5e7eb;padding:8px;">${i.form || 'N/A'}</td><td style="border:1px solid #e5e7eb;padding:8px;">${i.unit || 'N/A'}</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:center;">${i.qty||1}</td><td style="border:1px solid #e5e7eb;padding:8px;">$${i.price||0}</td></tr>`; 
    });
    itemsHtml += '</table>';
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

async function sendOTPEmail(toEmail, toName, otp) {
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: toEmail, name: toName }],
      subject: 'NaturaBotanica - Verify Your Email',
      htmlContent: `<div style="font-family:Arial;color:#333;text-align:center;padding:40px;"><h2 style="color:#2d4a22;">Email Verification</h2><p>Hello ${toName},</p><p>Your verification code is:</p><h1 style="font-size:40px;color:#A3B14B;letter-spacing:5px;">${otp}</h1><p>This code expires in 10 minutes.</p></div>`
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    return true;
  } catch (e) { console.error('[OTP EMAIL] ❌ Error:', e.response?.data || e.message); return false; }
}

// ─── DATABASE CONNECT & SCHEMAS ────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ MongoDB Connected')).catch(err => { console.error('❌ MongoDB Error:', err); process.exit(1); });

const productSchema = new mongoose.Schema({ id: Number, name: String, sci: String, category: String, catLabel: String, price: Number, unit: String, moq: String, lead: String, img: String, desc: String, stock: { type: Number, default: 100 } });
const orderSchema = new mongoose.Schema({ items: Array, totalUSD: Number, totalNPR: Number, paidAmount: Number, currency: String, paymentMethod: String, paymentScreenshot: String, clientDetails: { name: String, phone: String, email: String, address: String }, status: { type: String, default: 'Pending' }, order_state: { type: String, default: 'Pending' }, emailStatus: { type: String, default: 'Queue' }, timestamp: { type: Date, default: Date.now } });
const inquirySchema = new mongoose.Schema({ firstName: String, lastName: String, email: String, company: String, message: String, timestamp: { type: Date, default: Date.now } });
const settingSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: mongoose.Schema.Types.Mixed });
const visitorSchema = new mongoose.Schema({ ip: { type: String, unique: true, index: true }, lastVisited: { type: Date, default: Date.now } });
const userSchema = new mongoose.Schema({
  name: { type: String, required: true }, username: { type: String, required: true, unique: true }, email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, isVerified: { type: Boolean, default: false }, verificationCode: String, verificationExpires: Date, cart: { type: Array, default: [] }
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Inquiry = mongoose.model('Inquiry', inquirySchema);
const Setting = mongoose.model('Setting', settingSchema);
const Visitor = mongoose.model('Visitor', visitorSchema);
const User = mongoose.model('User', userSchema);

async function getSetting(key, defaultVal) { const doc = await Setting.findOne({ key }); return doc ? doc.value : defaultVal; }
async function setSetting(key, value) { await Setting.updateOne({ key }, { value }, { upsert: true }); }

// ═══════════════════════════════════════════════════════════════════════════
// ─── PRODUCT SYNC ENGINE ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

async function syncProductsToDB(productsArray, { removeOrphans = false, resetStock = false } = {}) {
  if (!Array.isArray(productsArray) || productsArray.length === 0) return { added: 0, updated: 0, removed: 0 };
  let added = 0, updated = 0, removed = 0; const incomingIds = new Set(productsArray.map(p => p.id));
  for (const p of productsArray) { const existing = await Product.findOne({ id: p.id }); if (existing) { const updateData = { ...p }; if (!resetStock) updateData.stock = existing.stock; await Product.updateOne({ id: p.id }, { $set: updateData }); updated++; } else { const newProduct = { ...p, stock: p.stock ?? 100 }; await new Product(newProduct).save(); added++; } }
  if (removeOrphans) { const dbProducts = await Product.find({}, { id: 1 }); for (const dbp of dbProducts) { if (!incomingIds.has(dbp.id)) { await Product.deleteOne({ id: dbp.id }); removed++; } } }
  return { added, updated, removed };
}
async function syncDBToFile() { try { const products = await Product.find().sort({ id: 1 }).lean(); const clean = products.map(({ _id, __v, ...rest }) => rest); fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(clean, null, 2), 'utf8'); return true; } catch (e) { return false; } }
async function syncFileToDB({ removeOrphans = false, resetStock = false } = {}) { try { const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8'); const products = JSON.parse(raw); return await syncProductsToDB(products, { removeOrphans, resetStock }); } catch (e) { return null; } }

let syncDebounce = null;
function startFileWatcher() { try { fs.watch(PRODUCTS_FILE, (eventType) => { if (eventType !== 'change') return; if (syncDebounce) clearTimeout(syncDebounce); syncDebounce = setTimeout(async () => { await syncFileToDB({ removeOrphans: true }); }, 500); }); console.log('[WATCHER] 👀 Watching products.json for changes...'); } catch (e) {} }

async function syncExchangeRate() { try { const apiRes = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 10000 }); if (apiRes.data?.result === 'success' && apiRes.data?.rates?.NPR) { const rate = apiRes.data.rates.NPR; await setSetting('exchange_rate', rate); await setSetting('rate_source', 'live'); await setSetting('rate_fetched_at', new Date().toISOString()); return rate; } } catch (e) {} return null; }
syncExchangeRate(); setInterval(syncExchangeRate, 6 * 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// ─── AUTH & USER ROUTES ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    if (!name || !username || !email || !password) return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 8 || password.length > 30) return res.status(400).json({ error: 'Password must be 8-30 characters' });
    if (await User.findOne({ $or: [{ email }, { username }] })) return res.status(400).json({ error: 'Email or Username already exists' });
    const salt = await bcrypt.genSalt(10); const hashedPassword = await bcrypt.hash(password, salt);
    const otp = generateOTP(); const verificationExpires = new Date(Date.now() + 10 * 60 * 1000);
    const user = new User({ name, username, email, password: hashedPassword, verificationCode: otp, verificationExpires });
    await user.save(); await sendOTPEmail(email, name, otp);
    res.status(201).json({ success: true, message: 'Signup successful! Please check your email for the verification code.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { login, password } = req.body; if (!login || !password) return res.status(400).json({ error: 'Please provide login and password' });
    const user = await User.findOne({ $or: [{ email: login }, { username: login }] });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const isMatch = await bcrypt.compare(password, user.password); if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, email: user.email, isVerified: user.isVerified }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user._id, name: user.name, username: user.username, email: user.email, isVerified: user.isVerified, cart: user.cart } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, code } = req.body; const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'User not found' }); if (user.isVerified) return res.status(400).json({ error: 'User already verified' });
    if (user.verificationCode !== code) return res.status(400).json({ error: 'Invalid verification code' }); if (user.verificationExpires < new Date()) return res.status(400).json({ error: 'Verification code expired' });
    user.isVerified = true; user.verificationCode = undefined; user.verificationExpires = undefined; await user.save();
    const token = jwt.sign({ id: user._id, email: user.email, isVerified: true }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, message: 'Email verified successfully!', token, user: { id: user._id, name: user.name, username: user.username, email: user.email, isVerified: true, cart: user.cart } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/resend-otp', async (req, res) => {
  try {
    const { email } = req.body; const user = await User.findOne({ email }); if (!user) return res.status(400).json({ error: 'User not found' }); if (user.isVerified) return res.status(400).json({ error: 'User already verified' });
    const otp = generateOTP(); user.verificationCode = otp; user.verificationExpires = new Date(Date.now() + 10 * 60 * 1000); await user.save(); await sendOTPEmail(email, user.name, otp);
    res.json({ success: true, message: 'New OTP sent to your email.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', userAuth, async (req, res) => {
  try { const user = await User.findById(req.user.id).select('-password -verificationCode -verificationExpires'); if (!user) return res.status(404).json({ error: 'User not found' }); res.json(user); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cart/sync', userAuth, async (req, res) => {
  try {
    if (!req.user.isVerified) return res.status(403).json({ error: 'Please verify your email to sync cart' });
    const user = await User.findById(req.user.id); const localCart = req.body.cart; if (!localCart || !Array.isArray(localCart)) return res.status(400).json({ error: 'Invalid cart data' });
    let dbCart = [...user.cart]; 
    for (const localItem of localCart) { const existingIndex = dbCart.findIndex(i => i.id === localItem.id && i.unit === localItem.unit && i.form === localItem.form); if (existingIndex >= 0) { dbCart[existingIndex].qty += localItem.qty; } else { dbCart.push(localItem); } }
    user.cart = dbCart; await user.save(); res.json({ success: true, cart: user.cart });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/my-orders', userAuth, async (req, res) => {
  try { const orders = await Order.find({ 'clientDetails.email': req.user.email }).sort({ timestamp: -1 }); res.json(orders); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── ROUTES ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/exchange-rate', checkAuth, async (req, res) => { try { const rate = await getSetting('exchange_rate', 133); res.json({ rate }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/public/rate', async (req, res) => { try { const rate = await getSetting('exchange_rate', 133); res.json({ rate }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/exchange-rate/fetch', checkAuth, async (req, res) => { try { const rate = await syncExchangeRate(); if (rate) res.json({ success: true, rate }); else res.status(502).json({ error: 'Failed' }); } catch (e) { res.status(502).json({ error: 'Failed' }); } });
app.get('/api/public/visits', async (req, res) => { try { const ip = getClientIp(req); await Visitor.updateOne({ ip }, { $set: { lastVisited: new Date() } }, { upsert: true }); const baseCount = await getSetting('base_visitor_count', 5000); const uniqueCount = await Visitor.countDocuments({}); res.json({ count: baseCount + uniqueCount }); } catch (e) { res.json({ count: 5000 }); } });
app.get('/', (req, res) => res.send('🌿 NaturaBotanica API Active'));
app.get('/api/health', async (req, res) => { try { await mongoose.connection.db.admin().ping(); res.json({ status: 'healthy' }); } catch (e) { res.status(503).json({ status: 'unhealthy' }); } });
app.get('/api/view-orders-data', checkAuth, async (req, res) => { try { const orders = await Order.find().sort({ timestamp: -1 }).limit(100); res.json({ success: true, orders, count: orders.length }); } catch (error) { res.status(500).json({ success: false, error: error.message }); } });

app.get('/api/products', async (req, res) => { try { const products = await Product.find().sort({ id: 1 }).lean(); res.json(products.map(({ _id, __v, ...rest }) => rest)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/products/:id', async (req, res) => { try { const product = await Product.findOne({ id: Number(req.params.id) }).lean(); if (!product) return res.status(404).json({ error: 'Product not found' }); const { _id, __v, ...rest } = product; res.json(rest); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/products', checkAuth, async (req, res) => { try { const { id, name, price } = req.body; if (!id || !name || price === undefined) return res.status(400).json({ error: 'Required' }); if (await Product.findOne({ id })) return res.status(409).json({ error: 'Exists' }); const p = new Product({ ...req.body, stock: req.body.stock ?? 100 }); await p.save(); await syncDBToFile(); res.status(201).json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/products/:id', checkAuth, async (req, res) => { try { const updateData = { ...req.body }; if (req.body.stock === undefined) delete updateData.stock; await Product.updateOne({ id: Number(req.params.id) }, { $set: updateData }); await syncDBToFile(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/products/:id', checkAuth, async (req, res) => { try { const result = await Product.deleteOne({ id: Number(req.params.id) }); if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' }); await syncDBToFile(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/products/bulk', checkAuth, async (req, res) => { try { if (!Array.isArray(req.body.products)) return res.status(400).json({ error: 'Array required' }); const result = await syncProductsToDB(req.body.products, { removeOrphans: false }); await syncDBToFile(); res.json({ success: true, ...result }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/seed', checkAuth, async (req, res) => { try { await Product.deleteMany({}); await Product.insertMany(require('./products.json')); res.json({ success: true }); } catch (e) { res.status(500).send(e.message); } });
app.get('/api/sync-products', checkAuth, async (req, res) => { try { const result = await syncFileToDB({ removeOrphans: true }); res.json({ success: true, ...result }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/seed-stock', checkAuth, async (req, res) => { try { await Product.updateMany({}, { $set: { stock: 100 } }); res.send('Stocks reset'); } catch (e) { res.status(500).send(e.message); } });

app.post('/api/orders', async (req, res) => { try { const errors = validateOrder(req.body); if (errors.length > 0) return res.status(400).json({ success: false, errors }); req.body.clientDetails.name = req.body.clientDetails.name.trim().substring(0, 100); req.body.clientDetails.email = req.body.clientDetails.email.trim().toLowerCase(); req.body.clientDetails.phone = req.body.clientDetails.phone.trim().substring(0, 20); const savedOrder = await new Order({ ...req.body, order_state: 'Pending' }).save(); await sendAdminAlert(savedOrder._id, req.body); res.status(201).json({ success: true, orderId: savedOrder._id }); } catch (e) { res.status(500).json({ success: false, error: 'Server error' }); } });
const STOCK_DEDUCT_STATUSES = ['Completed', 'Success', 'Shipping'];
app.put('/api/update-status', checkAuth, async (req, res) => { try { const { id, status } = req.body; const order = await Order.findOne({ _id: id }); if (!order) return res.status(404).json({ success: false }); const wasDeducted = STOCK_DEDUCT_STATUSES.includes(order.status); const shouldDeduct = STOCK_DEDUCT_STATUSES.includes(status); await Order.updateOne({ _id: id }, { status, emailStatus: 'Queue' }); if (shouldDeduct && !wasDeducted) { for (const item of (order.items || [])) await Product.updateOne({ id: item.id }, { $inc: { stock: -(parseInt(item.qty) || 1) } }); } else if (!shouldDeduct && wasDeducted) { for (const item of (order.items || [])) await Product.updateOne({ id: item.id }, { $inc: { stock: (parseInt(item.qty) || 1) } }); } let emailStat = 'Queue'; if (order.clientDetails?.email?.includes('@')) { emailStat = await sendClientEmail(order.clientDetails.email, order.clientDetails.name, id, status) ? 'Sent' : 'Failed'; await Order.updateOne({ _id: id }, { emailStatus: emailStat }); } res.json({ success: true, emailStatus: emailStat }); } catch (e) { res.status(500).json({ success: false, emailStatus: 'Failed' }); } });
app.put('/api/update-order-state', checkAuth, async (req, res) => { try { const { id, state } = req.body; if (!id || !state) return res.status(400).json({ success: false }); await Order.updateOne({ _id: id }, { $set: { order_state: state } }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });
app.post('/api/inquiries', async (req, res) => { try { if (!req.body.email || !req.body.message) return res.status(400).json({ error: 'Missing' }); await new Inquiry(req.body).save(); await sendInquiryAlert(req.body); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/delete-order/:id', checkAuth, async (req, res) => { try { await Order.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });
app.delete('/api/delete-orders', checkAuth, async (req, res) => { try { await Order.deleteMany({ _id: { $in: req.body.ids } }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });
app.put('/api/update-stock', checkAuth, async (req, res) => { try { await Product.updateOne({ id: req.body.id }, { $set: { stock: req.body.stock } }); await syncDBToFile(); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });

app.get('/api/manage-stock', checkAuth, async (req, res) => { try { const products = await Product.find().sort({ id: 1 }); let rows = products.map(p => { const s = p.stock || 0; let badge = s === 0 ? '<span style="color:#b91c1c">Out</span>' : s <= 10 ? '<span style="color:#c2410c">Low</span>' : '<span style="color:#15803d">In Stock</span>'; return `<tr><td><strong>${p.name}</strong></td><td>${p.catLabel}</td><td>${badge} (${s})</td><td><input type="number" id="s-${p.id}" value="${s}" min="0"></td><td><button onclick="save(${p.id})">Save</button></td></tr>`; }).join(''); res.send(`<html><body><table border="1">${rows}</table><script>async function save(id){const v=document.getElementById('s-'+id).value; await fetch('/api/update-stock',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'${req.headers['authorization']}'}},body:JSON.stringify({id,stock:v})}); location.reload();}</script></body></html>`); } catch (e) { res.status(500).send('Error'); } });
app.get('/api/view-orders', checkAuth, async (req, res) => { try { let html = fs.readFileSync(path.join(__dirname, 'views/orders.html'), 'utf8'); res.send(html); } catch (e) { res.status(500).send('Error'); } });

// User Profile Route
app.get('/profile', (req, res) => { try { let html = fs.readFileSync(path.join(__dirname, 'views/user.html'), 'utf8'); res.send(html); } catch (e) { res.status(500).send('Error loading profile page'); } });

async function startup() { console.log('[STARTUP] 🔄 Syncing products...'); await syncFileToDB({ removeOrphans: true }); startFileWatcher(); }
startup();

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });
app.listen(port, () => console.log(`🚀 Secure Server running on port ${port}`));
