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
const userContext = new Map();
function isDuplicate(senderId, text) {
  const key = senderId + ":" + text.trim().toLowerCase();
  const now = Date.now();
  if (recentMessages.has(key) && now - recentMessages.get(key) < 30000) return true;
  recentMessages.set(key, now);
  return false;
}
function updateContext(senderId, topic) {
  userContext.set(senderId, { lastTopic: topic, lastTime: Date.now() });
}
function getContext(senderId) {
  const ctx = userContext.get(senderId);
  if (!ctx) return null;
  if (Date.now() - ctx.lastTime > 600000) return null;
  return ctx;
}
function isOnlyEmoji(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return !/[a-zA-Z0-9]/.test(trimmed);
}
const SYSTEM_PROMPT = `Senin adin Aida. GuGu Clinic satis danismani Aida'sin. Gercek bir insansin. Kurumsal, siz'li konus. ASLA canim deme.
DOKTOR: Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir.
ADRES: Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb
MUSAITLIK: Evet, su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?
KALICILIK: Dudak dolgusu 10-12 ay, Nazolabial 10-12 ay, Goz alti 10-12 ay, Botox 5-6 ay duzenli yaptiranlarda uzar.
FIYAT: Nazolabial 1 cc 3800 TL nakit 5400 TL KK, Sakak 4500 TL, Dudak 1cc Elasty 3800 TL KK 5400 Juvederm 5400 TL KK 7800, Goz alti 5200 TL, Paris+Somon+Genclik 3500 TL
`;

async function getGroqReply(userMessage, senderId, isGreeted) {
  const lower = userMessage.toLowerCase();
  const ctx = getContext(senderId);
  if (isOnlyEmoji(userMessage)) return "Tesekkurler, her zaman yazabilirsiniz. Sizi klinigimizde gormekten memnuniyet duyariz.";

  if (lower.trim().length < 20 && ["cok iyi","çok iyi","super","süper","harika","mukemmel","mükemmel","cok guzel","çok güzel","sahane","şahane","tesekkur","teşekkür","teşekkürler","tesekkurler","tamam","ok","okey"].includes(lower.trim())) {
    return "Tesekkurler, sizi klinigimizde gormekten memnuniyet duyariz. Randevu planlamak isterseniz her zaman yazabilirsiniz.";
  }

  if (lower.includes("kalici") || lower.includes("kalıc") || lower.includes("kac ay")) {
    if (ctx && ctx.lastTopic === 'dudak') return "Dudak dolgumuzun kaliciligi 10-12 ay arasindadir, kisiden kisiye metabolizmaya gore degisir ama cok dogal bir sekilde erir.";
    if (ctx && ctx.lastTopic === 'botox') return "Botoks uygulamalarimizin etkisi 5-6 aydir, duzenli yaptirdiginizda bu sure uzamaktadir.";
    if (ctx && ctx.lastTopic === 'nazolabial') return "Nazolabial dolgumuz 10-12 ay kalicidir.";
    if (lower.includes("dudak") || !lower.includes("botox")) return "Dudak dolgumuzun kaliciligi 10-12 ay arasindadir, metabolizmaniza gore degisir, cok dogal erir.";
    return "Botoks uygulamalarimizin etkisi 5-6 aydir, duzenli yaptirdiginizda bu sure uzamaktadir.";
  }

  if (lower.includes("adres") || lower.includes("konum") || lower.includes("nerede")) return "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb. Sizi bekliyoruz.";
  if (lower.includes("acik mi") || lower.includes("acikmi") || lower.includes("geliyorum") || lower.includes("musait misiniz")) return "Evet, su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?";
  if (lower.includes("dudak")) updateContext(senderId, "dudak");
  else if (lower.includes("botox") || lower.includes("botoks")) updateContext(senderId, "botox");
  else if (lower.includes("nazolabial") || lower.includes("nazal")) updateContext(senderId, "nazolabial");
  if ((lower.includes("nazolabial") || lower.includes("nazalobial"))) return "Nazolabial dolgu 1 cc 3800 TL nakit odeme, kredi karti 5400 TL. Normal fiyatimizdir, kampanyasizdir.";
  if (lower.includes("yarim") && lower.includes("dudak")) return "Evet yapiyoruz. Yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit.";
  if (lower.includes("sakak")) return "Sakak dolgusu 4500 TL nakit.";
  if (lower.includes("doktor mu") || lower.includes("kim yapiyor") || lower.includes("tecrubeli")) return "Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir, sonuclarimiz cok dogal olmaktadir.";
  if (lower.includes("randevu alabilir") || lower.includes("randevu al")) return "Tabii, su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?";

  try {
    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    for (const model of models) {
      try {
        const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
          model: model,
          messages: [{ role: "system", content: SYSTEM_PROMPT + "\nGreetedBefore:" + (isGreeted ? "EVET" : "HAYIR") + " LastTopic:" + (ctx ? ctx.lastTopic : "yok") }, { role: "user", content: userMessage }],
          temperature: 0.7,
          max_tokens: 400
        }, { headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY, 'Content-Type': 'application/json' } });
        let text = res.data.choices[0].message.content;
        if (text) {
          console.log("Groq calisti: " + model);
          text = text.replace(/1988.*?(mezunu|Ege).*?/gi, "");
          if (isGreeted) text = text.replace(/Merhaba, ben GuGu Clinic'ten Aida\.?\s*/gi, "");
          return text.slice(0, 900).trim();
        }
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
        await axios.post("https://graph.facebook.com/v20.0/" + IG_ID + "/messages", { recipient: { id: m.sender.id }, message: { text: reply } }, { params: { access_token: PAGE_ACCESS_TOKEN } });
        console.log("Gonderildi: " + reply.slice(0,80));
      }
    }
  } else res.sendStatus(404);
});
app.get('/', (req, res) => { res.send('Bot Aktif! Aida v31'); });
app.listen(PORT, () => { console.log("Sunucu " + PORT + " portunda... Aida v31 Final - Dudak 10-12 ay Botox 5-6 ay"); });
