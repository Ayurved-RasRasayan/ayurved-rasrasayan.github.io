const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const orderCtrl = require('../controllers/orderController');

router.post('/', orderCtrl.createOrder);
router.put('/update-status', checkAuth, orderCtrl.updateStatus);
router.put('/update-order-state', checkAuth, orderCtrl.updateOrderState);
router.delete('/delete-order/:id', checkAuth, orderCtrl.deleteOrder);
router.delete('/delete-orders', checkAuth, orderCtrl.deleteOrders);
router.get('/view-orders-data', checkAuth, orderCtrl.viewOrdersData);

module.exports = router;