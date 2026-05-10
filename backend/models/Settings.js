const mongoose = require('mongoose');
const settingSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: mongoose.Schema.Types.Mixed });
settingSchema.statics.getSetting = async function(key, defaultVal) { const doc = await this.findOne({ key }); return doc ? doc.value : defaultVal; };
settingSchema.statics.setSetting = async function(key, value) { await this.updateOne({ key }, { value }, { upsert: true }); };
module.exports = mongoose.model('Setting', settingSchema);