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

// ─── ROUTE 6: Admin Order Dashboard (PROTECTED & RESPONSIVE) ────────────
app.get('/view-orders', checkAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY id DESC');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
        <title>NaturaBotanica — Mobile Orders</title>
        <style>
          /* ─── GLOBAL & RESET ───────────────────────────────────────────────────── */
          * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f3f4f6; padding: 15px; margin: 0; color: #333; }
          .container { max-width: 1200px; margin: 0 auto; }
          
          h1 { color: #2d4a22; font-size: 1.5rem; margin-bottom: 15px; display: flex; align-items: center; gap: 8px; }

          /* ─── TOOLBAR ───────────────────────────────────────────────────────── */
          .toolbar { 
            display: flex; align-items: center; gap: 10px; margin-bottom: 20px; 
            flex-wrap: wrap; background: #fff; padding: 10px; 
            border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }
          .btn { 
            padding: 10px 16px; border-radius: 6px; border: none; font-weight: 600; 
            cursor: pointer; font-size: 14px; transition: opacity 0.2s, background 0.2s; 
            display: inline-flex; align-items: center; justify-content: center;
          }
          .btn:disabled { opacity: 0.5; cursor: not-allowed; filter: grayscale(1); }
          .btn-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
          .btn-danger:hover:not(:disabled) { background: #fecaca; }
          .btn-secondary { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
          .btn-secondary:hover:not(:disabled) { background: #e5e7eb; }
          .selected-count { color: #6b7280; font-size: 14px; margin-left: auto; font-weight: 500; }

          /* ─── DESKTOP TABLE VIEW ─────────────────────────────────────────────── */
          .table-wrap { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #eee; vertical-align: middle; }
          th { background: #2d4a22; color: white; font-weight: 600; white-space: nowrap; }
          tr.selected { background: #fef9c3; }
          tr:hover { background-color: #fafafa; }
          
          /* Inputs & Selects in Table */
          input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: #2d4a22; }
          select.status-select { padding: 8px 12px; border-radius: 6px; border: 1px solid #ccc; font-weight: bold; cursor: pointer; width: 100%; max-width: 180px; }
          
          /* Status Colors */
          .status-Pending   { background: #fff7ed; color: #b45309; border-color: #fed7aa; }
          .status-Shipping  { background: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
          .status-Completed { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
          .status-Success   { background: #dcfce7; color: #15803d; border-color: #86efac; }
          .status-Rejected  { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
          
          /* Email Badges */
          .badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
          .badge-queue { background: #fff7ed; color: #b45309; border: 1px solid #fdba74; }
          .badge-sent  { background: #f0fdf4; color: #15803d; border: 1px solid #86efac; }
          .badge-fail  { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }

          /* Screenshot */
          .screenshot-thumb { width: 45px; height: 45px; object-fit: cover; border-radius: 6px; border: 1px solid #eee; cursor: pointer; transition: transform 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .screenshot-thumb:hover { transform: scale(1.1); }

          /* ─── MOBILE CARD VIEW (Responsive) ──────────────────────────────────── */
          @media (max-width: 768px) {
            body { padding: 10px; background: #eef2f6; }
            .container { padding: 0; }
            h1 { font-size: 1.25rem; margin-bottom: 10px; }
            
            /* Stack Toolbar */
            .toolbar { flex-direction: column; align-items: stretch; gap: 8px; }
            .selected-count { margin-left: 0; text-align: center; margin-top: 5px; font-size: 13px; }
            
            /* Hide Table Header */
            thead { display: none; }
            
            /* Convert Table to Grid of Cards */
            table, tbody, tr, td { display: block; width: 100%; }
            
            tr {
              background: #fff;
              border-radius: 12px;
              margin-bottom: 20px;
              padding: 15px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.06);
              border: 1px solid transparent;
              position: relative;
              overflow: hidden;
            }
            tr.selected { border-color: #facc15; background: #fff; box-shadow: 0 0 0 2px #facc15; }
            
            td {
              padding: 10px 0 10px 0;
              display: flex;
              justify-content: space-between;
              align-items: center;
              text-align: right;
              border-bottom: 1px solid #f3f4f6;
              min-height: auto;
              position: relative;
              padding-left: 35%; /* Space for label */
            }
            
            td:last-child { border-bottom: none; }

            /* Add labels via CSS pseudo-elements */
            td::before {
              content: attr(data-label);
              position: absolute;
              left: 0;
              width: 30%;
              padding-right: 10px;
              white-space: nowrap;
              font-weight: 600;
              color: #6b7280;
              text-align: left;
              font-size: 0.85rem;
              display: flex;
              align-items: center;
            }

            /* Mobile Specific Tweaks */
            td:nth-child(1) { /* Checkbox */
              position: absolute; top: 15px; right: 15px; width: auto; padding: 0; z-index: 10; background: transparent;
            }
            td:nth-child(1)::before { content: none; } /* No label for checkbox */
            
            td:nth-child(2) { /* ID */
              font-size: 0.8rem; color: #9ca3af; order: -2; padding-top: 0; margin-bottom: -10px;
            }
            td:nth-child(2)::before { content: "Order #"; font-weight: 400; }

            td:nth-child(3) { /* Client */
              order: -3; 
              padding-top: 0;
              border-bottom: none;
            }
            td:nth-child(3)::before { content: none; } /* Client name acts as header */
            td:nth-child(3) strong { display: block; font-size: 1.1rem; color: #111; }
            td:nth-child(3) small { font-size: 0.85rem; color: #6b7280; display: block; margin-top: 2px; }

            /* Screenshot & Status on Mobile */
            td:nth-child(5) { justify-content: flex-end; } /* Payment */
            
            select.status-select { width: auto; min-width: 140px; font-size: 14px; }
            
            /* Action Button */
            .btn-delete-single {
              width: 100%; margin-top: 5px; background: #fff; border: 1px solid #fee2e2; color: #dc2626;
              padding: 12px; border-radius: 8px; text-align: center;
            }
            .btn-delete-single:active { background: #fee2e2; }
          }

          /* ─── MODALS & TOASTS ────────────────────────────────────────────────── */
          #toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #1f2937; color: #fff; padding: 12px 24px; border-radius: 30px; display: none; z-index: 2000; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); font-size: 14px; text-align: center; min-width: 200px;}
          
          #imgModal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 3000; display: none; align-items: center; justify-content: center; backdrop-filter: blur(5px); }
          #imgModal img { max-width: 95%; max-height: 95%; border-radius: 8px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3); }
          .close-img { position: absolute; top: 20px; right: 20px; color: white; cursor: pointer; font-size: 40px; background: rgba(255,255,255,0.2); width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; user-select: none; }

          /* ─── UTILS ──────────────────────────────────────────────────────────── */
          .no-proof { color: #ccc; font-size: 12px; font-style: italic; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📦 NaturaBotanica <span style="font-size:0.6em; opacity:0.6; font-weight:normal; margin-top:5px;">v10 Mobile</span></h1>

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
                    <td data-label="Email Status" id="email-status-cell-${row.id}">${emailBadge}</td>
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

        <div id="toast"></div>
        <div id="imgModal" onclick="this.style.display='none'">
          <span class="close-img">&times;</span>
          <img id="fullImage" src="" alt="Full Payment Proof" onclick="event.stopPropagation()">
        </div>

        <script>
          function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg; t.style.display = 'block';
            setTimeout(() => { t.style.display = 'none'; }, 3000);
          }
          function openImage(src) {
            document.getElementById('fullImage').src = src;
            document.getElementById('imgModal').style.display = 'flex';
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
            const cell = document.getElementById('email-status-cell-' + id);
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
            try {
              const response = await fetch('/update-status', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: newStatus })
              });
              const data = await response.json();
              
              selectEl.className = 'status-select status-' + newStatus;
              
              if (data.emailStatus) {
                  setBadge(id, data.emailStatus);
              } else {
                  setBadge(id, 'Queue');
              }

              if (data.emailStatus === 'Failed') {
                  showToast('❌ Status updated but Email failed');
              } else if (data.emailStatus === 'Sent') {
                  showToast('✅ Status updated & Email Sent');
              } else {
                  showToast('✅ Status updated');
              }

            } catch (err) {
              showToast('❌ Network error');
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
                document.getElementById('row-' + id).remove();
                showToast('🗑️ Order #' + id + ' deleted');
                onCheckboxChange();
              } else {
                showToast('❌ Delete failed');
                btn.disabled = false; btn.textContent = '🗑️ Delete';
              }
            } catch (err) {
              showToast('❌ Network error');
              btn.disabled = false; btn.textContent = '🗑️ Delete';
            }
          }

          async function deleteSelected() {
            const ids = getCheckedIds();
            if (ids.length === 0 || !confirm('Delete ' + ids.length + ' order(s)?')) return;
            const btn = document.getElementById('btn-delete-selected');
            btn.disabled = true; btn.textContent = '⏳ Deleting...';
            try {
              const res = await fetch('/delete-orders', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
              });
              const data = await res.json();
              if (data.success) {
                data.deleted.forEach(id => document.getElementById('row-' + id)?.remove());
                showToast('🗑️ Deleted ' + data.deleted.length + ' order(s)');
                onCheckboxChange();
              } else {
                showToast('❌ Delete failed');
              }
            } catch (err) {
              showToast('❌ Network error');
            } finally {
              btn.textContent = '🗑️ Delete Selected';
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

app.get('/', (req, res) => res.send('🌿 NaturaBotanica Node.js Backend Running v10 (Mobile Secure Mode)'));
app.listen(port, () => console.log(`🚀 Node Server running on port ${port}`));
