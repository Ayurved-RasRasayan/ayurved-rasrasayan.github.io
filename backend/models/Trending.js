const mongoose = require('mongoose');

const trendingSchema = new mongoose.Schema({
    picks: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product' // This tells MongoDB these IDs belong to the Product model
    }]
});

module.exports = mongoose.model('Trending', trendingSchema);
