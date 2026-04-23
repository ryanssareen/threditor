// @vitest-environment node
//
// M10 Unit 1 — session cookie API route tests.
// Mocks the Admin SDK so tests don't need a real Firebase project.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock state so vi.mock factories can reach it. vi.mock
// factories run before the top-level `const` declarations in the
// source file, so a plain closure doesn't work — use vi.hoisted.
const mockAuth = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  createSessionCookie: vi.fn(),
  verifySessionCookie: vi.fn(),
  revokeRefreshTokens: vi.fn(),
}));

const cookieStoreMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  getAdminFirebase: () => ({ auth: mockAuth }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStoreMock),
}));

// Stub server-only so importing it doesn't throw in node env.
vi.mock('server-only', () => ({}));

import { POST as sessionPOST } from '../session/route';
import { POST as signoutPOST } from '../signout/route';

const makeReq = (body: unknown): Request =>
  new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Stub required env so validateEnv passes.
  vi.stubEnv('FIREBASE_ADMIN_PROJECT_ID', 'threditor-test');
  vi.stubEnv(
    'FIREBASE_ADMIN_CLIENT_EMAIL',
    'firebase-adminsdk@threditor-test.iam.gserviceaccount.com',
  );
  vi.stubEnv('FIREBASE_ADMIN_PRIVATE_KEY', 'stub-key');
});

describe('POST /api/auth/session', () => {
  it('creates a session cookie on valid idToken', async () => {
    mockAuth.verifyIdToken.mockResolvedValue({ uid: 'user-123' });
    mockAuth.createSessionCookie.mockResolvedValue('stub-session-cookie');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await sessionPOST(makeReq({ idToken: 'good' }) as any);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean };
    expect(data.success).toBe(true);
    expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('good');
    expect(mockAuth.createSessionCookie).toHaveBeenCalledWith('good', {
      expiresIn: 60 * 60 * 24 * 5 * 1000,
    });
    expect(res.headers.get('set-cookie')).toContain('session=stub-session-cookie');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('sets SameSite=Lax on the session cookie', async () => {
    mockAuth.verifyIdToken.mockResolvedValue({ uid: 'user-123' });
    mockAuth.createSessionCookie.mockResolvedValue('c');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await sessionPOST(makeReq({ idToken: 'good' }) as any);
    expect(res.headers.get('set-cookie')?.toLowerCase()).toContain('samesite=lax');
  });

  it('rejects missing idToken with 400', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await sessionPOST(makeReq({}) as any);
    expect(res.status).toBe(400);
  });

  it('rejects non-string idToken with 400', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await sessionPOST(makeReq({ idToken: 123 }) as any);
    expect(res.status).toBe(400);
  });

  it('rejects empty-string idToken with 400', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await sessionPOST(makeReq({ idToken: '' }) as any);
    expect(res.status).toBe(400);
  });

  it('returns 401 when verifyIdToken rejects', async () => {
    mockAuth.verifyIdToken.mockRejectedValue(new Error('Invalid token'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await sessionPOST(makeReq({ idToken: 'bad' }) as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when required env vars are missing', async () => {
    vi.unstubAllEnvs();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await sessionPOST(makeReq({ idToken: 'good' }) as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when createSessionCookie rejects', async () => {
    mockAuth.verifyIdToken.mockResolvedValue({ uid: 'u' });
    mockAuth.createSessionCookie.mockRejectedValue(new Error('boom'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await sessionPOST(makeReq({ idToken: 'good' }) as any);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/signout', () => {
  it('revokes refresh tokens and clears the cookie', async () => {
    cookieStoreMock.get.mockReturnValue({ value: 'existing-session-cookie' });
    mockAuth.verifySessionCookie.mockResolvedValue({ sub: 'user-123' });
    mockAuth.revokeRefreshTokens.mockResolvedValue(undefined);

    const res = await signoutPOST();
    expect(res.status).toBe(200);
    expect(mockAuth.revokeRefreshTokens).toHaveBeenCalledWith('user-123');
    // delete-cookie writes a Set-Cookie with Max-Age=0 / Expires=epoch.
    expect(res.headers.get('set-cookie')?.toLowerCase()).toMatch(/session=.*max-age=0|expires=thu, 01 jan 1970/);
  });

  it('succeeds (200) even when no session cookie is present', async () => {
    cookieStoreMock.get.mockReturnValue(undefined);
    const res = await signoutPOST();
    expect(res.status).toBe(200);
    expect(mockAuth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('swallows verifySessionCookie failure and still clears the cookie', async () => {
    cookieStoreMock.get.mockReturnValue({ value: 'stale-cookie' });
    mockAuth.verifySessionCookie.mockRejectedValue(new Error('expired'));

    const res = await signoutPOST();
    expect(res.status).toBe(200);
    expect(mockAuth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('returns 500 when cookies() itself throws', async () => {
    const { cookies } = await import('next/headers');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cookies as any).mockRejectedValueOnce(new Error('cookie read broken'));
    const res = await signoutPOST();
    expect(res.status).toBe(500);
  });
});
