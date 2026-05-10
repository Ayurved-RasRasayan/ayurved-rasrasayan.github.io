const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const connectDB = require('./config/db');
const { syncFileToDB, startFileWatcher, syncExchangeRate } = require('./services/syncService');

// Environment Variables Check
const requiredEnvVars = ['MONGO_URI', 'EMAIL_PASS', 'ADMIN_USER', 'ADMIN_PASSWORD', 'RECEIVER_EMAIL'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`❌ FATAL: Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 5000;

// Connect Database
connectDB();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ─── HYBRID STATIC SERVING ────────────────────────────────────────
// 1. Serve the images folder specifically from the parent directory
app.use('/images', express.static(path.join(__dirname, '..', 'images')));

// 2. Serve the index.html specifically from the parent directory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});
// ───────────────────────────────────────────────────────────────────

// API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/inquiries', require('./routes/inquiryRoutes'));
app.use('/api', require('./routes/settingRoutes'));
app.use('/api', require('./routes/viewRoutes'));

// Error Handling
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

// Startup Sequence
const startup = async () => {
  console.log('[STARTUP] 🔄 Syncing products...');
  await syncFileToDB({ removeOrphans: true });
  startFileWatcher();
  await syncExchangeRate();
  setInterval(syncExchangeRate, 6 * 60 * 60 * 1000);

  app.listen(port, () => console.log(`🚀 Secure Server running on port ${port}`));
};

startup();