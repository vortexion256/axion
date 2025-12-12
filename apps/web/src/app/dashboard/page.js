"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export default function DashboardPage() {
  const { user, company, respondents, userCompanies, respondentCompanies, selectedCompanyId, userRole, loading, logout, clearTwilioErrors, inviteRespondent, removeRespondent, selectCompanyContext } = useAuth();
  const router = useRouter();
  const [testMessage, setTestMessage] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [errorConversationCount, setErrorConversationCount] = useState(0);

  // User management state
  const [newRespondentEmail, setNewRespondentEmail] = useState('');
  const [invitingRespondent, setInvitingRespondent] = useState(false);
  const [removingRespondent, setRemovingRespondent] = useState(null);
  const [lastInvitation, setLastInvitation] = useState(null);
  const [showCompanySwitcher, setShowCompanySwitcher] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    // Handle redirects for users without company context
    if (!loading && user && (!company || !selectedCompanyId)) {
      router.push('/select-company');
    }
  }, [user, loading, company, selectedCompanyId, router]);

  useEffect(() => {
    const countErrorConversations = async () => {
      if (!company?.id) return;

      try {
        const ticketsRef = collection(db, 'companies', company.id, 'tickets');
        const ticketsSnap = await getDocs(ticketsRef);

        let errorCount = 0;
        for (const ticketDoc of ticketsSnap.docs) {
          const messagesRef = collection(db, 'companies', company.id, 'tickets', ticketDoc.id, 'messages');
          const errorQuery = query(messagesRef, where('error', '==', true));
          const errorSnap = await getDocs(errorQuery);
          if (!errorSnap.empty) {
            errorCount++;
          }
        }

        setErrorConversationCount(errorCount);
      } catch (error) {
        console.error('Error counting error conversations:', error);
      }
    };

    countErrorConversations();
  }, [company?.id]);

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

      // Use relative URL for API calls
      const apiBase = "";
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

  const handleInviteRespondent = async (e) => {
    e.preventDefault();
    if (!newRespondentEmail.trim()) {
      alert('Please enter an email address');
      return;
    }

    try {
      setInvitingRespondent(true);
      const invitationResult = await inviteRespondent(newRespondentEmail.trim());
      setNewRespondentEmail('');
      setLastInvitation(invitationResult);

      // Copy invitation URL to clipboard
      if (invitationResult.invitationUrl) {
        navigator.clipboard.writeText(invitationResult.invitationUrl);
        alert('Invitation created! The invitation link has been copied to your clipboard. Share it with the respondent.');
      } else {
        alert('Respondent invitation created successfully!');
      }
    } catch (error) {
      console.error('Error inviting respondent:', error);
      alert(error.message);
    } finally {
      setInvitingRespondent(false);
    }
  };

  const handleRemoveRespondent = async (respondentId) => {
    if (!confirm('Are you sure you want to remove this respondent? They will lose access to all conversations.')) {
      return;
    }

    try {
      setRemovingRespondent(respondentId);
      await removeRespondent(respondentId);
      alert('Respondent removed successfully');
    } catch (error) {
      console.error('Error removing respondent:', error);
      alert('Failed to remove respondent');
    } finally {
      setRemovingRespondent(null);
    }
  };

  // Check if user is admin in current company context
  const isAdmin = userRole === 'admin';

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

  if (!user) {
    return null; // useEffect will handle redirect
  }

  if (!company || !selectedCompanyId) {
    // User is logged in but no company context selected - useEffect handles redirect
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '18px'
      }}>
        Redirecting to company selection...
      </div>
    );
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

          {/* Company Switcher */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowCompanySwitcher(!showCompanySwitcher)}
              style={{
                backgroundColor: 'transparent',
                border: '1px solid #ddd',
                borderRadius: '4px',
                padding: '0.5rem 1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <span>{company?.name}</span>
              <span style={{
                backgroundColor: userRole === 'admin' ? '#4caf50' : '#2196f3',
                color: 'white',
                padding: '0.125rem 0.5rem',
                borderRadius: '10px',
                fontSize: '10px',
                fontWeight: 'bold'
              }}>
                {userRole?.toUpperCase()}
              </span>
              <span>{showCompanySwitcher ? '▲' : '▼'}</span>
            </button>

            {showCompanySwitcher && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                backgroundColor: 'white',
                border: '1px solid #ddd',
                borderRadius: '4px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                minWidth: '250px',
                zIndex: 1000,
                marginTop: '0.25rem'
              }}>
                {/* Current Company */}
                <div style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid #eee',
                  backgroundColor: '#f8f9fa'
                }}>
                  <div style={{ fontWeight: 'bold', color: '#333' }}>{company?.name}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    Current: {userRole === 'admin' ? 'Administrator' : 'Respondent'}
                  </div>
                </div>

                {/* Other Companies */}
                {[...userCompanies.filter(c => c.id !== selectedCompanyId),
                  ...respondentCompanies.filter(c => c.id !== selectedCompanyId)].map((comp) => (
                  <button
                    key={`${comp.userRole}-${comp.id}`}
                    onClick={async () => {
                      await selectCompanyContext(comp.id, comp.userRole);
                      setShowCompanySwitcher(false);
                      // Reload the page to refresh all data
                      window.location.reload();
                    }}
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      border: 'none',
                      backgroundColor: 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f0f0f0'
                    }}
                    onMouseOver={(e) => e.target.style.backgroundColor = '#f8f9fa'}
                    onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
                  >
                    <div style={{ fontWeight: 'bold', color: '#333' }}>{comp.name}</div>
                    <div style={{
                      fontSize: '12px',
                      color: comp.userRole === 'admin' ? '#4caf50' : '#2196f3'
                    }}>
                      {comp.userRole === 'admin' ? 'Administrator' : 'Respondent'}
                    </div>
                  </button>
                ))}

                <button
                  onClick={() => {
                    setShowCompanySwitcher(false);
                    router.push('/select-company');
                  }}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    border: 'none',
                    backgroundColor: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#666',
                    fontSize: '14px'
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#f8f9fa'}
                  onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
                >
                  + Switch Company
                </button>
              </div>
            )}
          </div>
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

          {/* Twilio Error Alert */}
          {company.hasTwilioErrors && (
            <div style={{
              backgroundColor: '#ffeaea',
              border: '1px solid #f44336',
              padding: '1.5rem',
              borderRadius: '8px',
              marginBottom: '2rem'
            }}>
              <h3 style={{ marginTop: 0, color: '#d32f2f', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                ⚠️ Twilio Account Issue Detected
              </h3>
              <div style={{ color: '#d32f2f', marginBottom: '1rem' }}>
                <strong>Last Error:</strong> {company.lastTwilioError?.message || 'Unknown error'}
                {company.lastTwilioError?.code && (
                  <div style={{ fontSize: '14px', marginTop: '0.5rem' }}>
                    <strong>Error Code:</strong> {company.lastTwilioError.code}
                  </div>
                )}
                {company.lastTwilioError?.timestamp && (
                  <div style={{ fontSize: '14px', marginTop: '0.5rem', color: '#666' }}>
                    <strong>Time:</strong> {new Date(company.lastTwilioError.timestamp.seconds * 1000).toLocaleString()}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  onClick={() => window.location.href = '/settings'}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#1976d2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Check Settings
                </button>
                <button
                  onClick={async () => {
                    console.log('Clearing Twilio errors...');
                    try {
                      await clearTwilioErrors();
                      console.log('Twilio errors cleared successfully');
                    } catch (error) {
                      console.error('Error clearing errors:', error);
                      alert('Failed to clear errors. Please try again.');
                    }
                  }}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Mark as Resolved
                </button>
              </div>
            </div>
          )}

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
              <strong>Webhook URL:</strong> {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhook/whatsapp/${company.id}`}
              {company.hasTwilioErrors && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#ffeaea', borderRadius: '4px', border: '1px solid #f44336' }}>
                  <strong style={{ color: '#d32f2f' }}>⚠️ Active Delivery Issues</strong><br/>
                  <span style={{ fontSize: '12px', color: '#666' }}>
                    Some messages are failing to send. Check your Twilio account status and webhook configuration.
                  </span>
                </div>
              )}
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

              <div style={{
                padding: '1rem',
                border: `2px solid ${errorConversationCount === 0 ? '#4caf50' : '#f44336'}`,
                borderRadius: '4px',
                backgroundColor: errorConversationCount === 0 ? '#e8f5e8' : '#ffeaea'
              }}>
                <div style={{ fontWeight: 'bold', color: errorConversationCount === 0 ? '#4caf50' : '#f44336' }}>
                  Message Delivery
                </div>
                <div style={{ fontSize: '14px', marginTop: '0.5rem' }}>
                  {errorConversationCount === 0
                    ? '✓ All messages delivered'
                    : `⚠ ${errorConversationCount} conversation${errorConversationCount > 1 ? 's' : ''} with delivery errors`
                  }
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

          {/* User Management Section - Admin Only */}
          {isAdmin && (
            <div style={{
              backgroundColor: 'white',
              padding: '2rem',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '2rem'
            }}>
              <h3 style={{ marginTop: 0, color: '#333' }}>👥 Team Management</h3>
              <p style={{ color: '#666', marginBottom: '1.5rem' }}>
                Invite and manage respondents who can help handle your WhatsApp conversations.
              </p>

              {/* Invite New Respondent */}
              <div style={{ marginBottom: '2rem' }}>
                <h4 style={{ color: '#333', marginBottom: '1rem' }}>Invite New Respondent</h4>
                <form onSubmit={handleInviteRespondent} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <input
                    type="email"
                    placeholder="respondent@gmail.com"
                    value={newRespondentEmail}
                    onChange={(e) => setNewRespondentEmail(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '16px'
                    }}
                    required
                  />
                  <button
                    type="submit"
                    disabled={invitingRespondent || !newRespondentEmail.trim()}
                    style={{
                      padding: '0.75rem 1.5rem',
                      backgroundColor: '#4caf50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: invitingRespondent || !newRespondentEmail.trim() ? 'not-allowed' : 'pointer',
                      opacity: invitingRespondent || !newRespondentEmail.trim() ? 0.7 : 1
                    }}
                  >
                    {invitingRespondent ? 'Inviting...' : 'Invite'}
                  </button>
                </form>
                <small style={{ color: '#666' }}>
                  Respondents must use Gmail addresses only. They'll receive an invitation link to join your team.
                </small>

                {/* Show last invitation */}
                {lastInvitation && (
                  <div style={{
                    marginTop: '1rem',
                    padding: '1rem',
                    backgroundColor: '#e8f5e8',
                    border: '1px solid #4caf50',
                    borderRadius: '4px'
                  }}>
                    <h4 style={{ marginTop: 0, color: '#4caf50' }}>✅ Invitation Created!</h4>
                    <p style={{ margin: '0.5rem 0', color: '#666' }}>
                      <strong>Email:</strong> {lastInvitation.email}
                    </p>
                    <p style={{ margin: '0.5rem 0', color: '#666' }}>
                      <strong>Invitation Link:</strong>
                    </p>
                    <div style={{
                      backgroundColor: '#f5f5f5',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      wordBreak: 'break-all',
                      marginBottom: '0.5rem'
                    }}>
                      {lastInvitation.invitationUrl}
                    </div>
                    <p style={{ fontSize: '14px', color: '#666', marginBottom: '0.5rem' }}>
                      Share this link with the respondent. The link has been copied to your clipboard.
                    </p>
                    <button
                      onClick={() => setLastInvitation(null)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#666',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>

              {/* Current Respondents */}
              <div>
                <h4 style={{ color: '#333', marginBottom: '1rem' }}>Current Team Members</h4>
                {respondents.length === 0 ? (
                  <p style={{ color: '#666', fontStyle: 'italic' }}>
                    No respondents invited yet. Conversations will be handled by you (admin) until you add team members.
                  </p>
                ) : (
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {respondents.map((respondent) => (
                      <div key={respondent.id} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '1rem',
                        border: '1px solid #e0e0e0',
                        borderRadius: '4px',
                        backgroundColor: '#fafafa'
                      }}>
                        <div>
                          <div style={{ fontWeight: 'bold', color: '#333' }}>
                            {respondent.email}
                          </div>
                          <div style={{ fontSize: '14px', color: '#666' }}>
                            Status: <span style={{
                              color: respondent.status === 'active' ? '#4caf50' :
                                     respondent.status === 'invited' ? '#ff9800' : '#f44336'
                            }}>
                              {respondent.status === 'active' ? 'Active' :
                               respondent.status === 'invited' ? 'Invited (pending acceptance)' : respondent.status}
                            </span>
                            {respondent.status === 'active' && (
                              <span style={{
                                marginLeft: '0.5rem',
                                color: respondent.isOnline ? '#4caf50' : '#ff9800',
                                fontSize: '0.8rem'
                              }}>
                                {respondent.isOnline ? '🟢 Online' : '🟡 Offline'}
                              </span>
                            )}
                          </div>
                          {respondent.invitedAt && (
                            <div style={{ fontSize: '12px', color: '#999' }}>
                              Invited: {respondent.invitedAt.toDate ? respondent.invitedAt.toDate().toLocaleDateString() : new Date(respondent.invitedAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveRespondent(respondent.id)}
                          disabled={removingRespondent === respondent.id}
                          style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: removingRespondent === respondent.id ? 'not-allowed' : 'pointer',
                            opacity: removingRespondent === respondent.id ? 0.7 : 1,
                            fontSize: '14px'
                          }}
                        >
                          {removingRespondent === respondent.id ? 'Removing...' : 'Remove'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

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
                  {isAdmin
                    ? 'View and manage all WhatsApp conversations.'
                    : 'View and respond to conversations assigned to you.'
                  }
                </p>
              </div>
            </Link>

            {isAdmin && (
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
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
