const express = require('express');
const router = express.Router();
const { checkAuth, userAuth } = require('../middleware/auth');
const authCtrl = require('../controllers/authController');

router.post('/signup', authCtrl.signup);
router.post('/signin', authCtrl.signin);
router.post('/verify', authCtrl.verifyOTP);
router.post('/resend-otp', authCtrl.resendOTP);
router.get('/me', userAuth, authCtrl.getMe);
router.post('/cart/sync', userAuth, authCtrl.syncCart);
router.get('/my-orders', userAuth, authCtrl.getMyOrders);
router.get('/users-data', checkAuth, authCtrl.getUsers);
router.delete('/delete-user/:id', checkAuth, authCtrl.deleteUser);

module.exports = router;
