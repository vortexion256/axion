// testCustomerHistory.js
const admin = require("firebase-admin");
const serviceAccount = require("../axion256system-firebase-adminsdk-fbsvc-bbb9336fa7.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function testCustomerHistory() {
  try {
    console.log("🧪 Testing customer history functionality...");

    const tenantId = "demo-company";
    const customerId = "whatsapp:+1234567890";

    // Create a few test tickets for the same customer
    for (let i = 1; i <= 3; i++) {
      const ticketId = `test-history-ticket-${i}-${Date.now()}`;
      const ticketRef = db.collection("companies").doc(tenantId).collection("tickets").doc(ticketId);

      const ticketData = {
        customerId: customerId,
        status: i === 3 ? "open" : "closed", // Make the last one open
        assignedTo: "Test Agent",
        assignedEmail: "test@example.com",
        lastMessage: `Test message ${i} from customer`,
        createdAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 24 * 60 * 60 * 1000))), // Different days
        updatedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 24 * 60 * 60 * 1000))),
        channel: "whatsapp",
        aiEnabled: true,
      };

      await ticketRef.set(ticketData);

      // Add a test message to each ticket
      const messageRef = ticketRef.collection("messages").doc(`msg-${i}`);
      await messageRef.set({
        from: customerId,
        body: `This is test message ${i} with some customer context and information`,
        createdAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 24 * 60 * 60 * 1000))),
      });

      console.log(`✅ Created test ticket ${i}: ${ticketId}`);
    }

    console.log("🎉 Test tickets created successfully!");
    console.log("📝 Now test the inbox to see customer history in action");
    console.log(`🔍 Look for tickets with customerId: ${customerId}`);

  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

testCustomerHistory()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Unexpected error:", err);
    process.exit(1);
  });
