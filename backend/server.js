const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

const requiredEnvVars = ['MONGO_URI', 'EMAIL_PASS', 'ADMIN_USER', 'ADMIN_PASSWORD'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`❌ FATAL: Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

app.use(express.json({ limit: '10mb' }));
app.use(cors());

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

mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ MongoDB Connected')).catch(err => { console.error('❌ MongoDB Error:', err); process.exit(1); });

const productSchema = new mongoose.Schema({ id: Number, name: String, sci: String, category: String, catLabel: String, price: Number, unit: String, moq: String, lead: String, img: String, desc: String, stock: { type: Number, default: 100 } });
const orderSchema = new mongoose.Schema({ items: Array, totalUSD: Number, totalNPR: Number, paidAmount: Number, currency: String, paymentMethod: String, paymentScreenshot: String, clientDetails: { name: String, phone: String, email: String, address: String }, status: { type: String, default: 'Pending' }, emailStatus: { type: String, default: 'Queue' }, timestamp: { type: Date, default: Date.now } });
const inquirySchema = new mongoose.Schema({ firstName: String, lastName: String, email: String, company: String, message: String, timestamp: { type: Date, default: Date.now } });
const settingSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: mongoose.Schema.Types.Mixed });

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

// ─── ROUTE: GET EXCHANGE RATE ────────────────────────────────────────────────
app.get('/api/exchange-rate', checkAuth, async (req, res) => {
  try {
    const rate = await getSetting('exchange_rate', 133);
    const auto = await getSetting('auto_rate', false);
    const source = await getSetting('rate_source', 'default');
    const fetchedAt = await getSetting('rate_fetched_at', null);
    res.json({ rate, auto, source, fetchedAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ROUTE: SET EXCHANGE RATE (MANUAL) ──────────────────────────────────────
app.put('/api/exchange-rate', checkAuth, async (req, res) => {
  try {
    const { rate } = req.body;
    if (typeof rate !== 'number' || rate < 1) return res.status(400).json({ error: 'Invalid rate' });
    await setSetting('exchange_rate', rate);
    await setSetting('rate_source', 'manual');
    await setSetting('rate_fetched_at', new Date().toISOString());
    res.json({ success: true, rate });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ROUTE: TOGGLE AUTO RATE ─────────────────────────────────────────────────
app.put('/api/exchange-rate/auto', checkAuth, async (req, res) => {
  try {
    const { enabled } = req.body;
    await setSetting('auto_rate', !!enabled);
    res.json({ success: true, auto: !!enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ROUTE: FETCH LIVE RATE FROM API ────────────────────────────────────────
app.get('/api/exchange-rate/fetch', checkAuth, async (req, res) => {
  try {
    const apiRes = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 8000 });
    if (apiRes.data?.result === 'success' && apiRes.data?.rates?.NPR) {
      const rate = apiRes.data.rates.NPR;
      await setSetting('exchange_rate', rate);
      await setSetting('rate_source', 'live');
      await setSetting('rate_fetched_at', new Date().toISOString());
      res.json({ success: true, rate });
    } else {
      res.status(502).json({ error: 'NPR rate not found in API response' });
    }
  } catch (e) {
    console.error('[RATE] Fetch error:', e.message);
    res.status(502).json({ error: 'Failed to fetch live rate: ' + e.message });
  }
});

app.get('/', (req, res) => res.send('🌿 NaturaBotanica API Active'));
app.get('/api/health', async (req, res) => {
  try { await mongoose.connection.db.admin().ping(); res.json({ status: 'healthy' }); }
  catch (e) { res.status(503).json({ status: 'unhealthy' }); }
});
app.get('/api/products', async (req, res) => { try { res.json(await Product.find().sort({ id: 1 })); } catch (e) { res.status(500).json({ error: e.message }); } });

const myProducts = require('./products.json');
app.get('/api/seed', checkAuth, async (req, res) => { try { await Product.deleteMany({}); await Product.insertMany(myProducts); res.send('Seeded!'); } catch (e) { res.status(500).send(e.message); } });
app.get('/api/seed-stock', checkAuth, async (req, res) => { try { await Product.updateMany({}, { $set: { stock: 100 } }); res.send('Stocks reset'); } catch (e) { res.status(500).send(e.message); } });

app.post('/api/orders', async (req, res) => {
  try {
    const errors = validateOrder(req.body);
    if (errors.length > 0) return res.status(400).json({ success: false, errors });
    req.body.clientDetails.name = req.body.clientDetails.name.trim().substring(0, 100);
    req.body.clientDetails.email = req.body.clientDetails.email.trim().toLowerCase();
    req.body.clientDetails.phone = req.body.clientDetails.phone.trim().substring(0, 20);
    const savedOrder = await new Order(req.body).save();
    await sendAdminAlert(savedOrder._id, req.body);
    res.status(201).json({ success: true, orderId: savedOrder._id });
  } catch (e) { res.status(500).json({ success: false, error: 'Server error' }); }
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
      for (const item of (order.items || [])) await Product.updateOne({ id: item.id }, { $inc: { stock: - (parseInt(item.qty) || 1) } });
    } else if (!shouldDeduct && wasDeducted) {
      for (const item of (order.items || [])) await Product.updateOne({ id: item.id }, { $inc: { stock: (parseInt(item.qty) || 1) } });
    }
    let emailStat = 'Queue';
    if (order.clientDetails?.email?.includes('@')) {
      emailStat = await sendClientEmail(order.clientDetails.email, order.clientDetails.name, id, status) ? 'Sent' : 'Failed';
      await Order.updateOne({ _id: id }, { emailStatus: emailStat });
    }
    res.json({ success: true, emailStatus: emailStat });
  } catch (e) { res.status(500).json({ success: false, emailStatus: 'Failed' }); }
});

app.post('/api/inquiries', async (req, res) => {
  try {
    if (!req.body.email || !req.body.message) return res.status(400).json({ success: false, error: 'Missing fields' });
    await new Inquiry(req.body).save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

app.delete('/api/delete-order/:id', checkAuth, async (req, res) => {
  try { await Order.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch(e) { res.status(500).json({success:false}); }
});
app.delete('/api/delete-orders', checkAuth, async (req, res) => {
  try { await Order.deleteMany({ _id: { $in: req.body.ids } }); res.json({ success: true, deleted: req.body.ids }); } catch(e) { res.status(500).json({success:false}); }
});

app.put('/api/update-stock', checkAuth, async (req, res) => {
  try { await Product.updateOne({ id: req.body.id }, { $set: { stock: req.body.stock } }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
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

app.get('/api/view-orders', checkAuth, async (req, res) => {
  try {
    const orders = await Order.find().sort({ timestamp: -1 }).limit(100);
    let rows = orders.map(r => {
      const s = r.status || 'Pending';
      const nprAmount = Math.round(r.totalNPR) || 0;

      let eb = '<span class="badge bq">Queue</span>';
      if (r.emailStatus === 'Sent') eb = '<span class="badge bsn">Sent</span>';
      else if (r.emailStatus === 'Failed') eb = '<span class="badge bf">Failed</span>';

      const d = new Date(r.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

      let ih = '';
      try {
        const it = Array.isArray(r.items) ? r.items : [];
        if (it.length > 0) {
          ih = it.map(i => {
            const img = i.img ? `<img src="${i.img}" class="it">` : '';
            const pid = i.id ? `<span class="iid">ID #${i.id}</span>` : '';
            const qty = i.qty || 1;
            const price = i.price || 0;
            return `<div class="ir"><div class="ix">${img}<span class="in" title="${i.name}">${i.name}</span></div><span class="iq">${pid} x${qty} @ <span class="ipr">NPR ${price.toLocaleString('en-NP')}</span></span></div>`;
          }).join('');
        }
      } catch(e) {}

      const imgHtml = r.paymentScreenshot
        ? `<img src="${r.paymentScreenshot}" class="pt" onclick="oI(this.src)" alt="P">`
        : `<div style="width:40px;height:40px;background:#eee;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:10px;color:#999;margin-top:10px">No Img</div>`;

      const totalHtml = `<div class="ot"><span class="ot-label">Total</span><span class="ov" data-npr="${nprAmount}">= NPR ${nprAmount.toLocaleString('en-NP')}</span></div>`;

      return `<tr id="r-${r._id}">
        <td><input type="checkbox" class="rc" value="${r._id}" onchange="oCC()"/></td>
        <td class="cdp"><span class="dt">${d}</span>${imgHtml}</td>
        <td class="cp">
          <div class="ph">
            <span class="ph-label">Order Id</span>
            <span class="pid">#${r._id.toString().substring(0,8)}</span>
          </div>
          <div class="pil">${ih || 'No Data'}</div>
          ${totalHtml}
        </td>
        <td class="cs">${eb}<select onchange="uS('${r._id}',this.value,this)" class="ss s-${s}">
          <option value="Pending" ${s==='Pending'?'selected':''}>Pending</option>
          <option value="Shipping" ${s==='Shipping'?'selected':''}>Shipping</option>
          <option value="Completed" ${s==='Completed'?'selected':''}>Completed</option>
          <option value="Success" ${s==='Success'?'selected':''}>Payment Successful</option>
          <option value="Rejected" ${s==='Rejected'?'selected':''}>Rejected</option>
        </select></td>
        <td class="cc">
          <div class="cd"><strong>Name:</strong> ${r.clientDetails?.name||'Guest'}</div>
          <div class="cd"><strong>Phone:</strong> ${r.clientDetails?.phone||'-'}</div>
          <div class="cd"><strong>Email:</strong> ${r.clientDetails?.email||'-'}</div>
          <div class="cd"><strong>Addr:</strong> ${r.clientDetails?.address||'-'}</div>
        </td>
        <td class="ca"><button class="dr" onclick="d1('${r._id}',this)">Del</button></td>
      </tr>`;
    }).join('');
    let html = fs.readFileSync(path.join(__dirname, 'views/orders.html'), 'utf8');
    res.send(html.replace('{{ORDERS_ROWS}}', rows));
  } catch (e) { res.status(500).send('Error loading orders'); }
});

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

app.listen(port, () => console.log(`🚀 Secure Server running on port ${port}`));
