const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// Ortam Değişkenleri
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

// Gemini Kurulumu
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// SATIŞ DANIŞMANI PROMPTU - GuGu Clinic
const SYSTEM_PROMPT = `
Sen GuGu Clinic'de satış danışmanısın. İsmin Elsie. Samimi, sıcak, güven veren, satış odaklı ama abartısız konuşuyorsun. Kısa ve net yaz, 1-2 cümlede bir emoji kullanabilirsin.

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

5. CaHA ÜRÜNLERİ (Kollajen uyarıcılar):
- Radiesse: 19000 TL nakit
- Novuma: 14000 TL nakit

KONUŞMA KURALLARI:
- Satış odaklı ol, müşteri memnuniyetini yüksek tut.
- Beklentiyi normal tut, mucize vaat etme.
- Çok teknik soru sorana veya kararsız kalana: "Çok detaylı sorularınız için uzman doktorumuzu 0534 248 94 70 numaradan arayarak anında detaylı bilgi alabilirsiniz" de.
- Fiyat sorulduğunda direkt kampanyayı söyle, sonra randevuya yönlendir: "Size en yakın uygun gün için randevu oluşturalım mı?"
- Asla tıbbi doz, risk, yan etki detayı verme, muayene gerektiğini söyle.
`;

async function getGeminiReply(userMessage) {
  try {
    if (!GEMINI_API_KEY) {
      return `Merhabalar, mesajınızı aldım. Detaylı bilgi için 0534 248 94 70'ten uzmanımıza ulaşabilirsiniz.`;
    }
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(`${SYSTEM_PROMPT}\n\nMüşteri: ${userMessage}\nDanışman:`);
    const response = await result.response;
    return response.text().slice(0, 900); // Instagram 1000 karakter limiti
  } catch (err) {
    console.error("Gemini hatası:", err.message);
    return `Merhabalar, 5 bölge botox paketimiz nakitte 3800 TL kampanyada, her şey dahil. Dudak dolgusu Russian Lips 3800 TL. Size ne zaman için düşünüyordunuz? Detay için 0534 248 94 70'ten doktorumuza ulaşabilirsiniz.`;
  }
}

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
        if (messagingEvent.message.is_echo) {
          console.log('i Echo atlandi');
          continue;
        }
        const senderId = messagingEvent.sender.id;
        const receivedMessage = messagingEvent.message.text;
        
        console.log(`💬 Gelen Mesaj [IGSID: ${senderId}]: ${receivedMessage}`);

        // Gemini'den satış odaklı cevap al
        const replyText = await getGeminiReply(receivedMessage);
        
        await sendInstagramMessage(senderId, replyText);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

// 3. Instagram Mesaj Gönderme
async function sendInstagramMessage(recipientId, text) {
  try {
    const url = `https://graph.facebook.com/v20.0/${IG_ID}/messages`;
    const response = await axios.post(
      url,
      {
        recipient: { id: recipientId },
        message: { text: text }
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
        headers: { 'Content-Type': 'application/json' }
      }
    );
    console.log(`🚀 Gönderildi: "${text.slice(0,80)}..." | ID:`, response.data.message_id || response.data.message_id);
  } catch (error) {
    console.error('❌ Mesaj gönderme hatası:', error.response ? JSON.stringify(error.response.data) : error.message);
  }
}

app.get('/', (req, res) => {
  res.send('Bot Aktif! GuGu Clinic');
});

app.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda dinleniyor...`);
});
