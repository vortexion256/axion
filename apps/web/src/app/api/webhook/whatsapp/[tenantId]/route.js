// Next.js API Route for WhatsApp webhook
import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import twilio from 'twilio';
import axios from 'axios';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } catch (error) {
      console.error('❌ Error parsing FIREBASE_SERVICE_ACCOUNT_KEY:', error.message);
      // During build/static generation, don't fail - environment variables will be set at runtime
      console.warn('⚠️ Firebase Admin initialization failed during build - will retry at runtime');
    }
  } else {
    // During build/static generation, don't fail - environment variables will be set at runtime in Vercel
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_KEY not set during build - will be initialized at runtime in Vercel');
  }
}

// Helper function to get user initials
function getUserInitials(name) {
  if (!name) return 'U';
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .join('')
    .substring(0, 2);
}

// Note: Periodic cleanup removed for Vercel deployment
// In serverless environments, use scheduled functions or external cron jobs

export async function GET(request, { params }) {
  console.log("🔍 GET request to webhook - likely a health check or browser access");
  console.log("📍 Tenant ID:", params.tenantId);

  return NextResponse.json({
    status: "webhook endpoint active",
    tenantId: params.tenantId,
    message: "This endpoint accepts POST requests from Twilio WhatsApp webhooks"
  });
}

