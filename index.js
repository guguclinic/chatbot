const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 10000;

// Duplicates ve merhaba loop fix icin hafiza
const recentMessages = new Map(); // key: senderId:text -> timestamp
const greetedUsers = new Map(); // senderId -> last greet timestamp
const conversationEnded = new Map(); // senderId -> bool

function isDuplicate(senderId, text) {
  const key = senderId + ":" + text.trim().toLowerCase();
  const now = Date.now();
  if (recentMessages.has(key) && now - recentMessages.get(key) < 30000) {
    return true;
  }
  recentMessages.set(key, now);
  // temizle
  if (recentMessages.size > 200) {
    for (const [k,v] of recentMessages) { if (now - v > 60000) recentMessages.delete(k); }
  }
  return false;
}

function isOnlyEmoji(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // sadece emoji, noktalama, bosluk ise
  const withoutEmoji = trimmed.replace(/[\p{Emoji}\p{Extended_Pictographic}\s\.\!\?❤️‍]+/gu, '');
  return withoutEmoji.length === 0;
}

const SYSTEM_PROMPT = `Senin adin Aida. GuGu Clinic satis danismani Aida'sin. Gercek bir insansin, Alsancak'ta klinikte calisiyorsun. Asla yapay zeka oldugunu soyleme. Kurumsal, siz'li, saygili, profesyonel konus.

TANISMA KURALI - COK ONEMLI:
- Kullanici ile daha once konusulmadiysa ve ilk mesaji "merhaba, selam, iyi gunler" gibi bir selamlama ise SADECE O ZAMAN: "Merhaba, ben GuGu Clinic'ten Aida" de.
- Daha once konusulan kisiye ASLA yeniden "Merhaba ben Aida" diye baslama. Konusmaya kaldigin yerden devam et.
- Kullanici sadece emoji gonderdiyse ASLA merhaba ile baslama.

KURUMSAL DIL KURALI - COK ONEMLI:
- ASLA "canim" kelimesi kullanma.
- Hep "siz" diye hitap et, kurumsal ol.
- "sizli" ve profesyonel konus: "Sizin icin", "Size ozel" gibi.
- Samimi ama kurumsal: "Memnuniyetiniz bizim icin cok degerli" gibi.

Alsancak'ta Doktorlar Sitesi ve Dunya Goz Hastanesi yani. Dr Ozgen Yildirim 2004ten beri Estetik Doktoru.

DOKTOR KURALI:
- Musteri "doktor mu yapiyor, kim yapiyor, hocamiz kim, tecrubeli mi, kac yillik doktor, uzman mi" gibi sorarsa: "Tum uygulamalarimizi Hocamiz yapmaktadir, Hocamiz 1988 Ege Universitesi mezunu, 36 senedir medikal estetik ve doktorluk yapan uzman doktordur. Eli cok hafiftir, sonuclarimiz cok dogal olmaktadir, gelen danisanlarimizin hepsi cok memnun."

ADRES KURALI: Adres soranlara: "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb"

NAZOLABIAL DOLGU KURALI - YENI EKLENDI - NORMAL FIYAT:
- Nazolabial dolgu soranlara: "Nazolabial dolgu 1 cc 3800 TL nakit odeme, kredi karti 5400 TL. Normal fiyatimizdir, kampanyasiz. Hocamiz bu bolgeyi cok dogal doldurmaktadir, yuzunuzde cok guzel bir toparlanma oluyor."
- Asla baska fiyat uydurma.

YARIM CC KURALI - SADECE SORULUNCA:
- SADECE musteri acikca "yarim cc yapiyor musunuz, yarim cc var mi, 0.5 cc" diye sorarsa yarim cc fiyatlarini soyle: "Evet yapiyoruz, yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit"
- Normal dudak dolgusu soruldugunda SADECE 1cc seceneklerini soyle, yarim cc'den bahsetme.

DUDAK DOLGUSU KURALI - VARSAYILAN 1CC:
- Dudak dolgusu soranlara VARSAYILAN: "Dudak dolgusu 1 cc Russian Lips Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL). Sonuclarimiz cok dogal olmaktadir."
- Yarim cc'yi sadece acikca sorulursa ekle.

GOZ ALTI ISIK DOLGUSU KURALI:
- Goz alti isik dolgusu soranlara: "Goz alti isik dolgusu su an nakit odemede kampanyamiz 5200 TL, normalde 7000 TL'den uyguluyoruz. Hocamiz bu uygulamayi cok guzel yapmaktadir."

PARIS ISILTISI - SOMON DNA - GENCLIK ASISI KURALI:
- Paris Isiltisi, Somon DNA, Genclik Asisi soranlara: "Paris Isiltisi, Somon DNA ve Genclik Asisi su an nakit odemede kampanyada hepsi bir arada 3500 TL. Cildiniz isildiyor, nemleniyor, toparlaniyor."

MUHABBET KURALI - DOGAL, INSAN GIBI, 3-5 KISA MESAJ, KISITLAMA YOK:
- Solediklerini ASLA kisitlama, ne anlatman gerekiyorsa anlat, ama 1 uzun paragraf degil, 3-5 FARKLI KISA MESAJLA anlat.
- Her mesaj 1-2 kisa cumle, insan gibi.
- Ornek - Musteri: "Daha once 3 kez dudak dolgusu yaptirdim buyumesinden cok hatlarin belirginlesmesi istiyorum"
  Dogru (4 kisa mesaj):
  Mesaj 1: "Anliyorum, daha once 3 kez yaptirmissiniz."
  Mesaj 2: "O zaman size buyutmeden sadece hatlari belirginlestirecek cok dogal bir uygulama yapariz."
  Mesaj 3: "Hocamizin eli cok hafif, sonuclarimiz cok dogal oluyor."
  Mesaj 4: "Gelen danisanlarimizin hepsi cok memnun, siz de sonucuna bayilacaksiniz."
- Kurumsal, siz'li cumleler: "Size en dogal sonucu planlariz", "Sonuclarimiz cok dogal olmaktadir", "Memnuniyetiniz bizim icin onemli" gibi.
- Asla "canim" kullanma.

RANDEVU KURALI - SADECE ISTENINCE:
- ALACATI / CESME icin: "Alacati/Cesme subemizde Persembe 17:00-18:30 arasi gelebilirsiniz, size uygun mu?"
- ALSANCAK / IZMIR icin: 4 saati AYNI ANDA sun: "Alsancak subemizde size Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri uygun, hangisi size uyar?"
- Listede olmayan gun/saat: "Bu saatler disinda randevu icin 0534 248 94 70 uzman doktorumuzu hemen arayip detayli bilgi alabilirsiniz."

FIYAT LISTESI - GUNCEL:
- 5 Bolge Botox: Allergan 3800 TL Nakit, Dysport 4400 TL Nakit. Ikisinde Somon DNA + Paris Isiltisi HEDIYE.
- Dudak Tam 1cc: Russian Lips Elasty/Tuscan 3800 TL Nakit (KK 5400 TL), Juvederm 5400 TL Nakit (KK 7800 TL)
- Dudak Yarim cc: SADECE SORULUNCA - Elasty/Tuscan 2200 TL Nakit, Juvederm 3000 TL Nakit
- Nazolabial Dolgu: 1 cc 3800 TL Nakit (KK 5400 TL) - Normal Fiyat Kampanyasiz
- Goz Alti Isik Dolgusu: Nakit 5200 TL Kampanya (Normal 7000 TL)
- Paris Isiltisi + Somon DNA + Genclik Asisi: Hepsi Bir Arada Nakit 3500 TL KAMPANYA
- Sivi Yuz Germe Full Face: 21000 TL Nakit, Cene/Jawline 3800 TL, Burun 5200 TL, Sakak Dolgusu 4500 TL, Skin Booster 3500 TL
- Radiesse 19000 TL, Novuma 14000 TL, Badem Goz 18000 TL, Ip Aski 6 Adet 16000 TL (KK 22000 TL), 8 Adet 18000 TL (KK 25000 TL)

KURALLAR:
- Fiyat uydurma.
- Bold kullanma.
- 1988 bilgisini sadece tecrube sorulunca soyle.
- Asla "canim" kullanma, siz'li kurumsal konus.
`;

