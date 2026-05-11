const express = require('express');
const router = express.Router();
const Trending = require('../models/Trending');
const basicAuth = require('express-basic-auth'); // Assuming you use this for admin

// Admin Auth Middleware (Adjust to match your exact auth setup)
const adminAuth = basicAuth({
    users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASSWORD },
    challenge: true
});

// GET current trending picks
router.get('/', adminAuth, async (req, res) => {
    try {
        // We only keep one document in this collection
        let trending = await Trending.findOne();
        if (!trending) {
            trending = await Trending.create({ picks: [] });
        }
        res.json(trending);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch trending picks' });
    }
});

// PUT (or POST) to save trending picks
router.put('/', adminAuth, async (req, res) => {
    try {
        const { picks } = req.body;
        
        if (!picks || !Array.isArray(picks) || picks.length !== 4) {
            return res.status(400).json({ error: 'Exactly 4 picks are required' });
        }

        // Upsert: update if exists, create if it doesn't
        const updatedTrending = await Trending.findOneAndUpdate(
            {}, // find the first document
            { picks: picks },
            { new: true, upsert: true }
        );

        res.json(updatedTrending);
    } catch (err) {
        console.error('Save trending error:', err);
        res.status(500).json({ error: 'Failed to save trending picks' });
    }
});

module.exports = router;
