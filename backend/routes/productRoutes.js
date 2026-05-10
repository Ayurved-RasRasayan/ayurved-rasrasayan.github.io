const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const prodCtrl = require('../controllers/productController');

// ==========================================
// STATIC ROUTES (Must come before /:id)
// ==========================================
router.get('/', prodCtrl.getProducts);
router.get('/seed', checkAuth, prodCtrl.seedProducts);
router.get('/sync-products', checkAuth, prodCtrl.syncProducts);
router.get('/seed-stock', checkAuth, prodCtrl.seedStock);
router.post('/', checkAuth, prodCtrl.createProduct);
router.post('/bulk', checkAuth, prodCtrl.bulkProducts);
router.get('/manage-stock', checkAuth, prodCtrl.manageStockPage);
router.put('/update-stock', checkAuth, prodCtrl.updateStock);

// ==========================================
// DYNAMIC ROUTE (Must come LAST)
// ==========================================
router.get('/:id', prodCtrl.getProductById);
router.put('/:id', checkAuth, prodCtrl.updateProduct);
router.delete('/:id', checkAuth, prodCtrl.deleteProduct);

module.exports = router;
