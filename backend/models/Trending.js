const mongoose = require('mongoose');

const trendingSchema = new mongoose.Schema({
    picks: {
        type: [String], // Array of Product IDs (e.g., ["prod1", "prod2", "prod3", "prod4"])
        validate: [
            {
                validator: function(val) {
                    return val.length <= 4; // Ensure no more than 4 picks can be saved
                },
                message: 'Trending picks cannot exceed 4 items.'
            }
        ]
    }
});

module.exports = mongoose.model('Trending', trendingSchema);
