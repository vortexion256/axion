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

// Periodic cleanup for stale respondent statuses
setInterval(async () => {
  try {
    console.log('🧹 Running periodic respondent status cleanup...');

    // Get all companies
    const companiesSnap = await db.collection('companies').get();

    for (const companyDoc of companiesSnap.docs) {
      const companyId = companyDoc.id;
      const respondentsRef = companyDoc.ref.collection('respondents');

      // Get all respondents who are marked as online
      const onlineRespondentsSnap = await respondentsRef.where('isOnline', '==', true).get();

      for (const respondentDoc of onlineRespondentsSnap.docs) {
        const respondentData = respondentDoc.data();

        if (respondentData.lastSeen) {
          const lastSeen = respondentData.lastSeen.toDate ? respondentData.lastSeen.toDate() : new Date(respondentData.lastSeen);
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

          if (lastSeen < tenMinutesAgo) {
            console.log(`🚫 Periodic cleanup: Marking ${respondentData.email} offline (last seen ${Math.floor((Date.now() - lastSeen.getTime()) / (1000 * 60))} minutes ago)`);

            await respondentDoc.ref.update({
              isOnline: false,
              lastSeen: respondentData.lastSeen, // Keep original timestamp
            });
          }
        }
      }
    }

    console.log('✅ Periodic cleanup completed');
  } catch (error) {
    console.error('❌ Error in periodic cleanup:', error);
  }
}, 5 * 60 * 1000); // Run every 5 minutes

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

