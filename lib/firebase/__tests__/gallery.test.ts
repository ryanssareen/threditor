// @vitest-environment node
//
// M12 Unit 6 — gallery query normalization.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let sortOrderings: Array<{ field: string; direction: 'asc' | 'desc' }> = [];
let appliedLimit = 0;
let mockDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];

vi.mock('../admin', () => ({
  getAdminFirebase: () => ({
    db: {
      collection: () => {
        const chain = {
          orderBy: (field: string, direction: 'asc' | 'desc') => {
            sortOrderings.push({ field, direction });
            return chain;
          },
          limit: (n: number) => {
            appliedLimit = n;
            return chain;
          },
          get: async () => ({ docs: mockDocs }),
        };
        return chain;
      },
    },
  }),
}));

import { GALLERY_PAGE_SIZE, queryGallery } from '../gallery';

const ts = (ms: number) => ({ toDate: () => new Date(ms) });

beforeEach(() => {
  sortOrderings = [];
  appliedLimit = 0;
  mockDocs = [];
});

describe('queryGallery', () => {
  it('newest → orders by createdAt desc, limits to page size', async () => {
    await queryGallery('newest');
    expect(sortOrderings).toEqual([{ field: 'createdAt', direction: 'desc' }]);
    expect(appliedLimit).toBe(GALLERY_PAGE_SIZE);
  });

  it('popular → orders by likeCount desc with createdAt desc tiebreaker', async () => {
    await queryGallery('popular');
    expect(sortOrderings).toEqual([
      { field: 'likeCount', direction: 'desc' },
      { field: 'createdAt', direction: 'desc' },
    ]);
  });

  it('normalizes Firestore Timestamps into createdAtMs', async () => {
    mockDocs = [
      {
        id: 'skin-1',
        data: () => ({
          ownerUid: 'u',
          ownerUsername: 'alice',
          name: 'Cool',
          variant: 'classic',
          storageUrl: 'https://stub/png',
          thumbnailUrl: 'https://stub/thumb',
          ogImageUrl: 'https://stub/og',
          tags: ['hoodie'],
          likeCount: 7,
          createdAt: ts(1_700_000_000_000),
        }),
      },
    ];
    const out = await queryGallery('newest');
    expect(out.length).toBe(1);
    expect(out[0].createdAtMs).toBe(1_700_000_000_000);
    expect(out[0].likeCount).toBe(7);
  });

  it('drops docs missing required fields', async () => {
    mockDocs = [
      {
        id: 'bad-1',
        // Missing ownerUid → dropped.
        data: () => ({ name: 'Oops', storageUrl: 'https://stub/png' }),
      },
      {
        id: 'good-1',
        data: () => ({
          ownerUid: 'u',
          ownerUsername: 'alice',
          name: 'OK',
          variant: 'classic',
          storageUrl: 'https://stub/png',
          thumbnailUrl: 'https://stub/thumb',
          ogImageUrl: null,
          tags: [],
          likeCount: 0,
          createdAt: ts(1_000),
        }),
      },
    ];
    const out = await queryGallery('newest');
    expect(out.map((s) => s.id)).toEqual(['good-1']);
  });

  it('defaults to classic variant if field is missing / bad', async () => {
    mockDocs = [
      {
        id: 'x',
        data: () => ({
          ownerUid: 'u',
          ownerUsername: 'alice',
          name: 'Y',
          storageUrl: 'https://stub/png',
          createdAt: ts(0),
        }),
      },
    ];
    const out = await queryGallery('newest');
    expect(out[0].variant).toBe('classic');
  });

  it('falls back thumbnailUrl → storageUrl when no thumbnail', async () => {
    mockDocs = [
      {
        id: 'x',
        data: () => ({
          ownerUid: 'u',
          ownerUsername: 'alice',
          name: 'Y',
          variant: 'slim',
          storageUrl: 'https://stub/png',
          createdAt: ts(0),
        }),
      },
    ];
    const out = await queryGallery('newest');
    expect(out[0].thumbnailUrl).toBe('https://stub/png');
  });
});
