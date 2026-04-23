// @vitest-environment node
//
// M11 Unit 5 — /api/skins/publish route.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getServerSessionMock = vi.hoisted(() => vi.fn());
const uploadSkinAssetsMock = vi.hoisted(() => vi.fn());
const deleteSkinAssetsMock = vi.hoisted(() => vi.fn());
const createSkinDocMock = vi.hoisted(() => vi.fn());
const generateUuidV7Mock = vi.hoisted(() => vi.fn(() => 'stub-uuid-v7'));

vi.mock('@/lib/firebase/auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/supabase/storage-server', () => ({
  uploadSkinAssets: uploadSkinAssetsMock,
  deleteSkinAssets: deleteSkinAssetsMock,
}));

vi.mock('@/lib/firebase/skins', () => ({
  createSkinDoc: createSkinDocMock,
  defaultUsername: (uid: string) => `user-${uid}`,
}));

vi.mock('@/lib/firebase/uuid-v7', () => ({
  generateUuidV7: generateUuidV7Mock,
}));

import { POST } from '../publish/route';

const makeRequest = async (fields: Record<string, string | Blob | Blob[]>): Promise<Request> => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      for (const item of v) fd.append(k, item);
    } else {
      fd.append(k, v);
    }
  }
  return new Request('http://localhost/api/skins/publish', {
    method: 'POST',
    body: fd,
  });
};

const validPngBlob = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
const validOgBlob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue({ uid: 'user-123', email: 'alice@example.com' });
  uploadSkinAssetsMock.mockResolvedValue({
    storageUrl: 'https://stub/png',
    ogImageUrl: 'https://stub/og',
  });
  createSkinDocMock.mockResolvedValue({ skinId: 'stub-uuid-v7' });
  deleteSkinAssetsMock.mockResolvedValue(undefined);
});

describe('POST /api/skins/publish', () => {
  it('happy path: signed-in user with valid body → 200', async () => {
    const req = await makeRequest({
      name: 'Cool Skin',
      tags: 'cool,blue',
      variant: 'classic',
      skinPng: validPngBlob(),
      ogWebp: validOgBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      skinId: 'stub-uuid-v7',
      permalinkUrl: '/skin/stub-uuid-v7',
      storageUrl: 'https://stub/png',
      ogImageUrl: 'https://stub/og',
      thumbnailUrl: 'https://stub/png',
    });
    expect(uploadSkinAssetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'user-123',
        skinId: 'stub-uuid-v7',
      }),
    );
    expect(createSkinDocMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skinId: 'stub-uuid-v7',
        uid: 'user-123',
        name: 'Cool Skin',
        tags: ['cool', 'blue'],
        variant: 'classic',
      }),
    );
  });

  it('happy path: no OG blob → succeeds with ogImageUrl=null when upload returns null', async () => {
    uploadSkinAssetsMock.mockResolvedValue({
      storageUrl: 'https://stub/png',
      ogImageUrl: null,
    });
    const req = await makeRequest({
      name: 'Cool',
      variant: 'classic',
      skinPng: validPngBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ogImageUrl).toBeNull();
    expect(uploadSkinAssetsMock).toHaveBeenCalledWith(
      expect.objectContaining({ ogBlob: null }),
    );
  });

  it('accepts tags as repeated form fields (not comma-joined)', async () => {
    const req = await makeRequest({
      name: 'Cool',
      tags: ['alpha', 'beta'],
      variant: 'classic',
      skinPng: validPngBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect(createSkinDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['alpha', 'beta'] }),
    );
  });

  it('error path: no session → 401', async () => {
    getServerSessionMock.mockResolvedValue(null);
    const req = await makeRequest({
      name: 'Cool',
      variant: 'classic',
      skinPng: validPngBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(401);
    expect(uploadSkinAssetsMock).not.toHaveBeenCalled();
  });

  it('error path: empty name → 400', async () => {
    const req = await makeRequest({
      name: '   ',
      variant: 'classic',
      skinPng: validPngBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Name/i);
  });

  it('error path: 9 tags → 400', async () => {
    const req = await makeRequest({
      name: 'Cool',
      tags: 'a,b,c,d,e,f,g,h,i',
      variant: 'classic',
      skinPng: validPngBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    expect(uploadSkinAssetsMock).not.toHaveBeenCalled();
  });

  it('error path: unknown variant → 400', async () => {
    const req = await makeRequest({
      name: 'Cool',
      variant: 'hexapod',
      skinPng: validPngBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('error path: skinPng too large → 400', async () => {
    const bigPng = new Blob([new Uint8Array(200 * 1024)], { type: 'image/png' });
    const req = await makeRequest({
      name: 'Cool',
      variant: 'classic',
      skinPng: bigPng,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('error path: wrong skinPng content-type → 400', async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' });
    const req = await makeRequest({
      name: 'Cool',
      variant: 'classic',
      skinPng: jpeg,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('error path: upload fails → 500, no Firestore write, no rollback call', async () => {
    uploadSkinAssetsMock.mockRejectedValue(new Error('upload broken'));
    const req = await makeRequest({
      name: 'Cool',
      variant: 'classic',
      skinPng: validPngBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    expect(createSkinDocMock).not.toHaveBeenCalled();
    // The upload helper owns its own rollback; the route doesn't call
    // deleteSkinAssets on upload failure.
    expect(deleteSkinAssetsMock).not.toHaveBeenCalled();
  });

  it('error path: Firestore fails → 500 and Storage rolled back via deleteSkinAssets', async () => {
    createSkinDocMock.mockRejectedValue(new Error('firestore broken'));
    const req = await makeRequest({
      name: 'Cool',
      variant: 'classic',
      skinPng: validPngBlob(),
      ogWebp: validOgBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    expect(deleteSkinAssetsMock).toHaveBeenCalledWith({
      uid: 'user-123',
      skinId: 'stub-uuid-v7',
    });
  });

  it('uses the session email local-part as ownerUsername when present', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'user-123', email: 'bob@example.com' });
    const req = await makeRequest({
      name: 'Cool',
      variant: 'classic',
      skinPng: validPngBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(req as any);
    expect(createSkinDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUsername: 'bob' }),
    );
  });

  it('falls back to defaultUsername when session has no email', async () => {
    getServerSessionMock.mockResolvedValue({ uid: 'user-abc' });
    const req = await makeRequest({
      name: 'Cool',
      variant: 'classic',
      skinPng: validPngBlob(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(req as any);
    expect(createSkinDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUsername: 'user-user-abc' }),
    );
  });
});
