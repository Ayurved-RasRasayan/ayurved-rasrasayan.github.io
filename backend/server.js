const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ─── SECURITY MIDDLEWARE (Basic Auth) ─────────────────────────────────────────
function checkAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="NaturaBotanica Admin"');
    return res.status(401).send('<h1>Authentication Required</h1>');
  }
  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const user = auth[0];
  const pass = auth[1];
  const validUser = process.env.ADMIN_USER || 'admin';
  const validPass = process.env.ADMIN_PASSWORD || 'password123';
  if (user === validUser && pass === validPass) { next(); } 
  else {
    res.setHeader('WWW-Authenticate', 'Basic realm="NaturaBotanica Admin"');
    return res.status(401).send('<h1>Access Denied</h1>');
  }
}

// ─── EMAIL SENDING FUNCTION (Client Status Update via Brevo) ───────────────────
async function sendEmailViaAPI(toEmail, toName, orderId, status) {
  try {
    const senderEmail = 'sales.naturabotanica20@gmail.com';
    let displayStatus = status;
    if (status === 'Success') displayStatus = 'Payment Successful';

    const endpoint = 'https://api.brevo.com/v3/smtp/email';
    const data = {
      sender: { name: 'NaturaBotanica', email: senderEmail },
      to: [{ email: toEmail, name: toName }],
      subject: `Order Status Update: #${orderId}`,
      htmlContent: `<h3>Hello ${toName},</h3><p>Your order #${orderId} status is now: <strong>${displayStatus}</strong>.</p><p>Thank you for shopping with NaturaBotanica.</p>`
    };

    const response = await axios.post(endpoint, data, {
      headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' }
    });

    if (response.data && response.data.messageId) {
      console.log(`✅ Email sent to client (ID: ${response.data.messageId})`);
      return true;
    }
    return false;
  } catch (error) {
    console.error("❌ Client Email Failed:", error.response ? error.response.data : error.message);
    return false;
  }
}

// ─── EMAIL SENDING FUNCTION (Admin New Order Notification via Brevo) ────────────
async function sendAdminNotificationEmail(orderId, orderData) {
  try {
    const endpoint = 'https://api.brevo.com/v3/smtp/email';
    let itemsHtml = '<table style="width:100%; border-collapse: collapse; margin-top: 10px;"><tr style="background:#f9fafb;"><th style="border:1px solid #e5e7eb; padding:8px; text-align:left;">Item</th><th style="border:1px solid #e5e7eb; padding:8px; text-align:center;">Qty</th><th style="border:1px solid #e5e7eb; padding:8px; text-align:right;">Price</th></tr>';

    if (orderData.items && Array.isArray(orderData.items)) {
      orderData.items.forEach(item => {
        const qty = parseInt(item.qty) || 1;
        itemsHtml += `<tr><td style="border:1px solid #e5e7eb; padding:8px;">${item.name || 'Unknown'}</td><td style="border:1px solid #e5e7eb; padding:8px; text-align:center;">${qty}</td><td style="border:1px solid #e5e7eb; padding:8px; text-align:right;">$${item.price || 0}</td></tr>`;
      });
    }
    itemsHtml += '</table>';

    const data = {
      sender: { name: 'NaturaBotanica Website', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: 'sales.naturabotanica20@gmail.com', name: 'Sales Team' }],
      subject: `🛒 NEW ORDER: #${orderId} - ${orderData.clientDetails.name}`,
      htmlContent: `<div style="font-family: Arial, sans-serif; color: #333;"><h2 style="color: #2d4a22;">New Order Received (#${orderId})</h2><p>A customer has successfully verified their payment.</p><div style="background: #f3f4f6; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin-bottom: 20px;"><h3 style="margin-top:0;">👤 Client Information</h3><p><strong>Name:</strong> ${orderData.clientDetails.name}</p><p><strong>Email:</strong> <a href="mailto:${orderData.clientDetails.email}">${orderData.clientDetails.email}</a></p><p><strong>Phone:</strong> ${orderData.clientDetails.phone}</p><p><strong>Address:</strong> ${orderData.clientDetails.address || 'N/A'}</p></div><h3>📦 Order Details</h3><p><strong>Method:</strong> ${orderData.paymentMethod} | <strong>Currency:</strong> ${orderData.currency}</p>${itemsHtml}<div style="margin-top: 20px; text-align: right;"><span style="font-size: 1.2em; font-weight: bold; color: #059669;">Total: $${orderData.totalUSD} (${orderData.totalNPR} NPR)</span></div>${orderData.paymentScreenshot ? `<p style="margin-top:20px; font-size: 0.9em; color: #666;">📸 Payment Screenshot: <a href="${orderData.paymentScreenshot}" target="_blank">View Proof</a></p>` : ''}<p style="margin-top: 30px; font-size: 0.8em; color: #999;">Timestamp: ${new Date(orderData.timestamp).toLocaleString()}</p></div>`
    };

    await axios.post(endpoint, data, {
      headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' }
    });
    console.log(`✅ Admin Notification sent for Order #${orderId}`);
  } catch (error) {
    console.error("❌ Admin Notification Failed:", error.response ? error.response.data : error.message);
  }
}

