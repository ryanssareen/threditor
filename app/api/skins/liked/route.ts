import 'server-only';

/**
 * M12 Unit 3: POST /api/skins/liked — resolve which of N skinIds the
 * current user has liked.
 *
 * The gallery renders up to 60 cards at once; the hearts need a
 * filled-state hint for the signed-in user without forcing the whole
 * gallery page to become dynamic (ISR is `force-static` + 60 s
 * revalidate, M12 constraint #1). Solution: the grid fetches the liked
 * set from this route on mount and applies it client-side.
 *
 * Body: { skinIds: string[] } (max 60).
 * Response: { likedSkinIds: string[] }.
 *
 * Node runtime only.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getServerSession } from '@/lib/firebase/auth';
import { readLikedSkinIds } from '@/lib/firebase/likes';

const MAX_SKIN_IDS = 60;

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const uid = await resolveUid(req);
    if (uid === null) {
      return privateJson({ likedSkinIds: [] }, 200);
    }

    const body = (await req.json().catch(() => null)) as
      | { skinIds?: unknown }
      | null;
    if (body === null || !Array.isArray(body.skinIds)) {
      return privateJson({ error: 'skinIds must be an array' }, 400);
    }

    const skinIds = body.skinIds.filter(
      (s): s is string => typeof s === 'string' && /^[a-z0-9-]{10,64}$/i.test(s),
    );
    if (skinIds.length > MAX_SKIN_IDS) {
      return privateJson(
        { error: `skinIds must be ≤ ${MAX_SKIN_IDS}` },
        400,
      );
    }

    const liked = await readLikedSkinIds(skinIds, uid);
    return privateJson({ likedSkinIds: liked }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
    console.error(`liked: failed message=${msg}`);
    return privateJson({ error: 'Could not resolve liked skins' }, 500);
  }
}
