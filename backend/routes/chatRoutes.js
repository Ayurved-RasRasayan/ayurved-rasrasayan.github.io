const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const ChatLog = require('../models/ChatLog');

// Initialize Grok (Using OpenAI SDK)
const openai = new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY
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

        // Build conversation history for Grok
        const history = chatLog.messages.slice(-10).map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.text
        }));

        // Call Grok API
        const chatCompletion = await openai.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are a helpful assistant for NaturaBotanica, a supplier of premium Ayurvedic, pharmaceutical, and mineral ingredients. Answer questions about products, MOQs, and shipping. Keep responses concise and professional.`
                },
                ...history
            ],
            model: 'grok-2'                  // <-- CHANGED to the current Grok model
        });

        const botReply = chatCompletion.choices[0].message.content;

        // Save bot reply
        chatLog.messages.push({ sender: 'bot', text: botReply });
        await chatLog.save();

        res.json({ reply: botReply });
    } catch (error) {
        console.error('Grok API error:', error);
        
        // Specific handling for payment/balance issues
        if (error.status === 402) {
            return res.status(402).json({ error: 'API balance is insufficient. Please top up your account.' });
        }

        res.status(500).json({ error: 'Failed to get response from AI' });
    }
});

module.exports = router;
