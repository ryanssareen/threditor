import 'server-only';

/**
 * M11 Unit 4: atomic skin + user write.
 *
 * Writes two docs in one Admin-SDK WriteBatch:
 *   /skins/{skinId}      — new SharedSkin
 *   /users/{uid}         — merge: { skinCount: increment(1), ... }
 *
 * Using WriteBatch (not Transaction) because neither write reads the
 * other — skinId is caller-provided, skinCount uses the increment
 * sentinel which is lock-free. Batch is lighter.
 *
 * The /users doc is created-if-missing via merge:true with default
 * createdAt + username. First-time publishers get their profile
 * bootstrapped here; returning publishers only get the skinCount bump.
 *
 * Bypasses firestore.rules because Admin SDK always does. The invariants
 * that firestore.rules enforces (ownerUid == auth.uid, likeCount == 0,
 * tags.size() <= 8) are honored by the data we write.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirebase } from './admin';

export type CreateSkinInput = {
  skinId: string;
  uid: string;
  ownerUsername: string;
  name: string;
  variant: 'classic' | 'slim';
  storageUrl: string;
  thumbnailUrl: string;
  ogImageUrl: string | null;
  tags: string[];
};

export type CreateSkinResult = {
  skinId: string;
};

/**
 * Generate a default username from a uid. Used for first-time
 * publishers who don't yet have a /users/{uid} document. Collision
 * space is ≈ 36^12 ≈ 5 × 10^18 — astronomically safe for our scale.
 */
export function defaultUsername(uid: string): string {
  // Hash-ish: take first 12 chars of lowercased uid with non-alnum stripped.
  const slug = uid.toLowerCase().replace(/[^0-9a-z]/g, '').slice(0, 12);
  return `user-${slug}`;
}

export async function createSkinDoc(
  input: CreateSkinInput,
): Promise<CreateSkinResult> {
  const { db } = getAdminFirebase();
  const skinRef = db.collection('skins').doc(input.skinId);
  const userRef = db.collection('users').doc(input.uid);

  const now = FieldValue.serverTimestamp();

  const skinDoc = {
    id: input.skinId,
    ownerUid: input.uid,
    ownerUsername: input.ownerUsername,
    name: input.name,
    variant: input.variant,
    storageUrl: input.storageUrl,
    thumbnailUrl: input.thumbnailUrl,
    // Firestore treats `undefined` as an error. Use explicit null for
    // missing OG so M12 gallery's `ogImageUrl ?? thumbnailUrl` fallback
    // is unambiguous.
    ogImageUrl: input.ogImageUrl,
    tags: input.tags,
    likeCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  // merge:true creates /users/{uid} if missing, preserves existing
  // fields otherwise. createdAt is inside the merge payload — when the
  // doc already exists, Firestore's merge semantics will overwrite
  // createdAt with today's timestamp (see plan §Risks row 6). To avoid
  // that, we write createdAt on initial create only — but merge can't
  // conditionally-skip fields. Trade-off: use a separate, idempotent
  // shape that uses FieldValue.serverTimestamp() but relies on our
  // own read-then-set to avoid clobbering. Simpler alternative: always
  // bump skinCount + username + ownerSince via merge, and use a
  // separate client-side "joined date" display at M13 that reads the
  // /users doc's `firstSkinAt` which we ONLY ever write inline with
  // the first skin. Done via the conditional below.
  const userPayload: Record<string, unknown> = {
    uid: input.uid,
    skinCount: FieldValue.increment(1),
  };

  // Check if the user doc already exists so we only bootstrap the
  // profile on first publish. One extra read per publish — acceptable
  // cost (< 1 ms) to keep the createdAt invariant stable.
  //
  // M13: bootstrap `username` from the SAME value we denormalise onto
  // /skins/{id}.ownerUsername. Previously these drifted (username was
  // always `user-<hash>` from defaultUsername while ownerUsername came
  // from the email prefix), which broke the /u/[username] lookup —
  // the gallery linked to `/u/ryansareen` but the users collection only
  // had a doc under `user-abc...`. If the incoming `ownerUsername`
  // doesn't validate against USERNAME_PATTERN (e.g. has uppercase, a
  // dot, or is too short/long), we fall back to `defaultUsername(uid)`
  // so the invariant "/users/{uid}.username matches USERNAME_PATTERN"
  // is never violated. The skin doc keeps whatever `ownerUsername` it
  // was handed; if that drifts from the canonical username after a
  // future rename, we take the stale display on cards but the /u/...
  // URL always resolves.
  const existing = await userRef.get();
  if (!existing.exists) {
    const lowerOwner = input.ownerUsername.toLowerCase();
    const canonicalUsername = /^[a-z0-9_-]{3,30}$/.test(lowerOwner)
      ? lowerOwner
      : defaultUsername(input.uid);
    userPayload.username = canonicalUsername;
    userPayload.displayName = input.ownerUsername;
    userPayload.photoURL = null;
    userPayload.createdAt = now;
  }

  const batch = db.batch();
  batch.set(skinRef, skinDoc);
  batch.set(userRef, userPayload, { merge: true });
  await batch.commit();

  return { skinId: input.skinId };
}
