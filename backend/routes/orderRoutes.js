const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const orderCtrl = require('../controllers/orderController');
const Order = require('../models/Order');
const { sendClientEmail } = require('../services/emailService');

// Helper to escape regex special chars
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==========================================
// PUT /api/orders/update-status
// Updates order status AND sends email
// when status changes to Success, Shipping,
// Completed, or Rejected
// ==========================================
router.put('/update-status', checkAuth, async (req, res) => {
  try {
    const { id, status } = req.body;

    if (!id || !status) {
      return res.status(400).json({ success: false, error: 'Order ID and status are required' });
    }

    const validStatuses = ['Pending', 'Shipping', 'Completed', 'Success', 'Rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status value' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const oldStatus = order.status;
    order.status = status;

    // ==========================================
    // EMAIL TRIGGER LOGIC
    // Send client email when status changes TO
    // Success, Shipping, Completed, or Rejected
    // ==========================================
    const EMAIL_TRIGGER_STATUSES = ['Success', 'Shipping', 'Completed', 'Rejected'];

    let emailSent = false;
    let emailStatus = order.emailStatus || 'Queue';

    if (EMAIL_TRIGGER_STATUSES.includes(status) && oldStatus !== status) {
      const clientEmail = order.clientDetails?.email;
      const clientName = order.clientDetails?.name || 'Customer';
      const shortId = String(order._id).substring(0, 8).toUpperCase();

      if (clientEmail) {
        console.log(`[UPDATE-STATUS] 📧 Sending "${status}" email to ${clientEmail} for order #${shortId}`);

        const emailResult = await sendClientEmail(clientEmail, clientName, shortId, status);

        if (emailResult) {
          emailSent = true;
          emailStatus = 'Sent';
          order.emailStatus = 'Sent';
          console.log(`[UPDATE-STATUS] ✅ Email sent successfully to ${clientEmail}`);
        } else {
          emailStatus = 'Failed';
          order.emailStatus = 'Failed';
          console.log(`[UPDATE-STATUS] ❌ Email failed for ${clientEmail}`);
        }
      } else {
        console.log(`[UPDATE-STATUS] ⚠️ No client email on order #${shortId}, skipping email`);
        emailStatus = 'No Email';
        order.emailStatus = 'No Email';
      }
    }

    await order.save();

    res.json({
      success: true,
      status: order.status,
      emailSent: emailSent,
      emailStatus: emailStatus
    });

  } catch (error) {
    console.error('[UPDATE-STATUS] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

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

    const conditions = [];

    if (email && email.trim()) {
      const emailRegex = new RegExp('^' + escapeRegex(email.trim()) + '$', 'i');
      conditions.push({ 'clientDetails.email': emailRegex });
      conditions.push({ 'client.email': emailRegex });
      conditions.push({ email: emailRegex });
    }

    if (userId && userId.trim()) {
      conditions.push({ userId: userId.trim() });
      conditions.push({ user: userId.trim() });
      conditions.push({ user_id: userId.trim() });
    }

    if (name && name.trim()) {
      const nameRegex = new RegExp(escapeRegex(name.trim()), 'i');
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
// EXISTING ROUTES (unchanged)
// ==========================================
router.post('/', orderCtrl.createOrder);
router.put('/update-order-state', checkAuth, orderCtrl.updateOrderState);
router.delete('/delete-order/:id', checkAuth, orderCtrl.deleteOrder);
router.delete('/delete-orders', checkAuth, orderCtrl.deleteOrders);
router.get('/view-orders-data', checkAuth, orderCtrl.viewOrdersData);

module.exports = router;
