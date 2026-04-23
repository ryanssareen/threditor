'use client';

/**
 * M9 Unit 1: Firebase client SDK — browser-only.
 *
 * Singleton pattern: `initializeApp` is called at most once per page
 * lifetime. Subsequent `getFirebase()` calls return the memoized
 * `{ app, auth, db }` trio.
 *
 * Env vars are `NEXT_PUBLIC_*` so Next.js inlines them into the client
 * bundle at build time. Missing vars throw at first call (dev surfaces
 * the error during bootstrap; prod returns undefined which the SDK
 * rejects).
 *
 * Do NOT import this module from a server component, API route, or
 * Admin SDK call site. The `'use client'` directive enforces the
 * browser boundary at build time.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

function readFirebaseConfig(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
} {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  };
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function getFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  // Reuse any existing app (Next.js Fast Refresh + HMR can re-execute
  // this module; getApps() is the canonical "already initialized" check
  // per Firebase SDK docs). Config is read at init-time (not module-
  // load time) so env-var changes between test runs are honored.
  if (app === null) {
    const existing = getApps();
    app = existing.length > 0 ? existing[0] : initializeApp(readFirebaseConfig());
  }
  if (auth === null) auth = getAuth(app);
  if (db === null) db = getFirestore(app);
  return { app, auth, db };
}

/** Test-only: reset the module-scope singletons. */
export function __resetFirebaseForTest(): void {
  app = null;
  auth = null;
  db = null;
}
