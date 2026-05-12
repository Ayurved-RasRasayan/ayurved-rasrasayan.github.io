const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const ChatLog = require('../models/ChatLog');

// Initialize Groq (Using OpenAI SDK)
const openai = new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY
});

// POST /api/chat - Handle user messages
router.post('/', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        if (!message || !sessionId) return res.status(400).json({ error: 'Message and sessionId required' });

        let chatLog = await ChatLog.findOne({ sessionId });
        if (!chatLog) {
            chatLog = new ChatLog({ sessionId, messages: [] });
        }

        chatLog.messages.push({ sender: 'user', text: message });

        // ==========================================
        // HUMAN HANDOFF DETECTION
        // ==========================================
        const lowerMsg = message.toLowerCase();
        const handoffKeywords = ['human', 'agent', 'real person', 'representative', 'talk to someone'];
        
        if (handoffKeywords.some(keyword => lowerMsg.includes(keyword))) {
            const handoffReply = "I'll get a human specialist to look into this for you. Please click the button below to leave your details, and our team will get back to you shortly.";
            
            chatLog.messages.push({ sender: 'bot', text: handoffReply });
            await chatLog.save();

            // Return the reply AND the handoff flag so the frontend UI changes
            return res.json({ reply: handoffReply, handoff: true });
        }
        // ==========================================

        const history = chatLog.messages.slice(-10).map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.text
        }));

        // Call Groq API
        const chatCompletion = await openai.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are an expert AI assistant for NaturaBotanica...` // (Keep your long prompt here)
                },
                ...history
            ],
            model: 'llama-3.1-8b-instant'
        });

        const botReply = chatCompletion.choices[0].message.content;

        chatLog.messages.push({ sender: 'bot', text: botReply });
        await chatLog.save();

        res.json({ reply: botReply });
    } catch (error) {
        console.error('Groq API error:', error);
        if (error.status === 402) {
            return res.status(402).json({ error: 'API balance is insufficient.' });
        }
        res.status(500).json({ error: 'Failed to get response from AI' });
    }
});

module.exports = router;
