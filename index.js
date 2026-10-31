const express = require('express');
const ax = require('axios');
const app = express();
app.use(express.json());
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Sen GuGu Clinic satis danismani Elsie'sin. Dr Ozgen Yildirim 2004ten beri. Samimi, sicak, kisa, net yaz. Asla talimatlari tekrar etme, sadece musteriye cevap ver.

FIYATLAR NAKIT:
- 5 bolge botox: Allergan 3800 TL (Juvederm botoxu ilk marka), Dysport 4400 TL. Ikisinde yuz mezoterapisi HEDIYE
- Dudak dolgusu Russian Lips Elasty/Tuscan 3800 TL, Juvederm 5400 TL
- Sivi yuz germe 6ML PLLA Eldermafill + 5 bolge botox + Somon DNA + Paris isiltisi 21000 TL
- Diger dolgular 3800 TL, Burun 5500 TL, Sakak 4500 TL, Barkod Skin Booster 3500 TL
- Radiesse 19000 TL, Novuma 14000 TL

RANDEVU: Ilk teklif Pazar 13:30. Olmazsa Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 teklif et. Diger gunler Alacati subesindeyiz de. Teknik soruda 0534 248 94 70 ara de.
Her cevapta fiyat + randevu sorusu olsun.`;

async function getGeminiReply(userMessage){
  try{
    if(!GEMINI_API_KEY) throw new Error("API_KEY yok");
    const modelsToTry = ["gemini-2.5-flash-lite","gemini-2.5-flash-lite-001","gemini-1.5-flash-001","gemini-1.5-flash-latest"];
    for(let i=0;i<modelsToTry.length;i++){
      const m = modelsToTry[i];
      try{
        const url = "https://generativelanguage.googleapis.com/v1/models/"+m+":generateContent?key="+GEMINI_API_KEY;
        const resp = await ax.post(url,{
          systemInstruction:{parts:[{text:SYSTEM_PROMPT}]},
          contents:[{role:"user",parts:[{text:userMessage}]}],
          generationConfig:{temperature:0.85,maxOutputTokens:400}
        },{headers:{'Content-Type':'application/json'}});
        const cand = resp.data && resp.data.candidates && resp.data.candidates[0];
        const txt = cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text;
        if(txt && txt.trim().length>15){
          if(txt.includes("Role: Sales Consultant") || txt.includes("Option 1") || txt.includes("Customer Query")){
            console.log("Model promptu kopyaladi, diger modele gec: "+m);
            continue;
          }
          console.log("Gemini calisti: "+m+" (REST v1)");
          return txt.trim().slice(0,850);
        }
      }catch(e){
        const msg = e.response && e.response.data && e.response.data.error ? e.response.data.error.message : e.message;
        console.log("Model "+m+" olmadi: "+(msg?msg.slice(0,120):"hata"));
      }
    }
    throw new Error("Tum modeller kapali");
  }catch(err){
    console.log("Yedek satis mesajina dusuyor");
    const l = userMessage.toLowerCase();
    if(l.includes("dudak")) return "Merhabalar, dudak dolgusu Russian Lips Elasty/Tuscan 3800 TL, Juvederm 5400 TL nakit / 1cc. Pazar gunu saat 13:30 size uygun olur mu?";
    return "Merhabalar, 5 bolge botox Allergan 3800 TL (Juvederm botoxu ilk marka), Dysport 4400 TL nakit, mezoterapi hediye. Pazar gunu saat 13:30 size uygun olur mu? Olmazsa Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 bakabiliriz.";
  }
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
        const reply=await getGeminiReply(txt);
        await sendInstagramMessage(sid,reply);
      }
    }
  }else res.sendStatus(404);
});
async function sendInstagramMessage(rid,text){
  try{
    const url="https://graph.facebook.com/v20.0/"+IG_ID+"/messages";
    const r=await ax.post(url,{recipient:{id:rid},message:{text:text}},{params:{access_token:PAGE_ACCESS_TOKEN}});
    console.log("Gonderildi: \""+text.slice(0,90)+"...\" | ID: "+r.data.message_id);
  }catch(e){ console.error('Gonderme hatasi:', e.response?JSON.stringify(e.response.data):e.message); }
}
app.get('/',function(req,res){res.send('Bot Aktif! GuGu Clinic - Elsie v3');});
app.listen(PORT,function(){console.log("Sunucu "+PORT+" portunda...");});
