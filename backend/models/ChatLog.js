const mongoose = require('mongoose');

const chatLogSchema = new mongoose.Schema({
    sessionId: { type: String, required: true }, // Groups messages by user session
    messages: [{
        sender: { type: String, enum: ['user', 'bot'], required: true },
        text: { type: String, required: true },
        timestamp: { type: Date, default: Date.now }
    }],
    handedOff: { type: Boolean, default: false } // True if user asked for human
});

module.exports = mongoose.model('ChatLog', chatLogSchema);
