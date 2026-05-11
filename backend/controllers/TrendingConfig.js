const mongoose = require('mongoose');

const trendingConfigSchema = new mongoose.Schema({
  type: { type: String, default: 'trending', unique: true },
  picks: [{ type: String }] // Array of exactly 2 Product IDs
}, { timestamps: true });

module.exports = mongoose.model('TrendingConfig', trendingConfigSchema);
