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
      const messagingEvent = entry.messaging ? entry.messaging[0] : null;

      if (messagingEvent && messagingEvent.message && messagingEvent.message.text) {
        const senderId = messagingEvent.sender.id;
        const receivedMessage = messagingEvent.message.text;

        console.log(`💬 Gelen Mesaj [${senderId}]: ${receivedMessage}`);

        // Otomatik Yanıt Metni
        const replyText = `Merhaba! Mesajınızı aldım: "${receivedMessage}"`;
        await sendInstagramMessage(senderId, replyText);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

// 3. Mesaj Gönderme Fonksiyonu (Universal Graph API Endpoint)
async function sendInstagramMessage(recipientId, text) {
  try {
    // me/messages endpoint'i doğrudan PAGE_ACCESS_TOKEN sahibinin bağlamında çalışır
    const url = `https://graph.facebook.com/v21.0/me/messages`;

    const response = await axios.post(
      url,
      {
        recipient: { id: recipientId },
        message: { text: text },
      },
      {
        headers: {
          'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
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
