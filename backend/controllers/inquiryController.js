const Inquiry = require('../models/Inquiry');
const { sendInquiryAlert } = require('../services/emailService');

exports.createInquiry = async (req, res) => { try { if (!req.body.email || !req.body.message) return res.status(400).json({ error: 'Missing' }); await new Inquiry(req.body).save(); await sendInquiryAlert(req.body); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } };