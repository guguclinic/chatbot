
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
  if (Date.now() - ctx.lastTime > 10*60*1000) return null;
  return ctx;
}
function isOnlyEmoji(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return !/[a-zA-Z0-9]/.test(trimmed);
}

function splitToMessages(text) {
  // Noktali cumlelere bol, cok uzun tek mesaj engelle
  let parts = text.split(/(?<=[.!?])\s+/);
  // Cok kisa parcalari birlestir
  let result = [];
  let current = "";
  for (let p of parts) {
    p = p.trim();
    if (!p) continue;
    if ((current + " " + p).length < 120) {
      current = current ? current + " " + p : p;
    } else {
      if (current) result.push(current);
      current = p;
    }
  }
  if (current) result.push(current);
  // Max 3 mesaj
  if (result.length > 3) {
    let first = result.slice(0,2).join(" ");
    let rest = result.slice(2).join(" ");
    result = [first, rest].slice(0,3);
  }
  // Tek cumle cok uzunsa bolme
  return result.map(s => s.slice(0, 900));
}

async function sendSplitMessages(recipientId, text) {
  const msgs = splitToMessages(text);
  for (let i = 0; i < msgs.length; i++) {
    await axios.post("https://graph.facebook.com/v20.0/" + IG_ID + "/messages", 
      { recipient: { id: recipientId }, message: { text: msgs[i] } }, 
      { params: { access_token: PAGE_ACCESS_TOKEN } });
    console.log("Gonderildi [" + (i+1) + "/" + msgs.length + "]: " + msgs[i].slice(0,80));
    if (i < msgs.length - 1) {
      await new Promise(r => setTimeout(r, 900 + Math.random()*700));
    }
  }
}

const SYSTEM_PROMPT = `Senin adin Aida. GuGu Clinic satis danismani Aida'sin. Gercek bir insansin, Alsancak'ta klinikte calisiyorsun. Asla yapay zeka oldugunu soyleme. 

COK ONEMLI - INSAN GIBI KISA KONUS:
- ASLA uzun paragraf, ASLA maddeler halinde liste atma. Max 2-3 kisa cumle.
- ASLA her mesajda "Merhaba yogun oldugunuzu anliyorum, tercih ettiginiz subeyi paylasir misiniz, hangi uygulama ile ilgileniyorsunuz" gibi yapay uzun metin yazma. YASAK.
- ASLA her mesajda gun saat listesi verme. Sadece randevu sorulunca musaitlik cumlesi ver.
- Kurumsal, siz'li, saygili, net.

TANISMA:
- SADECE ilk merhabada "Merhaba, ben GuGu Clinic'ten Aida" de. Sonra ASLA tekrar deme.
- Emoji gelince merhaba deme.

KURUMSAL: ASLA "canim" kullanma.

DOKTOR: Sadece sorulursa "Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir, sonuclarimiz cok dogal."

ADRES: Sadece sorulursa "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb"

MUSAITLIK CUMLESI - SADECE RANDEVU SORULUNCA:
- "su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?"
- Her fiyat mesajinda bunu yazma!

KALICILIK:
- Dudak 10-12 ay
- Botox 5-6 ay duzenli yaptiranlarda uzar
- Nazolabial 10-12 ay

FIYAT - SADECE SORULANI SOYLE:
- Nazolabial: 1 cc 3800 TL nakit 5400 TL KK normal fiyat
- Dudak 1cc: Elasty/Tuscan 3800 TL nakit KK 5400, Juvederm 5400 TL nakit KK 7800
- Yarim cc sadece sorulunca: 2200 TL / 3000 TL
- Sakak 4500 TL, Burun 5200 TL, Goz alti 5200 TL kampanya, Paris+Somon+Genclik 3500 TL
- Botox 5 Bolge: Allergan 3800 TL Dysport 4400 TL Hediye Somon+Paris
`;

