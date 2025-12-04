// loadTestData.js
const admin = require("firebase-admin");
const serviceAccount = require("../axion256system-firebase-adminsdk-fbsvc-bbb9336fa7.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function run() {
  const tenantId = "demo-company";

  // Create 3 conversations
  for (let i = 1; i <= 3; i++) {
    const convId = `conv-${i}`;
    const convRef = db
      .collection("companies")
      .doc(tenantId)
      .collection("conversations")
      .doc(convId);

    await convRef.set({
      participants: [`+2567${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`],
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Add 2 messages per conversation
    for (let j = 1; j <= 2; j++) {
      const msgRef = convRef.collection("messages").doc(`msg-${j}`);
      await msgRef.set({
        from: `+2567${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`,
        body: `Hello from conversation ${i}, message ${j}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  console.log("🎉 All test data added successfully!");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error adding test data:", err);
    process.exit(1);
  });
