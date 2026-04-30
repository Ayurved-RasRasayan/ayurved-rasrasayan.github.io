const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors());

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
    email_sent      BOOLEAN DEFAULT FALSE,
    timestamp       TIMESTAMP
  );
`;

pool.query(createTableQuery, (err) => {
  if (err) console.error('❌ Error creating table:', err);
  else console.log("📊 Table 'orders' is ready");
});

pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'Pending';`, (err) => {
  if (err) console.error('❌ Error updating status column:', err);
  else console.log("🔧 'status' column verified");
});

pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT FALSE;`, (err) => {
  if (err) console.error('❌ Error updating email_sent column:', err);
  else console.log("🔧 'email_sent' column verified");
});

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

// ─── ROUTE 2: Update Status ───────────────────────────────────────────────────
app.put('/update-status', async (req, res) => {
  try {
    const { id, status } = req.body;

    const query = `UPDATE orders SET status = $1, email_sent = FALSE WHERE id = $2`;
    await pool.query(query, [status, id]);

    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    const order = orderResult.rows[0];

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    console.log(`🔄 Order #${id} status updated to '${status}'. Email queued for Python.`);
    res.json({ success: true, message: `Status updated to ${status}.` });

  } catch (error) {
    console.error('❌ Error updating status:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 3: Delete Order ────────────────────────────────────────────────────
app.delete('/delete-order/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING id', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    console.log(`🗑️ Order #${id} deleted`);
    res.json({ success: true, message: `Order #${id} deleted` });
  } catch (error) {
    console.error('❌ Error deleting order:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ROUTE 4: Admin Order Dashboard ──────────────────────────────────────────
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
          body { font-family: sans-serif; background: #f3f4f6; padding: 24px; margin: 0; }
          .container { max-width: 1200px; margin: 0 auto; }
          h1 { color: #2d4a22; }
          .table-wrap { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #eee; }
          th { background: #2d4a22; color: white; }
          select.status-select {
            padding: 6px; border-radius: 4px; border: 1px solid #ccc;
            font-weight: bold; cursor: pointer;
          }
          .status-Pending   { background: #fff7ed; color: #b45309; }
          .status-Shipping  { background: #eff6ff; color: #1e40af; }
          .status-Completed { background: #f0fdf4; color: #15803d; }
          .status-Success   { background: #dcfce7; color: #15803d; }
          .status-Rejected  { background: #fee2e2; color: #991b1b; }
          .btn-delete {
            background: #fee2e2; color: #991b1b;
            border: 1px solid #fca5a5; border-radius: 4px;
            padding: 6px 12px; cursor: pointer; font-weight: bold;
            transition: background 0.2s;
          }
          .btn-delete:hover { background: #fca5a5; }
          .btn-delete:disabled { opacity: 0.5; cursor: not-allowed; }
          #toast {
            position: fixed; bottom: 20px; right: 20px;
            background: #333; color: #fff; padding: 12px 24px;
            border-radius: 4px; display: none; z-index: 999;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📦 NaturaBotanica Orders</h1>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Client</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Email Sent</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="orders-tbody">
                ${result.rows.map(row => {
                  const status = row.status || 'Pending';
                  return `
                  <tr id="row-${row.id}">
                    <td>#${row.id}</td>
                    <td>
                      <strong>${row.client_name || 'Guest'}</strong><br>
                      <small>${row.client_email || ''}</small>
                    </td>
                    <td>$${row.total_usd}</td>
                    <td>
                      <select
                        onchange="updateStatus(${row.id}, this.value, this)"
                        class="status-select status-${status}"
                      >
                        <option value="Pending"   ${status === 'Pending'   ? 'selected' : ''}>Pending</option>
                        <option value="Shipping"  ${status === 'Shipping'  ? 'selected' : ''}>Shipping</option>
                        <option value="Completed" ${status === 'Completed' ? 'selected' : ''}>Completed</option>
                        <option value="Success"   ${status === 'Success'   ? 'selected' : ''}>Success</option>
                        <option value="Rejected"  ${status === 'Rejected'  ? 'selected' : ''}>Rejected</option>
                      </select>
                    </td>
                    <td>${row.email_sent ? '✅ Yes' : '⏳ Queued'}</td>
                    <td>
                      <button
                        class="btn-delete"
                        onclick="deleteOrder(${row.id}, this)"
                      >🗑️ Delete</button>
                    </td>
                  </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div id="toast"></div>

        <script>
          function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.style.display = 'block';
            setTimeout(() => { t.style.display = 'none'; }, 3000);
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
                showToast('✅ Status updated — email queued');
              } else {
                showToast('❌ Update failed');
              }
            } catch (err) {
              showToast('❌ Network error');
            } finally {
              selectEl.disabled = false;
            }
          }

          async function deleteOrder(id, btn) {
            if (!confirm('Are you sure you want to delete order #' + id + '? This cannot be undone.')) return;
            btn.disabled = true;
            btn.textContent = '⏳ Deleting...';
            try {
              const response = await fetch('/delete-order/' + id, { method: 'DELETE' });
              const data = await response.json();
              if (data.success) {
                document.getElementById('row-' + id).remove();
                showToast('🗑️ Order #' + id + ' deleted');
              } else {
                showToast('❌ Delete failed');
                btn.disabled = false;
                btn.textContent = '🗑️ Delete';
              }
            } catch (err) {
              showToast('❌ Network error');
              btn.disabled = false;
              btn.textContent = '🗑️ Delete';
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

app.get('/', (req, res) => res.send('🌿 NaturaBotanica Node.js Backend Running'));
app.listen(port, () => console.log(`🚀 Node Server running on port ${port}`));
