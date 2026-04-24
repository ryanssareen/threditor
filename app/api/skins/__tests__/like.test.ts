// @vitest-environment node
//
// M12 Unit 6 — /api/skins/[skinId]/like route + lib/firebase/likes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getServerSessionMock = vi.hoisted(() => vi.fn());
const toggleLikeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase/auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/firebase/likes', () => ({
  toggleLike: toggleLikeMock,
}));

import { POST } from '../[skinId]/like/route';

const makeCtx = (skinId: string) => ({
  params: Promise.resolve({ skinId }),
});

const VALID_SKIN_ID = 'abcdef012345';

const makeRequest = (opts: { auth?: string } = {}): Request => {
  const headers: Record<string, string> = {};
  if (opts.auth !== undefined) headers.Authorization = opts.auth;
  return new Request(`http://localhost/api/skins/${VALID_SKIN_ID}/like`, {
    method: 'POST',
    headers,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/skins/[skinId]/like', () => {
  it('signed-out user → 401', async () => {
    getServerSessionMock.mockResolvedValue(null);
    const req = makeRequest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, makeCtx(VALID_SKIN_ID));
    expect(res.status).toBe(401);
    expect(toggleLikeMock).not.toHaveBeenCalled();
  });

  it('happy path (first like): toggleLike called, response mirrors result', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'user-a' });
    toggleLikeMock.mockResolvedValue({ liked: true, likeCount: 4 });
    const req = makeRequest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, makeCtx(VALID_SKIN_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ liked: true, likeCount: 4 });
    expect(toggleLikeMock).toHaveBeenCalledWith(VALID_SKIN_ID, 'user-a');
  });

  it('happy path (unlike): toggleLike called, liked=false returned', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'user-a' });
    toggleLikeMock.mockResolvedValue({ liked: false, likeCount: 3 });
    const req = makeRequest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, makeCtx(VALID_SKIN_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ liked: false, likeCount: 3 });
  });

  it('skin-not-found → 404', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'user-a' });
    toggleLikeMock.mockRejectedValue(new Error('skin-not-found'));
    const req = makeRequest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, makeCtx(VALID_SKIN_ID));
    expect(res.status).toBe(404);
  });

  it('toggleLike crashes → 500 (generic, no leak)', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'user-a' });
    toggleLikeMock.mockRejectedValue(new Error('transaction exhausted retries'));
    const req = makeRequest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, makeCtx(VALID_SKIN_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Could not update like');
  });

  it('invalid skinId shape → 400, no toggle call', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'user-a' });
    const req = new Request('http://localhost/api/skins/bad/like', {
      method: 'POST',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, makeCtx('bad'));
    expect(res.status).toBe(400);
    expect(toggleLikeMock).not.toHaveBeenCalled();
  });

  it('response sets private, no-store cache header', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'user-a' });
    toggleLikeMock.mockResolvedValue({ liked: true, likeCount: 1 });
    const req = makeRequest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, makeCtx(VALID_SKIN_ID));
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('Cache-Control')).toContain('private');
  });
});
