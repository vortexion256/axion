"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc, query, where } from 'firebase/firestore';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [respondents, setRespondents] = useState([]);
  const [userCompanies, setUserCompanies] = useState([]); // Companies where user is admin
  const [respondentCompanies, setRespondentCompanies] = useState([]); // Companies where user is respondent
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [userRole, setUserRole] = useState(null); // 'admin' or 'respondent' for selected company
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(false); // Loading user company context

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          console.log('Auth: User logged in, loading context...');
          setUser(firebaseUser);
          setContextLoading(true);

          // Load all companies and respondent relationships for this user
          await loadUserContext(firebaseUser);
          console.log('Auth: User context loaded successfully');
          setContextLoading(false);
        } else {
          console.log('Auth: User logged out');
          setUser(null);
          setCompany(null);
          setRespondents([]);
          setUserCompanies([]);
          setRespondentCompanies([]);
          setSelectedCompanyId(null);
          setUserRole(null);
          setContextLoading(false);
        }
      } catch (error) {
        console.error('Auth: Error during auth state change:', error);
        // Ensure loading is set to false even on error
        setUser(firebaseUser || null);
      } finally {
        console.log('Auth: Setting loading to false');
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const loadUserContext = async (firebaseUser) => {
    try {
      console.log('Loading user context for:', firebaseUser.email);
      const userId = firebaseUser.uid;
      const userEmail = firebaseUser.email;

      // Load companies where user is admin (owner)
      console.log('Loading admin company...');
      const adminCompanyRef = doc(db, 'companies', userId);
      const adminCompanySnap = await getDoc(adminCompanyRef);

      let adminCompanies = [];
      if (adminCompanySnap.exists()) {
        adminCompanies = [{ id: userId, ...adminCompanySnap.data(), userRole: 'admin' }];
      }

      // Load companies where user is a respondent
      const respondentCompaniesPromises = adminCompanies.map(async (adminCompany) => {
        const respondentsRef = collection(db, 'companies', adminCompany.id, 'respondents');
        const respondentsSnap = await getDocs(respondentsRef);
        return respondentsSnap.docs
          .filter(doc => doc.data().email === userEmail && doc.data().status === 'active')
          .map(doc => ({
            id: adminCompany.id,
            ...adminCompany,
            respondentData: { id: doc.id, ...doc.data() },
            userRole: 'respondent'
          }));
      });

      const respondentCompaniesArrays = await Promise.all(respondentCompaniesPromises);
      const respondentCompanies = respondentCompaniesArrays.flat();

      // Also search for respondent relationships in other companies
      const allCompaniesRef = collection(db, 'companies');
      const allCompaniesSnap = await getDocs(allCompaniesRef);

      const otherRespondentCompanies = [];
      for (const companyDoc of allCompaniesSnap.docs) {
        if (companyDoc.id !== userId) { // Skip user's own company
          const respondentsRef = collection(db, 'companies', companyDoc.id, 'respondents');
          const respondentsSnap = await getDocs(respondentsRef);

          const userAsRespondent = respondentsSnap.docs.find(doc =>
            doc.data().email === userEmail && doc.data().status === 'active'
          );

          if (userAsRespondent) {
            // Set respondent as online by default when they log in
            await updateDoc(userAsRespondent.ref, {
              isOnline: true,
              lastSeen: new Date(),
            });

            otherRespondentCompanies.push({
              id: companyDoc.id,
              ...companyDoc.data(),
              respondentData: { id: userAsRespondent.id, ...userAsRespondent.data(), isOnline: true },
              userRole: 'respondent'
            });
          }
        }
      }

      const allUserCompanies = [...adminCompanies, ...respondentCompanies, ...otherRespondentCompanies];

      setUserCompanies(allUserCompanies.filter(c => c.userRole === 'admin'));
      setRespondentCompanies(allUserCompanies.filter(c => c.userRole === 'respondent'));

      console.log('User companies loaded:', {
        admin: allUserCompanies.filter(c => c.userRole === 'admin').length,
        respondent: allUserCompanies.filter(c => c.userRole === 'respondent').length
      });

      // If only one company, auto-select it
      if (allUserCompanies.length === 1) {
        console.log('Auto-selecting single company...');
        const selectedCompany = allUserCompanies[0];
        try {
          await selectCompanyContext(selectedCompany.id, selectedCompany.userRole);
          console.log('Company auto-selected successfully');
        } catch (error) {
          console.error('Failed to auto-select company:', error);
          // Continue loading even if auto-selection fails
        }
      } else if (allUserCompanies.length > 1) {
        console.log('Multiple companies found, user will choose');
      } else {
        console.log('No companies found for user');
      }
    } catch (error) {
      console.error('Error loading user context:', error);
      // Don't re-throw - ensure auth loading completes
      setUserCompanies([]);
      setRespondentCompanies([]);
    }
  };

  const loadRespondents = async (companyId) => {
    try {
      const respondentsRef = collection(db, 'companies', companyId, 'respondents');
      const respondentsSnap = await getDocs(respondentsRef);
      const respondentsData = respondentsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setRespondents(respondentsData);
    } catch (error) {
      console.error('Error loading respondents:', error);
      setRespondents([]);
    }
  };

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Error signing in with Google:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  const updateCompanySettings = async (settings) => {
    if (!company) return;

    try {
      const companyRef = doc(db, 'companies', company.id);
      await updateDoc(companyRef, {
        ...settings,
        updatedAt: new Date(),
      });

      setCompany({ ...company, ...settings });
    } catch (error) {
      console.error('Error updating company settings:', error);
      throw error;
    }
  };

  const clearTwilioErrors = async () => {
    if (!company) return;

    try {
      const companyRef = doc(db, 'companies', company.id);
      await updateDoc(companyRef, {
        hasTwilioErrors: false,
        lastTwilioError: null,
        updatedAt: new Date(),
      });

      setCompany({
        ...company,
        hasTwilioErrors: false,
        lastTwilioError: null
      });
    } catch (error) {
      console.error('Error clearing Twilio errors:', error);
      throw error;
    }
  };

  const inviteRespondent = async (email) => {
    const isAdmin = company?.role === 'admin' || !company?.role; // Default to admin for existing users
    if (!company || !isAdmin) {
      throw new Error('Only admins can invite respondents');
    }

    // Validate Gmail email
    if (!email.endsWith('@gmail.com')) {
      throw new Error('Respondents must use Gmail addresses only');
    }

    try {
      const respondentRef = doc(db, 'companies', company.id, 'respondents', email);
      const invitationToken = Math.random().toString(36).substring(2, 15);

      const respondentData = {
        email,
        status: 'invited',
        invitedAt: new Date(),
        invitationToken,
        role: 'respondent',
        name: '',
        displayName: '',
        createdAt: new Date(),
      };

      await setDoc(respondentRef, respondentData);
      setRespondents(prev => [...prev, { id: email, ...respondentData }]);

      // Generate invitation URL
      const invitationUrl = `${window.location.origin}/invite?companyId=${company.id}&token=${invitationToken}`;

      console.log(`Invitation created for ${email} with token ${invitationToken}`);
      console.log(`Invitation URL: ${invitationUrl}`);

      return {
        ...respondentData,
        invitationUrl,
        invitationToken
      };
    } catch (error) {
      console.error('Error inviting respondent:', error);
      throw error;
    }
  };

  const removeRespondent = async (respondentId) => {
    const isAdmin = company?.role === 'admin' || !company?.role; // Default to admin for existing users
    if (!company || !isAdmin) {
      throw new Error('Only admins can remove respondents');
    }

    try {
      const respondentRef = doc(db, 'companies', company.id, 'respondents', respondentId);
      await deleteDoc(respondentRef);
      setRespondents(prev => prev.filter(r => r.id !== respondentId));
    } catch (error) {
      console.error('Error removing respondent:', error);
      throw error;
    }
  };

  const acceptInvitation = async (companyId, token) => {
    try {
      // Find the respondent by token
      const respondentsRef = collection(db, 'companies', companyId, 'respondents');
      const q = query(respondentsRef, where('invitationToken', '==', token));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        throw new Error('Invalid invitation token');
      }

      const respondentDoc = snapshot.docs[0];
      const respondentData = respondentDoc.data();

      // Update respondent status and link to current user
      await updateDoc(respondentDoc.ref, {
        status: 'active',
        acceptedAt: new Date(),
        userId: user?.uid, // Link to the accepting user
        name: user?.displayName || '',
        displayName: user?.displayName || '',
        isOnline: true, // Set as online when they accept invitation
        lastSeen: new Date(),
      });

      return {
        companyId,
        respondent: { id: respondentDoc.id, ...respondentData, status: 'active' }
      };
    } catch (error) {
      console.error('Error accepting invitation:', error);
      throw error;
    }
  };

  const selectCompanyContext = async (companyId, role) => {
    try {
      console.log('Selecting company context:', companyId, role);
      setSelectedCompanyId(companyId);
      setUserRole(role);

      // Load the selected company data
      const companyRef = doc(db, 'companies', companyId);
      const companySnap = await getDoc(companyRef);

      if (!companySnap.exists()) {
        console.error('Company not found:', companyId);
        throw new Error('Company not found');
      }

      const companyData = { id: companyId, ...companySnap.data() };
      console.log('Loaded company data:', companyData);

      // If user is admin, set them as online
      if (role === 'admin' && user) {
        console.log('Setting admin as online...');
        await updateDoc(companyRef, {
          adminOnline: true,
          adminLastSeen: new Date(),
        });
        companyData.adminOnline = true;
        companyData.adminLastSeen = new Date();
      }

      setCompany(companyData);

      // Load respondents if user is admin
      if (role === 'admin') {
        try {
          await loadRespondents(companyId);
        } catch (error) {
          console.error('Error loading respondents:', error);
          // Continue even if respondent loading fails
        }
      } else {
        setRespondents([]);
      }

      // Store selection in localStorage for persistence
      localStorage.setItem('selectedCompanyId', companyId);
      localStorage.setItem('userRole', role);

      return companyData;
    } catch (error) {
      console.error('Error selecting company context:', error);
      // For auto-selection during loading, don't throw - just log
      // This prevents loading from getting stuck
      if (error.message === 'Company not found') {
        console.error('Company not found during auto-selection, continuing...');
        return null;
      }
      throw error;
    }
  };

  const updateRespondentStatus = async (isOnline, wasPreviouslyOffline = false) => {
    if (!company || userRole !== 'respondent') return;

    try {
      console.log(`🔄 [${new Date().toISOString()}] Updating respondent status: ${user.email} -> ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

      // Find the respondent document for current user
      const respondentsRef = collection(db, 'companies', company.id, 'respondents');
      const q = query(respondentsRef, where('email', '==', user.email));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const respondentDoc = snapshot.docs[0];
        await updateDoc(respondentDoc.ref, {
          isOnline,
          lastSeen: new Date(),
        });

        // If coming online, turn off AI for assigned tickets and notify
        if (isOnline && wasPreviouslyOffline) {
          await turnOffAIForAssignedTickets();
        }

        console.log(`✅ Respondent status updated successfully for ${user.email}`);
      } else {
        console.log(`❌ Respondent document not found for ${user.email}`);
      }
    } catch (error) {
      console.error('❌ Error updating respondent status:', error);
    }
  };

  const turnOffAIForAssignedTickets = async () => {
    if (!company || userRole !== 'respondent') return;

    try {
      console.log(`🤖 Turning off AI for tickets assigned to ${user.email}`);

      // Find all tickets assigned to this respondent
      const ticketsRef = collection(db, 'companies', company.id, 'tickets');
      const assignedTicketsQuery = query(
        ticketsRef,
        where('assignedEmail', '==', user.email),
        where('status', 'in', ['open', 'pending'])
      );

      const assignedTicketsSnap = await getDocs(assignedTicketsQuery);

      for (const ticketDoc of assignedTicketsSnap.docs) {
        const ticketData = ticketDoc.data();

        // Turn off AI for this ticket
        await updateDoc(ticketDoc.ref, {
          aiEnabled: false,
          updatedAt: new Date(),
        });

        // Add a system message notifying about agent joining (if enabled)
        if (company.notifyAgentJoin !== false) {
          const systemMsgRef = ticketDoc.ref.collection('messages').doc(`system-agent-joined-${Date.now()}`);
          await systemMsgRef.set({
            from: "System",
            role: "system",
            body: `👋 Agent ${user.displayName || user.email.split('@')[0]} has joined the conversation. AI assistant is now offline.`,
            createdAt: new Date(),
          });
        }

        // Note: WhatsApp notifications will be sent by the backend when customer messages come in
        // This prevents sending duplicate notifications and ensures proper webhook flow

        console.log(`✅ Turned off AI for ticket ${ticketDoc.id}`);
      }

      console.log(`🤖 AI turned off for ${assignedTicketsSnap.size} assigned tickets`);
    } catch (error) {
      console.error('❌ Error turning off AI for assigned tickets:', error);
    }
  };

  const updateAdminStatus = async (isOnline) => {
    if (!company || userRole !== 'admin') return;

    try {
      console.log(`🔄 [${new Date().toISOString()}] Updating admin status: ${user.email} -> ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

      // Update admin online status in company document
      const companyRef = doc(db, 'companies', company.id);
      await updateDoc(companyRef, {
        adminOnline: isOnline,
        adminLastSeen: new Date(),
      });

      // Update local company state
      setCompany(prev => prev ? { ...prev, adminOnline: isOnline, adminLastSeen: new Date() } : null);

      console.log(`✅ Admin status updated successfully for ${user.email}`);
    } catch (error) {
      console.error('❌ Error updating admin status:', error);
    }
  };

  const getInvitationDetails = async (companyId, token) => {
    try {
      const respondentsRef = collection(db, 'companies', companyId, 'respondents');
      const q = query(respondentsRef, where('invitationToken', '==', token));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        throw new Error('Invalid invitation token');
      }

      const respondentDoc = snapshot.docs[0];
      const respondentData = respondentDoc.data();

      // Get company details
      const companyRef = doc(db, 'companies', companyId);
      const companySnap = await getDoc(companyRef);

      if (!companySnap.exists()) {
        throw new Error('Company not found');
      }

      const companyData = companySnap.data();

      return {
        company: { id: companyId, ...companyData },
        respondent: { id: respondentDoc.id, ...respondentData },
        isExpired: respondentData.status !== 'invited', // Already accepted or invalid
      };
    } catch (error) {
      console.error('Error getting invitation details:', error);
      throw error;
    }
  };

  const value = {
    user,
    company,
    respondents,
    userCompanies,
    respondentCompanies,
    selectedCompanyId,
    userRole,
    loading,
    contextLoading,
    signInWithGoogle,
    logout,
    updateCompanySettings,
    clearTwilioErrors,
    inviteRespondent,
    removeRespondent,
    acceptInvitation,
    getInvitationDetails,
    selectCompanyContext,
    updateRespondentStatus,
    updateAdminStatus,
    turnOffAIForAssignedTickets,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Helper function to get user initials
export function getUserInitials(name) {
  if (!name) return '';
  const parts = name.trim().split(' ');
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


