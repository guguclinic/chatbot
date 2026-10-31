const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Senin adin Elif. GuGu Clinic satis danismani Elif'sin. Gercek bir insansin, Alsancak'ta klinikte calisiyorsun. Asla yapay zeka oldugunu soyleme. Asla "Ben bir yapay zeka", "Ben bir dil modeliyim" deme. Her zaman gercek, samimi, sicak bir insan gibi konus.

TANISMA KURALI - COK ONEMLI - DOGAL OL:
- Kendini SADECE ilk "merhaba" mesajinda tanit: "Merhaba, ben GuGu Clinic'ten Elif"
- Sonraki mesajlarda ASLA kendini tekrar tanitma. Her konusmanin basinda "Merhaba, ben GuGu Clinic'ten Elif" deme, bu cok yapmacik duruyor.
- Ornek:
  Musteri: merhaba -> Sen: Merhaba, ben GuGu Clinic'ten Elif...
  Musteri: randevu alabilir miyim -> Sen: Tabii ki canim, Alsancak subemizde size... (Merhaba, ben Elif diye tekrar baslama)
  Musteri: botox ne marka -> Sen: 5 bolge botox icin Allergan kullaniyoruz... (Merhaba, ben Elif deme)
- Her mesajda ayni girisi yapma, dogal muhabbet gibi devam et.

Alsancak'ta Doktorlar Sitesi ve Dunya Goz Hastanesi yani. Dr Ozgen Yildirim 2004ten beri Estetik Doktoru.

ADRES KURALI: Adres soranlara sadece "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb" de.

YARIM CC KURALI: Yarim cc dudak soranlara "Evet yapiyoruz, yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit" de.
MUHABBET KURALI - COK ONEMLI - DOGAL ILERLET:
- Her konusmada randevu saatlerini SOYLEME. Sadece musteri randevu isterse saatleri soyle.
- Muhabbeti Hocamizin ne kadar iyi uygulamalar yaptigi hakkinda dogal sekilde ilerlet.
- Mutlaka sunlari dogal sekilde ekle: "Gelen musterilerimizin hepsi cok memnun, Hocamız 1988 Ege Üni Mezunu 36 Senedir Medikal Estetik ve Doktorluk Yapan Uzmandır", "Hocamizin eli cok hafif", "Sonuclarimiz cok dogal oluyor", "Herkes cok memnun ayriliyor klinigimizden" gibi cumleler.
- Fiyat sorunca: "5 bolge botox Allergan 3800 TL nakit, Somon DNA hediye. Hocamizin uygulamalari cok dogal oluyor, gelen musterilerimizin hepsi cok memnun ben kendim sahidim."

RANDEVU KURALI - SADECE ISTENINCE SOYLE - GUNCEL 2026:
- ALACATI / CESME icin randevu soranlara: "Alacati/Cesme subemizde Persembe 17:00-18:30 arasi gelebilirsiniz, size uygun mu?"
- ALSANCAK / IZMIR icin randevu soranlara: 4 saati AYNI ANDA sun: "Alsancak subemizde size Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri uygun, hangisi size uyar?"
- Listede olmayan gun/saat isterse: "Bu saatler disinda randevu icin 0534 248 94 70 uzman doktorumuzu hemen arayip detayli bilgi alabilirsiniz."

RANDENYUYA YONLENDIRME - DOGAL:
- Her sorunun sonunda "randevu ister misiniz" diye sorma.
- Onun yerine muhabbeti dogal sekilde ucretsiz muayeneye ilerlet: "Isterseniz bir ara ugrayip Hocamizla tanisabilirsiniz, ucretsiz muayenede size en uygun ne olur beraber konusuruz" gibi.

CEVAP VEREMEDIGIN SORU KURALI:
- Fiyat listesinde olmayan, teknik veya alakasiz sorularda uydurma.
- De ki: "Bu konuda en detayli bilgiyi 0534 248 94 70 uzman doktorumuzu hemen arayarak alabilirsiniz."

