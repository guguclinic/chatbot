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

KLİNİK BİLGİSİ:
- Doktorumuz: Dr. Özgen Yıldırım, Uzman Medikal Estetik Hekimi, 2004'den beri medikal estetik yapıyoruz.
- Yer: GuGu Clinic Aesthetic

KAMPANYALAR (Hepsi NAKİT ÖDEMEDE geçerli, 1cc için):

1. 5 BÖLGE BOTOX PAKETİ:
- 3800 TL: 【entity-Allergan¦canonical_name=Allergan】 marka, ilk çıkan botox markası, Juvederm'in botoxudur. Yanında parıltı ve canlılık veren kombine yüz mezoterapilerimiz HEDİYE.
- 4400 TL: Dysport markası. Yanında parıltı ve canlılık veren kombine yüz mezoterapilerimiz HEDİYE.

2. DUDAK DOLGUSU:
- Russian Lips Elasty/Tuscan 3800 TL nakit
- Juvederm 5400 TL nakit / 1cc

3. SIVI YÜZ GERME - FULL FACE 21000 TL nakit: 6 ML PLLA Eldermafill + 5 bölge botox + Somon DNA + Paris ışıltısı

4. DİĞER DOLGULAR: Tüm dolgu çeşitleri 3800 TL, Burun 5500 TL, Şakak 4500 TL, Barkod çizgileri Skin Booster 3500 TL

5. CaHA: Radiesse 19000 TL, Novuma 14000 TL

RANDEVU SAATLERİ:
- İlk teklif: "Pazar günü saat 13:30 size uygun olur mu?"
- Uygun değilse: Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 arası pazarlık yap
- Diğer günler: "Diğer günler Alaçatı şubemizde müşterilerimizin ve hastanedeki hastalarımızın randevularıyla ilgileniyoruz"
- Çok teknik soru: "Çok detaylı sorularınız için uzman doktorumuzu 0534 248 94 70 numaradan arayarak anında detaylı bilgi alabilirsiniz" de
`;

// REST API ile Gemini - v1, AQ key uyumlu
async function getGeminiReply(userMessage) {
  const modelsToTry = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-pro"];
  
  for (const modelName of modelsToTry) {
    try {
      if (!GEMINI_API_KEY) throw new Error("API_KEY yok");
      
      const url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(url, {
        contents: [{
          role: "user",
          parts: [{ text: `${SYSTEM_PROMPT}\n\nMüşteri: ${userMessage}\nDanışman:` }]
        }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 600
        }
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        console.log(`✅ Gemini çalıştı: ${modelName} (REST v1)`);
        return text.slice(0, 900);
      }
      throw new Error("Boş cevap");
      
    } catch (err) {
      const msg = err.response ? JSON.stringify(err.response.data).slice(0,120) : err.message.slice(0,120);
      console.log(`❌ Model ${modelName} olmadı: ${msg}`);
      continue;
    }
  }
  
  console.log("⚠️ Yedek satış mesajına düşüyor");
  const lower = userMessage.toLowerCase();
  if (lower.includes("botox") || lower.includes("botoks") || lower.includes("marka")) {
    return `Merhabalar, 5 bölge botox Allergan 3800 TL (Juvederm'in botoxu, ilk çıkan marka), Dysport 4400 TL nakit. İkisinde de mezoterapi hediye. Pazar günü saat 13:30 size uygun olur mu?`;
  }
  if (lower.includes("dudak")) return `Dudak dolgusu Russian Lips Elasty/Tuscan 3800 TL, Juvederm 5400 TL. Pazar 13:30 uyar mı?`;
  if (lower.includes("radie") || lower.includes("radiesse")) return `Radiesse 19000 TL, Novuma 14000 TL nakit. Pazar 13:30 için randevu oluşturalım mı? Detay için 0534 248 94 70.`;
  return `Merhabalar, 5 bölge botox Allergan 3800 TL, Dysport 4400 TL nakit, her şey dahil mezoterapiler hediye. Pazar 13:30 size uygun olur mu? Olmazsa Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 bakabiliriz.`;
}

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
  if (body.object === 'instagram' || body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');
    for (const entry of body.entry) {
      const messagingEvent = entry.messaging ? entry.messaging[0] : null;
      if (messagingEvent && messagingEvent.message && messagingEvent.message.text) {
        if (messagingEvent.message.is_echo) {
          console.log('i Echo atlandi');
          continue;
        }
        const senderId = messagingEvent.sender.id;
        const receivedMessage = messagingEvent.message.text;
        console.log(`💬 Gelen Mesaj [IGSID: ${senderId}]: ${receivedMessage}`);
        const replyText = await getGeminiReply(receivedMessage);
        await sendInstagramMessage(senderId, replyText);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

async function sendInstagramMessage(recipientId, text) {
  try {
    const url = `https://graph.facebook.com/v20.0/${IG_ID}/messages`;
    const response = await axios.post(
      url,
      { recipient: { id: recipientId }, message: { text: text } },
      { params: { access_token: PAGE_ACCESS_TOKEN }, headers: { 'Content-Type': 'application/json' } }
    );
    console.log(`🚀 Gönderildi: "${text.slice(0,80)}..." | ID:`, response.data.message_id);
  } catch (error) {
    console.error('❌ Mesaj gönderme hatası:', error.response ? JSON.stringify(error.response.data) : error.message);
  }
}

app.get('/', (req, res) => res.send('Bot Aktif! GuGu Clinic'));
app.listen(PORT, () => console.log(`🚀 Sunucu ${PORT} portunda dinleniyor...`));
