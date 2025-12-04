// webhook.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const twilio = require("twilio");
const path = require("path");

// Initialize Firebase Admin
const serviceAccount = require("./axion256system-firebase-adminsdk-fbsvc-bbb9336fa7.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Twilio setup (for sending WhatsApp replies)
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFromWhatsApp =
  process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

const twilioClient =
  twilioAccountSid && twilioAuthToken
    ? twilio(twilioAccountSid, twilioAuthToken)
    : null;

const app = express();
app.use(cors());
// Support both JSON (our tests) and URL-encoded form data (Twilio default)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Health check endpoint
app.get("/health", (req, res) => res.json({ ok: true }));

// WhatsApp webhook (Twilio inbound)
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
    let convDocData;

    if (!convQuery.empty) {
      // Use existing conversation
      const convDoc = convQuery.docs[0];
      convRef = convDoc.ref;
      convId = convRef.id;
      convDocData = convDoc.data();
    } else {
      // Create a new conversation
      convId = `conv-${Date.now()}`;
      convRef = db
        .collection("companies")
        .doc(tenantId)
        .collection("conversations")
        .doc(convId);

      const initialConvData = {
        participants: [from],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        aiEnabled: true, // AI is enabled by default for new conversations
      };

      await convRef.set(initialConvData);
      convDocData = initialConvData;
    }

    // If conversation doc somehow had no data loaded, fetch it
    if (!convDocData) {
      const snap = await convRef.get();
      convDocData = snap.data() || {};
    }

    const aiEnabled = convDocData.aiEnabled !== false; // treat missing as true

    // 2️⃣ Save incoming WhatsApp message in "messages" collection
    const msgRef = convRef.collection("messages").doc(id);
    await msgRef.set({
      from,
      body: message,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // If AI is disabled for this conversation, only store the user message and update lastUpdated
    if (!aiEnabled) {
      console.log(
        `🤖 AI is disabled for conversation ${convId}; only storing incoming message.`
      );

      await convRef.update({
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.sendStatus(200);
    }

    // 3️⃣ Load recent conversation history for AI context
    let history = [];
    try {
      const historySnap = await convRef
        .collection("messages")
        .orderBy("createdAt", "asc")
        .limitToLast(20)
        .get();

      history = historySnap.docs.map((d) => d.data());
    } catch (historyErr) {
      console.error(
        "❌ Error loading conversation history for AI:",
        historyErr
      );
    }

    // 4️⃣ Call AI (Gemini) to generate a reply
    const geminiApiKey =
      process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    let aiReplyText = `AI reply to "${message}"`;

    if (!geminiApiKey) {
      console.warn(
        "⚠️ GEMINI_API_KEY / NEXT_PUBLIC_GEMINI_API_KEY not set; using fallback AI reply text."
      );
    } else {
      try {
        const historyText = history
          .map((m) => `${m.from}: ${m.body}`)
          .join("\n");

        const prompt = `You are Axion AI, a friendly, helpful WhatsApp assistant for a company.
You are chatting 1:1 with a real user over WhatsApp.
Always respond naturally, avoid generic replies like "Ok" or "Noted".
Be proactive: acknowledge what they said, add a bit of helpful context, and ask a simple follow-up question if it makes sense.
Keep replies short (1–3 sentences), friendly, and easy to read on a phone.

Here is the recent conversation history (oldest to newest):
${historyText}

Continue the conversation with your next message.`;

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

    // 5️⃣ Update conversation's lastUpdated timestamp
    await convRef.update({
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `✅ Saved message from ${from} in conversation ${convId}: "${message}"`
    );

    // 6️⃣ Add AI reply as the next message (store in Firestore)
    const aiMsgId = `ai-${Date.now()}`;
    const aiMsgRef = convRef.collection("messages").doc(aiMsgId);
    await aiMsgRef.set({
      from: "Axion AI",
      body: aiReplyText,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`🤖 AI reply saved in conversation ${convId}`);

    // 7️⃣ Send AI reply back to the user via WhatsApp (Twilio)
    if (!twilioClient) {
      console.warn(
        "⚠️ Twilio client not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN); not sending WhatsApp reply."
      );
    } else {
      try {
        const toWhatsApp = from.startsWith("whatsapp:")
          ? from
          : `whatsapp:${from}`;

        await twilioClient.messages.create({
          from: twilioFromWhatsApp,
          to: toWhatsApp,
          body: aiReplyText,
        });

        console.log(
          `📤 Sent WhatsApp reply to ${toWhatsApp} via Twilio: "${aiReplyText}"`
        );
      } catch (twilioErr) {
        console.error(
          "❌ Error sending WhatsApp reply via Twilio:",
          twilioErr?.response?.data || twilioErr
        );
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error in webhook:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Agent send-message endpoint (used by Inbox UI to let a human reply)
app.post("/agent/send-message", async (req, res) => {
  try {
    const { convId, body } = req.body || {};

    if (!convId || !body) {
      return res
        .status(400)
        .json({ error: "convId and body are required", received: req.body });
    }

    const tenantId = "demo-company";

    const convRef = db
      .collection("companies")
      .doc(tenantId)
      .collection("conversations")
      .doc(convId);

    const convSnap = await convRef.get();
    if (!convSnap.exists) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const convData = convSnap.data() || {};
    const participants = convData.participants || [];
    const to = participants[0];

    if (!to) {
      return res
        .status(400)
        .json({ error: "Conversation has no participant phone number" });
    }

    // 1️⃣ Store agent message in Firestore
    const agentMsgId = `agent-${Date.now()}`;
    const agentMsgRef = convRef.collection("messages").doc(agentMsgId);
    await agentMsgRef.set({
      from: "Agent",
      role: "agent",
      body,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2️⃣ Update conversation lastUpdated
    await convRef.update({
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 3️⃣ Send WhatsApp message via Twilio
    if (!twilioClient) {
      console.warn(
        "⚠️ Twilio client not configured; stored agent message but did not send WhatsApp message."
      );
    } else {
      try {
        const toWhatsApp = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

        await twilioClient.messages.create({
          from: twilioFromWhatsApp,
          to: toWhatsApp,
          body,
        });

        console.log(
          `📤 Sent agent WhatsApp message to ${toWhatsApp}: "${body}"`
        );
      } catch (twilioErr) {
        console.error(
          "❌ Error sending agent WhatsApp message via Twilio:",
          twilioErr?.response?.data || twilioErr
        );
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error in /agent/send-message:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Agent toggle-AI endpoint (updates aiEnabled and notifies user)
app.post("/agent/toggle-ai", async (req, res) => {
  try {
    const { convId, enable } = req.body || {};

    if (!convId || typeof enable !== "boolean") {
      return res.status(400).json({
        error: "convId and boolean enable are required",
        received: req.body,
      });
    }

    const tenantId = "demo-company";

    const convRef = db
      .collection("companies")
      .doc(tenantId)
      .collection("conversations")
      .doc(convId);

    const convSnap = await convRef.get();
    if (!convSnap.exists) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const convData = convSnap.data() || {};
    const participants = convData.participants || [];
    const to = participants[0];

    // 1️⃣ Update aiEnabled on conversation
    await convRef.update({
      aiEnabled: enable,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    const statusText = enable
      ? "Axion AI assistant has been turned ON. You may receive automated replies."
      : "Axion AI assistant has been turned OFF. You are now chatting with a human agent.";

    // 2️⃣ Store a system message in Firestore so inbox shows the change
    const systemMsgId = `system-ai-toggle-${Date.now()}`;
    const systemMsgRef = convRef.collection("messages").doc(systemMsgId);
    await systemMsgRef.set({
      from: "System",
      role: "system",
      body: statusText,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 3️⃣ Optionally notify user via WhatsApp
    if (!twilioClient || !to) {
      if (!twilioClient) {
        console.warn(
          "⚠️ Twilio client not configured; stored AI toggle system message but did not send WhatsApp notification."
        );
      }
    } else {
      try {
        const toWhatsApp = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

        await twilioClient.messages.create({
          from: twilioFromWhatsApp,
          to: toWhatsApp,
          body: statusText,
        });

        console.log(
          `📤 Sent AI status notification to ${toWhatsApp}: "${statusText}"`
        );
      } catch (twilioErr) {
        console.error(
          "❌ Error sending AI status notification via Twilio:",
          twilioErr?.response?.data || twilioErr
        );
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error in /agent/toggle-ai:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API running on port ${port}`));
