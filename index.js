

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 10000;

// ================== MEMORY MAPS ==================
const recentMessages = new Map();
const greetedUsers = new Map();
const userContext = new Map();

// ================== HELPER FUNCTIONS ==================
function isDuplicate(senderId, text) {
  const key = senderId + ":" + text.trim().toLowerCase();
  const now = Date.now();
  if (recentMessages.has(key) && now - recentMessages.get(key) < 30000) {
    return true;
  }
  recentMessages.set(key, now);
  return false;
}

function updateContext(senderId, topic) {
  userContext.set(senderId, { 
    lastTopic: topic, 
    lastTime: Date.now() 
  });
}

function getContext(senderId) {
  const ctx = userContext.get(senderId);
  if (!ctx) return null;
  if (Date.now() - ctx.lastTime > 10 * 60 * 1000) {
    return null;
  }
  return ctx;
}

function isOnlyEmoji(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const hasLetter = /[a-zA-Z0-9]/;
  return !hasLetter.test(trimmed);
}

function splitToMessages(text) {
  // Nokta yoksa bolme - yarim kalmasin
  if (!text.includes('.') && !text.includes('!') && !text.includes('?')) {
    return [text.slice(0, 900)];
  }
  let parts = text.split(/(?<=[.!?])\s+/);
  let result = [];
  let current = "";
  for (let p of parts) {
    p = p.trim();
    if (!p) continue;
    if ((current + " " + p).length < 200) {
      current = current ? current + " " + p : p;
    } else {
      if (current) result.push(current);
      current = p;
    }
  }
  if (current) result.push(current);
  if (result.length > 3) {
    let first = result.slice(0, 2).join(" ");
    let rest = result.slice(2).join(" ");
    result = [first, rest].slice(0, 3);
  }
  return result.map(s => s.slice(0, 900));
}

async function sendSplitMessages(recipientId, text) {
  const msgs = splitToMessages(text);
  for (let i = 0; i < msgs.length; i++) {
    await axios.post(
      "https://graph.facebook.com/v20.0/" + IG_ID + "/messages",
      { 
        recipient: { id: recipientId }, 
        message: { text: msgs[i] } 
      },
      { 
        params: { access_token: PAGE_ACCESS_TOKEN } 
      }
    );
    console.log("Gonderildi [" + (i + 1) + "/" + msgs.length + "]: " + msgs[i]);
    if (i < msgs.length - 1) {
      await new Promise(r => setTimeout(r, 800 + Math.random() * 500));
    }
  }
}

// ================== SYSTEM PROMPT ==================
const SYSTEM_PROMPT = `Senin adin Aida. GuGu Clinic satis danismani Aida'sin. Gercek bir insansin, Alsancak'ta klinikte calisiyorsun. Asla yapay zeka oldugunu soyleme.

COK ONEMLI - INSAN GIBI KISA KONUS:
- ASLA uzun paragraf, ASLA maddeler halinde liste atma. Max 2-3 kisa cumle.
- ASLA her mesajda "Merhaba yogun oldugunuzu anliyorum, tercih ettiginiz subeyi paylasir misiniz, hangi uygulama ile ilgileniyorsunuz" gibi yapay uzun metin yazma. YASAK.
- ASLA her mesajda gun saat listesi verme. Sadece randevu sorulunca musaitlik cumlesi ver.
- Kurumsal, siz'li, saygili, net.

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

MUSAITLIK CUMLESI - SADECE RANDEVU SORULUNCA:
- "su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?"
- Her fiyat mesajinda bunu yazma!

KALICILIK - GUNCEL:
- Dudak dolgusu 10-12 ay
- Nazolabial 10-12 ay
- Goz alti isik dolgusu 10-12 ay
- Botox 5-6 ay duzenli yaptiranlarda uzar

FIYAT - SADECE SORULANI SOYLE - NAKIT KELIMESI MUTLAKA:
- Nazolabial: 1 cc 3800 TL nakit 5400 TL KK normal fiyat kampanyasiz
- Dudak 1cc: Elasty/Tuscan 3800 TL nakit KK 5400, Juvederm 5400 TL nakit KK 7800
- Yarim cc sadece sorulunca: 2200 TL nakit / 3000 TL nakit
- Sakak 4500 TL nakit, Burun 5200 TL nakit, Goz alti 5200 TL kampanya normal 7000 TL, Paris+Somon+Genclik 3500 TL nakit
- Botox 5 Bolge: Allergan 3800 TL nakit Dysport 4400 TL nakit Hediye Somon DNA + Paris Isiltisi
- Sivi Yuz: Full Face 21000 TL nakit, Cene 3800 TL nakit, Burun 5200 TL nakit, Sakak 4500 TL nakit
- Radiesse 19000, Novuma 14000, Badem Goz 18000, Ip Aski 6 adet 16000 KK 22000 8 adet 18000 KK 25000

RANDEVU ONAYI - ISIM TELEFON:
- Musteri saat belirtirse: "Belirttiginiz saatte randevunuzu olusturabiliriz. Isminizi ve telefon numaranizi alabilir miyim?"
`;

