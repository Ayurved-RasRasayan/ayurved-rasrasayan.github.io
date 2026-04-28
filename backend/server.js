const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors()); // IMPORTANT: Allows your GitHub Page to talk to this server
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Ayurveda Backend is Running!');
});

// This is where you will eventually add the payment verification logic
app.post('/api/payment', (req, res) => {
  console.log("Received payment info:", req.body);
  res.json({ status: "Received" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});