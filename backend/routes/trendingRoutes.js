const express = require('express');
const router = express.Router();
const Trending = require('../models/Trending');

// ==========================================
// CUSTOM ADMIN AUTH MIDDLEWARE
// ==========================================
const adminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing auth header' });
    }

    try {
        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
        const [username, password] = credentials.split(':');

        if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD) {
            next();
        } else {
            return res.status(401).json({ error: 'Unauthorized: Invalid credentials' });
        }
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Malformed auth header' });
    }
};

// ==========================================
// ROUTES
// ==========================================

// GET current trending picks (WITH POPULATE FOR HOMEPAGE)
router.get('/', async (req, res) => {
    try {
        let trending = await Trending.findOne()
            // THIS IS THE MAGIC: It swaps the IDs for full product data!
            .populate('picks'); 

        if (!trending) {
            trending = await Trending.create({ picks: [] });
        }
        
        // If it's an admin request, we might want just the IDs for the dropdowns.
        // If it's the homepage, we want the full populated data.
        // Let's return the full data. The admin panel will handle extracting the IDs.
        res.json(trending);
        
    } catch (err) {
        console.error('Fetch trending error:', err);
        res.status(500).json({ error: 'Failed to fetch trending picks' });
    }
});

// POST to save trending picks
router.post('/', adminAuth, async (req, res) => {
    try {
        const { picks } = req.body;
        
        if (!picks || !Array.isArray(picks) || picks.length !== 4) {
            return res.status(400).json({ error: 'Exactly 4 picks are required' });
        }

        const updatedTrending = await Trending.findOneAndUpdate(
            {},
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
