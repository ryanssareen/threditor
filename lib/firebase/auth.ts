import 'server-only';

/**
 * M10 Unit 2: server-side session helpers.
 *
 * Server components, route handlers, and server actions call
 * `getServerSession()` to resolve the current user from the httpOnly
 * session cookie set by POST /api/auth/session.
 *
 * `verifySessionCookie(cookie, true)` passes `checkRevoked=true` so a
 * cookie minted before sign-out still returns null here (Admin SDK
 * checks `revokeRefreshTokens`'s timestamp against the cookie's
 * `authTime` claim).
 *
 * The module never throws for missing / expired / revoked cookies —
 * callers distinguish "anonymous" (return null) from "error" via the
 * `requireServerSession()` wrapper.
 */

import { cookies } from 'next/headers';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { getAdminFirebase } from './admin';

export type ServerSession = {
  uid: string;
  email?: string;
  emailVerified?: boolean;
};

export async function getServerSession(): Promise<ServerSession | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;
    if (sessionCookie === undefined || sessionCookie.length === 0) {
      return null;
    }
    const { auth } = getAdminFirebase();
    const decoded: DecodedIdToken = await auth.verifySessionCookie(
      sessionCookie,
      true, // checkRevoked
    );
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
    };
  } catch {
    // Expired, revoked, or malformed cookie: treat as anonymous.
    return null;
  }
}

/**
 * Throws when no session is present. Use this in server routes and
 * server components that MUST have an authenticated user — the
 * caller doesn't have to branch on null.
 */
export async function requireServerSession(): Promise<ServerSession> {
  const session = await getServerSession();
  if (session === null) {
    throw new Error('Unauthorized: No valid session');
  }
  return session;
}
