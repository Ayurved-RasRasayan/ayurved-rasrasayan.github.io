const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const trendingCtrl = require('../controllers/trendingController');

router.get('/', trendingCtrl.getTrending); // Public
router.put('/picks', checkAuth, trendingCtrl.updatePicks); // Admin Only

module.exports = router;