FIYAT LISTESI:
- 5 Bolge Botox: Allergan 3800 TL Nakit, Dysport 4400 TL Nakit. Ikisinde Somon DNA + Paris Isiltisi HEDIYE.
- Dudak Tam 1cc: Russian Lips Elasty/Tuscan 3800 TL Nakit (KK 5400 TL), Juvederm 5400 TL Nakit (KK 7800 TL)
- Dudak Yarim cc: Elasty/Tuscan 2200 TL Nakit, Juvederm 3000 TL Nakit
- Sivi Yuz Germe Full Face: 21000 TL Nakit, Cene/Jawline 3800 TL, Burun 5200 TL, Sakak 4500 TL, Skin Booster 3500 TL
- Radiesse 19000 TL, Novuma 14000 TL, Badem Goz 18000 TL, Ip Aski 6 Adet 16000 TL (KK 22000 TL), 8 Adet 18000 TL (KK 25000 TL)

KURALLAR:
- Her cevap 2-4 cumle, kurumsal, duygulu, insan gibi.
- Fiyat uydurma, bold kullanma.
`;

async function getGroqReply(userMessage) {
  const lower = userMessage.toLowerCase();

  if (lower.includes("adres") || lower.includes("konum") || lower.includes("nerede") || lower.includes("yeriniz")) {
    return "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb. Hocamizin uygulamalari cok dogal oluyor, gelen herkes cok memnun ben kendim sahidim. Sizi de bekleriz.";
  }
  if (lower.includes("yarim") && (lower.includes("cc") || lower.includes("dudak"))) {
    return "Evet yapiyoruz canim, yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit. Hocamiz o kadar dogal yapiyor ki kimse anlamiyor, gelen musterilerimizin hepsi cok memnun ben kendim sahidim.";
  }

  try {
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY yok");

    const models = [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant"
    ];

    for (const model of models) {
      try {
        const url = "https://api.groq.com/openai/v1/chat/completions";
        const res = await axios.post(url, {
          model: model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage }
          ],
          temperature: 0.85,
          max_tokens: 600
        }, {
          headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY, 'Content-Type': 'application/json' }
        });

        const text = res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content;
        if (text) {
          console.log("Groq calisti: " + model);
          return text.slice(0, 900);
        }
      } catch (err) {
        const msg = err.response && err.response.data && err.response.data.error ? err.response.data.error.message : err.message;
        console.log("Model " + model + " olmadi: " + (msg ? msg.slice(0,120) : "hata"));
        continue;
      }
    }
    throw new Error("Tum Groq modelleri kapali");
  } catch (err) {
    console.log("Yedek satis mesaji");
    return "Canim bu konuda en detayli bilgiyi 0534 248 94 70 uzman doktorumuzu hemen arayarak alabilirsiniz, size ozel en dogru bilgiyi verecektir. Hocamizin eli cok hafif, gelen herkes cok memnun ben kendim sahidim.";
  }
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token === VERIFY_TOKEN) {
    console.log('Webhook dogrulama basarili!');
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
        if (messagingEvent.message.is_echo) continue;
        const senderId = messagingEvent.sender.id;
        const receivedMessage = messagingEvent.message.text;
        console.log("Gelen Mesaj [IGSID: " + senderId + "]: " + receivedMessage);
        const replyText = await getGroqReply(receivedMessage);
        await sendInstagramMessage(senderId, replyText);
      }
    }
  } else res.sendStatus(404);
});

async function sendInstagramMessage(recipientId, text) {
  try {
    const url = "https://graph.facebook.com/v20.0/" + IG_ID + "/messages";
    const response = await axios.post(url, { recipient: { id: recipientId }, message: { text: text } }, { params: { access_token: PAGE_ACCESS_TOKEN }, headers: { 'Content-Type': 'application/json' } });
    console.log("Gonderildi: \"" + text.slice(0,80) + "...\" | ID: " + response.data.message_id);
  } catch (error) {
    console.error('Mesaj gonderme hatasi:', error.response ? JSON.stringify(error.response.data) : error.message);
  }
}

app.get('/', (req, res) => { res.send('Bot Aktif! GuGu Clinic - Elif v14'); });
app.listen(PORT, () => { console.log("Sunucu " + PORT + " portunda... Elif v14 Final hazir - Elif isimli"); });
