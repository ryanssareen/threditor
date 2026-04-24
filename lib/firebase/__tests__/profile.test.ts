// @vitest-environment node
//
// M13 Unit 1 — lib/firebase/profile: user lookup, skin query,
// total-likes fold, and display-name validation.
//
// Mocks the Admin SDK via `getAdminFirebase` with a scriptable
// Firestore facade that records `where` / `orderBy` / `limit` calls
// and returns the docs set by the test.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type WhereCall = { collection: string; field: string; op: string; value: unknown };
type OrderByCall = { field: string; direction: 'asc' | 'desc' };

let whereCalls: WhereCall[] = [];
let orderByCalls: OrderByCall[] = [];
let appliedLimit = 0;
// Keyed responses for `.collection(name).where(...).get()`. The profile
// lookup fallback fires a second `where` against /skins when /users is
// empty, so the test needs to script both outcomes independently.
let mockQueryResults: Record<
  string,
  Array<{ id: string; data: () => Record<string, unknown> }>
> = {};
let mockDocPointLookups: Record<
  string,
  { exists: boolean; data: () => Record<string, unknown> }
> = {};

// Back-compat alias so existing tests that set `mockDocs` continue to
// read from the /users collection.
let mockDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
let mockEmpty = false;

vi.mock('../admin', () => ({
  getAdminFirebase: () => ({
    db: {
      collection: (name: string) => {
        const currentCollection = name;
        const chain = {
          where: (field: string, op: string, value: unknown) => {
            whereCalls.push({ collection: currentCollection, field, op, value });
            return chain;
          },
          orderBy: (field: string, direction: 'asc' | 'desc') => {
            orderByCalls.push({ field, direction });
            return chain;
          },
          limit: (n: number) => {
            appliedLimit = n;
            return chain;
          },
          get: async () => {
            const scripted = mockQueryResults[currentCollection];
            if (scripted !== undefined) {
              return { docs: scripted, empty: scripted.length === 0 };
            }
            // Legacy fallback: tests that only care about one collection
            // (the gallery/users path) populate the generic `mockDocs`.
            return {
              docs: mockDocs,
              empty: mockEmpty || mockDocs.length === 0,
            };
          },
          doc: (id: string) => ({
            get: async () => {
              const key = `${currentCollection}/${id}`;
              const entry = mockDocPointLookups[key];
              return entry ?? { exists: false, data: () => ({}) };
            },
          }),
        };
        return chain;
      },
    },
  }),
}));

import {
  computeTotalLikes,
  getSkinsByOwner,
  getUserByUsername,
  PROFILE_PAGE_SIZE,
  RESERVED_USERNAMES,
  USERNAME_PATTERN,
  validateDisplayName,
} from '../profile';

const ts = (ms: number) => ({ toDate: () => new Date(ms) });

beforeEach(() => {
  whereCalls = [];
  orderByCalls = [];
  appliedLimit = 0;
  mockDocs = [];
  mockEmpty = false;
  mockQueryResults = {};
  mockDocPointLookups = {};
});

