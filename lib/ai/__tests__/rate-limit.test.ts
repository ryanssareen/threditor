// @vitest-environment node
//
// M16 Unit 3 — Firestore-backed rate limiter.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Minimal in-memory Firestore mock that supports:
//   - collection(name).doc(id).set(...) / .get()
//   - db.runTransaction(async (tx) => { ... })
//
// Storage shape: a single `Map<string, Record<string, unknown>>` keyed by
// `${col}/${id}`. Increment sentinels resolved on `set`.
type Doc = Record<string, unknown> | null;

const makeFakeDb = () => {
  const store = new Map<string, Doc>();

  type FakeRef = {
    __path: string;
    set: (data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
    get: () => Promise<{
      exists: boolean;
      data: () => Record<string, unknown> | undefined;
    }>;
  };

  const docRef = (path: string): FakeRef => ({
    __path: path,
    async set(data, opts) {
      const merged = applyData(store.get(path) ?? null, data, opts?.merge ?? false);
      store.set(path, merged);
    },
    async get() {
      const cur = store.get(path) ?? null;
      return {
        exists: cur !== null,
        data: () => cur ?? undefined,
      };
    },
  });

  const applyData = (
    prev: Doc,
    next: Record<string, unknown>,
    merge: boolean,
  ): Record<string, unknown> => {
    const base: Record<string, unknown> = merge && prev !== null ? { ...prev } : {};
    for (const [k, v] of Object.entries(next)) {
      if (
        v !== null &&
        typeof v === 'object' &&
        '__sentinel' in v &&
        (v as { __sentinel: string }).__sentinel === 'increment'
      ) {
        const cur = typeof base[k] === 'number' ? (base[k] as number) : 0;
        const value = (v as unknown as { value: number }).value ?? 0;
        base[k] = cur + value;
      } else {
        base[k] = v;
      }
    }
    return base;
  };

  return {
    store,
    db: {
      collection: (col: string) => ({
        doc: (id: string) => docRef(`${col}/${id}`),
      }),
      // Linearizing transaction — fine for tests, no contention model.
      runTransaction: async <T>(
        fn: (tx: {
          get: (ref: FakeRef) => Promise<{
            exists: boolean;
            data: () => Record<string, unknown> | undefined;
          }>;
          set: (
            ref: FakeRef,
            data: Record<string, unknown>,
            opts?: { merge?: boolean },
          ) => void;
        }) => Promise<T>,
      ): Promise<T> => {
        const writes: { ref: FakeRef; data: Record<string, unknown>; merge: boolean }[] =
          [];
        const result = await fn({
          get: (ref) => ref.get(),
          set: (ref, data, opts) => {
            writes.push({ ref, data, merge: opts?.merge ?? false });
          },
        });
        for (const w of writes) {
          const merged = applyData(store.get(w.ref.__path) ?? null, w.data, w.merge);
          store.set(w.ref.__path, merged);
        }
        return result;
      },
    },
  };
};

const fakeFirestore = vi.hoisted(() => {
  return {
    current: null as null | {
      store: Map<string, Record<string, unknown> | null>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: any;
    },
  };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n: number) => ({ __sentinel: 'increment', value: n }),
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
  },
  Timestamp: {
    fromMillis: (ms: number) => ({ __sentinel: 'timestamp', toMillis: () => ms }),
  },
}));

vi.mock('@/lib/firebase/admin', () => ({
  getAdminFirebase: () => {
    if (fakeFirestore.current === null) throw new Error('fake db not set');
    return { db: fakeFirestore.current.db };
  },
}));

import {
  AGGREGATE_TOKEN_CAP,
  bumpAggregateTokens,
  checkAndIncrement,
  DAY_CAP,
  HOUR_CAP,
  hashIp,
  IP_HOUR_CAP,
  refundSlot,
} from '../rate-limit';

const FIXED_NOW = new Date('2026-04-25T15:42:00.000Z');

beforeEach(() => {
  fakeFirestore.current = makeFakeDb();
  vi.unstubAllEnvs();
  vi.stubEnv('IP_HASH_SALT', 'a'.repeat(32));
});

