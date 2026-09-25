const express = require('express');
const axios = require('axios');
const app = express();

// Meta Webhook gelen JSON verisini okumak için zorunlu middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ortam değişkenlerinden yapılandırmaları alıyoruz
const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// 1. Kök Dizin Kontrolü (Render Health Check)
app.get('/', (req, res) => {
    res.send('Chatbot servisi aktif ve çalışıyor!');
});

// 2. Meta Webhook Doğrulama (GET /webhook)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('✅ Webhook başarıyla doğrulandı!');
            return res.status(200).send(challenge);
        } else {
            console.error('❌ Doğrulama başarısız! Verify token eşleşmedi.');
            return res.sendStatus(403);
        }
    }
    return res.sendStatus(400);
});

// 3. Mesaj Yakalama ve Yanıtlama (POST /webhook)
app.post('/webhook', async (req, res) => {
    // Meta'ya isteğin ulaştığını anında bildiriyoruz (ZORUNLU - Aksi halde Meta bağlantıyı koparır)
    res.status(200).send('EVENT_RECEIVED');

    console.log("====================================");
    console.log("📩 META'DAN GELEN HAM İSTEK:");
    console.log(JSON.stringify(req.body, null, 2));
    console.log("====================================");

    const body = req.body;

    // Instagram mesaj nesnesi kontrolü
    if (body.object === 'instagram') {
        body.entry?.forEach(async (entry) => {
            const webhook_event = entry.messaging?.[0];

            if (webhook_event && webhook_event.message) {
                const senderPsid = webhook_event.sender.id;
                const messageText = webhook_event.message.text;

                console.log(`💬 Gelen Mesaj [${senderPsid}]: ${messageText}`);

                // Kendi attığı mesajları/eko yanıtları yoksay
                if (webhook_event.message.is_echo) {
                    console.log("İleti botun kendi mesajı, işlem yapılmadı.");
                    return;
                }

                // Basit Test Cevabı (Burayı daha sonra Gemini API ile bağlayabilirsiniz)
                if (messageText) {
                    await sendTextMessage(senderPsid, `Merhaba! Mesajınızı aldım: "${messageText}"`);
                }
            }
        });
    }
});

// Instagram Send API Üzerinden Mesaj Gönderme Fonksiyonu
async function sendTextMessage(senderPsid, text) {
    try {
        const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
        
        const requestBody = {
            recipient: { id: senderPsid },
            message: { text: text }
        };

        await axios.post(url, requestBody);
        console.log(`🚀 Yanıt başarıyla gönderildi: "${text}"`);
    } catch (error) {
        console.error('❌ Mesaj gönderme hatası:', error.response ? error.response.data : error.message);
    }
}

// Sunucuyu Başlatma
app.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda aktif ve dinleniyor...`);
});
