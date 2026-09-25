const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

// Gemini API Yapılandırması
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// 1. Meta Webhook Doğrulama (GET)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === VERIFY_TOKEN) {
        console.log("Webhook doğrulandı!");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// 2. Gelen Instagram Mesajını İşleme (POST)
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'instagram') {
        for (const entry of body.entry) {
            if (entry.messaging) {
                for (const webhookEvent of entry.messaging) {
                    const senderPsid = webhookEvent.sender.id;

                    if (webhookEvent.message && webhookEvent.message.text) {
                        const userMessage = webhookEvent.message.text;
                        console.log(`Gelen Mesaj: ${userMessage}`);

                        try {
                            // Gemini'ye Gönderilecek Sistem Promptu
                            const prompt = `Sen GuGu Clinic için çalışan, yardımsever, nazik ve samimi bir Instagram müşteri temsilcisisin. Sorulara kısa, net ve Türkçe yanıtlar ver. Kullanıcı mesajı: ${userMessage}`;
                            
                            const result = await model.generateContent(prompt);
                            const aiResponse = result.response.text();

                            // Instagram'a Yanıt Gönder
                            await sendInstagramMessage(senderPsid, aiResponse);
                        } catch (error) {
                            console.error("Gemini/Instagram Hatası:", error);
                        }
                    }
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

async function sendInstagramMessage(senderPsid, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            {
                recipient: { id: senderPsid },
                message: { text: text }
            }
        );
        console.log("Yanıt Instagram'a gönderildi.");
    } catch (err) {
        console.error("Mesaj gönderme hatası:", err.response ? err.response.data : err.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor...`));
