const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 10000;

const recentMessages = new Map();
const greetedUsers = new Map();

function isDuplicate(senderId, text) {
  const key = senderId + ":" + text.trim().toLowerCase();
  const now = Date.now();
  if (recentMessages.has(key) && now - recentMessages.get(key) < 30000) return true;
  recentMessages.set(key, now);
  return false;
}

function isOnlyEmoji(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const hasLetter = /[a-zA-Z0-9]/;
  return !hasLetter.test(trimmed);
}

const SYSTEM_PROMPT = `Senin adin Aida. GuGu Clinic satis danismani Aida'sin. Gercek bir insansin, Alsancak'ta klinikte calisiyorsun. Asla yapay zeka oldugunu soyleme. Kurumsal, siz'li, saygili, profesyonel konus.

TANISMA: Ilk merhaba'da "Merhaba, ben GuGu Clinic'ten Aida" de, sonra ASLA tekrar merhaba deme. Emoji gelince merhaba deme.

KURUMSAL: ASLA "canim" kullanma. Hep "siz" de.

Alsancak Doktorlar Sitesi ve Dunya Goz Hastanesi yani.

DOKTOR: "Tum uygulamalarimizi Hocamiz yapmaktadir, Hocamiz 1988 Ege Uni mezunu, 36 senedir uzman doktordur. Eli cok hafiftir, sonuclarimiz cok dogal."

ADRES: "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb"

NAZOLABIAL: "Nazolabial dolgu 1 cc 3800 TL nakit odeme, kredi karti 5400 TL. Normal fiyatimizdir, kampanyasiz. Hocamiz cok dogal doldurmaktadir."

YARIM CC: SADECE "yarim cc yapiyor musunuz" diye sorulunca: "Evet yapiyoruz, yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit". Normal dudak sorusunda yarim cc'den bahsetme.

DUDAK: Varsayilan SADECE 1cc: "Dudak dolgusu 1 cc Russian Lips Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL)."

GOZ ALTI: "Goz alti isik dolgusu kampanya 5200 TL nakit, normalde 7000 TL."

PARIS/SOMON/GENCLIK: "Paris Isiltisi, Somon DNA ve Genclik Asisi hepsi bir arada 3500 TL kampanya."

MUHABBET: 3-5 kisa mesajla anlat, her mesaj 1-2 cumle, insan gibi. KISITLAMA YOK.

RANDEVU: Alacati Persembe 17:00-18:30, Alsancak Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00, Carsamba 16:30-19:00

FIYAT LISTESI:
- 5 Bolge Botox: Allergan 3800 TL, Dysport 4400 TL, Hediye Somon+Paris
- Dudak 1cc: Elasty/Tuscan 3800 TL (KK 5400), Juvederm 5400 TL (KK 7800)
- Dudak Yarim: SADECE SORULUNCA 2200 TL / 3000 TL
- Nazolabial: 1 cc 3800 TL nakit, 5400 TL KK - Normal fiyat
- Goz Alti: 5200 TL kampanya
- Paris+Somon+Genclik: 3500 TL
- Sivi Yuz: Full Face 21000 TL, Cene 3800 TL, Burun 5200 TL, Sakak 4500 TL
- Radiesse 19000, Novuma 14000, Badem Goz 18000, Ip Aski 6 adet 16000 (KK 22000), 8 adet 18000 (KK 25000)
`;

