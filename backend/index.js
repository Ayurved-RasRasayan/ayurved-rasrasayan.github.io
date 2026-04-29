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
    rejectUnauthorized: false // Required for Render Postgres
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

// Create Table if it doesn't exist
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
  else console.log("📊 Table 'orders' is ready to accept data");
});

// --- ROUTE 1: Receive Order (Frontend -> Backend) ---
app.post('/order', async (req, res) => {
  try {
    const { 
      items, 
      totalUSD, 
      totalNPR, 
      paidAmount, 
      currency, 
      paymentMethod, 
      clientDetails,
      timestamp 
    } = req.body;

    // Insert into Database
    const query = `
      INSERT INTO orders (
        items, total_usd, total_npr, paid_amount, currency, 
        payment_method, client_name, client_phone, client_email, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id;
    `;

    const values = [
      JSON.stringify(items),
      totalUSD,
      totalNPR,
      paidAmount,
      currency,
      paymentMethod,
      clientDetails.name,
      clientDetails.phone,
      clientDetails.email,
      timestamp
    ];

    const result = await pool.query(query, values);
    
    console.log(`📝 New Order #${result.rows[0].id} from ${clientDetails.name}`);
    
    res.status(200).json({ 
      success: true, 
      orderId: result.rows[0].id,
      message: 'Order saved successfully' 
    });

  } catch (error) {
    console.error('❌ Error saving order:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// --- ROUTE 2: View Orders (Admin Dashboard) ---
app.get('/view-orders', async (req, res) => {
  try {
    // Fetch orders, newest first
    const result = await pool.query('SELECT * FROM orders ORDER BY id DESC');
    
    // Create an HTML Table to display orders
    let html = `
      <html>
        <head>
          <title>Order List</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: sans-serif; padding: 20px; background: #f4f4f4; }
            table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
            th, td { padding: 12px; border: 1px solid #ddd; text-align: left; }
            th { background-color: #333; color: white; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            .amount { color: green; font-weight: bold; }
            .header { text-align: center; margin-bottom: 20px; }
            .error { color: red; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>📦 NaturaBotanica Orders</h1>
            <p>Latest transactions from database</p>
          </div>
          <table>
            <tr>
              <th>ID</th>
              <th>Date</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Method</th>
              <th>Currency</th>
              <th>Amount</th>
              <th>Items Count</th>
            </tr>
    `;

    if (result.rows.length === 0) {
      html += `<tr><td colspan="9" style="text-align:center">No orders found yet.</td></tr>`;
    } else {
      result.rows.forEach(row => {
        // --- SAFE PARSING FIX ---
        // We check if items is valid JSON, if not, we show 0 instead of crashing
        let itemsCount = 0;
        try {
            if (row.items) {
                const parsedItems = JSON.parse(row.items);
                itemsCount = parsedItems ? parsedItems.length : 0;
            }
        } catch (e) {
            console.warn(`Skipping bad JSON in Order #${row.id}`);
        }

        html += `
          <tr>
            <td><strong>${row.id}</strong></td>
            <td>${new Date(row.timestamp).toLocaleString()}</td>
            <td>${row.client_name || '-'}</td>
            <td>${row.client_email || '-'}</td>
            <td>${row.client_phone || '-'}</td>
            <td>${row.payment_method || '-'}</td>
            <td>${row.currency || '-'}</td>
            <td class="amount">$${row.total_usd} (${row.total_npr})</td>
            <td>${itemsCount}</td>
          </tr>
        `;
      });
    }

    html += `</table></body></html>`;
    res.send(html);

  } catch (err) {
    // Log the full error object to console so we can debug later
    console.error('Full Error:', err);
    // Send detailed error to screen
    res.status(500).send(`<div class="error"><h3>Error retrieving orders</h3><p>${err.message}</p><pre>${JSON.stringify(err)}</pre></div>`);
  }
});

// Root Endpoint (Health Check)
app.get('/', (req, res) => {
  res.send('NaturaBotanica Backend is Running ✅');
});

// Start Server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
