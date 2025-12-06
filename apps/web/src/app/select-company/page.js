"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';

export default function SelectCompanyPage() {
  const {
    user,
    userCompanies,
    respondentCompanies,
    selectedCompanyId,
    loading,
    selectCompanyContext
  } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If already selected a company, redirect to dashboard
    if (selectedCompanyId) {
      router.push('/dashboard');
      return;
    }

    // If only one company total, auto-select it
    const allCompanies = [...userCompanies, ...respondentCompanies];
    if (allCompanies.length === 1) {
      selectCompanyContext(allCompanies[0].id, allCompanies[0].userRole);
      return;
    }

    // If no companies at all, redirect to onboarding
    if (allCompanies.length === 0) {
      router.push('/onboarding');
      return;
    }
  }, [selectedCompanyId, userCompanies, respondentCompanies, selectCompanyContext, router]);

  const handleCompanySelect = async (companyId, role) => {
    try {
      await selectCompanyContext(companyId, role);
      router.push('/dashboard');
    } catch (error) {
      console.error('Error selecting company:', error);
      alert('Failed to select company. Please try again.');
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

  if (!user) {
    router.push('/login');
    return null;
  }

  const allCompanies = [...userCompanies, ...respondentCompanies];

  // If only one company, this page shouldn't render (useEffect handles redirect)
  if (allCompanies.length <= 1) {
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
        <h1 style={{ color: '#1976d2', marginBottom: '0.5rem' }}>🏢 Select Company</h1>
        <p style={{ color: '#666', marginBottom: '2rem' }}>
          Welcome back, <strong>{user.displayName || user.email}</strong>!
          <br />
          Choose which company you'd like to work with:
        </p>

        <div style={{ display: 'grid', gap: '1rem', marginBottom: '2rem' }}>
          {/* Admin Companies */}
          {userCompanies.map((company) => (
            <div
              key={`admin-${company.id}`}
              style={{
                padding: '1.5rem',
                border: '2px solid #4caf50',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                backgroundColor: '#f8fff8'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 4px 8px rgba(76, 175, 80, 0.3)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }}
              onClick={() => handleCompanySelect(company.id, 'admin')}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ textAlign: 'left' }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', color: '#2e7d32' }}>
                    {company.name}
                  </h3>
                  <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
                    Administrator
                  </p>
                </div>
                <div style={{
                  backgroundColor: '#4caf50',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}>
                  ADMIN
                </div>
              </div>
            </div>
          ))}

          {/* Respondent Companies */}
          {respondentCompanies.map((company) => (
            <div
              key={`respondent-${company.id}`}
              style={{
                padding: '1.5rem',
                border: '2px solid #2196f3',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                backgroundColor: '#f8fbff'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 4px 8px rgba(33, 150, 243, 0.3)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }}
              onClick={() => handleCompanySelect(company.id, 'respondent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ textAlign: 'left' }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', color: '#1565c0' }}>
                    {company.name}
                  </h3>
                  <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
                    Respondent
                  </p>
                </div>
                <div style={{
                  backgroundColor: '#2196f3',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}>
                  RESPONDENT
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid #e0e0e0' }}>
          <button
            onClick={() => router.push('/onboarding')}
            style={{
              backgroundColor: '#f5f5f5',
              color: '#666',
              border: '1px solid #ddd',
              padding: '0.75rem 1.5rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Create New Company
          </button>
        </div>
      </div>
    </div>
  );
}
