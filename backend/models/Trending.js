const mongoose = require('mongoose');

const trendingSchema = new mongoose.Schema({
    picks: [{
        type: String, // Changed from ObjectId to String to accept any ID format
        trim: true
    }]
});

module.exports = mongoose.model('Trending', trendingSchema);
