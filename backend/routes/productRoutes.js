const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const prodCtrl = require('../controllers/productController');

router.get('/', prodCtrl.getProducts);
router.get('/:id', prodCtrl.getProductById);
router.post('/', checkAuth, prodCtrl.createProduct);
router.put('/:id', checkAuth, prodCtrl.updateProduct);
router.delete('/:id', checkAuth, prodCtrl.deleteProduct);
router.post('/bulk', checkAuth, prodCtrl.bulkProducts);
router.get('/seed', checkAuth, prodCtrl.seedProducts);
router.get('/sync-products', checkAuth, prodCtrl.syncProducts);
router.get('/seed-stock', checkAuth, prodCtrl.seedStock);
router.put('/update-stock', checkAuth, prodCtrl.updateStock);
router.get('/manage-stock', checkAuth, prodCtrl.manageStockPage);

module.exports = router;