export async function POST(request, { params }) {
  try {
    // Ensure Firebase Admin is initialized
    if (!admin.apps.length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        try {
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
        } catch (error) {
          console.error('❌ Error initializing Firebase Admin at runtime:', error.message);
          return NextResponse.json({ error: 'Firebase configuration error' }, { status: 500 });
        }
      } else {
        console.error('❌ FIREBASE_SERVICE_ACCOUNT_KEY not available at runtime');
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
      }
    }

    const db = admin.firestore();
    const tenantId = params.tenantId;
    console.log("🔔 Incoming /webhook/whatsapp request for tenant:", tenantId);

    if (!tenantId) {
      console.error("❌ No tenantId provided in URL");
      return NextResponse.json({ error: "Tenant ID is required" }, { status: 400 });
    }

    // Handle both JSON (for testing) and x-www-form-urlencoded (for Twilio)
    let body;
    const contentType = request.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      // JSON request (for testing)
      body = await request.json();
    } else {
      // Form data request (Twilio)
      const formData = await request.formData();
      body = Object.fromEntries(formData);
    }

    console.log("Request body:", body);

    const message = body.message || body.Body;
    const from = body.from || body.From;
    const id = body.id || body.MessageSid || body.SmsMessageSid;

    if (!message || !from) {
      return NextResponse.json({ error: "Message and sender are required" }, { status: 400 });
    }

    // Load company configuration
    const companyRef = db.collection("companies").doc(tenantId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      console.warn(`⚠️ Company ${tenantId} not found`);
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const company = companySnap.data();

    // 1️⃣ Check if customer exists, create if not
    const customerId = from.replace("whatsapp:", "");
    let ticketId = null;
    let ticketDocData = null;

    // Find existing open ticket for this customer
    const existingTicketsSnap = await companyRef.collection('tickets')
      .where('customerId', '==', customerId)
      .where('status', 'in', ['open', 'pending'])
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (!existingTicketsSnap.empty) {
      // Use existing ticket
      const existingTicketDoc = existingTicketsSnap.docs[0];
      ticketId = existingTicketDoc.id;
      ticketDocData = existingTicketDoc.data();
      console.log(`📋 Using existing ticket ${ticketId} for customer ${customerId}`);
    } else {
      // Create new ticket
      ticketId = `ticket-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Get customer history summary
      const customerHistorySnap = await companyRef.collection('tickets')
        .where('customerId', '==', customerId)
        .where('status', '==', 'closed')
        .orderBy('createdAt', 'desc')
        .limit(3)
        .get();

      let customerHistorySummary = null;
      if (!customerHistorySnap.empty) {
        const closedTickets = customerHistorySnap.docs.map(doc => doc.data());
        customerHistorySummary = `Returning customer with ${closedTickets.length} previous ${closedTickets.length === 1 ? 'conversation' : 'conversations'}`;
      }

      const initialTicketData = {
        customerId,
        status: "open",
        aiEnabled: true, // Always enable AI toggle, but check real-time status for responses
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        channel: "whatsapp",
        customerHistorySummary: customerHistorySummary || null,
      };

      await companyRef.collection('tickets').doc(ticketId).set(initialTicketData);

      // Assign ticket to available respondent or admin
      const respondentsRef = companyRef.collection('respondents');
      const respondentsSnap = await respondentsRef.get();
      const respondents = respondentsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Find online respondents
      const onlineRespondents = respondents.filter(r => r.isOnline === true);

      // Find recently online respondents (last seen within 5 minutes)
      const recentlyOnlineRespondents = respondents.filter(r => {
        if (!r.lastSeen) return false;
        const lastSeen = r.lastSeen.toDate ? r.lastSeen.toDate() : new Date(r.lastSeen);
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        return lastSeen > fiveMinutesAgo;
      });

      let assignedTo = 'Admin';
      let assignedEmail = null;

      if (onlineRespondents.length > 0) {
        // Assign to online respondent using round-robin
        const assignedRespondent = onlineRespondents[0]; // Simple assignment for now
        assignedTo = assignedRespondent.name || assignedRespondent.email;
        assignedEmail = assignedRespondent.email;
        console.log(`👥 Assigned to online respondent: ${assignedTo} (${assignedEmail})`);
      } else if (recentlyOnlineRespondents.length > 0) {
        // Assign to recently online respondent
        const assignedRespondent = recentlyOnlineRespondents[0];
        assignedTo = assignedRespondent.name || assignedRespondent.email;
        assignedEmail = assignedRespondent.email;
        console.log(`👥 Assigned to recently online respondent: ${assignedTo} (${assignedEmail})`);
      } else if (company.adminOnline === true) {
        // Assign to Admin if online
        assignedTo = 'Admin';
        assignedEmail = null;
        console.log(`👨‍💼 Assigned to online Admin`);
      } else {
        // Assign to any available respondent (even offline)
        if (respondents.length > 0) {
          const assignedRespondent = respondents[0];
          assignedTo = assignedRespondent.name || assignedRespondent.email;
          assignedEmail = assignedRespondent.email;
          console.log(`👥 Assigned to offline respondent: ${assignedTo} (${assignedEmail})`);
        } else {
          // Fallback to Admin
          assignedTo = 'Admin';
          assignedEmail = null;
          console.log(`👨‍💼 Assigned to Admin (no respondents available)`);
        }
      }

      // Update ticket with assignment information
      const finalTicketData = {
        ...initialTicketData,
        aiEnabled: true, // Always enable AI toggle, but check real-time status for responses
        assignedTo,
        assignedEmail,
      };

      await companyRef.collection('tickets').doc(ticketId).update(finalTicketData);
      ticketDocData = finalTicketData;

      // Add a system message about customer history if they have previous interactions
      if (customerHistorySummary) {
        const historyMsgRef = companyRef.collection('tickets').doc(ticketId).collection("messages").doc(`system-history-${Date.now()}`);
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
      const snap = await companyRef.collection('tickets').doc(ticketId).get();
      ticketDocData = snap.data() || {};
    }

    const aiEnabled = ticketDocData.aiEnabled !== false; // treat missing as true

    // 2️⃣ Save incoming WhatsApp message in ticket's messages collection
    const msgRef = companyRef.collection('tickets').doc(ticketId).collection("messages").doc(id);
    await msgRef.set({
      from,
      body: message,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Check if assigned respondent is currently online or recently active - control AI accordingly
    let aiShouldRespond = aiEnabled;
    console.log(`🎫 Ticket ${ticketId} assignment: ${ticketDocData.assignedTo} (${ticketDocData.assignedEmail})`);
    console.log(`🤖 AI enabled in ticket: ${aiEnabled}`);

    if (ticketDocData.assignedEmail && ticketDocData.assignedTo !== 'Admin') {
      // Check if the assigned respondent is currently online
      const respondentsRef = companyRef.collection('respondents');
      const respondentQuery = await respondentsRef.where('email', '==', ticketDocData.assignedEmail).get();

      console.log(`🔍 Checking respondent ${ticketDocData.assignedEmail} status...`);

      if (!respondentQuery.empty) {
        const respondentData = respondentQuery.docs[0].data();
        let isCurrentlyOnline = respondentData.isOnline === true;

        // Check localStorage flags for browser close detection (more aggressive)
        // If respondent was marked as inactive in localStorage, consider them offline
        const localStorageCheck = request.headers.get('x-respondent-active') === 'false';
        if (localStorageCheck) {
          console.log(`🚫 Browser close detected for ${ticketDocData.assignedEmail}, marking offline`);
          isCurrentlyOnline = false;
          // Update database to reflect offline status
          await respondentQuery.docs[0].ref.update({
            isOnline: false,
            lastSeen: new Date(),
          });
        }

        // Auto-mark as offline if last seen > 10 minutes ago (server-side safety check)
        if (isCurrentlyOnline && respondentData.lastSeen) {
          const lastSeen = respondentData.lastSeen.toDate ? respondentData.lastSeen.toDate() : new Date(respondentData.lastSeen);
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

          if (lastSeen < tenMinutesAgo) {
            console.log(`🚫 Auto-marking ${ticketDocData.assignedEmail} as offline (last seen ${Math.floor((Date.now() - lastSeen.getTime()) / (1000 * 60))} minutes ago)`);
            // Update the respondent as offline in database
            await respondentQuery.docs[0].ref.update({
              isOnline: false,
              lastSeen: respondentData.lastSeen // Keep original lastSeen for reference
            });
            isCurrentlyOnline = false;
          }
        }

        // Check if respondent was active within configured wait time (from admin settings)
        const waitMinutes = company.aiWaitMinutes || 5; // Use admin setting, default to 5 minutes
        let wasRecentlyActive = false;
        let timeSinceLastSeen = null;
        if (respondentData.lastSeen) {
          const lastSeen = respondentData.lastSeen.toDate ? respondentData.lastSeen.toDate() : new Date(respondentData.lastSeen);
          const waitTimeAgo = new Date(Date.now() - waitMinutes * 60 * 1000);
          wasRecentlyActive = lastSeen > waitTimeAgo;
          timeSinceLastSeen = Math.floor((Date.now() - lastSeen.getTime()) / (1000 * 60)); // minutes ago
          console.log(`📅 Last seen: ${lastSeen.toISOString()}, ${timeSinceLastSeen} minutes ago (${waitMinutes}min wait time)`);

          // If respondent is marked as online but hasn't been active recently, auto-mark offline
          if (isCurrentlyOnline && !wasRecentlyActive) {
            console.log(`🚫 Auto-correcting stale online status for ${ticketDocData.assignedEmail}`);
            await respondentQuery.docs[0].ref.update({
              isOnline: false,
              lastSeen: respondentData.lastSeen, // Keep original timestamp
            });
            isCurrentlyOnline = false;
          }
        }

        // Consider respondent "effectively offline" if:
        // 1. isOnline is explicitly false, OR
        // 2. isOnline is true but they haven't been active in 5+ minutes (stuck online status)
        const isEffectivelyOffline = !isCurrentlyOnline || (isCurrentlyOnline && !wasRecentlyActive);

        console.log(`📊 Respondent status analysis:`);
        console.log(`   - Database isOnline: ${isCurrentlyOnline}`);
        console.log(`   - Recently active (5min): ${wasRecentlyActive}`);
        console.log(`   - Effectively offline: ${isEffectivelyOffline}`);

        // AI responds if respondent is effectively offline
        aiShouldRespond = isEffectivelyOffline;

        console.log(`👤 Assigned respondent ${ticketDocData.assignedTo}:`);
        console.log(`   - Currently online: ${isCurrentlyOnline}`);
        console.log(`   - Recently active (5min): ${wasRecentlyActive}`);
        console.log(`   - Respondent data:`, {
          isOnline: respondentData.isOnline,
          lastSeen: respondentData.lastSeen,
          email: respondentData.email
        });
        console.log(`🤖 AI ${aiShouldRespond ? 'will respond' : 'will NOT respond'}`);
      } else {
        console.log(`❌ Respondent ${ticketDocData.assignedEmail} not found in database!`);
        aiShouldRespond = true; // Fallback to AI if respondent not found
      }
    } else {
      console.log(`👨‍💼 Ticket assigned to Admin or no email - checking AI enabled setting: ${aiEnabled}`);
      aiShouldRespond = aiEnabled; // Respect AI enabled setting even for Admin tickets
    }

    // If AI should not respond (assigned respondent is online), only store the user message
    if (!aiShouldRespond) {
      console.log(
        `🤖 AI disabled - assigned respondent is online or recently active for ticket ${ticketId}; only storing incoming message.`
      );

      await companyRef.collection('tickets').doc(ticketId).update({
        lastMessage: message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Return empty TwiML response to prevent any automatic messages
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { 'Content-Type': 'text/xml' }
      });
    }

    // AI will respond - check if we need to notify about AI takeover
    if (aiShouldRespond && company.notifyAiTakeover !== false) {
      // Get all messages to check for human activity
      const allMessagesSnap = await companyRef.collection('tickets').doc(ticketId).collection('messages')
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();

      const allMessages = allMessagesSnap.docs.map(doc => doc.data());
      const aiWaitMinutes = company.aiWaitMinutes || 5; // Use configured wait time

      // Check if there were any human (agent) messages
      const humanMessages = allMessages.filter(msg => msg.role === 'agent');

      // Check if ticket was assigned to a human (not Admin) - indicates human was involved
      const wasAssignedToHuman = ticketDocData.assignedEmail && ticketDocData.assignedTo !== 'Admin';

      // Determine if we should send notification
      let shouldSendNotification = false;
      let notificationReason = '';

      if (humanMessages.length > 0) {
        // Get the most recent human message
        const lastHumanMessage = humanMessages.sort((a, b) => {
          const timeA = a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
          const timeB = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
          return timeB - timeA;
        })[0];

        const lastHumanTime = lastHumanMessage.createdAt.toDate ? lastHumanMessage.createdAt.toDate() : new Date(lastHumanMessage.createdAt);
        const timeSinceLastHuman = Date.now() - lastHumanTime.getTime();

        // Check if human hasn't responded recently (they're inactive)
        const hasRecentHumanResponse = timeSinceLastHuman < aiWaitMinutes * 60 * 1000;

        // Only notify if human was active before but is now inactive
        if (!hasRecentHumanResponse) {
          // Find the most recent AI takeover notification
          const aiTakeoverNotifications = allMessages.filter(msg =>
            msg.role === 'system' &&
            msg.body &&
            msg.body.includes('AI agent will respond')
          );

          if (aiTakeoverNotifications.length === 0) {
            // No previous AI takeover notification - this is the first time AI is taking over
            shouldSendNotification = true;
            notificationReason = `first AI takeover after human was active (${Math.floor(timeSinceLastHuman / (1000 * 60))} minutes ago)`;
          } else {
            // Get the most recent AI takeover notification
            const lastTakeoverNotification = aiTakeoverNotifications.sort((a, b) => {
              const timeA = a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
              const timeB = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
              return timeB - timeA;
            })[0];

            const lastTakeoverTime = lastTakeoverNotification.createdAt.toDate ? lastTakeoverNotification.createdAt.toDate() : new Date(lastTakeoverNotification.createdAt);

            // Check if there was a human message AFTER the last AI takeover notification
            // If yes, human came back and went inactive again - send notification
            const humanMessagesAfterTakeover = humanMessages.filter(msg => {
              const msgTime = msg.createdAt.toDate ? msg.createdAt.toDate() : new Date(msg.createdAt);
              return msgTime > lastTakeoverTime;
            });

            if (humanMessagesAfterTakeover.length > 0) {
              shouldSendNotification = true;
              notificationReason = `human came back and went inactive again (${Math.floor(timeSinceLastHuman / (1000 * 60))} minutes ago)`;
            }
          }
        }
      } else if (wasAssignedToHuman) {
        // No human messages yet, but ticket was assigned to a human who is now offline
        // This means AI is taking over from the start because human is offline
        const aiTakeoverNotifications = allMessages.filter(msg =>
          msg.role === 'system' &&
          msg.body &&
          msg.body.includes('AI agent will respond')
        );

        // Only send if we haven't sent one before
        if (aiTakeoverNotifications.length === 0) {
          shouldSendNotification = true;
          notificationReason = `AI taking over - human assigned but offline`;
        }
      }

      if (shouldSendNotification) {
        // Add system message that AI is taking over
        const aiTakeoverMsgRef = companyRef.collection('tickets').doc(ticketId).collection('messages').doc(`system-ai-takeover-${Date.now()}`);
        await aiTakeoverMsgRef.set({
          from: "System",
          role: "system",
          body: `🤖 Human inactive, AI agent will respond.`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`🤖 Added AI takeover notification for ticket ${ticketId} - ${notificationReason}`);

        // Send WhatsApp notification to customer about AI takeover
        try {
          if (company.notifyAiTakeover !== false && company.twilioAccountSid && company.twilioAuthToken && company.twilioPhoneNumber) {
            const twilioClient = twilio(company.twilioAccountSid, company.twilioAuthToken);
            const takeoverMessage = `🤖 Human inactive, AI agent will respond.`;

            const toWhatsApp = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
            const fromWhatsApp = company.twilioPhoneNumber.startsWith("whatsapp:")
              ? company.twilioPhoneNumber
              : `whatsapp:${company.twilioPhoneNumber}`;

            await twilioClient.messages.create({
              from: fromWhatsApp,
              to: toWhatsApp,
              body: takeoverMessage,
            });

            console.log(`📤 Sent AI takeover notification to ${toWhatsApp}`);
          }
        } catch (twilioError) {
          console.error('❌ Error sending AI takeover WhatsApp notification:', twilioError);
        }
      } else {
        console.log(`🤖 Skipping AI takeover notification for ticket ${ticketId} - conditions not met`);
      }
    }

    // 3️⃣ Load recent ticket message history for AI context
    let history = [];
    try {
      const historySnap = await companyRef.collection('tickets').doc(ticketId)
        .collection("messages")
        .orderBy("createdAt", "asc")
        .limitToLast(20)
        .get();

      // Filter out system messages from AI history to prevent confusion
      history = historySnap.docs
        .map((d) => d.data())
        .filter((m) => m.role !== 'system');
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
You are an AI assistant, NOT a human agent. Never claim to be a human agent.
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
          aiErr
        );
      }
    }

    // 5️⃣ Store AI reply as the next message (store in Firestore)
    const aiInitials = getUserInitials("Axion AI");
    const showInitials = company.showUserInitials !== false; // Default true
    const attributedAiReply = showInitials ? `${aiReplyText}\n\n<${aiInitials}>` : aiReplyText;

    const aiMsgId = `ai-${Date.now()}`;
    const aiMsgRef = companyRef.collection('tickets').doc(ticketId).collection("messages").doc(aiMsgId);
    await aiMsgRef.set({
      from: "Axion AI",
      role: "ai",
      body: attributedAiReply,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`🤖 AI reply saved in ticket ${ticketId}`);

    // 6️⃣ Send AI reply back to the user via WhatsApp (Twilio)
    const companyTwilioClient = company.twilioAccountSid && company.twilioAuthToken
      ? twilio(company.twilioAccountSid, company.twilioAuthToken)
      : null;

    if (!companyTwilioClient || !company.twilioPhoneNumber) {
      console.warn(
        `⚠️ Company ${tenantId} Twilio not configured; stored AI message but did not send WhatsApp message.`
      );
    } else {
      try {
        const toWhatsApp = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

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
          const systemMsgRef = companyRef.collection('tickets').doc(ticketId).collection("messages").doc(systemMsgId);

          // Build error object with only defined values
          const errorData = {
            code: errorCode || "UNKNOWN",
            message: twilioErr?.message || "Unknown Twilio error"
          };

          // Only add status if it's defined
          if (twilioErr?.status !== undefined) {
            errorData.status = twilioErr.status;
          }

          await systemMsgRef.set({
            from: "System",
            role: "system",
            body: systemMessageBody,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            error: errorData
          });

          console.log(`⚠️ Stored system error message for AI reply in conversation ${ticketId}: "${systemMessageBody}"`);
        } catch (systemMsgErr) {
          console.error("❌ Failed to store system error message for AI reply:", systemMsgErr);
        }
      }
    }

    // Update ticket with AI reply
    await companyRef.collection('tickets').doc(ticketId).update({
      lastMessage: aiReplyText,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    });

  } catch (err) {
    console.error("❌ Error in webhook:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
