const express = require('express');
const mongoose = require('mongoose'); // 1. MongoDB Driver
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ─── DATABASE CONNECTION (MONGODB) ────────────────────────────────────────────
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/naturabotanica';
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB Database'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// ─── SCHEMAS & MODELS ────────────────────────────────────────────────────────

// 2. Product Schema (For Stock Management)
const productSchema = new mongoose.Schema({
  productId: { type: String, required: true, unique: true }, // ID matching frontend
  name: { type: String, required: true },
  price: { type: Number, required: true },
  stock: { type: Number, required: true, default: 0 },
  image: { type: String },
  description: { type: String },
  category: { type: String }
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);

// 3. Order Schema
const orderSchema = new mongoose.Schema({
  items: [{
    productId: String,
    name: String,
    qty: Number,
    price: Number,
    image: String // Optional: store image snapshot
  }],
  totalUSD: Number,
  totalNPR: Number,
  paidAmount: Number,
  currency: String,
  paymentMethod: String,
  clientDetails: {
    name: String,
    email: String,
    phone: String,
    address: String
  },
  paymentScreenshot: String,
  status: { type: String, default: 'Pending' },
  emailStatus: { type: String, default: 'Queue' },
  timestamp: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

// ─── SECURITY MIDDLEWARE (Basic Auth) ────────────────────────────────────────
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

  if (user === validUser && pass === validPass) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="NaturaBotanica Admin"');
    return res.status(401).send('<h1>Access Denied</h1>');
  }
}

// ─── EMAIL SENDING FUNCTION (Client Status Update) ────────────────────────────
async function sendEmailViaAPI(toEmail, toName, orderId, status) {
  try {
    const senderEmail = 'sales.naturabotanica20@gmail.com';
    const senderName = 'NaturaBotanica';
    let displayStatus = status;
    if (status === 'Success') displayStatus = 'Payment Successful';

    const endpoint = 'https://api.sendinblue.com/v3/smtp/email';
    const data = {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: toEmail, name: toName }],
      subject: `Order Status Update: #${orderId}`,
      htmlContent: `<h3>Hello ${toName},</h3><p>Your order #${orderId} status is now: <strong>${displayStatus}</strong>.</p><p>Thank you for shopping with NaturaBotanica.</p>`
    };

    const response = await axios.post(endpoint, data, {
      headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' }
    });

    if (response.data && response.data.messageId) {
      console.log(`✅ Email sent (ID: ${response.data.messageId})`);
      return true;
    }
    return false;
  } catch (error) {
    console.error("❌ Email API Failed:", error.response ? error.response.data : error.message);
    return false;
  }
}

