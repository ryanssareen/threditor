import 'server-only';

/**
 * M10 Unit 1: POST /api/auth/session
 *
 * Client posts a Firebase ID token; server verifies it and mints an
 * httpOnly session cookie. The client remains signed in via Firebase
 * SDK (for realtime + Firestore rules); server-side auth uses this
 * cookie (for SSR + server-only writes).
 *
 * Security properties:
 *   - httpOnly: JS cannot read the cookie (XSS mitigation)
 *   - secure in production: HTTPS-only transport
 *   - sameSite: 'lax': CSRF mitigation while permitting top-level nav
 *   - 5-day TTL matches Firebase's default session cookie lifetime
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getAdminFirebase } from '@/lib/firebase/admin';

const SESSION_DURATION_MS = 60 * 60 * 24 * 5 * 1000; // 5 days
const REQUIRED_ENV = [
  'FIREBASE_ADMIN_PROJECT_ID',
  'FIREBASE_ADMIN_CLIENT_EMAIL',
  'FIREBASE_ADMIN_PRIVATE_KEY',
] as const;

function validateEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    validateEnv();

    const body: unknown = await req.json();
    const idToken =
      typeof body === 'object' &&
      body !== null &&
      'idToken' in body &&
      typeof (body as { idToken: unknown }).idToken === 'string'
        ? (body as { idToken: string }).idToken
        : null;

    if (idToken === null || idToken.length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid idToken' },
        { status: 400 },
      );
    }

    const { auth } = getAdminFirebase();

    // Verify first so an expired / forged token fails loudly before
    // we call createSessionCookie (which also verifies but returns a
    // less-specific error).
    await auth.verifyIdToken(idToken);

    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION_MS,
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set('session', sessionCookie, {
      maxAge: SESSION_DURATION_MS / 1000, // cookies take seconds
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return response;
  } catch (err) {
    // Flatten the error into a single log string so Vercel's log
    // viewer doesn't truncate the diagnostic detail. Firebase Admin
    // Auth surfaces useful codes like auth/argument-error (PEM bad),
    // auth/id-token-expired, auth/project-not-found (env vars
    // mismatch client project), auth/invalid-credential, etc.
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'unknown';
    const message =
      err instanceof Error ? err.message : String(err);
    console.error(
      `session route: auth failed code=${code} message=${message.slice(0, 300)}`,
    );
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 401 },
    );
  }
}
