const Order = require('../models/Order');
const Product = require('../models/Product');
const TrendingConfig = require('../models/TrendingConfig');

// ==========================================
// GET /api/trending
// Public: Returns 10 trending products
// ==========================================
exports.getTrending = async (req, res) => {
  try {
    // 1. Get Admin Picks
    let config = await TrendingConfig.findOne({ type: 'trending' });
    const adminPicks = config?.picks || [];

    // 2. Aggregate top ordered products
    let autoIds = [];
    try {
      const topOrdered = await Order.aggregate([
        { $unwind: '$items' },
        { $match: { 'items.id': { $exists: true, $ne: null } } },
        { 
          $group: {
            _id: { $ifNull: ['$items.productId', '$items.id'] },
            totalQty: { 
              $sum: { 
                $cond: [
                  { $isNumber: '$items.qty' }, 
                  '$items.qty', 
                  { $toInt: { $ifNull: ['$items.qty', 1] } } 
                ] 
              } 
            }
          }
        },
        { $sort: { totalQty: -1 } },
        { $limit: 50 }
      ]);

      autoIds = topOrdered
        .map(item => item._id?.toString())
        .filter(id => id && !adminPicks.includes(id))
        .slice(0, 8);
    } catch (aggErr) {
      console.error('[TRENDING] Aggregation error:', aggErr.message);
    }

    // 3. Combine: Admin Picks first, then Auto
    const finalIds = [...adminPicks, ...autoIds].slice(0, 10);

    if (finalIds.length === 0) {
      return res.json({ success: true, trending: [] });
    }

    // 4. Fetch Product Details (FIX: Handle both numeric IDs and MongoDB ObjectIds)
    const queryConditions = finalIds.map(id => {
      if (/^\d+$/.test(id)) {
        return { id: parseInt(id) };       // Numeric ID like "68"
      } else {
        return { _id: id };                // MongoDB ObjectId like "65a1b2c3..."
      }
    });

    const products = await Product.find({ $or: queryConditions }).lean();

    // 5. Sort products to match the Admin Picks first
    products.sort((a, b) => {
      const aId = String(a.id || a._id);
      const bId = String(b.id || b._id);
      const aIndex = finalIds.findIndex(fid => String(fid) === aId);
      const bIndex = finalIds.findIndex(fid => String(fid) === bId);
      return aIndex - bIndex;
    });

    // 6. Add 'isPick' flag for the frontend badge
    const result = products.map(p => ({
      ...p,
      isPick: adminPicks.includes(String(p.id || p._id))
    }));

    res.json({ success: true, trending: result });
  } catch (error) {
    console.error('[TRENDING] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// PUT /api/trending/picks
// Admin: Update the 2 trending picks
// ==========================================
exports.updatePicks = async (req, res) => {
  try {
    const { picks } = req.body;

    if (!Array.isArray(picks) || picks.length > 2) {
      return res.status(400).json({ success: false, error: 'Please provide exactly 2 product IDs' });
    }

    const config = await TrendingConfig.findOneAndUpdate(
      { type: 'trending' },
      { picks },
      { upsert: true, new: true }
    );

    res.json({ success: true, picks: config.picks });
  } catch (error) {
    console.error('[TRENDING-PICKS] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
