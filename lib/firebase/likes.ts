import 'server-only';

/**
 * M12 Unit 3: atomic like toggle.
 *
 * A toggle is one Firestore transaction:
 *   1. Read /likes/{skinId}_{uid}
 *   2a. If exists → delete it + decrement /skins/{skinId}.likeCount
 *   2b. If missing → create it + increment /skins/{skinId}.likeCount
 *
 * The transaction is the canonical pattern (COMPOUND M9) for counter
 * atomicity: two parallel toggles can't double-count because Firestore
 * re-runs the transaction on a read/write conflict.
 *
 * The doc ID convention `${skinId}_${uid}` is also enforced by
 * firestore.rules so a malformed client can't inflate its own counter.
 *
 * Runs via Admin SDK (bypasses rules) but still writes data that is
 * valid under the rules — defense in depth.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirebase } from './admin';

export type LikeToggleResult = {
  liked: boolean;
  likeCount: number;
};

export async function toggleLike(
  skinId: string,
  uid: string,
): Promise<LikeToggleResult> {
  const { db } = getAdminFirebase();
  const skinRef = db.collection('skins').doc(skinId);
  const likeRef = db.collection('likes').doc(`${skinId}_${uid}`);

  return db.runTransaction(async (tx) => {
    const [skinSnap, likeSnap] = await Promise.all([
      tx.get(skinRef),
      tx.get(likeRef),
    ]);

    if (!skinSnap.exists) {
      throw new Error('skin-not-found');
    }

    const current = skinSnap.data() ?? {};
    const rawCount = typeof current.likeCount === 'number' ? current.likeCount : 0;

    if (likeSnap.exists) {
      tx.delete(likeRef);
      tx.update(skinRef, { likeCount: FieldValue.increment(-1) });
      return {
        liked: false,
        likeCount: Math.max(0, rawCount - 1),
      };
    }

    tx.set(likeRef, {
      skinId,
      uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(skinRef, { likeCount: FieldValue.increment(1) });
    return {
      liked: true,
      likeCount: rawCount + 1,
    };
  });
}

/**
 * Server-side helper: resolve which skinIds in `skinIds` are liked by
 * `uid`. Caller supplies the (deduplicated) list; we fan out parallel
 * point reads on /likes/{skinId}_{uid}. One read per skin.
 *
 * Used by /api/skins/liked and (later) /api/gallery/liked for
 * rendering the initial filled-heart state.
 */
export async function readLikedSkinIds(
  skinIds: readonly string[],
  uid: string,
): Promise<string[]> {
  if (skinIds.length === 0) return [];
  const { db } = getAdminFirebase();
  const unique = Array.from(new Set(skinIds));
  const snaps = await Promise.all(
    unique.map((id) => db.collection('likes').doc(`${id}_${uid}`).get()),
  );
  const liked: string[] = [];
  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i].exists) liked.push(unique[i]);
  }
  return liked;
}