// Helper function to check if a respondent is online
function isRespondentOnline(email, respondents) {
  if (!respondents || !Array.isArray(respondents)) return false;
  const respondent = respondents.find(r => r.email === email);
  return respondent ? respondent.isOnline === true : false;
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
          // Priority 2: Round-robin assignment among offline respondents (with AI enabled)
          const lastAssignedIndex = company.lastAssignedAnyIndex || 0;
          const nextIndex = lastAssignedIndex % respondents.length;
          assignedRespondent = respondents[nextIndex];

          console.log(`⚖️ Round-robin: ${nextIndex + 1}/${respondents.length} available respondents`);
          console.log(`⚖️ Assigned to offline respondent: ${assignedRespondent.name || assignedRespondent.email} (${assignedRespondent.email})`);
          console.log(`🤖 AI will be enabled for offline respondent assignment`);

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

    // Determine if assigned to offline respondent (for AI enablement)
    // We know it was assigned to offline respondent if we reached this point and assignedTo is not 'Admin'
    const assignedToOfflineRespondent = assignedTo !== 'Admin' && assignedEmail;

    return { assignedTo, assignedEmail, assignedToOfflineRespondent };
  } catch (error) {
    console.error('Error assigning ticket:', error);
    // Fallback: assign to admin
    await ticketRef.update({
      assignedTo: 'Admin',
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      aiEnabled: true, // Enable AI toggle for fallback admin assignment
    });
    return { assignedTo: 'Admin', assignedEmail: null, assignedToOfflineRespondent: false };
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

      // Create initial ticket data (will be updated after assignment)
      const initialTicketData = {
        customerId: from,
        status: "open",
        lastMessage: "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        channel: "whatsapp",
        customerHistorySummary: customerHistorySummary || null,
      };

      await ticketRef.set(initialTicketData);

      // Assign ticket to available respondent or admin
      const assignmentResult = await assignTicketToRespondent(ticketRef, tenantId, company);

      // Update ticket with assignment information
      // AI is always enabled initially for toggle functionality, but real-time status determines responses
      const finalTicketData = {
        ...initialTicketData,
        aiEnabled: true, // Always enable AI toggle, but check real-time status for responses
        assignedTo: assignmentResult.assignedTo,
        assignedEmail: assignmentResult.assignedEmail,
      };

      await ticketRef.update(finalTicketData);
      ticketDocData = finalTicketData;

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

    // Check if assigned respondent is currently online or recently active - control AI accordingly
    let aiShouldRespond = aiEnabled;
    console.log(`🎫 Ticket ${ticketId} assignment: ${ticketDocData.assignedTo} (${ticketDocData.assignedEmail})`);
    console.log(`🤖 AI enabled in ticket: ${aiEnabled}`);

    if (ticketDocData.assignedEmail && ticketDocData.assignedTo !== 'Admin') {
      // Check if the assigned respondent is currently online
      const respondentsRef = db.collection('companies').doc(tenantId).collection('respondents');
      const respondentQuery = await respondentsRef.where('email', '==', ticketDocData.assignedEmail).get();

      console.log(`🔍 Checking respondent ${ticketDocData.assignedEmail} status...`);

      if (!respondentQuery.empty) {
        const respondentData = respondentQuery.docs[0].data();
        let isCurrentlyOnline = respondentData.isOnline === true;

        // Check localStorage flags for browser close detection (more aggressive)
        // If respondent was marked as inactive in localStorage, consider them offline
        const localStorageCheck = req.headers['x-respondent-active'] === 'false' ||
                                 req.body.respondentActive === false;

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

      await ticketRef.update({
        lastMessage: message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Return empty TwiML response to prevent any automatic messages
      res.set('Content-Type', 'text/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    // AI will respond - check if we need to notify about AI takeover
    if (aiShouldRespond && company.notifyAiTakeover !== false) {
      // Get all messages to check for human activity (exclude the message we just stored)
      const allMessagesSnap = await ticketRef.collection('messages')
        .orderBy('createdAt', 'desc')
        .limit(30)
        .get();

      const allMessages = allMessagesSnap.docs
        .map(doc => doc.data())
        .filter(msg => msg.createdAt); // Filter out any messages without timestamps
      
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
        const aiTakeoverMsgRef = ticketRef.collection('messages').doc(`system-ai-takeover-${Date.now()}`);
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
      const historySnap = await ticketRef
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
    const showInitials = company.showUserInitials !== false; // Default true
    const attributedAiReply = showInitials ? `${aiReplyText}\n\n<${aiInitials}>` : aiReplyText;

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

          console.log(`⚠️ Stored system error message for AI reply in ticket ${ticketId}: "${systemMessageBody}"`);
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
    console.log(`📨 Agent send-message request:`, req.body);
    const { convId, body, tenantId, userName, userEmail } = req.body || {};

    if (!convId || !body || !tenantId) {
      return res
        .status(400)
        .json({ error: "convId, body, and tenantId are required", received: req.body });
    }

    // Validate convId format
    if (!convId.startsWith('ticket-')) {
      console.error(`❌ Invalid ticket ID format: ${convId}`);
      return res.status(400).json({ error: "Invalid ticket ID format" });
    }

    // Load company configuration
    const companyRef = db.collection("companies").doc(tenantId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      console.warn(`⚠️ Company ${tenantId} not found`);
      return res.status(404).json({ error: "Company not found" });
    }

    const company = companySnap.data();

    console.log(`🔍 Looking for ticket: companies/${tenantId}/tickets/${convId}`);
    const ticketRef = db
      .collection("companies")
      .doc(tenantId)
      .collection("tickets")
      .doc(convId); // convId is actually ticketId in the new system

    const ticketSnap = await ticketRef.get();
    if (!ticketSnap.exists) {
      console.error(`❌ Ticket not found: ${convId} in company ${tenantId}`);
      console.error(`❌ Ticket ref path: companies/${tenantId}/tickets/${convId}`);
      console.error(`❌ Available tickets in company (first 5):`, await db.collection("companies").doc(tenantId).collection("tickets").limit(5).get().then(snap => snap.docs.map(d => d.id)));
      return res.status(404).json({
        error: "Ticket not found",
        ticketId: convId,
        companyId: tenantId,
        message: `No ticket found with ID '${convId}' in company '${tenantId}'`
      });
    }
    console.log(`✅ Found ticket: ${convId}`);

    const ticketData = ticketSnap.data() || {};
    const to = ticketData.customerId;

    if (!to) {
      return res
        .status(400)
        .json({ error: "Conversation has no participant phone number" });
    }

    // Check if this is the first human message (before storing it)
    const shouldTurnOffAI = ticketData.assignedEmail === userEmail && ticketData.aiEnabled;
    let shouldNotifyAgentJoin = false;

    // Check if there are any previous agent messages to determine if this is the first human message
    if (company.notifyAgentJoin !== false) {
      try {
        // Get all messages to check for previous agent messages
        const allMessagesSnap = await ticketRef.collection('messages')
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();

        const allMessages = allMessagesSnap.docs.map(doc => doc.data());
        const hasPreviousAgentMessages = allMessages.some(msg => msg.role === 'agent');

        // Check if AI was the most recent responder (excluding system messages)
        const nonSystemMessages = allMessages.filter(msg => msg.role !== 'system');
        const lastNonSystemMessage = nonSystemMessages.length > 0 ? nonSystemMessages[0] : null; // Already sorted by createdAt desc
        const wasLastResponseFromAI = lastNonSystemMessage && lastNonSystemMessage.role === 'ai';

        // Check if we've already sent an agent join notification recently
        const recentJoinNotifications = allMessages.filter(msg =>
          msg.role === 'system' &&
          msg.body &&
          msg.body.includes('Human agent joined') &&
          msg.createdAt &&
          (msg.createdAt.toDate ? msg.createdAt.toDate() : new Date(msg.createdAt)) > new Date(Date.now() - 5 * 60 * 1000)
        );

        // Send notification if:
        // 1. This is the first human message ever (no previous agent messages), OR
        // 2. AI was the last responder and now human is taking over
        const isFirstHumanMessage = !hasPreviousAgentMessages && recentJoinNotifications.length === 0;
        const isHumanTakingOverFromAI = wasLastResponseFromAI && recentJoinNotifications.length === 0;

        shouldNotifyAgentJoin = isFirstHumanMessage || isHumanTakingOverFromAI;
      } catch (error) {
        console.error('❌ Error checking for previous agent messages:', error);
        // If query fails, assume it's the first message to be safe
        shouldNotifyAgentJoin = true;
      }
    }

    // Send agent join notification BEFORE storing the agent message
    if (shouldNotifyAgentJoin) {
      // Add system message about agent joining
      const agentJoinMsgRef = ticketRef.collection('messages').doc(`system-agent-joined-${Date.now()}`);
      await agentJoinMsgRef.set({
        from: "System",
        role: "system",
        body: `👋 Human agent joined the chat.`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`👋 Added agent join notification for ticket ${convId} - ${userName || "Agent"} joined`);

      // Send WhatsApp notification to customer about agent joining
      try {
        if (company.notifyAgentJoin !== false && company.twilioAccountSid && company.twilioAuthToken && company.twilioPhoneNumber) {
          const twilioClient = twilio(company.twilioAccountSid, company.twilioAuthToken);
          const joinMessage = `👋 Human agent joined the chat.`;

          const toWhatsApp = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
          const fromWhatsApp = company.twilioPhoneNumber.startsWith("whatsapp:")
            ? company.twilioPhoneNumber
            : `whatsapp:${company.twilioPhoneNumber}`;

          await twilioClient.messages.create({
            from: fromWhatsApp,
            to: toWhatsApp,
            body: joinMessage,
          });

          console.log(`📤 Sent agent join WhatsApp notification to ${toWhatsApp}`);
        }
      } catch (error) {
        console.error('❌ Error sending agent join WhatsApp notification:', error);
      }
    }

    // 1️⃣ Store agent message in Firestore with attribution
    const agentName = userName || "Agent";
    const agentInitials = getUserInitials(agentName);
    const showInitials = company.showUserInitials !== false; // Default true
    const attributedBody = showInitials ? `${body}\n\n<${agentInitials}>` : body;

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
    // Also turn off AI when respondent sends a message (they're actively handling)
    await ticketRef.update({
      lastMessage: body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(shouldTurnOffAI && { aiEnabled: false }), // Turn off AI when respondent actively responds
    });

    if (shouldTurnOffAI) {
      console.log(`🤖 AI turned OFF for ticket ${convId} - respondent ${agentName} is actively responding`);
    }

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
          const systemMsgRef = ticketRef.collection("messages").doc(systemMsgId);
          
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

// Agent join notification endpoint
app.post("/api/notifications/agent-join", async (req, res) => {
  try {
    const { companyId, customerId, agentName, ticketId } = req.body;

    if (!companyId || !customerId || !agentName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`📢 Agent join notification: ${agentName} joining conversation with ${customerId}`);

    // Get company settings
    const companyRef = db.collection('companies').doc(companyId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const company = companySnap.data();

    // Send WhatsApp notification if enabled and configured
    if (company.notifyAgentJoin !== false && company.twilioAccountSid && company.twilioAuthToken && company.twilioPhoneNumber) {
      const twilioClient = twilio(company.twilioAccountSid, company.twilioAuthToken);

      const notificationMessage = `👋 Hi! ${agentName} has joined our conversation. You can now chat directly with our human agent.`;

      const toWhatsApp = customerId.startsWith("whatsapp:") ? customerId : `whatsapp:${customerId}`;
      const fromWhatsApp = company.twilioPhoneNumber.startsWith("whatsapp:")
        ? company.twilioPhoneNumber
        : `whatsapp:${company.twilioPhoneNumber}`;

      await twilioClient.messages.create({
        from: fromWhatsApp,
        to: toWhatsApp,
        body: notificationMessage,
      });

      console.log(`📤 Sent agent join WhatsApp notification to ${toWhatsApp}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error sending agent join notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Respondent status update endpoint (for sendBeacon reliability)
app.post("/api/respondent/status", async (req, res) => {
  try {
    console.log('📡 sendBeacon endpoint called with body:', req.body);
    const { email, companyId, action } = req.body;

    if (!email || !companyId) {
      console.log('❌ Missing required fields in sendBeacon request');
      return res.status(400).send('Missing required fields');
    }

    console.log(`📡 Respondent status update via sendBeacon: ${email} -> ${action}`);

    const companyRef = db.collection('companies').doc(companyId);
    const respondentsRef = companyRef.collection('respondents');
    const respondentQuery = await respondentsRef.where('email', '==', email).get();

    if (!respondentQuery.empty) {
      const respondentDoc = respondentQuery.docs[0];
      const isOnline = action === 'online';

      await respondentDoc.ref.update({
        isOnline: isOnline,
        lastSeen: isOnline ? new Date() : respondentDoc.data().lastSeen, // Don't update lastSeen when going offline
      });

      console.log(`✅ Respondent ${email} status updated to ${isOnline ? 'online' : 'offline'} via sendBeacon`);
    } else {
      console.log(`❌ Respondent ${email} not found in database`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error updating respondent status via sendBeacon:', error);
    res.status(500).send('Internal server error');
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
