const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ─── EMAIL TRANSPORTER SETUP ─────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: (process.env.EMAIL_PORT || 587) == 465, 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.verify(function (error, success) {
  if (error) {
    console.log("⚠️ Email Server Connection Failed:", error.message);
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
    // Attempt to migrate existing tables from 'email_sent' (boolean) to 'email_status' (string)
    console.log("🔄 Checking for database migrations...");
    pool.query(`ALTER TABLE orders RENAME COLUMN email_sent TO email_status;`, (err) => {
      if(err && err.message.includes('column "email_sent" does not exist')) {
         // Column already renamed or never existed, ignore
      }
    });
    pool.query(`ALTER TABLE orders ALTER COLUMN email_status TYPE VARCHAR USING email_status::TEXT;`, (err) => {
        if(err) console.log("ℹ️ Migration check completed.");
    });
  }
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
      'Queue',                // Default to 'Queue'
      timestamp
    ];

    const result = await pool.query(query, values);
    res.status(200).json({ success: true, orderId: result.rows[0].id });
  } catch (error) {
    console.error('❌ Error saving order:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 2: Update Status & Send Email (Updated for Fail/Queue/Sent) ───────
app.put('/update-status', async (req, res) => {
  try {
    const { id, status } = req.body;
    console.log(`\n[DEBUG] Updating Order #${id} to '${status}'...`);

    // 1. Set Order Status & Reset Email to 'Queue'
    await pool.query(`UPDATE orders SET status = $1, email_status = 'Queue' WHERE id = $2`, [status, id]);
    
    // 2. Fetch Client Details
    const orderResult = await pool.query('SELECT client_name, client_email FROM orders WHERE id = $1', [id]);
    if (orderResult.rows.length === 0) return res.status(404).json({ success: false });
    
    const { client_name, client_email } = orderResult.rows[0];

    let emailStatusResult = 'Queue'; // Default result if we don't send

    // 3. Send Email
    if (client_email && client_email.includes('@')) {
      const mailOptions = {
        from: process.env.EMAIL_USER, 
        to: client_email,             
        subject: `Order Status Update: #${id}`,
        html: `<h3>Hello ${client_name},</h3><p>Your order #${id} status is now: <strong>${status}</strong>.</p>`
      };

      try {
        await transporter.sendMail(mailOptions);
        // 4. Mark as Sent
        await pool.query(`UPDATE orders SET email_status = 'Sent' WHERE id = $1`, [id]);
        emailStatusResult = 'Sent';
        console.log(`✅ Email sent successfully for #${id}`);
      } catch (emailError) {
        // 5. Mark as Failed
        await pool.query(`UPDATE orders SET email_status = 'Failed' WHERE id = $1`, [id]);
        emailStatusResult = 'Failed';
        console.error(`❌ Email failed for #${id}. Status set to Failed.`);
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

// ─── ROUTE 5: Admin Order Dashboard ──────────────────────────────────────────
app.get('/view-orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY id DESC');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>NaturaBotanica — Orders v4</title>
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
          .status-Success   { background: #dcfce7; color: #15803d; } /* Renamed Payment Successful */
          .status-Rejected  { background: #fee2e2; color: #991b1b; }
          
          /* BADGES */
          .badge-queue { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; color: #b45309; background: #fff7ed; border: 1px solid #fdba74; }
          .badge-sent  { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; color: #15803d; background: #f0fdf4; border: 1px solid #86efac; }
          .badge-fail  { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; color: #dc2626; background: #fee2e2; border: 1px solid #fca5a5; }

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
                  
                  // Mapping logic for badges
                  let emailBadge = `<span class="badge-queue">⏳ Queue</span>`;
                  if (row.email_status === 'Sent') {
                    emailBadge = `<span class="badge-sent">✅ Sent</span>`;
                  } else if (row.email_status === 'Failed') {
                    emailBadge = `<span class="badge-fail">❌ Failed</span>`;
                  }

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
                        <!-- RENAMED HERE -->
                        <option value="Success"   ${status === 'Success'   ? 'selected' : ''}>Payment Successful</option>
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

          // Helper to set badge HTML
          function setBadge(id, status) {
            const cell = document.getElementById('email-status-cell-' + id);
            if (!cell) return;
            if (status === 'Sent') {
                cell.innerHTML = '<span class="badge-sent">✅ Sent</span>';
            } else if (status === 'Failed') {
                cell.innerHTML = '<span class="badge-fail">❌ Failed</span>';
            } else {
                cell.innerHTML = '<span class="badge-queue">⏳ Queue</span>';
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
              
              // Update Dropdown Style
              selectEl.className = 'status-select status-' + newStatus;
              
              // Update Badge based on actual server response
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

app.get('/', (req, res) => res.send('🌿 NaturaBotanica Node.js Backend Running v4'));
app.listen(port, () => console.log(`🚀 Node Server running on port ${port}`));