// ─── EMAIL SENDING FUNCTION (Admin New Order Notification) ────────────────────
async function sendAdminNotificationEmail(orderId, orderData) {
  try {
    const endpoint = 'https://api.sendinblue.com/v3/smtp/email';
    const senderEmail = 'sales.naturabotanica20@gmail.com';
    
    let itemsHtml = '<table style="width:100%; border-collapse: collapse; margin-top: 10px;">';
    itemsHtml += '<tr style="background:#f9fafb;"><th style="border:1px solid #e5e7eb; padding:8px;">Item</th><th style="border:1px solid #e5e7eb; padding:8px;">Qty</th><th style="border:1px solid #e5e7eb; padding:8px;">Price</th></tr>';

    if (orderData.items && Array.isArray(orderData.items)) {
      orderData.items.forEach(item => {
        const name = item.name || 'Unknown Item';
        const qty = parseInt(item.qty) || 1;
        const price = item.price || 0;
        itemsHtml += `<tr><td style="border:1px solid #e5e7eb; padding:8px;">${name}</td><td style="border:1px solid #e5e7eb; padding:8px; text-align:center;">${qty}</td><td style="border:1px solid #e5e7eb; padding:8px;">$${price}</td></tr>`;
      });
    }
    itemsHtml += '</table>';

    const data = {
      sender: { name: 'NaturaBotanica Website', email: senderEmail },
      to: [{ email: 'sales.naturabotanica20@gmail.com', name: 'Sales Team' }],
      subject: `🛒 NEW ORDER: #${orderId} - ${orderData.clientDetails.name}`,
      htmlContent: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2 style="color: #2d4a22;">New Order Received (#${orderId})</h2>
          <p><strong>Status:</strong> Payment Verified</p>
          <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <p><strong>Name:</strong> ${orderData.clientDetails.name}</p>
            <p><strong>Email:</strong> ${orderData.clientDetails.email}</p>
            <p><strong>Phone:</strong> ${orderData.clientDetails.phone}</p>
            <p><strong>Address:</strong> ${orderData.clientDetails.address}</p>
          </div>
          <h3>Order Details</h3>
          ${itemsHtml}
          <div style="margin-top: 20px; font-weight: bold; font-size: 1.2em;">Total: $${orderData.totalUSD} (${orderData.totalNPR} NPR)</div>
          ${orderData.paymentScreenshot ? `<p>📸 <a href="${orderData.paymentScreenshot}">View Payment Proof</a></p>` : ''}
        </div>`
    };

    await axios.post(endpoint, data, {
      headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' }
    });
    console.log(`✅ Admin Notification sent for Order #${orderId}`);
  } catch (error) {
    console.error("❌ Failed to send Admin Notification:", error.message);
  }
}

// ─── ROUTE 1: Receive New Order (PUBLIC) WITH STOCK CHECK ───────────────────
app.post('/order', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { items, totalUSD, totalNPR, paidAmount, currency, paymentMethod, clientDetails, timestamp, paymentScreenshot } = req.body;

    // 1. Validate & Decrement Stock
    for (const item of items) {
      const product = await Product.findOne({ productId: item.id || item.productId }).session(session);
      
      if (!product) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: `Product ${item.name} not found in database.` });
      }

      if (product.stock < (item.qty || item.quantity)) {
        await session.abortTransaction();
        return res.status(400).json({ 
            success: false, 
            message: `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.qty}` 
        });
      }

      product.stock -= (item.qty || item.quantity);
      await product.save({ session });
    }

    // 2. Create Order
    const newOrder = new Order({
      items,
      totalUSD,
      totalNPR,
      paidAmount,
      currency,
      paymentMethod,
      clientDetails,
      timestamp: timestamp || Date.now(),
      paymentScreenshot,
      status: 'Pending' // Default status
    });

    const savedOrder = await newOrder.save({ session });

    // 3. Commit Transaction
    await session.commitTransaction();
    session.endSession();

    // 4. Send Email (Non-blocking)
    await sendAdminNotificationEmail(savedOrder._id, req.body);

    res.status(200).json({ success: true, orderId: savedOrder._id });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Error processing order:', error);
    res.status(500).json({ success: false, message: 'Server error processing order' });
  }
});

// ─── ROUTE 2: Update Status (PROTECTED) ─────────────────────────────────────
app.put('/update-status', checkAuth, async (req, res) => {
  try {
    const { id, status } = req.body; // id is MongoDB _id here
    
    const order = await Order.findByIdAndUpdate(id, { status, emailStatus: 'Queue' }, { new: true });
    
    if (!order) return res.status(404).json({ success: false });

    let emailStatusResult = 'Queue';
    if (order.clientDetails.email && order.clientDetails.email.includes('@')) {
      const success = await sendEmailViaAPI(order.clientDetails.email, order.clientDetails.name, order._id, status);
      emailStatusResult = success ? 'Sent' : 'Failed';
      await Order.findByIdAndUpdate(id, { emailStatus: emailStatusResult });
    }

    res.json({ success: true, emailStatus: emailStatusResult });
  } catch (error) {
    console.error(`[FATAL ERROR]`, error);
    res.status(500).json({ success: false });
  }
});

