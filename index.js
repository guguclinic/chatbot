const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Ortam Değişkenleri
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PORT = process.env.PORT || 10000;

// 1. Webhook Doğrulama (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log('✅ Webhook doğrulama başarılı!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 2. Webhook Olay Dinleyici (POST)
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'instagram' || body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of body.entry) {
      // Instagram Hesap ID'si (Örn: 17841441637097678)
      const instagramAccountId = entry.id;
      const messagingEvent = entry.messaging ? entry.messaging[0] : null;

      if (messagingEvent && messagingEvent.message && messagingEvent.message.text) {
        const senderId = messagingEvent.sender.id;
        const receivedMessage = messagingEvent.message.text;

        // Botun kendi gönderdiği mesajları atla
        if (senderId === instagramAccountId) continue;

        console.log(`💬 Gelen Mesaj [${senderId}]: ${receivedMessage}`);

        const replyText = `Merhaba! Mesajınızı aldım: "${receivedMessage}"`;
        
        // Yanıtı Instagram ID'si üzerinden gönder
        await sendInstagramMessage(instagramAccountId, senderId, replyText);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

// 3. Instagram Graph API Mesaj Gönderme
async function sendInstagramMessage(instagramAccountId, recipientId, text) {
  try {
    // /me/ yerine dinamik instagramAccountId kullanıyoruz
    const url = `https://graph.facebook.com/v21.0/${instagramAccountId}/messages`;

    const response = await axios.post(
      url,
      {
        recipient: { id: recipientId },
        message: { text: text },
      },
      {
        params: {
          access_token: PAGE_ACCESS_TOKEN
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`🚀 Yanıt başarıyla gönderildi: "${text}" | Message ID:`, response.data.message_id || response.data.recipient_id);
  } catch (error) {
    console.error('❌ Mesaj gönderme hatası:', error.response ? error.response.data : error.message);
  }
}

app.get('/', (req, res) => res.send('Bot Aktif!'));

app.listen(PORT, () => console.log(`🚀 Sunucu ${PORT} portunda dinleniyor...`));
