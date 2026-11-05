const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 10000;
const SELF_URL = process.env.RENDER_EXTERNAL_URL;

// Ekip sayfadan elle yazinca bot bu sure kadar o musteriye susar (musteriye ozel)
const HUMAN_PAUSE_MS = 15 * 60 * 1000;
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

process.on('unhandledRejection', function (e) {
  console.log("Yakalanmamis hata (promise): " + (e && e.message ? e.message : e));
});
process.on('uncaughtException', function (e) {
  console.log("Yakalanmamis hata: " + (e && e.message ? e.message : e));
});

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

const CUMLE_BOL = /(?<=[.!?]|[.!?]\s?[\p{Extended_Pictographic}\uFE0F]+)\s+(?![\p{Extended_Pictographic}\uFE0F])/u;

function trTarih(offsetGun) {
  const d = new Date(Date.now() + (offsetGun || 0) * 86400000);
  return d.toLocaleDateString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

const GUN_KURAL = {
  Mon: "Alsancak 16:30-19:00",
  Wed: "Alsancak 16:30-19:00",
  Thu: "Alacati/Cesme 17:00-18:30",
  Sat: "Alsancak 13:00-16:00",
  Sun: "Alsancak 13:00-15:00"
};

function takvimMetni() {
  const satir = [];
  for (let i = 0; i < 15; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const kisa = d.toLocaleDateString('en-US', { timeZone: 'Europe/Istanbul', weekday: 'short' });
    if (GUN_KURAL[kisa]) satir.push(trTarih(i) + " = " + GUN_KURAL[kisa]);
  }
  return satir.join("; ");
}

function telefonVarMi(text) {
  const digits = text.replace(/\D/g, "");
  return /5\d{9}/.test(digits);
}

function getState(id) {
  let s = userState.get(id);
  if (!s) {
    s = { replyCount: 0, lastPush: 0, muayene: false, musaitSon: 0, adresSon: 0, erteleSon: 0 };
    userState.set(id, s);
  }
  return s;
}

// Sonraki cevapta randevu daveti yapilabilir mi (ilk 2 cevapta hayir)
function pushZamaniMi(s) {
  return (s.replyCount + 1 - s.lastPush) >= 3;
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
  return String(text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase()
    .slice(0, 60);
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
    console.log("INSAN DEVRALDI: " + musteriId + " | bot " + Math.round(HUMAN_PAUSE_MS / 60000) + " dakika susacak | " + text.slice(0, 60));
  }
}

// ---------- Mesaj gonderme ----------

function splitToMessages(text) {
  const parts = text.split(CUMLE_BOL);
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

CEVAP KURALLARI:
- Musteri bir sey sorarsa (marka, fiyat, sure) ILK cumlede dogrudan cevabi ver. Ornek: "PLLA'nin markasi ne" -> "Eldermafill markasini kullaniyoruz."
- Sonuc vaadi icin "saglar" yerine "destekler" de.
- "Baska sorunuz var mi", "yardimci olmaktan memnuniyet duyarim" gibi kapanis cumleleri KULLANMA. Konuyla ilgili tek kisa soru sor veya soru sormadan bitir.
- Musteri tesekkur eder veya "donus yapacagim" derse sadece kisa bir cevap ver, soru SORMA.
- Musteri daha once HERHANGI bir islem yaptirdigini soylerse (ne zaman, hangi islem fark etmez) plan veya kombinasyon ONERME, "mumkun, olur, uygun" gibi onay VERME. Sadece "Hocamiz muayenede size ozel degerlendirir" de ve hangi islemi yaptirdigini sor.
- Musterinin sikayetine (sarkma, cizgi, hacim kaybi) bakip tani koyma, hangi uygulamanin yapilacagini sen belirleme. "Hocamiz muayenede degerlendirir" de, uygulamalari genel olarak tanit.
- Sonuc vaadi verme: "dogal sonuc verir, sikilastirir" yerine "destekler" de.
- Musteriden anket, form veya on bilgi almadin. "Anketinizde, formunuzda" gibi seyler ASLA soyleme.
- Sure, seans sayisi, urun miktari gibi klinige ozel rakamlari UYDURMA. Sadece su sureler biliniyor: dudak, nazolabial, goz alti isik dolgusu 10-12 ay, botox 5-6 ay. Digerleri icin: "Bunun icin net bilgiyi Hocamiz muayenede verir. 😊"
- Randevu, gun veya saat sorusunu sadece musteri randevudan bahsediyorsa veya RandevuTeklifiVer:EVET ise sor. Arka arkaya iki cevapta randevu sorma.

FIYAT KURALLARI (COK ONEMLI):
- Fiyati SADECE asagidaki FIYATLAR listesinden ver. Listede olmayan hicbir TL tutari, marka veya kampanya yazma. "Kredi karti" yerine "KK" yaz.
- Musteri birden fazla hizmetin fiyatini sorarsa HEPSININ fiyatini ver.
- Fiyatini bilmedigin bir sey sorulursa: "Guncel fiyat icin 0534 248 94 70'ten ulasabilirsiniz."

PAZARLIK / INDIRIM:
- Musteri indirim ister, pazarlik yapar veya "X bine anlasalim" derse indirim VERME, rakam onerme, soz verme. "Indirim konusunda yetkim yok, ekibimiz sizinle ilgilenecektir." de. Fiyat itirazi gibi savunma yapma, hizmetin degerini uzun anlatma.

TEKNIK ISIMLER:
- Musteri "baby lips, russian lips" gibi bir teknik adi soylerse teknigi tanimlama, aciklama uydurma. Sadece sordugu cc'ye gore listedeki fiyati ver, teknik detayi Hocamizin muayenede belirleyecegini soyle.

RANDEVU VE SATIS:
- Musteriyi ikna etmeye calis ama BASKI YAPMA. Her cevapta randevu isteme.
- Sistem bilgisinde RandevuTeklifiVer:HAYIR yaziyorsa bu cevapta randevu, gun veya saat SORMA; sadece bilgi ver, gerekirse konuyla ilgili bir soru sor. EVET yaziyorsa nazikce yonlendirebilirsin. Musteri kendisi randevu, gun veya saat konusuyorsa bu kural gecerli degil, akisa devam et.
- Ikna icin Dr Ozgen Yildirim'in tecrubesini, dogal sonuclari, kampanya ve hediyeleri gerektiginde hatirlat.
- "Ucretsiz muayene" teklifini KENDIN YAPMA, sistem ekliyor. Musteri sorarsa evet ucretsiz muayene/on gorusme yapiyoruz de ve gun/sube sor.
- Musteri ertelerse (dusunecegim, sonra yazarim, haberlesiriz, donus yapacagim, soz veremiyorum, is durumuma gore bilgi vereceğim vb.) israr ETME. "Tabii, size uygun oldugunuzda yazabilirsiniz, sizi bekliyoruz. 😊" de. Bir daha randevu veya muayene teklif etme.

FIYAT ITIRAZI:
- Musteri "pahali, neden bu fiyat, baska yerde daha ucuz" derse: fiyat farkinin Hocamiz Dr Ozgen Yildirim'in 36 senelik tecrubesinden ve el hakimiyetinden geldigini, uygulamada asil belirleyici olanin doktorun eli oldugunu, kullandigimiz urunlerin de kaliteli oldugunu nazikce ve KISA anlat. Baska klinikleri kotuleme, baski yapma.

RANDEVU AKISI:
- Sen randevuyu sisteme KAYDEDEMEZSIN. "Kaydedildi, olusturuldu, ayarlandi, onaylandi" ASLA deme.
- Sira: 1) Musteriye uygun gun/saat sor veya musaitlige gore oner. 2) Gun, saat ve sube uzerinde ANLASINCA isim ve telefon iste (tek mesajda). 3) Isim ve telefon GELDIKTEN SONRA: "Talebinizi aldim, ekibimiz sizi arayarak randevunuzu kesinlestirecek. 😊"
- Gun, saat ve sube kesinlesmeden isim ve telefon ISTEME. Isim ve telefon bir kere geldiyse tekrar isteme, teyit de isteme.
- Musaitlik: Alsancak subesi Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00, Carsamba 16:30-19:00. Alacati/Cesme subesi Persembe 17:00-18:30. Baska gun veya saat YOK.
- Sadece bu araliklarda oner. Bitis saatine randevu verme (en gec bitisten 30 dakika once oner, ornek Pazartesi en gec 18:30). Musteri aralik disi saat isterse nazikce reddet ve en yakin uygun secenegi oner.
- Musterinin kisitlari uygun degilse (calisma saati vb.) bunu acikca soyle: "Maalesef bu gunlerde sizin musait oldugunuz saatlerde yerimiz yok." Zorla teklif etme, musteri isterse daha sonra yazabilecegini soyle.
- Musaitlik listesinin tamamini sadece gerektiginde ve ilk kez ver. Daha once verdiysen sadece ilgili gunu yaz.
- "Yarin, bugun, haftaya" gibi ifadelerde sistem bilgisindeki tarihe ve takvime bak. O gun musaitlik yoksa soyle ve en yakin uygun gunu oner.
- Randevu talebi alindiktan sonra (RandevuTalebiAlindi:EVET) tekrar randevu sorma. Sadece yardimci ol (konum, hazirlik, tesekkur) ve "sizi bekliyoruz" de.

