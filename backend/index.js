const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors()); // This allows your HTML frontend to talk to this backend

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
  console.log('Connected to PostgreSQL Database');
  release();
});

// Create Table if it doesn't exist
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    total_usd DECIMAL,
    total_npr DECIMAL,
    paid_amount DECIMAL,
    currency VARCHAR,
    payment_method VARCHAR,
    client_name VARCHAR,
    client_phone VARCHAR,
    client_email VARCHAR,
    items JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
  );
`;

pool.query(createTableQuery, (err, res) => {
  if (err) console.error("Error creating table", err);
  else console.log("Table 'orders' is ready");
});

// API Endpoint to Receive Order
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
      JSON.stringify(items), // Store cart as JSON
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
    
    console.log(`Order #${result.rows[0].id} received from ${clientDetails.name}`);
    
    res.status(200).json({ 
      success: true, 
      orderId: result.rows[0].id,
      message: 'Order saved successfully' 
    });

  } catch (error) {
    console.error('Error saving order:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Root Endpoint
app.get('/', (req, res) => {
  res.send('NaturaBotanica Backend is Running');
});

// Start Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
