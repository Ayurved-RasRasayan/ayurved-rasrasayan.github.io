const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors());

// ─── EMAIL CONFIGURATION (Gmail - Reliable on Render) ────────────────────────
// Setup steps:
//   1. Enable 2-Step Verification on your Google account
//   2. Go to: myaccount.google.com/apppasswords
//   3. Generate an App Password (select "Mail" + "Other")
//   4. In Render → Environment Variables, set:
//      EMAIL_USER = yourname@gmail.com
//      EMAIL_PASS = the 16-character app password (no spaces)

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify email connection on startup — check Render logs to confirm
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Email transporter error:', error.message);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

// ─── DATABASE CONNECTION ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) return console.error('❌ Error acquiring DB client:', err.stack);
  console.log('✅ Connected to PostgreSQL Database');
  release();
});

// ─── TABLE SETUP ──────────────────────────────────────────────────────────────
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    items           JSONB,
    total_usd       DECIMAL,
    total_npr       DECIMAL,
    paid_amount     DECIMAL,
    currency        VARCHAR,
    payment_method  VARCHAR,
    client_name     VARCHAR,
    client_phone    VARCHAR,
    client_email    VARCHAR,
    status          VARCHAR DEFAULT 'Pending',
    timestamp       TIMESTAMP
  );
`;

pool.query(createTableQuery, (err) => {
  if (err) console.error('❌ Error creating table:', err);
  else console.log("📊 Table 'orders' is ready");
});

// Ensure status column exists (safe for existing tables)
pool.query(
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'Pending';`,
  (err) => {
    if (err) console.error('❌ Error updating table schema:', err);
    else console.log("🔧 'status' column verified");
  }
);