describe('checkAndIncrement', () => {
  it('first request: allowed with full remaining budget, all docs created', async () => {
    const r = await checkAndIncrement(
      { uid: 'user-1', ipHash: 'iphash01' },
      FIXED_NOW,
    );
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(r.remainingHour).toBe(HOUR_CAP - 1);
    expect(r.remainingDay).toBe(DAY_CAP - 1);
    const store = fakeFirestore.current!.store;
    expect(store.get('rateLimits/user-1_2026042515')?.count).toBe(1);
    expect(store.get('rateLimits/user-1_day_20260425')?.count).toBe(1);
    expect(store.get('rateLimits/ip_iphash01_2026042515')?.count).toBe(1);
  });

  it('5th request returns remainingHour: 0; 6th is denied with reason hour', async () => {
    for (let i = 0; i < HOUR_CAP - 1; i++) {
      await checkAndIncrement({ uid: 'user-1', ipHash: '' }, FIXED_NOW);
    }
    const fifth = await checkAndIncrement(
      { uid: 'user-1', ipHash: '' },
      FIXED_NOW,
    );
    expect(fifth.allowed).toBe(true);
    if (fifth.allowed) expect(fifth.remainingHour).toBe(0);

    const sixth = await checkAndIncrement(
      { uid: 'user-1', ipHash: '' },
      FIXED_NOW,
    );
    expect(sixth.allowed).toBe(false);
    if (!sixth.allowed) {
      expect(sixth.reason).toBe('hour');
      expect(sixth.resetAt).toBeGreaterThan(FIXED_NOW.getTime());
    }
    // Sixth call MUST NOT have incremented the user-hour bucket.
    expect(
      fakeFirestore.current!.store.get('rateLimits/user-1_2026042515')?.count,
    ).toBe(HOUR_CAP);
  });

  it('day cap denies after 30 hour-spread allowances', async () => {
    // Spread DAY_CAP=30 hits across all 24 UTC hours of the same day
    // so neither the hour cap (5/hr) nor a day rollover trip first.
    // Pattern: 5 hits in each of the first 6 hours = 30.
    let count = 0;
    for (let h = 0; h < 24 && count < DAY_CAP; h++) {
      for (let n = 0; n < 5 && count < DAY_CAP; n++, count++) {
        const at = new Date(FIXED_NOW);
        at.setUTCHours(h, 30, 0, 0);
        const r = await checkAndIncrement({ uid: 'u', ipHash: '' }, at);
        expect(r.allowed).toBe(true);
      }
    }
    expect(count).toBe(DAY_CAP);
    // FIXED_NOW is hour 15 — already at HOUR_CAP from the loop above.
    // To probe the day cap specifically, hit a fresh hour where the
    // hour-bucket is still 0 but the day-bucket is full.
    const freshHour = new Date(FIXED_NOW);
    freshHour.setUTCHours(20, 0, 0, 0);
    const denied = await checkAndIncrement(
      { uid: 'u', ipHash: '' },
      freshHour,
    );
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toBe('day');
  });

  it('per-IP cap denies after 15 hits across distinct uids', async () => {
    // 15 requests from 5 fake uids × 3 each, all through the same ipHash.
    // Each uid hits its hour cap at 5; we only need to push the per-IP
    // counter past 15 within the hour.
    for (let n = 0; n < IP_HOUR_CAP; n++) {
      const r = await checkAndIncrement(
        { uid: `u${Math.floor(n / 3)}`, ipHash: 'shared' },
        FIXED_NOW,
      );
      expect(r.allowed).toBe(true);
    }
    const denied = await checkAndIncrement(
      { uid: 'u-fresh', ipHash: 'shared' },
      FIXED_NOW,
    );
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toBe('ip');
  });

  it('empty ipHash skips the per-IP check without error', async () => {
    const r = await checkAndIncrement({ uid: 'u', ipHash: '' }, FIXED_NOW);
    expect(r.allowed).toBe(true);
    // ip_ doc should NOT be present.
    const ipDocs = [...fakeFirestore.current!.store.keys()].filter((k) =>
      k.startsWith('rateLimits/ip_'),
    );
    expect(ipDocs).toHaveLength(0);
  });

  it('crossing the hour boundary uses different doc IDs', async () => {
    const at1 = new Date('2026-04-25T15:59:00.000Z');
    const at2 = new Date('2026-04-25T16:00:00.000Z');
    await checkAndIncrement({ uid: 'u', ipHash: '' }, at1);
    await checkAndIncrement({ uid: 'u', ipHash: '' }, at2);
    expect(fakeFirestore.current!.store.get('rateLimits/u_2026042515')?.count).toBe(1);
    expect(fakeFirestore.current!.store.get('rateLimits/u_2026042516')?.count).toBe(1);
  });

  it('aggregate kill-switch denies when enabled=false', async () => {
    fakeFirestore.current!.store.set('aiConfig/global', {
      enabled: false,
      todayDate: '20260425',
      todayTokens: 0,
    });
    const r = await checkAndIncrement({ uid: 'u', ipHash: '' }, FIXED_NOW);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('aggregate');
  });

  it('aggregate kill-switch denies when todayTokens > cap', async () => {
    fakeFirestore.current!.store.set('aiConfig/global', {
      enabled: true,
      todayDate: '20260425',
      todayTokens: AGGREGATE_TOKEN_CAP + 1,
    });
    const r = await checkAndIncrement({ uid: 'u', ipHash: '' }, FIXED_NOW);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('aggregate');
  });

  it('aggregate kill-switch ignores stale todayDate (treats as 0)', async () => {
    fakeFirestore.current!.store.set('aiConfig/global', {
      enabled: true,
      todayDate: '20260101', // long ago
      todayTokens: AGGREGATE_TOKEN_CAP + 1_000_000, // would deny if fresh
    });
    const r = await checkAndIncrement({ uid: 'u', ipHash: '' }, FIXED_NOW);
    expect(r.allowed).toBe(true);
  });
});

