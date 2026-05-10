const mongoose = require('mongoose');
const productSchema = new mongoose.Schema({
  id: Number, name: String, sci: String, category: String, catLabel: String, price: Number, unit: String, moq: String, lead: String, img: String, desc: String, stock: { type: Number, default: 100 }
});
module.exports = mongoose.model('Product', productSchema);