RANDEVU ORNEKLERI (bu sirayi aynen izle):
- Musteri: "carsamba yarin icin mu" -> "Evet, yarin Carsamba Alsancak subemizde 16:30-19:00 arasi musaitiz. Hangi saat size uygun? 😊" (isim/telefon ISTEME, once saat)
- Musteri: "17:30 olur" -> "17:30 uygun. Isminizi ve telefon numaranizi alabilir miyim? 😊"
- Musteri sube belirtmeden bir gun sorarsa o gunun hangi subede musait oldugunu ve digerinde olmadigini birlikte soyle, en yakin alternatif tarihi (takvimden) oner.

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

IP ASKI:
- Ip Aski paketlerinde 4D yeni nesil ipler kullaniyoruz ve en kalin olanlari tercih ediyoruz. Ipler cok kaliteli ve dayanikli.
- Ipi kullanan elin tecrubesi belirleyicidir: Hocamiz Dr Ozgen Yildirim 36 senelik tecrubesiyle en iyi gerilmeyi saglamayi hedefler. Fiyatin onemli bir kismi Hocamizin el hakimiyetidir.
- "Kopma ihtimali yok, %100, garanti" gibi kesin ifadeler KULLANMA. "Kopar mi" diye sorulursa: "En kalin 4D ipleri kullaniyoruz, kaliteli ve dayanikli ipler. Detayi Hocamiz muayenede anlatir. 😊" de.
- Ip sayisi, etki suresi gibi listede olmayan teknik detaylari UYDURMA.

