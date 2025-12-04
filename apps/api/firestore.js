const admin = require('firebase-admin');
const serviceAccount = require('./axion256system-firebase-adminsdk-fbsvc-bbb9336fa7.json'); // Download from Firebase

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const db = admin.firestore();
module.exports = db;