// ================== GROQ REPLY ==================
async function getGroqReply(userMessage, senderId, isGreeted) {
  const lower = userMessage.toLowerCase();
  const ctx = getContext(senderId);

  if (isOnlyEmoji(userMessage)) {
    return "Tesekkurler, her zaman yazabilirsiniz.";
  }

  // COK IYI / TESEKKUR FIX
  if (lower.trim().length < 25 && [
    "cok iyi", "çok iyi", "super", "süper", "harika", 
    "mukemmel", "mükemmel", "cok guzel", "çok güzel", 
    "sahane", "şahane", "tesekkur", "teşekkür", 
    "teşekkürler", "tesekkurler", "tamam", "ok", 
    "okey", "tamamdir", "sagol", "sağol", "eyvallah"
  ].includes(lower.trim())) {
    return "Tesekkurler, sizi klinigimizde gormekten memnuniyet duyariz.";
  }

  // KALICILIK - CONTEXT HAFIZALI - 10-12 AY DUDAK, 5-6 AY BOTOX
  if (lower.includes("kalici") || lower.includes("kalıc") || lower.includes("kac ay")) {
    if (ctx && ctx.lastTopic === 'dudak') {
      return "Dudak dolgumuzun kaliciligi 10-12 ay arasindadir. Cok dogal erir.";
    }
    if (ctx && ctx.lastTopic === 'botox') {
      return "Botoks 5-6 aydir, duzenli yaptirdiginizda sure uzuyor.";
    }
    if (ctx && ctx.lastTopic === 'nazolabial') {
      return "Nazolabial dolgumuz 10-12 ay kalicidir.";
    }
    if (ctx && ctx.lastTopic === 'gozalti') {
      return "Goz alti isik dolgumuz 10-12 ay kalicidir.";
    }
    if (lower.includes("dudak") || !lower.includes("botox")) {
      return "Dudak dolgumuzun kaliciligi 10-12 ay arasindadir, cok dogal erir.";
    }
    return "Botoks 5-6 aydir, duzenli yaptirdiginizda sure uzuyor.";
  }

  // ADRES
  if (lower.includes("adres") || lower.includes("konum") || lower.includes("nerede")) {
    updateContext(senderId, "adres");
    return "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb";
  }

  // CESME / ALACATI - RANDEVU GENIS
  if (lower.includes("cesme") || lower.includes("çeşme") || lower.includes("alacati") || lower.includes("alaçatı") || lower.includes("cesmede") || lower.includes("alacatida") || lower.includes("alaçatıda")) {
    updateContext(senderId, "cesme");
    if (lower.includes("randevu") || lower.includes("ne zaman") || lower.includes("geliyosunuz") || lower.includes("geliyorsunuz") || lower.includes("musait") || lower.includes("saat") || lower.includes("gun") || lower.includes("gün")) {
      return "Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda musaitligimiz var. Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 arasinda var. Hangisi size uyar?";
    }
  }

  // ACIK MI / GELIYORUM
  if (lower.includes("acik mi") || lower.includes("acikmi") || lower.includes("geliyorum") || lower.includes("musait misiniz") || lower.includes("bugun acik") || lower.includes("ne zaman acik") || lower.includes("calisiyor")) {
    return "Evet, su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?";
  }

  // CONTEXT UPDATE
  if (lower.includes("dudak")) {
    updateContext(senderId, "dudak");
  } else if (lower.includes("botox") || lower.includes("botoks")) {
    updateContext(senderId, "botox");
  } else if (lower.includes("nazolabial") || lower.includes("nazal")) {
    updateContext(senderId, "nazolabial");
  } else if (lower.includes("goz alti") || lower.includes("isik")) {
    updateContext(senderId, "gozalti");
  } else if (lower.includes("sakak")) {
    updateContext(senderId, "sakak");
  } else if (lower.includes("burun")) {
    updateContext(senderId, "burun");
  }

  // DUDAK FIYAT - YAZIM HATASI DA DAHIL
  if (lower.includes("dudak")) {
    if (lower.includes("fiyat") || lower.includes("ne kad") || lower.includes("kadr") || lower.includes("kdr") || lower.includes("ucret") || lower.includes("tl") || lower.includes("kac") || lower.includes("kaç") || lower.includes("alacati") || lower.includes("cesme") || lower.includes("dudak dolgusu") || lower.includes("dudak dolgusu ne")) {
      return "Dudak dolgusu 1 cc Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL). Fiyatlarimiz her iki subemizde de ayni.";
    }
  }

  // NAZOLABIAL
  if (lower.includes("nazolabial") || lower.includes("nazalobial") || lower.includes("nazolab")) {
    return "Nazolabial dolgu 1 cc 3800 TL nakit, 5400 TL KK. Normal fiyat.";
  }

  // YARIM CC
  if (lower.includes("yarim") && (lower.includes("cc") || lower.includes("dudak"))) {
    return "Evet yarim yapiyoruz. Yarim cc Elasty 2200 TL nakit, Juvederm 3000 TL nakit. 1 cc Elasty 3800 TL KK 5400, Juvederm 5400 TL KK 7800.";
  }

  // SAKAK
  if (lower.includes("sakak") && !lower.includes("dudak") && !lower.includes("nazo")) {
    return "Sakak dolgusu 4500 TL nakit.";
  }

  // BURUN
  if (lower.includes("burun") && lower.includes("dolgu")) {
    return "Burun dolgusu 5200 TL nakit.";
  }

  // PARIS SOMON GENCLIK
  if (lower.includes("paris") || lower.includes("somon") || lower.includes("genclik")) {
    return "Paris Isiltisi, Somon DNA ve Genclik Asisi hepsi bir arada 3500 TL nakit kampanya.";
  }

  // DOKTOR
  if (lower.includes("doktor mu") || lower.includes("kim yapiyor") || lower.includes("tecrubeli") || lower.includes("hocamiz kim") || lower.includes("uzman mi")) {
    return "Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir, sonuclarimiz cok dogal olmaktadir.";
  }

  // GOZ ALTI
  if (lower.includes("goz alti") || lower.includes("isik dolgu") || lower.includes("gozalti")) {
    return "Goz alti isik dolgusu 5200 TL kampanya, normal 7000 TL.";
  }

  // KOMBIN - SAKAK DUDAK NAZOLABIAL
  if ((lower.includes("sakak") || lower.includes("saka")) && lower.includes("dudak") && (lower.includes("nazol") || lower.includes("nazal"))) {
    return "Sakak 4500 TL nakit. Nazolabial 1 cc 3800 TL nakit KK 5400. Dudak 1 cc Elasty 3800 TL KK 5400, Juvederm 5400 TL KK 7800.";
  }

  // BOTOX - SADECE BOTOX YAZSA BILE FIYAT VER
  if (lower.includes("botox") || lower.includes("botoks")) {
    return "5 Bolge Botox Allergan 3800 TL nakit, Dysport 4400 TL nakit. Hediye Somon DNA + Paris Isiltisi.";
  }

  // SIVI YUZ GERME
  if (lower.includes("sivi yuz") || lower.includes("sıvı yüz") || (lower.includes("sivi") && lower.includes("germe"))) {
    return "Sivi yuz germe Full Face 21000 TL nakit.";
  }

  // RANDEVU
  if (lower.includes("randevu alabilir") || lower.includes("randevu al") || lower.includes("randevu nasil") || (lower.includes("randevu") && lower.length < 80)) {
    return "Tabii, su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?";
  }

  // SAAT BELIRTME - 17:30 gibi
  if (lower.match(/\d{2}:\d{2}/)) {
    if (lower.includes("carsamba") || lower.includes("cumartesi") || lower.includes("pazar") || lower.includes("pazartesi") || lower.includes("persembe") || lower.includes("cesme") || lower.includes("alacati") || lower.includes("alaçatı")) {
      return "Belirttiginiz saatte randevunuzu olusturabiliriz. Isminizi ve telefon numaranizi alabilir miyim?";
    }
  }

  // GROQ - SON CARE - max_tokens 400 - YARIM KALMASIN
  try {
    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    for (const model of models) {
      try {
        const res = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: model,
            messages: [
              { 
                role: "system", 
                content: SYSTEM_PROMPT + "\nGreeted:" + (isGreeted ? "EVET - merhaba deme" : "HAYIR") + " LastTopic:" + (ctx ? ctx.lastTopic : "yok") 
              },
              { 
                role: "user", 
                content: userMessage 
              }
            ],
            temperature: 0.5,
            max_tokens: 400
          },
          { 
            headers: { 
              'Authorization': 'Bearer ' + GROQ_API_KEY, 
              'Content-Type': 'application/json' 
            } 
          }
        );
        let text = res.data.choices[0].message.content;
        if (text) {
          console.log("Groq calisti: " + model);
          text = text.replace(/1988.*?(mezunu|Ege).*?/gi, "");
          text = text.replace(/Merhaba, yogun oldugunuzu anliyorum.*?/gi, "");
          text = text.replace(/tercih ettiginiz subeyi.*?/gi, "");
          text = text.replace(/hangi uygulama ile ilgilendiginizi.*?/gi, "");
          text = text.replace(/Size yardimci olmaktan memnuniyet duyarim.*?/gi, "");
          if (isGreeted) {
            text = text.replace(/Merhaba, ben GuGu Clinic'ten Aida\.?\s*/gi, "");
          }
          if (text.length > 500 || text.includes("Alsancak Subesi:") || text.includes("Alacati/Cesme Subesi:")) {
            if (!lower.includes("randevu") && !lower.includes("musait") && !lower.includes("acik mi")) {
              text = text.replace(/Alsancak.*?[0-9:]+.*/g, "").replace(/Alacati.*?[0-9:]+.*/g, "").trim();
            }
          }
          return text.slice(0, 800).trim();
        }
      } catch (e) { 
        console.log("Groq hata: " + model + " " + e.message);
        continue; 
      }
    }
    throw new Error("kapali");
  } catch (err) {
    return "Bu konuda detayli bilgi icin 0534 248 94 70'ten arayabilirsiniz.";
  }
}