// ─── ROUTE 3: Handle Contact/Inquiry (PUBLIC) ─────────────────────────────
app.post('/contact', async (req, res) => {
  // (Unchanged from original, simply copying logic)
  try {
    const { firstName, lastName, email, company, message } = req.body;
    const endpoint = 'https://api.sendinblue.com/v3/smtp/email';
    const data = {
      sender: { name: 'NaturaBotanica Website', email: 'sales.naturabotanica20@gmail.com' },
      to: [{ email: 'sales.naturabotanica20@gmail.com', name: 'Sales Team' }],
      subject: `New Inquiry: ${firstName} ${lastName}`,
      htmlContent: `<h3>New Inquiry</h3><p><strong>Name:</strong> ${firstName} ${lastName}</p><p><strong>Email:</strong> ${email}</p><p><strong>Message:</strong> ${message}</p>`
    };
    await axios.post(endpoint, data, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ─── ROUTE 4: Delete Single Order (PROTECTED) ────────────────────────────
app.delete('/delete-order/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findByIdAndDelete(id);
    if (!order) return res.status(404).json({ success: false });
    
    // Optional: Restore stock if deleting a pending order? 
    // Uncomment below if you want stock restoration on delete:
    /*
    if(order.status === 'Pending') {
        for (const item of order.items) {
            await Product.findOneAndUpdate({ productId: item.productId }, { $inc: { stock: item.qty } });
        }
    }
    */
    console.log(`🗑️ Order #${id} deleted`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ─── ROUTE 5: Delete Multiple Orders (PROTECTED) ─────────────────────────
app.delete('/delete-orders', checkAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    await Order.deleteMany({ _id: { $in: ids } });
    res.json({ success: true, deleted: ids });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ─── ROUTE 6: Stock Management API (Protected) ───────────────────────────
// Get Products
app.get('/api/products', checkAuth, async (req, res) => {
  const products = await Product.find().sort({ name: 1 });
  res.json(products);
});

// Add Product
app.post('/api/products', checkAuth, async (req, res) => {
  try {
    const newProduct = new Product(req.body);
    await newProduct.save();
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// Update Product (Stock)
app.put('/api/products/:id', checkAuth, async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false });
  }
});

// Delete Product
app.delete('/api/products/:id', checkAuth, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false });
  }
});

// ─── ROUTE 7: Stock Management UI (Protected) ───────────────────────────────
app.get('/manage-products', checkAuth, async (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Manage Stock</title>
    <style>
      body { font-family: sans-serif; padding: 20px; background: #f3f4f6; }
      .container { max-width: 1000px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      h1 { color: #2d4a22; }
      .form-group { margin-bottom: 15px; display: flex; gap: 10px; flex-wrap: wrap; }
      input { padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
      button { padding: 8px 16px; background: #2d4a22; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
      button:hover { background: #1e3219; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { padding: 10px; border: 1px solid #eee; text-align: left; }
      th { background: #f9fafb; }
      .stock-low { color: red; font-weight: bold; }
      .btn-sm { padding: 4px 8px; font-size: 0.8em; margin-left: 5px; }
      .btn-del { background: #b91c1c; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>📦 Stock Management</h1>
      <a href="/view-orders" style="display:inline-block; margin-bottom:20px; text-decoration:none; color:#2d4a22;">&larr; Back to Orders</a>
      
      <div class="form-group">
        <input type="text" id="pId" placeholder="Product ID (e.g. 101)" />
        <input type="text" id="pName" placeholder="Product Name" />
        <input type="number" id="pPrice" placeholder="Price" />
        <input type="number" id="pStock" placeholder="Stock Quantity" />
        <input type="text" id="pImg" placeholder="Image URL" />
        <button onclick="addProduct()">Add Product</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="product-list"></tbody>
      </table>
    </div>
    <script>
      async function loadProducts() {
        const res = await fetch('/api/products');
        const products = await res.json();
        const tbody = document.getElementById('product-list');
        tbody.innerHTML = products.map(p => \`
          <tr>
            <td>\${p.productId}</td>
            <td>\${p.name}</td>
            <td>$\${p.price}</td>
            <td class="\${p.stock < 5 ? 'stock-low' : ''}">\${p.stock}</td>
            <td>
              <button class="btn-sm" onclick="updateStock('\${p._id}', \${p.stock + 1})">+</button>
              <button class="btn-sm" onclick="updateStock('\${p._id}', \${p.stock - 1})">-</button>
              <button class="btn-sm btn-del" onclick="deleteProduct('\${p._id}')">Delete</button>
            </td>
          </tr>
        \`).join('');
      }

      async function addProduct() {
        const body = {
          productId: document.getElementById('pId').value,
          name: document.getElementById('pName').value,
          price: parseFloat(document.getElementById('pPrice').value),
          stock: parseInt(document.getElementById('pStock').value),
          image: document.getElementById('pImg').value
        };
        await fetch('/api/products', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body)
        });
        loadProducts();
      }

      async function updateStock(id, newStock) {
        await fetch('/api/products/' + id, {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ stock: newStock })
        });
        loadProducts();
      }

      async function deleteProduct(id) {
        if(confirm('Delete product?')) {
          await fetch('/api/products/' + id, { method: 'DELETE' });
          loadProducts();
        }
      }

      loadProducts();
    </script>
  </body>
  </html>`;
  res.send(html);
});

// ─── ROUTE 8: Admin Order Dashboard (UPDATED FOR MONGO) ────────────────────
app.get('/view-orders', checkAuth, async (req, res) => {
  try {
    // 1. Fetch from MongoDB
    const orders = await Order.find().sort({ _id: -1 }); // Descending order

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
        <title>NaturaBotanica — Admin</title>
        <style>
          /* ... (Keeping your existing CSS styles for brevity, assuming they are correct) ... */
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
          .btn-primary { background: #2d4a22; color: #fff; }
          .btn-primary:hover { background: #1e3219; }
          .selected-count { margin-left: auto; color: #6b7280; font-size: 14px; font-weight: 500; }

          .table-wrap { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; min-width: 1100px; }
          th, td { padding: 0; border: 1px solid #e5e7eb; vertical-align: top; text-align: left; }
          th { background: #2d4a22; color: #fff; font-weight: 600; font-size: 12px; text-transform: uppercase; padding: 10px; text-align: center; }
          tr { border-bottom: 1px solid #e5e7eb; background: #fff; }
          tr:hover { background: #fafafa; }
          tr.selected { background: #fffbeb; }
          input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: #2d4a22; }

          .col-date-proof { width: 120px; padding: 15px; display: flex; flex-direction: column; justify-content: space-between; align-items: center; background: #f9fafb; }
          .date-text { font-weight: 700; color: #2d4a22; font-size: 0.95rem; }
          .proof-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; border: 1px solid #d1d5db; cursor: pointer; margin-top: 10px; }
          .no-proof-thumb { width: 40px; height: 40px; background: #eee; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 10px; color: #999; margin-top: 10px; }

          .col-product { width: 320px; padding: 15px; }
          .prod-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
          .prod-id { font-size: 0.8rem; background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 4px; font-weight: 700; }
          .prod-total { font-size: 1rem; color: #111827; font-weight: 800; }
          .prod-items-list { font-size: 0.9rem; color: #4b5563; line-height: 1.5; }
          
          .item-row { display: flex; align-items: center; justify-content: space-between; width: calc(100% + 30px); margin-left: -15px; margin-right: -15px; padding-left: 15px; padding-right: 15px; border-bottom: 1px dashed #e5e7eb; padding-bottom: 4px; margin-bottom: 4px; box-sizing: border-box; }
          .item-thumb { width: 30px; height: 30px; object-fit: cover; border-radius: 4px; border: 1px solid #d1d5db; margin-right: 8px; flex-shrink: 0; background: #f3f4f6; }
          .item-text { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
          .item-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
          .item-qty { font-size: 0.85rem; color: #6b7280; font-weight: 500; white-space: nowrap; }

          .col-status { width: 160px; padding: 15px; display: flex; flex-direction: column; gap: 10px; justify-content: center; }
          .status-select { padding: 8px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; font-weight: 600; cursor: pointer; width: 100%; font-size: 13px; }
          .status-Pending { background: #fff7ed; color: #c2410c; }
          .status-Shipping { background: #eff6ff; color: #1d4ed8; }
          .status-Completed { background: #f0fdf4; color: #15803d; }
          .status-Success { background: #dcfce7; color: #15803d; }
          .status-Rejected { background: #fef2f2; color: #b91c1c; }

          .badge { display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 800; text-transform: uppercase; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          .badge-queue { background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); color: #92400e; border: 1px solid #fcd34d; }
          .badge-sent { background: linear-gradient(135deg, #ecfccb 0%, #d9f99d 100%); color: #365314; border: 1px solid #bef264; }
          .badge-fail { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); color: #991b1b; border: 1px solid #fca5a5; }

          .col-client { padding: 15px; flex-grow: 1; }
          .client-detail { font-size: 0.9rem; color: #374151; margin-bottom: 4px; display: flex; }
          .client-detail strong { color: #111827; min-width: 70px; display: inline-block; }

          .col-actions { width: 80px; padding: 15px; display: flex; align-items: center; justify-content: center; }
          .btn-delete-row { display: flex; justify-content: center; align-items: center; width: 100%; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; padding: 8px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px; }

          @media (max-width: 768px) {
            body { background: #e5e7eb; }
            .container { padding: 8px 0; max-width: 100%; }
            .toolbar { flex-direction: column; align-items: stretch; padding: 10px 8px; gap: 8px; }
            thead { display: none; }
            table { display: block; width: 100%; border-spacing: 0; }
            tbody { display: flex; flex-direction: column; gap: 12px; padding: 0 8px; }
            tr { display: flex; flex-direction: column; padding: 12px; border: 1px solid #e5e7eb; position: relative; }
            td { display: flex; width: 100%; border: none; margin-bottom: 8px; }
            td:nth-child(1) { position: absolute; top: 12px; right: 12px; width: auto; z-index: 10; background: #fff; padding: 4px; border-radius: 4px; border: 1px solid #e5e7eb; }
            td:nth-child(2) { flex-direction: row; justify-content: space-between; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 12px; }
            td:nth-child(3) { margin-bottom: 12px; width: 100%; }
            .item-row { margin: 0; width: 100%; padding: 0; }
            td:nth-child(4) { width: 100%; margin-bottom: 12px; }
            td:nth-child(5) { background: #f9fafb; padding: 10px; width: 100%; margin-bottom: 12px; border-radius: 6px; border: 1px solid #e5e7eb; }
            td:nth-child(6) { width: 100%; margin-top: 8px; }
            .btn-delete-row { width: 100%; background: #fee2e2; color: #b91c1b; border: 1px solid #fecaca; padding: 12px; border-radius: 6px; font-weight: 600; text-transform: uppercase; font-size: 14px; }
          }

          #toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(20px); background: #1f2937; color: #fff; padding: 12px 24px; border-radius: 50px; opacity: 0; transition: all 0.3s; z-index: 2000; width: 90%; text-align: center; pointer-events: none; }
          #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
          #imgModal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 3000; display: none; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; }
          #imgModal.show { display: flex; opacity: 1; }
          #imgModal img { max-width: 90%; max-height: 90%; border-radius: 8px; }
          .close-img { position: absolute; top: 20px; right: 20px; color: white; cursor: pointer; font-size: 40px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🌿 NaturaBotanica <span style="font-size:0.6em; opacity:0.5; font-weight:400; margin-left:5px;">Admin</span></h1>

          <div class="toolbar">
            <a href="/manage-products" class="btn btn-primary">📦 Manage Stock</a>
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
                  // MongoDB stores items as a native Array, no need for JSON.parse
                  const itemsList = row.items || [];
                  const status = row.status || 'Pending';
                  
                  // Badge Logic
                  let emailBadge = `<span class="badge badge-queue">Email Queue</span>`;
                  if (row.emailStatus === 'Sent') emailBadge = `<span class="badge badge-sent">Email Sent</span>`;
                  else if (row.emailStatus === 'Failed') emailBadge = `<span class="badge badge-fail">Email Failed</span>`;

                  // Date
                  const dateStr = new Date(row.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

                  // Items HTML
                  const itemsHtml = itemsList.map(item => {
                    const qty = parseInt(item.qty) || parseInt(item.quantity) || 1;
                    const imgSrc = item.img || item.image;
                    const imgHtml = imgSrc ? `<img src="${imgSrc}" class="item-thumb" onerror="this.style.display='none'">` : '';
                    // Check for ID from product
                    const pid = item.id || item.productId || item._id;
                    const pidHtml = pid ? `<span class="item-pid" style="font-size:0.75rem; color:#9ca3af; margin-left:4px;">(ID: ${pid})</span>` : '';

                    return `
                      <div class="item-row">
                        <div class="item-text">
                          ${imgHtml}
                          <span class="item-name" title="${item.name}">${item.name} ${pidHtml}</span>
                        </div>
                        <span class="item-qty">x${qty} @ $${item.price}</span>
                      </div>`;
                  }).join('');

                  return `
                  <tr id="row-${row._id}">
                    <!-- Checkbox (Uses MongoDB _id) -->
                    <td><input type="checkbox" class="row-chk" value="${row._id}" onchange="onCheckboxChange()"/></td>
                    
                    <!-- Date & Proof -->
                    <td class="col-date-proof">
                      <span class="date-text">${dateStr}</span>
                      ${row.paymentScreenshot ? 
                        `<img src="${row.paymentScreenshot}" class="proof-thumb" onclick="openImage('${row.paymentScreenshot}')" alt="Proof">` : 
                        `<div class="no-proof-thumb">No Img</div>`
                      }
                    </td>

                    <!-- Product Info -->
                    <td class="col-product">
                      <div class="prod-header">
                        <span class="prod-id">Order #${row._id.toString().slice(-6)}</span>
                        <span class="prod-total">Total: $${row.totalUSD}</span>
                      </div>
                      <div class="prod-items-list">
                        ${itemsHtml || '<span>No Items Data</span>'}
                      </div>
                    </td>

                    <!-- Status -->
                    <td class="col-status">
                      ${emailBadge}
                      <select onchange="updateStatus('${row._id}', this.value, this)" class="status-select status-${status}">
                        <option value="Pending"   ${status === 'Pending'   ? 'selected' : ''}>Pending</option>
                        <option value="Shipping"  ${status === 'Shipping'  ? 'selected' : ''}>Shipping</option>
                        <option value="Completed" ${status === 'Completed' ? 'selected' : ''}>Completed</option>
                        <option value="Success"   ${status === 'Success'   ? 'selected' : ''}>Payment Successful</option>
                        <option value="Rejected"  ${status === 'Rejected'  ? 'selected' : ''}>Rejected</option>
                      </select>
                    </td>

                    <!-- Client Details -->
                    <td class="col-client">
                      <div class="client-detail"><strong>Name:</strong> ${row.clientDetails.name || 'Guest'}</div>
                      <div class="client-detail"><strong>Phone:</strong> ${row.clientDetails.phone || '-'}</div>
                      <div class="client-detail"><strong>Email:</strong> ${row.clientDetails.email || '-'}</div>
                      <div class="client-detail"><strong>Address:</strong> ${row.clientDetails.address || '-'}</div>
                    </td>

                    <!-- Actions -->
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
        <div id="imgModal" onclick="closeImage(event)">
          <span class="close-img" onclick="closeImage(event)">&times;</span>
          <img id="fullImage" src="" alt="Full Payment Proof" onclick="event.stopPropagation()">
        </div>

        <script>
          function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg; t.classList.add('show');
            setTimeout(() => { t.classList.remove('show'); }, 3000);
          }
          function openImage(src) {
            document.getElementById('fullImage').src = src;
            const modal = document.getElementById('imgModal');
            modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10);
          }
          function closeImage(e) {
            if(e.target !== document.getElementById('fullImage')) {
                const modal = document.getElementById('imgModal');
                modal.classList.remove('show'); setTimeout(() => modal.style.display = 'none', 200);
            }
          }
          function getCheckedIds() { return [...document.querySelectorAll('.row-chk:checked')].map(c => c.value); }
          function onCheckboxChange() {
            const ids = getCheckedIds();
            const total = document.querySelectorAll('.row-chk').length;
            document.getElementById('btn-delete-selected').disabled = ids.length === 0;
            document.getElementById('selected-count').textContent = ids.length > 0 ? ids.length + ' selected' : '';
            document.getElementById('chk-all').checked = ids.length === total;
            document.querySelectorAll('.row-chk').forEach(chk => {
              document.getElementById('row-' + chk.value).classList.toggle('selected', chk.checked);
            });
          }
          function toggleSelectAll() {
            const chkAll = document.getElementById('chk-all');
            document.querySelectorAll('.row-chk').forEach(c => c.checked = chkAll.checked);
            onCheckboxChange();
          }

          function setBadge(id, status) {
            const cell = document.getElementById('row-' + id).querySelector('.badge');
            if (!cell) return;
            cell.classList.remove('badge-queue', 'badge-sent', 'badge-fail');
            if (status === 'Sent') {
              cell.classList.add('badge-sent'); cell.textContent = 'Email Sent';
            } else if (status === 'Failed') {
              cell.classList.add('badge-fail'); cell.textContent = 'Email Failed';
            } else {
              cell.classList.add('badge-queue'); cell.textContent = 'Email Queue';
            }
          }

          async function updateStatus(id, newStatus, selectEl) {
            selectEl.disabled = true;
            const originalClass = selectEl.className;
            selectEl.className = 'status-select'; 
            try {
              const response = await fetch('/update-status', { 
                  method: 'PUT', 
                  headers: { 'Content-Type': 'application/json' }, 
                  body: JSON.stringify({ id, status: newStatus }) 
              });
              const data = await response.json();
              selectEl.className = 'status-select status-' + newStatus;
              setBadge(id, data.emailStatus || 'Queue');
              showToast('✅ Status updated');
            } catch (err) {
              showToast('❌ Network error');
              selectEl.className = originalClass;
            } finally {
              selectEl.disabled = false;
            }
          }

          async function deleteSingle(id, btn) {
            if (!confirm('Delete order #' + id + '?')) return;
            btn.disabled = true; btn.textContent = '⏳...';
            try {
              const res = await fetch('/delete-order/' + id, { method: 'DELETE' });
              const data = await res.json();
              if (data.success) {
                document.getElementById('row-' + id).style.opacity = '0';
                setTimeout(() => { document.getElementById('row-' + id).remove(); onCheckboxChange(); }, 300);
                showToast('🗑️ Order deleted');
              } else {
                showToast('❌ Delete failed');
                btn.disabled = false; btn.textContent = 'Delete';
              }
            } catch (err) {
              showToast('❌ Network error');
              btn.disabled = false; btn.textContent = 'Delete';
            }
          }

          async function deleteSelected() {
            const ids = getCheckedIds();
            if (ids.length === 0 || !confirm('Delete ' + ids.length + ' order(s)?')) return;
            const btn = document.getElementById('btn-delete-selected');
            btn.disabled = true; btn.innerHTML = '⏳ Deleting...';
            try {
              const res = await fetch('/delete-orders', { 
                  method: 'DELETE', 
                  headers: { 'Content-Type': 'application/json' }, 
                  body: JSON.stringify({ ids }) 
              });
              const data = await res.json();
              if (data.success) {
                data.deleted.forEach(id => {
                    const el = document.getElementById('row-' + id);
                    if(el) { el.style.opacity = '0'; setTimeout(()=>el.remove(), 300); }
                });
                showToast('🗑️ Deleted ' + data.deleted.length + ' order(s)');
                setTimeout(() => onCheckboxChange(), 350);
              } else {
                showToast('❌ Delete failed');
              }
            } catch (err) {
              showToast('❌ Network error');
            } finally {
              btn.innerHTML = '🗑️ Delete Selected';
              btn.disabled = false;
              onCheckboxChange();
            }
          }
        </script>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.get('/', (req, res) => res.send('🌿 NaturaBotanica Node.js + MongoDB Backend Running'));
app.listen(port, () => console.log(`🚀 Node Server running on port ${
