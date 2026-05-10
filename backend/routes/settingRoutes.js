const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const setCtrl = require('../controllers/settingController');

router.get('/exchange-rate', checkAuth, setCtrl.getRate);
router.get('/public/rate', setCtrl.getRate);
router.get('/exchange-rate/fetch', checkAuth, setCtrl.fetchRate);
router.get('/public/visits', setCtrl.getVisits);
router.get('/health', setCtrl.healthCheck);

module.exports = router;