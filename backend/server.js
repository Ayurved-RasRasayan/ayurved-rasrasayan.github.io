const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const connectDB = require('./config/db');
const { syncFileToDB, startFileWatcher, syncExchangeRate } = require('./services/syncService');

const requiredEnvVars = ['MONGO_URI', 'EMAIL_PASS', 'ADMIN_USER', 'ADMIN_PASSWORD', 'RECEIVER_EMAIL'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`❌ FATAL: Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 5000;

connectDB();

app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Serve public frontend files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/inquiries', require('./routes/inquiryRoutes'));
app.use('/api', require('./routes/settingRoutes'));
app.use('/api', require('./routes/viewRoutes'));

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error('Unhandled error:', err); res.status(500).json({ error: 'Internal server error' }); });

const startup = async () => {
  console.log('[STARTUP] 🔄 Syncing products...');
  await syncFileToDB({ removeOrphans: true });
  startFileWatcher();
  await syncExchangeRate();
  setInterval(syncExchangeRate, 6 * 60 * 60 * 1000);

  app.listen(port, () => console.log(`🚀 Secure Server running on port ${port}`));
};

startup();