describe('getUserByUsername', () => {
  it('lowercases the input and queries /users by username', async () => {
    mockQueryResults.users = [
      {
        id: 'uid-123',
        data: () => ({
          uid: 'uid-123',
          username: 'pixelalice',
          displayName: 'Pixel Alice',
          photoURL: 'https://avatars/pixel.png',
          skinCount: 4,
          createdAt: ts(1_700_000_000_000),
        }),
      },
    ];
    const user = await getUserByUsername('PixelAlice');
    expect(user).not.toBeNull();
    expect(user?.username).toBe('pixelalice');
    expect(user?.displayName).toBe('Pixel Alice');
    expect(user?.skinCount).toBe(4);
    expect(user?.createdAtMs).toBe(1_700_000_000_000);
    expect(whereCalls).toEqual([
      { collection: 'users', field: 'username', op: '==', value: 'pixelalice' },
    ]);
    expect(appliedLimit).toBe(1);
  });

  it('returns null for an invalid username pattern without querying Firestore', async () => {
    const user = await getUserByUsername('has spaces');
    expect(user).toBeNull();
    expect(whereCalls.length).toBe(0);
  });

  it('returns null when neither /users nor /skins match (full fallback miss)', async () => {
    mockQueryResults.users = [];
    mockQueryResults.skins = [];
    const user = await getUserByUsername('nobody');
    expect(user).toBeNull();
    // Both lookups must have been attempted.
    expect(whereCalls.map((w) => w.collection)).toEqual(['users', 'skins']);
  });

  it('returns null when the /users doc is missing required fields', async () => {
    mockQueryResults.users = [{ id: 'uid-x', data: () => ({ uid: 'uid-x' }) }];
    const user = await getUserByUsername('broken');
    expect(user).toBeNull();
  });

  it('preserves createdAt === null when the Firestore field is missing', async () => {
    mockQueryResults.users = [
      {
        id: 'uid-1',
        data: () => ({
          uid: 'uid-1',
          username: 'newbie',
          displayName: 'Newbie',
        }),
      },
    ];
    const user = await getUserByUsername('newbie');
    expect(user?.createdAtMs).toBeNull();
    expect(user?.photoURL).toBeNull();
    expect(user?.skinCount).toBe(0);
  });

  it('back-compat: when /users has no match, resolves via /skins.ownerUsername → /users/{ownerUid} for pre-M13 `user-<slug>` shape', async () => {
    // Pre-M13 data: user doc has `username: user-abc` (default
    // bootstrap) but skins have `ownerUsername: alice` (email prefix).
    // The `user-` prefix lets the reverse-check accept this row as
    // "owns the slug, hasn't been renamed yet".
    mockQueryResults.users = [];
    mockQueryResults.skins = [
      {
        id: 'skin-1',
        data: () => ({
          ownerUid: 'uid-abc',
          ownerUsername: 'alice',
          name: 'Cool',
          storageUrl: 'https://stub/png',
          createdAt: ts(0),
        }),
      },
    ];
    mockDocPointLookups['users/uid-abc'] = {
      exists: true,
      data: () => ({
        uid: 'uid-abc',
        username: 'user-abc',
        displayName: 'Alice',
        createdAt: ts(1_000),
      }),
    };
    const user = await getUserByUsername('alice');
    expect(user).not.toBeNull();
    expect(user?.uid).toBe('uid-abc');
    expect(user?.displayName).toBe('Alice');
    expect(user?.username).toBe('user-abc');
  });

  it('fallback returns null when the skin has no ownerUid field', async () => {
    mockQueryResults.users = [];
    mockQueryResults.skins = [
      {
        id: 'skin-1',
        data: () => ({ ownerUsername: 'alice', name: 'oops' }),
      },
    ];
    const user = await getUserByUsername('alice');
    expect(user).toBeNull();
  });

  it('fallback returns null when the /users/{ownerUid} doc is missing', async () => {
    mockQueryResults.users = [];
    mockQueryResults.skins = [
      {
        id: 'skin-1',
        data: () => ({
          ownerUid: 'uid-missing',
          ownerUsername: 'alice',
          name: 'X',
          storageUrl: 'https://stub/png',
          createdAt: ts(0),
        }),
      },
    ];
    const user = await getUserByUsername('alice');
    expect(user).toBeNull();
  });

  it('reverse-check: fallback returns null when the resolved user has RENAMED away from the stale slug', async () => {
    // Pre-M13 shape was /users.username = user-<slug>. If that user
    // has since renamed to a real username (`bob`), a lookup for the
    // stale `alice` slug must NOT route to Bob. The direct query is
    // authoritative; stale skins can't re-claim a slug Bob didn't pick.
    mockQueryResults.users = [];
    mockQueryResults.skins = [
      {
        id: 'skin-1',
        data: () => ({
          ownerUid: 'uid-bob',
          ownerUsername: 'alice',
          name: 'X',
          storageUrl: 'https://stub/png',
          createdAt: ts(0),
        }),
      },
    ];
    mockDocPointLookups['users/uid-bob'] = {
      exists: true,
      data: () => ({
        uid: 'uid-bob',
        username: 'bob',
        displayName: 'Bob',
        createdAt: ts(1_000),
      }),
    };
    const user = await getUserByUsername('alice');
    expect(user).toBeNull();
  });

  it('reverse-check: fallback accepts a direct-match user (rare race between index + direct query)', async () => {
    // Defence in depth: if the user's current username already equals
    // the requested slug, accept even though we reached the fallback
    // (this can happen during Firestore index propagation windows).
    mockQueryResults.users = [];
    mockQueryResults.skins = [
      {
        id: 'skin-1',
        data: () => ({
          ownerUid: 'uid-alice',
          ownerUsername: 'alice',
          name: 'X',
          storageUrl: 'https://stub/png',
          createdAt: ts(0),
        }),
      },
    ];
    mockDocPointLookups['users/uid-alice'] = {
      exists: true,
      data: () => ({
        uid: 'uid-alice',
        username: 'alice',
        displayName: 'Alice',
        createdAt: ts(1_000),
      }),
    };
    const user = await getUserByUsername('alice');
    expect(user).not.toBeNull();
    expect(user?.uid).toBe('uid-alice');
  });
});

