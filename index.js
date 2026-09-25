const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Ortam Değişkenleri (Render Environment Variables)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PORT = process.env.PORT || 10000;

// 1. Webhook Doğrulama (GET) - Meta Paneli ile Bağlantı
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

// 2. Canlı Mesaj Olayları (POST) - Gelen DM'leri Dinleme
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'instagram' || body.object === 'page') {
    // Meta'ya isteği aldığımızı bildirmek için anında 200 OK dönüyoruz
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of body.entry) {
      const messagingEvent = entry.messaging ? entry.messaging[0] : null;

      if (messagingEvent && messagingEvent.message && messagingEvent.message.text) {
        const senderId = messagingEvent.sender.id;
        const receivedMessage = messagingEvent.message.text;

        console.log(`💬 Gelen Mesaj [${senderId}]: ${receivedMessage}`);

        // Otomatik Yanıt Metni
        const replyText = `Merhaba! Mesajınızı aldım: "${receivedMessage}"`;

        // Yanıt Gönder
        await sendInstagramMessage(senderId, replyText);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

// 3. Instagram / Messenger Graph API Yanıt Gönderme Fonksiyonu
async function sendInstagramMessage(recipientId, text) {
  try {
    // /me/messages adresi, PAGE_ACCESS_TOKEN bağlamında doğrudan mesajı iletir
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

// Sağlık Kontrolü Endpoint'i
app.get('/', (req, res) => res.send('Instagram Chatbot Webhook Servisi Aktif!'));

// Sunucuyu Başlat
app.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda dinleniyor...`);
});
