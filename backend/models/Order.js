const mongoose = require('mongoose');
const orderSchema = new mongoose.Schema({
  items: Array, totalUSD: Number, totalNPR: Number, paidAmount: Number, currency: String, paymentMethod: String, paymentScreenshot: String, clientDetails: { name: String, phone: String, email: String, address: String }, status: { type: String, default: 'Pending' }, order_state: { type: String, default: 'Pending' }, emailStatus: { type: String, default: 'Queue' }, timestamp: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Order', orderSchema);