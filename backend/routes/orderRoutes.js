const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const orderCtrl = require('../controllers/orderController');
const Order = require('../models/Order');

// Helper to escape regex special chars
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==========================================
// GET /api/orders/user-orders
// Fetch all orders for a specific user.
// Matches by email, userId, name, or phone
// to handle various order data structures.
// ==========================================
router.get('/user-orders', checkAuth, async (req, res) => {
  try {
    const { email, userId, name, phone } = req.query;

    console.log('[USER-ORDERS] Search params:', { email, userId, name, phone });

    if (!email && !userId && !name && !phone) {
      return res.status(400).json({ success: false, error: 'At least one search parameter (email, userId, name, phone) is required' });
    }

    // Build an array of match conditions — we use $or so ANY match counts
    const conditions = [];

    if (email && email.trim()) {
      const emailRegex = new RegExp('^' + escapeRegex(email.trim()) + '$', 'i');
      // Try multiple possible field paths for email
      conditions.push({ 'clientDetails.email': emailRegex });
      conditions.push({ 'client.email': emailRegex });
      conditions.push({ email: emailRegex });
    }

    if (userId && userId.trim()) {
      // Try multiple possible field paths for userId
      conditions.push({ userId: userId.trim() });
      conditions.push({ user: userId.trim() });
      conditions.push({ user_id: userId.trim() });
    }

    if (name && name.trim()) {
      const nameRegex = new RegExp(escapeRegex(name.trim()), 'i');
      // Try multiple possible field paths for name
      conditions.push({ 'clientDetails.name': nameRegex });
      conditions.push({ 'client.name': nameRegex });
      conditions.push({ customerName: nameRegex });
    }

    if (phone && phone.trim()) {
      const phoneClean = phone.trim().replace(/[\s\-\(\)]/g, '');
      const phoneRegex = new RegExp(escapeRegex(phoneClean));
      conditions.push({ 'clientDetails.phone': phoneRegex });
      conditions.push({ 'client.phone': phoneRegex });
      conditions.push({ phone: phoneRegex });
    }

    if (conditions.length === 0) {
      return res.json({ success: true, orders: [], stats: { total: 0, pending: 0, shipping: 0, completed: 0, success: 0, rejected: 0, totalSpent: 0, pendingAmount: 0 }, debug: { message: 'No valid search criteria' } });
    }

    const query = { $or: conditions };
    console.log('[USER-ORDERS] MongoDB query:', JSON.stringify(query, null, 2));

    const orders = await Order.find(query).sort({ timestamp: -1 });
    console.log('[USER-ORDERS] Found:', orders.length, 'orders');

    // DEBUG: If 0 results, fetch a sample order to see the actual field structure
    let debugInfo = null;
    if (orders.length === 0) {
      const sampleOrder = await Order.findOne().lean();
      if (sampleOrder) {
        debugInfo = {
          message: 'No matching orders found. Showing sample order structure for debugging.',
          sampleKeys: Object.keys(sampleOrder),
          sampleClientDetails: sampleOrder.clientDetails || 'FIELD NOT PRESENT',
          sampleEmail: sampleOrder.email || 'FIELD NOT PRESENT',
          sampleUserId: sampleOrder.userId || 'FIELD NOT PRESENT',
          sampleUser: sampleOrder.user || 'FIELD NOT PRESENT',
          searchedEmail: email || 'NOT PROVIDED',
          searchedUserId: userId || 'NOT PROVIDED',
          searchedName: name || 'NOT PROVIDED'
        };
        console.log('[USER-ORDERS] DEBUG - Sample order structure:', JSON.stringify(debugInfo, null, 2));
      } else {
        debugInfo = { message: 'No orders exist in the database at all.' };
      }
    }

    // Compute stats
    const stats = {
      total: orders.length,
      pending: orders.filter(o => o.status === 'Pending').length,
      shipping: orders.filter(o => o.status === 'Shipping').length,
      completed: orders.filter(o => o.status === 'Completed').length,
      success: orders.filter(o => o.status === 'Success').length,
      rejected: orders.filter(o => o.status === 'Rejected').length,
      totalSpent: orders.reduce((sum, o) => sum + (o.totalNPR || 0), 0),
      pendingAmount: orders.filter(o => o.status === 'Pending').reduce((sum, o) => sum + (o.totalNPR || 0), 0)
    };

    res.json({ success: true, orders, stats, debug: debugInfo });
  } catch (error) {
    console.error('[USER-ORDERS] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// EXISTING ROUTES
// ==========================================
router.post('/', orderCtrl.createOrder);
router.put('/update-status', checkAuth, orderCtrl.updateStatus);
router.put('/update-order-state', checkAuth, orderCtrl.updateOrderState);
router.delete('/delete-order/:id', checkAuth, orderCtrl.deleteOrder);
router.delete('/delete-orders', checkAuth, orderCtrl.deleteOrders);
router.get('/view-orders-data', checkAuth, orderCtrl.viewOrdersData);

module.exports = router;
