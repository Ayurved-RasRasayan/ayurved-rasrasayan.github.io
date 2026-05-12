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

        // Find or create chat log for this user session
        let chatLog = await ChatLog.findOne({ sessionId });
        if (!chatLog) {
            chatLog = new ChatLog({ sessionId, messages: [] });
        }

        // Save user message
        chatLog.messages.push({ sender: 'user', text: message });

        // Build conversation history for Groq
        const history = chatLog.messages.slice(-10).map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.text
        }));

        // Call Groq API
        const chatCompletion = await openai.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are an expert AI assistant for NaturaBotanica, a premier supplier of authentic Ayurvedic, pharmaceutical, and mineral ingredients sourced primarily from Nepal and India.

Your deep knowledge encompasses:
1. **Nepalese Himalayan Herbs**: High-altitude botanicals like Yarsagumba (Cordyceps sinensis), Panch Aunle, Kutki, Padamchal, Satuwa, and Shilajit.
2. **Indian Ayurvedic Herbs**: Classic herbs like Ashwagandha, Brahmi, Shatavari, Tulsi, Neem, Guduchi, and Turmeric.
3. **Rasa Shastra (Minerals & Metals)**: Traditional purification and incineration processes for making Bhasmas (e.g., Swarna Bhasma, Tamra Bhasma) and Rasa (mercury preparations).
4. **Regional Sourcing**: Deep understanding of how herbs from the Nepalese Terai differ from high-altitude Mustang/Dolpa regions, and Indian Himalayan vs. Western Ghats sourcing.
5. **Phytochemistry & Pharmacology**: Active constituents, extract ratios, and modern scientific applications of traditional herbs.

When answering, try to include:
- The **Common Name** and **Scientific/Botanical Name** (e.g., Ashwagandha - *Withania somnifera*).
- **Ayurvedic Properties** (Rasa, Virya, Vipaka, Dosha effects) where relevant.
- **Modern Medicinal Uses** and active compounds.
- **B2B Sourcing Info**: Typical forms available (raw, extract, powder), standard extract ratios (e.g., 5:1, 10:1), and MOQ/shipping context for NaturaBotanica.

Keep responses professional, well-structured, and concise. If a user asks about something outside of herbs, minerals, or B2B sourcing, politely guide them back to NaturaBotanica's domain of expertise.`
                },
                ...history
            ],
            model: 'llama-3.1-8b-instant'
        });

        const botReply = chatCompletion.choices[0].message.content;

        // Save bot reply
        chatLog.messages.push({ sender: 'bot', text: botReply });
        await chatLog.save();

        res.json({ reply: botReply });
    } catch (error) {
        console.error('Groq API error:', error);
        
        // Specific handling for payment/balance issues
        if (error.status === 402) {
            return res.status(402).json({ error: 'API balance is insufficient. Please top up your account.' });
        }

        res.status(500).json({ error: 'Failed to get response from AI' });
    }
});

module.exports = router;
