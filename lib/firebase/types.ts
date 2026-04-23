/**
 * M9 Unit 4: Phase 2 Firestore document shapes per DESIGN.md §4.1.
 *
 * Pure types — no runtime code, no 'use client', safely importable
 * from any component or server module.
 *
 * `SkinVariant` is re-exported from the canonical editor types so
 * both the paint pipeline and the Firestore layer speak the same
 * string union without introducing a second source of truth.
 */

import type { Timestamp } from 'firebase/firestore';

export type { SkinVariant } from '@/lib/editor/types';
import type { SkinVariant } from '@/lib/editor/types';

/**
 * `/users/{uid}` — Firestore document.
 *
 * Public-readable (Firestore rules §4.1). `skinCount` is a denormalized
 * counter maintained by a Cloud Function (Phase 2 post-M11); it must
 * not be updatable from the client (see firestore.rules).
 */
export type UserProfile = {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string | null;
  createdAt: Timestamp;
  skinCount: number;
};

/**
 * `/skins/{skinId}` — Firestore document. Public gallery entry.
 *
 * Storage URLs point at Supabase (not Firebase Storage); the three
 * URL fields cover the raw PNG, a thumbnail (for gallery rendering),
 * and a pre-rendered OG image for social shares.
 *
 * `likeCount` is maintained by a transaction (DESIGN §11.4); clients
 * cannot write to it directly (firestore.rules enforces).
 */
export type SharedSkin = {
  id: string;
  ownerUid: string;
  ownerUsername: string;
  name: string;
  variant: SkinVariant;
  storageUrl: string;
  thumbnailUrl: string;
  ogImageUrl: string;
  tags: string[];
  likeCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/**
 * `/likes/{likeId}` — Firestore document.
 *
 * `likeId` convention: `${skinId}_${uid}` so each (skin, user) pair
 * is uniquely addressable without needing a composite query. Writes
 * are gated by firestore.rules: only `request.auth.uid === uid`.
 */
export type Like = {
  skinId: string;
  uid: string;
  createdAt: Timestamp;
};
