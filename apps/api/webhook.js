// webhook.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const admin = require("firebase-admin");
// Firebase Admin SDK uses different API
// Let's use the collection reference directly with where clauses
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

// Helper function to get user initials
function getUserInitials(name) {
  if (!name) return '';
  const parts = name.trim().split(' ');
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Helper function to assign ticket to available respondent or admin
async function assignTicketToRespondent(ticketRef, tenantId, company) {
  try {
    console.log(`🔍 Checking assignment for company: ${tenantId}`);

    // Get all active respondents for this company
    const respondentsRef = db.collection('companies').doc(tenantId).collection('respondents');
    const respondentsSnap = await respondentsRef.where('status', '==', 'active').get();

    let assignedTo = null;
    let assignedEmail = null;

    if (!respondentsSnap.empty) {
      const respondents = respondentsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log(`👥 [${new Date().toISOString()}] Found ${respondents.length} total respondents for company ${tenantId}`);
      console.log('Respondents details:', respondents.map(r => ({
        email: r.email,
        status: r.status,
        isOnline: r.isOnline,
        lastSeen: r.lastSeen
      })));

      // Priority 1: Assign to online respondents first
      const onlineRespondents = respondents.filter(r => r.isOnline === true);
      console.log(`🟢 Online respondents: ${onlineRespondents.length}`);

      // Priority 1.5: Also consider recently online respondents (last 5 minutes)
      const recentlyOnlineRespondents = respondents.filter(r => {
        if (r.lastSeen) {
          const lastSeen = r.lastSeen.toDate ? r.lastSeen.toDate() : new Date(r.lastSeen);
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          return lastSeen > fiveMinutesAgo;
        }
        return false;
      });
      console.log(`🕐 Recently online respondents: ${recentlyOnlineRespondents.length}`);

      let assignedRespondent = null;

      if (onlineRespondents.length > 0) {
        // Priority 1: Round-robin assignment among online respondents
        const lastAssignedIndex = company.lastAssignedOnlineIndex || 0;
        const nextIndex = lastAssignedIndex % onlineRespondents.length;
        assignedRespondent = onlineRespondents[nextIndex];

        console.log(`🎯 Round-robin: ${nextIndex + 1}/${onlineRespondents.length} online respondents`);
        console.log(`🎯 Assigned to online respondent: ${assignedRespondent.name || assignedRespondent.email} (${assignedRespondent.email})`);

        // Update the round-robin index on the company
        try {
          const companyRef = db.collection('companies').doc(tenantId);
          await companyRef.update({
            lastAssignedOnlineIndex: nextIndex + 1,
          });
        } catch (updateError) {
          console.error('Failed to update last assigned online index:', updateError);
        }
      } else if (recentlyOnlineRespondents.length > 0) {
        // Priority 1.5: Round-robin assignment among recently online respondents
        const lastAssignedIndex = company.lastAssignedRecentIndex || 0;
        const nextIndex = lastAssignedIndex % recentlyOnlineRespondents.length;
        assignedRespondent = recentlyOnlineRespondents[nextIndex];

        console.log(`⏰ Round-robin: ${nextIndex + 1}/${recentlyOnlineRespondents.length} recently online respondents`);
        console.log(`⏰ Assigned to recently online respondent: ${assignedRespondent.name || assignedRespondent.email} (${assignedRespondent.email})`);

        // Update the round-robin index on the company
        try {
          const companyRef = db.collection('companies').doc(tenantId);
          await companyRef.update({
            lastAssignedRecentIndex: nextIndex + 1,
          });
        } catch (updateError) {
          console.error('Failed to update last assigned recent index:', updateError);
        }
      } else if (respondents.length > 0) {
        // Check if admin is online - if so, assign to admin instead of offline respondents
        const companyRef = db.collection('companies').doc(tenantId);
        const companySnap = await companyRef.get();
        const companyData = companySnap.data() || {};
        const adminOnline = companyData.adminOnline === true;

        if (adminOnline) {
          console.log(`👨‍💼 Admin is online, assigning to admin instead of offline respondents`);
          assignedTo = 'Admin';
          assignedEmail = null;
          console.log(`👨‍💼 Assigned conversation to Admin (all respondents offline)`);
        } else {
          // Priority 2: Round-robin assignment among offline respondents
          const lastAssignedIndex = company.lastAssignedAnyIndex || 0;
          const nextIndex = lastAssignedIndex % respondents.length;
          assignedRespondent = respondents[nextIndex];

          console.log(`⚖️ Round-robin: ${nextIndex + 1}/${respondents.length} available respondents`);
          console.log(`⚖️ Assigned to offline respondent: ${assignedRespondent.name || assignedRespondent.email} (${assignedRespondent.email})`);

          // Update the round-robin index on the company
          try {
            await companyRef.update({
              lastAssignedAnyIndex: nextIndex + 1,
            });
          } catch (updateError) {
            console.error('Failed to update last assigned any index:', updateError);
          }

          assignedTo = assignedRespondent.name || assignedRespondent.email.split('@')[0];
          assignedEmail = assignedRespondent.email;
        }
      }

      if (assignedRespondent) {
        assignedTo = assignedRespondent.name || assignedRespondent.email.split('@')[0];
        assignedEmail = assignedRespondent.email;
        console.log(`📧 Assigned conversation to: ${assignedTo} (${assignedEmail})`);
      }

      // TEMPORARY DEBUG: Force assign to first respondent if admin would be assigned
      if (!assignedTo && respondents.length > 0) {
        console.log('🔧 DEBUG: Forcing assignment to first respondent for testing');
        const firstRespondent = respondents[0];
        assignedTo = firstRespondent.name || firstRespondent.email.split('@')[0];
        assignedEmail = firstRespondent.email;
        console.log(`🎯 DEBUG: Force assigned to: ${assignedTo} (${assignedEmail})`);
      }
    }

    // If no respondents available or assignment failed, assign to admin
    if (!assignedTo) {
      assignedTo = 'Admin';
      assignedEmail = null;
      console.log(`👨‍💼 No respondents available, assigned to Admin`);
    }

    // Update ticket with assignment
    await ticketRef.update({
      assignedTo,
      assignedEmail,
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      aiEnabled: assignedTo === 'Admin', // Enable AI when assigned to admin
    });

    console.log(`👤 Assigned conversation to: ${assignedTo}`);
    return { assignedTo, assignedEmail };
  } catch (error) {
    console.error('Error assigning conversation:', error);
    // Fallback: assign to admin
    await convRef.update({
      assignedTo: 'Admin',
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { assignedTo: 'Admin', assignedEmail: null };
  }
}

const app = express();
app.use(cors());
// Support both JSON (our tests) and URL-encoded form data (Twilio default)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Health check endpoint
app.get("/health", (req, res) => res.json({ ok: true }));

// Test webhook endpoint for manual testing
app.post("/test-webhook/:tenantId", async (req, res) => {
  try {
    const { message, from } = req.body;
    const tenantId = req.params.tenantId;

    console.log(`🧪 Test webhook called for company ${tenantId}:`, { message, from });

    // Load company configuration
    const companyRef = db.collection("companies").doc(tenantId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      return res.status(404).json({
        error: "Company not found",
        tenantId,
        message: "Make sure you're logged in and your company is registered"
      });
    }

    const company = companySnap.data();

    return res.json({
      success: true,
      company: company.name,
      tenantId,
      message,
      from,
      timestamp: new Date().toISOString(),
      note: "Webhook is working! Configure this URL in your Twilio WhatsApp settings."
    });

  } catch (error) {
    console.error("Test webhook error:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

// WhatsApp webhook (Twilio inbound)
app.post("/webhook/whatsapp/:tenantId", async (req, res) => {
  try {
    console.log("🔔 Incoming /webhook/whatsapp request body:", req.body);

    // Handle both our manual JSON tests and Twilio's x-www-form-urlencoded payload
    const body = req.body || {};

    const message = body.message || body.Body;
    const from = body.from || body.From;
    const id = body.id || body.MessageSid || body.SmsMessageSid;
    const tenantId = req.params.tenantId;

    if (!message || !from || !id || !tenantId) {
      console.warn("⚠️ Missing required fields in webhook payload:", { message, from, id, tenantId });
      return res
        .status(400)
        .json({ error: "Missing required fields", received: { message, from, id, tenantId } });
    }

    // Load company configuration
    const companyRef = db.collection("companies").doc(tenantId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      console.warn(`⚠️ Company ${tenantId} not found`);
      return res.status(404).json({ error: "Company not found" });
    }

    const company = companySnap.data();
    console.log(`📍 Processing webhook for company: ${company.name} (${tenantId})`);

    // 1️⃣ Check if an open ticket exists for this customer
    const ticketQuery = await db
      .collection("companies")
      .doc(tenantId)
      .collection("tickets")
      .where("customerId", "==", from)
      .where("status", "!=", "closed")
      .get();

    let ticketRef;
    let ticketId;
    let ticketDocData;

    if (!ticketQuery.empty) {
      // Use existing open ticket
      const ticketDoc = ticketQuery.docs[0];
      ticketRef = ticketDoc.ref;
      ticketId = ticketRef.id;
      ticketDocData = ticketDoc.data();
    } else {
      // Create a new ticket
      ticketId = `ticket-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      ticketRef = db
        .collection("companies")
        .doc(tenantId)
        .collection("tickets")
        .doc(ticketId);

      // Check for previous tickets from this customer
      const previousTicketsQuery = await db
        .collection("companies")
        .doc(tenantId)
        .collection("tickets")
        .where("customerId", "==", from)
        .where("status", "in", ["closed", "pending"])
        .orderBy("updatedAt", "desc")
        .limit(3)
        .get();

      const previousTicketsCount = previousTicketsQuery.size;
      let customerHistorySummary = "";

      if (previousTicketsCount > 0) {
        customerHistorySummary = `Returning customer with ${previousTicketsCount} previous interaction${previousTicketsCount !== 1 ? 's' : ''}. `;
        const lastInteraction = previousTicketsQuery.docs[0].data();
        const lastInteractionDate = lastInteraction.updatedAt?.toDate?.() || new Date(lastInteraction.updatedAt);
        const daysSince = Math.floor((Date.now() - lastInteractionDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSince === 0) {
          customerHistorySummary += "Last interaction was today.";
        } else if (daysSince === 1) {
          customerHistorySummary += "Last interaction was yesterday.";
        } else {
          customerHistorySummary += `Last interaction was ${daysSince} days ago.`;
        }
      }

      const initialTicketData = {
        customerId: from,
        status: "open",
        lastMessage: "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        channel: "whatsapp",
        aiEnabled: assignedTo === 'Admin', // AI enabled only when assigned to admin
        assignedTo: assignedTo,
        assignedEmail: assignedEmail,
        customerHistorySummary: customerHistorySummary || null,
      };

      await ticketRef.set(initialTicketData);

      // Assign ticket to available respondent or admin
      await assignTicketToRespondent(ticketRef, tenantId, company);

      ticketDocData = initialTicketData;

      // Add a system message about customer history if they have previous interactions
      if (customerHistorySummary) {
        const historyMsgRef = ticketRef.collection("messages").doc(`system-history-${Date.now()}`);
        await historyMsgRef.set({
          from: "System",
          role: "system",
          body: `👋 ${customerHistorySummary}\n\n💡 Check the customer history section above for previous conversations and context.`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    // If ticket doc somehow had no data loaded, fetch it
    if (!ticketDocData) {
      const snap = await ticketRef.get();
      ticketDocData = snap.data() || {};
    }

    const aiEnabled = ticketDocData.aiEnabled !== false; // treat missing as true

    // 2️⃣ Save incoming WhatsApp message in ticket's messages collection
    const msgRef = ticketRef.collection("messages").doc(id);
    await msgRef.set({
      from,
      body: message,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // If AI is disabled for this ticket, only store the user message and update updatedAt
    if (!aiEnabled) {
      console.log(
        `🤖 AI is disabled for ticket ${ticketId}; only storing incoming message.`
      );

      await ticketRef.update({
        lastMessage: message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.sendStatus(200);
    }

    // 3️⃣ Load recent ticket message history for AI context
    let history = [];
    try {
      const historySnap = await ticketRef
        .collection("messages")
        .orderBy("createdAt", "asc")
        .limitToLast(20)
        .get();

      history = historySnap.docs.map((d) => d.data());
    } catch (historyErr) {
      console.error(
        "❌ Error loading ticket message history for AI:",
        historyErr
      );
    }

    // 4️⃣ Call AI (Gemini) to generate a reply
    const geminiApiKey = company.geminiApiKey;
    let aiReplyText = `AI reply to "${message}"`;

    if (!geminiApiKey) {
      console.warn(
        `⚠️ Company ${tenantId} has no Gemini API key configured; using fallback AI reply text.`
      );
    } else {
      try {
        const historyText = history
          .map((m) => `${m.from}: ${m.body}`)
          .join("\n");

        // Use company-specific AI prompt template
        let prompt = company.aiPromptTemplate || `You are Axion AI, a friendly, helpful WhatsApp assistant for a company.
You are chatting 1:1 with a real user over WhatsApp.
Always respond naturally, avoid generic replies like "Ok" or "Noted".
Be proactive: acknowledge what they said, add a bit of helpful context, and ask a simple follow-up question if it makes sense.
Keep replies short (1–3 sentences), friendly, and easy to read on a phone.

Here is the recent conversation history (oldest to newest):
{history}

Continue the conversation with your next message.`;

        // Replace placeholders in the prompt
        prompt = prompt
          .replace(/{companyName}/g, company.name || 'our company')
          .replace(/{history}/g, historyText);

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
            "⚠️ Gemini response did not contain text; falling back to default reply."
          );
        }
      } catch (aiErr) {
        console.error(
          "❌ Error calling Gemini API:",
          aiErr.response?.data || aiErr
        );
      }
    }

    // 5️⃣ Update ticket's updatedAt timestamp and lastMessage
    await ticketRef.update({
      lastMessage: message,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `✅ Saved message from ${from} in ticket ${ticketId}: "${message}"`
    );

    // 6️⃣ Add AI reply as the next message (store in Firestore)
    const aiInitials = getUserInitials("Axion AI");
    const attributedAiReply = `${aiReplyText}\n\n<${aiInitials}>`;

    const aiMsgId = `ai-${Date.now()}`;
    const aiMsgRef = ticketRef.collection("messages").doc(aiMsgId);
    await aiMsgRef.set({
      from: "Axion AI",
      body: attributedAiReply,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`🤖 AI reply saved in ticket ${ticketId}`);

    // 7️⃣ Send AI reply back to the user via WhatsApp (Twilio)
    const companyTwilioClient = company.twilioAccountSid && company.twilioAuthToken
      ? twilio(company.twilioAccountSid, company.twilioAuthToken)
      : null;

    if (!companyTwilioClient || !company.twilioPhoneNumber) {
      console.warn(
        `⚠️ Company ${tenantId} Twilio not configured (missing credentials or phone number); not sending WhatsApp reply.`
      );
    } else {
      try {
        const toWhatsApp = from.startsWith("whatsapp:")
          ? from
          : `whatsapp:${from}`;

        const fromWhatsApp = company.twilioPhoneNumber.startsWith("whatsapp:")
          ? company.twilioPhoneNumber
          : `whatsapp:${company.twilioPhoneNumber}`;

        await companyTwilioClient.messages.create({
          from: fromWhatsApp,
          to: toWhatsApp,
          body: attributedAiReply,
        });

        console.log(
          `📤 Sent WhatsApp reply to ${toWhatsApp} via Twilio: "${aiReplyText}"`
        );
      } catch (twilioErr) {
        console.error(
          "❌ Error sending WhatsApp reply via Twilio:",
          twilioErr?.response?.data || twilioErr
        );

        // Handle Twilio rate limiting and other errors by creating a system message
        let systemMessageBody = "";
        let errorCode = "";

        if (twilioErr?.code === 63038) {
          // Daily message limit exceeded
          errorCode = twilioErr.code;
          systemMessageBody = `❌ Failed to send AI reply via WhatsApp: ${twilioErr.message}. Customer may not have received the automated response.`;
        } else if (twilioErr?.status === 429) {
          // Rate limiting
          errorCode = twilioErr.code || "429";
          systemMessageBody = `❌ Failed to send AI reply via WhatsApp: Rate limit exceeded. Customer may not have received the automated response.`;
        } else {
          // Generic Twilio error
          errorCode = twilioErr?.code || "UNKNOWN";
          systemMessageBody = `❌ Failed to send AI reply via WhatsApp. Customer may not have received the automated response.`;
        }

        if (errorCode) {
          systemMessageBody += ` Error Code: ${errorCode}`;
        }

        // Store system message in Firestore to notify about AI reply failure
        try {
          const systemMsgId = `system-ai-twilio-error-${Date.now()}`;
          const systemMsgRef = ticketRef.collection("messages").doc(systemMsgId);
          await systemMsgRef.set({
            from: "System",
            role: "system",
            body: systemMessageBody,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            error: {
              code: errorCode,
              message: twilioErr?.message || "Unknown Twilio error",
              status: twilioErr?.status
            }
          });

          console.log(`⚠️ Stored system error message for AI reply in conversation ${convId}: "${systemMessageBody}"`);
        } catch (systemMsgErr) {
          console.error("❌ Failed to store system error message for AI reply:", systemMsgErr);
        }
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error("❌ Error in webhook:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Debug endpoint to check respondent status
app.get("/debug/respondents/:tenantId", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;

    const respondentsRef = db.collection('companies').doc(tenantId).collection('respondents');
    const activeRespondentsQuery = query(respondentsRef, where('status', '==', 'active'));
    const respondentsSnap = await getDocs(activeRespondentsQuery);

    const respondents = respondentsSnap.docs.map(doc => ({
      id: doc.id,
      email: doc.data().email,
      status: doc.data().status,
      isOnline: doc.data().isOnline,
      lastSeen: doc.data().lastSeen,
      name: doc.data().name
    }));

    res.json({
      tenantId,
      respondentCount: respondents.length,
      respondents: respondents,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error checking respondents:', error);
    res.status(500).json({ error: error.message });
  }
});

// Agent send-message endpoint (used by Inbox UI to let a human reply)
app.post("/agent/send-message", async (req, res) => {
  try {
    const { convId, body, tenantId, userName, userEmail } = req.body || {};

    if (!convId || !body || !tenantId) {
      return res
        .status(400)
        .json({ error: "convId, body, and tenantId are required", received: req.body });
    }

    // Load company configuration
    const companyRef = db.collection("companies").doc(tenantId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      console.warn(`⚠️ Company ${tenantId} not found`);
      return res.status(404).json({ error: "Company not found" });
    }

    const company = companySnap.data();

    const ticketRef = db
      .collection("companies")
      .doc(tenantId)
      .collection("tickets")
      .doc(convId); // convId is actually ticketId in the new system

    const ticketSnap = await ticketRef.get();
    if (!ticketSnap.exists) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const ticketData = ticketSnap.data() || {};
    const to = ticketData.customerId;

    if (!to) {
      return res
        .status(400)
        .json({ error: "Conversation has no participant phone number" });
    }

    // 1️⃣ Store agent message in Firestore with attribution
    const agentName = userName || "Agent";
    const agentInitials = getUserInitials(agentName);
    const attributedBody = `${body}\n\n<${agentInitials}>`;

    const agentMsgId = `agent-${Date.now()}`;
    const agentMsgRef = ticketRef.collection("messages").doc(agentMsgId);
    await agentMsgRef.set({
      from: agentName,
      role: "agent",
      body: attributedBody,
      userEmail,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2️⃣ Update ticket updatedAt and lastMessage
    await ticketRef.update({
      lastMessage: body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 3️⃣ Send WhatsApp message via Twilio
    const companyTwilioClient = company.twilioAccountSid && company.twilioAuthToken
      ? twilio(company.twilioAccountSid, company.twilioAuthToken)
      : null;

    if (!companyTwilioClient || !company.twilioPhoneNumber) {
      console.warn(
        `⚠️ Company ${tenantId} Twilio not configured; stored agent message but did not send WhatsApp message.`
      );
    } else {
      try {
        const toWhatsApp = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

        const fromWhatsApp = company.twilioPhoneNumber.startsWith("whatsapp:")
          ? company.twilioPhoneNumber
          : `whatsapp:${company.twilioPhoneNumber}`;

        await companyTwilioClient.messages.create({
          from: fromWhatsApp,
          to: toWhatsApp,
          body: attributedBody,
        });

        console.log(
          `📤 Sent agent WhatsApp message to ${toWhatsApp}: "${body}"`
        );
      } catch (twilioErr) {
        console.error(
          "❌ Error sending agent WhatsApp message via Twilio:",
          twilioErr?.response?.data || twilioErr
        );

        // Handle Twilio rate limiting and other errors by creating a system message
        let systemMessageBody = "";
        let errorCode = "";

        if (twilioErr?.code === 63038) {
          // Daily message limit exceeded
          errorCode = twilioErr.code;
          systemMessageBody = `❌ Failed to send agent message via WhatsApp: ${twilioErr.message}. Customer may not have received your reply.`;
        } else if (twilioErr?.status === 429) {
          // Rate limiting
          errorCode = twilioErr.code || "429";
          systemMessageBody = `❌ Failed to send agent message via WhatsApp: Rate limit exceeded. Customer may not have received your reply.`;
        } else {
          // Generic Twilio error
          errorCode = twilioErr?.code || "UNKNOWN";
          systemMessageBody = `❌ Failed to send agent message via WhatsApp. Customer may not have received your reply.`;
        }

        if (errorCode) {
          systemMessageBody += ` Error Code: ${errorCode}`;
        }

        // Store system message in Firestore to notify the agent
        try {
          const systemMsgId = `system-twilio-error-${Date.now()}`;
          const systemMsgRef = convRef.collection("messages").doc(systemMsgId);
          await systemMsgRef.set({
            from: "System",
            role: "system",
            body: systemMessageBody,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            error: {
              code: errorCode,
              message: twilioErr?.message || "Unknown Twilio error",
              status: twilioErr?.status
            }
          });

          console.log(`⚠️ Stored system error message in conversation ${convId}: "${systemMessageBody}"`);
        } catch (systemMsgErr) {
          console.error("❌ Failed to store system error message:", systemMsgErr);
        }
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
    const { convId, enable, tenantId } = req.body || {};

    if (!convId || typeof enable !== "boolean" || !tenantId) {
      return res.status(400).json({
        error: "convId, boolean enable, and tenantId are required",
        received: req.body,
      });
    }

    // Load company configuration
    const companyRef = db.collection("companies").doc(tenantId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      console.warn(`⚠️ Company ${tenantId} not found`);
      return res.status(404).json({ error: "Company not found" });
    }

    const company = companySnap.data();

    const ticketRef = db
      .collection("companies")
      .doc(tenantId)
      .collection("tickets")
      .doc(convId); // convId is actually ticketId in the new system

    const ticketSnap = await ticketRef.get();
    if (!ticketSnap.exists) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const ticketData = ticketSnap.data() || {};
    const to = ticketData.customerId;

    // 1️⃣ Update aiEnabled on ticket
    await ticketRef.update({
      aiEnabled: enable,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const statusText = enable
      ? "Axion AI assistant has been turned ON. You may receive automated replies."
      : "Axion AI assistant has been turned OFF. You are now chatting with a human agent.";

    // 2️⃣ Store a system message in Firestore so inbox shows the change
    const systemMsgId = `system-ai-toggle-${Date.now()}`;
    const systemMsgRef = ticketRef.collection("messages").doc(systemMsgId);
    await systemMsgRef.set({
      from: "System",
      role: "system",
      body: statusText,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 3️⃣ Optionally notify user via WhatsApp
    const companyTwilioClient = company.twilioAccountSid && company.twilioAuthToken
      ? twilio(company.twilioAccountSid, company.twilioAuthToken)
      : null;

    if (!companyTwilioClient || !company.twilioPhoneNumber || !to) {
      if (!companyTwilioClient || !company.twilioPhoneNumber) {
        console.warn(
          `⚠️ Company ${tenantId} Twilio not configured; stored AI toggle system message but did not send WhatsApp notification.`
        );
      }
    } else {
      try {
        const toWhatsApp = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

        const fromWhatsApp = company.twilioPhoneNumber.startsWith("whatsapp:")
          ? company.twilioPhoneNumber
          : `whatsapp:${company.twilioPhoneNumber}`;

        await companyTwilioClient.messages.create({
          from: fromWhatsApp,
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
