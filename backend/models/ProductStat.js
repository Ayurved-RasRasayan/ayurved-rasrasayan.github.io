const mongoose = require('mongoose');

const productStatSchema = new mongoose.Schema({
    productId: { type: String, required: true, unique: true },
    unitsSold: { type: Number, default: 0 }
});

module.exports = mongoose.model('ProductStat', productStatSchema);
