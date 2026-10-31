const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `
Sen GuGu Clinic'de satış danışmanısın. İsmin Elsie. Samimi, sıcak, güven veren, satış odaklı ama abartısız konuşuyorsun. Kısa ve net yaz.

KAMPANYALAR (NAKİT):
- 5 BÖLGE BOTOX: 【entity-Allergan¦canonical_name=Allergan】 3800 TL (Juvederm'in botoxu, ilk çıkan marka), Dysport 4400 TL. İkisinde de parıltı ve canlılık veren kombine yüz mezoterapileri HEDİYE.
- DUDAK DOLGUSU: Russian Lips Elasty/Tuscan 3800 TL, Juvederm 5400 TL / 1cc
- SIVI YÜZ GERME FULL FACE: 6 ML PLLA Eldermafill + 5 bölge botox + Somon DNA + Paris ışıltısı = 21000 TL
- DİĞER DOLGULAR: Tüm çeşitler 3800 TL, Burun 5500 TL, Şakak 4500 TL, Barkod Skin Booster 3500 TL
- CaHA: Radiesse 19000 TL, Novuma 14000 TL

RANDEVU:
- İlk teklif: "Pazar günü saat 13:30 size uygun olur mu?"
- Olmazsa: Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 pazarlığı yap
- Diğer günler: "Diğer günler Alaçatı şubemizde müşterilerimizin ve hastanedeki hastalarımızın randevularıyla ilgileniyoruz"
- Teknik soru: "Detay için uzman doktorumuzu 0534 248 94 70'ten arayabilirsiniz" de
`;

// Önce Google'dan hangi modeller açık onu sor, sonra ilk uygun olanı kullan
async function getGeminiReply(userMessage) {
  try {
    if (!GEMINI_API_KEY) throw new Error("API_KEY yok");

    // 1. Google'dan açık model listesini al
    let availableModels = [];
    try {
      const listUrl = `https://generativelanguage.googleapis.com/v1/models?key=${GEMINI_API_KEY}`;
      const listRes = await 【entity-axios¦canonical_name=axios】.get(listUrl);
      availableModels = listRes.data.models
        .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
        .map(m => m.name.replace("models/", ""));
      console.log("📋 Açık modeller:", availableModels.slice(0,5).join(", "));
    } catch (e) {
      console.log("Model listesi alınamadı, hardcoded denenecek");
    }

    // 2. Denenecek sıra - önce listeden gelenler, sonra güncel bilinenler
    const tryList = [
      ...availableModels,
      "gemini-2.0-flash-001",
      "gemini-2.0-flash-lite-001",
      "gemini-1.5-flash-001",
      "gemini-1.5-flash-8b",
      "gemini-1.5-flash-002",
      "gemini-1.5-pro-001"
    ];

    for (const modelName of tryList) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
        const response = await axios.post(url, {
          contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\nMüşteri: ${userMessage}\nDanışman:` }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 600 }
        }, { headers: { 'Content-Type': 'application/json' } });

        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log(`✅ Gemini çalıştı: ${modelName} (REST v1)`);
          return text.slice(0, 900);
        }
      } catch (err) {
        const msg = err.response?.data?.error?.message?.slice(0,100) || err.message.slice(0,100);
        console.log(`❌ Model ${modelName} olmadı: ${msg}`);
        continue;
      }
    }
    throw new Error("Tüm modeller kapalı");

  } catch (err) {
    console.log("⚠️ Yedek satış mesajına düşüyor");
    const lower = userMessage.toLowerCase();
    if (lower.includes("botox") || lower.includes("botoks") || lower.includes("marka")) {
      return `Merhabalar, 5 bölge botox 【entity-Allergan¦canonical_name=Allergan】 3800 TL (Juvederm'in botoxu, ilk çıkan marka), Dysport 4400 TL nakit. İkisinde de mezoterapi hediye. Pazar günü saat 13:30 size uygun olur mu?`;
    }
    if (lower.includes("dudak") || lower.includes("russian")) return `Dudak dolgusu Russian Lips Elasty/Tuscan 3800 TL, Juvederm 5400 TL. Pazar 13:30 uyar mı?`;
    if (lower.includes("radie") || lower.includes("radiesse") || lower.includes("novuma")) return `Radiesse 19000 TL, Novuma 14000 TL nakit. Pazar 13:30 için randevu oluşturalım mı? Detay için 0534 248 94 70.`;
    return `Merhabalar, 5 bölge botox Allergan 3800 TL, Dysport 4400 TL nakit, her şey dahil mezoterapiler hediye. Pazar 13:30 size uygun olur mu? Olmazsa Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 bakabiliriz.`;
  }
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'instagram' || body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');
    for (const entry of body.entry) {
      const messagingEvent = entry.messaging ? entry.messaging[0] : null;
      if (messagingEvent?.message?.text) {
        if (messagingEvent.message.is_echo) { console.log('i Echo atlandi'); continue; }
        const senderId = messagingEvent.sender.id;
        const receivedMessage = messagingEvent.message.text;
        console.log(`💬 Gelen Mesaj [IGSID: ${senderId}]: ${receivedMessage}`);
        const replyText = await getGeminiReply(receivedMessage);
        await sendInstagramMessage(senderId, replyText);
      }
    }
  } else res.sendStatus(404);
});

async function sendInstagramMessage(recipientId, text) {
  try {
    const url = `https://graph.facebook.com/v20.0/${IG_ID}/messages`;
    const response = await 【entity-axios¦canonical_name=axios】.post(url, { recipient: { id: recipientId }, message: { text: text } }, { params: { access_token: PAGE_ACCESS_TOKEN }, headers: { 'Content-Type': 'application/json' } });
    console.log(`🚀 Gönderildi: "${text.slice(0,80)}..." | ID:`, response.data.message_id);
  } catch (error) {
    console.error('❌ Mesaj gönderme hatası:', error.response ? JSON.stringify(error.response.data) : error.message);
  }
}

app.get('/', (req, res) => res.send('Bot Aktif! GuGu Clinic'));
app.listen(PORT, () => console.log(`🚀 Sunucu ${PORT} portunda dinleniyor...`));
