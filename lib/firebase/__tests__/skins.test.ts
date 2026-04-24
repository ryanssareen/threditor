// @vitest-environment node
//
// M11 Unit 4 — Firestore skin writer.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Hoisted mocks for the Admin SDK.
const skinSet = vi.hoisted(() => vi.fn());
const userSet = vi.hoisted(() => vi.fn());
const batchCommit = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const userGet = vi.hoisted(() => vi.fn());
const serverTimestampSentinel = vi.hoisted(() => ({ __sentinel: 'serverTimestamp' }));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n: number) => ({ __sentinel: 'increment', value: n }),
    serverTimestamp: () => serverTimestampSentinel,
  },
}));

vi.mock('../admin', () => ({
  getAdminFirebase: () => ({
    db: {
      collection: (col: string) => ({
        doc: (id: string) => ({
          __collection: col,
          __id: id,
          get: userGet,
        }),
      }),
      batch: () => ({
        set: (ref: { __collection: string }, data: unknown, options?: unknown) => {
          if (ref.__collection === 'skins') {
            skinSet(ref, data, options);
          } else if (ref.__collection === 'users') {
            userSet(ref, data, options);
          }
        },
        commit: batchCommit,
      }),
    },
  }),
}));

import { createSkinDoc, defaultUsername } from '../skins';

const VALID_INPUT = {
  skinId: 'skin-abc',
  uid: 'user-123',
  ownerUsername: 'alice',
  name: 'Cool Skin',
  variant: 'classic' as const,
  storageUrl: 'https://stub/skins/user-123/skin-abc.png',
  thumbnailUrl: 'https://stub/skins/user-123/skin-abc.png',
  ogImageUrl: 'https://stub/skins/user-123/skin-abc-og.webp',
  tags: ['cool', 'blue'],
};

beforeEach(() => {
  vi.clearAllMocks();
  skinSet.mockReset();
  userSet.mockReset();
  batchCommit.mockReset();
  batchCommit.mockResolvedValue(undefined);
  userGet.mockReset();
});

describe('defaultUsername', () => {
  it('slugs a normal uid', () => {
    expect(defaultUsername('AbC123XyZ987Extra')).toBe('user-abc123xyz987');
  });

  it('strips non-alphanumeric characters', () => {
    expect(defaultUsername('a-b-c-d-e-f-g-h-i')).toBe('user-abcdefghi');
  });
});

describe('createSkinDoc', () => {
  it('happy path: first publish — bootstraps /users/{uid} with defaults', async () => {
    userGet.mockResolvedValue({ exists: false });
    const r = await createSkinDoc(VALID_INPUT);

    expect(r.skinId).toBe('skin-abc');
    expect(skinSet).toHaveBeenCalledTimes(1);
    const skinArgs = skinSet.mock.calls[0];
    expect(skinArgs[1]).toMatchObject({
      id: 'skin-abc',
      ownerUid: 'user-123',
      ownerUsername: 'alice',
      name: 'Cool Skin',
      variant: 'classic',
      likeCount: 0,
      tags: ['cool', 'blue'],
    });
    expect(skinArgs[1].createdAt).toBe(serverTimestampSentinel);
    expect(skinArgs[1].updatedAt).toBe(serverTimestampSentinel);

    expect(userSet).toHaveBeenCalledTimes(1);
    const userArgs = userSet.mock.calls[0];
    // M13: bootstrap uses the incoming `ownerUsername` so the profile
    // page is reachable at `/u/alice` instead of `/u/user-abc…`. If
    // `ownerUsername` doesn't match USERNAME_PATTERN, we fall back to
    // `defaultUsername(uid)` — covered by a separate test below.
    expect(userArgs[1]).toMatchObject({
      uid: 'user-123',
      username: 'alice',
      displayName: 'alice',
      photoURL: null,
    });
    // skinCount increment sentinel.
    expect(userArgs[1].skinCount).toEqual({ __sentinel: 'increment', value: 1 });
    expect(userArgs[2]).toEqual({ merge: true });
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it('happy path: returning publisher — only bumps skinCount', async () => {
    userGet.mockResolvedValue({ exists: true });
    await createSkinDoc(VALID_INPUT);
    const userArgs = userSet.mock.calls[0];
    expect(userArgs[1]).not.toHaveProperty('username');
    expect(userArgs[1]).not.toHaveProperty('displayName');
    expect(userArgs[1]).not.toHaveProperty('createdAt');
    expect(userArgs[1].skinCount).toEqual({ __sentinel: 'increment', value: 1 });
  });

  it('writes ogImageUrl=null when provided', async () => {
    userGet.mockResolvedValue({ exists: true });
    await createSkinDoc({ ...VALID_INPUT, ogImageUrl: null });
    expect(skinSet.mock.calls[0][1].ogImageUrl).toBeNull();
  });

  it('writes tags verbatim (no further normalization here)', async () => {
    userGet.mockResolvedValue({ exists: true });
    await createSkinDoc({ ...VALID_INPUT, tags: ['cat', 'dog', 'bird'] });
    expect(skinSet.mock.calls[0][1].tags).toEqual(['cat', 'dog', 'bird']);
  });

  it('tolerates empty tags array', async () => {
    userGet.mockResolvedValue({ exists: true });
    await createSkinDoc({ ...VALID_INPUT, tags: [] });
    expect(skinSet.mock.calls[0][1].tags).toEqual([]);
  });

  it('error path: batch.commit rejects → error propagates', async () => {
    userGet.mockResolvedValue({ exists: true });
    batchCommit.mockRejectedValueOnce(new Error('firestore exploded'));
    await expect(createSkinDoc(VALID_INPUT)).rejects.toThrow(/firestore exploded/);
  });

  it('error path: user doc read rejects → error propagates before any write', async () => {
    userGet.mockRejectedValueOnce(new Error('read timeout'));
    await expect(createSkinDoc(VALID_INPUT)).rejects.toThrow(/read timeout/);
    expect(skinSet).not.toHaveBeenCalled();
    expect(batchCommit).not.toHaveBeenCalled();
  });

  it('unicode in name passes through verbatim', async () => {
    userGet.mockResolvedValue({ exists: true });
    await createSkinDoc({ ...VALID_INPUT, name: '🐉 Dragon Skin' });
    expect(skinSet.mock.calls[0][1].name).toBe('🐉 Dragon Skin');
  });

  it('slim variant is written through', async () => {
    userGet.mockResolvedValue({ exists: true });
    await createSkinDoc({ ...VALID_INPUT, variant: 'slim' });
    expect(skinSet.mock.calls[0][1].variant).toBe('slim');
  });

  it('M13: bootstrap falls back to defaultUsername when the lowercased ownerUsername is not a valid URL slug', async () => {
    userGet.mockResolvedValue({ exists: false });
    // Contains a dot — invalid even when lowercased.
    await createSkinDoc({ ...VALID_INPUT, ownerUsername: 'first.last' });
    const userArgs = userSet.mock.calls[0];
    expect(userArgs[1].username).toMatch(/^user-/);
    // Display name preserves the original (pretty) casing for the UI.
    expect(userArgs[1].displayName).toBe('first.last');
  });

  it('M13: bootstrap lowercases a mixed-case ownerUsername for the URL-safe username field', async () => {
    userGet.mockResolvedValue({ exists: false });
    await createSkinDoc({ ...VALID_INPUT, ownerUsername: 'Alice' });
    const userArgs = userSet.mock.calls[0];
    expect(userArgs[1].username).toBe('alice');
    // Display name preserves the original casing.
    expect(userArgs[1].displayName).toBe('Alice');
  });
});
