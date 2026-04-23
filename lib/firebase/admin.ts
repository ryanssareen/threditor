/**
 * M9 Unit 2: Firebase Admin SDK — server-only.
 *
 * NO `'use client'` directive. This module must never be imported
 * into a client component, route handler that runs in the Edge
 * runtime, or any browser-bundle path. Admin SDK requires Node.js
 * APIs and the service-account private key.
 *
 * The `import 'server-only'` below is the compile-time guard: any
 * client-bundle path that transitively imports this file fails the
 * Next.js build. Adding the guard at scaffolding time (before any
 * consumer exists) avoids relying on future reviewers to catch it.
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

import 'server-only';

import {
  cert,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Normalize a PEM private key pulled from an env var.
 *
 * Vercel / secret stores mangle multi-line PEMs several ways; OpenSSL 3
 * (Node 18+) is strict about format and fails with
 * `error:1E08010C:DECODER routines::unsupported` on the slightest
 * deviation. We defensively:
 *   1. Strip surrounding single/double quotes (pasted-with-quotes).
 *   2. Convert literal `\n` sequences to real newlines.
 *   3. Normalize CRLF → LF.
 *   4. Ensure a trailing newline after `-----END PRIVATE KEY-----`.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  // Strip a single pair of wrapping quotes if present.
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  // Escaped → real newlines.
  key = key.replace(/\\n/g, '\n');
  // CRLF → LF.
  key = key.replace(/\r\n/g, '\n');
  // Ensure trailing newline (PEM spec).
  if (!key.endsWith('\n')) key = key + '\n';
  return key;
}

function readAdminConfig(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} {
  const raw = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? '';
  return {
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID ?? '',
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? '',
    privateKey: normalizePrivateKey(raw),
  };
}

/**
 * Returns a shape-only diagnostic about the configured private key —
 * never includes key material. Safe to return in an error response so
 * we can diagnose mis-pasted keys without leaking secrets.
 */
export function getPrivateKeyShape(): {
  length: number;
  hasBeginMarker: boolean;
  hasEndMarker: boolean;
  hasRealNewlines: boolean;
  hasEscapedNewlines: boolean;
  hasSurroundingQuotes: boolean;
  endsWithNewline: boolean;
} {
  const raw = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? '';
  const trimmed = raw.trim();
  return {
    length: raw.length,
    hasBeginMarker: raw.includes('-----BEGIN PRIVATE KEY-----'),
    hasEndMarker: raw.includes('-----END PRIVATE KEY-----'),
    hasRealNewlines: raw.includes('\n'),
    hasEscapedNewlines: raw.includes('\\n'),
    hasSurroundingQuotes:
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")),
    endsWithNewline: raw.endsWith('\n'),
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
        ? existing[0]
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
