"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);

        // Check if company exists, create if not
        const companyRef = doc(db, 'companies', firebaseUser.uid);
        const companySnap = await getDoc(companyRef);

        if (companySnap.exists()) {
          setCompany({ id: firebaseUser.uid, ...companySnap.data() });
        } else {
          // Create new company record
          const newCompany = {
            name: firebaseUser.displayName || 'New Company',
            email: firebaseUser.email,
            createdAt: new Date(),
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
            webhookUrl: '', // Will be set when configuring webhook
          };

          await setDoc(companyRef, newCompany);
          setCompany({ id: firebaseUser.uid, ...newCompany });
        }
      } else {
        setUser(null);
        setCompany(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

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

  const value = {
    user,
    company,
    loading,
    signInWithGoogle,
    logout,
    updateCompanySettings,
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

