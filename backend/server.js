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
const requiredEnvVars = ['MONGO_URI', 'EMAIL_PASS', 'ADMIN_USER', 'ADMIN_PASSWORD', 'RECEIVER_EMAIL', 'JWT_SECRET'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) { console.error(`❌ FATAL: Missing environment variables: ${missing.join(', ')}`); process.exit(1); }

// ─── MIDDLEWARE ────────────────────────────────────────────────
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || origin === 'null') return callback(null, true); // Allow local file:// and null origin
    const allowedDomains = ['ayurved-rasrasayan.github.io', 'localhost', '127.0.0.1'];
    if (allowedDomains.some(domain => origin.includes(domain))) return callback(null, true);
    console.log(`[CORS BLOCKED] Origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};

app.use(express.json({ limit: '10mb' }));
app.use(cors(corsOptions));
app.use(cookieParser());

// ─── HELPERS & MIDDLEWARE ────────────────────────────────────────────────
const checkAdminAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) { res.setHeader('WWW-Authenticate', 'Basic realm="Admin"'); return res.status(401).send('Authentication Required'); }
  try { const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString(); const [user, pass] = decoded.split(':'); if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD) return next(); } catch (e) {}
  res.setHeader('WWW-Authenticate', 'Basic realm="Admin"'); return res.status(401).send('Access Denied');
};

const requireAuth = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); } catch (err) { return res.status(401).json({ error: 'Invalid or expired token' }); }
};

const getClientIp = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

const validateOrder = (data) => {
  const errors = [];
  if (!data.items || !Array.isArray(data.items) || !data.items.length) errors.push('Items required');
  else data.items.forEach((item, i) => { if (!item.name) errors.push(`Item ${i}: missing name`); if (typeof item.price !== 'number' || item.price < 0) errors.push(`Item ${i}: invalid price`); });
  if (typeof data.totalUSD !== 'number' || data.totalUSD < 0) errors.push('Invalid totalUSD');
  if (!data.clientDetails || typeof data.clientDetails !== 'object') errors.push('Client details required');
  else { if (!data.clientDetails.name) errors.push('Client name required'); if (!data.clientDetails.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.clientDetails.email)) errors.push('Valid email required'); if (!data.clientDetails.phone) errors.push('Phone required'); }
  return errors;
};

// ─── EMAIL HELPER ────────────────────────────────────────────────────────
async function sendEmail(toEmail, toName, subject, htmlContent) {
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: toEmail, name: toName }],
      subject, htmlContent
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    return true;
  } catch (e) { console.error('[EMAIL] ❌ Error:', e.response?.data || e.message); return false; }
}

// ─── DATABASE & SCHEMAS ────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ MongoDB Connected')).catch(err => { console.error('❌ MongoDB Error:', err); process.exit(1); });

const productSchema = new mongoose.Schema({ id: Number, name: String, sci: String, category: String, catLabel: String, price: Number, unit: String, moq: String, lead: String, img: String, desc: String, stock: { type: Number, default: 100 } });
const orderSchema = new mongoose.Schema({ items: Array, totalUSD: Number, totalNPR: Number, paidAmount: Number, currency: String, paymentMethod: String, paymentScreenshot: String, clientDetails: { name: String, phone: String, email: String, address: String }, status: { type: String, default: 'Pending' }, order_state: { type: String, default: 'Pending' }, emailStatus: { type: String, default: 'Queue' }, timestamp: { type: Date, default: Date.now } });
const inquirySchema = new mongoose.Schema({ firstName: String, lastName: String, email: String, company: String, message: String, timestamp: { type: Date, default: Date.now } });
const settingSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: mongoose.Schema.Types.Mixed });
const visitorSchema = new mongoose.Schema({ ip: { type: String, unique: true, index: true }, lastVisited: { type: Date, default: Date.now } });
const userSchema = new mongoose.Schema({ name: { type: String, required: true }, email: { type: String, required: true, unique: true, lowercase: true }, password: { type: String, required: true }, phone: { type: String, default: '' }, address: { type: String, default: '' }, cart: [{ id: Number, name: String, price: Number, qty: Number, unit: String, form: String, img: String }], isVerified: { type: Boolean, default: false }, verificationOTP: String, verificationOTPExpire: Date, resetPasswordToken: String, resetPasswordExpire: Date, role: { type: String, default: 'customer' }, timestamp: { type: Date, default: Date.now } });

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Inquiry = mongoose.model('Inquiry', inquirySchema);
const Setting = mongoose.model('Setting', settingSchema);
const Visitor = mongoose.model('Visitor', visitorSchema);
const User = mongoose.model('User', userSchema);

const getSetting = async (key, defaultVal) => { const doc = await Setting.findOne({ key }); return doc ? doc.value : defaultVal; };
const setSetting = async (key, value) => { await Setting.updateOne({ key }, { value }, { upsert: true }); };

// ─── PRODUCT SYNC ENGINE ──────────────────────────────────────────
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

async function syncProductsToDB(productsArray, { removeOrphans = false, resetStock = false } = {}) {
  if (!Array.isArray(productsArray) || !productsArray.length) return { added: 0, updated: 0, removed: 0 };
  let added = 0, updated = 0, removed = 0;
  const incomingIds = new Set(productsArray.map(p => p.id));
  for (const p of productsArray) {
    const existing = await Product.findOne({ id: p.id });
    if (existing) { const updateData = { ...p }; if (!resetStock) updateData.stock = existing.stock; await Product.updateOne({ id: p.id }, { $set: updateData }); updated++; }
    else { await new Product({ ...p, stock: p.stock ?? 100 }).save(); added++; }
  }
  if (removeOrphans) { for (const dbp of await Product.find({}, { id: 1 })) { if (!incomingIds.has(dbp.id)) { await Product.deleteOne({ id: dbp.id }); removed++; } } }
  return { added, updated, removed };
}

async function syncDBToFile() { try { const products = await Product.find().sort({ id: 1 }).lean(); fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products.map(({ _id, __v, ...rest }) => rest), null, 2)); return true; } catch (e) { return false; } }
async function syncFileToDB(opts = {}) { try { return await syncProductsToDB(JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8')), opts); } catch (e) { return null; } }

let syncDebounce;
function startFileWatcher() { try { fs.watch(PRODUCTS_FILE, (eventType) => { if (eventType !== 'change') return; clearTimeout(syncDebounce); syncDebounce = setTimeout(async () => await syncFileToDB({ removeOrphans: true }), 500); }); } catch (e) {} }

// ─── EXCHANGE RATE SYNC ────────────────────────────────────────────
async function syncExchangeRate() { try { const apiRes = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 10000 }); if (apiRes.data?.result === 'success' && apiRes.data?.rates?.NPR) { await setSetting('exchange_rate', apiRes.data.rates.NPR); await setSetting('rate_source', 'live'); console.log(`💱 Rate synced: 1 USD = ${apiRes.data.rates.NPR} NPR`); } } catch (e) {} }
syncExchangeRate(); setInterval(syncExchangeRate, 6 * 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// ─── ROUTES ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ─── PUBLIC ROUTES ─────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('🌿 NaturaBotanica API Active'));
app.get('/api/health', async (req, res) => { try { await mongoose.connection.db.admin().ping(); res.json({ status: 'healthy' }); } catch (e) { res.status(503).json({ status: 'unhealthy' }); } });
app.get('/api/public/rate', async (req, res) => { try { res.json({ rate: await getSetting('exchange_rate', 133) }); } catch (e) { res.status(500).json({ error: e.message }); } });

app.get('/api/public/visits', async (req, res) => {
  try { const ip = getClientIp(req); await Visitor.updateOne({ ip }, { $set: { lastVisited: new Date() } }, { upsert: true }); res.json({ count: (await getSetting('base_visitor_count', 5000)) + await Visitor.countDocuments({}) }); } catch (e) { res.json({ count: 5000 }); }
});

app.get('/api/products', async (req, res) => { try { res.json((await Product.find().sort({ id: 1 }).lean()).map(({ _id, __v, ...rest }) => rest)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/orders', async (req, res) => { try { const errors = validateOrder(req.body); if (errors.length) return res.status(400).json({ success: false, errors }); const saved = await new Order(req.body).save(); await sendEmail('sales.naturabotanica20@gmail.com', 'Sales Team', `🛒 NEW ORDER: #${saved._id}`, `<h2>New Order</h2><p>Name: ${req.body.clientDetails.name}<br>Email: ${req.body.clientDetails.email}</p>`); res.status(201).json({ success: true, orderId: saved._id }); } catch (e) { res.status(500).json({ success: false, error: 'Server error' }); } });
app.post('/api/inquiries', async (req, res) => { try { if (!req.body.email || !req.body.message) return res.status(400).json({ error: 'Missing fields' }); await new Inquiry(req.body).save(); await sendEmail(process.env.RECEIVER_EMAIL, 'Sales', `📨 New Inquiry: ${req.body.firstName}`, `<p>${req.body.message}</p>`); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ─── AUTH ROUTES ─────────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  try { 
    const { name, email, password } = req.body; 
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,20}$/.test(password)) return res.status(400).json({ error: 'Password must be 8-20 chars, with uppercase, lowercase, number, and special char.' }); 
    if (await User.findOne({ email })) { const existing = await User.findOne({ email }); if (!existing.isVerified) { const otp = Math.floor(100000 + Math.random() * 900000).toString(); existing.verificationOTP = crypto.createHash('sha256').update(otp).digest('hex'); existing.verificationOTPExpire = Date.now() + 600000; await existing.save(); await sendEmail(email, existing.name, 'NaturaBotanica - Verification Code', `<p>Your code: <b>${otp}</b></p>`); return res.status(200).json({ success: true, message: 'New code sent!' }); } return res.status(400).json({ error: 'Email already in use.' }); } 
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); 
    await new User({ name, email, password: await bcrypt.hash(password, 10), verificationOTP: crypto.createHash('sha256').update(otp).digest('hex'), verificationOTPExpire: Date.now() + 600000 }).save(); 
    await sendEmail(email, name, 'NaturaBotanica - Verification Code', `<p>Your code: <b>${otp}</b></p>`); 
    res.status(201).json({ success: true, message: 'Account created! Check email for code.' }); 
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/verify-otp', async (req, res) => { 
  try { const { email, otp } = req.body; const user = await User.findOne({ email, verificationOTP: crypto.createHash('sha256').update(otp).digest('hex'), verificationOTPExpire: { $gt: Date.now() } }); if (!user) return res.status(400).json({ error: 'Invalid or expired code.' }); user.isVerified = true; user.verificationOTP = undefined; user.verificationOTPExpire = undefined; await user.save(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } 
});

app.post('/api/auth/resend-otp', async (req, res) => { 
  try { const { email } = req.body; const user = await User.findOne({ email }); if (!user || user.isVerified) return res.status(200).json({ success: true }); const otp = Math.floor(100000 + Math.random() * 900000).toString(); user.verificationOTP = crypto.createHash('sha256').update(otp).digest('hex'); user.verificationOTPExpire = Date.now() + 600000; await user.save(); await sendEmail(email, user.name, 'NaturaBotanica - Verification Code', `<p>Your code: <b>${otp}</b></p>`); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } 
});

app.post('/api/auth/login', async (req, res) => {
  try { 
    const { email, password, guestCart } = req.body; const user = await User.findOne({ email }); 
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Invalid credentials.' }); 
    if (!user.isVerified) return res.status(403).json({ error: 'Please verify your email first.', needsVerification: true }); 
    if (guestCart?.length) { let dbCart = user.cart || []; for (const g of guestCart) { const idx = dbCart.findIndex(d => d.id === g.id && d.unit === g.unit && d.form === g.form); if (idx >= 0) dbCart[idx].qty += g.qty; else dbCart.push(g); } user.cart = dbCart; await user.save(); } 
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' }); 
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'none', maxAge: 604800000 }); 
    const { password: pw, verificationOTP, verificationOTPExpire, resetPasswordToken, resetPasswordExpire, ...userData } = user._doc; 
    res.json({ success: true, user: userData }); 
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', requireAuth, async (req, res) => { try { const user = await User.findById(req.user.id).select('-password -verificationOTP -verificationOTPExpire -resetPasswordToken -resetPasswordExpire'); res.json(user); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/auth/logout', (req, res) => { res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'none' }); res.json({ success: true }); });
app.post('/api/auth/sync-cart', requireAuth, async (req, res) => { try { const user = await User.findById(req.user.id); user.cart = req.body.cart || []; await user.save(); res.json({ success: true, cart: user.cart }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/auth/forgot-password', async (req, res) => { try { const user = await User.findOne({ email: req.body.email }); if (!user) return res.json({ success: true }); const token = crypto.randomBytes(20).toString('hex'); user.resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex'); user.resetPasswordExpire = Date.now() + 900000; await user.save(); await sendEmail(user.email, user.name, 'Password Reset', `<a href="${process.env.FRONTEND_URL}/reset-password.html?token=${token}">Reset</a>`); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/auth/reset-password', async (req, res) => { try { if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,20}$/.test(req.body.password)) return res.status(400).json({ error: 'Invalid password format' }); const user = await User.findOne({ resetPasswordToken: crypto.createHash('sha256').update(req.body.token).digest('hex'), resetPasswordExpire: { $gt: Date.now() } }); if (!user) return res.status(400).json({ error: 'Invalid token' }); user.password = await bcrypt.hash(req.body.password, 10); user.resetPasswordToken = undefined; user.resetPasswordExpire = undefined; await user.save(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────
app.get('/api/view-orders', checkAdminAuth, async (req, res) => { try { res.send(fs.readFileSync(path.join(__dirname, 'views/orders.html'), 'utf8')); } catch (e) { res.status(500).send('Error'); } });
app.get('/api/view-orders-data', checkAdminAuth, async (req, res) => { try { res.json({ success: true, orders: await Order.find().sort({ timestamp: -1 }).limit(100) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/view-users', checkAdminAuth, async (req, res) => { try { res.send(fs.readFileSync(path.join(__dirname, 'views/users.html'), 'utf8')); } catch (e) { res.status(500).send('Error'); } });
app.get('/api/view-users-data', checkAdminAuth, async (req, res) => { try { res.json({ success: true, users: await User.find().select('-password -verificationOTP -verificationOTPExpire -resetPasswordToken -resetPasswordExpire -__v').sort({ timestamp: -1 }).lean() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/delete-user/:id', checkAdminAuth, async (req, res) => { try { await User.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });
app.delete('/api/delete-order/:id', checkAdminAuth, async (req, res) => { try { await Order.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });
app.delete('/api/delete-orders', checkAdminAuth, async (req, res) => { try { await Order.deleteMany({ _id: { $in: req.body.ids } }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });

app.put('/api/update-status', checkAdminAuth, async (req, res) => { 
  try { const { id, status } = req.body; await Order.updateOne({ _id: id }, { status, emailStatus: 'Queue' }); const order = await Order.findById(id); if (order?.clientDetails?.email) await sendEmail(order.clientDetails.email, order.clientDetails.name, id, status); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } 
});
app.put('/api/update-order-state', checkAdminAuth, async (req, res) => { try { await Order.updateOne({ _id: req.body.id }, { $set: { order_state: req.body.state } }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });

app.get('/api/manage-stock', checkAdminAuth, async (req, res) => { 
  try { const products = await Product.find().sort({ id: 1 }); let rows = products.map(p => { const s = p.stock || 0; let b = '<span style="color:#15803d">In Stock</span>'; if (s === 0) b = '<span style="color:#b91c1c">Out</span>'; else if (s <= 10) b = '<span style="color:#c2410c">Low</span>'; return `<tr><td data-label="Product"><div class="pi"><img src="${p.img}" class="pimg" onerror="this.style.display='none'"><div><strong>${p.name}</strong><div style="font-size:10px;color:#6b7280">${p.sci}</div></div></div></td><td data-label="Category" style="font-size:13px;color:#6b7280">${p.catLabel}</td><td data-label="Current">${b} (${s})</td><td data-label="New Stock"><input type="number" class="si" id="s-${p.id}" value="${s}" min="0" onchange="document.getElementById('b-${p.id}').classList.add('sv')"></td><td data-label="Action"><button class="sb" id="b-${p.id}" onclick="save(${p.id})">Save</button></td></tr>`; }).join(''); res.send(fs.readFileSync(path.join(__dirname, 'views/stock.html'), 'utf8').replace('{{STOCK_ROWS}}', rows)); } catch (e) { res.status(500).send('Error'); } 
});
app.put('/api/update-stock', checkAdminAuth, async (req, res) => { try { await Product.updateOne({ id: req.body.id }, { $set: { stock: req.body.stock } }); await syncDBToFile(); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });

app.post('/api/products', checkAdminAuth, async (req, res) => { try { await new Product({ ...req.body, stock: req.body.stock ?? 100 }).save(); await syncDBToFile(); res.status(201).json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/products/:id', checkAdminAuth, async (req, res) => { try { await Product.updateOne({ id: Number(req.params.id) }, { $set: req.body }); await syncDBToFile(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/products/:id', checkAdminAuth, async (req, res) => { try { await Product.deleteOne({ id: Number(req.params.id) }); await syncDBToFile(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/products/bulk', checkAdminAuth, async (req, res) => { try { res.json({ success: true, ...await syncProductsToDB(req.body.products) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/seed', checkAdminAuth, async (req, res) => { try { await Product.deleteMany({}); await Product.insertMany(require('./products.json')); res.json({ success: true }); } catch (e) { res.status(500).send(e.message); } });
app.get('/api/sync-products', checkAdminAuth, async (req, res) => { try { res.json({ success: true, ...await syncFileToDB({ removeOrphans: true }) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/seed-stock', checkAdminAuth, async (req, res) => { try { await Product.updateMany({}, { $set: { stock: 100 } }); res.send('Stocks reset'); } catch (e) { res.status(500).send(e.message); } });

// ─── STARTUP ─────────────────────────────────────────────────────────────
async function startup() { await syncFileToDB({ removeOrphans: true }); startFileWatcher(); }
startup();

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

app.listen(port, () => console.log(`🚀 Secure Server running on port ${port}`));