// ─── MONGODB CONNECTION ──────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Database'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ─── MONGOOSE SCHEMAS ─────────────────────────────────────────────────────────
const productSchema = new mongoose.Schema({
  id: Number, name: String, sci: String, category: String, catLabel: String,
  price: Number, unit: String, moq: String, lead: String, img: String, desc: String
});

const orderSchema = new mongoose.Schema({
  items: Array, totalUSD: Number, totalNPR: Number, paidAmount: Number, currency: String,
  paymentMethod: String, paymentScreenshot: String, 
  clientDetails: { name: String, phone: String, email: String, address: String },
  status: { type: String, default: 'Pending' }, 
  emailStatus: { type: String, default: 'Queue' },
  timestamp: { type: Date, default: Date.now }
});

const inquirySchema = new mongoose.Schema({
  firstName: String, lastName: String, email: String, company: String, message: String,
  timestamp: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Inquiry = mongoose.model('Inquiry', inquirySchema);

// ─── ROUTE 1: GET PRODUCTS (PUBLIC) ──────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ id: 1 });
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE 2: SEED PRODUCTS (PUBLIC) ────────────────────────────────────────
const myProducts = require('./products.json');
app.get('/api/seed', async (req, res) => {
  try {
    await Product.deleteMany({});
    await Product.insertMany(myProducts);
    res.send('Database seeded successfully!');
  } catch (err) { res.status(500).send('Error seeding: ' + err.message); }
});

// ─── ROUTE 3: RECEIVE NEW ORDER & AUTO-EMAIL ADMIN (PUBLIC) ──────────────────
app.post('/api/orders', async (req, res) => {
  try {
    const newOrder = new Order(req.body);
    const savedOrder = await newOrder.save();
    
    // Auto-send notification to website admin email via Brevo
    await sendAdminNotificationEmail(savedOrder._id, req.body);
    
    res.status(201).json({ success: true, orderId: savedOrder._id });
  } catch (error) {
    console.error('❌ Error saving order:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 4: UPDATE STATUS & AUTO-EMAIL CLIENT (PROTECTED) ─────────────────
app.put('/api/update-status', checkAuth, async (req, res) => {
  try {
    const { id, status } = req.body;
    await Order.findByIdAndUpdate(id, { status, emailStatus: 'Queue' }, { new: true });

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false });

    let emailStatusResult = 'Queue';
    const clientEmail = order.clientDetails?.email;

    if (clientEmail && clientEmail.includes('@')) {
      const success = await sendEmailViaAPI(clientEmail, order.clientDetails.name, id, status);
      emailStatusResult = success ? 'Sent' : 'Failed';
      await Order.findByIdAndUpdate(id, { emailStatus: emailStatusResult });
    }

    res.json({ success: true, message: `Status updated.`, emailStatus: emailStatusResult });
  } catch (error) {
    console.error(`[FATAL ERROR]`, error);
    res.status(500).json({ success: false, message: 'Server error', emailStatus: 'Failed' });
  }
});

// ─── ROUTE 5: HANDLE INQUIRY & AUTO-EMAIL ADMIN (PUBLIC) ────────────────────
app.post('/api/inquiries', async (req, res) => {
  try {
    const { firstName, lastName, email, company, message } = req.body;
    const fullName = `${firstName} ${lastName}`;

    // Save to MongoDB
    const newInquiry = new Inquiry(req.body);
    await newInquiry.save();

    // Auto-send inquiry to website admin via Brevo
    const endpoint = 'https://api.brevo.com/v3/smtp/email';
    const data = {
      sender: { name: 'NaturaBotanica Website', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: 'sales.naturabotanica20@gmail.com', name: 'Sales Team' }],
      subject: `New Inquiry: ${fullName}`,
      htmlContent: `<h3>New Inquiry Received</h3><p><strong>Name:</strong> ${fullName}</p><p><strong>Email:</strong> ${email}</p><p><strong>Company:</strong> ${company || 'N/A'}</p><hr style="margin: 15px 0; border: 0; border-top: 1px solid #eee;"><h4>Message:</h4><p style="white-space: pre-wrap;">${message}</p>`
    };

    await axios.post(endpoint, data, {
      headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' }
    });

    console.log(`✅ Inquiry saved & emailed from ${email}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Error sending inquiry:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 6: DELETE SINGLE ORDER (PROTECTED) ──────────────────────────────
app.delete('/api/delete-order/:id', checkAuth, async (req, res) => {
  try {
    const result = await Order.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, message: `Order deleted` });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── ROUTE 7: DELETE MULTIPLE ORDERS (PROTECTED) ───────────────────────────
app.delete('/api/delete-orders', checkAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ success: false });
    await Order.deleteMany({ _id: { $in: ids } });
    res.json({ success: true, deleted: ids });
  } catch (error) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── ROUTE 8: ADMIN ORDER DASHBOARD (PROTECTED) ─────────────────────────────
app.get('/api/view-orders', checkAuth, async (req, res) => {
  try {
    const orders = await Order.find().sort({ timestamp: -1 });

    // Using backticks (`) completely prevents escaping errors with MongoDB IDs and Base64 strings
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
        <title>NaturaBotanica — Admin</title>
        <style>
          * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f3f4f6; margin: 0; padding: 0; color: #1f2937; }
          .container { max-width: 1400px; margin: 0 auto; padding: 16px; }
          h1 { color: #2d4a22; font-size: 1.5rem; margin: 0 0 20px 0; display: flex; align-items: center; gap: 10px; }
          .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; background: #fff; padding: 12px; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
          .btn { padding: 8px 16px; border-radius: 6px; border: none; font-weight: 600; cursor: pointer; font-size: 14px; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px; }
          .btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .btn-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
          .btn-danger:hover:not(:disabled) { background: #fecaca; }
          .btn-secondary { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
          .btn-secondary:hover:not(:disabled) { background: #e5e7eb; }
          .selected-count { margin-left: auto; color: #6b7280; font-size: 14px; font-weight: 500; }
          .table-wrap { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; min-width: 1100px; }
          th, td { padding: 0; border: 1px solid #e5e7eb; vertical-align: top; text-align: left; }
          th { background: #2d4a22; color: #fff; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; padding: 10px; text-align: center; }
          tr { border-bottom: 1px solid #e5e7eb; background: #fff; transition: background 0.2s; }
          tr:hover { background: #fafafa; }
          tr.selected { background: #fffbeb; }
          input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: #2d4a22; }
          .col-date-proof { width: 120px; padding: 15px; display: flex; flex-direction: column; justify-content: space-between; align-items: center; background: #f9fafb; }
          .date-text { font-weight: 700; color: #2d4a22; font-size: 0.95rem; }
          .proof-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; border: 1px solid #d1d5db; cursor: pointer; margin-top: 10px; }
          .no-proof-thumb { width: 40px; height: 40px; background: #eee; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 10px; color: #999; margin-top: 10px; }
          .col-product { width: 320px; padding: 15px; }
          .prod-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
          .prod-id { font-size: 0.8rem; background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 4px; font-weight: 700; border-right: 2px solid #e5e7eb; padding-right: 10px; margin-right: 10px; height: 100%; display: flex; align-items: center; }
          .prod-total { font-size: 1rem; color: #111827; font-weight: 800; }
          .prod-items-list { font-size: 0.9rem; color: #4b5563; line-height: 1.5; }
          .item-row { display: flex; align-items: center; justify-content: space-between; margin-left: -15px; margin-right: -15px; width: calc(100% + 30px); padding-left: 15px; padding-right: 15px; border-bottom: 1px dashed #e5e7eb; padding-bottom: 4px; margin-bottom: 4px; box-sizing: border-box; }
          .item-thumb { width: 30px; height: 30px; object-fit: cover; border-radius: 4px; border: 1px solid #d1d5db; margin-right: 8px; flex-shrink: 0; background: #f3f4f6; }
          .item-text { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
          .item-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
          .item-pid { font-size: 0.75rem; color: #9ca3af; font-family: monospace; margin-left: 4px; }
          .item-qty { font-size: 0.85rem; color: #6b7280; font-weight: 500; white-space: nowrap; }
          .col-status { width: 160px; padding: 15px; display: flex; flex-direction: column; gap: 10px; justify-content: center; }
          .status-select { padding: 8px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; font-weight: 600; cursor: pointer; width: 100%; font-size: 13px; }
          .status-Pending { background: #fff7ed; color: #c2410c; } .status-Shipping { background: #eff6ff; color: #1d4ed8; } .status-Completed { background: #f0fdf4; color: #15803d; } .status-Success { background: #dcfce7; color: #15803d; } .status-Rejected { background: #fef2f2; color: #b91c1c; }
          .badge { display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); position: relative; overflow: hidden; animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
          @keyframes popIn { 0% { transform: scale(0.8); opacity: 0; } 60% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
          .badge-queue { background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); color: #92400e; border: 1px solid #fcd34d; box-shadow: 0 4px 6px -1px rgba(217, 119, 6, 0.2); }
          .badge-queue::before { content: "⏳ "; margin-right: 4px; font-size: 1.1em; }
          .badge-sent { background: linear-gradient(135deg, #ecfccb 0%, #d9f99d 100%); color: #365314; border: 1px solid #bef264; box-shadow: 0 4px 6px -1px rgba(22, 163, 74, 0.3); }
          .badge-sent::before { content: "✅ "; margin-right: 4px; font-size: 1.1em; }
          .badge-fail { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); color: #991b1b; border: 1px solid #fca5a5; box-shadow: 0 4px 6px -1px rgba(220, 38, 38, 0.3); }
          .badge-fail::before { content: "❌ "; margin-right: 4px; font-size: 1.1em; }
          .col-client { padding: 15px; flex-grow: 1; }
          .client-detail { font-size: 0.9rem; color: #374151; margin-bottom: 4px; display: flex; }
          .client-detail strong { color: #111827; min-width: 70px; display: inline-block; }
          .col-actions { width: 80px; padding: 15px; display: flex; align-items: center; justify-content: center; }
          .btn-delete-row { display: flex; justify-content: center; align-items: center; width: 100%; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; padding: 8px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px; text-align: center; }
          @media (max-width: 768px) {
            body { background: #e5e7eb; } html, body { overflow-x: hidden; width: 100%; margin: 0; } ::-webkit-scrollbar { display: none; }
            .container { padding: 8px 0; max-width: 100%; }
            .toolbar { flex-direction: column; align-items: stretch; padding: 10px 8px; gap: 8px; background: #fff; border-radius: 0; }
            .selected-count { margin: 0; text-align: center; font-size: 12px; }
            .btn { width: 100%; justify-content: center; padding: 12px; margin: 0 8px; }
            thead { display: none; } table { display: block; width: 100%; margin: 0; border-spacing: 0; border: none; }
            tbody { display: flex; flex-direction: column; gap: 12px; padding: 0 8px; }
            tr { display: flex; flex-direction: column; width: 100%; background: #fff; border-radius: 8px; padding: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid #e5e7eb; position: relative; margin-bottom: 0; }
            tr.selected { border: 2px solid #2d4a22; box-shadow: 0 0 0 2px rgba(45, 74, 34, 0.1); }
            td { display: flex; width: 100%; padding: 0; border: none; flex-direction: column; align-items: flex-start; margin-bottom: 8px; word-break: break-word; box-sizing: border-box; }
            td::before { display: none; }
            td:nth-child(1) { order: 1; position: absolute; top: 12px; right: 12px; width: auto; z-index: 10; padding: 4px; background: #fff; border-radius: 4px; border: 1px solid #e5e7eb; }
            td:nth-child(2) { order: 2; flex-direction: row; align-items: center; justify-content: space-between; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 12px; }
            .date-text { font-size: 1rem; color: #2d4a22; font-weight: 700; }
            td:nth-child(3) { order: 3; margin-bottom: 12px; width: 100%; }
            .prod-header { width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
            .item-row { margin-left: 0; margin-right: 0; width: 100%; padding-left: 0; padding-right: 0; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed #eee; padding-bottom: 4px; margin-bottom: 4px; width: 100%; }
            .item-thumb { width: 24px; height: 24px; }
            .item-text { flex: 1; }
            td:nth-child(4) { order: 4; width: 100%; margin-bottom: 12px; }
            .status-select { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #d1d5db; font-size: 14px; background: #fff; appearance: none; }
            td:nth-child(5) { order: 5; background: #f9fafb; border-radius: 6px; padding: 10px; width: 100%; margin-bottom: 12px; border: 1px solid #e5e7eb; }
            .client-detail { font-size: 0.85rem; margin-bottom: 4px; width: 100%; display: flex; }
            .client-detail strong { min-width: 60px; color: #6b7280; }
            td:nth-child(6) { order: 6; width: 100%; margin-top: 8px; }
            .btn-delete-row { width: 100%; background: #fee2e2; color: #b91c1b; border: 1px solid #fecaca; padding: 12px; border-radius: 6px; font-weight: 600; text-transform: uppercase; font-size: 14px; }
          }
          #toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(20px); background: #1f2937; color: #fff; padding: 12px 24px; border-radius: 50px; opacity: 0; pointer-events: none; transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55); z-index: 2000; font-size: 14px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); width: 90%; text-align: center; }
          #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
          #imgModal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 3000; display: none; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; }
          #imgModal.show { display: flex; opacity: 1; }
          #imgModal img { max-width: 90%; max-height: 90%; border-radius: 8px; transform: scale(0.9); transition: transform 0.2s; }
          #imgModal.show img { transform: scale(1); }
          .close-img { position: absolute; top: 20px; right: 20px; color: white; cursor: pointer; font-size: 40px; line-height: 1; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🌿 NaturaBotanica <span style="font-size:0.6em; opacity:0.5; font-weight:400; margin-left:5px;">Admin</span></h1>
          <div class="toolbar">
            <button class="btn btn-secondary" onclick="toggleSelectAll()">☑️ Select All</button>
            <button class="btn btn-danger" id="btn-delete-selected" disabled onclick="deleteSelected()">🗑️ Delete Selected</button>
            <span class="selected-count" id="selected-count"></span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th width="40"><input type="checkbox" id="chk-all" onchange="toggleSelectAll()"/></th>
                  <th width="120">Date/Proof</th>
                  <th width="320">Order Items</th>
                  <th width="160">Status</th>
                  <th>Client Details</th>
                  <th width="80">Actions</th>
                </tr>
              </thead>
              <tbody id="orders-tbody">
                ${orders.map(row => {
                  const status = row.status || 'Pending';
                  let emailBadge = '<span class="badge badge-queue">Email Queue</span>';
                  if (row.emailStatus === 'Sent') emailBadge = '<span class="badge badge-sent">Email Sent</span>';
                  else if (row.emailStatus === 'Failed') emailBadge = '<span class="badge badge-fail">Email Failed</span>';
                  
                  const dateObj = new Date(row.timestamp);
                  const dateStr = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  
                  let itemsHtml = '';
                  try {
                    let itemsData = Array.isArray(row.items) ? row.items : [];
                    if (itemsData.length > 0) {
                      itemsHtml = itemsData.map(item => {
                        const qty = parseInt(item.qty) || 1;
                        const imgSrc = item.img || item.image;
                        const imgHtml = imgSrc ? '<img src="'+imgSrc+'" class="item-thumb">' : '';
                        const pid = item.id || item.product_id;
                        const pidHtml = pid ? '<span class="item-pid">(ID: '+pid+')</span>' : '';
                        return '<div class="item-row"><div class="item-text">'+imgHtml+'<span class="item-name" title="'+item.name+'">'+item.name+' '+pidHtml+'</span></div><span class="item-qty">x'+qty+' @ $'+item.price+'</span></div>';
                      }).join('');
                    }
                  } catch(e) { console.error("Error parsing items", e); }

                  return `
                  <tr id="row-${row._id}">
                    <td><input type="checkbox" class="row-chk" value="${row._id}" onchange="onCheckboxChange()"/></td>
                    <td class="col-date-proof">
                      <span class="date-text">${dateStr}</span>
                      ${row.paymentScreenshot ? '<img src="'+row.paymentScreenshot+'" class="proof-thumb" onclick="openImage(this.src)" alt="Proof">' : '<div class="no-proof-thumb">No Img</div>'}
                    </td>
                    <td class="col-product">
                      <div class="prod-header">
                        <span class="prod-id">Order #${row._id.toString().substring(0,8)}</span>
                        <span class="prod-total">Total: $${row.totalUSD}</span>
                      </div>
                      <div class="prod-items-list">${itemsHtml || 'No Items Data'}</div>
                    </td>
                    <td class="col-status">
                      ${emailBadge}
                      <select onchange="updateStatus('${row._id}', this.value, this)" class="status-select status-${status}">
                        <option value="Pending" ${status==='Pending'?'selected':''}>Pending</option>
                        <option value="Shipping" ${status==='Shipping'?'selected':''}>Shipping</option>
                        <option value="Completed" ${status==='Completed'?'selected':''}>Completed</option>
                        <option value="Success" ${status==='Success'?'selected':''}>Payment Successful</option>
                        <option value="Rejected" ${status==='Rejected'?'selected':''}>Rejected</option>
                      </select>
                    </td>
                    <td class="col-client">
                      <div class="client-detail"><strong>Name:</strong> ${row.clientDetails?.name || 'Guest'}</div>
                      <div class="client-detail"><strong>Phone:</strong> ${row.clientDetails?.phone || '-'}</div>
                      <div class="client-detail"><strong>Email:</strong> ${row.clientDetails?.email || '-'}</div>
                      <div class="client-detail"><strong>Address:</strong> ${row.clientDetails?.address || '-'}</div>
                    </td>
                    <td class="col-actions">
                      <button class="btn-delete-row" onclick="deleteSingle('${row._id}', this)">Delete</button>
                    </td>
                  </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div id="toast">Message</div>
        <div id="imgModal" onclick="closeImage(event)"><span class="close-img" onclick="closeImage(event)">&times;</span><img id="fullImage" src="" alt="Full Payment Proof" onclick="event.stopPropagation()"></div>
        <script>
          function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
          function openImage(src) { document.getElementById('fullImage').src = src; const modal = document.getElementById('imgModal'); modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10); }
          function closeImage(e) { if(e.target !== document.getElementById('fullImage')) { const modal = document.getElementById('imgModal'); modal.classList.remove('show'); setTimeout(() => modal.style.display = 'none', 200); } }
          function getCheckedIds() { return [...document.querySelectorAll('.row-chk:checked')].map(c => c.value); }
          function onCheckboxChange() {
            const ids = getCheckedIds(); const total = document.querySelectorAll('.row-chk').length;
            document.getElementById('btn-delete-selected').disabled = ids.length === 0;
            document.getElementById('selected-count').textContent = ids.length > 0 ? ids.length + ' selected' : '';
            document.getElementById('chk-all').checked = ids.length === total;
            document.querySelectorAll('.row-chk').forEach(chk => { document.getElementById('row-' + chk.value).classList.toggle('selected', chk.checked); });
          }
          function toggleSelectAll() { const chkAll = document.getElementById('chk-all'); document.querySelectorAll('.row-chk').forEach(c => c.checked = chkAll.checked); onCheckboxChange(); }
          function setBadge(id, status) {
            const cell = document.getElementById('row-' + id)?.querySelector('.badge'); if (!cell) return;
            cell.classList.remove('badge-queue', 'badge-sent', 'badge-fail');
            if (status === 'Sent') { cell.classList.add('badge-sent'); cell.textContent = 'Email Sent'; }
            else if (status === 'Failed') { cell.classList.add('badge-fail'); cell.textContent = 'Email Failed'; }
            else { cell.classList.add('badge-queue'); cell.textContent = 'Email Queue'; }
            cell.style.animation = 'none'; cell.offsetHeight; cell.style.animation = 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
          }
          async function updateStatus(id, newStatus, selectEl) {
            selectEl.disabled = true; const originalClass = selectEl.className; selectEl.className = 'status-select'; 
            try {
              const response = await fetch('/api/update-status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: newStatus }) });
              const data = await response.json();
              selectEl.className = 'status-select status-' + newStatus;
              setBadge(id, data.emailStatus || 'Queue');
              if (data.emailStatus === 'Failed') showToast('❌ Status updated but Email Failed');
              else if (data.emailStatus === 'Sent') showToast('✅ Status updated & Email Sent');
              else showToast('✅ Status updated');
            } catch (err) { showToast('❌ Network error'); selectEl.className = originalClass; } finally { selectEl.disabled = false; }
          }
          async function deleteSingle(id, btn) {
            if (!confirm('Delete order?')) return; btn.disabled = true; btn.textContent = '⏳...';
            try {
              const res = await fetch('/api/delete-order/' + id, { method: 'DELETE' }); const data = await res.json();
              if (data.success) { document.getElementById('row-' + id).style.opacity = '0'; setTimeout(() => { document.getElementById('row-' + id).remove(); onCheckboxChange(); }, 300); showToast('🗑️ Order deleted'); }
              else { showToast('❌ Delete failed'); btn.disabled = false; btn.textContent = 'Delete'; }
            } catch (err) { showToast('❌ Network error'); btn.disabled = false; btn.textContent = 'Delete'; }
          }
          async function deleteSelected() {
            const ids = getCheckedIds(); if (ids.length === 0 || !confirm('Delete ' + ids.length + ' order(s)?')) return;
            const btn = document.getElementById('btn-delete-selected'); const originalText = btn.innerHTML; btn.disabled = true; btn.innerHTML = '⏳ Deleting...';
            try {
              const res = await fetch('/api/delete-orders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
              const data = await res.json();
              if (data.success) { data.deleted.forEach(id => { const el = document.getElementById('row-' + id); if(el) { el.style.opacity = '0'; setTimeout(()=>el.remove(), 300); } }); showToast('🗑️ Deleted ' + data.deleted.length + ' order(s)'); setTimeout(() => onCheckboxChange(), 350); } else { showToast('❌ Delete failed'); }
            } catch (err) { showToast('❌ Network error'); } finally { btn.innerHTML = originalText; btn.disabled = false; onCheckboxChange(); }
          }
        </script>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) { console.error(err); res.status(500).send('Server Error'); }
});

app.get('/', (req, res) => res.send('🌿 NaturaBotanica Node.js Backend Running v26 (MongoDB + Brevo Integration)'));
app.listen(port, () => console.log(`🚀 Node Server running on port ${port}`));
