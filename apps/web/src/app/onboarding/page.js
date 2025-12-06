"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export default function OnboardingPage() {
  const { user, selectCompanyContext } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [companyName, setCompanyName] = useState('');
  const [useCase, setUseCase] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreateCompany = async () => {
    const trimmedName = companyName.trim();
    if (!trimmedName) {
      alert('Please enter a company name');
      return;
    }

    if (trimmedName.length < 2) {
      alert('Company name must be at least 2 characters long');
      return;
    }

    try {
      setCreating(true);
      console.log('Creating company with name:', trimmedName);
      console.log('User ID:', user.uid);
      console.log('Use case:', useCase);

      const companyId = user.uid;
      const companyRef = doc(db, 'companies', companyId);

      const newCompany = {
        name: trimmedName,
        email: user.email,
        role: 'admin',
        createdAt: new Date(),
        useCase: useCase,
        twilioAccountSid: '',
        twilioAuthToken: '',
        twilioPhoneNumber: '',
        geminiApiKey: '',
        aiStartingMessage: 'Hello! I\'m your AI assistant. How can I help you today?',
        aiPromptTemplate: `You are Axion AI, a friendly, helpful assistant for {companyName}.
You are chatting 1:1 with a real user over WhatsApp.
Always respond naturally, avoid generic replies like "Ok" or "Noted".
Be proactive: acknowledge what they said, add a bit of helpful context, and ask a simple follow-up question if it makes sense.
Keep replies short (1–3 sentences), friendly, and easy to read on a phone.

Here is the recent conversation history (oldest to newest):
{history}

Continue the conversation with your next message.`,
        webhookUrl: '',
      };

      console.log('Saving company data:', newCompany);
      await setDoc(companyRef, newCompany);
      console.log('Company saved successfully');

      console.log('Selecting company context...');
      await selectCompanyContext(companyId, 'admin');
      console.log('Company context selected');

      console.log('Redirecting to dashboard...');
      router.push('/dashboard');
    } catch (error) {
      console.error('Error creating company:', error);
      alert(`Failed to create company: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  if (!user) {
    router.push('/login');
    return null;
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '3rem',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        textAlign: 'center',
        maxWidth: '600px',
        width: '100%'
      }}>
        {/* Step 1: Welcome */}
        {step === 1 && (
          <>
            <h1 style={{ color: '#1976d2', marginBottom: '0.5rem' }}>🎉 Welcome to Axion!</h1>
            <p style={{ color: '#666', marginBottom: '2rem' }}>
              Let's set up your WhatsApp team inbox platform.
            </p>

            <div style={{ textAlign: 'left', marginBottom: '2rem' }}>
              <h3 style={{ color: '#333', marginBottom: '1rem' }}>What brings you here?</h3>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {[
                  { value: 'business-owner', label: '🏢 Business Owner - I want to manage customer conversations for my company' },
                  { value: 'team-lead', label: '👥 Team Lead - I need to coordinate responses from multiple team members' },
                  { value: 'customer-service', label: '💬 Customer Service - I handle WhatsApp inquiries and support' },
                  { value: 'agency', label: '🚀 Agency - I manage WhatsApp for multiple clients' },
                  { value: 'other', label: '🤔 Other - Just exploring WhatsApp automation' }
                ].map((option) => (
                  <label
                    key={option.value}
                    style={{
                      display: 'block',
                      padding: '1rem',
                      border: `2px solid ${useCase === option.value ? '#1976d2' : '#e0e0e0'}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      backgroundColor: useCase === option.value ? '#f3f9ff' : 'white',
                      transition: 'all 0.2s'
                    }}
                  >
                    <input
                      type="radio"
                      name="useCase"
                      value={option.value}
                      checked={useCase === option.value}
                      onChange={(e) => setUseCase(e.target.value)}
                      style={{ marginRight: '0.5rem' }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!useCase}
              style={{
                padding: '12px 24px',
                backgroundColor: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: useCase ? 'pointer' : 'not-allowed',
                fontSize: '16px',
                opacity: useCase ? 1 : 0.7
              }}
            >
              Continue →
            </button>
          </>
        )}

        {/* Step 2: Company Setup */}
        {step === 2 && (
          <>
            <h1 style={{ color: '#1976d2', marginBottom: '0.5rem' }}>🏢 Set Up Your Company</h1>
            <p style={{ color: '#666', marginBottom: '2rem' }}>
              Create your company profile to get started with WhatsApp team inbox.
            </p>

            <div style={{ textAlign: 'left', marginBottom: '2rem' }}>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 'bold',
                color: '#333'
              }}>
                Company Name *
              </label>
              <input
                type="text"
                placeholder="Enter your company name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '1rem',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '16px',
                  marginBottom: '1rem'
                }}
                required
              />

              <div style={{
                backgroundColor: '#e3f2fd',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid #bbdefb'
              }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#1565c0' }}>📋 What happens next?</h4>
                <ul style={{ margin: 0, paddingLeft: '1.5rem', color: '#1565c0' }}>
                  <li>You'll become the admin of this company</li>
                  <li>You can invite team members as respondents</li>
                  <li>Set up WhatsApp integration and AI responses</li>
                  <li>Start managing customer conversations</li>
                </ul>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#f5f5f5',
                  color: '#666',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                ← Back
              </button>
              <button
                onClick={handleCreateCompany}
                disabled={creating || !companyName.trim()}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: creating || !companyName.trim() ? 'not-allowed' : 'pointer',
                  fontSize: '16px',
                  opacity: creating || !companyName.trim() ? 0.7 : 1
                }}
              >
                {creating ? 'Creating Company...' : 'Create Company 🚀'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
