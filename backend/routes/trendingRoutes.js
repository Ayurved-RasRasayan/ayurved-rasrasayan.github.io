const express = require('express');
const router = express.Router();
const mongoose = require('mongoose'); // Required for ObjectId validation
const Trending = require('../models/Trending');
const Product = require('../models/Product'); // Required to fetch product details

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

// GET current trending picks (PUBLIC)
router.get('/', async (req, res) => {
    try {
        let trending = await Trending.findOne();

        if (!trending || !trending.picks || trending.picks.length === 0) {
            return res.json({ picks: [] });
        }
        
        const productIds = trending.picks;
        
        // FIX: Prevent Mongoose CastError by separating valid ObjectIds from custom string IDs
        const validObjectIds = productIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        const customIds = productIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
        
        let queryConditions = [];
        if (validObjectIds.length > 0) {
            queryConditions.push({ _id: { $in: validObjectIds } });
        }
        if (customIds.length > 0) {
            queryConditions.push({ id: { $in: customIds } });
        }
        
        let products = [];
        if (queryConditions.length > 0) {
            products = await Product.find({ $or: queryConditions });
        }
        
        // Re-order the products to match the exact order the admin selected
        const orderedPicks = productIds.map(pid => 
            products.find(p => String(p._id) === String(pid) || String(p.id) === String(pid))
        ).filter(Boolean); // .filter(Boolean) removes any nulls if a product was deleted
        
        res.json({ picks: orderedPicks });
        
    } catch (err) {
        console.error('Fetch trending error:', err);
        res.status(500).json({ error: 'Failed to fetch trending picks' });
    }
});

// POST to save trending picks (PROTECTED - Admin Auth Required)
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
