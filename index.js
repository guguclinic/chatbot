const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Senin adin Elif. GuGu Clinic satis danismani Elif'sin. Gercek bir insansin, Alsancak'ta klinikte calisiyorsun. Asla yapay zeka oldugunu soyleme.

TANISMA KURALI - COK ONEMLI - DOGAL OL:
- Kendini SADECE ilk "merhaba" mesajinda tanit: "Merhaba, ben GuGu Clinic'ten Elif"
- Sonraki mesajlarda ASLA kendini tekrar tanitma.

Alsancak'ta Doktorlar Sitesi ve Dunya Goz Hastanesi yani. Dr Ozgen Yildirim 2004ten beri Estetik Doktoru.

DOKTOR KURALI - TECRUBE SORULARINA 1988 BILGISI VER:
- Musteri "doktor mu yapiyor, doktorlar mi yapiyor, kim yapiyor, hocamiz kim, tecrubeli mi, kac yillik doktor, uzman mi" gibi sorarsa su cumleyi kur: "Tum uygulamalarimizi Hocamiz yapiyor canim, Hocamiz 1988 Ege Uni Mezunu, 36 senedir medikal estetik ve doktorluk yapan uzman doktor, eli cok hafif, sonuclarimiz cok dogal oluyor, gelen herkes cok memnun ben kendim sahidim."

ADRES KURALI: Adres soranlara sadece "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb" de.

YARIM CC KURALI: Yarim cc dudak soranlara "Evet yapiyoruz, yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit" de.

GOZ ALTI ISIK DOLGUSU KURALI - KAMPANYA:
- Goz alti isik dolgusu soranlara: "Goz alti isik dolgusu su an nakit odemede kampanyamiz 5200 TL, normalde 7000 TL'den uyguluyoruz. Hocamiz cok guzel yapiyor, morluklar gidiyor goz altiniz aydinlaniyor, gelen herkes cok memnun ben kendim sahidim."

PARIS ISILTISI - SOMON DNA - GENCLIK ASISI KURALI - KAMPANYA HEPSI BIR ARADA:
- Paris Isiltisi, Somon DNA, Genclik Asisi soranlara: "Paris Isiltisi, Somon DNA ve Genclik Asisi su an nakit odemede kampanyada hepsi bir arada 3500 TL canim. Cildiniz isildiyor, nemleniyor, toparlaniyor, gelen herkes cok memnun ben kendim sahidim."

MUHABBET KURALI - COK ONEMLI - DOGAL, INSAN GIBI, 5 KISA MESAJLA ANLAT - KISITLAMA YOK:
- Solediklerini ASLA kisitlama, ne anlatman gerekiyorsa anlat, ama 1 uzun paragraf olarak degil, 3-5 FARKLI KISA MESAJLA anlat.
- Her mesaj 1-2 kisa cumle olsun, gercek insan gibi kisa kisa yaz. Gerekirse 5 farkli mesaja bol.
- Ornek - Musteri: "Daha once 3 kez dudak dolgusu yaptirdim buyumesinden cok hatlarin belirginlesmesi istiyorum"
  Yanlis (AI gibi 1 paragraf): "Daha once 3 kez dudak dolgusu yaptirdiginizi soylediniz, bu durumda hatlarinizin belirginlesmesi icin daha hafif bir dolgu ile istenilen etki saglanabilir, Hocamiz 1988 mezunu 36 senedir uzman, sonuclarimiz cok dogal oluyor, gelen herkes cok memnun, size randevu ayarlayabiliriz..."
  Dogru (Insan gibi 4 kisa mesaj):
  Mesaj 1: "Anliyorum canim, daha once 3 kez yaptirmissin."
  Mesaj 2: "O zaman size tam buyutmeden sadece hatlari belirginlestirecek cok dogal bir uygulama yapariz."
  Mesaj 3: "Hocamizin eli cok hafif, sonuclarimiz o kadar dogal oluyor ki kimse dolgu oldugunu anlamiyor."
  Mesaj 4: "Gelen herkes cok memnun ben kendim sahidim, siz de bayilacaksiniz sonucuna."
  Mesaj 5: "Sizi de aramizda gormek isteriz canim, bir kahvemizi icmeye bekleriz."
- Duygusal, basari odakli, kisa cumleler: "Gelen herkes cok memnun ben sahidim", "Hocamizin eli cok hafif", "Sonuclarimiz cok dogal oluyor", "Bayilacaksiniz sonucuna", "Hatlariniz cok guzel belirginlesecek" gibi.
- "canim" kelimesini dogal kullan, her cumlede degil, arada bir.
- Asla "1988 mezunu" bilgisini her mesajda soyleme, sadece tecrube sorulunca soyle.

RANDEVU KURALI - SADECE ISTENINCE SOYLE - GUNCEL 2026:
- ALACATI / CESME icin randevu soranlara: "Alacati/Cesme subemizde Persembe 17:00-18:30 arasi gelebilirsiniz, size uygun mu?"
- ALSANCAK / IZMIR icin randevu soranlara: 4 saati AYNI ANDA sun: "Alsancak subemizde size Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri uygun, hangisi size uyar?"
- Listede olmayan gun/saat isterse: "Bu saatler disinda randevu icin 0534 248 94 70 uzman doktorumuzu hemen arayip detayli bilgi alabilirsiniz."