describe('refundSlot', () => {
  it('decrements all three docs and floors at 0', async () => {
    const r = await checkAndIncrement(
      { uid: 'u', ipHash: 'iphash01' },
      FIXED_NOW,
    );
    if (!r.allowed) throw new Error('expected allowed');
    await refundSlot(r.refundDocs);
    expect(fakeFirestore.current!.store.get('rateLimits/u_2026042515')?.count).toBe(0);
    expect(fakeFirestore.current!.store.get('rateLimits/u_day_20260425')?.count).toBe(0);
    expect(
      fakeFirestore.current!.store.get('rateLimits/ip_iphash01_2026042515')?.count,
    ).toBe(0);
  });

  it('does not go negative when called twice', async () => {
    const r = await checkAndIncrement({ uid: 'u', ipHash: '' }, FIXED_NOW);
    if (!r.allowed) throw new Error('expected allowed');
    await refundSlot(r.refundDocs);
    await refundSlot(r.refundDocs);
    expect(fakeFirestore.current!.store.get('rateLimits/u_2026042515')?.count).toBe(0);
  });
});

describe('bumpAggregateTokens', () => {
  it('creates the aggregate doc on first call with todayDate set', async () => {
    await bumpAggregateTokens(2000, FIXED_NOW);
    const cfg = fakeFirestore.current!.store.get('aiConfig/global');
    expect(cfg?.todayDate).toBe('20260425');
    expect(cfg?.todayTokens).toBe(2000);
    expect(cfg?.enabled).toBe(true);
  });

  it('increments same-day calls', async () => {
    await bumpAggregateTokens(2000, FIXED_NOW);
    await bumpAggregateTokens(1500, FIXED_NOW);
    expect(fakeFirestore.current!.store.get('aiConfig/global')?.todayTokens).toBe(3500);
  });

  it('resets on day rollover', async () => {
    await bumpAggregateTokens(2000, FIXED_NOW);
    const tomorrow = new Date('2026-04-26T01:00:00.000Z');
    await bumpAggregateTokens(500, tomorrow);
    expect(fakeFirestore.current!.store.get('aiConfig/global')?.todayTokens).toBe(500);
    expect(fakeFirestore.current!.store.get('aiConfig/global')?.todayDate).toBe('20260426');
  });

  it('preserves the enabled flag set by an operator', async () => {
    fakeFirestore.current!.store.set('aiConfig/global', {
      enabled: false,
      todayDate: '20260425',
      todayTokens: 100,
    });
    await bumpAggregateTokens(50, FIXED_NOW);
    expect(fakeFirestore.current!.store.get('aiConfig/global')?.enabled).toBe(false);
  });

  it('ignores zero / non-finite token counts', async () => {
    await bumpAggregateTokens(0, FIXED_NOW);
    await bumpAggregateTokens(NaN, FIXED_NOW);
    expect(fakeFirestore.current!.store.get('aiConfig/global')).toBeUndefined();
  });
});

describe('hashIp', () => {
  it('returns a deterministic 16-char hex hash for a given IP+salt', async () => {
    const a = await hashIp('1.2.3.4');
    const b = await hashIp('1.2.3.4');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns different hashes for different IPs', async () => {
    const a = await hashIp('1.2.3.4');
    const b = await hashIp('5.6.7.8');
    expect(a).not.toBe(b);
  });

  it('returns empty string when IP is empty', async () => {
    expect(await hashIp('')).toBe('');
  });

  it('returns empty string when salt is missing', async () => {
    vi.stubEnv('IP_HASH_SALT', '');
    expect(await hashIp('1.2.3.4')).toBe('');
  });
});
