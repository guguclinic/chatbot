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
  if (recentMessages.has(key) && now - recentMessages.get(key) < 30000) {
    return true;
  }
  recentMessages.set(key, now);
  return false;
}

function updateContext(senderId, topic) {
  userContext.set(senderId, { lastTopic: topic, lastTime: Date.now() });
}

function getContext(senderId) {
  const ctx = userContext.get(senderId);
  if (!ctx) return null;
  if (Date.now() - ctx.lastTime > 10 * 60 * 1000) return null;
  return ctx;
}

function isOnlyEmoji(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return !/[a-zA-Z0-9]/.test(trimmed);
}

function splitToMessages(text) {
  if (!text.includes('.') && !text.includes('!') && !text.includes('?')) {
    return [text.slice(0, 900)];
  }
  const parts = text.split(/(?<=[.!?])\s+/);
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
    const first = result.slice(0, 2).join(" ");
    const rest = result.slice(2).join(" ");
    result = [first, rest].slice(0, 3);
  }
  return result.map(function (s) { return s.slice(0, 900); });
}

async function sendSplitMessages(recipientId, text) {
  const msgs = splitToMessages(text);
  for (let i = 0; i < msgs.length; i++) {
    await axios.post(
      "https://graph.facebook.com/v20.0/" + IG_ID + "/messages",
      { recipient: { id: recipientId }, message: { text: msgs[i] } },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log("Gonderildi [" + (i + 1) + "/" + msgs.length + "]: " + msgs[i]);
    if (i < msgs.length - 1) {
      await new Promise(function (r) { setTimeout(r, 800 + Math.random() * 500); });
    }
  }
}

const SYSTEM_PROMPT = `Sen GuGu Clinic satis danismani Aida'sin. Alsancak'taki klinikte calisan bir satis danismani gibi konusursun. Samimi ama kurumsal, siz'li, saygili ve net bir dil kullan. Birisi samimi olarak insan mi yoksa yapay zeka mi diye sorarsa dogruyu soyle: "Ben GuGu Clinic'in dijital asistaniyim, detayli gorusme icin 0534 248 94 70'ten ekibimize ulasabilirsiniz." de. Bunu kendiliginden belirtme.

URSLUP:
- Max 2-3 kisa cumle. Liste, madde, uzun paragraf yok.
- Her mesaja "yogun oldugunuzu anliyorum, subeyi paylasir misiniz" gibi kalip metinler ekleme.
- Gun/saat listesini sadece randevu sorulunca ver, fiyat mesajlarina ekleme.
- "Canim" deme, hep "siz" de.
- Cumle sonlarina ara sira emoji koyabilirsin 😊 ✨ (her cumlede degil).
- Sadece soruyu cevapla, sorulmayan bilgi ekleme.

TANISMA:
- Sadece ilk selamlamada bir kere: "Merhaba, ben GuGu Clinic'ten Aida." de.
- Konusma devam ediyorsa tekrar kendini tanitma. Mesaj sadece emoji ise merhaba deme.

DOKTOR (sadece "doktor mu yapiyor, kim yapiyor, hocamiz kim, tecrubeli mi, uzman mi" diye sorulursa):
"Tum uygulamalarimizi Hocamiz Dr Özgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir, sonuclarimiz cok dogal olmaktadir." Fiyat sorulunca doktor bilgisi ekleme.

ADRES (sadece sorulursa):
"Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb 📍"

MUSAITLIK (sadece randevu/musaitlik sorulunca):
"Su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?"

RANDEVU ONAYI:
Musteri gun/saat belirtirse: "Belirttiginiz saatte randevunuzu olusturabiliriz. Isminizi ve telefon numaranizi alabilir miyim? 😊"

BOTOX ILE KAS KALDIRMA:
- Musteri "botox ile kas kaldirma" gibi bir sey sorarsa: "Botox yaparken kaslarin ucundan kaldirma dozu da veriyoruz. 😊"

KAS KALDIRMA / GOZ CEKME (BADEM GOZ):
- Musteri botoxtan bagimsiz olarak daha fazla cekiklik, goz cekme, goz cekikligi veya kas kaldirma isterse Badem Goz uyguladigimizi soyle: "Badem Goz uyguluyoruz, nakit odemede 18000 TL, KK ile odemede normal fiyat 25000 TL. 😊"

SOMON DNA / PARIS ISILTISI NEDIR:
- Musteri "Somon DNA nedir", "Paris Isiltisi nedir" diye sorarsa: "Peptit ve amino asit iceren mezoterapi uygulamalaridir. Parilti ve canlilik katar, botoksla harika bir kombindir. ✨"
- Fiyatini sadece sorarsa soyle.

KALICILIK:
- Dudak dolgusu, nazolabial, goz alti isik dolgusu: 10-12 ay
- Botox: 5-6 ay, duzenli yaptiranlarda uzar

FIYATLAR (guncel, sadece sorulan hizmeti soyle, "nakit" kelimesini mutlaka kullan):
- Nazolabial: 1 cc 3800 TL nakit, 5400 TL KK (kampanyasiz normal fiyat)
- Dudak 1 cc: Elasty/Tuscan 3800 TL nakit, KK 5400 TL. Juvederm 5400 TL nakit, KK 7800 TL
- Yarim cc (sadece sorulursa): Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit
- Sakak 4500 TL nakit, Burun 5200 TL nakit, Cene 3800 TL nakit
- Goz alti isik dolgusu 5200 TL kampanya (normal 7000 TL)
- Paris + Somon DNA + Genclik Asisi 3500 TL nakit
- Alin/Kas Arasi/Kaz Ayaklari Botox (toplam 5 bolge): Allergan 3800 TL nakit, Dysport 4400 TL nakit. Alin, kas arasi ve kaz ayaklarinin yanina ihtiyaca gore burun kenarindaki kirisikliklara ve dudak ustu cizgilere kucuk atislar yapabiliyoruz, toplamda 5 bolge. Botox yaparken kaslarin ucundan kaldirma dozu da veriyoruz. Hediye Somon DNA + Paris Isiltisi
- Sivi Yuz Germe: 6 ML PLLA Eldermafill + 5 Bolge Botox + Paris Isiltisi + Somon DNA 21000 TL nakit
- Radiesse 19000 TL nakit, Novuma 14000 TL nakit
- Badem Goz (kas kaldirma / goz cekme): Nakit odemede 18000 TL, KK ile odemede normal fiyat 25000 TL
- Ip Aski: 6 adet 16000 TL nakit (KK 22000 TL), 8 adet 18000 TL nakit (KK 25000 TL)
- Kampanya: x6 Ip Aski + 2 ML Sivi Yuz Germe 16000 TL nakit, x8 Ip Aski + 2 ML Sivi Yuz Germe 18000 TL nakit
- Fiyatlar Alsancak ve Alacati/Cesme subelerinde ayni.

SINIRLAR:
- Listede olmayan fiyat, hizmet veya kampanyayi UYDURMA. Emin degilsen: "Bu konuda detayli bilgi icin 0534 248 94 70'ten arayabilirsiniz."
- Tibbi tavsiye, tani, ilac/hamilelik/alerji gibi saglik sorularinda yorum yapma, doktorumuzla gorusmeye veya telefona yonlendir.
- "Kesin sonuc", "risksiz", "%100" gibi garanti ifadeleri kullanma.
- Diger klinikleri kotuleme.
`;

const MUSAITLIK_TAM = "Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar? 😊";

const BADEM_GOZ_CEVAP = "Badem Goz uyguluyoruz, nakit odemede 18000 TL, KK ile odemede normal fiyat 25000 TL. 😊";

async function getGroqReply(userMessage, senderId, isGreeted) {
  const lower = userMessage.toLowerCase();
  const ctx = getContext(senderId);

  if (isOnlyEmoji(userMessage)) {
    return "Tesekkurler, her zaman yazabilirsiniz. 😊";
  }

  const kisaTesekkur = [
    "cok iyi", "çok iyi", "super", "süper", "harika", "mukemmel", "mükemmel",
    "cok guzel", "çok güzel", "sahane", "şahane", "tesekkur", "teşekkür",
    "teşekkürler", "tesekkurler", "tamam", "ok", "okey", "tamamdir",
    "sagol", "sağol", "eyvallah"
  ];
  if (lower.trim().length < 25 && kisaTesekkur.includes(lower.trim())) {
    return "Tesekkurler, sizi klinigimizde gormekten memnuniyet duyariz. ✨";
  }

  // Kas kaldirma / goz cekme tespiti
  const kasKaldirma = /ka[sş][ıi]?\s*(kald[ıi]r|kald[ıi]rma|yukar)/.test(lower);
  const gozCekme = /g[oö]z\s*(çekme|cekme|çekik|cekik|kald[ıi]r)/.test(lower) ||
    lower.includes("çekiklik") || lower.includes("cekiklik") ||
    lower.includes("çekik") || lower.includes("cekik");
  const botoxVar = lower.includes("botox") || lower.includes("botoks");

  if (lower.includes("kalici") || lower.includes("kalıc") || lower.includes("kac ay")) {
    if (ctx && ctx.lastTopic === 'dudak') {
      return "Dudak dolgumuzun kaliciligi 10-12 ay arasindadir. Cok dogal erir. 😊";
    }
    if (ctx && ctx.lastTopic === 'botox') {
      return "Botoks 5-6 aydir, duzenli yaptirdiginizda sure uzuyor. ✨";
    }
    if (ctx && ctx.lastTopic === 'nazolabial') {
      return "Nazolabial dolgumuz 10-12 ay kalicidir. 😊";
    }
    if (ctx && ctx.lastTopic === 'gozalti') {
      return "Goz alti isik dolgumuz 10-12 ay kalicidir. 😊";
    }
    if (lower.includes("dudak") || !lower.includes("botox")) {
      return "Dudak dolgumuzun kaliciligi 10-12 ay arasindadir, cok dogal erir. 😊";
    }
    return "Botoks 5-6 aydir, duzenli yaptirdiginizda sure uzuyor. ✨";
  }

  if (lower.includes("adres") || lower.includes("konum") || lower.includes("nerede")) {
    updateContext(senderId, "adres");
    return "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb 📍";
  }

  if (
    lower.includes("cesme") || lower.includes("çeşme") ||
    lower.includes("alacati") || lower.includes("alaçatı") ||
    lower.includes("cesmede") || lower.includes("alacatida") ||
    lower.includes("alaçatıda")
  ) {
    updateContext(senderId, "cesme");
    if (
      lower.includes("randevu") || lower.includes("ne zaman") ||
      lower.includes("geliyosunuz") || lower.includes("geliyorsunuz") ||
      lower.includes("musait") || lower.includes("saat") ||
      lower.includes("gun") || lower.includes("gün")
    ) {
      return "Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda musaitligimiz var. Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 arasinda var. Hangisi size uyar? 😊";
    }
  }

  if (
    lower.includes("acik mi") || lower.includes("acikmi") ||
    lower.includes("geliyorum") || lower.includes("musait misiniz") ||
    lower.includes("bugun acik") || lower.includes("ne zaman acik") ||
    lower.includes("calisiyor")
  ) {
    return "Evet, su an musaitligimiz " + MUSAITLIK_TAM;
  }

  // Botox ile kas kaldirma -> kaldirma dozu cevabi
  if (botoxVar && kasKaldirma) {
    updateContext(senderId, "botox");
    return "Botox yaparken kaslarin ucundan kaldirma dozu da veriyoruz. 😊";
  }

  // Daha fazla cekiklik / goz cekme / botoxsuz kas kaldirma -> Badem Goz
  if (
    lower.includes("badem goz") || lower.includes("badem göz") ||
    gozCekme || kasKaldirma
  ) {
    updateContext(senderId, "bademgoz");
    return BADEM_GOZ_CEVAP;
  }

  if (lower.includes("dudak")) {
    updateContext(senderId, "dudak");
  } else if (
    lower.includes("botox") || lower.includes("botoks") ||
    lower.includes("alin") || lower.includes("kaz ayagi") ||
    lower.includes("kas arasi")
  ) {
    updateContext(senderId, "botox");
  } else if (lower.includes("nazolabial") || lower.includes("nazal")) {
    updateContext(senderId, "nazolabial");
  } else if (lower.includes("goz alti") || lower.includes("isik")) {
    updateContext(senderId, "gozalti");
  } else if (lower.includes("sakak")) {
    updateContext(senderId, "sakak");
  } else if (lower.includes("burun")) {
    updateContext(senderId, "burun");
  } else if (lower.includes("ip aski") || lower.includes("ip askı")) {
    updateContext(senderId, "ipaski");
  } else if (lower.includes("sivi") || lower.includes("sıvı")) {
    updateContext(senderId, "siviyuz");
  }

  if (lower.includes("dudak")) {
    if (
      lower.includes("fiyat") || lower.includes("ne kad") ||
      lower.includes("kadr") || lower.includes("kdr") ||
      lower.includes("ucret") || lower.includes("tl") ||
      lower.includes("kac") || lower.includes("kaç") ||
      lower.includes("alacati") || lower.includes("cesme") ||
      lower.includes("dudak dolgusu")
    ) {
      return "Dudak dolgusu 1 cc Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL). Fiyatlarimiz her iki subemizde de ayni. 😊";
    }
  }

  if (lower.includes("nazolabial") || lower.includes("nazalobial") || lower.includes("nazolab")) {
    return "Nazolabial dolgu 1 cc 3800 TL nakit, 5400 TL KK. Normal fiyat. 😊";
  }

  if (lower.includes("yarim") && (lower.includes("cc") || lower.includes("dudak"))) {
    return "Evet yarim yapiyoruz. Yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit. 1 cc Elasty 3800 TL KK 5400, Juvederm 5400 TL KK 7800. 😊";
  }

  if (lower.includes("sakak") && !lower.includes("dudak") && !lower.includes("nazo")) {
    return "Sakak dolgusu 4500 TL nakit. 😊";
  }

  if (lower.includes("burun") && lower.includes("dolgu")) {
    return "Burun dolgusu 5200 TL nakit. 😊";
  }

  // Somon DNA / Paris Isiltisi nedir
  if (
    (lower.includes("paris") || lower.includes("somon")) &&
    (lower.includes("nedir") || lower.includes("ne ise yar") ||
     lower.includes("ne işe yar") || lower.includes("ne demek") ||
     lower.includes("nasil bir"))
  ) {
    return "Peptit ve amino asit iceren mezoterapi uygulamalaridir. Parilti ve canlilik katar, botoksla harika bir kombindir. ✨";
  }

  if (lower.includes("paris") || lower.includes("somon") || lower.includes("genclik")) {
    return "Paris Isiltisi, Somon DNA ve Genclik Asisi hepsi bir arada 3500 TL nakit kampanya. ✨";
  }

  if (
    lower.includes("doktor mu") || lower.includes("kim yapiyor") ||
    lower.includes("tecrubeli") || lower.includes("hocamiz kim") ||
    lower.includes("uzman mi")
  ) {
    return "Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir. ✨";
  }

  if (lower.includes("goz alti") || lower.includes("isik dolgu") || lower.includes("gozalti")) {
    return "Goz alti isik dolgusu 5200 TL kampanya, normal 7000 TL. 😊";
  }

  if (lower.includes("cene") && (lower.includes("dolgu") || lower.includes("fiyat") || lower.includes("ne kad"))) {
    return "Cene dolgusu 3800 TL nakit. 😊";
  }

  if (lower.includes("radiesse")) return "Radiesse 19000 TL nakit. ✨";
  if (lower.includes("novuma")) return "Novuma 14000 TL nakit. 😊";

  if (lower.includes("ip aski") || lower.includes("ip askı")) {
    if (lower.includes("6") && (lower.includes("2 ml") || lower.includes("sivi") || lower.includes("sıvı"))) {
      return "x6 Adet Ip Aski + 2 ML Sivi Yuz Germe 16000 TL Nakit Odeme Kampanyamiz var. 😊";
    }
    if (lower.includes("8") && (lower.includes("2 ml") || lower.includes("sivi") || lower.includes("sıvı"))) {
      return "x8 Adet Ip Aski + 2 ML Sivi Yuz Germe 18000 TL Nakit Odeme Kampanyamiz var. ✨";
    }
    return "Ip Aski 6 adet 16000 TL nakit (KK 22000 TL), 8 adet 18000 TL nakit (KK 25000 TL). Kampanyamiz: x6 Adet + 2 ML Sivi Yuz Germe 16000 TL, x8 Adet + 2 ML Sivi Yuz Germe 18000 TL Nakit. 😊";
  }

  if (
    (lower.includes("sakak") || lower.includes("saka")) &&
    lower.includes("dudak") &&
    (lower.includes("nazol") || lower.includes("nazal"))
  ) {
    return "Sakak 4500 TL nakit. Nazolabial 1 cc 3800 TL nakit KK 5400. Dudak 1 cc Elasty 3800 TL KK 5400, Juvederm 5400 TL KK 7800. 😊";
  }

  if (
    lower.includes("botox") || lower.includes("botoks") ||
    lower.includes("alin") || lower.includes("kaz ayagi") ||
    lower.includes("kas arasi")
  ) {
    return "Alin, kas arasi ve kaz ayaklarinin yanina ihtiyaca gore burun kenari ve dudak ustu cizgilere kucuk atislar yapiyoruz, toplam 5 bolge. Kaslarin ucundan kaldirma dozu da veriyoruz. Allergan 3800 TL nakit, Dysport 4400 TL nakit, hediye Somon DNA + Paris Isiltisi. ✨";
  }

  if (
    lower.includes("sivi yuz") || lower.includes("sıvı yüz") ||
    (lower.includes("sivi") && lower.includes("germe"))
  ) {
    return "Sivi Yuz Germe: 6 ML PLLA Eldermafill marka Sivi Yuzgerme + 5 Bolge Botox + Paris Isiltisi + Somon DNA 21000 TL nakit. ✨";
  }

  if (
    lower.includes("randevu alabilir") || lower.includes("randevu al") ||
    lower.includes("randevu nasil") ||
    (lower.includes("randevu") && lower.length < 80)
  ) {
    return "Tabii, su an musaitligimiz " + MUSAITLIK_TAM;
  }

  if (lower.match(/\d{2}:\d{2}/)) {
    if (
      lower.includes("carsamba") || lower.includes("cumartesi") ||
      lower.includes("pazar") || lower.includes("pazartesi") ||
      lower.includes("persembe") || lower.includes("cesme") ||
      lower.includes("alacati") || lower.includes("alaçatı")
    ) {
      return "Belirttiginiz saatte randevunuzu olusturabiliriz. Isminizi ve telefon numaranizi alabilir miyim? 😊";
    }
  }

  try {
    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    for (const model of models) {
      try {
        const systemContent =
          SYSTEM_PROMPT +
          "\nGreeted:" + (isGreeted ? "EVET - merhaba deme" : "HAYIR") +
          " LastTopic:" + (ctx ? ctx.lastTopic : "yok");

        const res = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: model,
            messages: [
              { role: "system", content: systemContent },
              { role: "user", content: userMessage }
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
          if (isGreeted) {
            text = text.replace(/Merhaba, ben GuGu Clinic'ten Aida\.?\s*/gi, "");
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
    return "Bu konuda detayli bilgi icin 0534 248 94 70'ten arayabilirsiniz. 😊";
  }
}

app.get('/webhook', function (req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', async function (req, res) {
  const body = req.body;
  if (body.object === 'instagram' || body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');
    for (const entry of body.entry) {
      try {
        const m = entry.messaging ? entry.messaging[0] : null;
        if (m && m.message) {
          if (m.message.is_echo) {
            console.log("Echo atlandi: " + (m.message.text || "").slice(0, 80));
            continue;
          }
          if (!m.message.text) continue;
          if (isDuplicate(m.sender.id, m.message.text)) {
            console.log("Duplicate atlandi");
            continue;
          }
          const ctxNow = getContext(m.sender.id);
          console.log("Gelen Mesaj: " + m.message.text + " | Context: " + (ctxNow ? ctxNow.lastTopic : "yok"));
          const isGreeted = greetedUsers.has(m.sender.id);
          const reply = await getGroqReply(m.message.text, m.sender.id, isGreeted);
          if (!isGreeted) greetedUsers.set(m.sender.id, Date.now());
          await sendSplitMessages(m.sender.id, reply);
        }
      } catch (e) {
        console.log("Mesaj isleme hatasi: " + e.message);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

app.get('/', function (req, res) {
  res.send('Bot Aktif! Aida v42 - Guncel Prompt - Emoji - Guncel Fiyatlar');
});

app.listen(PORT, function () {
  console.log("Sunucu " + PORT + " portunda... Aida v42 - Guncel Prompt - Emoji - Guncel Fiyatlar");
});
