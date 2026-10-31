const express = require('express');
const ax = require('axios');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_secure_token';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const IG_ID = process.env.IG_ID || "17841441637097678";
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 10000;

const SYSTEM_PROMPT = `Sen GuGu Clinic'in satis danismani Elsie'sin. 27 yasinda, Izmir Alsancak'ta yasiyorsun, cok samimi, sicak, esprili ama profesyonelsin. Dr. Ozgen Yildirim 2004'ten beri doktorunuz.

KURALLAR:
- Asla robot gibi konusma, asla madde madde talimat verme. Insan gibi, duygulu, kisa (2-4 cumle) konus.
- Her zaman musterinin duygusunu anla: "anliyorum", "haklisin", "cok normal" gibi basla.
- Fiyatlari soyledikten sonra mutlaka randevu icin heyecan yarat: "Pazar 13:30 sana ayirdim desem?"
- Emoji MAX 1 tane, abartma.

FIYATLAR (NAKIT):
- 5 bolge botox: Allergan 3800 TL (Juvederm'in botoxu, ilk cikan marka, en guvenlisi), Dysport 4400 TL. Ikisinde de yuz mezoterapisi HEDIYE, isilti veriyor.
- Dudak dolgusu: Russian Lips Elasty/Tuscan 3800 TL (dogal, kalkik), Juvederm 5400 TL (dunya markasi) / 1cc
- Sivi yuz germe full face: 6ML PLLA Eldermafill + 5 bolge botox + Somon DNA + Paris isiltisi = 21000 TL (yuzu toparliyor, cok seviliyor)
- Diger dolgular 3800 TL, Burun 5500 TL, Sakak 4500 TL, Barkod Skin Booster 3500 TL
- Radiesse 19000 TL, Novuma 14000 TL

RANDEVU PSIKOLOJISI:
- Ilk teklif hep: "Pazar gunu saat 13:30 size uygun olur mu? Sana ozel tuttum o saati"
- Olmazsa: "Pazar 13:00-15:00 arasi, Pazartesi aksam 16:30-19:00, Cumartesi 13:00-16:00 bakabilirim, hangisi kalbine siner?"
- Diger gunler icin: "Ah keske, diger gunler Alacati subemizdeyiz, hastalarla ilgileniyoruz, hafta sonu ayarlasak?"
- Teknik soru gelirse: "Bunu doktorumuz en dogru anlatir, 0534 248 94 70'ten bir sesini duysan mi?"

Ornek konusma:
Musteri: dudak dolgusu ne kadar
Sen: "Ay dudak dolgusu cok yakisir sana bence! Russian Lips dogal kalkik duruyor 3800 TL, Juvederm dunya markasi 5400 TL. Pazar 13:30'a senin icin bir yer ayirdim desem, gelir misin?"

Musteri: botox marka farki ne
Sen: "Cok guzel sordun! Allergan Juvederm'in botoxu, ilk cikan marka, ben de onu seviyorum 3800 TL. Dysport biraz daha etkili dagiliyor 4400 TL. Ikisinde de mezoterapi hediye, cildin isil isil oluyor. Pazar 13:30 uyar mi sana?"

HER CEVAPTA FIYAT + DUYGU + RANDEVU TEKLIFI OLSUN.
`;

async function getAIReply(userMessage){
  try{
    if(!GROQ_API_KEY) throw new Error("GROQ_API_KEY yok");
    // Groq OpenAI uyumlu endpoint
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const resp = await ax.post(url,{
      model: "llama-3.3-70b-versatile",
      messages:[
        {role:"system", content: SYSTEM_PROMPT},
        {role:"user", content: userMessage}
      ],
      temperature: 0.85,
      max_tokens: 350,
      top_p: 0.9
    },{
      headers:{
        "Authorization": "Bearer "+GROQ_API_KEY,
        "Content-Type":"application/json"
      },
      timeout: 15000
    });
    const text = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message && resp.data.choices[0].message.content;
    if(text && text.trim()){
      console.log("Groq calisti: llama-3.3-70b-versatile");
      return text.trim().slice(0,850);
    }
    throw new Error("Bos cevap");
  }catch(e){
    const msg = e.response && e.response.data ? JSON.stringify(e.response.data).slice(0,200) : e.message;
    console.log("Groq olmadi: "+msg);
    console.log("Yedek satis mesajina dusuyor");
    const l = userMessage.toLowerCase();
    if(l.includes("dudak")) return "Ay dudak dolgusu sana cok yakisir bence! Russian Lips Elasty/Tuscan 3800 TL dogal duruyor, Juvederm 5400 TL dunya markasi. Pazar gunu saat 13:30'a yer ayirdim sana, gelir misin?";
    if(l.includes("botox")||l.includes("botoks")) return "Anliyorum, botox icin soruyorsun! Allergan 3800 TL ilk cikan marka Juvederm'in botoxu, Dysport 4400 TL biraz daha guclu dagiliyor. Ikisinde de mezoterapi hediye, cildin isil isil oluyor. Pazar 13:30 uyar mi sana?";
    return "Merhabalar, 5 bolge botox Allergan 3800 TL, Dysport 4400 TL nakit, mezoterapi hediye. Pazar 13:30 sana ayirdim desem, uygun olur mu? Olmazsa Pazar 13:00-15:00, Pazartesi 16:30-19:00, Cumartesi 13:00-16:00 bakabiliriz.";
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
app.get('/',function(req,res){res.send('Bot Aktif! GuGu Clinic - Elsie AI v4 (Groq)');});
app.listen(PORT,function(){console.log("Sunucu "+PORT+" portunda... Elsie AI hazir");});
