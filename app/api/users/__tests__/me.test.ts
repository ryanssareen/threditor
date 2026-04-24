// @vitest-environment node
//
// M13 Unit 5 — PATCH /api/users/me (display name update).

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getServerSessionMock = vi.hoisted(() => vi.fn());
const verifyIdTokenMock = vi.hoisted(() => vi.fn());
const getDocMock = vi.hoisted(() => vi.fn());
const setDocMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase/auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/firebase/admin', () => ({
  getAdminFirebase: () => ({
    auth: { verifyIdToken: verifyIdTokenMock },
    db: {
      collection: () => ({
        doc: () => ({
          get: getDocMock,
          set: setDocMock,
        }),
      }),
    },
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: 'server_ts' }),
  },
}));

import { PATCH } from '../me/route';

const makeRequest = (opts: {
  auth?: string;
  body?: unknown;
  rawBody?: string;
} = {}): Request => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== undefined) headers.Authorization = opts.auth;
  const body =
    opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body !== undefined
        ? JSON.stringify(opts.body)
        : undefined;
  return new Request('http://localhost/api/users/me', {
    method: 'PATCH',
    headers,
    body,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  getDocMock.mockResolvedValue({ exists: true });
  setDocMock.mockResolvedValue(undefined);
});

describe('PATCH /api/users/me', () => {
  it('returns 401 when the caller has no session or bearer token', async () => {
    getServerSessionMock.mockResolvedValue(null);
    const req = makeRequest({ body: { displayName: 'Alice' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.status).toBe(401);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('accepts a bearer token and verifies it with Admin SDK', async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: 'bearer-uid' });
    const req = makeRequest({
      auth: 'Bearer sometoken',
      body: { displayName: 'New Name' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ displayName: 'New Name' });
    expect(verifyIdTokenMock).toHaveBeenCalledWith('sometoken');
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const setArgs = setDocMock.mock.calls[0];
    expect(setArgs[0]).toMatchObject({ displayName: 'New Name' });
    expect(setArgs[1]).toEqual({ merge: true });
  });

  it('falls back to session cookie when no bearer token is provided', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'session-uid' });
    const req = makeRequest({ body: { displayName: 'Cookie User' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.status).toBe(200);
    expect(getServerSessionMock).toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'session-uid' });
    const req = makeRequest({ rawBody: '{ invalid json' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when displayName is missing', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'session-uid' });
    const req = makeRequest({ body: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.status).toBe(400);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('returns 400 when displayName is > 50 chars', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'session-uid' });
    const req = makeRequest({ body: { displayName: 'a'.repeat(51) } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.status).toBe(400);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the /users doc does not yet exist', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'session-uid' });
    getDocMock.mockResolvedValue({ exists: false });
    const req = makeRequest({ body: { displayName: 'Alice' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.status).toBe(404);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('sets Cache-Control to private, no-store on success', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'session-uid' });
    const req = makeRequest({ body: { displayName: 'Alice' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.headers.get('Cache-Control')).toContain('private');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('returns 500 when Firestore set rejects', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'session-uid' });
    setDocMock.mockRejectedValue(new Error('firestore down'));
    const req = makeRequest({ body: { displayName: 'Alice' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.status).toBe(500);
  });

  it('returns 401 when the bearer token fails to verify', async () => {
    verifyIdTokenMock.mockRejectedValue(new Error('token expired'));
    getServerSessionMock.mockResolvedValue(null);
    const req = makeRequest({
      auth: 'Bearer bad',
      body: { displayName: 'Alice' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.status).toBe(401);
  });

  it('trims the displayName before writing', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'session-uid' });
    const req = makeRequest({ body: { displayName: '  Alice  ' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await PATCH(req as any);
    expect(res.status).toBe(200);
    const setArgs = setDocMock.mock.calls[0];
    expect(setArgs[0].displayName).toBe('Alice');
  });
});
