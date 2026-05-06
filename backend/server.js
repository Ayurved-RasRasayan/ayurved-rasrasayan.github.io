const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

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

// ─── EMAIL FUNCTIONS ─────────────────────────────────────────────────────────
async function sendClientEmail(toEmail, toName, orderId, status) {
  try {
    let displayStatus = status === 'Success' ? 'Payment Successful' : status;
    const res = await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: toEmail, name: toName }],
      subject: `Order Update: #${orderId}`,
      htmlContent: `<h3>Hello ${toName},</h3><p>Your order #${orderId} is now: <strong>${displayStatus}</strong>.</p><p>Thank you!</p>`
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    return !!res.data?.messageId;
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
      htmlContent: `
        <div style="font-family:Arial;color:#333;padding:20px;border:1px solid #eee;">
          <h2 style="color:#A3B14B;">New Inquiry Received</h2>
          <p style="background:#f9fafb;padding:10px;border-radius:5px;">
            <strong>Name:</strong> ${fullName}<br>
            <strong>Email:</strong> ${data.email}<br>
            <strong>Phone:</strong> ${data.phone || 'N/A'}<br>
            <strong>Company:</strong> ${data.company || 'N/A'}
          </p>
          <div style="margin-top:20px;">
            <strong>Message:</strong>
            <p style="background:#fff;padding:15px;border:1px solid #eee;margin-top:5px;">${data.message}</p>
          </div>
        </div>
      `
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    return true;
  } catch (e) {
    console.error('[INQUIRY EMAIL] ❌ Error:', e.response?.data || e.message);
    return false;
  }
}

// ─── DATABASE CONNECT & SCHEMAS ────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ MongoDB Connected')).catch(err => { console.error('❌ MongoDB Error:', err); process.exit(1); });

const productSchema = new mongoose.Schema({
  id: Number,
  name: String,
  sci: String,
  category: String,
  catLabel: String,
  price: Number,
  unit: String,
  moq: String,
  lead: String,
  img: String,
  desc: String,
  stock: { type: Number, default: 100 }
});

const orderSchema = new mongoose.Schema({
  items: Array,
  totalUSD: Number,
  totalNPR: Number,
  paidAmount: Number,
  currency: String,
  paymentMethod: String,
  paymentScreenshot: String,
  clientDetails: { name: String, phone: String, email: String, address: String },
  status: { type: String, default: 'Pending' },
  order_state: { type: String, default: 'Pending' },
  emailStatus: { type: String, default: 'Queue' },
  timestamp: { type: Date, default: Date.now }
});

const inquirySchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String,
  company: String,
  message: String,
  timestamp: { type: Date, default: Date.now }
});

const settingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Inquiry = mongoose.model('Inquiry', inquirySchema);
const Setting = mongoose.model('Setting', settingSchema);

