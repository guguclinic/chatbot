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
const chatHistory = new Map();
const muayeneSoruldu = new Map();
const randevuTalebi = new Map();
const pending = new Map();
const processing = new Set();

const BIRLESTIRME_MS = 4000;

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function trTarih(offsetGun) {
  const d = new Date(Date.now() + (offsetGun || 0) * 86400000);
  return d.toLocaleDateString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

function telefonVarMi(text) {
  const digits = text.replace(/\D/g, "");
  return /5\d{9}/.test(digits);
}

function addHistory(senderId, role, content) {
  const h = chatHistory.get(senderId) || [];
  h.push({ role: role, content: content });
  while (h.length > 8) h.shift();
  chatHistory.set(senderId, h);
}

function getHistory(senderId) {
  return chatHistory.get(senderId) || [];
}

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
      await sleep(800 + Math.random() * 500);
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

SATIS VE RANDEVU KURALI (COK ONEMLI):
- HER cevabin sonuna konusulan konuyla ilgili TEK bir kisa soru ekle ve musteriyi nazikce randevuya yonlendir. (Randevu talebi alindiktan sonra bu kural gecerli degil, asagiya bak.)
- Soru konuyla alakali olsun. Ornek: dudak konusuluyorsa "Dogal bir gorunum mu yoksa daha belirgin bir dolgunluk mu dusunuyorsunuz?", botox konusuluyorsa "Daha cok hangi bolgedeki cizgiler sizi rahatsiz ediyor?", fiyat soruldugunda "Size uygun bir gun ayarlayalim mi?"
- Musteriyi ikna et: uygulamayi Dr Ozgen Yildirim'in yaptigini, sonuclarin dogal oldugunu, kampanyalarin ve hediye uygulamalarin oldugunu gerektiginde dogal sekilde hatirlat. Baskici olma, sicak ve guven veren bir dil kullan.
- Ayni soruyu veya ayni cumleyi arka arkaya tekrarlama. Konusma gecmisine bak.
- Soru cevabin EN SONUNDA olsun, tek soru isareti kullan.
- "Ucretsiz muayene" teklifini KENDIN YAPMA. Bu teklifi sistem konusma basina bir kere otomatik ekliyor. Musteri ucretsiz muayeneyi kendisi sorarsa evet ucretsiz muayene yapiyoruz de.

RANDEVU AKISI (COK ONEMLI):
- Sen randevuyu sisteme KAYDEDEMEZSIN. "Randevunuz kaydedildi / olusturuldu / ayarlandi" ASLA deme.
- Gun, saat, sube, isim ve telefon alininca su cumleyi kur: "Talebinizi aldim, ekibimiz sizi arayarak randevunuzu kesinlestirecek. 😊"
- Eksik bilgiyi sirayla iste: once gun ve sube, sonra saat, sonra isim ve telefon (ikisini tek mesajda iste). Her mesajda sadece eksik olani sor.
- Musteri isim ve telefonu verdiyse bir daha ISTEME, teyit de isteme.
- Sadece musaitlik listesindeki gun ve saatlerde randevu oner. Aralik disinda saat isterse nazikce en yakin uygun saati oner. Araligin bitis saatine randevu verme (ornegin Pazartesi 16:30-19:00 araligi icin en gec 18:30 oner).
- "Yarin, bugun, haftaya" gibi ifadelerde sistem bilgisindeki tarihe bak. O gun musaitlik yoksa bunu soyle ve en yakin uygun gunu oner.
- Randevu talebi alindiktan sonra (RandevuTalebiAlindi:EVET) tekrar randevu sorusu SORMA, kapanis sorusu ekleme. Sadece yardimci ol (konum, hazirlik, tesekkur) ve "sizi bekliyoruz" de.

ON GORUSME / MUAYENE:
- Musteri "on gorusme", "muayene", "gorusmek istiyorum" derse ucretsiz on gorusme yaptigimizi soyle ve hemen gun/sube sor.

OTOPARK:
- Klinigimizin otoparki vardir. Otoparkin ucretli/ucretsiz olmasi, kapasitesi, tam yeri gibi detaylari BILMIYORSUN, uydurma. Detay sorulursa: "Otopark imkanimiz mevcut, detayi randevu teyidinde ekibimiz iletecektir. 😊"

BILGI UYDURMA YASAK:
- Listede olmayan hicbir bilgiyi (yol tarifi, odeme taksit, uygulama suresi, seans sayisi vb.) uydurma. Emin degilsen: "Bu konuda net bilgiyi randevu teyidinde ekibimiz size iletecektir. 😊" de.

TANISMA:
- Sadece ilk selamlamada bir kere: "Merhaba, ben GuGu Clinic'ten Aida." de.
- Konusma devam ediyorsa tekrar kendini tanitma. Mesaj sadece emoji ise merhaba deme.

DOKTOR (sadece "doktor mu yapiyor, doktor kim, kim yapiyor, hocamiz kim, tecrubeli mi, uzman mi" diye sorulursa):
"Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir, sonuclarimiz cok dogal olmaktadir." Fiyat sorulunca doktor bilgisi ekleme.
Doktorun adi tam olarak "Dr Ozgen Yildirim" seklinde yazilir, harf degistirme.

ADRES (sadece sorulursa):
"Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb 📍"

MUSAITLIK (sadece randevu/musaitlik sorulunca):
"Su an musaitligimiz Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar?"

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

GENEL SORULAR:
- Musteri listede olmayan genel bir soru sorarsa (cilt bakimi, estetik hakkinda genel merak, nasil yapilir, aci verir mi, kac seans gibi) kendi bilginle dogal ve sicak sekilde 2-3 cumleyle cevap ver, sonra klinige davet et.
- Her zaman telefona yonlendirme. Sadece fiyat, kampanya veya tibbi karar gerektiren konularda yonlendir.

SINIRLAR:
- Listede olmayan FIYAT veya KAMPANYAYI uydurma. Fiyat konusunda emin degilsen: "Guncel fiyat icin 0534 248 94 70'ten ulasabilirsiniz."
- Tibbi tavsiye, tani, ilac/hamilelik/alerji gibi saglik sorularinda yorum yapma, doktorumuzla gorusmeye veya telefona yonlendir.
- "Kesin sonuc", "risksiz", "%100" gibi garanti ifadeleri kullanma.
- Diger klinikleri kotuleme.
`;

const MUSAITLIK_TAM = "Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar? 😊";

const BADEM_GOZ_CEVAP = "Badem Goz uyguluyoruz, nakit odemede 18000 TL, KK ile odemede normal fiyat 25000 TL. 😊";

// Konusma basina sadece BIR kere eklenir
const MUAYENE_CUMLESI = "Muayene sonrasi size de uygunsa uygulamayi yapabiliriz, ucretsiz muayene randevusu ister misiniz? 😊";

const KAPANIS_SORULARI = {
  dudak: [
    "Dogal bir gorunum mu yoksa daha belirgin bir dolgunluk mu dusunuyorsunuz? Size uygun bir gun ayarlayalim mi? 😊",
    "Dudak formunuzda en cok neyi degistirmek istersiniz? Isterseniz bu hafta icin randevu olusturalim. ✨"
  ],
  botox: [
    "Daha cok hangi bolgedeki cizgiler sizi rahatsiz ediyor? Isterseniz hemen bir randevu olusturalim. 😊",
    "Botoksu ilk kez mi yaptiracaksiniz? Size uygun bir gun ayarlayalim mi? ✨"
  ],
  nazolabial: [
    "Nazolabial cizgileriniz sizi en cok hangi anlarda rahatsiz ediyor? Size uygun bir gun ayarlayalim mi? 😊"
  ],
  gozalti: [
    "Goz altinda daha cok morluk mu yoksa cokukluk mu var? Isterseniz bir degerlendirme icin randevu olusturalim. 😊"
  ],
  sakak: [
    "Sakaklarinizdaki cokuklugu ne zamandir fark ediyorsunuz? Size uygun bir gun ayarlayalim mi? 😊"
  ],
  burun: [
    "Burunda nasil bir degisiklik dusunuyorsunuz? Isterseniz Hocamizla yuz yuze gorusmek icin randevu olusturalim. 😊"
  ],
  ipaski: [
    "Yuzunuzde en cok hangi bolgenin kalkmasini istiyorsunuz? Size uygun bir gun ayarlayalim mi? ✨"
  ],
  siviyuz: [
    "Yuzunuzde daha cok hangi bolgede sarkma veya hacim kaybi goruyorsunuz? Isterseniz randevu olusturalim. 😊"
  ],
  bademgoz: [
    "Gozunuzde ne kadar bir cekiklik dusunuyorsunuz? Isterseniz Hocamizla gorusmek icin randevu olusturalim. ✨"
  ],
  cene: [
    "Cene hattinizda nasil bir sekil dusunuyorsunuz? Size uygun bir gun ayarlayalim mi? 😊"
  ],
  paris: [
    "Botoksla birlikte yaptirmayi dusunur musunuz? Isterseniz birlikte planlayip randevu olusturalim. ✨"
  ],
  doktor: [
    "Hocamizla yuz yuze gorusup size ozel bir plan olusturmak ister misiniz? Size uygun bir gun ayarlayalim. 😊"
  ],
  adres: [
    "Hangi gun gelmeyi dusunuyorsunuz? Size uygun bir randevu olusturalim. 😊"
  ],
  otopark: [
    "Hangi gun gelmeyi dusunuyorsunuz? Size uygun bir randevu olusturalim. 😊"
  ],
  cesme: [
    "Hangi uygulamayi dusunuyorsunuz? Size uygun bir gun ayarlayalim. 😊"
  ],
  genel: [
    "Hangi uygulamayla ilgileniyorsunuz? Isterseniz size uygun bir gun ayarlayalim. 😊",
    "Size en uygun uygulamayi birlikte belirleyip randevu olusturalim mi? ✨"
  ]
};

function konuTespit(lower) {
  if (lower.includes("badem goz") || lower.includes("badem göz")) return "bademgoz";
  if (lower.includes("dudak")) return "dudak";
  if (lower.includes("botox") || lower.includes("botoks") || lower.includes("kaz ayagi") || lower.includes("kas arasi")) return "botox";
  if (lower.includes("nazolab") || lower.includes("nazal")) return "nazolabial";
  if (lower.includes("goz alti") || lower.includes("gozalti") || lower.includes("isik dolgu")) return "gozalti";
  if (lower.includes("sakak")) return "sakak";
  if (lower.includes("burun")) return "burun";
  if (lower.includes("ip aski") || lower.includes("ip askı")) return "ipaski";
  if (lower.includes("sivi yuz") || lower.includes("sıvı yüz")) return "siviyuz";
  if (lower.includes("cene")) return "cene";
  if (lower.includes("paris") || lower.includes("somon") || lower.includes("genclik")) return "paris";
  if (lower.includes("doktor") || lower.includes("tecrubeli") || lower.includes("hocamiz") || lower.includes("uzman")) return "doktor";
  return null;
}

function kapanisSorusu(topic) {
  const liste = KAPANIS_SORULARI[topic] || KAPANIS_SORULARI.genel;
  return liste[Math.floor(Math.random() * liste.length)];
}

function soruVarMi(text) {
  return /\?[\s\p{Extended_Pictographic}\uFE0F]*$/u.test(text.trim());
}

function muayeneUygunMu(senderId, topic, reply) {
  if (muayeneSoruldu.has(senderId)) return false;
  if (!topic || topic === "genel" || topic === "adres" || topic === "cesme" || topic === "otopark") return false;
  if (reply.startsWith("Tesekkurler")) return false;
  if (reply.toLowerCase().includes("muayene")) return false;
  return true;
}

async function getGroqReply(userMessage, senderId, isGreeted) {
  const lower = userMessage.toLowerCase();
  const reply = await getReplyInner(userMessage, senderId, isGreeted);

  // Randevu talebi alindiysa kapanis sorusu / muayene teklifi ekleme
  if (randevuTalebi.has(senderId)) return reply;

  // Cevap zaten soruyla bitiyorsa veya telefon yonlendirmesiyse dokunma
  if (soruVarMi(reply) || reply.includes("0534 248")) {
    return reply;
  }

  const ctx = getContext(senderId);
  const topic = konuTespit(lower) || (ctx ? ctx.lastTopic : null) || "genel";

  if (muayeneUygunMu(senderId, topic, reply)) {
    muayeneSoruldu.set(senderId, Date.now());
    return reply + " " + MUAYENE_CUMLESI;
  }

  return reply + " " + kapanisSorusu(topic);
}

async function getReplyInner(userMessage, senderId, isGreeted) {
  const lower = userMessage.toLowerCase();
  const ctx = getContext(senderId);
  const talepVar = randevuTalebi.has(senderId);

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

  if (lower.includes("otopark")) {
    updateContext(senderId, "otopark");
    return "Evet, otopark imkanimiz mevcut. Detayi randevu teyidinde ekibimiz iletecektir. 😊";
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
      !talepVar && (
        lower.includes("randevu") || lower.includes("ne zaman") ||
        lower.includes("geliyosunuz") || lower.includes("geliyorsunuz") ||
        lower.includes("musait") || lower.includes("saat") ||
        lower.includes("gun") || lower.includes("gün")
      )
    ) {
      return "Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda musaitligimiz var. Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 arasinda var. Hangisi size uyar? 😊";
    }
  }

  if (
    !talepVar && (
      lower.includes("acik mi") || lower.includes("acikmi") ||
      lower.includes("geliyorum") || lower.includes("musait misiniz") ||
      lower.includes("bugun acik") || lower.includes("ne zaman acik") ||
      lower.includes("calisiyor")
    )
  ) {
    return "Evet, su an musaitligimiz " + MUSAITLIK_TAM;
  }

  if (botoxVar && kasKaldirma) {
    updateContext(senderId, "botox");
    return "Botox yaparken kaslarin ucundan kaldirma dozu da veriyoruz. 😊";
  }

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
    lower.includes("doktor mu") || lower.includes("doktor kim") ||
    lower.includes("doktorunuz") || lower.includes("hangi doktor") ||
    lower.includes("kim yapiyor") || lower.includes("kim yapıyor") ||
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

  // Randevu talebi alinmadiysa sabit randevu cevaplari calisir, alindiysa AI devralir
  if (!talepVar) {
    if (
      lower.includes("randevu alabilir") || lower.includes("randevu al") ||
      lower.includes("randevu nasil") ||
      (lower.includes("randevu") && lower.length < 80)
    ) {
      return "Tabii, su an musaitligimiz " + MUSAITLIK_TAM;
    }
  }

  try {
    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    for (const model of models) {
      try {
        const systemContent =
          SYSTEM_PROMPT +
          "\nGreeted:" + (isGreeted ? "EVET - merhaba deme" : "HAYIR") +
          " LastTopic:" + (ctx ? ctx.lastTopic : "yok") +
          " UcretsizMuayeneTeklifEdildi:" + (muayeneSoruldu.has(senderId) ? "EVET - tekrar etme" : "HAYIR") +
          " RandevuTalebiAlindi:" + (talepVar ? "EVET - tekrar randevu sorma, kapanis sorusu ekleme" : "HAYIR") +
          " Bugun: " + trTarih(0) + ". Yarin: " + trTarih(1) + ".";

        const messages = [{ role: "system", content: systemContent }]
          .concat(getHistory(senderId))
          .concat([{ role: "user", content: userMessage }]);

        const reqBody = {
          model: model,
          messages: messages,
          temperature: 0.6,
          max_tokens: 2000,
          reasoning_effort: "low"
        };

        const res = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          reqBody,
          {
            headers: {
              'Authorization': 'Bearer ' + GROQ_API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );

        let text = res.data.choices[0].message.content;
        if (text && text.trim()) {
          console.log("Groq calisti: " + model);
          text = text.replace(/1988.*?(mezunu|Ege).*?/gi, "");
          if (isGreeted) {
            text = text.replace(/Merhaba, ben GuGu Clinic'ten Aida\.?\s*/gi, "");
          }
          return text.slice(0, 800).trim();
        }
        console.log("Groq bos cevap: " + model);
      } catch (e) {
        const detay = e.response ? e.response.status + " " + JSON.stringify(e.response.data) : e.message;
        console.log("Groq hata: " + model + " " + detay);
        continue;
      }
    }
    throw new Error("kapali");
  } catch (err) {
    return "Bu konuda detayli bilgi icin 0534 248 94 70'ten arayabilirsiniz. 😊";
  }
}

// Pes pese gelen mesajlari birlestirip tek cevap verir
async function processBatch(senderId) {
  const p = pending.get(senderId);
  if (!p) return;

  if (processing.has(senderId)) {
    p.timer = setTimeout(function () { processBatch(senderId); }, 2000);
    return;
  }

  pending.delete(senderId);
  processing.add(senderId);

  try {
    const text = p.texts.join(" ");
    const baslangic = p.first;

    const ctxNow = getContext(senderId);
    console.log("Gelen Mesaj: " + text + " | Context: " + (ctxNow ? ctxNow.lastTopic : "yok"));

    // Telefon numarasi geldiyse randevu talebi olarak isaretle
    if (telefonVarMi(text)) {
      randevuTalebi.set(senderId, Date.now());
      console.log("YENI RANDEVU TALEBI: " + senderId + " | " + text);
    }

    const isGreeted = greetedUsers.has(senderId);
    const reply = await getGroqReply(text, senderId, isGreeted);
    if (!isGreeted) greetedUsers.set(senderId, Date.now());
    addHistory(senderId, "user", text);
    addHistory(senderId, "assistant", reply);

    // Ilk mesajdan itibaren toplam 6-12 sn
    const hedefMs = 6000 + Math.random() * 6000;
    const kalan = Math.max(0, hedefMs - (Date.now() - baslangic));
    await sleep(kalan);

    await sendSplitMessages(senderId, reply);
  } catch (e) {
    console.log("Mesaj isleme hatasi: " + e.message);
  } finally {
    processing.delete(senderId);
  }
}

function handleMessage(m) {
  try {
    if (!m || !m.message) return;
    if (m.message.is_echo) {
      console.log("Echo atlandi: " + (m.message.text || "").slice(0, 80));
      return;
    }
    if (!m.message.text) return;

    const senderId = m.sender.id;
    const text = m.message.text;

    if (isDuplicate(senderId, text)) {
      console.log("Duplicate atlandi");
      return;
    }

    let p = pending.get(senderId);
    if (!p) {
      p = { texts: [], first: Date.now(), timer: null };
      pending.set(senderId, p);
    }
    p.texts.push(text);
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(function () { processBatch(senderId); }, BIRLESTIRME_MS);
  } catch (e) {
    console.log("Mesaj alma hatasi: " + e.message);
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

app.post('/webhook', function (req, res) {
  const body = req.body;
  if (body.object === 'instagram' || body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');
    for (const entry of (body.entry || [])) {
      const list = entry.messaging || [];
      for (const m of list) {
        handleMessage(m);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

app.get('/', function (req, res) {
  res.send('Bot Aktif! Aida v47');
});

app.listen(PORT, function () {
  console.log("Sunucu " + PORT + " portunda... Aida v47");
});
