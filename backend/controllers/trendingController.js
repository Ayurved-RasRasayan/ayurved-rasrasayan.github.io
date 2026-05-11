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
    const topOrdered = await Order.aggregate([
      { $unwind: '$items' },
      { 
        $group: {
          _id: { $ifNull: ['$items.productId', '$items.id'] },
          totalQty: { $sum: { $toInt: { $ifNull: ['$items.qty', 1] } } }
        }
      },
      { $sort: { totalQty: -1 } },
      { $limit: 50 } // Get top 50 to filter out picks safely
    ]);

    // 3. Filter out admin picks from auto-calculated list
    const autoIds = topOrdered
      .map(item => item._id?.toString())
      .filter(id => id && !adminPicks.includes(id))
      .slice(0, 8); // Take max 8

    // 4. Combine: Admin Picks first, then Auto
    const finalIds = [...adminPicks, ...autoIds].slice(0, 10);

    // 5. Fetch Product Details
    const products = await Product.find({ _id: { $in: finalIds } }).lean();

    // 6. Sort products to match the Admin Picks first, then Top Ordered
    products.sort((a, b) => {
      const aIndex = finalIds.indexOf(a._id.toString());
      const bIndex = finalIds.indexOf(b._id.toString());
      return aIndex - bIndex;
    });

    // 7. Add 'isPick' flag for the frontend badge
    const result = products.map(p => ({
      ...p,
      isPick: adminPicks.includes(p._id.toString())
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
    const { picks } = req.body; // Expecting array of 2 product IDs

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
