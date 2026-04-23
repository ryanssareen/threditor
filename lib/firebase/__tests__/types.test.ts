// @vitest-environment jsdom
//
// M9 Unit 4 — Firestore type shape tests.
// Mostly compile-time verification; the runtime assertions just
// confirm the expected fields are reachable without TS complaining.

import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';

import type { Like, SharedSkin, UserProfile } from '../types';

describe('Firebase Types', () => {
  it('UserProfile has the required fields', () => {
    const profile: UserProfile = {
      uid: 'test-uid',
      username: 'testuser',
      displayName: 'Test User',
      photoURL: null,
      createdAt: Timestamp.now(),
      skinCount: 0,
    };
    expect(profile.uid).toBe('test-uid');
    expect(profile.photoURL).toBeNull();
    expect(profile.skinCount).toBe(0);
  });

  it('SharedSkin has storage URLs + tags + counts', () => {
    const skin: SharedSkin = {
      id: 'skin-123',
      ownerUid: 'user-abc',
      ownerUsername: 'bob',
      name: 'Cool Skin',
      variant: 'classic',
      storageUrl:
        'https://stub.supabase.co/storage/v1/object/public/skins/user-abc/skin-123.png',
      thumbnailUrl: 'https://stub.supabase.co/.../thumb.png',
      ogImageUrl: 'https://stub.supabase.co/.../og.webp',
      tags: ['hoodie', 'blue'],
      likeCount: 5,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    expect(skin.variant).toBe('classic');
    expect(skin.tags.length).toBe(2);
    expect(skin.likeCount).toBe(5);
  });

  it('SharedSkin.variant accepts slim', () => {
    const skin: SharedSkin = {
      id: 'skin-456',
      ownerUid: 'user-xyz',
      ownerUsername: 'alice',
      name: 'Slim Variant',
      variant: 'slim',
      storageUrl: '',
      thumbnailUrl: '',
      ogImageUrl: '',
      tags: [],
      likeCount: 0,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    expect(skin.variant).toBe('slim');
  });

  it('Like round-trips skinId + uid + createdAt', () => {
    const like: Like = {
      skinId: 'skin-123',
      uid: 'user-abc',
      createdAt: Timestamp.now(),
    };
    expect(like.skinId).toBe('skin-123');
    expect(like.uid).toBe('user-abc');
    expect(like.createdAt).toBeInstanceOf(Timestamp);
  });
});
