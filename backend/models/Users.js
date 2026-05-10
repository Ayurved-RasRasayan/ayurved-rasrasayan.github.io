const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  name: { type: String, required: true }, username: { type: String, required: true, unique: true }, email: { type: String, required: true, unique: true }, password: { type: String, required: true }, isVerified: { type: Boolean, default: false }, verificationCode: String, verificationExpires: Date, cart: { type: Array, default: [] }
});
module.exports = mongoose.model('User', userSchema);