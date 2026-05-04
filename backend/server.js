const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow large screenshots

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// Schemas
const productSchema = new mongoose.Schema({
  id: Number, name: String, sci: String, category: String, catLabel: String,
  price: Number, unit: String, moq: String, lead: String, img: String, desc: String
});

const orderSchema = new mongoose.Schema({
  items: Array, totalUSD: Number, totalNPR: Number, paidAmount: Number, currency: String,
  paymentMethod: String, paymentScreenshot: String, 
  clientDetails: { name: String, phone: String, email: String, address: String },
  timestamp: { type: Date, default: Date.now }, status: { type: String, default: 'Pending' }
});

const inquirySchema = new mongoose.Schema({
  firstName: String, lastName: String, email: String, company: String, message: String,
  timestamp: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Inquiry = mongoose.model('Inquiry', inquirySchema);

// Routes
app.get('/api/products', async (req, res) => {
  try { const products = await Product.find().sort({ id: 1 }); res.json(products); } 
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders', async (req, res) => {
  try { const newOrder = new Order(req.body); await newOrder.save(); res.status(201).json({ message: 'Order placed' }); } 
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/inquiries', async (req, res) => {
  try { const newInquiry = new Inquiry(req.body); await newInquiry.save(); res.status(201).json({ message: 'Inquiry sent' }); } 
  catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
