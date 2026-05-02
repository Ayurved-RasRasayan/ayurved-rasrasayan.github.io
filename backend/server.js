const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const axios = require('axios'); 

const app = express();
const port = process.env.PORT || 3000;

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

  if (user === validUser && pass === validPass) {
    next(); 
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="NaturaBotanica Admin"');
    return res.status(401).send('<h1>Access Denied</h1>');
  }
}

// ─── EMAIL SENDING FUNCTION (HTTPS API) ──────────────────────────────────────────
async function sendEmailViaAPI(toEmail, toName, orderId, status, senderEmailOverride = null) {
  try {
    const senderEmail = senderEmailOverride || 'sales.naturabotanica20@gmail.com';
    const senderName = 'NaturaBotanica';

    console.log(`[EMAIL DEBUG] Sending from: ${senderEmail} -> To: ${toEmail}`);

    const endpoint = 'https://api.sendinblue.com/v3/smtp/email'; 
    
    const data = {
      sender: {
        name: senderName,
        email: senderEmail
      },
      to: [{
        email: toEmail,
        name: toName
      }],
      subject: `Order Status Update: #${orderId}`,
      htmlContent: `<h3>Hello ${toName},</h3><p>Your order #${orderId} status is now: <strong>${status}</strong>.</p><p>Thank you for shopping with NaturaBotanica.</p>`
    };

    const response = await axios.post(endpoint, data, {
      headers: {
        'api-key': process.env.EMAIL_PASS, 
        'content-type': 'application/json'
      }
    });

    if (response.data && response.data.messageId) {
      console.log(`✅ Email sent via API (ID: ${response.data.messageId})`);
      return true;
    } else {
      console.log("⚠️ Email API response unknown");
      return false;
    }

  } catch (error) {
    console.error("❌ Email API Failed:", error.response ? error.response.data : error.message);
    return false;
  }
}

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

// ─── TABLE SETUP & MIGRATION ─────────────────────────────────────────────────
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS orders (
    id                  SERIAL PRIMARY KEY,
    items               JSONB,
    total_usd           DECIMAL,
    total_npr           DECIMAL,
    paid_amount         DECIMAL,
    currency            VARCHAR,
    payment_method      VARCHAR,
    client_name         VARCHAR,
    client_phone        VARCHAR,
    client_email        VARCHAR,
    payment_screenshot  TEXT,
    status              VARCHAR DEFAULT 'Pending',
    email_status        VARCHAR DEFAULT 'Queue',
    timestamp           TIMESTAMP
  );
