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

TANISMA KURALI - TEKRAR YOK:
- SADECE ilk "merhaba, selam, iyi gunler" de BIR KERE: "Merhaba, ben GuGu Clinic'ten Aida" de.
- Daha once konusulan kisiye ASLA tekrar "Merhaba ben Aida" deme.
- Emoji gelince merhaba deme.

KURUMSAL: ASLA "canim" kullanma. Hep "siz" de.

DOKTOR KURALI - DR OZGEN YILDIRIM - 36 SENE TECRUBE:
- Musteri "doktor mu yapiyor, kim yapiyor, hocamiz kim, tecrubeli mi, uzman mi" diye SORARSA: "Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir, sonuclarimiz cok dogal olmaktadir, gelen danisanlarimizin hepsi cok memnun."
- Fiyat soruldugunda doktor bilgisi ekleme.

ADRES KURALI:
- Adres SADECE sorulursa: "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb"

CALISMA SAATLERI KURALI - MUSAITLIK CUMLESI - COK ONEMLI:
- ASLA "Pazartesi - Cuma 09:00 - 19:00" gibi genel saat uydurma, yasak.
- Clinic acik mi, geliyorum, musait misiniz, ne zaman aciksiniz gibi sorularda HER ZAMAN: "Evet, su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?"
- Randevu sorulursa da ayni musaitlik cumlesi ile soyle.

RANDEVU ONAYI - ISIM TELEFON:
- Musteri saat belirtirse: "Carsamba 17:30 icin randevunuzu olusturabiliriz. Randevu onayi icin isminizi ve telefon numaranizi alabilir miyim?"

FIYAT KURALI:
- Sadece sorulan fiyatlari soyle, baska sey ekleme.
- Nazolabial: 1 cc 3800 TL nakit, 5400 TL KK - Normal fiyat kampanyasiz
- Yarim CC: SADECE sorulunca
- Dudak: Varsayilan SADECE 1cc: 3800 TL (KK 5400) ve 5400 TL (KK 7800)
- Goz Alti: 5200 TL kampanya, normal 7000 TL
- Paris/Somon/Genclik: Hepsi bir arada 3500 TL
- Sakak: 4500 TL

FIYAT LISTESI:
- 5 Bolge Botox: Allergan 3800 TL, Dysport 4400 TL, Hediye Somon+Paris
- Dudak 1cc: Elasty/Tuscan 3800 TL (KK 5400), Juvederm 5400 TL (KK 7800)
- Dudak Yarim: SADECE SORULUNCA 2200 TL / 3000 TL
- Nazolabial: 1 cc 3800 TL nakit, 5400 TL KK
- Goz Alti: 5200 TL kampanya
- Paris+Somon+Genclik: 3500 TL
- Sivi Yuz: Full Face 21000 TL, Cene 3800 TL, Burun 5200 TL, Sakak 4500 TL
- Radiesse 19000, Novuma 14000, Badem Goz 18000, Ip Aski 6 adet 16000 (KK 22000), 8 adet 18000 (KK 25000)
`;

async function getGroqReply(userMessage, senderId, isGreeted) {
  const lower = userMessage.toLowerCase();
  if (isOnlyEmoji(userMessage)) return "Tesekkurler, her zaman yazabilirsiniz. Sizi klinigimizde gormekten memnuniyet duyariz.";
  if (lower.includes("adres") || lower.includes("konum") || lower.includes("nerede")) return "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb. Sizi bekliyoruz.";
  if (lower.includes("acik mi") || lower.includes("acikmi") || lower.includes("geliyorum") || lower.includes("musait misiniz") || lower.includes("bugun acik") || lower.includes("calisiyor musunuz")) {
    return "Evet, su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?";
  }
  if ((lower.includes("nazolabial") || lower.includes("nazalobial") || lower.includes("nazobial")) && lower.includes("dolgu")) {
    return "Nazolabial dolgu 1 cc 3800 TL nakit odeme, kredi karti 5400 TL. Normal fiyatimizdir, kampanyasizdir.";
  }
  if (lower.includes("nazolabial") || lower.includes("nazalobial") || lower.includes("nazobial")) {
    return "Nazolabial dolgu 1 cc 3800 TL nakit odeme, kredi karti 5400 TL. Normal fiyatimizdir, kampanyasizdir.";
  }
  if (lower.includes("yarim") && (lower.includes("cc") || lower.includes("dudak"))) {
    return "Evet yapiyoruz. Yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit. Tam 1 cc isterseniz Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL).";
  }
  if (lower.includes("sakak") && !lower.includes("dudak") && !lower.includes("nazal") && !lower.includes("nazo")) {
    if (lower.includes("dolgu") || lower.includes("germe")) {
      return "Sakak dolgusu 4500 TL nakit.";
    }
  }
  if (lower.includes("paris") || lower.includes("somon") || lower.includes("genclik")) return "Paris Isiltisi, Somon DNA ve Genclik Asisi su an nakit odemede kampanyada hepsi bir arada 3500 TL.";
  if (lower.includes("doktor mu") || lower.includes("kim yapiyor") || lower.includes("tecrubeli") || lower.includes("hocamiz kim") || lower.includes("uzman mi")) {
    return "Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir, sonuclarimiz cok dogal olmaktadir, gelen danisanlarimizin hepsi cok memnun.";
  }
  if (lower.includes("goz alti") || lower.includes("isik dolgusu")) return "Goz alti isik dolgusu su an kampanyamiz 5200 TL, normalde 7000 TL'den uyguluyoruz.";
  if ((lower.includes("sakak") || lower.includes("saka")) && lower.includes("dudak") && (lower.includes("nazol") || lower.includes("nazal") || lower.includes("nazo"))) {
    return "Sakak dolgusu 4500 TL nakit. Nazolabial dolgu 1 cc 3800 TL nakit, kredi karti 5400 TL. Dudak dolgusu 1 cc Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL).";
  }
  if (lower.includes("randevu alabilir") || lower.includes("randevu al")) {
    return "Tabii, su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?";
  }
  if (lower.includes("17:30") || lower.includes("17.30") || lower.match(/\d{2}:\d{2}/)) {
    if (lower.includes("carsamba") || lower.includes("cumartesi") || lower.includes("pazar") || lower.includes("pazartesi")) {
      return "Belirttiginiz saatte randevunuzu olusturabiliriz. Randevu onayi icin isminizi ve telefon numaranizi alabilir miyim?";
    }
  }

  try {
    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    for (const model of models) {
      try {
        const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
          model: model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT + "\nGreetedBefore: " + (isGreeted ? "EVET selamlasildi ASLA Merhaba ben Aida deme" : "HAYIR") },
            { role: "user", content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 400
        }, { headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY, 'Content-Type': 'application/json' } });
        let text = res.data.choices[0].message.content;
        if (text) {
          console.log("Groq calisti: " + model);
          text = text.replace(/1988.*?(mezunu|Ege|Universitesi|Tip).*?/gi, "");
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

app.get('/', (req, res) => { res.send('Bot Aktif! Aida v28 - Musaitlik cumlesi - Dr Ozgen'); });
app.listen(PORT, () => { console.log("Sunucu " + PORT + " portunda... Aida v28 Final - Musaitlik cumlesi - Dr Ozgen Yildirim 36 sene"); });
