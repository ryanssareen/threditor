import 'server-only';

/**
 * M12 Unit 3: POST /api/skins/[skinId]/like — toggle.
 *
 * Auth: Bearer token (primary) or session cookie (fallback), same
 * pattern as /api/skins/publish. A toggle is a single Firestore
 * transaction (lib/firebase/likes.ts#toggleLike).
 *
 * Response body: { liked: boolean, likeCount: number } — the client
 * uses this to reconcile its optimistic state (SkinCard `handleLike`).
 *
 * Node runtime only (firebase-admin).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getServerSession } from '@/lib/firebase/auth';
import { toggleLike } from '@/lib/firebase/likes';

function privateJson(body: unknown, status: number): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
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

type RouteContext = {
  params: Promise<{ skinId: string }>;
};

export async function POST(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  try {
    const { skinId } = await ctx.params;
    if (!/^[a-z0-9-]{10,64}$/i.test(skinId)) {
      return privateJson({ error: 'Invalid skinId' }, 400);
    }

    const uid = await resolveUid(req);
    if (uid === null) {
      return privateJson({ error: 'Sign in to like skins' }, 401);
    }

    const result = await toggleLike(skinId, uid);
    return privateJson(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
    if (message === 'skin-not-found') {
      return privateJson({ error: 'Skin no longer exists' }, 404);
    }
    console.error(`like: toggle failed message=${message}`);
    return privateJson({ error: 'Could not update like' }, 500);
  }
}
