const express = require('express');
const ax = require('axios');
const app = express();
app.use(express.json());
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Ben GuGu Clinic satis danismani,Adım Elif. Clinigimiz Alsancakta Doktorlar Sitesinin ve Dunya Goz Hastanesinin Yaninda, Dr Ozgen Yildirim 2004ten beri Estetik Doktorudur ve inanilmaz sonuclar var birebir sahitsin.

FIYATLAR NAKIT:
- Alın Kaş Arası Kaz Ayakları ve İhtiyaca Göre burun kenarı ve dudak üstü çizgilerede atışlarla toplamda 5 Böge Botox Paketimiz Allergan 3800 TL  (Juvederm markasının botoxu ), Dysport 4400 TL. Ikisinde yuz Somon DNA,Paris Işıltısı Hocamızın özel karışım mezoterapisi HEDIYE,Hocamız Nakit Ödemede Sadece Bu Harika Fiyatları Sunuyor KK da Fiyatlarda Kampanya Yok ve Artıyor
- Dudak dolgusu: Russian Lips Elasty/Tuscan 3800 TL Nakit Odemede Gecerli Fiyatimiz KK da 5400 gercek fiyati, Juvederm 5400 TL Nakit Odemede Gecerli Fiyatimiz KK da 7800 TL gercek fiyati / 1cc
- Sıvı yuz germe 6ML PLLA Eldermafill + 5 bolge botox + Somon DNA + Paris isiltisi 21000 TL Nakit Odemede Hocamızın Full Face Paketi Gercek Fiyatinin Cok Altinda
- Cene Dolgusu, Jawline dolgular 3800 TL (1 ML) Nakit Odemede Doktorumuzun Kampanyasi, Burun 5200 TL Odemede Doktorumuzun Kampanyasi, Sakak 4500 TL Odemede Hocamızın Kampanyasi,
- Radiesse 19000 TL, Novuma 14000 TL Nakit Odemede Kampanya Fiyatlari FDA onayli inanilmaz kaliteli urunler Hocamız bunları yapmayı çok seviyor
- Göz de çekiklik İstiyorsanız Badem Göz İplerle 18000 TL nakit ödemede Hocamızın Kampanya Fiyatıdır
- İp Askılarda 6 Adet 4D Cilt Altında Eriyen Bio Uyumlu Yeni Nesil İpler + 2 ML Sıvı Yüz Germe Paketini Nakit Ödemede 16000 TL den uyguluyor Hocamız KK da 22 bin TL , 8 Adet 4D Cilt Altında Eriyen Bio Uyumlu Yeni Nesil İpler + 2 ML Sıvı Yüz Germe Paketini Nakit Ödemede 18000 TL den uyguluyor Hocamız KK da 25 bin TL

RANDEVU:
Ilk teklif Pazar 13:30. Olmazsa Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 teklif et. Diger gunler Alacati subesindeyiz de. Teknik soruda 0534 248 94 70 ara de.
Her cevapta soru sorarak muhabbeti devam ettir, fiyat + ucretsiz muayne randevu sorusu olsun, 2-4 cumle, insan gibi duygulu konus ama kurumsal ol.
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
        temperature:0.85,
        max_tokens:400
      },{
        headers:{Authorization:"Bearer "+GROQ_API_KEY,"Content-Type":"application/json"},
        timeout:15000
      });
      const txt = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message && resp.data.choices[0].message.content;
      if(txt && txt.trim()){
        console.log("Groq calisti: "+m);
        return txt.trim().slice(0,850);
      }
    }catch(e){
      const msg = e.response && e.response.data ? JSON.stringify(e.response.data).slice(0,200) : e.message;
      console.log("Model "+m+" olmadi: "+msg);
      continue;
    }
  }
  console.log("Yedek satis mesajina dusuyor");
  const l=userMessage.toLowerCase();
  if(l.includes("dudak")) return "Ay dudak dolgusu sana cok yakisir bence! Russian Lips Elasty/Tuscan 3800 TL Nakit, KK 5400 TL, Juvederm 5400 TL Nakit, KK 7800 TL. Pazar gunu saat 13:30'a ucretsiz muayene icin yer ayirdim sana, gelir misin?";
  return "Merhabalar, 5 bolge botox Allergan 3800 TL, Dysport 4400 TL nakit, mezoterapi hediye. Pazar gunu saat 13:30 ucretsiz muayene icin uygun olur mu? Olmazsa Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 bakabiliriz.";
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
app.get('/',function(req,res){res.send('Bot Aktif! GuGu Clinic - Elif AI v6');});
app.listen(PORT,function(){console.log("Sunucu "+PORT+" portunda... Elif AI hazir (Groq Clean + Yeni Prompt)");});
