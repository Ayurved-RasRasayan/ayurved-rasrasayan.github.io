const mongoose = require('mongoose');
const Setting = require('../models/Setting');
const Visitor = require('../models/Visitor');
const { getClientIp } = require('../utils/helpers');
const { syncExchangeRate } = require('../services/syncService');

exports.getRate = async (req, res) => { try { const rate = await Setting.getSetting('exchange_rate', 133); res.json({ rate }); } catch (e) { res.status(500).json({ error: e.message }); } };
exports.fetchRate = async (req, res) => { try { const rate = await syncExchangeRate(); if (rate) res.json({ success: true, rate }); else res.status(502).json({ error: 'Failed' }); } catch (e) { res.status(502).json({ error: 'Failed' }); } };
exports.getVisits = async (req, res) => { try { const ip = getClientIp(req); await Visitor.updateOne({ ip }, { $set: { lastVisited: new Date() } }, { upsert: true }); const baseCount = await Setting.getSetting('base_visitor_count', 5000); const uniqueCount = await Visitor.countDocuments({}); res.json({ count: baseCount + uniqueCount }); } catch (e) { res.json({ count: 5000 }); } };
exports.healthCheck = async (req, res) => { try { await mongoose.connection.db.admin().ping(); res.json({ status: 'healthy' }); } catch (e) { res.status(503).json({ status: 'unhealthy' }); } };