// ─── HELPER: Get/Set DB Setting ─────────────────────────────────────────────
async function getSetting(key, defaultVal) {
  const doc = await Setting.findOne({ key });
  return doc ? doc.value : defaultVal;
}
async function setSetting(key, value) {
  await Setting.updateOne({ key }, { value }, { upsert: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── PRODUCT SYNC ENGINE ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const PRODUCTS_FILE = path.join(__dirname, 'products.json');

async function syncProductsToDB(productsArray, { removeOrphans = false, resetStock = false } = {}) {
  if (!Array.isArray(productsArray) || productsArray.length === 0) {
    console.warn('[SYNC] Empty or invalid products array, skipping.');
    return { added: 0, updated: 0, removed: 0 };
  }

  let added = 0, updated = 0, removed = 0;
  const incomingIds = new Set(productsArray.map(p => p.id));

  for (const p of productsArray) {
    const existing = await Product.findOne({ id: p.id });

    if (existing) {
      const updateData = { ...p };
      if (!resetStock) {
        updateData.stock = existing.stock;
      }
      await Product.updateOne({ id: p.id }, { $set: updateData });
      updated++;
    } else {
      const newProduct = { ...p, stock: p.stock ?? 100 };
      await new Product(newProduct).save();
      added++;
    }
  }

  if (removeOrphans) {
    const dbProducts = await Product.find({}, { id: 1 });
    for (const dbp of dbProducts) {
      if (!incomingIds.has(dbp.id)) {
        await Product.deleteOne({ id: dbp.id });
        removed++;
      }
    }
  }

  console.log(`[SYNC] ✅ Added: ${added}, Updated: ${updated}, Removed: ${removed}`);
  return { added, updated, removed };
}

async function syncDBToFile() {
  try {
    const products = await Product.find().sort({ id: 1 }).lean();
    const clean = products.map(({ _id, __v, ...rest }) => rest);
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(clean, null, 2), 'utf8');
    console.log(`[SYNC] 📝 products.json updated (${clean.length} products)`);
    return true;
  } catch (e) {
    console.error('[SYNC] ❌ Failed to write products.json:', e.message);
    return false;
  }
}

async function syncFileToDB({ removeOrphans = false, resetStock = false } = {}) {
  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8');
    const products = JSON.parse(raw);
    return await syncProductsToDB(products, { removeOrphans, resetStock });
  } catch (e) {
    console.error('[SYNC] ❌ Failed to read/parse products.json:', e.message);
    return null;
  }
}

// ─── FILE WATCHER ────────────────────────────────────────────────
let watcherReady = false;
let syncDebounce = null;

function startFileWatcher() {
  try {
    const watcher = fs.watch(PRODUCTS_FILE, (eventType) => {
      if (eventType !== 'change') return;

      if (syncDebounce) clearTimeout(syncDebounce);
      syncDebounce = setTimeout(async () => {
        console.log('[WATCHER] 📂 products.json changed — syncing to DB...');
        const result = await syncFileToDB({ removeOrphans: true });
        if (result) {
          console.log(`[WATCHER] ✅ Sync complete: +${result.added} ~${result.updated} -${result.removed}`);
        } else {
          console.error('[WATCHER] ❌ Sync failed');
        }
      }, 500);
    });

    watcher.on('error', (err) => {
      console.error('[WATCHER] ❌ File watch error:', err.message);
    });

    watcherReady = true;
    console.log('[WATCHER] 👀 Watching products.json for changes...');
  } catch (e) {
    console.warn('[WATCHER] ⚠️ Could not start file watcher:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── AUTO-SYNC EXCHANGE RATE ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

async function syncExchangeRate() {
  try {
    const apiRes = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 10000 });
    if (apiRes.data?.result === 'success' && apiRes.data?.rates?.NPR) {
      const rate = apiRes.data.rates.NPR;
      await setSetting('exchange_rate', rate);
      await setSetting('rate_source', 'live');
      await setSetting('rate_fetched_at', new Date().toISOString());
      console.log(`💱 Exchange rate synced: 1 USD = ${rate} NPR (${new Date().toLocaleTimeString()})`);
      return rate;
    }
  } catch (e) {
    console.warn('💱 Rate sync failed:', e.message);
  }
  return null;
}

syncExchangeRate();
setInterval(syncExchangeRate, 6 * 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// ─── ROUTES ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ─── ROUTE: GET EXCHANGE RATE ────────────────────────────────────────────
app.get('/api/exchange-rate', checkAuth, async (req, res) => {
  try {
    const rate = await getSetting('exchange_rate', 133);
    const source = await getSetting('rate_source', 'default');
    const fetchedAt = await getSetting('rate_fetched_at', null);
    res.json({ rate, source, fetchedAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/public/rate', async (req, res) => {
  try {
    const rate = await getSetting('exchange_rate', 133);
    res.json({ rate });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/exchange-rate/fetch', checkAuth, async (req, res) => {
  try {
    const rate = await syncExchangeRate();
    if (rate) {
      res.json({ success: true, rate });
    } else {
      const fallback = await getSetting('exchange_rate', 133);
      res.status(502).json({ error: 'Failed to fetch live rate', rate: fallback });
    }
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch live rate: ' + e.message });
  }
});

// ─── ROUTE: BASE & HEALTH ────────────────────────────────────────────────
app.get('/', (req, res) => res.send('🌿 NaturaBotanica API Active'));
app.get('/api/health', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'healthy' });
  } catch (e) { res.status(503).json({ status: 'unhealthy' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── ROUTE: ORDERS DATA API (JSON) ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// JSON API for orders data (used by orders.html)
app.get('/api/view-orders-data', checkAuth, async (req, res) => {
    try {
        const orders = await Order.find().sort({ timestamp: -1 }).limit(100);
        
        const cleanOrders = orders.map(order => ({
            _id: order._id,
            items: order.items || [],
            totalUSD: order.totalUSD,
            totalNPR: order.totalNPR,
            paidAmount: order.paidAmount,
            currency: order.currency,
            paymentMethod: order.paymentMethod,
            paymentScreenshot: order.paymentScreenshot,
            clientDetails: order.clientDetails,
            status: order.status || 'Pending',
            order_state: order.order_state || 'Pending',
            emailStatus: order.emailStatus || 'Queue',
            timestamp: order.timestamp
        }));
        
        res.json({ 
            success: true, 
            orders: cleanOrders,
            count: cleanOrders.length
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── ROUTE: PRODUCTS ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ id: 1 }).lean();
    // Include stock field - remove only _id and __v
    const clean = products.map(({ _id, __v, ...rest }) => rest);
    // 'rest' now includes stock field automatically
    res.json(clean);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findOne({ id: Number(req.params.id) }).lean();
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const { _id, __v, ...rest } = product;
    res.json(rest);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/products', checkAuth, async (req, res) => {
  try {
    const { id, name, price, category } = req.body;
    if (!id || !name || price === undefined) {
      return res.status(400).json({ success: false, error: 'id, name, and price are required' });
    }

    const existing = await Product.findOne({ id });
    if (existing) {
      return res.status(409).json({ success: false, error: `Product with id ${id} already exists` });
    }

    const newProduct = new Product({ ...req.body, stock: req.body.stock ?? 100 });
    await newProduct.save();
    await syncDBToFile();

    console.log(`[PRODUCT] ✅ Added: #${id} ${name}`);
    res.status(201).json({ success: true, product: newProduct.toObject() });
  } catch (e) {
    console.error('[PRODUCT] ❌ Add error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/products/:id', checkAuth, async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const existing = await Product.findOne({ id: productId });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const updateData = { ...req.body };
    if (req.body.stock === undefined) {
      delete updateData.stock;
    }

    await Product.updateOne({ id: productId }, { $set: updateData });
    await syncDBToFile();

    console.log(`[PRODUCT] ✏️ Updated: #${productId}`);
    res.json({ success: true });
  } catch (e) {
    console.error('[PRODUCT] ❌ Update error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/products/:id', checkAuth, async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const result = await Product.deleteOne({ id: productId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    await syncDBToFile();

    console.log(`[PRODUCT] 🗑️ Deleted: #${productId}`);
    res.json({ success: true });
  } catch (e) {
    console.error('[PRODUCT] ❌ Delete error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/products/bulk', checkAuth, async (req, res) => {
  try {
    if (!Array.isArray(req.body.products)) {
      return res.status(400).json({ success: false, error: 'products array required' });
    }

    const result = await syncProductsToDB(req.body.products, { removeOrphans: false, resetStock: false });
    await syncDBToFile();

    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/seed', checkAuth, async (req, res) => {
  try {
    await Product.deleteMany({});
    const myProducts = require('./products.json');
    await Product.insertMany(myProducts);
    res.json({ success: true, count: myProducts.length, message: 'Full re-seed complete' });
  } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/sync-products', checkAuth, async (req, res) => {
  try {
    const result = await syncFileToDB({ removeOrphans: true });
    if (result) {
      res.json({ success: true, ...result });
    } else {
      res.status(500).json({ success: false, error: 'Sync failed' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/seed-stock', checkAuth, async (req, res) => {
  try { await Product.updateMany({}, { $set: { stock: 100 } }); res.send('Stocks reset'); } catch (e) { res.status(500).send(e.message); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── ROUTE: ORDERS ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/orders', async (req, res) => {
  try {
    const errors = validateOrder(req.body);
    if (errors.length > 0) return res.status(400).json({ success: false, errors });
    req.body.clientDetails.name = req.body.clientDetails.name.trim().substring(0, 100);
    req.body.clientDetails.email = req.body.clientDetails.email.trim().toLowerCase();
    req.body.clientDetails.phone = req.body.clientDetails.phone.trim().substring(0, 20);
    
    const orderData = {
      ...req.body,
      order_state: 'Pending'
    };
    
    const savedOrder = await new Order(orderData).save();
    await sendAdminAlert(savedOrder._id, req.body);
    res.status(201).json({ success: true, orderId: savedOrder._id });
  } catch (e) { 
    console.error('Order creation error:', e);
    res.status(500).json({ success: false, error: 'Server error' }); 
  }
});

const STOCK_DEDUCT_STATUSES = ['Completed', 'Success', 'Shipping'];

app.put('/api/update-status', checkAuth, async (req, res) => {
  try {
    const { id, status } = req.body;
    const order = await Order.findOne({ _id: id });
    if (!order) return res.status(404).json({ success: false });

    const wasDeducted = STOCK_DEDUCT_STATUSES.includes(order.status);
    const shouldDeduct = STOCK_DEDUCT_STATUSES.includes(status);

    await Order.updateOne({ _id: id }, { status, emailStatus: 'Queue' });

    if (shouldDeduct && !wasDeducted) {
      for (const item of (order.items || [])) {
        await Product.updateOne({ id: item.id }, { $inc: { stock: -(parseInt(item.qty) || 1) } });
      }
    } else if (!shouldDeduct && wasDeducted) {
      for (const item of (order.items || [])) {
        await Product.updateOne({ id: item.id }, { $inc: { stock: (parseInt(item.qty) || 1) } });
      }
    }

    let emailStat = 'Queue';
    if (order.clientDetails?.email?.includes('@')) {
      emailStat = await sendClientEmail(order.clientDetails.email, order.clientDetails.name, id, status) ? 'Sent' : 'Failed';
      await Order.updateOne({ _id: id }, { emailStatus: emailStat });
    }
    res.json({ success: true, emailStatus: emailStat });
  } catch (e) { res.status(500).json({ success: false, emailStatus: 'Failed' }); }
});

// ─── ROUTE: UPDATE ORDER STATE ─────────────────────────────────────────
app.put('/api/update-order-state', checkAuth, async (req, res) => {
  try {
    const { id, state } = req.body;
    
    if (!id || !state) {
      return res.status(400).json({ success: false, error: 'Missing id or state' });
    }
    
    const validStates = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!validStates.includes(state)) {
      return res.status(400).json({ success: false, error: 'Invalid state value' });
    }
    
    const order = await Order.findOne({ _id: id });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    await Order.updateOne({ _id: id }, { $set: { order_state: state } });
    
    console.log(`[STATE] ✅ Order ${id} state updated to: ${state}`);
    res.json({ success: true, message: 'Order state updated successfully', state: state });
    
  } catch (e) { 
    console.error('[STATE] ❌ Error updating order state:', e.message);
    res.status(500).json({ success: false, error: 'Internal server error: ' + e.message });
  }
});

// ─── ROUTE: INQUIRIES ───────────────────────────────────────────────────
app.post('/api/inquiries', async (req, res) => {
  try {
    if (!req.body.email || !req.body.message || req.body.email.trim() === '' || req.body.message.trim() === '') {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }
    await new Inquiry(req.body).save();
    await sendInquiryAlert(req.body);
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Inquiry Save Error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── ROUTE: DELETE / MANAGE ─────────────────────────────────────────────
app.delete('/api/delete-order/:id', checkAuth, async (req, res) => {
  try { await Order.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});

app.delete('/api/delete-orders', checkAuth, async (req, res) => {
  try { await Order.deleteMany({ _id: { $in: req.body.ids } }); res.json({ success: true, deleted: req.body.ids }); } catch (e) { res.status(500).json({ success: false }); }
});

app.put('/api/update-stock', checkAuth, async (req, res) => {
  try {
    await Product.updateOne({ id: req.body.id }, { $set: { stock: req.body.stock } });
    await syncDBToFile();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/manage-stock', checkAuth, async (req, res) => {
  try {
    const products = await Product.find().sort({ id: 1 });
    let rows = products.map(p => {
      const s = p.stock || 0;
      let badge = '<span style="color:#15803d">In Stock</span>';
      if (s === 0) badge = '<span style="color:#b91c1c">Out</span>';
      else if (s <= 10) badge = '<span style="color:#c2410c">Low</span>';
      return `<tr><td data-label="Product"><div class="pi"><img src="${p.img}" class="pimg" onerror="this.style.display='none'"><div><strong>${p.name}</strong><div style="font-size:10px;color:#6b7280">${p.sci}</div></div></div></td><td data-label="Category" style="font-size:13px;color:#6b7280">${p.catLabel}</td><td data-label="Current">${badge} (${s})</td><td data-label="New Stock"><input type="number" class="si" id="s-${p.id}" value="${s}" min="0" onchange="document.getElementById('b-${p.id}').classList.add('sv')"></td><td data-label="Action"><button class="sb" id="b-${p.id}" onclick="save(${p.id})">Save</button></td></tr>`;
    }).join('');
    let html = fs.readFileSync(path.join(__dirname, 'views/stock.html'), 'utf8');
    res.send(html.replace('{{STOCK_ROWS}}', rows));
  } catch (e) { res.status(500).send('Error loading stock'); }
});

// ⭐ MAIN ORDERS VIEW ROUTE - HTML PAGE ⭐
app.get('/api/view-orders', checkAuth, async (req, res) => {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'views/orders.html'), 'utf8');
    res.send(html);
  } catch (e) { 
    console.error('View orders error:', e);
    res.status(500).send('Error loading orders page'); 
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── STARTUP: Initial Sync + File Watcher ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

async function startup() {
  console.log('[STARTUP] 🔄 Syncing products.json → Database...');
  const syncResult = await syncFileToDB({ removeOrphans: true });
  if (syncResult) {
    console.log(`[STARTUP] ✅ Product sync: +${syncResult.added} ~${syncResult.updated} -${syncResult.removed}`);
  }
  startFileWatcher();
}

startup();

// ─── 404 & ERROR HANDLERS ───────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

app.listen(port, () => console.log(`🚀 Secure Server running on port ${port}`));
