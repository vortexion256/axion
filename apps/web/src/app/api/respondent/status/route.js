// Next.js API Route for respondent status updates (sendBeacon)
import { NextResponse } from 'next/server';
import admin from 'firebase-admin';

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

export async function POST(request) {
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
