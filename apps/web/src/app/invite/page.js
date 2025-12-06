"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';

export default function InvitePage() {
  const { user, loading, signInWithGoogle, acceptInvitation, getInvitationDetails } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [invitationDetails, setInvitationDetails] = useState(null);
  const [loadingInvitation, setLoadingInvitation] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  const companyId = searchParams.get('companyId');
  const token = searchParams.get('token');

  useEffect(() => {
    const loadInvitationDetails = async () => {
      if (!companyId || !token) {
        setError('Invalid invitation link. Missing company ID or token.');
        setLoadingInvitation(false);
        return;
      }

      try {
        const details = await getInvitationDetails(companyId, token);
        setInvitationDetails(details);
      } catch (err) {
        console.error('Error loading invitation:', err);
        setError(err.message || 'Failed to load invitation details');
      } finally {
        setLoadingInvitation(false);
      }
    };

    loadInvitationDetails();
  }, [companyId, token, getInvitationDetails]);

  const handleAcceptInvitation = async () => {
    if (!invitationDetails || !user) return;

    try {
      setAccepting(true);
      setError('');

      await acceptInvitation(companyId, token);

      // Redirect to inbox after successful acceptance
      router.push('/inbox');
    } catch (err) {
      console.error('Error accepting invitation:', err);
      setError(err.message || 'Failed to accept invitation');
    } finally {
      setAccepting(false);
    }
  };

  if (loading || loadingInvitation) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '18px'
      }}>
        Loading invitation...
      </div>
    );
  }

  if (error) {
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
          padding: '2rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          textAlign: 'center',
          maxWidth: '500px'
        }}>
          <h2 style={{ color: '#f44336', marginBottom: '1rem' }}>❌ Invitation Error</h2>
          <p style={{ color: '#666', marginBottom: '2rem' }}>{error}</p>
          <Link href="/login" style={{
            display: 'inline-block',
            padding: '12px 24px',
            backgroundColor: '#1976d2',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px'
          }}>
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  if (!invitationDetails) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ fontSize: '18px', color: '#666' }}>Loading...</div>
      </div>
    );
  }

  const { company, respondent, isExpired } = invitationDetails;

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
        maxWidth: '500px',
        width: '100%'
      }}>
        <h1 style={{ color: '#1976d2', marginBottom: '0.5rem' }}>🎉 Team Invitation</h1>
        <h2 style={{ color: '#333', marginBottom: '2rem', fontSize: '1.5rem' }}>
          Join {company.name}
        </h2>

        <div style={{
          backgroundColor: '#f8f9fa',
          padding: '1.5rem',
          borderRadius: '8px',
          marginBottom: '2rem',
          textAlign: 'left'
        }}>
          <h3 style={{ marginTop: 0, color: '#333' }}>Invitation Details:</h3>
          <p style={{ margin: '0.5rem 0', color: '#666' }}>
            <strong>Company:</strong> {company.name}
          </p>
          <p style={{ margin: '0.5rem 0', color: '#666' }}>
            <strong>Role:</strong> Respondent
          </p>
          <p style={{ margin: '0.5rem 0', color: '#666' }}>
            <strong>Email:</strong> {respondent.email}
          </p>
        </div>

        {isExpired ? (
          <div style={{
            backgroundColor: '#ffeaea',
            color: '#d32f2f',
            padding: '1rem',
            borderRadius: '4px',
            marginBottom: '2rem'
          }}>
            ⚠️ This invitation has already been accepted or is no longer valid.
          </div>
        ) : (
          <>
            {!user ? (
              <div style={{ marginBottom: '2rem' }}>
                <p style={{ color: '#666', marginBottom: '1rem' }}>
                  To accept this invitation, please sign in with your Gmail account:
                </p>
                <button
                  onClick={signInWithGoogle}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#4285f4',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '16px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <span>🔵</span> Sign in with Google
                </button>
                <p style={{ fontSize: '14px', color: '#666', marginTop: '1rem' }}>
                  Note: Only Gmail accounts are allowed for respondents.
                </p>
              </div>
            ) : (
              <div style={{ marginBottom: '2rem' }}>
                <p style={{ color: '#666', marginBottom: '1rem' }}>
                  Welcome, <strong>{user.displayName || user.email}</strong>!
                </p>
                <p style={{ color: '#666', marginBottom: '1.5rem' }}>
                  You're signed in and ready to join the team.
                </p>
                <button
                  onClick={handleAcceptInvitation}
                  disabled={accepting}
                  style={{
                    padding: '14px 28px',
                    backgroundColor: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: accepting ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    opacity: accepting ? 0.7 : 1
                  }}
                >
                  {accepting ? 'Accepting Invitation...' : '✅ Accept Invitation'}
                </button>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid #e0e0e0' }}>
          <Link href="/login" style={{
            color: '#666',
            textDecoration: 'none',
            fontSize: '14px'
          }}>
            ← Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
