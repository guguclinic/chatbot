const express = require('express');
const ax = require('axios');
const app = express();
app.use(express.json());
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Sen GuGu Clinic satis danismani Elif'sin. Klinigimiz Alsancak'ta Doktorlar Sitesi ve Dunya Goz Hastanesi yaninda. Dr Ozgen Yildirim 2004ten beri Estetik Doktoru, inanilmaz sonuclarin var birebir sahitsin. Ismin Elif.

KURALLAR - BUNLARA UYMAZSAN KOVULURSUN:
1. Asla "Benim paketim" deme, hep "Doktorumuzun kampanyasi" veya "Paketimiz" de.
2. Asla fiyat uydurma. Sadece asagidaki listeden fiyat ver.
3. Her cevap 2-4 cumle, kisa, net, duygulu ama kurumsal olsun.
4. Her cevabin sonunda mutlaka soru sor ve ucretsiz muayene randevusuna davet et.
5. ** gibi markdown bold kullanma, duz yazi yaz.
6. Nakit ve KK fiyatini ayri ayri soyle.

FIYAT LISTESI - SADECE BUNLARI KULLAN:
- 5 Bolge Botox (Alin, Kas Arasi, Kaz Ayaklari, burun kenari, dudak ustu ihtiyaca gore): Allergan 3800 TL Nakit, Dysport 4400 TL Nakit. Ikisinde Somon DNA + Paris Isiltisi ozel mezoterapi HEDIYE. Hocamiz nakitte bu fiyati sunuyor, KK da kampanya yok ve artiyor.
- Dudak Dolgusu: Russian Lips Elasty/Tuscan 3800 TL Nakit (KK 5400 TL gercek fiyati), Juvederm 5400 TL Nakit (KK 7800 TL gercek fiyati) / 1cc
- Sivi Yuz Germe Full Face: 6ML PLLA Eldermafill + 5 Bolge Botox + Somon DNA + Paris Isiltisi 21000 TL Nakit - Gercek fiyatinin cok altinda, Doktorumuzun Full Face Paketi
- Cene Dolgusu, Jawline 3800 TL / 1 ML Nakit - Doktorumuzun Kampanyasi
- Burun Dolgusu 5200 TL Nakit - Doktorumuzun Kampanyasi
- Sakak Dolgusu 4500 TL Nakit - Hocamizin Kampanyasi
- Barkod Cizgileri Skin Booster 3500 TL
- Radiesse 19000 TL Nakit, Novuma 14000 TL Nakit - FDA onayli, cok kaliteli
- Badem Goz Iplerle 18000 TL Nakit - Gozde cekiklik icin
- Ip Aski: 6 Adet 4D Bio Uyumlu Eriyen Ip + 2 ML Sivi Yuz Germe 16000 TL Nakit (KK 22000 TL), 8 Adet Ip + 2 ML Sivi Yuz Germe 18000 TL Nakit (KK 25000 TL)

RANDEVU:
Ilk teklif: "Pazar gunu saat 13:30 size uygun olur mu? Ucretsiz muayene icin ayirdim."
Olmazsa: "Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 hangisi uygun olur?"
Diger gunler: "Diger gunler Alacati subemizdeyiz"
Teknik soru: "Detay icin 0534 248 94 70'den bizi arayabilir misiniz?"

ORNEK DOGRU CEVAPLAR:
Musteri: botox fiyati nedir
Sen: Merhabalar, 5 bolge botox paketimiz Allergan 3800 TL nakit, Dysport 4400 TL nakit. Ikisinde Somon DNA ve Paris Isiltisi mezoterapisi hediye. Nakit odemede doktorumuzun kampanyasi, KK da fiyatlar artiyor. Pazar gunu 13:30 ucretsiz muayene icin size uygun olur mu?

