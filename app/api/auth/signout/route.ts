import 'server-only';

/**
 * M10 Unit 1: POST /api/auth/signout
 *
 * Clears the session cookie and revokes the user's refresh tokens so
 * any other device that minted a session from the same ID token is
 * also signed out server-side. The cookie is deleted regardless of
 * whether revocation succeeded — a stale / invalid session must still
 * be cleaned up on the client.
 */

import { NextResponse } from 'next/server';

import { getAdminFirebase } from '@/lib/firebase/admin';

// Never cache signout responses — they mutate session state.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  try {
    // Read the cookie from the incoming request. Using the NextRequest
    // parameter isn't needed — Next 15 exposes the cookie via the
    // headers proxy, but the simplest portable read is via the
    // `cookies()` dynamic API. (See next/headers.)
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;

    if (sessionCookie !== undefined && sessionCookie.length > 0) {
      try {
        const { auth } = getAdminFirebase();
        const decoded = await auth.verifySessionCookie(sessionCookie);
        await auth.revokeRefreshTokens(decoded.sub);
      } catch {
        // Session already invalid — clearing the cookie is still
        // desirable. Swallow and continue.
      }
    }

    const response = NextResponse.json({ success: true });
    response.cookies.delete('session');
    return response;
  } catch (err) {
    console.error('signout route: unexpected failure', err);
    return NextResponse.json({ error: 'Sign out failed' }, { status: 500 });
  }
}
