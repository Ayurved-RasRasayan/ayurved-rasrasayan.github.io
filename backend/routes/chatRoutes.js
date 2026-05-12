const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ChatLog = require('../models/ChatLog');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.0-pro-latest",
    systemInstruction: `You are a helpful assistant for NaturaBotanica, a supplier of premium Ayurvedic, pharmaceutical, and mineral ingredients. 
    Answer questions about products, MOQs, and shipping. Keep answers brief and professional. 
    If you don't know the exact answer, or if the user asks to speak to a human, agent, or specialist, you MUST say exactly: [HANDOFF]`
});

// POST /api/chat - Handle user messages
router.post('/', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        if (!message || !sessionId) return res.status(400).json({ error: 'Message and sessionId required' });

        // Find or create chat log for this user session
        let chatLog = await ChatLog.findOne({ sessionId });
        if (!chatLog) {
            chatLog = new ChatLog({ sessionId, messages: [] });
        }

        // Save user message
        chatLog.messages.push({ sender: 'user', text: message });

        // Build conversation history for Gemini (last 10 messages for context)
        const history = chatLog.messages.slice(-10).map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));

        // Start chat with Gemini
        const chat = model.startChat({ history });
        const result = await chat.sendMessage(message);
        const botText = result.response.text();

        // Check for Handoff trigger
        let handoff = false;
        let finalText = botText;

        if (botText.includes('[HANDOFF]')) {
            handoff = true;
            finalText = "I'm connecting you to a Professional Assistance specialist. Please hold on or click the button below to leave a quote request.";
            chatLog.handedOff = true; 
        }

        // Save bot response
        chatLog.messages.push({ sender: 'bot', text: finalText });
        await chatLog.save();

        res.json({ response: finalText, handoff });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Failed to get response' });
    }
});

module.exports = router;
