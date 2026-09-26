const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678"; // <-- Render'a ekledin
const PORT = process.env.PORT || 10000;

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

app.post('/webhook', async (req, res) => {
  const body = req.body;
  console.log("📦 WEBHOOK GELDİ:", JSON.stringify(body).slice(0,500));

  if (body.object === 'instagram' || body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of body.entry) {
      const messagingEvent = entry.messaging ? entry.messaging[0] : null;
      if (messagingEvent && messagingEvent.message && messagingEvent.message.text) {
        if (messagingEvent.message.is_echo) {
          console.log('ℹ Echo atlandı');
          continue;
        }
        const senderId = messagingEvent.sender.id;
        const receivedMessage = messagingEvent.message.text;

        console.log(`💬 Gelen Mesaj [IGSID: ${senderId}]: ${receivedMessage}`);

        const replyText = `Merhaba! Mesajınızı aldım: "${receivedMessage}"`;
        await sendInstagramMessage(senderId, replyText);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

async function sendInstagramMessage(recipientId, text) {
  try {
    // HER ZAMAN IG_ID kullan, entry.id kullanma
    const url = `https://graph.facebook.com/v20.0/${IG_ID}/messages`;

    const response = await axios.post(
      url,
      {
        recipient: { id: recipientId },
        message: { text: text },
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
        headers: { 'Content-Type': 'application/json' }
      }
    );
    console.log(`🚀 Gönderildi: "${text}" | ID:`,