describe('getSkinsByOwner', () => {
  it('queries by ownerUid then orderBy createdAt desc with PROFILE_PAGE_SIZE limit', async () => {
    mockQueryResults.skins = [];
    await getSkinsByOwner('uid-abc');
    expect(whereCalls).toEqual([
      { collection: 'skins', field: 'ownerUid', op: '==', value: 'uid-abc' },
    ]);
    expect(orderByCalls).toEqual([{ field: 'createdAt', direction: 'desc' }]);
    expect(appliedLimit).toBe(PROFILE_PAGE_SIZE);
  });

  it('normalises Firestore docs into GallerySkin shape', async () => {
    mockQueryResults.skins = [
      {
        id: 'skin-1',
        data: () => ({
          ownerUid: 'uid-x',
          ownerUsername: 'alice',
          name: 'Cool',
          variant: 'slim',
          storageUrl: 'https://stub/png',
          thumbnailUrl: 'https://stub/thumb',
          ogImageUrl: 'https://stub/og',
          tags: ['hoodie', 'blue'],
          likeCount: 9,
          createdAt: ts(1_700_000_000_000),
        }),
      },
    ];
    const skins = await getSkinsByOwner('uid-x');
    expect(skins.length).toBe(1);
    expect(skins[0].variant).toBe('slim');
    expect(skins[0].createdAtMs).toBe(1_700_000_000_000);
    expect(skins[0].tags).toEqual(['hoodie', 'blue']);
  });

  it('drops malformed docs (missing required fields)', async () => {
    mockQueryResults.skins = [
      { id: 'bad', data: () => ({ ownerUid: 'uid-x' }) },
      {
        id: 'good',
        data: () => ({
          ownerUid: 'uid-x',
          ownerUsername: 'alice',
          name: 'OK',
          variant: 'classic',
          storageUrl: 'https://stub/png',
          createdAt: ts(0),
        }),
      },
    ];
    const skins = await getSkinsByOwner('uid-x');
    expect(skins.map((s) => s.id)).toEqual(['good']);
  });

  it('falls back thumbnailUrl → storageUrl when thumbnail is missing', async () => {
    mockQueryResults.skins = [
      {
        id: 's1',
        data: () => ({
          ownerUid: 'uid-x',
          ownerUsername: 'alice',
          name: 'Y',
          variant: 'classic',
          storageUrl: 'https://stub/png',
          createdAt: ts(0),
        }),
      },
    ];
    const skins = await getSkinsByOwner('uid-x');
    expect(skins[0].thumbnailUrl).toBe('https://stub/png');
    expect(skins[0].ogImageUrl).toBeNull();
  });

  it('defaults variant to classic when field is missing or garbage', async () => {
    mockQueryResults.skins = [
      {
        id: 's1',
        data: () => ({
          ownerUid: 'uid-x',
          ownerUsername: 'alice',
          name: 'Y',
          storageUrl: 'https://stub/png',
          variant: 'weird',
          createdAt: ts(0),
        }),
      },
    ];
    const skins = await getSkinsByOwner('uid-x');
    expect(skins[0].variant).toBe('classic');
  });
});

