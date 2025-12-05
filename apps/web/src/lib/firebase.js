// apps/web/lib/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase configuration - using direct values for immediate functionality
const firebaseConfig = {
  apiKey: "AIzaSyA-44DQ0o492HsxqDkH6kvy6H08OMMBNMU",
  authDomain: "axion256system.firebaseapp.com",
  projectId: "axion256system",
  storageBucket: "axion256system.firebasestorage.app",
  messagingSenderId: "718860459380",
  appId: "1:718860459380:web:275f372555ebb726f12021",
  measurementId: "G-QTBDXPXRY4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { auth, db, googleProvider };
