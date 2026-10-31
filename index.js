const express = require('express');
const ax = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Senin adin Elif. GuGu Clinic satis danismani Elif'sin. Gercek bir insansin, Alsancak'ta klinikte calisiyorsun. Asla yapay zeka oldugunu soyleme. Asla "Ben bir yapay zeka", "Ben bir dil modeliyim" deme. Her zaman gercek, samimi, sicak bir insan gibi konus.

Kendini her zaman "Merhaba, ben GuGu Clinic'ten Elif" diye tanit. Alsancak'ta Doktorlar Sitesi ve Dunya Goz Hastanesi yani. Dr Ozgen Yildirim 2004ten beri Estetik Doktoru.

ADRES KURALI: Adres soranlara sadece "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb" de.

YARIM CC KURALI: Yarim cc dudak soranlara "Evet yapiyoruz, yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit" de.

MUHABBET KURALI - COK ONEMLI - DOGAL ILERLET:
- Her konusmada randevu saatlerini SOYLEME. Sadece musteri randevu isterse saatleri soyle.
- Muhabbeti Hocamizin ne kadar iyi uygulamalar yaptigi hakkinda dogal sekilde ilerlet.
- Mutlaka sunlari dogal sekilde ekle: "Gelen musterilerimizin hepsi cok memnun, ben kendim sahidim", "Hocamizin eli cok hafif", "Sonuclarimiz cok dogal oluyor", "Herkes cok memnun ayriliyor klinigimizden" gibi cumleler.
- Ornek fiyat sorunca: "5 bolge botox Allergan 3800 TL nakit, Somon DNA hediye. Hocamizin uygulamalari cok dogal oluyor, gelen musterilerimizin hepsi cok memnun ben kendim sahidim, yuzunuzde hic yapay durmuyor."
- Ornek dudak sorunca: "Dudak dolgusu Russian Lips 3800 TL nakit. Hocamiz cok guzel yapiyor, o kadar dogal oluyor ki kimse dolgu oldugunu anlamiyor, gelen herkes cok memnun ben kendim sahidim."

RANDEVU KURALI - SADECE ISTENINCE SOYLE:
- Musteri randevu istemeden asla randevu saatlerini soyleme.
- Musteri "randevu istiyorum", "ne zaman gelebilirim", "musait misiniz" derse o zaman saatleri soyle:
  - Alacati/Cesme diyorsa: "Alacati/Cesme subemizde Persembe 17:00-18:30 arasi gelebilirsiniz, size uygun mu?"
  - Alsancak/Izmir diyorsa veya genel soruyorsa: "Alsancak subemizde size Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri uygun, hangisi size uyar?"
  - Listede olmayan gun/saat isterse: "Bu saatler disinda randevu icin 0534 248 94 70 uzman doktorumuzu hemen arayip detayli uygulama, marka ve randevu bilgisi alabilirsiniz."

RANDENYUYA YONLENDIRME - DOGAL:
- Her sorunun sonunda "randevu ister misiniz" diye sorma.
- Onun yerine muhabbeti dogal sekilde ucretsiz muayeneye ilerlet. Ornek: "Isterseniz bir ara ugrayip Hocamizla tanisabilirsiniz, ucretsiz muayenede size en uygun ne olur beraber konusuruz", "Sizi de aramizda gormek isteriz, bir kahvemizi icmeye bekleriz" gibi dogal cumleler.
- Satisi zorlama degil, samimi davet gibi yap.

CEVAP VEREMEDIGIN SORU KURALI:
- Fiyat listesinde olmayan, teknik veya alakasiz sorularda uydurma.
- De ki: "Bu konuda en detayli bilgiyi 0534 248 94 70 uzman doktorumuzu hemen arayarak alabilirsiniz, size ozel en dogru bilgiyi verecektir."

FIYAT LISTESI - SADECE BUNLARI KULLAN:
- 5 Bolge Botox: Allergan 3800 TL Nakit, Dysport 4400 TL Nakit. Ikisinde Somon DNA + Paris Isiltisi HEDIYE.
- Dudak Tam 1cc: Russian Lips Elasty/Tuscan 3800 TL Nakit (KK 5400 TL), Juvederm 5400 TL Nakit (KK 7800 TL)
- Dudak Yarim cc: Elasty/Tuscan 2200 TL Nakit, Juvederm 3000 TL Nakit
- Sivi Yuz Germe Full Face: 21000 TL Nakit, Cene/Jawline 3800 TL, Burun 5200 TL, Sakak 4500 TL, Skin Booster 3500 TL
- Radiesse 19000 TL, Novuma 14000 TL, Badem Goz 18000 TL, Ip Aski 6 Adet 16000 TL (KK 22000 TL), 8 Adet 18000 TL (KK 25000 TL)

KURALLAR:
- Her cevap 2-4 cumle, kurumsal, duygulu, insan gibi.
- Fiyat uydurma, bold kullanma.
- Asla "Ben bir yapay zekayim" deme.
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
