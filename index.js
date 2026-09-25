const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Ortam Değişkenleri (Render Environment Variables)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PORT = process.env.PORT || 10000;

// 1. Webhook Doğrulama (GET) - Meta Paneli İle İletişim
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook doğrulama başarılı!');
      return res.status(200).send(challenge);
    } else {
      console.error('❌ Webhook doğrulama başarısız: Token eşleşmedi.');
      return res.sendStatus(403);
    }
  }
  return res.sendStatus(400);
});

// 2. Canlı Mesaj Olayları (POST) - Gelen DM'leri Dinleme
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'instagram' || body.object === 'page') {
    // Meta'ya isteği aldığımızı bildirmek için anında 200 OK dönüyoruz
    res.status(200).send('EVENT_RECEIVED');

    // Gelen veri paketlerini işle
    for (const entry of body.entry) {
      const instagramAccountId = entry.id; // Örn: 17841441637097678
      const webhookEvent = entry.messaging ? entry.messaging[0] : null;

      if (webhookEvent) {
        const senderId = webhookEvent.sender ? webhookEvent.sender.id : null;

        // Sayfanın/Botun kendi kendine attığı mesajları yoksay
        if (senderId === instagramAccountId) continue;

        // Kullanıcıdan gelen metin mesajı
        if (webhookEvent.message && webhookEvent.message.text) {
          const receivedMessage = webhookEvent.message.text;
          console.log(`💬 Gelen Mesaj [${senderId}]: ${receivedMessage}`);

          // Otomatik Yanıt Gönder
          const replyText = `Merhaba! Mesajınızı aldım: "${receivedMessage}"`;
          await sendInstagramMessage(instagramAccountId, senderId, replyText);
        }
      }
    }
  } else {
    res.sendStatus(404);
  }
});

// 3. Instagram Graph API Üzerinden Yanıt Gönderme Fonksiyonu
async function sendInstagramMessage(instagramAccountId, recipientId, text) {
  try {
    // 'me' yerine dinamik instagramAccountId kullanılıyor (Graph API v21.0)
    const url = `https://graph.facebook.com/v21.0/${instagramAccountId}/messages`;

    const response = await axios.post(
      url,
      {
        recipient: { id: recipientId },
        message: { text: text },
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
        headers: { 'Content-Type': 'application/json' },
      }
    );

    console.log(`🚀 Yanıt başarıyla gönderildi: "${text}" | Mesaj ID:`, response.data.message_id);
  } catch (error) {
    console.error('❌ Mesaj gönderme hatası:', error.response ? error.response.data : error.message);
  }
}

// Sağlık Kontrolü Endpoint'i
app.get('/', (req, res) => {
  res.send('Instagram Chatbot Webhook Servisi Çalışıyor!');
});

// Sunucuyu Başlat
app.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda aktif ve dinleniyor...`);
});
