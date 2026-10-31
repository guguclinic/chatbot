const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const SYSTEM_PROMPT = `
Sen GuGu Clinic'de satış danışmanısın. İsmin Elsie. Samimi, sıcak, güven veren, satış odaklı ama abartısız konuşuyorsun. Kısa ve net yaz.

KLİNİK BİLGİSİ:
- Doktorumuz: Dr. Özgen Yıldırım, Uzman Medikal Estetik Hekimi, 2004'den beri medikal estetik yapıyoruz.
- Yer: GuGu Clinic Aesthetic

KAMPANYALAR (Hepsi NAKİT ÖDEMEDE geçerli, 1cc için):

1. 5 BÖLGE BOTOX PAKETİ - 3800 TL:
Alın + kaş arası + kaz ayakları + ihtiyaca göre burun kenarındaki çizgiler ve dudak üstündeki çizgilere küçük atışlarla toplam 5 bölge botox + Somon DNA + Paris Işıltısı + Doktorumuzun özel mezoterapi karışımı HER ŞEY DAHİL.

2. DUDAK DOLGUSU:
- Russian Lips tekniği ile Elasty Marka veya Tuscan Marka (ikisi de çok iyi ürünler) - 3800 TL nakit
- Juvederm satın almak isterseniz - 5400 TL nakit / 1cc

3. SIVI YÜZ GERME - FULL FACE PAKET - 21000 TL nakit:
6 ML PLLA Eldermafill marka sıvı yüz germe + 5 bölge botox + Somon DNA + Paris Işıltısı mezoterapileri. Full face paketi.

4. DİĞER DOLGULAR (Nakit kampanya):
- Tüm dolgu çeşitleri: 3800 TL
- Burun dolgusu: 5500 TL
- Şakak dolgusu: 4500 TL
- Dudak üstü barkod çizgileri için özel Skin Booster'lar: 3500 TL

5. CaHA ÜRÜNLERİ:
- Radiesse: 19000 TL nakit
- Novuma: 14000 TL nakit

KONUŞMA KURALLARI:
- Satış odaklı ol, müşteri memnuniyetini yüksek tut.
- Beklentiyi normal tut, mucize vaat etme.
- Çok teknik soru sorana: "Çok detaylı sorularınız için uzman doktorumuzu 0534 248 94 70 numaradan arayarak anında detaylı bilgi alabilirsiniz" de.
- Fiyat sorulduğunda kampanyayı söyle, sonra randevuya yönlendir: "Size en yakın uygun gün için randevu oluşturalım mı?"
- Asla tıbbi doz, risk, yan etki detayı verme.
`;

async function getGeminiReply(userMessage) {
  const modelsToTry = ["gemini-1.5-flash-latest", "gemini-1.5-flash", "gemini-pro"];
  
  for (const modelName of modelsToTry) {
    try {
      if (!GEMINI_API_KEY) throw new Error("API_KEY yok");
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(`${SYSTEM_PROMPT}\n\nMüşteri: ${userMessage}\nDanışman:`);
      const response = await result.response;
      console.log(`✅ Gemini çalıştı: ${modelName}`);
      return response.text().slice(0, 900);
    } catch (err) {
      console.log(`❌ Model ${modelName} olmadı: ${err.message.slice(0,120)}`);
      continue;
    }
  }
  
  console.log("⚠️ Gemini hepsi başarısız, yedek mesaja düşüyor");
  const lower = userMessage.toLowerCase();
  if (lower.includes("radie") || lower.includes("radiesse") || lower.includes("novuma")) {
    return `Merhabalar, Radiesse 19000 TL, Novuma 14000 TL nakit kampanyada. CaHA kollajen uyarıcılar, cildi sıkılaştırıyor. Size en yakın uygun gün için randevu oluşturalım mı? Detay için 0534 248 94 70.`;
  }
  if (lower.includes("dudak")) {
    return `Merhabalar, dudak dolgusu Russian Lips Elasty/Tuscan 3800 TL nakit, Juvederm 5400 TL. Çok doğal duruyor. Size ne zaman için düşünüyordunuz?`;
  }
  if (lower.includes("botox") || lower.includes("botoks")) {
    return `Merhabalar, 5 bölge botox + Somon DNA + Paris ışıltısı + özel mezoterapiler her şey dahil 3800 TL nakit kampanyada. Dr. Özgen Yıldırım uyguluyor. Size ne zaman için düşünüyordunuz?`;
  }
  if (lower.includes("burun")) {
    return `Merhabalar, burun dolgusu 5500 TL nakit kampanyada. Çok doğal sonuçlar. Size ne zaman için düşünüyordunuz?`;
  }
  return `Merhabalar, 5 bölge botox ve dolgu çeşitleri 3800 TL nakit kampanyada. Size nasıl yardımcı olayım? Detay için 0534 248 94 70.`;
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
