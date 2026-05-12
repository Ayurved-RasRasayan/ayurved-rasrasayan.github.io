const express = require('express');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose'); // Added for index cleanup
require('dotenv').config();
const connectDB = require('./config/db');
const { syncFileToDB, startFileWatcher, syncExchangeRate } = require('./services/syncService');

// ==========================================
// ENVIRONMENT VARIABLE VALIDATION
// ==========================================
const requiredEnvVars = ['MONGO_URI', 'EMAIL_PASS', 'ADMIN_USER', 'ADMIN_PASSWORD', 'RECEIVER_EMAIL'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`❌ FATAL: Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 5000;

// ==========================================
// DATABASE CONNECTION
// ==========================================
connectDB();

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ==========================================
// STATIC FILES (Frontend)
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// API ROUTES
// ==========================================
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/inquiries', require('./routes/inquiryRoutes'));
app.use('/api/trending', require('./routes/trendingRoutes')); // ✅ ADDED TRENDING ROUTE
app.use('/api', require('./routes/settingRoutes'));
app.use('/api', require('./routes/viewRoutes'));
app.use('/api/chat', require('./routes/chatRoutes'));
// ==========================================
// ERROR HANDLING
// ==========================================
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { 
  console.error('Unhandled error:', err); 
  res.status(500).json({ error: 'Internal server error' }); 
});

// ==========================================
// STARTUP SEQUENCE
// ==========================================
const startup = async () => {
  try {
    console.log('[STARTUP] 🔄 Syncing products...');
    await syncFileToDB({ removeOrphans: true });
    
    startFileWatcher();
    
    console.log('[STARTUP] 🔄 Syncing exchange rate...');
    await syncExchangeRate();
    setInterval(syncExchangeRate, 6 * 60 * 60 * 1000); // Sync every 6 hours

    // ==========================================
    // ONE-TIME CLEANUP: Drop old username index
    // We removed 'username' from the User schema, but MongoDB 
    // still has the unique index which will block new signups.
    // This safely removes it. You can delete this block after 
    // the first successful run.
    // ==========================================
    try {
      await mongoose.connection.collections.users.dropIndex('username_1');
      console.log('✅ Old username index dropped successfully');
    } catch (err) {
      // Error code 27 = index not found (already removed)
      if (err.code === 27 || err.message.includes('index not found')) {
        console.log('ℹ️ Username index already removed (no action needed)');
      } else {
        console.log('ℹ️ Could not drop username index:', err.message);
      }
    }

    // ==========================================
    // START SERVER
    // ==========================================
    app.listen(port, () => console.log(`🚀 Secure Server running on port ${port}`));

  } catch (error) {
    console.error('❌ STARTUP FAILED:', error);
    process.exit(1);
  }
};

startup();