async function getGroqReply(userMessage, senderId, isGreeted) {
  const lower = userMessage.toLowerCase();
  if (isOnlyEmoji(userMessage)) return "Tesekkurler, her zaman yazabilirsiniz. Sizi klinigimizde gormekten memnuniyet duyariz.";
  if (lower.includes("adres") || lower.includes("konum") || lower.includes("nerede")) return "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb. Sizi bekliyoruz.";
  if ((lower.includes("nazolabial") || lower.includes("nazalobial") || lower.includes("nazobial")) && lower.includes("dolgu")) return "Nazolabial dolgu 1 cc 3800 TL nakit odeme, kredi karti 5400 TL. Normal fiyatimizdir, kampanyasizdir. Hocamiz bu bolgeyi cok dogal doldurmaktadir, yuzunuzde cok guzel bir toparlanma oluyor. Sizin icin de cok guzel bir sonuc planlayabiliriz.";
  if (lower.includes("nazolabial") || lower.includes("nazalobial") || lower.includes("nazobial")) return "Nazolabial dolgu 1 cc 3800 TL nakit odeme, kredi karti 5400 TL. Normal fiyatimizdir, kampanyasizdir. Hocamiz bu bolgeyi cok dogal doldurmaktadir.";
  if (lower.includes("yarim") && (lower.includes("cc") || lower.includes("dudak"))) return "Evet yapiyoruz. Yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit. Tam 1 cc isterseniz Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL).";
  if (lower.includes("sakak") && (lower.includes("germe") || lower.includes("dolgu"))) {
    if (!lower.includes("dudak") && !lower.includes("nazal") && !lower.includes("nazo")) return "Sakak dolgusu 4500 TL nakit. Hocamiz bu bolgeyi cok dogal doldurmaktadir.";
  }
  if (lower.includes("paris") || lower.includes("somon") || lower.includes("genclik")) return "Paris Isiltisi, Somon DNA ve Genclik Asisi su an nakit odemede kampanyada hepsi bir arada 3500 TL.";
  if (lower.includes("doktor mu") || lower.includes("kim yapiyor") || lower.includes("tecrubeli")) return "Tum uygulamalarimizi Hocamiz yapmaktadir, Hocamiz 1988 Ege Universitesi mezunu, 36 senedir medikal estetik ve doktorluk yapan uzman doktordur.";
  if (lower.includes("goz alti") || lower.includes("isik dolgusu")) return "Goz alti isik dolgusu su an kampanyamiz 5200 TL, normalde 7000 TL'den uyguluyoruz.";

  try {
    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    for (const model of models) {
      try {
        const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
          model: model,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userMessage }],
          temperature: 0.8,
          max_tokens: 600
        }, { headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY, 'Content-Type': 'application/json' } });
        const text = res.data.choices[0].message.content;
        if (text) { console.log("Groq calisti: " + model); return text.slice(0, 900); }
      } catch (e) { continue; }
    }
    throw new Error("kapali");
  } catch (err) {
    return "Bu konuda en detayli bilgiyi 0534 248 94 70 uzman doktorumuzu hemen arayarak alabilirsiniz.";
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
      const m = entry.messaging ? entry.messaging[0] : null;
      if (m && m.message && m.message.text) {
        if (m.message.is_echo) continue;
        if (isDuplicate(m.sender.id, m.message.text)) { console.log("Duplicate atlandi"); continue; }
        console.log("Gelen Mesaj: " + m.message.text);
        const isGreeted = greetedUsers.has(m.sender.id);
        const reply = await getGroqReply(m.message.text, m.sender.id, isGreeted);
        if (!isGreeted) greetedUsers.set(m.sender.id, Date.now());
        const parts = reply.split(/(?<=[.!?])\s+/).slice(0,5);
        for (let i=0;i<parts.length;i++) {
          if (i>0) await new Promise(r=>setTimeout(r, 1000));
          await axios.post("https://graph.facebook.com/v20.0/" + IG_ID + "/messages", { recipient: { id: m.sender.id }, message: { text: parts[i] } }, { params: { access_token: PAGE_ACCESS_TOKEN } });
          console.log("Gonderildi: " + parts[i].slice(0,80));
        }
      }
    }
  } else res.sendStatus(404);
});

app.get('/', (req, res) => { res.send('Bot Aktif! Aida v23 Fixed'); });
app.listen(PORT, () => { console.log("Sunucu " + PORT + " portunda... Aida v23 Final hazir - Kurumsal - Nazolabial eklendi"); });
