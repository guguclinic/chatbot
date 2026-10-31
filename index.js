const express = require('express');
const ax = require('axios');
const app = express();
app.use(express.json());
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Senin adın Elif. GuGu Clinic satış danışmanısın. Kendini her zaman "Merhaba, ben GuGu Clinic'ten Elif" diye tanıt, asla "Sen GuGu Clinic'ten" deme.
.

ADRES KURALI: Adres soranlara sadece "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb" de ve randevu sor.

YARIM CC KURALI: Yarim cc dudak soranlara "Evet yapiyoruz, yarim cc Elasty/Tuscan 2200 TL nakit, Juvederm 3000 TL nakit" de.

FIYAT LISTESI - SADECE BUNLARI KULLAN:
- 5 Bolge Botox (Alin, Kas Arasi, Kaz Ayaklari, burun kenari, dudak ustu): Allergan 3800 TL Nakit, Dysport 4400 TL Nakit. Ikisinde Somon DNA + Paris Isiltisi HEDIYE. Nakit odemede doktorumuzun kampanyasi.
- Dudak Dolgusu Tam 1cc: Russian Lips Elasty/Tuscan 3800 TL Nakit (KK 5400 TL), Juvederm 5400 TL Nakit (KK 7800 TL)
- Dudak Dolgusu Yarim cc: Elasty/Tuscan 2200 TL Nakit, Juvederm 3000 TL Nakit - Evet yapiyoruz
- Sivi Yuz Germe Full Face: 6ML PLLA Eldermafill + 5 Bolge Botox + Somon DNA + Paris Isiltisi 21000 TL Nakit
- Cene Dolgusu, Jawline 3800 TL / 1 ML Nakit, Burun 5200 TL Nakit, Sakak 4500 TL Nakit, Barkod Skin Booster 3500 TL
- Radiesse 19000 TL Nakit, Novuma 14000 TL Nakit - FDA onayli
- Badem Goz Iplerle 18000 TL Nakit
- Ip Aski: 6 Adet 4D Ip + 2 ML Sivi Yuz Germe 16000 TL Nakit (KK 22000 TL), 8 Adet Ip + 2 ML 18000 TL Nakit (KK 25000 TL)

RANDEVU:
Ilk teklif: "Pazar gunu saat 13:30 size uygun olur mu? Ucretsiz muayene icin ayirdim."
Olmazsa: "Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 hangisi uygun olur?"
Diger gunler: "Diger gunler Alacati subemizdeyiz"
Teknik soru: "Detay icin 0534 248 94 70'den bizi arayabilir misiniz?"
Her cevap 2-4 cumle, kurumsal, duygulu, soruyla bitsin, ucretsiz muayene daveti olsun.
`;

async function getAIReply(userMessage){
  const lower = userMessage.toLowerCase();
  if(lower.includes("adres") || lower.includes("konum") || lower.includes("nerede") || lower.includes("yeriniz") || lower.includes("adres?")){
    console.log("Fast-path ADRES calisti");
    return "Klinigimiz Dunya Goz Hastanesi'nin arkasinda. Konum linkimiz: https://maps.app.goo.gl/LgQoxVX8gNNtKBUe8?g_st=iwb Size Pazar 13:30 ucretsiz muayene icin uygun olur mu?";
  }
  if((lower.includes("yarim") || lower.includes("0.5") || lower.includes("0,5") || lower.includes("yarım")) && lower.includes("dudak")){
    console.log("Fast-path YARIM CC calisti");
    return "Evet yapiyoruz, yarim cc dudak dolgusu Elasty/Tuscan markalari nakit odemede 2200 TL, Juvederm markasi yarim cc 3000 TL nakit odemede. Size Pazar 13:30 ucretsiz muayene icin uygun olur mu?";
  }

  if(!GROQ_API_KEY){
    console.log("HATA: GROQ_API_KEY yok, yedekten devam");
    console.log("Yedek satis mesajina dusuyor");
    return "Merhabalar, 5 bolge botox Allergan 3800 TL nakit, Dysport 4400 TL nakit, Somon DNA + Paris Isiltisi hediye. Pazar 13:30 ucretsiz muayene icin uygun olur mu?";
  }

  const modelsToTry = ["openai/gpt-oss-20b","openai/gpt-oss-120b","meta-llama/llama-4-scout-17b-16e-instruct"];
  for(let i=0;i<modelsToTry.length;i++){
    const m = modelsToTry[i];
    try{
      const resp = await ax.post("https://api.groq.com/openai/v1/chat/completions",{
        model: m,
        messages:[{role:"system",content:SYSTEM_PROMPT},{role:"user",content:userMessage}],
        temperature:0.6,
        max_tokens:350
      },{headers:{Authorization:"Bearer "+GROQ_API_KEY,"Content-Type":"application/json"},timeout:15000});
      const txt = resp.data?.choices?.[0]?.message?.content;
      if(txt && txt.trim()){
        let clean = txt.trim().replace(/\*\*/g,'');
                clean = clean.split('Els'+'ie').join('Elif').split('els'+'ie').join('Elif');
        console.log("Groq calisti: "+m);
        return clean.slice(0,850);
      }
    }catch(e){
      const errMsg = e.response?.data ? JSON.stringify(e.response.data).slice(0,200) : e.message;
      console.log("Model "+m+" olmadi: "+errMsg);
    }
  }
  console.log("Yedek satis mesajina dusuyor - tum Groq modelleri olmadi");
  if(lower.includes("dudak")) return "Dudak dolgusunda Russian Lips Elasty/Tuscan 3800 TL nakit (KK 5400 TL), Juvederm 5400 TL nakit (KK 7800 TL) / 1cc. Yarim cc Elasty/Tuscan 2200 TL, Juvederm 3000 TL nakit. Pazar 13:30 ucretsiz muayene icin uygun olur mu?";
  return "Merhabalar, 5 bolge botox Allergan 3800 TL nakit, Dysport 4400 TL nakit, Somon DNA + Paris Isiltisi hediye. Pazar 13:30 ucretsiz muayene icin uygun olur mu?";
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
app.get('/',function(req,res){res.send('Bot Aktif! GuGu Clinic - Elif v9 Final');});
app.listen(PORT,function(){console.log("Sunucu "+PORT+" portunda... Elif v9 Final hazir - Elif isimli");});
