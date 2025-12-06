// Next.js API Route for respondent status updates (sendBeacon)
import { NextResponse } from 'next/server';
import admin from 'firebase-admin';

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

export async function POST(request) {
  try {
    console.log('📡 sendBeacon endpoint called');
    const { email, companyId, action } = await request.json();

    if (!email || !companyId) {
      console.log('❌ Missing required fields in sendBeacon request');
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
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

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('❌ Error updating respondent status via sendBeacon:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