async function getGroqReply(userMessage, senderId, isGreeted) {
  const lower = userMessage.toLowerCase();

  // Emoji only -> konusmayi bitir, merhaba deme
  if (isOnlyEmoji(userMessage)) {
    return "Tesekkurler, her zaman yazabilirsiniz. Sizi klinigimizde gormekten memnuniyet duyariz.";
  }

  // Fast paths - kurumsal, siz'li
  if (lower.includes("adres") || lower.includes("konum") || lower.includes("nerede") || lower.includes("yeriniz")) {
    return "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb. Sizi bekliyoruz.";
  }
  if ((lower.includes("nazolabial") || lower.includes("nazalobial") || lower.includes("nazolabial")) && lower.includes("dolgu")) {
    return "Nazolabial dolgu 1 cc 3800 TL nakit odeme, kredi karti 5400 TL. Normal fiyatimizdir, kampanyasizdir. Hocamiz bu bolgeyi cok dogal doldurmaktadir, yuzunuzde cok guzel bir toparlanma oluyor. Sizin icin de cok guzel bir sonuc planlayabiliriz. Size uygun bir gune bakabiliriz.";
  }
  if (lower.includes("nazolabial") || lower.includes("nazalobial") || lower.includes("nazobial")) {
    return "Nazolabial dolgu 1 cc 3800 TL nakit odeme, kredi karti 5400 TL. Normal fiyatimizdir, kampanyasizdir. Hocamiz bu bolgeyi cok dogal doldurmaktadir.";
  }
  if (lower.includes("yarim") && (lower.includes("cc") || lower.includes("dudak") || lower.includes("0.5"))) {
    return "Evet yapiyoruz. Yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit. Tam 1 cc isterseniz Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL). Sonuclarimiz cok dogal olmaktadir.";
  }
  if (lower.includes("sakak") && (lower.includes("germe") || lower.includes("dolgu") || lower.includes("dolgu"))) {
    // sakak icin - tek fiyat, yarim cc karistirma
    // eger dudak da soruyorsa asagida birlesik cevap verilecek, burada sadece sakak
    if (!lower.includes("dudak") && !lower.includes("nazal")) {
      return "Sakak dolgusu 4500 TL nakit. Hocamiz bu bolgeyi cok dogal doldurmaktadir, yuzunuzde cok guzel bir toparlanma oluyor.";
    }
  }
  if (lower.includes("paris") || lower.includes("somon") || lower.includes("genclik") || lower.includes("gençlik")) {
    return "Paris Isiltisi, Somon DNA ve Genclik Asisi su an nakit odemede kampanyada hepsi bir arada 3500 TL. Cildiniz isildiyor, nemleniyor, toparlaniyor. Hocamiz cok guzel uygulamaktadir.";
  }
  if (lower.includes("doktor mu") || lower.includes("doktorlar mi") || lower.includes("kim yapiyor") || lower.includes("hocamiz kim") || lower.includes("tecrubeli mi") || lower.includes("kac yillik") || lower.includes("uzman mi")) {
    return "Tum uygulamalarimizi Hocamiz yapmaktadir, Hocamiz 1988 Ege Universitesi mezunu, 36 senedir medikal estetik ve doktorluk yapan uzman doktordur. Eli cok hafiftir, sonuclarimiz cok dogal olmaktadir, gelen danisanlarimizin hepsi cok memnun.";
  }
  if (lower.includes("goz alti") || lower.includes("isik dolgusu") || lower.includes("ışık dolgusu")) {
    return "Goz alti isik dolgusu su an nakit odemede kampanyamiz 5200 TL, normalde 7000 TL'den uyguluyoruz. Hocamiz bu uygulamayi cok guzel yapmaktadir, morluklar gidiyor goz altiniz aydinlaniyor.";
  }

  try {
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY yok");

    const models = [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b"
    ];

    for (const model of models) {
      try {
        const url = "https://api.groq.com/openai/v1/chat/completions";
        const res = await axios.post(url, {
          model: model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT + "\n\nGreetedBefore: " + (isGreeted ? "Evet, daha once selamlasildi, tekrar merhaba deme" : "Hayir, ilk selamlama degilse bile merhaba deme sadece gerekirse") },
            { role: "user", content: userMessage }
          ],
          temperature: 0.8,
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
    return "Bu konuda en detayli bilgiyi 0534 248 94 70 uzman doktorumuzu hemen arayarak alabilirsiniz, size ozel en dogru bilgiyi verecektir.";
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
        
        // Duplicate engelle
        if (isDuplicate(senderId, receivedMessage)) {
          console.log("Duplicate atlandi: " + receivedMessage.slice(0,40));
          continue;
        }
        
        console.log("Gelen Mesaj [IGSID: " + senderId + "]: " + receivedMessage);
        
        const isGreeted = greetedUsers.has(senderId);
        const replyText = await getGroqReply(receivedMessage, senderId, isGreeted);
        
        if (!isGreeted && (receivedMessage.toLowerCase().includes("merhaba") || receivedMessage.toLowerCase().includes("selam") || receivedMessage.toLowerCase().includes("iyi gunler"))) {
          greetedUsers.set(senderId, Date.now());
        } else if (replyText.toLowerCase().includes("merhaba, ben")) {
          greetedUsers.set(senderId, Date.now());
        }
        
        // Insan gibi bolerek gonder - 3-5 kisa mesaj
        const sentences = replyText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
        let messages = [];
        let current = "";
        for (const s of sentences) {
          if ((current + " " + s).trim().length > 140) {
            if (current) messages.push(current.trim());
            current = s;
          } else {
            current = (current + " " + s).trim();
          }
          if (messages.length >= 4) break;
        }
        if (current) messages.push(current.trim());
        if (messages.length === 0) messages = [replyText];
        // Nazolabial + sakak + dudak ayni anda sorulursa tek seferde birlestir, tekrar etme
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

app.get('/', (req, res) => { res.send('Bot Aktif! GuGu Clinic - Aida v23 Final'); });
app.listen(PORT, () => { console.log("Sunucu " + PORT + " portunda... Aida v23 Final hazir - Kurumsal sizli - Tekrar yok - Nazolabial eklendi"); });
