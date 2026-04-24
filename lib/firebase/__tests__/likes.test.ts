// @vitest-environment node
//
// M12 Unit 6 — lib/firebase/likes transaction shape.
//
// We stub the Admin SDK entry (`getAdminFirebase`) with a scriptable
// Firestore facade that (a) hands the transaction callback a fake
// `tx` object and (b) records the writes so we can assert the
// FieldValue.increment(±1) shape without depending on a live emulator.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// FieldValue.serverTimestamp + increment need stable sentinels so we
// can assert on them in test. Mock the whole module with sentinels
// that carry their "meaning" as a string tag.
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: 'server_ts' }),
    increment: (n: number) => ({ __sentinel: 'increment', n }),
  },
}));

type TxOp =
  | { kind: 'get'; ref: { __path: string } }
  | { kind: 'set'; ref: { __path: string }; data: unknown }
  | { kind: 'update'; ref: { __path: string }; data: unknown }
  | { kind: 'delete'; ref: { __path: string } };

// State the mock Firestore carries between `toggleLike` runs.
const state: {
  skinData: Record<string, Record<string, unknown> | undefined>;
  likeExists: Record<string, boolean>;
  ops: TxOp[];
} = {
  skinData: {},
  likeExists: {},
  ops: [],
};

const fakeDb = {
  collection: (name: string) => ({
    doc: (id: string) => ({ __path: `${name}/${id}` }),
  }),
  runTransaction: async (
    run: (tx: {
      get: (ref: { __path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      set: (ref: { __path: string }, data: unknown) => void;
      update: (ref: { __path: string }, data: unknown) => void;
      delete: (ref: { __path: string }) => void;
    }) => Promise<unknown>,
  ) => {
    const tx = {
      get: async (ref: { __path: string }) => {
        state.ops.push({ kind: 'get', ref });
        if (ref.__path.startsWith('skins/')) {
          const id = ref.__path.slice('skins/'.length);
          const data = state.skinData[id];
          return {
            exists: data !== undefined,
            data: () => data,
          };
        }
        if (ref.__path.startsWith('likes/')) {
          const id = ref.__path.slice('likes/'.length);
          return {
            exists: state.likeExists[id] === true,
            data: () => undefined,
          };
        }
        return { exists: false, data: () => undefined };
      },
      set: (ref: { __path: string }, data: unknown) => {
        state.ops.push({ kind: 'set', ref, data });
      },
      update: (ref: { __path: string }, data: unknown) => {
        state.ops.push({ kind: 'update', ref, data });
      },
      delete: (ref: { __path: string }) => {
        state.ops.push({ kind: 'delete', ref });
      },
    };
    return run(tx);
  },
};

vi.mock('../admin', () => ({
  getAdminFirebase: () => ({ db: fakeDb }),
}));

import { toggleLike, readLikedSkinIds } from '../likes';

beforeEach(() => {
  state.skinData = {};
  state.likeExists = {};
  state.ops = [];
});

describe('toggleLike', () => {
  it('first like: creates /likes doc and increments /skins.likeCount by 1', async () => {
    state.skinData['skin-a'] = { likeCount: 2 };
    state.likeExists['skin-a_user-x'] = false;

    const result = await toggleLike('skin-a', 'user-x');

    expect(result).toEqual({ liked: true, likeCount: 3 });
    const ops = state.ops;
    expect(ops.filter((o) => o.kind === 'set').length).toBe(1);
    expect(ops.filter((o) => o.kind === 'update').length).toBe(1);
    expect(ops.filter((o) => o.kind === 'delete').length).toBe(0);
    const updateOp = ops.find((o) => o.kind === 'update');
    expect(updateOp).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData = (updateOp as any).data as { likeCount: { __sentinel: string; n: number } };
    expect(updateData.likeCount).toEqual({ __sentinel: 'increment', n: 1 });
    const setOp = ops.find((o) => o.kind === 'set');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setData = (setOp as any).data as {
      skinId: string;
      uid: string;
      createdAt: { __sentinel: string };
    };
    expect(setData.skinId).toBe('skin-a');
    expect(setData.uid).toBe('user-x');
    expect(setData.createdAt).toEqual({ __sentinel: 'server_ts' });
  });

  it('unlike: deletes /likes doc and decrements /skins.likeCount by 1', async () => {
    state.skinData['skin-b'] = { likeCount: 5 };
    state.likeExists['skin-b_user-x'] = true;

    const result = await toggleLike('skin-b', 'user-x');

    expect(result).toEqual({ liked: false, likeCount: 4 });
    const ops = state.ops;
    expect(ops.filter((o) => o.kind === 'delete').length).toBe(1);
    expect(ops.filter((o) => o.kind === 'set').length).toBe(0);
    const updateOp = ops.find((o) => o.kind === 'update');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData = (updateOp as any).data as { likeCount: { __sentinel: string; n: number } };
    expect(updateData.likeCount).toEqual({ __sentinel: 'increment', n: -1 });
  });

  it('unlike at likeCount=0 never returns a negative count', async () => {
    // Bug guard: the numeric fallback in the transaction shouldn't
    // expose a -1 count if the counter somehow desynced with the
    // /likes doc.
    state.skinData['skin-z'] = { likeCount: 0 };
    state.likeExists['skin-z_user-x'] = true;

    const result = await toggleLike('skin-z', 'user-x');
    expect(result.liked).toBe(false);
    expect(result.likeCount).toBeGreaterThanOrEqual(0);
  });

  it('skin-not-found → throws "skin-not-found"', async () => {
    // Empty skinData[id] → skinSnap.exists === false.
    await expect(toggleLike('missing', 'user-x')).rejects.toThrow('skin-not-found');
  });

  it('uses composite like doc id `${skinId}_${uid}`', async () => {
    state.skinData['skin-c'] = { likeCount: 0 };
    state.likeExists['skin-c_user-y'] = false;

    await toggleLike('skin-c', 'user-y');

    const setOp = state.ops.find((o) => o.kind === 'set');
    expect(setOp).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((setOp as any).ref.__path).toBe('likes/skin-c_user-y');
  });
});

describe('readLikedSkinIds', () => {
  it('returns only the ids present in /likes', async () => {
    state.likeExists['s1_u'] = true;
    state.likeExists['s3_u'] = true;
    // s2 is absent.

    // readLikedSkinIds does direct db.collection(...).doc(...).get(),
    // so we need to extend the fake with a `.get()` on doc refs. Patch
    // the fake temporarily.
    const origCollection = fakeDb.collection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fakeDb as any).collection = (name: string) => ({
      doc: (id: string) => ({
        __path: `${name}/${id}`,
        get: async () => ({ exists: state.likeExists[id] === true }),
      }),
    });

    const liked = await readLikedSkinIds(['s1', 's2', 's3'], 'u');

    expect(liked.sort()).toEqual(['s1', 's3']);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fakeDb as any).collection = origCollection;
  });

  it('empty input → empty output, no reads', async () => {
    const liked = await readLikedSkinIds([], 'u');
    expect(liked).toEqual([]);
  });
});
