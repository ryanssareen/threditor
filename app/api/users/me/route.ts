import 'server-only';

/**
 * M13 Unit 5: PATCH /api/users/me — update the signed-in user's
 * display name.
 *
 * Scope: display name only. The `username` field is immutable in M13
 * because changing it would require a batch update of every
 * `/skins/{id}.ownerUsername` field (denormalised on write). Phase 3
 * moves that to a Cloud Function on the Blaze plan.
 *
 * Auth: bearer token or session cookie (same pattern as the M12 like
 * route — bearer preferred, cookie fallback for SSR-rendered pages).
 *
 * Response: { displayName } on success, { error } on 4xx/5xx.
 * Cache-Control: private, no-store (this is per-user mutation).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';

import { getServerSession } from '@/lib/firebase/auth';
import { validateDisplayName } from '@/lib/firebase/profile';

function privateJson(body: unknown, status: number): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set(
    'Cache-Control',
    'private, no-store, no-cache, must-revalidate',
  );
  return res;
}

async function resolveUid(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (bearer !== null) {
    try {
      const { auth } = (await import('@/lib/firebase/admin')).getAdminFirebase();
      const decoded = await auth.verifyIdToken(bearer[1]);
      return decoded.uid;
    } catch {
      return null;
    }
  }
  const session = await getServerSession();
  return session?.uid ?? null;
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const uid = await resolveUid(req);
    if (uid === null) {
      return privateJson({ error: 'Sign in to update your profile' }, 401);
    }

    const body = (await req.json().catch(() => null)) as
      | { displayName?: unknown }
      | null;
    if (body === null) {
      return privateJson({ error: 'Invalid JSON body' }, 400);
    }

    const nameResult = validateDisplayName(body.displayName);
    if (!nameResult.ok) {
      return privateJson({ error: nameResult.error }, 400);
    }

    const { db } = (await import('@/lib/firebase/admin')).getAdminFirebase();
    const userRef = db.collection('users').doc(uid);
    const existing = await userRef.get();
    if (!existing.exists) {
      // First-time writers (no /users doc yet because they haven't
      // published) can still set a display name. We bootstrap a
      // minimal doc here — the publish flow will later merge skinCount
      // and other fields without clobbering what we wrote.
      return privateJson(
        { error: 'Publish at least one skin before updating your profile' },
        404,
      );
    }

    await userRef.set(
      {
        displayName: nameResult.displayName,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return privateJson({ displayName: nameResult.displayName }, 200);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
    console.error(`users/me: update failed message=${msg}`);
    return privateJson({ error: 'Could not update profile' }, 500);
  }
}
