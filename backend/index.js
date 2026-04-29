const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test Database Connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client', err.stack);
  }
  console.log('✅ Connected to PostgreSQL Database');
  release();
});

// 1. Create Table if it doesn't exist
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    items JSONB,
    total_usd DECIMAL,
    total_npr DECIMAL,
    paid_amount DECIMAL,
    currency VARCHAR,
    payment_method VARCHAR,
    client_name VARCHAR,
    client_phone VARCHAR,
    client_email VARCHAR,
    timestamp TIMESTAMP
  );
`;

pool.query(createTableQuery, (err, res) => {
  if (err) console.error("❌ Error creating table", err);
  else console.log("📊 Table 'orders' structure verified.");
});

// 2. FIX: Add 'status' column if it is missing (CRITICAL FOR OLD TABLES)
const alterTableQuery = `ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'Pending';`;
pool.query(alterTableQuery, (err, res) => {
    if (err) {
        // If error is something other than "already exists", log it
        console.error("❌ Error updating table schema:", err);
    } else {
        console.log("🔧 Database updated: 'status' column is now available.");
    }
});

// --- ROUTE 1: Receive Order ---
app.post('/order', async (req, res) => {
  try {
    const { items, totalUSD, totalNPR, paidAmount, currency, paymentMethod, clientDetails, timestamp } = req.body;
    const query = `INSERT INTO orders (items, total_usd, total_npr, paid_amount, currency, payment_method, client_name, client_phone, client_email, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id;`;
    const values = [JSON.stringify(items), totalUSD, totalNPR, paidAmount, currency, paymentMethod, clientDetails.name, clientDetails.phone, clientDetails.email, timestamp];
    const result = await pool.query(query, values);
    console.log(`📝 New Order #${result.rows[0].id} from ${clientDetails.name}`);
    res.status(200).json({ success: true, orderId: result.rows[0].id });
  } catch (error) {
    console.error('❌ Error saving order:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// --- ROUTE 2: Update Order Status ---
app.put('/update-status', async (req, res) => {
  try {
    const { id, status } = req.body;
    // This query will now work because the column exists
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error updating status:', error);
    res.status(500).json({ success: false });
  }
});

// --- ROUTE 3: View Orders (Interactive Dashboard) ---
app.get('/view-orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY id DESC');
    
    const styles = `
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; background: #f3f4f6; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; }
        h1 { color: #1f2937; }
        
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        th { background: #1f2937; color: white; padding: 15px; text-align: left; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 15px; border-bottom: 1px solid #e5e7eb; color: #374151; vertical-align: middle; }
        tr:last-child td { border-bottom: none; }
        
        /* Dropdown Styling */
        select.status-select {
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px solid #d1d5db;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          outline: none;
          transition: all 0.2s;
          width: 140px;
        }
        select.status-select:focus { border-color: #A3B14B; box-shadow: 0 0 0 2px rgba(163, 177, 75, 0.2); }
        
        /* Status Colors */
        .status-Pending { background-color: #fff7ed; color: #b45309; border-color: #fcd34d; }
        .status-Shipping { background-color: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
        .status-Completed { background-color: #f0fdf4; color: #15803d; border-color: #86efac; }
        .status-Rejected { background-color: #fee2e2; color: #991b1b; border-color: #fca5a5; }
        .status-Success { background-color: #dcfce7; color: #15803d; border-color: #86efac; }
        
        .price { font-weight: bold; font-family: monospace; }
        .client-email { color: #6b7280; font-size: 13px; }
      </style>
    `;

    let html = `
      <html>
        <head><title>Order Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">${styles}</head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📦 NaturaBotanica Orders</h1>
              <p>Manage sales, shipping, and fulfillment</p>
            </div>
            <table>
              <tr>
                <th>ID</th>
                <th>Date</th>
                <th>Client Info</th>
                <th>Total Amount</th>
                <th>Status</th>
              </tr>
    `;

    if (result.rows.length === 0) {
      html += `<tr><td colspan="5" style="text-align:center; padding: 40px; color: #9ca3af;">No orders found.</td></tr>`;
    } else {
      result.rows.forEach(row => {
        let itemsCount = 0;
        try { if(row.items) itemsCount = JSON.parse(row.items).length; } 
        catch(e) { /* ignore */ }

        // Handle potential null status by defaulting to Pending
        let currentStatus = row.status || 'Pending';
        let currentStatusClass = `status-${currentStatus}`;

        html += `
          <tr>
            <td><strong>#${row.id}</strong></td>
            <td>
              <div>${new Date(row.timestamp).toLocaleDateString()}</div>
              <small style="color:#9ca3af">${new Date(row.timestamp).toLocaleTimeString()}</small>
            </td>
            <td>
              <div style="font-weight:600">${row.client_name || 'Guest'}</div>
              <div class="client-email">${row.client_phone || ''}</div>
              <div class="client-email">${row.client_email || ''}</div>
            </td>
            <td>
              <div class="price">$${row.total_usd}</div>
              <small style="color:#6b7280">${row.total_npr} NPR</small>
            </td>
            <td>
              <!-- INTERACTIVE DROPDOWN -->
              <select onchange="updateStatus(${row.id}, this.value)" class="status-select ${currentStatusClass}">
                <option value="Pending" ${currentStatus === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                <option value="Shipping" ${currentStatus === 'Shipping' ? 'selected' : ''}>🚚 Shipping</option>
                <option value="Completed" ${currentStatus === 'Completed' ? 'selected' : ''}>✅ Completed</option>
                <option value="Success" ${currentStatus === 'Success' ? 'selected' : ''}>Success</option>
                <option value="Rejected" ${currentStatus === 'Rejected' ? 'selected' : ''}>🚫 Rejected</option>
              </select>
            </td>
          </tr>
        `;
      });
    }

    html += `
            </table>
          </div>

          <script>
            async function updateStatus(id, newStatus) {
              const selectElement = event.target;
              
              try {
                const response = await fetch('/update-status', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: id, status: newStatus })
                });
                
                const data = await response.json();
                if(data.success) {
                  selectElement.className = 'status-select status-' + newStatus;
                  console.log('Order #' + id + ' updated to ' + newStatus);
                } else {
                  alert('Server rejected update (Check logs)');
                }
              } catch (error) {
                console.error(error);
                alert('Error connecting to server');
              }
            }
          </script>
        </body>
      </html>
    `;
    res.send(html);

  } catch (err) {
    console.error('Full Error:', err);
    res.status(500).send(`<div style="color:red; padding:20px;"><h3>Error retrieving orders</h3><p>${err.message}</p></div>`);
  }
});

// Root Endpoint
app.get('/', (req, res) => {
  res.send('NaturaBotanica Backend is Running ✅');
});

// Start Server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
