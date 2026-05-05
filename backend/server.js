const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json({ limit: '10mb' }));
app.use(cors());

function checkAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) { res.setHeader('WWW-Authenticate', 'Basic realm="Admin"'); return res.status(401).send('Authentication Required'); }
  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  if (auth[0] === (process.env.ADMIN_USER || 'admin') && auth[1] === (process.env.ADMIN_PASSWORD || 'password123')) { next(); } 
  else { res.setHeader('WWW-Authenticate', 'Basic realm="Admin"'); return res.status(401).send('Access Denied'); }
}

async function sendClientEmail(toEmail, toName, orderId, status) {
  try {
    console.log(`\n[EMAIL-DEBUG] Sending to: ${toEmail} | Status: ${status}`);
    if (!process.env.EMAIL_PASS) { console.error(`[EMAIL-DEBUG] ❌ EMAIL_PASS missing!`); return false; }
    let displayStatus = status === 'Success' ? 'Payment Successful' : status;
    const res = await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: toEmail, name: toName }],
      subject: `Order Update: #${orderId}`,
      htmlContent: `<h3>Hello ${toName},</h3><p>Your order #${orderId} is now: <strong>${displayStatus}</strong>.</p><p>Thank you!</p>`
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    if (res.data?.messageId) { console.log(`[EMAIL-DEBUG] ✅ Sent!`); return true; }
    return false;
  } catch (e) { console.error(`[EMAIL-DEBUG] ❌ Error:`, e.response?.data || e.message); return false; }
}

async function sendAdminAlert(orderId, data) {
  try {
    if (!process.env.EMAIL_PASS) return;
    let itemsHtml = '<table style="width:100%;border-collapse:collapse;margin-top:10px;"><tr style="background:#f9fafb;"><th style="border:1px solid #e5e7eb;padding:8px;">Item</th><th style="border:1px solid #e5e7eb;padding:8px;">Qty</th><th style="border:1px solid #e5e7eb;padding:8px;">Price</th></tr>';
    if (data.items) data.items.forEach(i => { itemsHtml += `<tr><td style="border:1px solid #e5e7eb;padding:8px;">${i.name}</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:center;">${i.qty||1}</td><td style="border:1px solid #e5e7eb;padding:8px;">$${i.price||0}</td></tr>`; });
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: 'sales.naturabotanica20@gmail.com', name: 'Sales Team' }],
      subject: `🛒 NEW ORDER: #${orderId} - ${data.clientDetails.name}`,
      htmlContent: `<div style="font-family:Arial;color:#333;"><h2 style="color:#2d4a22;">New Order (#${orderId})</h2><p><b>Name:</b> ${data.clientDetails.name}<br><b>Email:</b> ${data.clientDetails.email}<br><b>Phone:</b> ${data.clientDetails.phone}</p><p><b>Total:</b> $${data.totalUSD} (${data.totalNPR} NPR)</p>${itemsHtml}${data.paymentScreenshot ? `<p>📸 <a href="${data.paymentScreenshot}" target="_blank">View Screenshot</a></p>` : ''}</div>`
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
  } catch (e) { console.error('Admin Alert Error:', e.message); }
}

mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ MongoDB Connected')).catch(err => console.error('❌ MongoDB Error:', err));

const productSchema = new mongoose.Schema({ id: Number, name: String, sci: String, category: String, catLabel: String, price: Number, unit: String, moq: String, lead: String, img: String, desc: String, stock: { type: Number, default: 100 } });
const orderSchema = new mongoose.Schema({ items: Array, totalUSD: Number, totalNPR: Number, paidAmount: Number, currency: String, paymentMethod: String, paymentScreenshot: String, clientDetails: { name: String, phone: String, email: String, address: String }, status: { type: String, default: 'Pending' }, emailStatus: { type: String, default: 'Queue' }, timestamp: { type: Date, default: Date.now } });
const inquirySchema = new mongoose.Schema({ firstName: String, lastName: String, email: String, company: String, message: String, timestamp: { type: Date, default: Date.now } });

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Inquiry = mongoose.model('Inquiry', inquirySchema);

app.get('/api/products', async (req, res) => { try { res.json(await Product.find().sort({ id: 1 })); } catch (e) { res.status(500).json({ error: e.message }); } });

