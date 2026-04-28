const express = require('express');
const cors = require('cors');
const app = express();

// 1. Middlewares
app.use(cors()); 
app.use(express.json());

// 2. Health Check Route (optional, keeps Render awake)
app.get('/', (req, res) => {
  res.send('Ayurveda Backend is Running!');
});

// 3. THE FIX: Changed '/api/payment' to '/order' to match frontend
app.post('/order', (req, res) => {
  console.log("=== NEW ORDER RECEIVED ===");
  console.log("Items:", req.body.items);
  console.log("Total Amount:", req.body.total);
  console.log("Payment Method:", req.body.paymentMethod);
  console.log("Timestamp:", req.body.timestamp);

  // TODO: Add logic here to email yourself the order details
  // Example: sendEmail(req.body.items, req.body.total);

  res.json({ status: "Success", message: "Order received successfully" });
});

// 4. Start Server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
