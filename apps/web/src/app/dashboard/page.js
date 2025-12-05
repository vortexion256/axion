"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';

export default function DashboardPage() {
  const { user, company, loading, logout } = useAuth();
  const router = useRouter();
  const [testMessage, setTestMessage] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleTestWebhook = async () => {
    if (!testMessage.trim()) {
      alert('Please enter a test message');
      return;
    }

    try {
      setIsTesting(true);
      setTestResult(null);

      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://ellen-nonabridgable-samual.ngrok-free.dev';
      const response = await fetch(`${apiBase}/test-webhook/${company.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: testMessage.trim(),
          from: 'test-user@example.com'
        }),
      });

      const result = await response.json();
      setTestResult(result);

    } catch (error) {
      console.error('Test failed:', error);
      setTestResult({ error: 'Test failed', details: error.message });
    } finally {
      setIsTesting(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '18px'
      }}>
        Loading...
      </div>
    );
  }

  if (!user || !company) {
    return null;
  }

  const isConfigured = company.twilioAccountSid && company.twilioAuthToken &&
                      company.twilioPhoneNumber && company.geminiApiKey;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <header style={{
        backgroundColor: 'white',
        padding: '1rem 2rem',
        borderBottom: '1px solid #e0e0e0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ color: '#1976d2', margin: 0, fontSize: '1.5rem' }}>Axion</h1>
          <span style={{ color: '#666' }}>|</span>
          <span style={{ color: '#666' }}>{company.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ color: '#666', fontSize: '14px' }}>{user.email}</span>
          <button
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ padding: '2rem' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <h2 style={{ marginBottom: '1rem', color: '#333' }}>Dashboard</h2>

          {/* Status Card */}
          <div style={{
            backgroundColor: 'white',
            padding: '2rem',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            marginBottom: '2rem'
          }}>
            <h3 style={{ marginTop: 0, color: '#333' }}>Setup Status</h3>
            <div style={{ marginBottom: '1rem', fontSize: '14px', color: '#666' }}>
              <strong>Company ID:</strong> {company.id}<br/>
              <strong>Webhook URL:</strong> {`${process.env.NEXT_PUBLIC_API_BASE_URL || 'https://ellen-nonabridgable-samual.ngrok-free.dev'}/webhook/whatsapp/${company.id}`}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
              <div style={{
                padding: '1rem',
                border: `2px solid ${company.twilioAccountSid ? '#4caf50' : '#ff9800'}`,
                borderRadius: '4px',
                backgroundColor: company.twilioAccountSid ? '#e8f5e8' : '#fff3e0'
              }}>
                <div style={{ fontWeight: 'bold', color: company.twilioAccountSid ? '#4caf50' : '#ff9800' }}>
                  Twilio Account
                </div>
                <div style={{ fontSize: '14px', marginTop: '0.5rem' }}>
                  {company.twilioAccountSid ? '✓ Configured' : '⚠ Not configured'}
                </div>
              </div>

              <div style={{
                padding: '1rem',
                border: `2px solid ${company.geminiApiKey ? '#4caf50' : '#ff9800'}`,
                borderRadius: '4px',
                backgroundColor: company.geminiApiKey ? '#e8f5e8' : '#fff3e0'
              }}>
                <div style={{ fontWeight: 'bold', color: company.geminiApiKey ? '#4caf50' : '#ff9800' }}>
                  Gemini API
                </div>
                <div style={{ fontSize: '14px', marginTop: '0.5rem' }}>
                  {company.geminiApiKey ? '✓ Configured' : '⚠ Not configured'}
                </div>
              </div>

              <div style={{
                padding: '1rem',
                border: `2px solid ${company.twilioPhoneNumber ? '#4caf50' : '#ff9800'}`,
                borderRadius: '4px',
                backgroundColor: company.twilioPhoneNumber ? '#e8f5e8' : '#fff3e0'
              }}>
                <div style={{ fontWeight: 'bold', color: company.twilioPhoneNumber ? '#4caf50' : '#ff9800' }}>
                  WhatsApp Number
                </div>
                <div style={{ fontSize: '14px', marginTop: '0.5rem' }}>
                  {company.twilioPhoneNumber ? '✓ Configured' : '⚠ Not configured'}
                </div>
              </div>
            </div>

            {!isConfigured && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem',
                backgroundColor: '#fff3cd',
                border: '1px solid #ffeaa7',
                borderRadius: '4px',
                color: '#856404'
              }}>
                ⚠️ Complete your setup in Settings to start receiving WhatsApp messages and AI responses.
              </div>
            )}

            {isConfigured && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem',
                backgroundColor: '#d1ecf1',
                border: '1px solid #bee5eb',
                borderRadius: '4px'
              }}>
                <h4 style={{ marginTop: 0, color: '#0c5460' }}>Test Your Webhook</h4>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="Enter test message..."
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      border: '1px solid #ced4da',
                      borderRadius: '4px'
                    }}
                  />
                  <button
                    onClick={handleTestWebhook}
                    disabled={isTesting || !testMessage.trim()}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#17a2b8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: isTesting || !testMessage.trim() ? 'not-allowed' : 'pointer',
                      opacity: isTesting || !testMessage.trim() ? 0.7 : 1
                    }}
                  >
                    {isTesting ? 'Testing...' : 'Test Webhook'}
                  </button>
                </div>

                {testResult && (
                  <div style={{
                    padding: '0.5rem',
                    backgroundColor: testResult.success ? '#d4edda' : '#f8d7da',
                    border: `1px solid ${testResult.success ? '#c3e6cb' : '#f5c6cb'}`,
                    borderRadius: '4px',
                    fontSize: '14px',
                    color: testResult.success ? '#155724' : '#721c24'
                  }}>
                    <strong>Result:</strong> {testResult.success ? '✅ Webhook working!' : '❌ Error'}
                    <pre style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(testResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            <Link href="/inbox" style={{ textDecoration: 'none' }}>
              <div style={{
                backgroundColor: 'white',
                padding: '2rem',
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                border: '1px solid #e0e0e0'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
              }}>
                <h3 style={{ marginTop: 0, color: '#1976d2' }}>📱 Inbox</h3>
                <p style={{ color: '#666', marginBottom: 0 }}>
                  View and manage WhatsApp conversations with your AI assistant.
                </p>
              </div>
            </Link>

            <Link href="/settings" style={{ textDecoration: 'none' }}>
              <div style={{
                backgroundColor: 'white',
                padding: '2rem',
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                border: '1px solid #e0e0e0'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
              }}>
                <h3 style={{ marginTop: 0, color: '#ff9800' }}>⚙️ Settings</h3>
                <p style={{ color: '#666', marginBottom: 0 }}>
                  Configure Twilio, Gemini API, and AI settings for your company.
                </p>
              </div>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
