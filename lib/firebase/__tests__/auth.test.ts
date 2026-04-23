// @vitest-environment node
//
// M10 Unit 2 — server-side auth helpers.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = vi.hoisted(() => ({
  verifySessionCookie: vi.fn(),
}));

const cookieStoreMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../admin', () => ({
  getAdminFirebase: () => ({ auth: mockAuth }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStoreMock),
}));

vi.mock('server-only', () => ({}));

import { getServerSession, requireServerSession } from '../auth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getServerSession', () => {
  it('returns session when cookie is valid', async () => {
    cookieStoreMock.get.mockReturnValue({ value: 'good-session-cookie' });
    mockAuth.verifySessionCookie.mockResolvedValue({
      uid: 'user-123',
      email: 'alice@example.com',
      email_verified: true,
    });

    const session = await getServerSession();
    expect(session).toEqual({
      uid: 'user-123',
      email: 'alice@example.com',
      emailVerified: true,
    });
    // checkRevoked=true must be passed.
    expect(mockAuth.verifySessionCookie).toHaveBeenCalledWith(
      'good-session-cookie',
      true,
    );
  });

  it('returns null when no session cookie is present', async () => {
    cookieStoreMock.get.mockReturnValue(undefined);
    expect(await getServerSession()).toBeNull();
    expect(mockAuth.verifySessionCookie).not.toHaveBeenCalled();
  });

  it('returns null when session cookie is empty string', async () => {
    cookieStoreMock.get.mockReturnValue({ value: '' });
    expect(await getServerSession()).toBeNull();
    expect(mockAuth.verifySessionCookie).not.toHaveBeenCalled();
  });

  it('returns null when verifySessionCookie rejects (expired / revoked)', async () => {
    cookieStoreMock.get.mockReturnValue({ value: 'stale' });
    mockAuth.verifySessionCookie.mockRejectedValue(new Error('expired'));
    expect(await getServerSession()).toBeNull();
  });

  it('returns null when cookies() itself throws', async () => {
    const { cookies } = await import('next/headers');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cookies as any).mockRejectedValueOnce(new Error('cookies broken'));
    expect(await getServerSession()).toBeNull();
  });

  it('handles decoded claims without email / email_verified', async () => {
    cookieStoreMock.get.mockReturnValue({ value: 'good' });
    mockAuth.verifySessionCookie.mockResolvedValue({
      uid: 'anon-123',
    });
    const session = await getServerSession();
    expect(session).toEqual({
      uid: 'anon-123',
      email: undefined,
      emailVerified: undefined,
    });
  });
});

describe('requireServerSession', () => {
  it('returns the session when one exists', async () => {
    cookieStoreMock.get.mockReturnValue({ value: 'good' });
    mockAuth.verifySessionCookie.mockResolvedValue({ uid: 'user-123' });
    const s = await requireServerSession();
    expect(s.uid).toBe('user-123');
  });

  it('throws Unauthorized when no session is present', async () => {
    cookieStoreMock.get.mockReturnValue(undefined);
    await expect(requireServerSession()).rejects.toThrow(/Unauthorized/);
  });

  it('throws Unauthorized when session is expired', async () => {
    cookieStoreMock.get.mockReturnValue({ value: 'stale' });
    mockAuth.verifySessionCookie.mockRejectedValue(new Error('expired'));
    await expect(requireServerSession()).rejects.toThrow(/Unauthorized/);
  });
});