async function getGroqReply(userMessage, senderId, isGreeted) {
  const lower = userMessage.toLowerCase();
  const ctx = getContext(senderId);
  if (isOnlyEmoji(userMessage)) return "Tesekkurler, her zaman yazabilirsiniz.";

  if (lower.trim().length < 20 && ["cok iyi","çok iyi","super","süper","harika","mukemmel","mükemmel","cok guzel","çok güzel","sahane","şahane","tesekkur","teşekkür","teşekkürler","tesekkurler","tamam","ok","okey"].includes(lower.trim())) {
    return "Tesekkurler, sizi klinigimizde gormekten memnuniyet duyariz.";
  }

  if (lower.includes("kalici") || lower.includes("kalıc") || lower.includes("kac ay")) {
    if (ctx && ctx.lastTopic === 'dudak') return "Dudak dolgumuzun kaliciligi 10-12 ay arasindadir. Cok dogal erir.";
    if (ctx && ctx.lastTopic === 'botox') return "Botoks 5-6 aydir, duzenli yaptirdiginizda sure uzuyor.";
    if (lower.includes("dudak") || !lower.includes("botox")) return "Dudak dolgumuzun kaliciligi 10-12 ay arasindadir, cok dogal erir.";
    return "Botoks 5-6 aydir, duzenli yaptirdiginizda sure uzuyor.";
  }

  if (lower.includes("adres") || lower.includes("konum") || lower.includes("nerede")) {
    updateContext(senderId, "adres");
    return "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb";
  }
  if (lower.includes("acik mi") || lower.includes("acikmi") || lower.includes("geliyorum") || lower.includes("musait misiniz") || lower.includes("bugun acik")) {
    return "Evet, su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?";
  }
  if (lower.includes("dudak")) updateContext(senderId, "dudak");
  else if (lower.includes("botox") || lower.includes("botoks")) updateContext(senderId, "botox");
  else if (lower.includes("nazolabial") || lower.includes("nazal")) updateContext(senderId, "nazolabial");
  else if (lower.includes("goz alti")) updateContext(senderId, "gozalti");

  if (lower.includes("nazolabial") || lower.includes("nazalobial")) return "Nazolabial dolgu 1 cc 3800 TL nakit, 5400 TL KK. Normal fiyat.";
  if (lower.includes("yarim") && lower.includes("dudak")) return "Evet yarim yapiyoruz. Yarim cc Elasty 2200 TL nakit, Juvederm 3000 TL nakit. 1 cc Elasty 3800 TL KK 5400, Juvederm 5400 TL KK 7800.";
  if (lower.includes("sakak") && !lower.includes("dudak") && !lower.includes("nazo")) return "Sakak dolgusu 4500 TL nakit.";
  if (lower.includes("paris") || lower.includes("somon") || lower.includes("genclik")) return "Paris Isiltisi, Somon DNA ve Genclik Asisi hepsi bir arada 3500 TL nakit kampanya.";
  if (lower.includes("doktor mu") || lower.includes("kim yapiyor") || lower.includes("tecrubeli")) return "Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir.";
  if (lower.includes("goz alti") || lower.includes("isik dolgu")) return "Goz alti isik dolgusu 5200 TL kampanya, normal 7000 TL.";
  if ((lower.includes("sakak") || lower.includes("saka")) && lower.includes("dudak") && (lower.includes("nazol") || lower.includes("nazal"))) return "Sakak 4500 TL nakit. Nazolabial 1 cc 3800 TL nakit KK 5400. Dudak 1 cc Elasty 3800 TL KK 5400, Juvederm 5400 TL KK 7800.";
  if (lower.includes("randevu alabilir") || lower.includes("randevu al") || lower.includes("randevu nasil")) return "Tabii, su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?";
  if (lower.match(/\d{2}:\d{2}/)) {
    if (lower.includes("carsamba") || lower.includes("cumartesi") || lower.includes("pazar") || lower.includes("pazartesi") || lower.includes("persembe")) {
      return "Belirttiginiz saatte randevunuzu olusturabiliriz. Isminizi ve telefon numaranizi alabilir miyim?";
    }
  }

  try {
    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    for (const model of models) {
      try {
        const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
          model: model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT + "\nGreeted:" + (isGreeted ? "EVET - merhaba deme" : "HAYIR") + " LastTopic:" + (ctx ? ctx.lastTopic : "yok") },
            { role: "user", content: userMessage }
          ],
          temperature: 0.6,
          max_tokens: 250
        }, { headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY, 'Content-Type': 'application/json' } });
        let text = res.data.choices[0].message.content;
        if (text) {
          console.log("Groq calisti: " + model);
          text = text.replace(/1988.*?(mezunu|Ege).*?/gi, "");
          text = text.replace(/Merhaba, yogun oldugunuzu anliyorum.*?/gi, "");
          text = text.replace(/tercih ettiginiz subeyi.*?/gi, "");
          text = text.replace(/hangi uygulama ile ilgilendiginizi.*?/gi, "");
          text = text.replace(/Size yardimci olmaktan memnuniyet duyarim.*?/gi, "");
          if (isGreeted) text = text.replace(/Merhaba, ben GuGu Clinic'ten Aida\.?\s*/gi, "");
          // Uzun listeyi engelle
          if (text.length > 500 || text.includes("Alsancak Subesi:") || text.includes("Alacati/Cesme Subesi:")) {
            // Eger randevu degilse musaitlik listesini sil
            if (!lower.includes("randevu") && !lower.includes("musait") && !lower.includes("acik mi")) {
              text = text.replace(/Alsancak.*?[0-9:]+.*/g, "").replace(/Alacati.*?[0-9:]+.*/g, "").trim();
            }
          }
          return text.slice(0, 600).trim();
        }
      } catch (e) { continue; }
    }
    throw new Error("kapali");
  } catch (err) {
    return "Bu konuda detayli bilgi icin 0534 248 94 70'ten arayabilirsiniz.";
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
        console.log("Gelen Mesaj: " + m.message.text + " | Context: " + (getContext(m.sender.id)?.lastTopic || "yok"));
        const isGreeted = greetedUsers.has(m.sender.id);
        const reply = await getGroqReply(m.message.text, m.sender.id, isGreeted);
        if (!isGreeted) greetedUsers.set(m.sender.id, Date.now());
        await sendSplitMessages(m.sender.id, reply);
      }
    }
  } else res.sendStatus(404);
});

app.get('/', (req, res) => { res.send('Bot Aktif! Aida v32 - Insan gibi cumle cumle'); });
app.listen(PORT, () => { console.log("Sunucu " + PORT + " portunda... Aida v32 Final - Cumle cumle mesaj + uzun metin yasak"); });
