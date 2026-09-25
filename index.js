const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

// Gemini API Yapılandırması
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// 1. Meta Webhook Doğrulama (GET)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === VERIFY_TOKEN) {
        console.log("Webhook başarıyla doğrulandı!");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// 2. Gelen Instagram Mesajını İşleme (POST)
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'instagram') {
        try {
            for (const entry of body.entry) {
                if (entry.messaging) {
                    for (const webhookEvent of entry.messaging) {
                        // Güvenli kontrol: sender ve message nesnesi var mı?
                        if (webhookEvent.sender && webhookEvent.sender.id && webhookEvent.message && webhookEvent.message.text) {
                            const senderPsid = webhookEvent.sender.id;
                            const userMessage = webhookEvent.message.text;

                            // Echo mesajı (botun kendi gönderdiği mesaj) değilse işle
                            if (!webhookEvent.message.is_echo) {
                                console.log(`[GELEN MESAJ]: ${userMessage}`);

                                // GuGu Clinic Özel Sistem Promptu
                                const prompt = `
Sen GuGu Clinic için çalışan son derece nazik, profesyonel ve yönlendirici bir Instagram müşteri temsilcisisin.

Aşağıdaki kurallara kesinlikle uyarak yanıt ver:
1. Yanıtların her zaman Türkçe, samimi ve kısa/öz olsun (Instagram DM formatına uygun).
2. Kliniğin medikal estetik ve sağlık turizmi hizmetleri sunduğunu bil.
3. Fiyat veya tedavi detayları sorulduğunda nazikçe bilgilendir ve detaylı yönlendirme için kullanıcıyı kliniğin iletişim hattına davet et.
4. Tıbbi teşhis koyma veya kesin tedavi garantisi verme.
5. Uygun yerlerde kibar bir ton ve 1-2 emoji kullan.

Kullanıcı Mesajı: "${userMessage}"
                                `;

                                const result = await model.generateContent(prompt);
                                const aiResponse = result.response.text();
                                console.log(`[GEMİNİ YANITI]: ${aiResponse}`);

                                // Instagram'a Yanıt Gönder
                                await sendInstagramMessage(senderPsid, aiResponse);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error("İşleme hatası:", error);
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

async function sendInstagramMessage(senderPsid, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            {
                recipient: { id: senderPsid },
                message: { text: text }
            }
        );
        console.log("[BAŞARILI]: Yanıt Instagram'a iletildi.");
    } catch (err) {
        console.error("[GÖNDERME HATASI]:", err.response ? err.response.data : err.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda aktif...`));
