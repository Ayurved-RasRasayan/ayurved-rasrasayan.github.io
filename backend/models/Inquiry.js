const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  firstName: String, lastName: String, email: String, company: String, message: String, timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Inquiry', inquirySchema);

