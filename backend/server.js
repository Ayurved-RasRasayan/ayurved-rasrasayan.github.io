const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ─── EMAIL TRANSPORTER SETUP (UPDATED FOR CLOUD COMPATIBILITY) ────────────────
// We now use dynamic Host/Port settings to support Gmail, Brevo, or SendGrid.
// Default to Gmail settings if ENV vars aren't set.
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: (process.env.EMAIL_PORT || 587) == 465, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Test the connection immediately on startup
transporter.verify(function (error, success) {
  if (error) {
    console.log("⚠️ Email Server Connection Failed (This is expected if you haven't updated .env yet):", error);
  } else {
    console.log("✅ Email Server is ready to send messages");
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
    email_sent          BOOLEAN DEFAULT FALSE,
    timestamp           TIMESTAMP
  );
`;

pool.query(createTableQuery, (err) => {
  if (err) console.error('❌ Error creating table:', err);
  else console.log("📊 Table 'orders' is ready");
});
// ─── ROUTE 1: Receive New Order ───────────────────────────────────────────────
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
         status, email_sent, timestamp)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id;
    `;

    const values = [
      JSON.stringify(items), totalUSD, totalNPR, paidAmount,
      currency, paymentMethod,
      clientDetails.name, clientDetails.phone, clientDetails.email,
      paymentScreenshot, 
      'Pending',             
      false,                 
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

// ─── ROUTE 2: Update Status & Send Email (EXTREME DEBUG LOGGING) ─────────────
app.put('/update-status', async (req, res) => {
  try {
    const { id, status } = req.body;
    console.log(`\n[DEBUG 1] --- STARTING EMAIL PROCESS FOR ORDER #${id} ---`);

    // 1. Update Status immediately
    console.log(`[DEBUG 2] Updating database status to '${status}'...`);
    await pool.query(`UPDATE orders SET status = $1, email_sent = FALSE WHERE id = $2`, [status, id]);
    console.log(`[DEBUG 3] Database status updated.`);

    // 2. Fetch Client Details
    console.log(`[DEBUG 4] Fetching client details for Order #${id}...`);
    const orderResult = await pool.query('SELECT client_name, client_email FROM orders WHERE id = $1', [id]);
    
    if (orderResult.rows.length === 0) {
      console.log(`[DEBUG 5] ❌ Order #${id} NOT FOUND in DB.`);
      return res.status(404).json({ success: false });
    }
    
    const { client_name, client_email } = orderResult.rows[0];
    console.log(`[DEBUG 6] Client found: Name="${client_name}", Email="${client_email}"`);

    // 3. Send Email
    if (client_email && client_email.includes('@')) {
      
      // Check Credentials
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log(`[DEBUG 7] ❌ CRITICAL: EMAIL_USER or EMAIL_PASS is missing in .env file!`);
      } else {
        console.log(`[DEBUG 8] ✅ Credentials loaded.`);
      }

      console.log(`[DEBUG 9] Preparing email to ${client_email}...`);

      const mailOptions = {
        from: process.env.EMAIL_USER, 
        to: client_email,             
        subject: `Order Status Update: #${id}`,
        html: `
          <h3>Hello ${client_name},</h3>
          <p>Your order <strong>#${id}</strong> status has been updated.</p>
          <h2 style="color: #2d4a22;">${status}</h2>
          <p>Thank you for shopping with NaturaBotanica.</p>
        `
      };

      try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`[DEBUG 10] ✅ EMAIL SENT SUCCESSFULLY! Message ID: ${info.messageId}`);
        
        // 4. Mark as Sent in DB
        await pool.query(`UPDATE orders SET email_sent = TRUE WHERE id = $1`, [id]);
        console.log(`[DEBUG 11] Database updated (email_sent = TRUE).`);
        
      } catch (emailError) {
        console.error(`[DEBUG 10] ❌ EMAIL FAILED TO SEND.`);
        console.error(`[ERROR DETAILS]:`, emailError.message);
      }

    } else {
      console.log(`[DEBUG 7] ⚠️ SKIPPED: No valid email address found.`);
    }

    res.json({ success: true, message: `Status updated to ${status}.` });

  } catch (error) {
    console.error(`[FATAL ERROR] Server crashed while updating status:`, error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 3: Delete Single Order ────────────────────────────────────────────
app.delete('/delete-order/:id', async (req, res) => {
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

// ─── ROUTE 4: Delete Multiple Orders ─────────────────────────────────────────
app.delete('/delete-orders', async (req, res) => {
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

// ─── ROUTE 5: Admin Order Dashboard (v3) ─────────────────────────────────────
app.get('/view-orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY id DESC');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>NaturaBotanica — Orders v3</title> <!-- Changed title to v3 -->
        <style>
          * { box-sizing: border-box; }
          body { font-family: sans-serif; background: #f3f4f6; padding: 24px; margin: 0; }
          .container { max-width: 1200px; margin: 0 auto; }
          h1 { color: #2d4a22; }
          .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
          .btn { padding: 8px 16px; border-radius: 4px; border: none; font-weight: bold; cursor: pointer; font-size: 14px; transition: opacity 0.2s; }
          .btn:disabled { opacity: 0.4; cursor: not-allowed; }
          .btn-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
          .btn-danger:hover:not(:disabled) { background: #fca5a5; }
          .btn-secondary { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
          .btn-secondary:hover:not(:disabled) { background: #e5e7eb; }
          .selected-count { color: #6b7280; font-size: 14px; }
          
          .table-wrap { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #eee; }
          th { background: #2d4a22; color: white; }
          tr.selected { background: #fef9c3; }
          
          input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
          
          select.status-select { padding: 6px; border-radius: 4px; border: 1px solid #ccc; font-weight: bold; cursor: pointer; }
          .status-Pending   { background: #fff7ed; color: #b45309; }
          .status-Shipping  { background: #eff6ff; color: #1e40af; }
          .status-Completed { background: #f0fdf4; color: #15803d; }
          .status-Success   { background: #dcfce7; color: #15803d; }
          .status-Rejected  { background: #fee2e2; color: #991b1b; }
          
          /* BADGES */
          .badge-queue { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; color: #b45309; background: #fff7ed; border: 1px solid #fdba74; }
          .badge-sent  { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; color: #15803d; background: #f0fdf4; border: 1px solid #86efac; }

          .screenshot-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; border: 1px solid #eee; cursor: pointer; transition: transform 0.2s; }
          .screenshot-thumb:hover { transform: scale(2); z-index: 10; }
          
          #toast { position: fixed; bottom: 20px; right: 20px; background: #333; color: #fff; padding: 12px 24px; border-radius: 4px; display: none; z-index: 999; }
          #imgModal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; display: none; align-items: center; justify-content: center; }
          #imgModal img { max-width: 90%; max-height: 90%; border-radius: 8px; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
          .close-img { position: absolute; top: 20px; right: 20px; color: white; cursor: pointer; font-size: 40px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📦 NaturaBotanica Orders</h1>

          <div class="toolbar">
            <button class="btn btn-secondary" onclick="toggleSelectAll()">☑️ Select All</button>
            <button class="btn btn-danger" id="btn-delete-selected" disabled onclick="deleteSelected()">🗑️ Delete Selected</button>
            <span class="selected-count" id="selected-count"></span>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" id="chk-all" onchange="toggleSelectAll()"/></th>
                  <th>ID</th>
                  <th>Client</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>EMAIL STATUS</th>
                  <th>Order Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="orders-tbody">
                ${result.rows.map(row => {
                  const status = row.status || 'Pending';
                  const emailBadge = row.email_sent 
                    ? `<span class="badge-sent">✅ Sent</span>` 
                    : `<span class="badge-queue">⏳ Queue</span>`;

                  return `
                  <tr id="row-${row.id}">
                    <td><input type="checkbox" class="row-chk" value="${row.id}" onchange="onCheckboxChange()"/></td>
                    <td>#${row.id}</td>
                    <td>
                      <strong>${row.client_name || 'Guest'}</strong><br>
                      <small>${row.client_email || ''}</small>
                    </td>
                    <td>$${row.total_usd}</td>
                    <td>
                      ${row.payment_screenshot ? 
                        `<img src="${row.payment_screenshot}" class="screenshot-thumb" onclick="openImage('${row.payment_screenshot}')" alt="Screenshot">` : 
                        '<span style="color:#ccc; font-size:12px;">No Proof</span>'}
                    </td>
                    <td id="email-status-cell-${row.id}">${emailBadge}</td>
                    <td>
                      <select onchange="updateStatus(${row.id}, this.value, this)" class="status-select status-${status}">
                        <option value="Pending"   ${status === 'Pending'   ? 'selected' : ''}>Pending</option>
                        <option value="Shipping"  ${status === 'Shipping'  ? 'selected' : ''}>Shipping</option>
                        <option value="Completed" ${status === 'Completed' ? 'selected' : ''}>Completed</option>
                        <option value="Success"   ${status === 'Success'   ? 'selected' : ''}>Success</option>
                        <option value="Rejected"  ${status === 'Rejected'  ? 'selected' : ''}>Rejected</option>
                      </select>
                    </td>
                    <td><button class="btn-delete-single" onclick="deleteSingle(${row.id}, this)">🗑️ Delete</button></td>
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

          async function updateStatus(id, newStatus, selectEl) {
            selectEl.disabled = true;
            try {
              const response = await fetch('/update-status', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: newStatus })
              });
              const data = await response.json();
              if (data.success) {
                selectEl.className = 'status-select status-' + newStatus;
                const emailCell = document.getElementById('email-status-cell-' + id);
                if (emailCell) {
                  emailCell.innerHTML = '<span class="badge-sent">✅ Sent</span>';
                }
                showToast('✅ Status updated & Email Sent');
              } else {
                showToast('❌ Update failed');
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

app.get('/', (req, res) => res.send('🌿 NaturaBotanica Node.js Backend Running v3'));
app.listen(port, () => console.log(`🚀 Node Server running on port ${port}`));
