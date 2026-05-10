const express = require('express');
const router = express.Router();
const inqCtrl = require('../controllers/inquiryController');
router.post('/', inqCtrl.createInquiry);
module.exports = router;