// ================== WEBHOOK ==================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'instagram' || body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');
    for (const entry of body.entry) {
      const m = entry.messaging ? entry.messaging[0] : null;
      if (m && m.message) {
        // HUMAN TAKEOVER KAPATILDI - TUM ECHO'LAR ATLANIYOR
        if (m.message.is_echo) {
          console.log("Echo atlandi: " + (m.message.text || "").slice(0, 80));
          continue;
        }
        if (!m.message.text) continue;
        if (isDuplicate(m.sender.id, m.message.text)) {
          console.log("Duplicate atlandi");
          continue;
        }
        console.log("Gelen Mesaj: " + m.message.text + " | Context: " + (getContext(m.sender.id)?.lastTopic || "yok"));
        const isGreeted = greetedUsers.has(m.sender.id);
        const reply = await getGroqReply(m.message.text, m.sender.id, isGreeted);
        if (!isGreeted) {
          greetedUsers.set(m.sender.id, Date.now());
        }
        await sendSplitMessages(m.sender.id, reply);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

app.get('/', (req, res) => {
  res.send('Bot Aktif! Aida v38 FULL EXPANDED - Human Takeover Kapali - 460+ satir');
});

app.listen(PORT, () => {
  console.log("Sunucu " + PORT + " portunda... Aida v38 FULL EXPANDED - Human Takeover KAPALI - Yarim kalma fix - 460+ satir");
});

