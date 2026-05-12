const express = require('express');
const path = require('path');
const http = require('http'); // ADDED for Socket.io
const cors = require('cors');
const mongoose = require('mongoose');
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
// SOCKET.IO SETUP
// ==========================================
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: "*", // Allow your frontend and admin dashboard to connect
    methods: ["GET", "POST"]
  }
});

// Socket.io Live Chat Logic
io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);

  // Listen for a client or admin joining a specific chat session
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`Socket ${socket.id} joined room ${sessionId}`);
  });

  // Listen for messages from the client
  socket.on('client-message', (data) => {
    // Broadcast this message to the Admin Dashboard
    io.emit('admin-notification', { sessionId: data.sessionId, text: data.text });
  });

  // Listen for messages from the admin
  socket.on('admin-message', (data) => {
    // Send this message ONLY to the specific client session
    io.to(data.sessionId).emit('admin-msg', data.text);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

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
app.use('/api/trending', require('./routes/trendingRoutes')); 
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
    // ==========================================
    try {
      await mongoose.connection.collections.users.dropIndex('username_1');
      console.log('✅ Old username index dropped successfully');
    } catch (err) {
      if (err.code === 27 || err.message.includes('index not found')) {
        console.log('ℹ️ Username index already removed (no action needed)');
      } else {
        console.log('ℹ️ Could not drop username index:', err.message);
      }
    }

    // ==========================================
    // START SERVER (Changed from app.listen to server.listen)
    // ==========================================
    server.listen(port, () => console.log(`🚀 Secure Server running on port ${port} (HTTP + Socket.io)`));

  } catch (error) {
    console.error('❌ STARTUP FAILED:', error);
    process.exit(1);
  }
};

startup();
