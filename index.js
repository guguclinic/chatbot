const express = require('express');
const ax = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Sen GuGu Clinic satis danismani Elif'sin. Ismin Elif. Klinigimiz Alsancak'ta. Dr Ozgen Yildirim 2004ten beri Estetik Doktoru.

ADRES KURALI:
Adres soranlara SADECE: "Klinigimiz Dunya Goz Hastanesi'nin yanında" + link: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb
Baska adres uydurma.

YARIM CC DUDAK DOLGUSU KURALI - COK ONEMLI:
"Yarim cc yapiyor musunuz?" veya "0.5 cc dudak dolgusu var mi?" diye soranlara SADECE sunu de:
"Evet yapiyoruz, yarim cc dudak dolgusu Elasty/Tuscan markalari nakit odemede 2200 TL, Juvederm markasi yarim cc 3000 TL nakit odemede."
Baska fiyat uydurma, tam cc fiyatina gecme.

KURALLAR:
1. Asla "Benim paketim" deme, "Doktorumuzun kampanyasi" de.
2. Fiyat uydurma, sadece asagidaki listeden ver.
3. Her cevap 2-4 cumle, kisa, net, duygulu ama kurumsal olsun.
4. Her cevabin sonunda soru sor ve ucretsiz muayene randevusuna davet et.
5. Bold ** kullanma, duz yazi yaz.

FIYAT LISTESI:
- 5 Bolge Botox: Allergan 3800 TL Nakit, Dysport 4400 TL Nakit. Ikisinde Somon DNA + Paris Isiltisi HEDIYE.
- Dudak Dolgusu Tam 1cc: Russian Lips Elasty/Tuscan 3800 TL Nakit (KK 5400 TL), Juvederm 5400 TL Nakit (KK 7800 TL)
- Dudak Dolgusu Yarim cc: Elasty/Tuscan 2200 TL Nakit, Juvederm 3000 TL Nakit - Evet yapiyoruz
- Sivi Yuz Germe Full Face: 6ML PLLA Eldermafill + 5 Bolge Botox + Somon DNA + Paris Isiltisi 21000 TL Nakit
- Cene Dolgusu, Jawline 3800 TL / 1 ML Nakit, Burun 5200 TL Nakit, Sakak 4500 TL Nakit, Barkod Skin Booster 3500 TL
- Radiesse 19000 TL Nakit, Novuma 14000 TL Nakit
- Badem Goz Iplerle 18000 TL Nakit
- Ip Aski: 6 Adet 4D Ip + 2 ML Sivi Yuz Germe 16000 TL Nakit (KK 22000 TL), 8 Adet Ip + 2 ML 18000 TL Nakit (KK 25000 TL)

RANDEVU:
Ilk teklif: "Pazar gunu saat 13:30 size uygun olur mu? Ucretsiz muayene icin ayirdim."
Olmazsa: "Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 hangisi uygun olur?"
Diger gunler: "Diger gunler Alacati subemizdeyiz"
Teknik soru: "Detay icin 0534 248 94 70'den bizi arayabilir misiniz?"

ORNEKLER:
Musteri: adresiniz neresi tam
Sen: Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum linkimiz: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb Size Pazar 13:30 ucretsiz muayene icin uygun olur mu?