const myProducts = require('./products.json');
app.get('/api/seed', async (req, res) => { try { await Product.deleteMany({}); await Product.insertMany(myProducts); res.send('Seeded!'); } catch (e) { res.status(500).send(e.message); } });
app.get('/api/seed-stock', async (req, res) => { try { await Product.updateMany({}, { $set: { stock: 100 } }); res.send('All stocks set to 100'); } catch (e) { res.status(500).send(e.message); } });

app.post('/api/orders', async (req, res) => {
  try {
    const savedOrder = await new Order(req.body).save();
    await sendAdminAlert(savedOrder._id, req.body);
    res.status(201).json({ success: true, orderId: savedOrder._id });
  } catch (e) { res.status(500).json({ success: false }); }
});

// ─── ROUTE 4: UPDATE STATUS, DEDUCT STOCK IF COMPLETED, EMAIL CLIENT ─────────
app.put('/api/update-status', checkAuth, async (req, res) => {
  try {
    const { id, status } = req.body;
    await Order.updateOne({ _id: id }, { status, emailStatus: 'Queue' });
    const order = await Order.findOne({ _id: id });
    if (!order) return res.status(404).json({ success: false });
    if (status === 'Completed') {
      console.log(`📦 Deducting stock for Completed Order #${id}...`);
      Array.from(order.items).forEach(async (item) => {
        await Product.updateOne({ id: item.id }, { $inc: { stock: -(parseInt(item.qty) || 1) } });
      });
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
    await new Inquiry(req.body).save();
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: 'sales.naturabotanica20@gmail.com' }],
      subject: `New Inquiry: ${req.body.firstName} ${req.body.lastName}`,
      htmlContent: `<h3>New Inquiry</h3><p><b>Email:</b> ${req.body.email}</p><p><b>Message:</b> ${req.body.message}</p>`
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

app.delete('/api/delete-order/:id', checkAuth, async (req, res) => { try { await Order.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch(e) { res.status(500).json({success:false}); } });
app.delete('/api/delete-orders', checkAuth, async (req, res) => { try { await Order.deleteMany({ _id: { $in: req.body.ids } }); res.json({ success: true }); } catch(e) { res.status(500).json({success:false}); } });

// ─── ROUTE 7: STOCK MANAGER (API-FETCH METHOD - ZERO ERRORS) ──────────────────────
app.get('/api/manage-stock', checkAuth, async (req, res) => {
  try {
    const products = await Product.find().sort({ id: 1 }).select('-stock -_id -img -name -sci -catLabel -id').lean();
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Stock Manager</title><style>*{box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:20px;color:#1f2937}.header{max-width:1200px;margin:0 auto 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}h1{color:#2d4a22;margin:0}.btn{padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;border:1px solid #d1d5db;background:#fff;color:#374151}.tw{max-width:1200px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.05)}table{width:100%;border-collapse:collapse}th,td{padding:12px 15px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#2d4a22;color:#fff;font-size:12px;text-transform:uppercase}tr:hover{background:#f9fafb}.pi{display:flex;align-items:center;gap:12px}.pimg{width:40px;height:40px;border-radius:6px;object-fit:cover}.si{width:80px;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;font-weight:600;text-align:center}.si:focus{outline:none;border-color:#A3B14B}.sb{background:#A3B14B;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;opacity:0;transition:.2s}.sv{opacity:1}.toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%) translateY(20px);background:#1f2937;color:#fff;padding:12px 24px;border-radius:50px;opacity:0;transition:.3s;z-index:2000}.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}@media(max-width:768px){table,thead,tbody,th,td,tr{display:block}thead tr{position:absolute;left:-9999px}tr{border:1px solid #e5e7eb;border-radius:8px;margin-bottom:15px;padding:10px}td{border:none;border-bottom:1px solid #eee;padding-left:50%;text-align:right;position:relative}td:before{content:attr(data-label);position:absolute;left:15px;top:12px;width:45%;font-weight:700;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase}.si{width:100%}.pi{justify-content:flex-end}}</style></head><body><div class="header"><h1>📦 Stock Manager</h1><a href="/api/view-orders" class="btn">← Back to Orders</a></div><div class="tw"><table><thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Set New</th><th>Action</th></tr></thead><tbody id="tb"></tbody></table></div><div id="toast" class="toast"></div><script>const b=window.location.pathname.replace("/api/manage-stock","")+"/api";async function load(){const r=await fetch(b+"/products");const p=await r.json();const tb=document.getElementById("tb");tb.innerHTML="";p.forEach(pr=>{const s=pr.stock||0;let st="<span style='color:#15803d'>In Stock</span>";if(s===0)st="<span style='color:#b91c1c'>Out</span>";else if(s<=10)st="<span style='color:#c2410c'>Low</span>";const tr=document.createElement("tr");tr.innerHTML=\`<td data-label="Product"><div class="pi"><img src="\${pr.img}" class="pimg"><div><strong>\${pr.name}</strong><div style="font-size:10px;color:#6b7280">\${pr.sci}</div></div></div></td><td data-label="Category" style="font-size:13px;color:#6b7280">\${pr.catLabel}</td><td data-label="Current">\${st} (\${s})</td><td data-label="New Stock"><input type="number" class="si" id="s-\${pr.id}" value="\${s}" min="0" onchange="document.getElementById('b-\${pr.id}').classList.add('sv')"></td><td data-label="Action"><button class="sb" id="b-\${pr.id}" onclick="save(\${pr.id})">Save</button></td></tr>\`;tb.appendChild(tr)})}load();async function save(id){const v=parseInt(document.getElementById("s-"+id).value);if(isNaN(v)||v<0)return;const btn=document.getElementById("b-"+id);btn.textContent="...";btn.disabled=true;try{const r=await fetch(b+"/update-stock",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,stock:v})});if(r.ok){btn.textContent="✓";const t=document.getElementById("toast");t.textContent="✅ Saved!";t.classList.add("show");setTimeout(()=>location.reload(),800)}else btn.textContent="Error"}catch(e){btn.textContent="Error"}finally{btn.disabled=false}}<\/script></body></html>`);
  } catch (e) { res.status(500).send('Error'); }
});

app.put('/api/update-stock', checkAuth, async (req, res) => {
  try { await Product.updateOne({ id: req.body.id }, { $set: { stock: req.body.stock } }); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});

// ─── ROUTE 8: VIEW ORDERS DASHBOARD ──────────────────────────────────────────
app.get('/api/view-orders', checkAuth, async (req, res) => {
  try {
    const orders = await Order.find().sort({ timestamp: -1 });
    window.currentCurrency = 'npr';
    function toggleCurrency() {
      window.currentCurrency = window.currentCurrency === 'npr' ? 'usd' : 'npr';
      document.querySelectorAll('[data-id]').forEach(el => {
        const row = el.closest('tr');
        if(!row) return;
        const id = row.id.replace('row-', '');
        const order = orders.find(o => o._id === id);
        if(!order) return;
        const itemId = el.dataset.id;
        const item = order.items.find(i => String(i.id || i.product_id) === itemId);
        if(!item) return;
        const p = window.currentCurrency === 'usd' ? '$' + (item.price / 133).toFixed(2) : 'NPR ' + item.price.toLocaleString();
        el.innerHTML = 'x' + (parseInt(item.qty) || 1) + ' @ ' + p;
      });
    }
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Admin Orders</title><style>*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}body{font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:0;color:#1f2937}.c{max-width:1400px;margin:0 auto;padding:16px}.hd{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:20px}h1{color:#2d4a22;margin:0;display:flex;align-items:center;gap:10px}h1 span{font-size:.6em;opacity:.5;font-weight:400}.btn-s{background:#2d4a22;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px}.tb{display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap;background:#fff;padding:12px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.05)}.b{padding:8px 16px;border-radius:6px;border:none;font-weight:600;cursor:pointer;font-size:14px}.bd{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}.bs{background:#f3f4f6;color:#374151;border:1px solid #d1d5db}.tw{background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.05)}table{width:100%;border-collapse:collapse;table-layout:fixed;min-width:1100px}th,td{padding:0;border:1px solid #e5e7eb;vertical-align:top;text-align:left}th{background:#2d4a22;color:#fff;font-weight:600;font-size:12px;text-transform:uppercase;padding:10px;text-align:center}tr{background:#fff;transition:.2s}tr:hover{background:#f9fafb}input[type=checkbox]{width:18px;height:18px;cursor:pointer;accent-color:#2d4a22}.cdp{width:120px;padding:15px;display:flex;flex-direction:column;justify-content:space-between;align-items:center;background:#f9fafb}.dt{font-weight:700;color:#2d4a22;font-size:.95rem}.pt{width:40px;height:40px;object-fit:cover;border-radius:4px;border:1px solid #d1d5db;cursor:pointer;margin-top:10px}.nt{width:40px;height:40px;background:#eee;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:10px;color:#999;margin-top:10px}.cp{width:320px;padding:15px}.ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}.pid{font-size:.8rem;background:#e0e7ff;color:#3730a3;padding:2px 6px;border-radius:4px;font-weight:700}.ptl{font-size:1rem;color:#111827;font-weight:800}.pil{font-size:.9rem;color:#4b5563;line-height:1.5}.ir{display:flex;align-items:center;justify-content:space-between;margin-left:-15px;margin-right:-15px;width:calc(100% + 30px);padding-left:15px;padding-right:15px;border-bottom:1px dashed #e5e7eb;padding-bottom:4px;margin-bottom:4px;box-sizing:border-box}.it{width:30px;height:30px;object-fit:cover;border-radius:4px;border:1px solid #d1d5db;margin-right:8px;flex-shrink:0}.ix{display:flex;align-items:center;gap:8px;flex:1;min-width:0}.in{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}.iq{font-size:.85rem;color:#6b7280;font-weight:500;white-space:nowrap}.iq{font-size:.85rem;color:#6b7280}.cs{width:160px;padding:15px;display:flex;flex-direction:column;gap:10px;justify-content:center}.ss{padding:8px;border-radius:6px;border:1px solid #d1d5db;background:#fff;font-weight:600;cursor:pointer;width:100%;font-size:13px}.s-Pending{background:#fff7ed;color:#c2410c}.s-Shipping{background:#eff6ff;color:#1d4ed8}.s-Completed{background:#f0fdf4;color:#15803d}.s-Success{background:#dcfce7;color:#15803d}.s-Rejected{background:#fef2f2;color:#b91c1c}.badge{display:inline-flex;align-items:center;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:800;text-transform:uppercase;box-shadow:0 4px 6px rgba(0,0,0,.1);animation:pi .5s cubic-bezier(.175,.885,.32,1.275) forwards}@keyframes pi{0%{transform:scale(.8);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}.bq{background:linear-gradient(135deg,#fffbeb,#fef3c7);color:#92400e;border:1px solid #fcd34d;box-shadow:0 4px 6px rgba(217,119,6,.2)}.bq::before{content:"⏳ ";margin-right:4px;font-size:1.1em}.bsn{background:linear-gradient(135deg,#ecfccb,#d9f99d);color:#365314;border:1px solid #bef264;box-shadow:0 4px 6px rgba(22,163,74,.3)}.bsn::before{content:"✅ ";margin-right:4px;font-size:1.1em}.bf{background:linear-gradient(135deg,#fee2e2,#fecaca);color:#991b1b;border:1px solid #fca5a5;box-shadow:0 4px 6px rgba(220,38,38,.3)}.bf::before{content:"❌ ";margin-right:4px;font-size:1.1em}.cc{padding:15px;flex-grow:1}.cd{font-size:.9rem;color:#374151;margin-bottom:4px;display:flex}.cd strong{color:#111827;min-width:70px;display:inline-block}.ca{width:80px;padding:15px;display:flex;align-items:center;justify-content:center}.dr{display:flex;justify-content:center;align-items:center;width:100%;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;padding:8px 12px;border-radius:6px;font-weight:600;cursor:pointer;font-size:12px;text-align:center}@media(max-width:768px){body{background:#e5e7eb}html,body{overflow-x:hidden;width:100%;margin:0}::-webkit-scrollbar{display:none}.c{padding:8px 0;max-width:100%}.tb{flex-direction:column;align-items:stretch;padding:10px 8px;gap:8px;background:#fff;border-radius:0}.b{width:100%;justify-content:center;padding:12px;margin:0 8px}thead{display:none}table{display:block;width:100%;margin:0;border-spacing:0;border:none}tbody{display:flex;flex-direction:column;gap:12px;padding:0 8px}tr{display:flex;flex-direction:column;width:100%;background:#fff;border-radius:8px;padding:12px;box-shadow:0 2px 4px rgba(0,0,0,.05);border:1px solid #e5e7eb;position:relative}td{display:flex;width:100%;padding:0;border:none;flex-direction:column;align-items:flex-start;margin-bottom:8px;word-break:break-word;box-sizing:border-box}td::before{display:none}td:nth-child(1){order:1;position:absolute;top:12px;right:12px;width:auto;z-index:10;padding:4px;background:#fff;border-radius:4px;border:1px solid #e5e7eb}td:nth-child(2){order:2;flex-direction:row;align-items:center;justify-content:space-between;border-bottom:1px solid #eee;padding-bottom:8px;margin-bottom:12px}.dt{font-size:1rem;color:#2d4a22;font-weight:700}.ph{width:100%;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:8px}.ir{margin:0;width:100%;padding:0;display:flex;align-items:center;justify-content:space-between;border-bottom:1px dashed #eee;padding-bottom:4px;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between}.it{width:24px;height:24px}.ix{flex:1}td:nth-child(4){order:4;width:100%;margin-bottom:12px}.ss{width:100%;padding:10px;border-radius:6px;border:1px solid #d1d5db;font-size:14px;background:#fff;appearance:none}td:nth-child(5){order:5;background:#f9fafb;border-radius:6px;padding:10px;width:100%;margin-bottom:12px;border:1px solid #e5e7eb}.cd{font-size:.85rem;margin-bottom:4px;width:100%;display:flex}.cd strong{min-width:60px;color:#6b7280}td:nth-child(6){order:6;width:100%;margin-top:8px}.dr{width:100%;background:#fee2e2;color:#b91c1b;border:1px solid #fecaca;padding:12px;border-radius:6px;font-weight:600;text-transform:uppercase;font-size:14px}#toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%) translateY(20px);background:#1f2937;color:#fff;padding:12px 24px;border-radius:50px;opacity:0;transition:.3s;z-index:2000;font-size:14px;width:90%;text-align:center}#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}#imgModal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.9);z-index:3000;display:none;align-items:center;justify-content:center}#imgModal.show{display:flex}#imgModal img{max-width:90%;max-height:90%;border-radius:8px}.ci{position:absolute;top:20px;right:20px;color:#fff;cursor:pointer;font-size:40px}.toast-exit{animation:slideOutRight 0.3s ease-in forwards}@keyframes slideOutRight{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(100%)}}</style></head><body><div class="c"><div class="hd"><h1>🌿 NaturaBotanica <span style="font-size:.6em;opacity:.5;font-weight:400">Admin</span></h1><a href="/api/manage-stock" class="btn-s">📦 Manage Stock</a></div><div class="tb"><button class="b bs" onclick="tSA()">☑️ Select All</button><button class="b bd" id="bd" disabled onclick="dS()">🗑️ Delete</button><span id="sc" style="margin-left:auto;color:#6b7280;font-size:14px"></span></div><div class="tw"><table><thead><tr><th width="40"><input type="checkbox" id="ca" onchange="tSA()"/></th><th width="120">Date/Proof</th><th width="320">Items</th><th width="160">Status</th><th>Client</th><th width="80">Act</th></tr></thead><tbody id="tb">${orders.map(r=>{const s=r.status||'Pending';let eb='<span class="badge bq">Queue</span>';if(r.emailStatus==='Sent')eb='<span class="badge bsn">Sent</span>';else if(r.emailStatus==='Failed')eb='<span class="badge bf">Failed</span>';const d=new Date(r.timestamp).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'});let ih='';try{const it=Array.isArray(r.items)?r.items:[];if(it.length>0)ih=it.map(i=>{const q=parseInt(i.qty)||1;const im=i.img?'<img src="'+i.img+'" class="it">':'';const pid=i.id?'<span style="font-size:.75rem;color:#9ca3af;font-family:monospace;margin-left:4px">(ID:'+i.id+')</span>':'';return'<div class="ir"><div class="ix"><span class="in" title="'+i.name+'">'+i.name+pid+'</span></div><span class="iq" data-id="'+(i.id||0)+'">x'+q+' @ <span class="item-price" data-id="'+(i.id||0)+'">$'+(i.price||0)+'</span></div>'}).join('')}catch(e){}return'<tr id="r-'+r._id+'"><td><input type="checkbox" class="rc" value="'+r._id+'" onchange="oCC()"/></td><td class="cdp"><span class="dt">'+d+'</span>'+(r.paymentScreenshot?'<img src="'+r.paymentScreenshot+'" class="pt" onclick="oI(this.src)" alt="P">':'<div class="nt">No Img</div>')+'</td><td class="cp"><div class="ph"><span class="pid">#'+r._id.toString().substring(0,8)+'</span><span class="ptl">$'+r.totalUSD+'</span></div><div class="pil">'+(ih||'No Data')+'</div></div></td><td class="cs"><span class="cs">'+eb+'<select onchange="uS(\''+r._id+'\',this.value,this)" class="ss s-'+s+'"><option value="Pending" '+(s==='Pending'?'selected':'')+'>Pending</option><option value="Shipping" '+(s==='Shipping'?'selected':'')+'>Shipping</option><option value="Completed" '+(s==='Completed'?'selected':'')+'>Completed</option><option value="Success" '+(s==='Success'?'selected':'')+'>Payment Successful</option><option value="Rejected" '+(s==='Rejected'?'selected':'')+'>Rejected</option></select></td><td class="cc"><div class="cd"><strong>Name:</strong> '+(r.clientDetails?.name||'Guest')+'</div><div class="cd"><strong>Phone:</strong> '+(r.clientDetails?.phone||'-')+'</div><div class="cd"><strong>Email:</strong> '+(r.clientDetails?.email||'-')+'</div><div class="cd"><strong>Addr:</strong> '+(r.clientDetails?.address||'-')+'</div></div></td><td class="ca"><button class="dr" onclick="d1(\''+r._id+'\',this)">Del</button></td></tr>'}).join('')}</tbody></table></div></div></div><div id="toast" class="toast">M</div><div id="imgModal" onclick="cI(event)"><span class="ci" onclick="cI(event)">&times;</span><img id="fI" src="" onclick="event.stopPropagation()"></div></div><script>const b=window.location.pathname.replace('/api/view-orders','')+'/api';function sT(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)}function oI(s){document.getElementById('fI').src=s;const m=document.getElementById('imgModal');m.style.display='flex';m.classList.add('show')}function cI(e){if(e.target!==document.getElementById('fI')){const m=document.getElementById('imgModal');m.classList.remove('show');setTimeout(()=>m.style.display='none',200)}}function gI(){return[...document.querySelectorAll('.rc:checked')].map(c=>c.value)}function oCC(){const i=gI(),t=document.querySelectorAll('.rc').length;document.getElementById('bd').disabled=i.length===0;document.getElementById('sc').textContent=i.length>0?i.length+' selected':'';document.getElementById('ca').checked=i.length===t;document.querySelectorAll('.rc').forEach(c=>{document.getElementById('r-'+c.value).classList.toggle('selected',c.checked)})}function tSA(){const c=document.getElementById('ca');document.querySelectorAll('.rc').forEach(x=>x.checked=c.checked);oCC()}async function uS(id,s,ns,el){el.disabled=true;const oc=el.className;el.className='ss';try{const r=await fetch(b+'/update-status',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status:ns})});const d=await r.json();el.className='ss s-'+ns;uI(id,d.emailStatus||'Queue')}catch(e){sT('❌ Error');el.className=oc}finally{el.disabled=false}}async function d1(id,btn){if(!confirm('Delete?'))return;btn.disabled=true;btn.textContent='...';try{const r=await fetch(b+'/delete-order/'+id,{method:'DELETE'});const d=await r.json();if(d.success){document.getElementById('r-'+id).style.opacity='0';setTimeout(()=>{document.getElementById('r-'+id).remove();oCC()},300);sT('🗑️ Deleted')}else{btn.disabled=false;btn.textContent='Del'}}catch(e){sT('❌ Error');btn.disabled=false;btn.textContent='Del'}}async function dS(){const i=gI();if(i.length===0||!confirm('Delete '+i.length+'?'))return;const btn=document.getElementById('bd');btn.disabled=true;btn.innerHTML='⏳...';try{const r=await fetch(b+'/delete-orders',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:i})});const d=await r.json();if(d.success){d.deleted.forEach(id=>{const el=document.getElementById('r-'+id);if(el){el.style.opacity='0';setTimeout(()=>el.remove(),300)}});sT('🗑️ Deleted '+d.deleted.length);setTimeout(oCC,350)}else sT('❌ Error')}catch(e){sT('❌ Error')}finally{btn.innerHTML='🗑️ Delete';btn.disabled=false;oCC()}}</script></body></html>`);
  } catch (e) { res.status(500).send('Error'); }
});

app.get('/api/test-log', (req, res) => { console.log("✅ TEST LOG WORKS!"); res.send("Check Render Logs"); });
app.get('/', (req, res) => res.send('🌿 NaturaBotanica Backend v31'));
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
