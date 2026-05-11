const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Trending = require('../models/Trending');
const Product = require('../models/Product');
const ProductStat = require('../models/ProductStat'); // NEW: Import stats

// ==========================================
// CUSTOM ADMIN AUTH MIDDLEWARE
// ==========================================
const adminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii');
        const [username, password] = credentials.split(':');
        if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD) next();
        else return res.status(401).json({ error: 'Invalid credentials' });
    } catch (err) { return res.status(401).json({ error: 'Malformed auth header' }); }
};

// ==========================================
// ROUTES
// ==========================================

// GET trending (4 Staff Picks + 6 Top Sellers)
router.get('/', async (req, res) => {
    try {
        let populatedPicks = [];

        // 1. FETCH 4 ADMIN STAFF PICKS
        let trending = await Trending.findOne();
        if (trending && trending.picks && trending.picks.length > 0) {
            const pickIds = trending.picks;
            const validObjectIds = pickIds.filter(id => mongoose.Types.ObjectId.isValid(id));
            const customIds = pickIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
            
            let queryConditions = [];
            if (validObjectIds.length > 0) queryConditions.push({ _id: { $in: validObjectIds } });
            if (customIds.length > 0) queryConditions.push({ id: { $in: customIds } });
            
            if (queryConditions.length > 0) {
                const products = await Product.find({ $or: queryConditions });
                populatedPicks = pickIds.map(pid => {
                    const p = products.find(p => String(p._id) === String(pid) || String(p.id) === String(pid));
                    if (p) p.isPick = true; // Mark for frontend badge
                    return p;
                }).filter(Boolean);
            }
        }

        // 2. FETCH TOP 6 BEST SELLERS
        const topSellerStats = await ProductStat.find().sort({ unitsSold: -1 }).limit(10); // Get 10 in case of duplicates with picks
        let topSellers = [];

        if (topSellerStats.length > 0) {
            const sellerIds = topSellerStats.map(stat => stat.productId);
            const validSellerObjIds = sellerIds.filter(id => mongoose.Types.ObjectId.isValid(id));
            const customSellerIds = sellerIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
            
            let sellerQuery = [];
            if (validSellerObjIds.length > 0) sellerQuery.push({ _id: { $in: validSellerObjIds } });
            if (customSellerIds.length > 0) sellerQuery.push({ id: { $in: customSellerIds } });

            if (sellerQuery.length > 0) {
                const sellerProducts = await Product.find({ $or: sellerQuery });
                
                // Filter out duplicates (if a top seller is already a staff pick)
                for (let stat of topSellerStats) {
                    const p = sellerProducts.find(sp => String(sp._id) === String(stat.productId) || String(sp.id) === String(stat.productId));
                    const isDuplicate = populatedPicks.some(pick => String(pick._id) === String(p?._id) || String(pick.id) === String(p?.id));
                    
                    if (p && !isDuplicate) {
                        p.isPick = false; // Mark as top seller for frontend
                        topSellers.push(p);
                    }
                    if (topSellers.length === 6) break; // Stop once we have 6 unique top sellers
                }
            }
        }

        // 3. COMBINE LISTS (4 picks + up to 6 top sellers = 10 total)
        const finalTrending = [...populatedPicks, ...topSellers];
        res.json({ picks: finalTrending });

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
        const updatedTrending = await Trending.findOneAndUpdate({}, { picks: picks }, { new: true, upsert: true });
        res.json(updatedTrending);
    } catch (err) {
        console.error('Save trending error:', err);
        res.status(500).json({ error: 'Failed to save trending picks' });
    }
});

module.exports = router;
