// Next.js API Route for test webhook
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

export async function POST(request, { params }) {
  try {
    const tenantId = params.tenantId;
    console.log("🧪 Test webhook called for tenant:", tenantId);

    // Handle both our manual JSON tests and Twilio's x-www-form-urlencoded payload
    const body = await request.json();
    const { message, from } = body;

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

    console.log(`🧪 Test webhook called for company ${tenantId}:`, { message, from });

    // Load company configuration
    const companyRef = db.collection("companies").doc(tenantId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      return NextResponse.json({
        error: "Company not found",
        tenantId,
        message: "Make sure you're logged in and your company is registered"
      }, { status: 404 });
    }

    const company = companySnap.data();

    return NextResponse.json({
      success: true,
      company: company.name,
      tenantId,
      message,
      from,
      timestamp: new Date().toISOString(),
      note: "Webhook is working! Configure this URL in your Twilio WhatsApp settings."
    });

  } catch (error) {
    console.error("❌ Test webhook error:", error);
    return NextResponse.json({ error: "Internal server error", details: error.message }, { status: 500 });
  }
}