`;

pool.query(createTableQuery, (err) => {
  if (err) console.error('❌ Error creating table:', err);
  else {
    console.log("📊 Table 'orders' is ready");
    pool.query(`ALTER TABLE orders RENAME COLUMN email_sent TO email_status;`, (err) => {
      if(err && err.message.includes('column "email_sent" does not exist')) { /* Ignore */ }
    });
    pool.query(`ALTER TABLE orders ALTER COLUMN email_status TYPE VARCHAR USING email_status::TEXT;`, (err) => {
        if(err) console.log("ℹ️ DB Migration checked.");
    });
  }
});

// ─── ROUTE 1: Receive New Order (PUBLIC) ────────────────────────────────────
app.post('/order', async (req, res) => {
  try {
    const {
      items, totalUSD, totalNPR, paidAmount,
      currency, paymentMethod, clientDetails, timestamp,
      paymentScreenshot
    } = req.body;

    const query = `
      INSERT INTO orders 
        (items, total_usd, total_npr, paid_amount, currency,
         payment_method, client_name, client_phone, client_email, payment_screenshot, 
         status, email_status, timestamp)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id;
    `;

    const values = [
      JSON.stringify(items), totalUSD, totalNPR, paidAmount,
      currency, paymentMethod,
      clientDetails.name, clientDetails.phone, clientDetails.email,
      paymentScreenshot, 
      'Pending',             
      'Queue',                
      timestamp
    ];

    const result = await pool.query(query, values);
    res.status(200).json({ success: true, orderId: result.rows[0].id });
  } catch (error) {
    console.error('❌ Error saving order:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 2: Update Status (PROTECTED) ─────────────────────────────────────
app.put('/update-status', checkAuth, async (req, res) => {
  try {
    const { id, status } = req.body;
    console.log(`\n[DEBUG] Updating Order #${id} to '${status}'...`);

    await pool.query(`UPDATE orders SET status = $1, email_status = 'Queue' WHERE id = $2`, [status, id]);
    
    const orderResult = await pool.query('SELECT client_name, client_email FROM orders WHERE id = $1', [id]);
    if (orderResult.rows.length === 0) return res.status(404).json({ success: false });
    
    const { client_name, client_email } = orderResult.rows[0];
    let emailStatusResult = 'Queue'; 

    if (client_email && client_email.includes('@')) {
      const success = await sendEmailViaAPI(client_email, client_name, id, status);
      
      if (success) {
        await pool.query(`UPDATE orders SET email_status = 'Sent' WHERE id = $1`, [id]);
        emailStatusResult = 'Sent';
      } else {
        await pool.query(`UPDATE orders SET email_status = 'Failed' WHERE id = $1`, [id]);
        emailStatusResult = 'Failed';
      }

    } else {
      console.log(`⚠️ No valid email found for #${id}`);
    }

    res.json({ success: true, message: `Status updated.`, emailStatus: emailStatusResult });

  } catch (error) {
    console.error(`[FATAL ERROR]`, error);
    res.status(500).json({ success: false, message: 'Server error', emailStatus: 'Failed' });
  }
});

