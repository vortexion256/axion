"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';

export default function SettingsPage() {
  const { user, company, loading, updateCompanySettings } = useAuth();
  const router = useRouter();

  const [formData, setFormData] = useState({
    name: '',
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioPhoneNumber: '',
    geminiApiKey: '',
    aiStartingMessage: '',
    aiPromptTemplate: '',
    aiWaitMinutes: 5, // Default 5 minutes
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (company) {
      setFormData({
        name: company.name || '',
        twilioAccountSid: company.twilioAccountSid || '',
        twilioAuthToken: company.twilioAuthToken || '',
        twilioPhoneNumber: company.twilioPhoneNumber || '',
        geminiApiKey: company.geminiApiKey || '',
        aiStartingMessage: company.aiStartingMessage || '',
        aiPromptTemplate: company.aiPromptTemplate || '',
        aiWaitMinutes: company.aiWaitMinutes || 5,
      });
    }
  }, [company]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      await updateCompanySettings(formData);
      setMessage('Settings saved successfully!');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Failed to save settings. Please try again.');
      console.error('Error saving settings:', error);
    } finally {
      setSaving(false);
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
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              padding: '8px 12px',
              backgroundColor: '#f5f5f5',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            ← Back to Dashboard
          </button>
          <h1 style={{ color: '#1976d2', margin: 0 }}>Settings</h1>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ padding: '2rem' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <form onSubmit={handleSubmit}>
            {/* Company Info */}
            <div style={{
              backgroundColor: 'white',
              padding: '2rem',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '2rem'
            }}>
              <h3 style={{ marginTop: 0, color: '#333' }}>Company Information</h3>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  Company Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px'
                  }}
                  required
                />
              </div>
            </div>

            {/* Twilio Settings */}
            <div style={{
              backgroundColor: 'white',
              padding: '2rem',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '2rem'
            }}>
              <h3 style={{ marginTop: 0, color: '#333' }}>Twilio Configuration</h3>
              <p style={{ color: '#666', marginBottom: '1rem' }}>
                Configure your Twilio credentials to enable WhatsApp messaging.
              </p>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  Account SID
                </label>
                <input
                  type="text"
                  value={formData.twilioAccountSid}
                  onChange={(e) => handleInputChange('twilioAccountSid', e.target.value)}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  Auth Token
                </label>
                <input
                  type="password"
                  value={formData.twilioAuthToken}
                  onChange={(e) => handleInputChange('twilioAuthToken', e.target.value)}
                  placeholder="Your Twilio Auth Token"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  WhatsApp Phone Number
                </label>
                <input
                  type="text"
                  value={formData.twilioPhoneNumber}
                  onChange={(e) => handleInputChange('twilioPhoneNumber', e.target.value)}
                  placeholder="+1234567890"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px'
                  }}
                />
              </div>

              {company?.id && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    Webhook URL (for Twilio)
                  </label>
                  <div style={{
                    padding: '0.75rem',
                    backgroundColor: '#f5f5f5',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all'
                  }}>
                    {`${process.env.NEXT_PUBLIC_API_BASE_URL || 'https://ellen-nonabridgable-samual.ngrok-free.dev'}/webhook/whatsapp/${company.id}`}
                  </div>
                  <small style={{ color: '#666', display: 'block', marginTop: '0.5rem' }}>
                    Copy this URL to your Twilio WhatsApp webhook configuration.
                    <br/><strong>Note:</strong> This is your publicly accessible webhook URL for Twilio configuration.
                    <br/><em>Debug: API_BASE_URL = {process.env.NEXT_PUBLIC_API_BASE_URL || 'NOT SET'}</em>
                  </small>
                </div>
              )}
            </div>

            {/* Gemini AI Settings */}
            <div style={{
              backgroundColor: 'white',
              padding: '2rem',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '2rem'
            }}>
              <h3 style={{ marginTop: 0, color: '#333' }}>Gemini AI Configuration</h3>
              <p style={{ color: '#666', marginBottom: '1rem' }}>
                Configure your Google Gemini API key for AI-powered responses.
              </p>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  API Key
                </label>
                <input
                  type="password"
                  value={formData.geminiApiKey}
                  onChange={(e) => handleInputChange('geminiApiKey', e.target.value)}
                  placeholder="AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px'
                  }}
                />
              </div>
            </div>

            {/* AI Customization */}
            <div style={{
              backgroundColor: 'white',
              padding: '2rem',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '2rem'
            }}>
              <h3 style={{ marginTop: 0, color: '#333' }}>AI Customization</h3>
              <p style={{ color: '#666', marginBottom: '1rem' }}>
                Customize how your AI assistant behaves and responds.
              </p>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  Starting Message
                </label>
                <textarea
                  value={formData.aiStartingMessage}
                  onChange={(e) => handleInputChange('aiStartingMessage', e.target.value)}
                  placeholder="Hello! I'm your AI assistant. How can I help you today?"
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px',
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  AI Prompt Template
                </label>
                <textarea
                  value={formData.aiPromptTemplate}
                  onChange={(e) => handleInputChange('aiPromptTemplate', e.target.value)}
                  placeholder="You are Axion AI, a friendly, helpful assistant..."
                  rows={8}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px',
                    resize: 'vertical',
                    fontFamily: 'monospace'
                  }}
                />
                <small style={{ color: '#666', display: 'block', marginTop: '0.5rem' }}>
                  Use {'{companyName}'} and {'{history}'} as placeholders in your prompt.
                </small>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  AI Wait Time (minutes)
                </label>
                <select
                  value={formData.aiWaitMinutes}
                  onChange={(e) => handleInputChange('aiWaitMinutes', parseInt(e.target.value))}
                  style={{
                    width: '200px',
                    padding: '0.75rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px',
                    backgroundColor: 'white'
                  }}
                >
                  <option value={1}>1 minute</option>
                  <option value={2}>2 minutes</option>
                  <option value={3}>3 minutes</option>
                  <option value={5}>5 minutes</option>
                  <option value={10}>10 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                </select>
                <small style={{ color: '#666', display: 'block', marginTop: '0.5rem' }}>
                  How long AI should wait after a respondent goes offline before responding to customer messages.
                </small>
              </div>
            </div>

            {/* Save Button */}
            <div style={{
              backgroundColor: 'white',
              padding: '2rem',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              textAlign: 'center'
            }}>
              {message && (
                <div style={{
                  marginBottom: '1rem',
                  padding: '1rem',
                  borderRadius: '4px',
                  backgroundColor: message.includes('success') ? '#e8f5e8' : '#ffeaea',
                  color: message.includes('success') ? '#4caf50' : '#f44336',
                  border: `1px solid ${message.includes('success') ? '#4caf50' : '#f44336'}`
                }}>
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: '12px 32px',
                  backgroundColor: '#1976d2',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '16px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1
                }}
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
