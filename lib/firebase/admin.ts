/**
 * M9 Unit 2: Firebase Admin SDK — server-only.
 *
 * NO `'use client'` directive. This module must never be imported
 * into a client component, route handler that runs in the Edge
 * runtime, or any browser-bundle path. Admin SDK requires Node.js
 * APIs and the service-account private key.
 *
 * Env vars (NOT NEXT_PUBLIC_ prefixed):
 *   - FIREBASE_ADMIN_PROJECT_ID
 *   - FIREBASE_ADMIN_CLIENT_EMAIL
 *   - FIREBASE_ADMIN_PRIVATE_KEY  (with literal \n → actual newlines)
 *
 * The private-key `\\n → \n` replace is required because Vercel and
 * most secret stores encode multi-line PEM values as a single line
 * with escaped newlines; the Admin SDK's `cert()` needs real newlines
 * in the PEM body.
 */

import {
  cert,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

function readAdminConfig(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} {
  const raw = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? '';
  // Vercel + most secret stores encode PEM newlines as literal \n;
  // Admin SDK's cert() needs actual newlines in the key body.
  const privateKey = raw.replace(/\\n/g, '\n');
  return {
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID ?? '',
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? '',
    privateKey,
  };
}

let app: App | null = null;
let adminAuth: Auth | null = null;
let adminDb: Firestore | null = null;

export function getAdminFirebase(): { app: App; auth: Auth; db: Firestore } {
  if (app === null) {
    const existing = getApps();
    app =
      existing.length > 0
        ? (existing[0] as App)
        : initializeApp({ credential: cert(readAdminConfig()) });
  }
  if (adminAuth === null) adminAuth = getAuth(app);
  if (adminDb === null) adminDb = getFirestore(app);
  return { app, auth: adminAuth, db: adminDb };
}

/** Test-only: reset the module-scope singletons. */
export function __resetAdminFirebaseForTest(): void {
  app = null;
  adminAuth = null;
  adminDb = null;
}