MARKALAR VE FIYAT FARKI:
- Dudak dolgusu: Elasty/Tuscan ve Juvederm. Juvederm daha hacimli, belirgin sonuc icin tercih edilir. Botox: Allergan ve Dysport. Sivi yuz germe: PLLA Eldermafill. Ip aski: 4D yeni nesil ipler. Listede olmayan marka SOYLEME.
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
- Ip Aski (4D yeni nesil, en kalin ipler): 6 adet 16000 TL nakit (KK 22000 TL), 8 adet 18000 TL nakit (KK 25000 TL)
- Kampanya: x6 Ip Aski + 2 ML Sivi Yuz Germe 16000 TL nakit, x8 Ip Aski + 2 ML Sivi Yuz Germe 18000 TL nakit
- Fiyatlar Alsancak ve Alacati/Cesme subelerinde ayni.

GENEL SORULAR:
- Listede olmayan genel bir soru sorulursa (cilt bakimi, nasil yapilir, aci verir mi gibi; rakam gerektiren sure/seans sorularinda uydurma) kendi bilginle dogal ve sicak sekilde 2-3 cumleyle cevap ver.
- Her zaman telefona yonlendirme. Sadece fiyat, kampanya veya tibbi karar gerektiren konularda yonlendir.

SINIRLAR:
- Listede olmayan FIYAT, MARKA, HIZMET veya KAMPANYAYI uydurma. Fiyat konusunda emin degilsen: "Guncel fiyat icin 0534 248 94 70'ten ulasabilirsiniz."
- Listede olmayan hicbir bilgiyi (yol tarifi, taksit, uygulama suresi vb.) uydurma. Emin degilsen: "Bu konuda net bilgiyi randevu teyidinde ekibimiz size iletecektir. 😊"
- Tibbi tavsiye, tani, ilac/hamilelik/alerji gibi saglik sorularinda yorum yapma, doktorumuzla gorusmeye veya telefona yonlendir.
- "Kesin sonuc", "risksiz", "%100", "garanti" gibi kesin ifadeler kullanma.
- Diger klinikleri kotuleme.
`;

const LINK = "https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb";

const MUSAITLIK_TAM = "Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 saatleri arasinda var. Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda var. Hangisi size uyar? 😊";

const MUSAITLIK_CESME = "Alacati/Cesme subemizde Persembe 17:00-18:30 arasinda musaitligimiz var. Alsancak subemizde Cumartesi 13:00-16:00, Pazar 13:00-15:00, Pazartesi 16:30-19:00 ve Carsamba 16:30-19:00 arasinda var. Hangisi size uyar? 😊";

const BADEM_GOZ_CEVAP = "Badem Goz uyguluyoruz, nakit odemede 18000 TL, KK ile odemede normal fiyat 25000 TL. 😊";

const IP_KALITE_CEVAP = "Ip Aski paketlerimizde 4D yeni nesil ipler kullaniyoruz ve en kalin olanlari tercih ediyoruz, ipler cok kaliteli ve dayanikli. Hocamiz Dr Ozgen Yildirim da 36 senelik tecrubesiyle en iyi gerilmeyi hedefliyor, fiyattaki asil fark da Hocamizin el hakimiyeti. ✨";

const PAZARLIK_CEVAP = "Indirim konusunda yetkim yok, ekibimiz sizinle ilgilenecektir. Dilerseniz 0534 248 94 70'ten de ulasabilirsiniz. 😊";

const MUAYENE_CUMLESI = "Muayene sonrasi size de uygunsa uygulamayi yapabiliriz, ucretsiz muayene randevusu ister misiniz? 😊";

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

const RANDEVU_SORULARI = [
  "Isterseniz size uygun bir gun ayarlayalim mi? 😊",
  "Dilerseniz Hocamizla yuz yuze gorusmek icin bir gun belirleyelim mi? ✨"
];

const LOJISTIK_KONULAR = ["adres", "otopark", "cesme"];

// Listedeki tum gecerli TL tutarlari (AI uydurmasini yakalamak icin)
const IZINLI_FIYATLAR = new Set([
  2200, 3000, 3500, 3800, 4400, 4500, 5200, 5400, 7000, 7800,
  14000, 16000, 18000, 19000, 21000, 22000, 25000
]);

function sec(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}

const BOTOX_RE = /bot[oua][kx]/;

function konuTespit(l) {
  if (/badem goz/.test(l)) return "bademgoz";
  if (/dudak|baby ?lips/.test(l)) return "dudak";
  if (BOTOX_RE.test(l) || /kaz ayag|kas arasi|\balin\b/.test(l)) return "botox";
  if (/goz cek|cekiklik|kas kaldir/.test(l)) return "bademgoz";
  if (/nazolab|nazal/.test(l)) return "nazolabial";
  if (/goz alti|gozalti|isik dolgu/.test(l)) return "gozalti";
  if (/sakak/.test(l)) return "sakak";
  if (/burun/.test(l)) return "burun";
  if (/ip aski|ipaski/.test(l)) return "ipaski";
  if (/sivi yuz|sivi germe|plla/.test(l)) return "siviyuz";
  if (/\bcene\b/.test(l)) return "cene";
  if (/paris|somon|genclik/.test(l)) return "paris";
  if (/doktor|tecrubeli|hocamiz|uzman/.test(l)) return "doktor";
  return null;
}

function soruVarMi(text) {
  return /\?[\s\p{Extended_Pictographic}\uFE0F]*$/u.test(text.trim());
}

// AI cevabindaki TL tutarlarinin hepsi listede mi
function fiyatlarGecerliMi(text) {
  const re = /(\d{1,3}(?:[.,\s\u00A0\u202F]\d{3})+|\d{3,6})\s*(?:tl|₺|lira)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const sayi = parseInt(m[1].replace(/\D/g, ""), 10);
    if (!IZINLI_FIYATLAR.has(sayi)) return false;
  }
  return true;
}

// "Baska sorunuz var mi" gibi bos kapanis cumlelerini siler
function kapanisCumleleriniTemizle(text) {
  const parcalar = text.split(CUMLE_BOL);
  const kalan = parcalar.filter(function (p) {
    return !/baska (bir )?soru|yardimci olmaktan|yardimci olabilir miyim|her zaman yardimci/.test(norm(p));
  });
  const s = kalan.join(" ").trim();
  return s.length > 10 ? s : text;
}

// Musteri randevudan bahsetmiyorsa AI'nin randevu/gun/saat cumlelerini cikarir
function randevuSorusunuAyikla(text, userMsg, senderId, izinli) {
  if (izinli) return text;
  const l = norm(userMsg);
  if (/randevu|gun|saat|musait|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar|yarin|haftaya|\d{1,2}[:.]\d{2}|\d{9,}/.test(l)) return text;
  const h = getHistory(senderId);
  let sonBot = "";
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].role === "assistant") { sonBot = norm(h[i].content); break; }
  }
  if (userMsg.trim().split(/\s+/).length <= 4 && /randevu|hangi gun|hangi saat|sube|isim/.test(sonBot)) return text;

  const parcalar = text.split(CUMLE_BOL);
  const kalan = parcalar.filter(function (p) {
    const n = norm(p);
    if (/talebinizi ald|kesinlestir/.test(n)) return true;
    return !/hangi gun|gun ve saat|hangi saat|randevu|musait|talebiniz var/.test(n);
  });
  const sonuc = kalan.join(" ").trim();
  return sonuc.length > 20 ? sonuc : text;
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
  if (Date.now() - s.musaitSon < 10 * 60 * 1000) return null;
  s.musaitSon = Date.now();
  return (onek || "") + (metin || MUSAITLIK_TAM);
}

const FIYAT_NIYETI = /fiyat|ne kadar|nekadar|ucret|\bkac (tl|para|lira)|\bkaca\b|\bkdr\b|\btl\b|kampanya|\bkac\s*[?]*$/;
const BILGI_NIYETI = /nasil|neden|niye|acit|acir|zarar|risk|yan etki|seans|sure|kalici|omur|hamile|alerji|iz kal|sisme|morar|iyilesme|kimler|olur mu|yapilir mi/;

// Sorulan TUM hizmetlerin fiyatini toplar
function fiyatParcalari(l) {
  const out = [];
  const dudak = /dudak|baby ?lips/.test(l);

  if (dudak && /yarim/.test(l)) {
    out.push("Yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit. 1 cc Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL).");
  } else if (dudak) {
    out.push("Dudak dolgusu 1 cc Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL).");
  }
  if (/nazolab|nazal/.test(l)) out.push("Nazolabial dolgu 1 cc 3800 TL nakit, 5400 TL KK.");
  if (/sakak|\bsaka\b/.test(l)) out.push("Sakak dolgusu 4500 TL nakit.");
  if (/burun(?! kenar)/.test(l)) out.push("Burun dolgusu 5200 TL nakit.");
  if (/\bcene\b/.test(l)) out.push("Cene dolgusu 3800 TL nakit.");
  if (/goz alti|gozalti|isik dolgu/.test(l)) out.push("Goz alti isik dolgusu 5200 TL kampanya, normal 7000 TL.");
  if (/paris|somon|genclik/.test(l)) out.push("Paris Isiltisi, Somon DNA ve Genclik Asisi hepsi bir arada 3500 TL nakit kampanya.");
  if (/radiesse/.test(l)) out.push("Radiesse 19000 TL nakit.");
  if (/novuma/.test(l)) out.push("Novuma 14000 TL nakit.");

  if (/ip aski|ipaski/.test(l)) {
    if (/6/.test(l) && /2 ml|sivi/.test(l)) {
      out.push("x6 Adet Ip Aski + 2 ML Sivi Yuz Germe 16000 TL Nakit Odeme Kampanyamiz var.");
    } else if (/8/.test(l) && /2 ml|sivi/.test(l)) {
      out.push("x8 Adet Ip Aski + 2 ML Sivi Yuz Germe 18000 TL Nakit Odeme Kampanyamiz var.");
    } else {
      out.push("Ip Aski paketlerimizde 4D yeni nesil, en kalin ipleri kullaniyoruz. 6 adet 16000 TL nakit (KK 22000 TL), 8 adet 18000 TL nakit (KK 25000 TL). Kampanyamiz: x6 Adet + 2 ML Sivi Yuz Germe 16000 TL, x8 Adet + 2 ML Sivi Yuz Germe 18000 TL Nakit.");
    }
  }

  if (/sivi yuz|sivi germe/.test(l)) {
    out.push("Sivi Yuz Germe: 6 ML PLLA Eldermafill marka Sivi Yuzgerme + 5 Bolge Botox + Paris Isiltisi + Somon DNA 21000 TL nakit.");
  } else if (BOTOX_RE.test(l) || /kaz ayag|kas arasi|\balin\b/.test(l)) {
    out.push("Botox: alin, kas arasi ve kaz ayaklarinin yanina ihtiyaca gore burun kenari ve dudak ustu cizgilere kucuk atislar yapiyoruz, toplam 5 bolge. Kaslarin ucundan kaldirma dozu da veriyoruz. Allergan 3800 TL nakit, Dysport 4400 TL nakit, hediye Somon DNA + Paris Isiltisi.");
  }
  return out;
}

// ---------- Cevap uretimi ----------

async function getGroqReply(userMessage, senderId, isGreeted) {
  const l = norm(userMessage);
  const s = getState(senderId);

  const raw = await getReplyInner(userMessage, senderId, isGreeted);
  if (raw === null) return null;

  const noClose = typeof raw === "object";
  const text = noClose ? raw.text : raw;
  s.replyCount++;

  const textNorm = norm(text);
  if (/randevu|gun ayarla|hangi gun|muayene/.test(textNorm) && soruVarMi(text)) {
    s.lastPush = s.replyCount;
  }

  if (noClose) return text;
  if (randevuTalebi.has(senderId)) return text;
  if (Date.now() - s.erteleSon < 24 * 3600 * 1000) return text;
  if (soruVarMi(text) || text.includes("0534 248") || /talebinizi ald/.test(textNorm)) return text;
  if (/randevu|bekliyoruz|telefon|saat/.test(textNorm)) return text;

  const ctxSon = getContext(senderId);
  const topic = konuTespit(l) || (ctxSon ? ctxSon.lastTopic : null);
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
  const kelimeSayisi = l.trim().split(/\s+/).length;

  // Harf/rakam yoksa (emoji, nokta vb.)
  if (!/[\p{L}\p{N}]/u.test(userMessage)) {
    if (!isGreeted && !talepVar) {
      return nc("Merhaba, ben GuGu Clinic'ten Aida. Size nasil yardimci olabilirim? 😊");
    }
    return null;
  }

  // Sadece selamlama
  const sade = l.replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  if (/^(merhaba|merhabalar|selam|selamlar|slm|mrb|iyi gunler|gunaydin|iyi aksamlar|iyi gunler dilerim)$/.test(sade)) {
    if (!isGreeted) return nc("Merhaba, ben GuGu Clinic'ten Aida. Size nasil yardimci olabilirim? 😊");
    return nc("Buyurun, size nasil yardimci olabilirim? 😊");
  }

  // Pazarlik / indirim
  if (/anlasal|anlasir|indirim|pazarlik|son fiyat|dusurur|dusurebil|kirar mis|kirabil|\b\d+(\.\d+)?\s*bine\b/.test(l)) {
    console.log("PAZARLIK / INSAN GEREKLI: " + senderId + " | " + userMessage.slice(0, 80));
    return nc(PAZARLIK_CEVAP);
  }

  // Musteri erteliyor
  if (
    !telefonVarMi(userMessage) &&
    /haberlesel|ben (size )?yazar|ben (size )?yazay|yaziyim|yazayim|dusuneyim|dusunecegim|dusunup|sonra (yazar|donerim|haber)|simdilik|soz veremiyorum|daha sonra|bilgi vereceg|haber vereceg|haber verir|donus (sagl|yap|ed)|donecegim|donucem|donerim|musait olunca|danis(ip|ayim)|bir bakay/.test(l)
  ) {
    s.erteleSon = Date.now();
    return nc("Tabii, size uygun oldugunuzda yazabilirsiniz, sizi bekliyoruz. 😊");
  }

  // Kisa tesekkur / memnuniyet (yazim hatalari dahil)
  const tesekkurVar = /\bte?s+e?k+u?r|sagol|sag ol|eyvallah/.test(l);
  const kisaOver = /^(harika|super|mukemmel|cok iyi|cok guzel|sahane|tamam|tamamdir|ok|okey)$/.test(sade);
  if (
    kisaOver ||
    (tesekkurVar && userMessage.indexOf("?") === -1 && kelimeSayisi <= 8 && !konuTespit(l) && !/randevu|fiyat|ne kadar/.test(l))
  ) {
    return nc("Rica ederiz, sizi klinigimizde gormekten memnuniyet duyariz. ✨");
  }

  // Kalicilik / omur
  if (/kalici|kac ay|ne kadar dayan|ne kadar kal|omur|ne kadar duruyor/.test(l)) {
    const konuK = konuTespit(l);
    if (/islemlerin|hepsinin|tumunun|genel/.test(l)) {
      return nc("Dudak, nazolabial ve goz alti isik dolgusu 10-12 ay, botoks 5-6 ay kalir. Diger uygulamalarin suresi kisiye gore degisir, Hocamiz muayenede net bilgi verir. 😊");
    }
    if (konuK === "siviyuz" || (!konuK && ctx && ctx.lastTopic === "siviyuz")) {
      return nc("Sivi yuz germenin suresi kisiye gore degisir, net bilgiyi Hocamiz muayenede verir. 😊");
    }
    if (konuK === "ipaski" || (!konuK && ctx && ctx.lastTopic === "ipaski")) {
      return nc("Ip askinin suresi kisiye gore degisir, net bilgiyi Hocamiz muayenede verir. 😊");
    }
    const k = kalicilikCevap(l, ctx);
    if (k) return k;
  }

  // Otopark
  if (/otopark/.test(l)) {
    updateContext(senderId, "otopark");
    return nc("Evet, otopark imkanimiz mevcut. Detayi randevu teyidinde ekibimiz iletecektir. 😊");
  }

  // Adres / konum
  if (/\badres|\bkonum|\byeriniz|neredesiniz|nerdesiniz|\bklinik\w* nerede|nerede kaliyor/.test(l)) {
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
  const botoxVar = BOTOX_RE.test(l);
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

  // Ip aski kalite / kopma / 4D sorulari
  const ipKaliteSorusu = /kalite|kopar|kopma|kopmaz|4d|kalin|saglam|dayanik|guvenilir|hangi ip|ne ipi|ipin cinsi|ip cinsi|nasil ip/.test(l);
  if (ipKaliteSorusu && (konu === "ipaski" || /\bip\b|\bipler\b/.test(l) || (!konu && ctx && ctx.lastTopic === "ipaski"))) {
    updateContext(senderId, "ipaski");
    return IP_KALITE_CEVAP;
  }

  // Somon DNA / Paris nedir
  if (/paris|somon/.test(l) && /nedir|ne ise yar|ne demek|nasil bir|ne icin/.test(l)) {
    return "Peptit ve amino asit iceren mezoterapi uygulamalaridir. Parilti ve canlilik katar, botoksla harika bir kombindir. ✨";
  }

  // Doktor sorusu
  if (/doktor mu|doktor kim|doktorunuz|hangi doktor|kim yapiyor|kim yapar|tecrubeli|hocamiz kim|uzman mi/.test(l)) {
    return "Tum uygulamalarimizi Hocamiz Dr Ozgen Yildirim yapmaktadir, 36 senenin verdigi tecrubeyle guvenle gelebilirsiniz, eli cok hafiftir. ✨";
  }

  // Sabit fiyat cevaplari: sorulan TUM hizmetlerin fiyati tek cevapta
  const bilgiSorusu = BILGI_NIYETI.test(l);
  const fiyatIstegi =
    FIYAT_NIYETI.test(l) ||
    kelimeSayisi <= 4 ||
    (konu && /\bcc\b|\bml\b/.test(l) && !bilgiSorusu) ||
    (konu && kelimeSayisi <= 8 && !bilgiSorusu && /icin|dolgu|dolgusu/.test(l));

  if (fiyatIstegi) {
    const parcalar = fiyatParcalari(l);
    if (parcalar.length > 0) {
      return parcalar.join(" ") + " 😊";
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
        const randevuBayrak = (talepVar || erteleAktif || !pushZamaniMi(s))
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
          ". Bugun: " + trTarih(0) + ". Yarin: " + trTarih(1) + "." +
          " Onumuzdeki 2 haftanin musait gunleri (bunlarin disinda gun YOK, tarihleri aynen kullan): " + takvimMetni() + ".";

        const messages = [{ role: "system", content: systemContent }]
          .concat(getHistory(senderId))
          .concat([{ role: "user", content: userMessage }]);

        const res = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: model,
            messages: messages,
            temperature: 0.5,
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
          text = text
            .replace(/\*\*/g, "")
            .replace(/__/g, "")
            .replace(/^\s*[-•*]\s+/gm, "")
            .replace(/\s*\n+\s*/g, " ");
          if (isGreeted) {
            text = text.replace(/Merhaba, ben GuGu Clinic'ten Aida\.?\s*/gi, "");
          }
          text = kapanisCumleleriniTemizle(text.trim());
          text = randevuSorusunuAyikla(text, userMessage, senderId, randevuBayrak === "EVET");

          if (!fiyatlarGecerliMi(text)) {
            console.log("AI UYDURMA FIYAT ENGELLENDI: " + text.slice(0, 120));
            return nc("Guncel fiyat bilgisi icin 0534 248 94 70'ten ulasabilirsiniz. 😊");
          }
          return kisalt(text, 800);
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

    if (telefonVarMi(text) && !randevuTalebi.has(senderId)) {
      randevuTalebi.set(senderId, Date.now());
      console.log("YENI RANDEVU TALEBI (insan sohbeti): " + senderId + " | " + text);
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
  res.send('Bot Aktif! Aida v51');
});

app.listen(PORT, function () {
  console.log("Sunucu " + PORT + " portunda... Aida v51");
});

// Render ucretsiz plan uykusunu engellemek icin kendi adresine duzenli istek
if (SELF_URL) {
  setInterval(function () {
    axios.get(SELF_URL).catch(function (e) {
      console.log("Keepalive hatasi: " + e.message);
    });
  }, 10 * 60 * 1000);
  console.log("Keepalive aktif: " + SELF_URL);
}
