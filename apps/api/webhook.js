// webhook.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const path = require("path");

// Initialize Firebase Admin
const serviceAccount = require("./axion256system-firebase-adminsdk-fbsvc-bbb9336fa7.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

const app = express();
app.use(cors());
// Support both JSON (our tests) and URL-encoded form data (Twilio default)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Health check endpoint
app.get("/health", (req, res) => res.json({ ok: true }));

// WhatsApp webhook
app.post("/webhook/whatsapp", async (req, res) => {
  try {
    console.log("🔔 Incoming /webhook/whatsapp request body:", req.body);

    // Handle both our manual JSON tests and Twilio's x-www-form-urlencoded payload
    const body = req.body || {};

    const message = body.message || body.Body;
    const from = body.from || body.From;
    const id = body.id || body.MessageSid || body.SmsMessageSid;

    if (!message || !from || !id) {
      console.warn("⚠️ Missing required fields in webhook payload:", body);
      return res
        .status(400)
        .json({ error: "Missing required fields", received: body });
    }

    const tenantId = "demo-company";

    // 1️⃣ Check if a conversation exists for this sender
    const convQuery = await db
      .collection("companies")
      .doc(tenantId)
      .collection("conversations")
      .where("participants", "array-contains", from)
      .get();

    let convRef;
    let convId;

    if (!convQuery.empty) {
      // Use existing conversation
      convRef = convQuery.docs[0].ref;
      convId = convRef.id;
    } else {
      // Create a new conversation
      convId = `conv-${Date.now()}`;
      convRef = db
        .collection("companies")
        .doc(tenantId)
        .collection("conversations")
        .doc(convId);

      await convRef.set({
        participants: [from],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 2️⃣ Save incoming WhatsApp message in "messages" collection
    const msgRef = convRef.collection("messages").doc(id);
    await msgRef.set({
      from,
      body: message,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 3️⃣ Call AI (Gemini) to generate a reply
    const geminiApiKey =
      process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    let aiReplyText = `AI reply to "${message}"`;

    if (!geminiApiKey) {
      console.warn(
        "⚠️ GEMINI_API_KEY / NEXT_PUBLIC_GEMINI_API_KEY not set; using fallback AI reply text."
      );
    } else {
      try {
        const prompt = `You are Axion AI, a friendly and concise assistant replying to WhatsApp messages for a company.
User message: "${message}"
Reply in one or two sentences.`;

        // Use Gemini 2.5 Flash generateContent endpoint
        const geminiResponse = await axios.post(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
          {
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
          },
          {
            params: { key: geminiApiKey },
          }
        );

        const candidates = geminiResponse.data?.candidates || [];
        const parts = candidates[0]?.content?.parts || [];
        const text = parts.map((p) => p.text || "").join("").trim();

        if (text) {
          aiReplyText = text;
        } else {
          console.warn(
            "⚠️ Gemini 3 response did not contain text; falling back to default reply."
          );
        }
      } catch (aiErr) {
        console.error(
          "❌ Error calling Gemini 3 Pro API:",
          aiErr.response?.data || aiErr
        );
      }
    }

    // 4️⃣ Update conversation's lastUpdated timestamp
    await convRef.update({
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `✅ Saved message from ${from} in conversation ${convId}: "${message}"`
    );

    // 5️⃣ Add AI reply as the next message
    const aiMsgId = `ai-${Date.now()}`;
    const aiMsgRef = convRef.collection("messages").doc(aiMsgId);
    await aiMsgRef.set({
      from: "Axion AI",
      body: aiReplyText,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`🤖 AI reply saved in conversation ${convId}`);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error in webhook:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API running on port ${port}`));
