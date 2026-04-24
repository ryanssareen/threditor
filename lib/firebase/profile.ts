import 'server-only';

/**
 * M13 Unit 1: server-side profile queries.
 *
 * One lookup by `username` (Firestore auto-indexes single fields so
 * no composite index required for this half), then one secondary
 * query on `/skins` by `ownerUid` + `createdAt DESC` to render the
 * profile grid. The second query needs the (ownerUid, createdAt)
 * composite index declared in firestore.indexes.json.
 *
 * Both functions normalize Firestore data to plain POJOs (no Timestamp
 * instances) so the result can cross the Server → Client component
 * boundary without serialization warnings — same convention as
 * lib/firebase/gallery.ts.
 *
 * Used by `/app/u/[username]/page.tsx`.
 */

import type { GallerySkin } from './gallery';
import { getAdminFirebase } from './admin';

/** Max skins to render on a single profile page. Phase 3 adds pagination. */
export const PROFILE_PAGE_SIZE = 50;

/** Characters allowed in a username (must match defaultUsername + update rules). */
export const USERNAME_PATTERN = /^[a-z0-9_-]{3,30}$/;

export type ProfileUser = {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string | null;
  createdAtMs: number | null;
  skinCount: number;
};

type RawUser = {
  uid?: unknown;
  username?: unknown;
  displayName?: unknown;
  photoURL?: unknown;
  skinCount?: unknown;
  createdAt?: { toDate?: () => Date } | null | undefined;
};

function normalizeUser(raw: RawUser): ProfileUser | null {
  if (
    typeof raw.uid !== 'string' ||
    typeof raw.username !== 'string' ||
    typeof raw.displayName !== 'string'
  ) {
    return null;
  }
  const createdAtMs =
    raw.createdAt !== null &&
    raw.createdAt !== undefined &&
    typeof raw.createdAt.toDate === 'function'
      ? raw.createdAt.toDate().getTime()
      : null;
  return {
    uid: raw.uid,
    username: raw.username,
    displayName: raw.displayName,
    photoURL: typeof raw.photoURL === 'string' ? raw.photoURL : null,
    createdAtMs,
    skinCount: typeof raw.skinCount === 'number' ? raw.skinCount : 0,
  };
}

/**
 * Look up a user by `username`. Returns null when no match — the
 * caller (profile page) turns that into a 404.
 *
 * Case handling: usernames are stored lowercase (see `defaultUsername`
 * in lib/firebase/skins.ts and the edit route's validation). We
 * lowercase the input here so `/u/UserName` and `/u/username` both
 * resolve the same doc without a second where-clause.
 *
 * Back-compat fallback: pre-M13 rows bootstrapped `users.username`
 * from `defaultUsername(uid)` (e.g. `user-abc123...`) even though the
 * skins they published were denormalised with the email-prefix
 * `ownerUsername`. The gallery now links to `/u/{ownerUsername}`, so a
 * direct username lookup would miss for any pre-M13 user. On miss we
 * do ONE secondary read: find a skin doc with that `ownerUsername`,
 * take its `ownerUid`, and point-load the user doc. The result is
 * correct in both worlds and costs at most 2 extra reads on the slow
 * path (never on the hot path).
 *
 * Cost: 1 read on the common path; up to 3 reads on the fallback path.
 */
export async function getUserByUsername(
  username: string,
): Promise<ProfileUser | null> {
  if (!USERNAME_PATTERN.test(username.toLowerCase())) return null;
  const lower = username.toLowerCase();
  const { db } = getAdminFirebase();

  const direct = await db
    .collection('users')
    .where('username', '==', lower)
    .limit(1)
    .get();
  if (!direct.empty) {
    return normalizeUser(direct.docs[0].data() as RawUser);
  }

  // Fallback: resolve via a published skin's denormalised
  // `ownerUsername`. Single-field indexed, no composite index needed.
  const skinSnap = await db
    .collection('skins')
    .where('ownerUsername', '==', username)
    .limit(1)
    .get();
  if (skinSnap.empty) return null;
  const ownerUid = (skinSnap.docs[0].data() as { ownerUid?: unknown }).ownerUid;
  if (typeof ownerUid !== 'string') return null;
  const userSnap = await db.collection('users').doc(ownerUid).get();
  if (!userSnap.exists) return null;
  return normalizeUser(userSnap.data() as RawUser);
}

/**
 * Get up to {@link PROFILE_PAGE_SIZE} skins for a user, newest first.
 * Needs the (ownerUid ASC, createdAt DESC) composite index.
 *
 * Shape matches GallerySkin so the same SkinCard component renders
 * gallery + profile grids without a second normalization pass.
 */
export async function getSkinsByOwner(uid: string): Promise<GallerySkin[]> {
  const { db } = getAdminFirebase();
  const snap = await db
    .collection('skins')
    .where('ownerUid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(PROFILE_PAGE_SIZE)
    .get();
  const skins: GallerySkin[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown> & {
      createdAt?: { toDate?: () => Date } | null;
    };
    if (
      typeof data.ownerUid !== 'string' ||
      typeof data.ownerUsername !== 'string' ||
      typeof data.name !== 'string' ||
      typeof data.storageUrl !== 'string'
    ) {
      continue;
    }
    const variant: 'classic' | 'slim' =
      data.variant === 'slim' ? 'slim' : 'classic';
    const createdAtMs =
      data.createdAt !== null &&
      data.createdAt !== undefined &&
      typeof data.createdAt.toDate === 'function'
        ? data.createdAt.toDate().getTime()
        : 0;
    skins.push({
      id: doc.id,
      ownerUid: data.ownerUid,
      ownerUsername: data.ownerUsername,
      name: data.name,
      variant,
      storageUrl: data.storageUrl,
      thumbnailUrl:
        typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : data.storageUrl,
      ogImageUrl: typeof data.ogImageUrl === 'string' ? data.ogImageUrl : null,
      tags: Array.isArray(data.tags)
        ? data.tags.filter((t): t is string => typeof t === 'string')
        : [],
      likeCount: typeof data.likeCount === 'number' ? data.likeCount : 0,
      createdAtMs,
    });
  }
  return skins;
}

/**
 * Sum `likeCount` across a skin list. Firestore has no SUM aggregation
 * on Spark so we compute client-side (the cost is in getSkinsByOwner
 * already — this is an O(n) fold, not a second query).
 */
export function computeTotalLikes(skins: readonly GallerySkin[]): number {
  let total = 0;
  for (const s of skins) total += s.likeCount;
  return total;
}

/**
 * Reserved usernames that can never be claimed (collide with routes
 * or have admin connotations). The list is intentionally short — we
 * block route-colliders + a few high-value namespaces. Expand as new
 * routes land.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'api',
  'editor',
  'gallery',
  'login',
  'logout',
  'profile',
  'root',
  'settings',
  'signin',
  'signout',
  'signup',
  'skin',
  'u',
  'user',
  'users',
]);

/**
 * Display-name validation. Looser than username: allows Unicode,
 * just caps length and trims edges. React auto-escapes on render so
 * no XSS risk from storing the trimmed string as-is.
 */
export function validateDisplayName(
  raw: unknown,
): { ok: true; displayName: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Display name is required' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Display name is required' };
  }
  if (trimmed.length > 50) {
    return { ok: false, error: 'Display name must be ≤ 50 characters' };
  }
  // Block control chars + line breaks (they'd break single-line rendering).
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, error: 'Display name contains invalid characters' };
  }
  return { ok: true, displayName: trimmed };
}
