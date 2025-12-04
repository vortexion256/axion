// webhook.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const admin = require("firebase-admin");
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
app.use(bodyParser.json());

// Health check endpoint
app.get("/health", (req, res) => res.json({ ok: true }));

// WhatsApp webhook
app.post("/webhook/whatsapp", async (req, res) => {
  try {
    console.log("🔔 Incoming /webhook/whatsapp request body:", req.body);
    const { message, from, id } = req.body;

    if (!message || !from || !id) {
      console.warn("⚠️ Missing required fields in webhook payload:", req.body);
      return res.status(400).json({ error: "Missing required fields", received: req.body });
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

    // 3️⃣ Update conversation's lastUpdated timestamp
    await convRef.update({
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Saved message from ${from} in conversation ${convId}: "${message}"`);

    // 4️⃣ Add AI reply as the next message
    const aiMsgId = `ai-${Date.now()}`;
    const aiMsgRef = convRef.collection("messages").doc(aiMsgId);
    await aiMsgRef.set({
      from: "Axion AI",
      body: `AI reply to "${message}"`,
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
