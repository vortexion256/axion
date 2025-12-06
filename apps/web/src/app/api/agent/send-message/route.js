// Next.js API Route for agent send message
import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import twilio from 'twilio';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // For local development, you can still use the service account file
    // This will be handled by the existing firebase.js configuration
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_KEY not found, using default credentials');
  }
}

const db = admin.firestore();

// Helper function to get user initials
function getUserInitials(name) {
  if (!name) return 'U';
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .join('')
    .substring(0, 2);
}

export async function POST(request) {
  try {
    const { convId, body, tenantId, userName, userEmail } = await request.json();

    if (!convId || !body || !tenantId) {
      return NextResponse.json({ error: "convId, body, and tenantId are required" }, { status: 400 });
    }

    // Load company configuration
    const companyRef = db.collection("companies").doc(tenantId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      console.warn(`⚠️ Company ${tenantId} not found`);
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const company = companySnap.data();

    const ticketRef = db
      .collection("companies")
      .doc(tenantId)
      .collection("tickets")
      .doc(convId); // convId is actually ticketId in the new system

    const ticketSnap = await ticketRef.get();
    if (!ticketSnap.exists) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const ticketData = ticketSnap.data() || {};
    const to = ticketData.customerId;

    if (!to) {
      return NextResponse.json({ error: "Conversation has no participant phone number" }, { status: 400 });
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

        // Check if AI was recently responding (there are recent AI messages)
        const aiWaitMinutes = company.aiWaitMinutes || 5;
        const recentAIMessages = allMessages.filter(msg =>
          msg.role === 'ai' &&
          msg.createdAt &&
          (msg.createdAt.toDate ? msg.createdAt.toDate() : new Date(msg.createdAt)) > new Date(Date.now() - aiWaitMinutes * 60 * 1000)
        );

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
        // 2. AI was recently responding and now human is taking over
        const isFirstHumanMessage = !hasPreviousAgentMessages && recentJoinNotifications.length === 0;
        const isHumanTakingOverFromAI = recentAIMessages.length > 0 && recentJoinNotifications.length === 0;

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

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('❌ Error sending agent message:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