Musteri: yarim cc dudak dolgusu yapiyor musunuz
Sen: Evet yapiyoruz, yarim cc dudak dolgusu Elasty/Tuscan markalari nakit odemede 2200 TL, Juvederm markasi yarim cc 3000 TL nakit odemede. Size Pazar 13:30 ucretsiz muayene icin uygun olur mu?
`;

async function getGeminiReply(userMessage) {
  try {
    if (!GEMINI_API_KEY) throw new Error("API_KEY yok");

    let availableModels = [];
    try {
      const listUrl = "https://generativelanguage.googleapis.com/v1/models?key=" + GEMINI_API_KEY;
      const listRes = await ax.get(listUrl);
      availableModels = listRes.data.models
        .filter(function(m) { return m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"); })
        .map(function(m) { return m.name.replace("models/", ""); });
      console.log("Acik modeller:", availableModels.slice(0,5).join(", "));
    } catch (e) {
      console.log("Model listesi alinamadi, hardcoded denenecek");
    }

    const tryList = [].concat(availableModels, [
      "gemini-2.0-flash-001",
      "gemini-2.0-flash-lite-001",
      "gemini-1.5-flash-001",
      "gemini-1.5-flash-8b",
      "gemini-1.5-flash-002",
      "gemini-1.5-pro-001"
    ]);

    for (let i = 0; i < tryList.length; i++) {
      const modelName = tryList[i];
      try {
        const url = "https://generativelanguage.googleapis.com/v1/models/" + modelName + ":generateContent?key=" + GEMINI_API_KEY;
        const response = await ax.post(url, {
          contents: [{ role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\nMusteri: " + userMessage + "\nDanisman:" }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 600 }
        }, { headers: { 'Content-Type': 'application/json' } });

        const cand = response.data && response.data.candidates && response.data.candidates[0];
        const text = cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text;
        if (text) {
          console.log("Gemini calisti: " + modelName + " (REST v1)");
          return text.slice(0, 900);
        }
      } catch (err) {
        const msg = err.response && err.response.data && err.response.data.error ? err.response.data.error.message : err.message;
        console.log("Model " + modelName + " olmadi: " + (msg ? msg.slice(0,100) : "hata"));
        continue;
      }
    }
    throw new Error("Tum modeller kapali");
  } catch (err) {
    console.log("Yedek satis mesajina dusuyor");
    const lower = userMessage.toLowerCase();
    if (lower.includes("botox") || lower.includes("botoks") || lower.includes("marka")) {
      return "Merhabalar, 5 bolge botox Allergan 3800 TL (Juvederm'in botoxu, ilk cikan marka), Dysport 4400 TL nakit. Ikisinde de mezoterapi hediye. Pazar gunu saat 13:30 size uygun olur mu?";
    }
    if (lower.includes("dudak") || lower.includes("russian")) return "Dudak dolgusu Russian Lips Elasty/Tuscan 3800 TL, Juvederm 5400 TL. Pazar 13:30 uyar mi?";
    if (lower.includes("radie") || lower.includes("radiesse") || lower.includes("novuma")) return "Radiesse 19000 TL, Novuma 14000 TL nakit. Pazar 13:30 icin randevu olusturalim mi? Detay icin 0534 248 94 70.";
    return "Merhabalar, 5 bolge botox Allergan 3800 TL, Dysport 4400 TL nakit, her sey dahil mezoterapiler hediye. Pazar 13:30 size uygun olur mu? Olmazsa Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 bakabiliriz.";
  }
}

app.get('/webhook', function(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token === VERIFY_TOKEN) {
    console.log('Webhook dogrulama basarili!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', async function(req, res) {
  const body = req.body;
  if (body.object === 'instagram' || body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');
    for (let j = 0; j < body.entry.length; j++) {
      const entry = body.entry[j];
      const messagingEvent = entry.messaging ? entry.messaging[0] : null;
      if (messagingEvent && messagingEvent.message && messagingEvent.message.text) {
        if (messagingEvent.message.is_echo) { console.log('i Echo atlandi'); continue; }
        const senderId = messagingEvent.sender.id;
        const receivedMessage = messagingEvent.message.text;
        console.log("Gelen Mesaj [IGSID: " + senderId + "]: " + receivedMessage);
        const replyText = await getGeminiReply(receivedMessage);
        await sendInstagramMessage(senderId, replyText);
      }
    }
  } else res.sendStatus(404);
});

async function sendInstagramMessage(recipientId, text) {
  try {
    const url = "https://graph.facebook.com/v20.0/" + IG_ID + "/messages";
    const response = await ax.post(url, { recipient: { id: recipientId }, message: { text: text } }, { params: { access_token: PAGE_ACCESS_TOKEN }, headers: { 'Content-Type': 'application/json' } });
    console.log("Gonderildi: \"" + text.slice(0,80) + "...\" | ID: " + response.data.message_id);
  } catch (error) {
    console.error('Mesaj gonderme hatasi:', error.response ? JSON.stringify(error.response.data) : error.message);
  }
}

app.get('/', function(req, res) { res.send('Bot Aktif! GuGu Clinic'); });
app.listen(PORT, function() { console.log("Sunucu " + PORT + " portunda dinleniyor..."); });