describe('computeTotalLikes', () => {
  it('sums likeCount across skins', () => {
    const skins = [
      { likeCount: 3 },
      { likeCount: 0 },
      { likeCount: 12 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any[];
    expect(computeTotalLikes(skins)).toBe(15);
  });

  it('returns 0 for an empty list', () => {
    expect(computeTotalLikes([])).toBe(0);
  });
});

describe('USERNAME_PATTERN', () => {
  it('accepts lowercase letters, digits, dashes and underscores', () => {
    expect(USERNAME_PATTERN.test('alice')).toBe(true);
    expect(USERNAME_PATTERN.test('user-abc123')).toBe(true);
    expect(USERNAME_PATTERN.test('snake_case')).toBe(true);
    expect(USERNAME_PATTERN.test('a12')).toBe(true);
  });

  it('rejects uppercase, spaces, and short/long inputs', () => {
    expect(USERNAME_PATTERN.test('Alice')).toBe(false);
    expect(USERNAME_PATTERN.test('has space')).toBe(false);
    expect(USERNAME_PATTERN.test('ab')).toBe(false);
    expect(USERNAME_PATTERN.test('a'.repeat(31))).toBe(false);
    expect(USERNAME_PATTERN.test('')).toBe(false);
  });

  it('rejects dot, slash, and other route-colliding punctuation', () => {
    expect(USERNAME_PATTERN.test('al.ice')).toBe(false);
    expect(USERNAME_PATTERN.test('al/ice')).toBe(false);
    expect(USERNAME_PATTERN.test('al?ice')).toBe(false);
  });
});

describe('RESERVED_USERNAMES', () => {
  it('blocks route-colliding names', () => {
    expect(RESERVED_USERNAMES.has('admin')).toBe(true);
    expect(RESERVED_USERNAMES.has('api')).toBe(true);
    expect(RESERVED_USERNAMES.has('gallery')).toBe(true);
    expect(RESERVED_USERNAMES.has('editor')).toBe(true);
    expect(RESERVED_USERNAMES.has('u')).toBe(true);
  });

  it('does not reserve normal names', () => {
    expect(RESERVED_USERNAMES.has('alice')).toBe(false);
    expect(RESERVED_USERNAMES.has('bob')).toBe(false);
  });
});

describe('validateDisplayName', () => {
  it('rejects non-strings', () => {
    expect(validateDisplayName(42).ok).toBe(false);
    expect(validateDisplayName(undefined).ok).toBe(false);
    expect(validateDisplayName(null).ok).toBe(false);
  });

  it('rejects empty / whitespace-only', () => {
    expect(validateDisplayName('').ok).toBe(false);
    expect(validateDisplayName('   ').ok).toBe(false);
  });

  it('trims whitespace edges and accepts Unicode', () => {
    const result = validateDisplayName('  Alice  ');
    expect(result).toEqual({ ok: true, displayName: 'Alice' });
    const unicode = validateDisplayName('Пиксел 🧱');
    expect(unicode.ok).toBe(true);
  });

  it('rejects > 50 chars', () => {
    expect(validateDisplayName('a'.repeat(51)).ok).toBe(false);
    expect(validateDisplayName('a'.repeat(50)).ok).toBe(true);
  });

  it('rejects control characters', () => {
    expect(validateDisplayName('bad\nname').ok).toBe(false);
    expect(validateDisplayName('bad\u0000name').ok).toBe(false);
  });
});
