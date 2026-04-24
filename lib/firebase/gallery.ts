import 'server-only';

/**
 * M12 Unit 2: server-side gallery query.
 *
 * Reads up to 60 skin docs ordered by either `createdAt` (newest) or
 * `likeCount` (popular). Used by the ISR gallery route handler.
 *
 * Per M12 constraint #4 tag filtering is NOT applied server-side —
 * cards are rendered for every fetched skin and the client hides the
 * ones that don't match the active tag. That keeps the read count
 * constant no matter how many tags exist (60 reads per revalidation,
 * one revalidation every 60s → worst case 86400 reads/day, well under
 * the Spark 50K/day ceiling even if ISR somehow fires every request,
 * which it doesn't).
 *
 * Returns a plain-data shape (no Firestore Timestamps) so it can
 * cross the Server Component → Client Component boundary without
 * serialization warnings.
 */

import { getAdminFirebase } from './admin';

export type GallerySort = 'newest' | 'popular';

export const GALLERY_PAGE_SIZE = 60;

export type GallerySkin = {
  id: string;
  ownerUid: string;
  ownerUsername: string;
  name: string;
  variant: 'classic' | 'slim';
  storageUrl: string;
  thumbnailUrl: string;
  ogImageUrl: string | null;
  tags: string[];
  likeCount: number;
  createdAtMs: number;
};

type RawSkin = Partial<Omit<GallerySkin, 'createdAtMs'>> & {
  createdAt?: { toDate?: () => Date } | null;
};

function normalize(raw: RawSkin, id: string): GallerySkin | null {
  if (
    typeof raw.ownerUid !== 'string' ||
    typeof raw.ownerUsername !== 'string' ||
    typeof raw.name !== 'string' ||
    typeof raw.storageUrl !== 'string'
  ) {
    return null;
  }
  const variant: 'classic' | 'slim' =
    raw.variant === 'slim' ? 'slim' : 'classic';
  const createdAtMs =
    raw.createdAt !== null &&
    raw.createdAt !== undefined &&
    typeof raw.createdAt.toDate === 'function'
      ? raw.createdAt.toDate().getTime()
      : 0;
  return {
    id,
    ownerUid: raw.ownerUid,
    ownerUsername: raw.ownerUsername,
    name: raw.name,
    variant,
    storageUrl: raw.storageUrl,
    thumbnailUrl: raw.thumbnailUrl ?? raw.storageUrl,
    ogImageUrl: raw.ogImageUrl ?? null,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === 'string')
      : [],
    likeCount: typeof raw.likeCount === 'number' ? raw.likeCount : 0,
    createdAtMs,
  };
}

export async function queryGallery(
  sort: GallerySort,
): Promise<GallerySkin[]> {
  const { db } = getAdminFirebase();
  // Popular uses createdAt as a tie-breaker so skins with identical
  // likeCount render in a deterministic (newest-first) order. This is
  // what the composite index in firestore.indexes.json is for —
  // without it the Firestore engine rejects the multi-orderBy query.
  const base = db.collection('skins');
  const q =
    sort === 'popular'
      ? base.orderBy('likeCount', 'desc').orderBy('createdAt', 'desc')
      : base.orderBy('createdAt', 'desc');
  const snap = await q.limit(GALLERY_PAGE_SIZE).get();
  const skins: GallerySkin[] = [];
  for (const doc of snap.docs) {
    const row = normalize(doc.data() as RawSkin, doc.id);
    if (row !== null) skins.push(row);
  }
  return skins;
}
