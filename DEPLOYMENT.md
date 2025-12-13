# Axion Deployment Guide

## Vercel Deployment

### Prerequisites
- Vercel account
- Firebase project with Firestore
- Twilio account with WhatsApp enabled
- Google Gemini API key

### Step 1: Prepare Firebase Service Account
1. Go to Firebase Console > Project Settings > Service Accounts
2. Generate a new private key (JSON)
3. Copy the entire JSON content

### Step 2: Deploy to Vercel
1. Connect your GitHub repository to Vercel
2. Set the **Root Directory** to `apps/web`
3. **No vercel.json configuration needed** - Next.js automatically detects API routes
4. Configure environment variables in Vercel:

```
FIREBASE_SERVICE_ACCOUNT_KEY=<paste-entire-json-here>
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyA-44DQ0o492HsxqDkH6kvy6H08OMMBNMU
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=axion256system.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=axion256system
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=axion256system.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=718860459380
NEXT_PUBLIC_FIREBASE_APP_ID=1:718860459380:web:275f372555ebb726f12021
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-QTBDXPXRY4
```

### Step 3: Configure Twilio Webhook
1. Get your Vercel deployment URL (e.g., `https://your-app.vercel.app`)
2. In Twilio Console > WhatsApp > Senders:
   - Set webhook URL to: `https://your-app.vercel.app/api/webhook/whatsapp/{CompanyID}`
   - Replace `{CompanyID}` with your actual company ID from Firestore

### Step 4: Configure Company Settings
In your Firebase Firestore, update your company document with:
- `twilioAccountSid`
- `twilioAuthToken`
- `twilioPhoneNumber`
- `geminiApiKey`
- Other AI settings as needed

### Step 5: Test Deployment
1. Visit your Vercel URL
2. Create/login to an account
3. Test webhook functionality
4. Send a WhatsApp message to test the AI responses

## Environment Variables Reference

### Required for Vercel:
- `FIREBASE_SERVICE_ACCOUNT_KEY` - Full JSON service account key
- `TWILIO_ACCOUNT_SID` - Your Twilio Account SID
- `TWILIO_AUTH_TOKEN` - Your Twilio Auth Token

### Optional:
- `NEXT_PUBLIC_API_BASE_URL` - Only needed if using external API (not for Vercel)

**Get Twilio Credentials:**
1. Go to [Twilio Console](https://console.twilio.com)
2. Navigate to **Account** → **API Keys & Tokens**
3. Copy your **Account SID** and **Auth Token**

## Troubleshooting

### Build Fails
- Ensure `FIREBASE_SERVICE_ACCOUNT_KEY` is set in Vercel environment variables
- Check that the JSON format is valid (no extra characters)
- Next.js automatically detects and deploys API routes

### Webhook Not Working
- Verify the webhook URL in Twilio matches your Vercel deployment: `https://your-app.vercel.app/api/webhook/whatsapp/{companyId}`
- Check Vercel function logs for errors
- Ensure company configuration is complete in Firestore

### API Routes Not Found
- Vercel automatically detects Next.js API routes
- Ensure routes are in `src/app/api/` directory
- Check Vercel deployment logs for any build errors
- **If you see "functions pattern" errors**: Remove any vercel.json files from the repository root

### AI Not Responding
- Check that `geminiApiKey` is set in company settings
- Verify Twilio credentials are correct
- Check Vercel function logs for API errors

### WhatsApp Media Not Displaying
- Ensure `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set in Vercel environment variables
- Check Vercel logs for "Twilio credentials not available for media download" errors
- Media download requires Twilio authentication to access private URLs