// ─── HELPER: Build email HTML ─────────────────────────────────────────────────
function buildEmailHtml(order, status) {
  const statusColors = {
    Pending:   { bg: '#fff7ed', text: '#b45309', border: '#fcd34d' },
    Shipping:  { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
    Completed: { bg: '#f0fdf4', text: '#15803d', border: '#86efac' },
    Success:   { bg: '#dcfce7', text: '#15803d', border: '#86efac' },
    Rejected:  { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' }
  };
  const color = statusColors[status] || { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' };

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px;
                overflow: hidden; border: 1px solid #e5e7eb;">

      <!-- Header -->
      <div style="background: #2d4a22; padding: 28px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px; letter-spacing: 1px;">
          🌿 NaturaBotanica
        </h1>
        <p style="color: #a3b14b; margin: 6px 0 0; font-size: 14px;">Order Status Update</p>
      </div>

      <!-- Body -->
      <div style="padding: 32px;">
        <p style="color: #374151; font-size: 16px; margin: 0 0 20px;">
          Hello <strong>${order.client_name}</strong>,
        </p>
        <p style="color: #6b7280; margin: 0 0 24px;">
          Your order status has been updated. Here is the current status:
        </p>

        <!-- Status Badge -->
        <div style="background: ${color.bg}; border: 1px solid ${color.border};
                    border-radius: 8px; padding: 16px 20px; text-align: center; margin-bottom: 24px;">
          <span style="color: ${color.text}; font-size: 20px; font-weight: 700;">${status}</span>
        </div>

        <!-- Order Details -->
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">
              Order ID
            </td>
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;
                       font-weight: 600; text-align: right;">
              #${order.id}
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">
              Total (USD)
            </td>
            <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;
                       font-weight: 600; text-align: right;">
              $${order.total_usd}
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">
              Total (NPR)
            </td>
            <td style="padding: 10px 0; color: #111827; font-weight: 600; text-align: right;">
              Rs. ${order.total_npr}
            </td>
          </tr>
        </table>

        <p style="color: #6b7280; font-size: 14px; margin: 28px 0 0;">
          Thank you for shopping with NaturaBotanica! If you have any questions, 
          reply to this email or contact us at
          <a href="mailto:sales@naturabotanica.com" style="color: #a3b14b;">
            sales@naturabotanica.com
          </a>.
        </p>
      </div>

      <!-- Footer -->
      <div style="background: #f9fafb; padding: 16px 32px; text-align: center;
                  border-top: 1px solid #e5e7eb;">
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          © ${new Date().getFullYear()} NaturaBotanica. All rights reserved.
        </p>
      </div>
    </div>
  `;
}

// ─── ROUTE 1: Receive New Order ───────────────────────────────────────────────
app.post('/order', async (req, res) => {
  try {
    const {
      items, totalUSD, totalNPR, paidAmount,
      currency, paymentMethod, clientDetails, timestamp
    } = req.body;

    const query = `
      INSERT INTO orders
        (items, total_usd, total_npr, paid_amount, currency,
         payment_method, client_name, client_phone, client_email, timestamp)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id;
    `;
    const values = [
      JSON.stringify(items), totalUSD, totalNPR, paidAmount,
      currency, paymentMethod,
      clientDetails.name, clientDetails.phone, clientDetails.email,
      timestamp
    ];

    const result = await pool.query(query, values);
    const orderId = result.rows[0].id;
    console.log(`📝 New Order #${orderId} from ${clientDetails.name}`);

    res.status(200).json({ success: true, orderId });
  } catch (error) {
    console.error('❌ Error saving order:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 2: Update Status & Send Email ─────────────────────────────────────
app.put('/update-status', async (req, res) => {
  try {
    const { id, status } = req.body;

    // 1. Update status in DB
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);

    // 2. Fetch full order details
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    const order = orderResult.rows[0];

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // 3. Send email if customer has an email address
    let emailSent = false;
    let emailMessage = '';

    if (order.client_email) {
      try {
        await transporter.sendMail({
          from: `"NaturaBotanica" <${process.env.EMAIL_USER}>`,
          to: order.client_email,
          subject: `Your Order #${id} — Status: ${status}`,
          html: buildEmailHtml(order, status)
        });

        emailSent = true;
        emailMessage = `Email sent to ${order.client_email}`;
        console.log(`📧 Email sent → ${order.client_email} | Order #${id} | Status: ${status}`);
      } catch (emailError) {
        emailMessage = 'Status updated, but email failed to send. Check Render logs.';
        console.error('❌ Email send error:', emailError.message);
      }
    } else {
      emailMessage = 'Status updated (no email address on file)';
    }

    res.json({ success: true, emailSent, message: emailMessage });

  } catch (error) {
    console.error('❌ Error updating status:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 3: Admin Order Dashboard ──────────────────────────────────────────
app.get('/view-orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY id DESC');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>NaturaBotanica — Orders</title>
        <style>
          *, *::before, *::after { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f3f4f6; margin: 0; padding: 24px;
          }
          .container { max-width: 1200px; margin: 0 auto; }
          header { text-align: center; margin-bottom: 32px; }
          header h1 { color: #1f2937; margin: 0; font-size: 26px; }
          header p { color: #6b7280; margin: 6px 0 0; }

          /* Stats bar */
          .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
          .stat-card {
            background: #fff; border-radius: 10px; padding: 16px 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,.08); flex: 1; min-width: 140px;
          }
          .stat-card .label { font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: .5px; }
          .stat-card .value { font-size: 26px; font-weight: 700; color: #1f2937; margin-top: 4px; }

          /* Table */
          .table-wrap {
            background: #fff; border-radius: 12px; overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,.08);
          }
          table { width: 100%; border-collapse: collapse; }
          th {
            background: #1f2937; color: #fff; padding: 14px 16px;
            text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .5px;
          }
          td { padding: 14px 16px; border-bottom: 1px solid #f3f4f6; color: #374151; vertical-align: middle; }
          tr:last-child td { border-bottom: none; }
          tr:hover td { background: #fafafa; }

          /* Status dropdown */
          select.status-select {
            padding: 7px 12px; border-radius: 6px; border: 1px solid #d1d5db;
            font-size: 13px; font-weight: 500; cursor: pointer; outline: none;
            transition: all .2s; width: 148px; appearance: none; background-image:
              url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
            background-repeat: no-repeat; background-position: right 10px center;
            padding-right: 28px;
          }
          .status-Pending   { background-color:#fff7ed; color:#b45309; border-color:#fcd34d; }
          .status-Shipping  { background-color:#eff6ff; color:#1e40af; border-color:#bfdbfe; }
          .status-Completed { background-color:#f0fdf4; color:#15803d; border-color:#86efac; }
          .status-Success   { background-color:#dcfce7; color:#15803d; border-color:#86efac; }
          .status-Rejected  { background-color:#fee2e2; color:#991b1b; border-color:#fca5a5; }

          .price { font-weight: 700; font-family: monospace; font-size: 15px; }
          .sub   { color: #9ca3af; font-size: 12px; margin-top: 2px; }
          .badge {
            display: inline-block; font-size: 11px; font-weight: 600;
            padding: 3px 8px; border-radius: 999px; background: #f3f4f6; color: #6b7280;
          }

          /* Toast */
          #toast {
            position: fixed; bottom: 24px; right: 24px;
            background: #1f2937; color: #fff; padding: 12px 20px;
            border-radius: 8px; font-size: 14px; display: none;
            box-shadow: 0 4px 12px rgba(0,0,0,.2); z-index: 1000;
            animation: slideUp .3s ease;
          }
          @keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
          .empty { text-align: center; padding: 60px 20px; color: #9ca3af; }
        </style>
      </head>
      <body>
        <div class="container">
          <header>
            <h1>📦 NaturaBotanica Orders</h1>
            <p>Manage sales, shipping, and fulfillment</p>
          </header>

          <!-- Stats -->
          <div class="stats">
            <div class="stat-card">
              <div class="label">Total Orders</div>
              <div class="value">${result.rows.length}</div>
            </div>
            <div class="stat-card">
              <div class="label">Pending</div>
              <div class="value">${result.rows.filter(r => (r.status || 'Pending') === 'Pending').length}</div>
            </div>
            <div class="stat-card">
              <div class="label">Shipping</div>
              <div class="value">${result.rows.filter(r => r.status === 'Shipping').length}</div>
            </div>
            <div class="stat-card">
              <div class="label">Completed</div>
              <div class="value">${result.rows.filter(r => r.status === 'Completed' || r.status === 'Success').length}</div>
            </div>
            <div class="stat-card">
              <div class="label">Rejected</div>
              <div class="value">${result.rows.filter(r => r.status === 'Rejected').length}</div>
            </div>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date & Time</th>
                  <th>Client</th>
                  <th>Payment</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${result.rows.length === 0
                  ? `<tr><td colspan="6"><div class="empty">No orders yet.</div></td></tr>`
                  : result.rows.map(row => {
                      const status = row.status || 'Pending';
                      const date = new Date(row.timestamp);
                      let itemCount = 0;
                      try { if (row.items) itemCount = JSON.parse(row.items).length; } catch (e) {}
                      return `
                        <tr>
                          <td><strong>#${row.id}</strong><br><span class="sub">${itemCount} item${itemCount !== 1 ? 's' : ''}</span></td>
                          <td>
                            ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            <div class="sub">${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                          </td>
                          <td>
                            <strong>${row.client_name || 'Guest'}</strong>
                            <div class="sub">${row.client_phone || ''}</div>
                            <div class="sub">${row.client_email || '<em>No email</em>'}</div>
                          </td>
                          <td>
                            <span class="badge">${row.payment_method || '—'}</span>
                            <div class="sub">${row.currency || ''}</div>
                          </td>
                          <td>
                            <div class="price">$${row.total_usd}</div>
                            <div class="sub">Rs. ${row.total_npr}</div>
                          </td>
                          <td>
                            <select
                              onchange="updateStatus(${row.id}, this.value, this)"
                              class="status-select status-${status}"
                            >
                              <option value="Pending"   ${status === 'Pending'   ? 'selected' : ''}>⏳ Pending</option>
                              <option value="Shipping"  ${status === 'Shipping'  ? 'selected' : ''}>🚚 Shipping</option>
                              <option value="Completed" ${status === 'Completed' ? 'selected' : ''}>✅ Completed</option>
                              <option value="Success"   ${status === 'Success'   ? 'selected' : ''}>🎉 Success</option>
                              <option value="Rejected"  ${status === 'Rejected'  ? 'selected' : ''}>🚫 Rejected</option>
                            </select>
                          </td>
                        </tr>
                      `;
                    }).join('')
                }
              </tbody>
            </table>
          </div>
        </div>

        <div id="toast"></div>

        <script>
          function showToast(msg, success = true) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.style.background = success ? '#065f46' : '#991b1b';
            t.style.display = 'block';
            setTimeout(() => { t.style.display = 'none'; }, 3500);
          }

          async function updateStatus(id, newStatus, selectEl) {
            const original = selectEl.dataset.original || selectEl.value;
            selectEl.disabled = true;

            try {
              const response = await fetch('/update-status', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: newStatus })
              });

              const data = await response.json();

              if (data.success) {
                // Update dropdown color
                selectEl.className = 'status-select status-' + newStatus;
                selectEl.dataset.original = newStatus;

                if (data.emailSent) {
                  showToast('✅ Status updated & email sent to customer', true);
                } else {
                  showToast('⚠️ Status updated — ' + data.message, false);
                }
              } else {
                showToast('❌ Server rejected the update', false);
              }
            } catch (err) {
              console.error(err);
              showToast('❌ Network error — could not update', false);
            } finally {
              selectEl.disabled = false;
            }
          }
        </script>
      </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    console.error('❌ Error retrieving orders:', err);
    res.status(500).send(`
      <div style="font-family:sans-serif;color:red;padding:30px;">
        <h2>Error retrieving orders</h2>
        <p>${err.message}</p>
      </div>
    `);
  }
});

// ─── ROOT ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('🌿 NaturaBotanica Backend is Running ✅');
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
