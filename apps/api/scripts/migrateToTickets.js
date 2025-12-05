// migrateToTickets.js
const admin = require("firebase-admin");
const serviceAccount = require("../axion256system-firebase-adminsdk-fbsvc-bbb9336fa7.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function migrateToTickets() {
  try {
    console.log("🚀 Starting migration from conversations to tickets...");

    // Get all companies
    const companiesRef = db.collection("companies");
    const companiesSnap = await companiesRef.get();

    for (const companyDoc of companiesSnap.docs) {
      const tenantId = companyDoc.id;
      console.log(`📍 Processing company: ${tenantId}`);

      // Get all conversations for this company
      const conversationsRef = companyDoc.ref.collection("conversations");
      const conversationsSnap = await conversationsRef.get();

      console.log(`📝 Found ${conversationsSnap.size} conversations to migrate`);

      for (const convDoc of conversationsSnap.docs) {
        const convData = convDoc.data();
        const convId = convDoc.id;

        console.log(`🔄 Migrating conversation: ${convId}`);

        // Get the last message to set as lastMessage
        const messagesRef = convDoc.ref.collection("messages");
        const messagesSnap = await messagesRef.orderBy("createdAt", "desc").limit(1).get();

        let lastMessage = "";
        let lastMessageAt = convData.lastUpdated;

        if (!messagesSnap.empty) {
          const lastMsgDoc = messagesSnap.docs[0];
          const lastMsgData = lastMsgDoc.data();
          lastMessage = lastMsgData.body || "";
          lastMessageAt = lastMsgData.createdAt;
        }

        // Create new ticket document
        const ticketId = `ticket-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const ticketRef = db.collection("companies").doc(tenantId).collection("tickets").doc(ticketId);

        const ticketData = {
          customerId: convData.participants?.[0] || "",
          status: "open", // Default status for migrated conversations
          assignedTo: convData.assignedTo || "Admin",
          assignedEmail: convData.assignedEmail || null,
          lastMessage: lastMessage,
          createdAt: convData.lastUpdated || admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: convData.lastUpdated || admin.firestore.FieldValue.serverTimestamp(),
          channel: "whatsapp", // Assuming WhatsApp based on webhook
          aiEnabled: convData.aiEnabled !== false, // Preserve AI setting
          // Keep any other fields that might be useful
          ...convData
        };

        await ticketRef.set(ticketData);
        console.log(`✅ Created ticket: ${ticketId}`);

        // Move all messages to the new ticket
        const allMessagesSnap = await messagesRef.get();
        console.log(`📨 Moving ${allMessagesSnap.size} messages...`);

        const batch = db.batch();
        let batchCount = 0;

        for (const msgDoc of allMessagesSnap.docs) {
          const msgData = msgDoc.data();
          const newMsgRef = ticketRef.collection("messages").doc(msgDoc.id);

          batch.set(newMsgRef, msgData);

          batchCount++;
          if (batchCount >= 500) { // Firestore batch limit
            await batch.commit();
            batchCount = 0;
          }
        }

        if (batchCount > 0) {
          await batch.commit();
        }

        console.log(`✅ Moved ${allMessagesSnap.size} messages to ticket ${ticketId}`);

        // Optionally delete the old conversation (commented out for safety)
        // await convDoc.ref.delete();
        // console.log(`🗑️ Deleted old conversation: ${convId}`);
      }

      console.log(`✅ Completed migration for company: ${tenantId}`);
    }

    console.log("🎉 Migration completed successfully!");
    console.log("📋 Next steps:");
    console.log("1. Test the new ticket system");
    console.log("2. Update your application code to use tickets instead of conversations");
    console.log("3. Once everything works, you can uncomment the delete lines to remove old conversations");

  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrateToTickets()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Unexpected error:", err);
    process.exit(1);
  });