// ─── ROUTE 3: Handle Contact/Inquiry (PUBLIC) ─────────────────────────────
app.post('/contact', async (req, res) => {
  try {
    const { firstName, lastName, email, company, message } = req.body;
    const fullName = `${firstName} ${lastName}`;

    const endpoint = 'https://api.sendinblue.com/v3/smtp/email';
    const senderEmail = 'sales.naturabotanica20@gmail.com';
    const senderName = 'NaturaBotanica Website';

    const data = {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: 'sales.naturabotanica20@gmail.com', name: 'Sales Team' }],
      subject: `New Inquiry: ${fullName}`,
      htmlContent: `
        <h3>New Inquiry Received</h3>
        <p><strong>Name:</strong> ${fullName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Company:</strong> ${company || 'N/A'}</p>
        <hr style="margin: 15px 0; border: 0; border-top: 1px solid #eee;">
        <h4>Message:</h4>
        <p style="white-space: pre-wrap;">${message}</p>
      `
    };

    await axios.post(endpoint, data, {
      headers: {
        'api-key': process.env.EMAIL_PASS,
        'content-type': 'application/json'
      }
    });

    console.log(`✅ Inquiry sent from ${email} to Sales Team`);
    res.status(200).json({ success: true });

  } catch (error) {
    console.error('❌ Error sending inquiry:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 4: Delete Single Order (PROTECTED) ────────────────────────────
app.delete('/delete-order/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Order not found' });
    console.log(`🗑️ Order #${id} deleted`);
    res.json({ success: true, message: `Order #${id} deleted` });
  } catch (error) {
    console.error('❌ Error deleting order:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 5: Delete Multiple Orders (PROTECTED) ─────────────────────────
app.delete('/delete-orders', checkAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No order IDs provided' });
    }
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `DELETE FROM orders WHERE id = ANY(ARRAY[${placeholders}]::int[]) RETURNING id`,
      ids
    );
    console.log(`🗑️ Deleted ${result.rowCount} order(s): ${ids.join(', ')}`);
    res.json({ success: true, deleted: result.rows.map(r => r.id) });
  } catch (error) {
    console.error('❌ Error deleting orders:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 6: Admin Order Dashboard (PROTECTED & TIGHT MOBILE) ────────────
app.get('/view-orders', checkAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY id DESC');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
        <title>NaturaBotanica — Admin</title>
        <style>
          /* ─── RESET & GLOBAL ───────────────────────────────────────────── */
          * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            background: #f3f4f6; margin: 0; padding: 0; color: #1f2937; 
          }
          .container { max-width: 1200px; margin: 0 auto; padding: 16px; }
          
          h1 { 
            color: #2d4a22; font-size: 1.5rem; margin: 0 0 20px 0; 
            display: flex; align-items: center; gap: 10px; 
          }

          /* ─── TOOLBAR ───────────────────────────────────────────────────── */
          .toolbar { 
            display: flex; align-items: center; gap: 10px; margin-bottom: 20px; 
            flex-wrap: wrap; background: #fff; padding: 12px; 
            border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); 
          }
          .btn { 
            padding: 10px 18px; border-radius: 8px; border: none; font-weight: 600; 
            cursor: pointer; font-size: 14px; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px;
          }
          .btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .btn-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
          .btn-danger:hover:not(:disabled) { background: #fecaca; }
          .btn-secondary { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
          .btn-secondary:hover:not(:disabled) { background: #e5e7eb; }
          .selected-count { margin-left: auto; color: #6b7280; font-size: 14px; font-weight: 500; }

          /* ─── DESKTOP TABLE ────────────────────────────────────────────── */
          .table-wrap { background: #fff; border-radius: 10px; overflow-x: auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          table { width: 100%; border-collapse: collapse; min-width: 800px; }
          th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid #f3f4f6; }
          th { background: #2d4a22; color: #fff; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; }
          tr:hover { background: #fafafa; }
          tr.selected { background: #fffbeb; }

          /* Desktop Inputs */
          input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: #2d4a22; }
          select.status-select { padding: 8px 12px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; font-weight: 600; cursor: pointer; width: 100%; max-width: 160px; font-size: 13px; }
          
          /* Status Colors (Desktop) */
          .status-Pending   { background: #fff7ed; color: #c2410c; }
          .status-Shipping  { background: #eff6ff; color: #1d4ed8; }
          .status-Completed { background: #f0fdf4; color: #15803d; }
          .status-Success   { background: #dcfce7; color: #15803d; }
          .status-Rejected  { background: #fef2f2; color: #b91c1c; }

          /* Badges (Desktop) */
          .badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
          .badge-queue { background: #fffbeb; color: #b45309; border: 1px solid #fcd34d; }
          .badge-sent  { background: #ecfccb; color: #3f6212; border: 1px solid #bef264; }
          .badge-fail  { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }

          .screenshot-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; cursor: pointer; transition: transform 0.2s; }
          .screenshot-thumb:hover { transform: scale(1.1); }


          /* ─── MOBILE RESPONSIVE VIEW (TIGHT & TIDY) ───────────────────── */
          @media (max-width: 400px) {
            body { background: #e5e7eb; } 
            .container { padding: 10px; }
            
            /* 1. Layout Basics */
            .toolbar { flex-direction: column; align-items: stretch; padding: 10px; gap: 8px; }
            .selected-count { margin: 0; text-align: center; font-size: 12px; }
            .btn { width: 100%; justify-content: center; padding: 12px; }

            thead { display: none; } /* Hide Headers */
            table, tbody, tr { display: block; width: 100%; }

            /* 2. The Card */
            tr {
              background: #fff;
              border-radius: 12px;
              padding: 16px;
              margin-bottom: 16px;
              box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
              border: 1px solid #e5e7eb;
              position: relative;
            }
            tr.selected { border: 2px solid #2d4a22; box-shadow: 0 0 0 4px rgba(45, 74, 34, 0.1); }

            /* 3. Cell Styling - Reduced Margins for Tidiness */
            td {
              display: flex;
              width: 100%;
              padding: 0;
              border: none;
              align-items: center; 
              margin-bottom: 4px; /* Reduced from 8px */
            }
            td::before { display: none; } 

            /* 4. Specific Ordering & Styling */
            
            /* Checkbox */
            td:nth-child(1) {
              position: absolute; top: 16px; right: 16px; width: auto; margin: 0; z-index: 10; padding: 4px; background: #fff; border-radius: 4px;
            }
            td:nth-child(1) input { width: 20px; height: 20px; }

            /* Client Name */
            td:nth-child(3) {
              order: 2; flex-direction: column; align-items: flex-start; margin-bottom: 2px;
            }
            td:nth-child(3) strong { font-size: 1.2rem; color: #111827; display: block; margin-bottom: 2px; }
            td:nth-child(3) small { font-size: 0.85rem; color: #6b7280; font-weight: 400; }

            /* Order ID */
            td:nth-child(2) {
              order: 3; font-size: 0.8rem; color: #9ca3af; margin-top: -4px; margin-bottom: 8px;
            }

            /* Amount - The Divider */
            td:nth-child(4) {
              order: 4; font-size: 1.1rem; font-weight: 700; color: #059669; background: #ecfdf5; padding: 10px 12px; border-radius: 6px; align-self: flex-start; margin-bottom: 12px;
            }

            /* ORDER STATUS (The Shipping Button) */
            td:nth-child(7) {
              order: 5; margin: 0 0 2px 0; /* Tight spacing */
            }
            td:nth-child(7) select {
              width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #d1d5db; font-size: 15px; background: #fff;
              appearance: none; background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
              background-repeat: no-repeat; background-position: right 12px top 50%; background-size: 12px auto;
            }

            /* EMAIL STATUS - Directly under Order Status */
            td:nth-child(6) {
              order: 6; justify-content: flex-end; margin-bottom: 8px;
            }
            
            /* PAYMENT PROOF - Directly under Email Status */
            td:nth-child(5) {
              order: 7; justify-content: flex-start; background: #f9fafb; padding: 8px; border-radius: 6px; border: 1px dashed #d1d5db; margin-bottom: 4px;
            }
            td:nth-child(5)::before {
              display: inline; content: "Payment Proof"; font-size: 0.75rem; color: #6b7280; font-weight: 600; margin-right: 10px;
            }
            td:nth-child(5) .no-proof { color: #9ca3af; font-size: 0.8rem; font-style: italic; }
            td:nth-child(5) img { border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }

            /* ACTIONS/DELETE - Directly touching Payment Proof */
            td:nth-child(8) {
              order: 8; margin-top: 0;
            }
            td:nth-child(8) button {
              width: 100%; background: #fee2e2; color: #b91c1c; padding: 12px; border-radius: 8px; font-weight: 600; border: 1px solid #fecaca;
              display: flex; justify-content: center; align-items: center; gap: 8px; font-size: 15px;
            }
          }

          /* ─── MODALS & TOASTS ───────────────────────────────────────────── */
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
          <h1>🌿 NaturaBotanica <span style="font-size:0.6em; opacity:0.5; font-weight:400; margin-left:5px;">v12</span></h1>

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
                  <th>ID</th>
                  <th>Client</th>
                  <th>Amount</th>
                  <th>Payment Proof</th>
                  <th>Email Status</th>
                  <th>Order Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="orders-tbody">
                ${result.rows.map(row => {
                  const status = row.status || 'Pending';
                  let emailBadge = `<span class="badge badge-queue">⏳ Queue</span>`;
                  if (row.email_status === 'Sent') {
                    emailBadge = `<span class="badge badge-sent">✅ Sent</span>`;
                  } else if (row.email_status === 'Failed') {
                    emailBadge = `<span class="badge badge-fail">❌ Failed</span>`;
                  }

                  return `
                  <tr id="row-${row.id}">
                    <td data-label="Select"><input type="checkbox" class="row-chk" value="${row.id}" onchange="onCheckboxChange()"/></td>
                    <td data-label="Order">#${row.id}</td>
                    <td data-label="Client">
                      <strong>${row.client_name || 'Guest'}</strong><br>
                      <small>${row.client_email || ''}</small>
                    </td>
                    <td data-label="Amount">$${row.total_usd}</td>
                    <td data-label="Payment Proof">
                      ${row.payment_screenshot ? 
                        `<img src="${row.payment_screenshot}" class="screenshot-thumb" onclick="openImage('${row.payment_screenshot}')" alt="Proof">` : 
                        '<span class="no-proof">No Proof</span>'}
                    </td>
                    <td data-label="Email Status">${emailBadge}</td>
                    <td data-label="Order Status">
                      <select onchange="updateStatus(${row.id}, this.value, this)" class="status-select status-${status}">
                        <option value="Pending"   ${status === 'Pending'   ? 'selected' : ''}>Pending</option>
                        <option value="Shipping"  ${status === 'Shipping'  ? 'selected' : ''}>Shipping</option>
                        <option value="Completed" ${status === 'Completed' ? 'selected' : ''}>Completed</option>
                        <option value="Success"   ${status === 'Success'   ? 'selected' : ''}>Payment Successful</option>
                        <option value="Rejected"  ${status === 'Rejected'  ? 'selected' : ''}>Rejected</option>
                      </select>
                    </td>
                    <td data-label="Actions"><button class="btn btn-delete-single" onclick="deleteSingle(${row.id}, this)">🗑️ Delete</button></td>
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
            t.textContent = msg; 
            t.classList.add('show');
            setTimeout(() => { t.classList.remove('show'); }, 3000);
          }
          function openImage(src) {
            document.getElementById('fullImage').src = src;
            const modal = document.getElementById('imgModal');
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('show'), 10);
          }
          function closeImage(e) {
            if(e.target !== document.getElementById('fullImage')) {
                const modal = document.getElementById('imgModal');
                modal.classList.remove('show');
                setTimeout(() => modal.style.display = 'none', 200);
            }
          }
          function getCheckedIds() {
            return [...document.querySelectorAll('.row-chk:checked')].map(c => parseInt(c.value));
          }
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
            const cell = document.getElementById('row-' + id).querySelector('td:nth-child(6)'); 
            if (!cell) return;
            if (status === 'Sent') {
                cell.innerHTML = '<span class="badge badge-sent">✅ Sent</span>';
            } else if (status === 'Failed') {
                cell.innerHTML = '<span class="badge badge-fail">❌ Failed</span>';
            } else {
                cell.innerHTML = '<span class="badge badge-queue">⏳ Queue</span>';
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

              if (data.emailStatus === 'Failed') showToast('❌ Status updated but Email failed');
              else if (data.emailStatus === 'Sent') showToast('✅ Status updated & Email Sent');
              else showToast('✅ Status updated');

            } catch (err) {
              showToast('❌ Network error');
              selectEl.className = originalClass;
            } finally {
              selectEl.disabled = false;
            }
          }

          async function deleteSingle(id, btn) {
            if (!confirm('Delete order #' + id + '?')) return;
            btn.disabled = true; 
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳...';
            
            try {
              const res = await fetch('/delete-order/' + id, { method: 'DELETE' });
              const data = await res.json();
              if (data.success) {
                document.getElementById('row-' + id).style.opacity = '0';
                setTimeout(() => {
                    document.getElementById('row-' + id).remove();
                    onCheckboxChange();
                }, 300);
                showToast('🗑️ Order #' + id + ' deleted');
              } else {
                showToast('❌ Delete failed');
                btn.disabled = false; btn.innerHTML = originalText;
              }
            } catch (err) {
              showToast('❌ Network error');
              btn.disabled = false; btn.innerHTML = originalText;
            }
          }

          async function deleteSelected() {
            const ids = getCheckedIds();
            if (ids.length === 0 || !confirm('Delete ' + ids.length + ' order(s)?')) return;
            
            const btn = document.getElementById('btn-delete-selected');
            const originalText = btn.innerHTML;
            btn.disabled = true; 
            btn.innerHTML = '⏳ Deleting...';
            
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
              btn.innerHTML = originalText;
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

app.get('/', (req, res) => res.send('🌿 NaturaBotanica Node.js Backend Running v12 (Tight Mobile)'));
app.listen(port, () => console.log(`🚀 Node Server running on port ${port}`));
