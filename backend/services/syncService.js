const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Product = require('../models/Product');
const Setting = require('../models/Setting');

// Path goes up one level to backend/ to find products.json
const PRODUCTS_FILE = path.join(__dirname, '..', 'products.json');

exports.syncProductsToDB = async (productsArray, { removeOrphans = false, resetStock = false } = {}) => {
  if (!Array.isArray(productsArray) || productsArray.length === 0) return { added: 0, updated: 0, removed: 0 };
  let added = 0, updated = 0, removed = 0;
  const incomingIds = new Set(productsArray.map(p => p.id));
  for (const p of productsArray) { const existing = await Product.findOne({ id: p.id }); if (existing) { const updateData = { ...p }; if (!resetStock) updateData.stock = existing.stock; await Product.updateOne({ id: p.id }, { $set: updateData }); updated++; } else { await new Product({ ...p, stock: p.stock ?? 100 }).save(); added++; } }
  if (removeOrphans) { const dbProducts = await Product.find({}, { id: 1 }); for (const dbp of dbProducts) { if (!incomingIds.has(dbp.id)) { await Product.deleteOne({ id: dbp.id }); removed++; } } }
  return { added, updated, removed };
};

exports.syncDBToFile = async () => { try { const products = await Product.find().sort({ id: 1 }).lean(); const clean = products.map(({ _id, __v, ...rest }) => rest); fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(clean, null, 2), 'utf8'); return true; } catch (e) { return false; } };

exports.syncFileToDB = async (options = {}) => { try { const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8'); const products = JSON.parse(raw); return await exports.syncProductsToDB(products, options); } catch (e) { return null; } };

let syncDebounce = null;
exports.startFileWatcher = () => { try { fs.watch(PRODUCTS_FILE, (eventType) => { if (eventType !== 'change') return; if (syncDebounce) clearTimeout(syncDebounce); syncDebounce = setTimeout(async () => { await exports.syncFileToDB({ removeOrphans: true }); }, 500); }); console.log('[WATCHER] 👀 Watching products.json for changes...'); } catch (e) {} };

exports.syncExchangeRate = async () => { try { const apiRes = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 10000 }); if (apiRes.data?.result === 'success' && apiRes.data?.rates?.NPR) { const rate = apiRes.data.rates.NPR; await Setting.setSetting('exchange_rate', rate); await Setting.setSetting('rate_source', 'live'); await Setting.setSetting('rate_fetched_at', new Date().toISOString()); return rate; } } catch (e) {} return null; };