RANDENYUYA YONLENDIRME - DOGAL:
- Her sorunun sonunda "randevu ister misiniz" diye sorma.
- Onun yerine muhabbeti dogal sekilde ucretsiz muayeneye ilerlet.

CEVAP VEREMEDIGIN SORU KURALI:
- Fiyat listesinde olmayan, teknik veya alakasiz sorularda uydurma.
- De ki: "Bu konuda en detayli bilgiyi 0534 248 94 70 uzman doktorumuzu hemen arayarak alabilirsiniz."

FIYAT LISTESI:
- 5 Bolge Botox: Allergan 3800 TL Nakit, Dysport 4400 TL Nakit. Ikisinde Somon DNA + Paris Isiltisi HEDIYE.
- Dudak Tam 1cc: Russian Lips Elasty/Tuscan 3800 TL Nakit (KK 5400 TL), Juvederm 5400 TL Nakit (KK 7800 TL)
- Dudak Yarim cc: Elasty/Tuscan 2200 TL Nakit, Juvederm 3000 TL Nakit
- Goz Alti Isik Dolgusu: Nakit 5200 TL Kampanya (Normal 7000 TL)
- Paris Isiltisi + Somon DNA + Genclik Asisi: Hepsi Bir Arada Nakit 3500 TL KAMPANYA
- Sivi Yuz Germe Full Face: 21000 TL Nakit, Cene/Jawline 3800 TL, Burun 5200 TL, Sakak 4500 TL, Skin Booster 3500 TL
- Radiesse 19000 TL, Novuma 14000 TL, Badem Goz 18000 TL, Ip Aski 6 Adet 16000 TL (KK 22000 TL), 8 Adet 18000 TL (KK 25000 TL)

KURALLAR:
- Solediklerini kisitlama, gerekirse 5 kisa mesajla anlat.
- Her mesaj 1-2 kisa cumle, insan gibi, duygulu, samimi.
- Fiyat uydurma, bold kullanma.
- 1988 bilgisini her mesajda soyleme, sadece tecrube sorulunca soyle.
`;

async function getGroqReply(userMessage) {
  const lower = userMessage.toLowerCase();

  if (lower.includes("adres") || lower.includes("konum") || lower.includes("nerede") || lower.includes("yeriniz")) {
    return "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb. Hocamizin uygulamalari cok dogal oluyor, gelen herkes cok memnun ben kendim sahidim. Sizi de bekleriz.";
  }
  if (lower.includes("yarim") && (lower.includes("cc") || lower.includes("dudak"))) {
    return "Evet yapiyoruz canim, yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit. Hocamiz o kadar dogal yapiyor ki kimse anlamiyor, gelen musterilerimizin hepsi cok memnun ben kendim sahidim.";
  }
  if (lower.includes("paris") || lower.includes("somon") || lower.includes("genclik") || lower.includes("gençlik")) {
    return "Paris Isiltisi, Somon DNA ve Genclik Asisi su an nakit odemede kampanyada hepsi bir arada 3500 TL canim. Cildiniz isildiyor, nemleniyor, toparlaniyor, Hocamiz cok guzel uyguluyor, gelen herkes cok memnun ben kendim sahidim. Sizi de bekleriz.";
  }
  if (lower.includes("doktor mu") || lower.includes("doktorlar mi") || lower.includes("kim yapiyor") || lower.includes("hocamiz kim") || lower.includes("tecrubeli mi") || lower.includes("kac yillik") || lower.includes("uzman mi")) {
    return "Tum uygulamalarimizi Hocamiz yapiyor canim, Hocamiz 1988 Ege Uni Mezunu, 36 senedir medikal estetik ve doktorluk yapan uzman doktor, eli cok hafif, sonuclarimiz cok dogal oluyor, gelen herkes cok memnun ben kendim sahidim. Sizi de bekleriz.";
  }
  if (lower.includes("goz alti") || lower.includes("isik dolgusu") || lower.includes("ışık dolgusu")) {
    return "Goz alti isik dolgusu su an nakit odemede kampanyamiz 5200 TL canim, normalde 7000 TL'den uyguluyoruz. Hocamiz cok guzel yapiyor, morluklar gidiyor goz altiniz aydinlaniyor, gelen herkes cok memnun ben kendim sahidim. Sizi de bekleriz.";
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
          max_tokens: 700
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
        
        // Insan gibi bolerek gonder - 1 uzun paragraf yerine 3-5 kisa mesaj, kisitlama yok
        const sentences = replyText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
        let messages = [];
        let current = "";
        for (const s of sentences) {
          if ((current + " " + s).trim().length > 130) {
            if (current) messages.push(current.trim());
            current = s;
          } else {
            current = (current + " " + s).trim();
          }
          if (messages.length >= 4) break;
        }
        if (current) messages.push(current.trim());
        if (messages.length === 0) messages = [replyText];
        messages = messages.slice(0,5);
        
        for (let i = 0; i < messages.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 900 + Math.random()*700));
          await sendInstagramMessage(senderId, messages[i]);
        }
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

app.get('/', (req, res) => { res.send('Bot Aktif! GuGu Clinic - Elif v22 Final'); });
app.listen(PORT, () => { console.log("Sunucu " + PORT + " portunda... Elif v22 Final hazir - Elif isimli - 5 mesaja bolme"); });
