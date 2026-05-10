const mongoose = require('mongoose');
const visitorSchema = new mongoose.Schema({ ip: { type: String, unique: true, index: true }, lastVisited: { type: Date, default: Date.now } });
module.exports = mongoose.model('Visitor', visitorSchema);