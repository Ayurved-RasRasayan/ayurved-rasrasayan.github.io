const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const viewCtrl = require('../controllers/viewController');

router.get('/manage-users', checkAuth, viewCtrl.manageUsers);
router.get('/view-orders', checkAuth, viewCtrl.viewOrders);
// Add profile route if you have user.html in views
// router.get('/profile', viewCtrl.profile);

module.exports = router;