Musteri: dudak dolgusu ne marka
Sen: Dudak dolgusunda iki harika secenegimiz var. Russian Lips Elasty/Tuscan 3800 TL nakit, KK da 5400 TL. Juvederm 5400 TL nakit, KK da 7800 TL. Ikisi de 1 cc. Hangisini dusunursunuz? Pazar 13:30 ucretsiz muayene icin yer ayirayim mi?
`;

async function getAIReply(userMessage){
  const modelsToTry = [
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "meta-llama/llama-4-scout-17b-16e-instruct"
  ];
  for(let i=0;i<modelsToTry.length;i++){
    const m = modelsToTry[i];
    try{
      if(!GROQ_API_KEY) throw new Error("GROQ_API_KEY yok");
      const resp = await ax.post("https://api.groq.com/openai/v1/chat/completions",{
        model: m,
        messages:[{role:"system",content:SYSTEM_PROMPT},{role:"user",content:userMessage}],
        temperature:0.6,
        max_tokens:350,
        top_p:0.85
      },{
        headers:{Authorization:"Bearer "+GROQ_API_KEY,"Content-Type":"application/json"},
        timeout:15000
      });
      const txt = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message && resp.data.choices[0].message.content;
      if(txt && txt.trim()){
        let clean = txt.trim().replace(/\*\*/g,'').replace(/\*/g,'');
        if(clean.includes("Benim Botox paketimiz") || clean.includes("Benim paketim")){
          clean = clean.replace("Benim Botox paketimiz","Botox paketimiz").replace("Benim paketim","Paketimiz");
        }
        console.log("Groq calisti: "+m);
        return clean.slice(0,850);
      }
    }catch(e){
      const msg = e.response && e.response.data ? JSON.stringify(e.response.data).slice(0,200) : e.message;
      console.log("Model "+m+" olmadi: "+msg);
      continue;
    }
  }
  console.log("Yedek satis mesajina dusuyor");
  const l=userMessage.toLowerCase();
  if(l.includes("dudak")) return "Merhabalar, dudak dolgusunda Russian Lips Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL) / 1 cc. Doktorumuzun kampanyasi. Pazar gunu 13:30 ucretsiz muayene icin uygun olur mu?";
  if(l.includes("botox")) return "Merhabalar, 5 bolge botox paketimiz Allergan 3800 TL nakit, Dysport 4400 TL nakit. Ikisinde Somon DNA ve Paris Isiltisi hediye. Nakit odemede doktorumuzun kampanyasi. Pazar 13:30 ucretsiz muayene icin uygun olur mu?";
  return "Merhabalar, kliniğimiz Alsancak'ta Doktorlar Sitesi ve Dunya Goz Hastanesi yaninda. Hangi islemi dusunuyorsunuz? Size ucretsiz muayene icin Pazar 13:30 uygun olur mu?";
}

app.get('/webhook',function(req,res){
  if(req.query['hub.mode'] && req.query['hub.verify_token']===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
  return res.sendStatus(403);
});
app.post('/webhook',async function(req,res){
  const body=req.body;
  if(body.object==='instagram' || body.object==='page'){
    res.status(200).send('EVENT_RECEIVED');
    for(let j=0;j<body.entry.length;j++){
      const entry=body.entry[j];
      const ev=entry.messaging?entry.messaging[0]:null;
      if(ev && ev.message && ev.message.text){
        if(ev.message.is_echo) continue;
        const sid=ev.sender.id;
        const txt=ev.message.text;
        console.log("Gelen Mesaj [IGSID: "+sid+"]: "+txt);
        const reply=await getAIReply(txt);
        await sendInstagramMessage(sid,reply);
      }
    }
  }else res.sendStatus(404);
});
async function sendInstagramMessage(rid,text){
  try{
    const url="https://graph.facebook.com/v20.0/"+IG_ID+"/messages";
    const r=await ax.post(url,{recipient:{id:rid},message:{text:text}},{params:{access_token:PAGE_ACCESS_TOKEN}});
    console.log("Gonderildi: \""+text.slice(0,100)+"...\" | ID: "+r.data.message_id);
  }catch(e){ console.error('Gonderme hatasi:', e.response?JSON.stringify(e.response.data):e.message); }
}
app.get('/',function(req,res){res.send('Bot Aktif! GuGu Clinic - Elif AI v7 Kurumsal');});
app.listen(PORT,function(){console.log("Sunucu "+PORT+" portunda... Elif AI v7 hazir");});
