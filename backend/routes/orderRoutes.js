const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const orderCtrl = require('../controllers/orderController');

// Import the Order model directly for the user-orders route
const Order = require('../models/Order');

// ==========================================
// NEW: Fetch orders for a specific user
// MUST be placed before any /:id routes
// ==========================================
router.get('/user-orders', checkAuth, async (req, res) => {
  try {
    const { email, userId } = req.query;

    if (!email && !userId) {
      return res.status(400).json({ success: false, error: 'Email or userId is required' });
    }

    // Build query — match by email (case-insensitive) and/or userId
    const orConditions = [];
    if (email) orConditions.push({ 'clientDetails.email': { $regex: new RegExp('^' + email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
    if (userId) orConditions.push({ userId: userId });

    const query = orConditions.length > 1 ? { $or: orConditions } : orConditions[0];

    const orders = await Order.find(query).sort({ timestamp: -1 });

    // Pre-compute stats so the frontend doesn't have to
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

    res.json({ success: true, orders, stats });
  } catch (error) {
    console.error('Error fetching user orders:', error);
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
