/**
 * lib/firebase.js — Firebase client SDK init for PWA
 *
 * Uses NEXT_PUBLIC env vars.
 * Falls back to user-provided BYOK config stored in localStorage.
 *
 * Constitutional compliance: PRIVACY_ABSOLUTE
 *   - User's Firestore only
 *   - No cross-user reads
 */

import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

function getFirebaseConfig() {
  // BYOK: check localStorage for user-provided config
  if (typeof window !== "undefined") {
    const byok = localStorage.getItem("nl_firebase_config");
    if (byok) {
      try {
        return JSON.parse(byok);
      } catch {
        // Malformed — fall through to env vars
      }
    }
  }

  // Host defaults from env
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    authDomain: `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    storageBucket: `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.appspot.com`,
  };
}

let app;
let db;
let auth;

export function initFirebaseClient() {
  if (getApps().length === 0) {
    const config = getFirebaseConfig();
    app = initializeApp(config);
  } else {
    app = getApps()[0];
  }

  db = getFirestore(app);
  auth = getAuth(app);

  return { app, db, auth };
}

export function getDb() {
  if (!db) initFirebaseClient();
  return db;
}

export function getAuthClient() {
  if (!auth) initFirebaseClient();
  return auth;
}
