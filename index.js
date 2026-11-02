const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 10000;

// Ekip sayfadan elle yazinca bot bu sure kadar o musteriye susar
const HUMAN_PAUSE_MS = 12 * 60 * 60 * 1000;
// Pes pese gelen mesajlari birlestirme suresi
const BIRLESTIRME_MS = 4000;

const recentMessages = new Map();
const greetedUsers = new Map();
const userContext = new Map();
const chatHistory = new Map();
const userState = new Map();
const randevuTalebi = new Map();
const pending = new Map();
const processing = new Set();
const insanDevraldi = new Map();
const botMids = new Set();
const sonGonderilen = new Map();

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// Turkce karakterleri ASCII'ye cevirip kucuk harfe doner
function norm(s) {
  return String(s || "")
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u");
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

function getState(id) {
  let s = userState.get(id);
  if (!s) {
    s = { replyCount: 0, lastPush: -10, muayene: false, musaitSon: 0, adresSon: 0, erteleSon: 0 };
    userState.set(id, s);
  }
  return s;
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

// ---------- Insan devralma ----------

function anahtar(text) {
  return String(text || "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase().slice(0, 60);
}

function sonGonderilenEkle(id, text) {
  const l = sonGonderilen.get(id) || [];
  l.push({ key: anahtar(text), t: Date.now() });
  while (l.length > 20) l.shift();
  sonGonderilen.set(id, l);
}

function botMesajiMi(id, text, mid) {
  if (mid && botMids.has(mid)) return true;
  const key = anahtar(text);
  if (!key) return false;
  const l = sonGonderilen.get(id) || [];
  const now = Date.now();
  return l.some(function (x) { return now - x.t < 5 * 60 * 1000 && x.key === key; });
}

function insanAktifMi(id) {
  const bitis = insanDevraldi.get(id);
  if (!bitis) return false;
  if (Date.now() > bitis) {
    insanDevraldi.delete(id);
    return false;
  }
  return true;
}

function handleEcho(m) {
  const musteriId = m.recipient && m.recipient.id;
  if (!musteriId) return;
  const text = m.message.text || "";
  if (botMesajiMi(musteriId, text, m.message.mid)) {
    return;
  }
  const zatenAktif = insanAktifMi(musteriId);
  insanDevraldi.set(musteriId, Date.now() + HUMAN_PAUSE_MS);
  if (text) addHistory(musteriId, "assistant", text);

  const p = pending.get(musteriId);
  if (p) {
    if (p.timer) clearTimeout(p.timer);
    p.texts.forEach(function (t) { addHistory(musteriId, "user", t); });
    pending.delete(musteriId);
  }
  if (!zatenAktif) {
    console.log("INSAN DEVRALDI: " + musteriId + " | bot " + Math.round(HUMAN_PAUSE_MS / 3600000) + " saat susacak | " + text.slice(0, 60));
  }
}

// ---------- Mesaj gonderme ----------

function splitToMessages(text) {
  const parts = text.split(/(?<=[.!?]|[.!?]\s?[\p{Extended_Pictographic}\uFE0F]+)\s+(?![\p{Extended_Pictographic}\uFE0F])/u);
  if (parts.length <= 1) {
    return [text.slice(0, 900)];
  }
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
    if (insanAktifMi(recipientId)) {
      console.log("Insan devraldi, kalan mesajlar iptal");
      return;
    }
    sonGonderilenEkle(recipientId, msgs[i]);
    const r = await axios.post(
      "https://graph.facebook.com/v20.0/" + IG_ID + "/messages",
      { recipient: { id: recipientId }, message: { text: msgs[i] } },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    if (r.data && r.data.message_id) {
      if (botMids.size > 2000) botMids.clear();
      botMids.add(r.data.message_id);
    }
    console.log("Gonderildi [" + (i + 1) + "/" + msgs.length + "]: " + msgs[i]);
    if (i < msgs.length - 1) {
      await sleep(800 + Math.random() * 500);
    }
  }
}

// ---------- Prompt ----------

const SYSTEM_PROMPT = `Sen GuGu Clinic satis danismani Aida'sin. Alsancak'taki klinikte calisan bir satis danismani gibi konusursun. Samimi ama kurumsal, siz'li, saygili ve net bir dil kullan. Birisi samimi olarak insan mi yoksa yapay zeka mi diye sorarsa dogruyu soyle: "Ben GuGu Clinic'in dijital asistaniyim, detayli gorusme icin 0534 248 94 70'ten ekibimize ulasabilirsiniz." de. Bunu kendiliginden belirtme.

URSLUP:
- Instagram DM yaziyorsun. DUZ METIN yaz: yildiz (*), kalin yazi, madde isareti, numarali liste, baslik KULLANMA.
- Max 2-3 kisa cumle.
- Once musterinin sorusunu cevapla. Sorusunu cevaplamadan baska konuya gecme.
- Bir mesajda EN FAZLA BIR soru sor. Musteri onceki sorunu cevaplamadiysa yeni soru ekleme.
- Musterinin soyledigi kisitlari (calisma saati, gun, bolge) dikkate al, yok sayip ayni teklifi tekrarlama.
- Ayni bilgiyi veya ayni soruyu tekrarlama (gun/saat listesi, adres, ucretsiz muayene). Konusma gecmisine bak.
- Konusma gecmisinde "assistant" mesajlarinin bir kismini klinik ekibi elle yazmis olabilir, o bilgilerle celisme.
- Gun/saat listesini fiyat mesajlarina ekleme.
- "Canim" deme, hep "siz" de.
- Cumle sonlarina ara sira emoji koyabilirsin 😊 ✨ (her cumlede degil).

RANDEVU VE SATIS:
- Musteriyi ikna etmeye calis ama BASKI YAPMA. Her cevapta randevu isteme.
- Sistem bilgisinde RandevuTeklifiVer:HAYIR yaziyorsa bu cevapta randevu, gun veya saat SORMA; sadece bilgi ver, gerekirse konuyla ilgili bir soru sor. EVET yaziyorsa nazikce yonlendirebilirsin. Musteri kendisi randevu, gun veya saat konusuyorsa bu kural gecerli degil, akisa devam et.
- Ikna icin Dr Ozgen Yildirim'in tecrubesini, dogal sonuclari, kampanya ve hediyeleri gerektiginde hatirlat.
- "Ucretsiz muayene" teklifini KENDIN YAPMA, sistem ekliyor. Musteri sorarsa evet ucretsiz muayene/on gorusme yapiyoruz de ve gun/sube sor.
- Musteri ertelerse (dusunecegim, sonra yazarim, haberlesiriz, soz veremiyorum vb.) israr ETME. "Tabii, size uygun oldugunuzda yazabilirsiniz, sizi bekliyoruz. 😊" de. Bir daha randevu veya muayene teklif etme.

RANDEVU AKISI:
- Sen randevuyu sisteme KAYDEDEMEZSIN. "Kaydedildi, olusturuldu, ayarlandi, onaylandi" ASLA deme.
- Sira: 1) Musteriye uygun gun/saat sor veya musaitlige gore oner. 2) Gun, saat ve sube uzerinde ANLASINCA isim ve telefon iste (tek mesajda). 3) Isim ve telefon GELDIKTEN SONRA: "Talebinizi aldim, ekibimiz sizi arayarak randevunuzu kesinlestirecek. 😊"
- Gun, saat ve sube kesinlesmeden isim ve telefon ISTEME. Isim ve telefon bir kere geldiyse tekrar isteme, teyit de isteme.
- Musaitlik: Alsancak subesi Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00, Carsamba 16:30-19:00. Alacati/Cesme subesi Persembe 17:00-18:30. Baska gun veya saat YOK.
- Sadece bu araliklarda oner. Bitis saatine randevu verme (en gec bitisten 30 dakika once oner, ornek Pazartesi en gec 18:30). Musteri aralik disi saat isterse nazikce reddet ve en yakin uygun secenegi oner.
- Musterinin kisitlari uygun degilse (calisma saati vb.) bunu acikca soyle: "Maalesef bu gunlerde sizin musait oldugunuz saatlerde yerimiz yok." Zorla teklif etme, musteri isterse daha sonra yazabilecegini soyle.
- Musaitlik listesinin tamamini sadece gerektiginde ve ilk kez ver. Daha once verdiysen sadece ilgili gunu yaz.
- "Yarin, bugun, haftaya" gibi ifadelerde sistem bilgisindeki tarihe bak. O gun musaitlik yoksa soyle ve en yakin uygun gunu oner.
- Randevu talebi alindiktan sonra (RandevuTalebiAlindi:EVET) tekrar randevu sorma. Sadece yardimci ol (konum, hazirlik, tesekkur) ve "sizi bekliyoruz" de.

CALISMA SAATI:
- Randevu ile calisiyoruz. "Saat kaca kadar aciksiniz" gibi sorularda randevu saatlerini soyle (daha once verdiysen ilgili gunu hatirlat), baska soru ekleme.

SUBE:
- Alsancak ana subemiz. Izmir merkez ve Torbali, Bornova, Buca, Karsiyaka gibi bolgelerden gelenlere Alsancak'i oner. Cesme/Alacati ve cevresinden gelenlere Alacati/Cesme subesini oner. Emin degilsen hangi tarafta olduklarini sor.

ON GORUSME / MUAYENE:
- Musteri "on gorusme", "muayene", "gorusmek istiyorum" derse ucretsiz on gorusme yaptigimizi soyle ve gun/sube sor.

TANISMA:
- Sadece ilk selamlamada bir kere: "Merhaba, ben GuGu Clinic'ten Aida." de. Konusma devam ediyorsa tekrar kendini tanitma.

DOKTOR (sadece "doktor mu yapiyor, doktor kim, kim yapiyor, hocamiz kim, tecrubeli mi, uzman mi" diye sorulursa):
"Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir, sonuclarimiz cok dogal olmaktadir." Fiyat sorulunca doktor bilgisi ekleme.
Doktorun adi tam olarak "Dr Ozgen Yildirim" seklinde yazilir, harf degistirme.

ADRES (sadece sorulursa):
"Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb 📍"

OTOPARK:
- Klinigimizin otoparki vardir. Ucretli/ucretsiz, kapasite, tam yer gibi detaylari BILMIYORSUN, uydurma. Detay sorulursa: "Otopark imkanimiz mevcut, detayi randevu teyidinde ekibimiz iletecektir. 😊"

MARKALAR VE FIYAT FARKI:
- Dudak dolgusu: Elasty/Tuscan ve Juvederm. Juvederm daha hacimli, belirgin sonuc icin tercih edilir. Botox: Allergan ve Dysport. Sivi yuz germe: PLLA Eldermafill. Listede olmayan marka SOYLEME.
- "Elasty ile Juvederm arasinda fiyat farki neden" sorusuna: "Markalarin alis maliyetleri farkli oldugu icin fiyatlar da farkli, ikisi de guvenilir markalardir." de. Icerik, kalicilik gibi teknik karsilastirma uydurma.
- "Sayfanizda hangi islemler hangi markayla" gibi sorularda yukaridaki bilgileri liste yapmadan 2 cumleyle ozetle.

BOTOX ILE KAS KALDIRMA:
- Musteri "botox ile kas kaldirma" gibi bir sey sorarsa: "Botox yaparken kaslarin ucundan kaldirma dozu da veriyoruz. 😊"

KAS KALDIRMA / GOZ CEKME (BADEM GOZ):
- Musteri botoxtan bagimsiz olarak daha fazla cekiklik, goz cekme, goz cekikligi veya kas kaldirma isterse: "Badem Goz uyguluyoruz, nakit odemede 18000 TL, KK ile odemede normal fiyat 25000 TL. 😊"

SOMON DNA / PARIS ISILTISI NEDIR:
- "Peptit ve amino asit iceren mezoterapi uygulamalaridir. Parilti ve canlilik katar, botoksla harika bir kombindir. ✨" Fiyatini sadece sorarsa soyle.

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
- Listede olmayan genel bir soru sorulursa (cilt bakimi, nasil yapilir, aci verir mi, kac seans gibi) kendi bilginle dogal ve sicak sekilde 2-3 cumleyle cevap ver.
- Her zaman telefona yonlendirme. Sadece fiyat, kampanya veya tibbi karar gerektiren konularda yonlendir.

SINIRLAR:
- Listede olmayan FIYAT, MARKA, HIZMET veya KAMPANYAYI uydurma. Fiyat konusunda emin degilsen: "Guncel fiyat icin 0534 248 94 70'ten ulasabilirsiniz."
- Listede olmayan hicbir bilgiyi (yol tarifi, taksit, uygulama suresi vb.) uydurma. Emin degilsen: "Bu konuda net bilgiyi randevu teyidinde ekibimiz size iletecektir. 😊"
- Tibbi tavsiye, tani, ilac/hamilelik/alerji gibi saglik sorularinda yorum yapma, doktorumuzla gorusmeye veya telefona yonlendir.
- "Kesin sonuc", "risksiz", "%100" gibi garanti ifadeleri kullanma.
- Diger klinikleri kotuleme.
`;

const LINK = "https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb";

const MUSAITLIK_TAM = "Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar? 😊";

const MUSAITLIK_CESME = "Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda musaitligimiz var. Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 arasinda var. Hangisi size uyar? 😊";

const BADEM_GOZ_CEVAP = "Badem Goz uyguluyoruz, nakit odemede 18000 TL, KK ile odemede normal fiyat 25000 TL. 😊";

// Konusma basina sadece BIR kere
const MUAYENE_CUMLESI = "Muayene sonrasi size de uygunsa uygulamayi yapabiliriz, ucretsiz muayene randevusu ister misiniz? 😊";

// Sadece konuyla ilgili sorular (randevu istemez)
const BILGI_SORULARI = {
  dudak: ["Dogal bir gorunum mu yoksa daha belirgin bir dolgunluk mu dusunuyorsunuz? 😊", "Dudak formunuzda en cok neyi degistirmek istersiniz? ✨"],
  botox: ["Daha cok hangi bolgedeki cizgiler sizi rahatsiz ediyor? 😊", "Botoksu daha once yaptirdiniz mi? ✨"],
  nazolabial: ["Nazolabial cizgileriniz sizi en cok hangi anlarda rahatsiz ediyor? 😊"],
  gozalti: ["Goz altinda daha cok morluk mu yoksa cokukluk mu var? 😊"],
  sakak: ["Sakaklarinizdaki cokuklugu ne zamandir fark ediyorsunuz? 😊"],
  burun: ["Burunda nasil bir degisiklik dusunuyorsunuz? 😊"],
  ipaski: ["Yuzunuzde en cok hangi bolgenin kalkmasini istiyorsunuz? ✨"],
  siviyuz: ["Yuzunuzde daha cok hangi bolgede sarkma veya hacim kaybi goruyorsunuz? 😊"],
  bademgoz: ["Gozunuzde ne kadar bir cekiklik dusunuyorsunuz? ✨"],
  cene: ["Cene hattinizda nasil bir sekil dusunuyorsunuz? 😊"],
  paris: ["Botoksla birlikte yaptirmayi dusunur musunuz? ✨"],
  doktor: ["Hangi uygulama icin dusunuyorsunuz? 😊"]
};

// Randevu daveti (3 cevapta bir)
const RANDEVU_SORULARI = [
  "Isterseniz size uygun bir gun ayarlayalim mi? 😊",
  "Dilerseniz Hocamizla yuz yuze gorusmek icin bir gun belirleyelim mi? ✨"
];

const LOJISTIK_KONULAR = ["adres", "otopark", "cesme"];

function sec(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}

function konuTespit(l) {
  if (/badem goz/.test(l)) return "bademgoz";
  if (/dudak/.test(l)) return "dudak";
  if (/botox|botoks|kaz ayag|kas arasi|\balin\b/.test(l)) return "botox";
  if (/goz cek|cekiklik|kas kaldir/.test(l)) return "bademgoz";
  if (/nazolab|nazal/.test(l)) return "nazolabial";
  if (/goz alti|gozalti|isik dolgu/.test(l)) return "gozalti";
  if (/sakak/.test(l)) return "sakak";
  if (/burun/.test(l)) return "burun";
  if (/ip aski/.test(l)) return "ipaski";
  if (/sivi yuz|sivi germe/.test(l)) return "siviyuz";
  if (/\bcene\b/.test(l)) return "cene";
  if (/paris|somon|genclik/.test(l)) return "paris";
  if (/doktor|tecrubeli|hocamiz|uzman/.test(l)) return "doktor";
  return null;
}

function soruVarMi(text) {
  return /\?[\s\p{Extended_Pictographic}\uFE0F]*$/u.test(text.trim());
}

function kisalt(t, max) {
  if (t.length <= max) return t;
  const kes = t.slice(0, max);
  const i = Math.max(kes.lastIndexOf("."), kes.lastIndexOf("!"), kes.lastIndexOf("?"));
  return (i > 200 ? kes.slice(0, i + 1) : kes).trim();
}

function nc(text) {
  return { text: text, noClose: true };
}

function kalicilikCevap(l, ctx) {
  const topic = konuTespit(l) || (ctx ? ctx.lastTopic : null);
  if (topic === "botox") return "Botoks 5-6 aydir, duzenli yaptirdiginizda sure uzuyor. ✨";
  if (topic === "dudak") return "Dudak dolgumuzun kaliciligi 10-12 ay arasindadir, cok dogal erir. 😊";
  if (topic === "nazolabial") return "Nazolabial dolgumuz 10-12 ay kalicidir. 😊";
  if (topic === "gozalti") return "Goz alti isik dolgumuz 10-12 ay kalicidir. 😊";
  return null;
}

function musaitlikCevap(s, onek, metin) {
  // Son 10 dakikada verildiyse tekrar verme, AI devralsin
  if (Date.now() - s.musaitSon < 10 * 60 * 1000) return null;
  s.musaitSon = Date.now();
  return (onek || "") + (metin || MUSAITLIK_TAM);
}

const FIYAT_NIYETI = /fiyat|ne kadar|nekadar|ucret|\bkac (tl|para|lira)|\bkaca\b|\bkdr\b|\btl\b|kampanya|\bkac\s*[?]*$/;

// ---------- Cevap uretimi ----------

async function getGroqReply(userMessage, senderId, isGreeted) {
  const l = norm(userMessage);
  const s = getState(senderId);

  const raw = await getReplyInner(userMessage, senderId, isGreeted);
  if (raw === null) return null;

  const noClose = typeof raw === "object";
  const text = noClose ? raw.text : raw;
  s.replyCount++;

  // Cevap randevu iceriyorsa sayaci guncelle
  const textNorm = norm(text);
  if (/randevu|gun ayarla|hangi gun|muayene/.test(textNorm) && soruVarMi(text)) {
    s.lastPush = s.replyCount;
  }

  if (noClose) return text;
  if (randevuTalebi.has(senderId)) return text;
  if (Date.now() - s.erteleSon < 24 * 3600 * 1000) return text;
  if (soruVarMi(text) || text.includes("0534 248") || /talebinizi ald/.test(textNorm)) return text;

  const topic = konuTespit(l);
  if (!topic || LOJISTIK_KONULAR.indexOf(topic) !== -1) return text;

  const pushSure = (s.replyCount - s.lastPush) >= 3;

  if (pushSure && !s.muayene && topic !== "doktor") {
    s.muayene = true;
    s.lastPush = s.replyCount;
    return text + " " + MUAYENE_CUMLESI;
  }
  if (pushSure) {
    s.lastPush = s.replyCount;
    return text + " " + sec(RANDEVU_SORULARI);
  }
  const liste = BILGI_SORULARI[topic];
  return liste ? text + " " + sec(liste) : text;
}

async function getReplyInner(userMessage, senderId, isGreeted) {
  const l = norm(userMessage);
  const ctx = getContext(senderId);
  const s = getState(senderId);
  const talepVar = randevuTalebi.has(senderId);
  const erteleAktif = Date.now() - s.erteleSon < 24 * 3600 * 1000;

  // Harf/rakam yoksa (emoji, nokta vb.)
  if (!/[\p{L}\p{N}]/u.test(userMessage)) {
    if (!isGreeted && !talepVar) {
      return nc("Merhaba, ben GuGu Clinic'ten Aida. Size nasil yardimci olabilirim? 😊");
    }
    return null;
  }

  // Kisa tesekkur / memnuniyet
  const tesekkurler = [
    "tesekkur", "tesekkurler", "tesekkur ederim", "cok tesekkurler", "sagol", "sag ol",
    "eyvallah", "harika", "super", "mukemmel", "cok iyi", "cok guzel", "sahane",
    "tamam tesekkurler", "tamam tesekkur ederim"
  ];
  if (l.trim().length < 25 && tesekkurler.indexOf(l.trim().replace(/[.!\s]+$/, "")) !== -1) {
    return nc("Cok sevindik, sizi klinigimizde gormekten memnuniyet duyariz. ✨");
  }

  // Musteri erteliyor
  if (
    !telefonVarMi(userMessage) &&
    /haberlesel|ben (size )?yazar|ben (size )?yazay|yaziyim|yazayim|dusuneyim|dusunecegim|sonra (yazar|donerim|haber)|simdilik|soz veremiyorum|daha sonra/.test(l)
  ) {
    s.erteleSon = Date.now();
    return nc("Tabii, size uygun oldugunuzda yazabilirsiniz, sizi bekliyoruz. 😊");
  }

  // Kalicilik
  if (/kalici|kac ay|ne kadar dayan|ne kadar kal/.test(l)) {
    const k = kalicilikCevap(l, ctx);
    if (k) return k;
  }

  // Otopark
  if (/otopark/.test(l)) {
    updateContext(senderId, "otopark");
    return nc("Evet, otopark imkanimiz mevcut. Detayi randevu teyidinde ekibimiz iletecektir. 😊");
  }

  // Adres / konum (sadece acik sorularda)
  if (/\badres|\bkkonum|\bkonum|\byeriniz|neredesiniz|nerdesiniz|\bklinik\w* nerede|nerede kaliyor/.test(l)) {
    updateContext(senderId, "adres");
    const tekrar = Date.now() - s.adresSon < 60 * 60 * 1000;
    s.adresSon = Date.now();
    if (tekrar) return nc("Tabii, konum linki tekrar burada: " + LINK + " 📍");
    return nc("Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: " + LINK + " 📍");
  }

  // Cesme / Alacati + randevu
  if (/cesme|alacati/.test(l)) {
    updateContext(senderId, "cesme");
    if (!talepVar && !erteleAktif && /randevu|ne zaman|geliyosunuz|geliyorsunuz|musait|saat|\bgun\b/.test(l)) {
      const c = musaitlikCevap(s, "", MUSAITLIK_CESME);
      if (c) return nc(c);
    }
  }

  // Acik mi / calisma saati
  if (!talepVar && !erteleAktif && /acik mi|acikmi|acik misiniz|aciksiniz|calisma saat|kaca kadar|musait misiniz|bugun acik|calisiyor/.test(l)) {
    const c = musaitlikCevap(s, "Randevu ile calisiyoruz, su an musaitligimiz ");
    if (c) return nc(c);
  }

  // Kas kaldirma / goz cekme
  const botoxVar = /botox|botoks|botuks/.test(l);
  const kasKaldirma = /\bkas\w* ?(kaldir|yukar)/.test(l);
  const gozCekme = /goz ?(cekme|cekik|kaldir|yukar)|cekiklik|\bcekik/.test(l);

  if (botoxVar && kasKaldirma) {
    updateContext(senderId, "botox");
    return "Botox yaparken kaslarin ucundan kaldirma dozu da veriyoruz. 😊";
  }
  if (/badem goz/.test(l) || gozCekme || kasKaldirma) {
    updateContext(senderId, "bademgoz");
    return BADEM_GOZ_CEVAP;
  }

  // Konu baglamini guncelle
  const konu = konuTespit(l);
  if (konu) updateContext(senderId, konu);

  // Somon DNA / Paris nedir
  if (/paris|somon/.test(l) && /nedir|ne ise yar|ne demek|nasil bir|ne icin/.test(l)) {
    return "Peptit ve amino asit iceren mezoterapi uygulamalaridir. Parilti ve canlilik katar, botoksla harika bir kombindir. ✨";
  }

  // Doktor sorusu
  if (/doktor mu|doktor kim|doktorunuz|hangi doktor|kim yapiyor|kim yapar|tecrubeli|hocamiz kim|uzman mi/.test(l)) {
    return "Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir. ✨";
  }

  // Sabit fiyat cevaplari: sadece fiyat sorulunca veya mesaj cok kisaysa
  const fiyatIstegi = FIYAT_NIYETI.test(l) || l.trim().split(/\s+/).length <= 4;

  if (fiyatIstegi) {
    if ((/sakak|\bsaka\b/.test(l)) && /dudak/.test(l) && /nazol|nazal/.test(l)) {
      return "Sakak 4500 TL nakit. Nazolabial 1 cc 3800 TL nakit KK 5400. Dudak 1 cc Elasty 3800 TL KK 5400, Juvederm 5400 TL KK 7800. 😊";
    }
    if (/yarim/.test(l) && /\bcc\b|dudak/.test(l)) {
      return "Evet yarim yapiyoruz. Yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit. 1 cc Elasty 3800 TL KK 5400, Juvederm 5400 TL KK 7800. 😊";
    }
    if (/dudak/.test(l)) {
      return "Dudak dolgusu 1 cc Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL). Fiyatlarimiz her iki subemizde de ayni. 😊";
    }
    if (/nazolab|nazal/.test(l)) {
      return "Nazolabial dolgu 1 cc 3800 TL nakit, 5400 TL KK. Normal fiyat. 😊";
    }
    if (/sakak/.test(l) && !/dudak|nazo/.test(l)) {
      return "Sakak dolgusu 4500 TL nakit. 😊";
    }
    if (/burun/.test(l)) {
      return "Burun dolgusu 5200 TL nakit. 😊";
    }
    if (/paris|somon|genclik/.test(l)) {
      return "Paris Isiltisi, Somon DNA ve Genclik Asisi hepsi bir arada 3500 TL nakit kampanya. ✨";
    }
    if (/goz alti|gozalti|isik dolgu/.test(l)) {
      return "Goz alti isik dolgusu 5200 TL kampanya, normal 7000 TL. 😊";
    }
    if (/\bcene\b/.test(l)) {
      return "Cene dolgusu 3800 TL nakit. 😊";
    }
    if (/radiesse/.test(l)) return "Radiesse 19000 TL nakit. ✨";
    if (/novuma/.test(l)) return "Novuma 14000 TL nakit. 😊";

    if (/ip aski/.test(l)) {
      if (/6/.test(l) && /2 ml|sivi/.test(l)) {
        return "x6 Adet Ip Aski + 2 ML Sivi Yuz Germe 16000 TL Nakit Odeme Kampanyamiz var. 😊";
      }
      if (/8/.test(l) && /2 ml|sivi/.test(l)) {
        return "x8 Adet Ip Aski + 2 ML Sivi Yuz Germe 18000 TL Nakit Odeme Kampanyamiz var. ✨";
      }
      return "Ip Aski 6 adet 16000 TL nakit (KK 22000 TL), 8 adet 18000 TL nakit (KK 25000 TL). Kampanyamiz: x6 Adet + 2 ML Sivi Yuz Germe 16000 TL, x8 Adet + 2 ML Sivi Yuz Germe 18000 TL Nakit. 😊";
    }
    if (botoxVar || /kaz ayag|kas arasi|\balin\b/.test(l)) {
      return "Alin, kas arasi ve kaz ayaklarinin yanina ihtiyaca gore burun kenari ve dudak ustu cizgilere kucuk atislar yapiyoruz, toplam 5 bolge. Kaslarin ucundan kaldirma dozu da veriyoruz. Allergan 3800 TL nakit, Dysport 4400 TL nakit, hediye Somon DNA + Paris Isiltisi. ✨";
    }
    if (/sivi yuz|sivi germe/.test(l)) {
      return "Sivi Yuz Germe: 6 ML PLLA Eldermafill marka Sivi Yuzgerme + 5 Bolge Botox + Paris Isiltisi + Somon DNA 21000 TL nakit. ✨";
    }
  }

  // Kisa randevu istegi: ilk seferde musaitlik, sonra AI
  if (
    !talepVar && !erteleAktif &&
    /randevu/.test(l) && l.length < 80 &&
    !/iptal|degistir|ertele/.test(l)
  ) {
    const c = musaitlikCevap(s, "Tabii, su an musaitligimiz ");
    if (c) return nc(c);
  }

  // ----- AI -----
  try {
    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    for (const model of models) {
      try {
        const pushSure = (s.replyCount - s.lastPush) >= 3;
        const randevuBayrak = (talepVar || erteleAktif || !pushSure)
          ? "HAYIR - bu cevapta kendin randevu/gun/saat teklif etme (musteri kendisi konusuyorsa akisa devam et)"
          : "EVET";

        const systemContent =
          SYSTEM_PROMPT +
          "\nGreeted:" + (isGreeted ? "EVET - merhaba deme" : "HAYIR") +
          " LastTopic:" + (ctx ? ctx.lastTopic : "yok") +
          " UcretsizMuayeneTeklifEdildi:" + (s.muayene ? "EVET - tekrar etme" : "HAYIR") +
          " RandevuTalebiAlindi:" + (talepVar ? "EVET - tekrar randevu sorma" : "HAYIR") +
          " MusterErteledi:" + (erteleAktif ? "EVET - israr etme" : "HAYIR") +
          " MusaitlikListesiDahaOnceVerildi:" + (Date.now() - s.musaitSon < 30 * 60 * 1000 ? "EVET - tamamini tekrarlama" : "HAYIR") +
          " RandevuTeklifiVer:" + randevuBayrak +
          ". Bugun: " + trTarih(0) + ". Yarin: " + trTarih(1) + ".";

        const messages = [{ role: "system", content: systemContent }]
          .concat(getHistory(senderId))
          .concat([{ role: "user", content: userMessage }]);

        const res = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: model,
            messages: messages,
            temperature: 0.6,
            max_tokens: 2000,
            reasoning_effort: "low"
          },
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
          // Instagram markdown gostermez: temizle
          text = text
            .replace(/\*\*/g, "")
            .replace(/__/g, "")
            .replace(/^\s*[-•*]\s+/gm, "")
            .replace(/\s*\n+\s*/g, " ");
          if (isGreeted) {
            text = text.replace(/Merhaba, ben GuGu Clinic'ten Aida\.?\s*/gi, "");
          }
          return kisalt(text.trim(), 800);
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
    return nc("Bu konuda detayli bilgi icin 0534 248 94 70'ten arayabilirsiniz. 😊");
  }
}

// ---------- Mesaj isleme ----------

async function processBatch(senderId) {
  const p = pending.get(senderId);
  if (!p) return;

  if (processing.has(senderId)) {
    p.timer = setTimeout(function () { processBatch(senderId); }, 2000);
    return;
  }

  pending.delete(senderId);

  if (insanAktifMi(senderId)) {
    p.texts.forEach(function (t) { addHistory(senderId, "user", t); });
    return;
  }

  processing.add(senderId);

  try {
    const text = p.texts.join(" ");
    const baslangic = p.first;

    const ctxNow = getContext(senderId);
    console.log("Gelen Mesaj: " + text + " | Context: " + (ctxNow ? ctxNow.lastTopic : "yok"));

    if (telefonVarMi(text)) {
      randevuTalebi.set(senderId, Date.now());
      console.log("YENI RANDEVU TALEBI: " + senderId + " | " + text);
    }

    const isGreeted = greetedUsers.has(senderId);
    const reply = await getGroqReply(text, senderId, isGreeted);

    if (!reply) {
      addHistory(senderId, "user", text);
      console.log("Cevap verilmedi (emoji/nokta)");
      return;
    }

    if (!isGreeted) greetedUsers.set(senderId, Date.now());

    // Ilk mesajdan itibaren toplam 6-12 sn
    const hedefMs = 6000 + Math.random() * 6000;
    const kalan = Math.max(0, hedefMs - (Date.now() - baslangic));
    await sleep(kalan);

    if (insanAktifMi(senderId)) {
      console.log("Insan devraldi, bot cevabi iptal edildi");
      addHistory(senderId, "user", text);
      return;
    }

    await sendSplitMessages(senderId, reply);
    addHistory(senderId, "user", text);
    addHistory(senderId, "assistant", reply);
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
      handleEcho(m);
      return;
    }
    if (!m.message.text) return;

    const senderId = m.sender.id;
    const text = m.message.text;

    if (isDuplicate(senderId, text)) {
      console.log("Duplicate atlandi");
      return;
    }

    if (insanAktifMi(senderId)) {
      console.log("Insan aktif, bot sessiz: " + text.slice(0, 60));
      addHistory(senderId, "user", text);
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
  res.send('Bot Aktif! Aida v48');
});

app.listen(PORT, function () {
  console.log("Sunucu " + PORT + " portunda... Aida v48");
});
