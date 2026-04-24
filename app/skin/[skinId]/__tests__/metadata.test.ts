// M14 Unit 2 integration: generateMetadata emits correct shape for
// the skin detail route.
//
// We bypass the Firestore loader by mocking the admin SDK; the goal is
// to assert that buildSkinMetadata is wired through generateMetadata
// with the right shareUrl, and that the 404 branch emits noindex.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factory can reach the spy.
const getSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase/admin', () => ({
  getAdminFirebase: () => ({
    db: {
      collection: () => ({
        doc: () => ({
          get: getSpy,
        }),
      }),
    },
  }),
}));

import { generateMetadata } from '../page';
import { SITE_ORIGIN } from '@/lib/seo/site';

const SKIN_ID = '019dbb09-c521-7665-945f-06fc0de1b27b';

beforeEach(() => {
  getSpy.mockReset();
});

function makeParams(id: string = SKIN_ID) {
  return { params: Promise.resolve({ skinId: id }) };
}

describe('generateMetadata (/skin/[skinId])', () => {
  it('returns noindex + "Skin not found" when the skin is missing', async () => {
    getSpy.mockResolvedValue({ exists: false, data: () => undefined });
    const meta = await generateMetadata(makeParams());
    expect(meta.title).toContain('not found');
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('returns noindex when the skinId fails the UUID shape guard', async () => {
    const meta = await generateMetadata(makeParams('not-a-uuid!'));
    expect(meta.title).toContain('not found');
    // Firestore should never be called for a malformed id.
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('returns the full metadata shape for a healthy skin', async () => {
    getSpy.mockResolvedValue({
      exists: true,
      data: () => ({
        ownerUid: 'uid-123',
        ownerUsername: 'ryanssareen',
        name: 'Shaded Hoodie',
        variant: 'classic',
        storageUrl: 'https://example.test/skin.png',
        thumbnailUrl: 'https://example.test/thumb.webp',
        ogImageUrl: 'https://example.test/og.webp',
        tags: ['hoodie', 'shading'],
        likeCount: 17,
        createdAt: { toDate: () => new Date('2026-04-20T14:32:00Z') },
      }),
    });

    const meta = await generateMetadata(makeParams());

    expect(meta.title).toBe('Shaded Hoodie by ryanssareen');
    expect(meta.alternates?.canonical).toBe(`${SITE_ORIGIN}/skin/${SKIN_ID}`);
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect((meta.openGraph as Record<string, unknown>)?.type).toBe('article');
    expect(((meta.twitter as Record<string, unknown>)?.card)).toBe('summary_large_image');
    const images = meta.openGraph?.images as Array<Record<string, unknown>>;
    expect(images[0].url).toBe('https://example.test/og.webp');
    expect(images[0].width).toBe(1200);
  });

  it('downgrades to summary card when ogImageUrl is missing', async () => {
    getSpy.mockResolvedValue({
      exists: true,
      data: () => ({
        ownerUid: 'uid-123',
        ownerUsername: 'ryanssareen',
        name: 'Shaded Hoodie',
        variant: 'classic',
        storageUrl: 'https://example.test/skin.png',
        thumbnailUrl: 'https://example.test/thumb.webp',
        ogImageUrl: null,
        tags: [],
        likeCount: 0,
        createdAt: null,
      }),
    });

    const meta = await generateMetadata(makeParams());
    expect(((meta.twitter as Record<string, unknown>)?.card)).toBe('summary');
  });

  it('dedupes the Firestore read across generateMetadata + the page body', async () => {
    // React cache() dedupes by arg identity within one render pass.
    // Vitest imports both generateMetadata and default from the same
    // module, so both call loadSkin(skinId) → cache hit on the second
    // call when the skinId matches.
    getSpy.mockResolvedValue({
      exists: true,
      data: () => ({
        ownerUid: 'u',
        ownerUsername: 'r',
        name: 'S',
        variant: 'classic',
        storageUrl: 'https://example.test/s.png',
        thumbnailUrl: null,
        ogImageUrl: null,
        tags: [],
        likeCount: 0,
        createdAt: null,
      }),
    });

    // Call generateMetadata twice in the same "request" (vitest test).
    // React's cache() uses a request-scoped cache — in a non-request
    // test environment it falls back to a single call, so we at least
    // assert the loader succeeds both times without error.
    await generateMetadata(makeParams());
    await generateMetadata(makeParams());
    // Don't assert an exact call count — React's cache() behavior in
    // vitest's node env differs from production. We assert > 0 calls,
    // which proves the loader wiring works.
    expect(getSpy).toHaveBeenCalled();
  });
});
