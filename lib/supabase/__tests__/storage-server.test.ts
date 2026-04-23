// @vitest-environment node
//
// M11 Unit 3 — server-side Supabase upload + delete.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock @supabase/supabase-js's createClient so we can simulate upload
// success / failure without hitting real Supabase.
const uploadSpy = vi.hoisted(() => vi.fn());
const removeSpy = vi.hoisted(() => vi.fn());
const fromSpy = vi.hoisted(() =>
  vi.fn(() => ({
    upload: uploadSpy,
    remove: removeSpy,
  })),
);

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: { from: fromSpy },
  })),
}));

import {
  deleteSkinAssets,
  uploadSkinAssets,
} from '../storage-server';

const UID = 'user-123';
const SKIN = 'skin-abc';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://stub.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-stub');
  vi.stubEnv('SUPABASE_BUCKET_NAME', 'skins');
  uploadSpy.mockReset();
  removeSpy.mockReset();
  removeSpy.mockResolvedValue({ error: null, data: [] });
});

describe('uploadSkinAssets', () => {
  it('happy path: uploads PNG + OG, returns both public URLs', async () => {
    uploadSpy.mockResolvedValue({ error: null, data: {} });
    const r = await uploadSkinAssets({
      uid: UID,
      skinId: SKIN,
      pngBlob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
      ogBlob: new Blob([new Uint8Array([2])], { type: 'image/webp' }),
    });
    expect(uploadSpy).toHaveBeenCalledTimes(2);
    expect(uploadSpy).toHaveBeenNthCalledWith(
      1,
      `${UID}/${SKIN}.png`,
      expect.any(Blob),
      expect.objectContaining({ contentType: 'image/png', upsert: false }),
    );
    expect(uploadSpy).toHaveBeenNthCalledWith(
      2,
      `${UID}/${SKIN}-og.webp`,
      expect.any(Blob),
      expect.objectContaining({ contentType: 'image/webp', upsert: false }),
    );
    expect(r.storageUrl).toBe(
      `https://stub.supabase.co/storage/v1/object/public/skins/${UID}/${SKIN}.png`,
    );
    expect(r.ogImageUrl).toBe(
      `https://stub.supabase.co/storage/v1/object/public/skins/${UID}/${SKIN}-og.webp`,
    );
  });

  it('happy path: uploads PNG only when ogBlob is null', async () => {
    uploadSpy.mockResolvedValue({ error: null, data: {} });
    const r = await uploadSkinAssets({
      uid: UID,
      skinId: SKIN,
      pngBlob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
      ogBlob: null,
    });
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(r.ogImageUrl).toBeNull();
  });

  it('happy path: uploads PNG only when ogBlob omitted', async () => {
    uploadSpy.mockResolvedValue({ error: null, data: {} });
    const r = await uploadSkinAssets({
      uid: UID,
      skinId: SKIN,
      pngBlob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    });
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(r.ogImageUrl).toBeNull();
  });

  it('error path: PNG upload fails → throws, no cleanup needed', async () => {
    uploadSpy.mockResolvedValueOnce({ error: { message: 'quota exceeded' }, data: null });
    await expect(
      uploadSkinAssets({
        uid: UID,
        skinId: SKIN,
        pngBlob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
        ogBlob: new Blob([new Uint8Array([2])], { type: 'image/webp' }),
      }),
    ).rejects.toThrow(/PNG upload failed.*quota exceeded/);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('error path: OG upload fails after PNG → rolls back PNG then throws', async () => {
    uploadSpy
      .mockResolvedValueOnce({ error: null, data: {} })
      .mockResolvedValueOnce({ error: { message: 'timeout' }, data: null });
    await expect(
      uploadSkinAssets({
        uid: UID,
        skinId: SKIN,
        pngBlob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
        ogBlob: new Blob([new Uint8Array([2])], { type: 'image/webp' }),
      }),
    ).rejects.toThrow(/OG upload failed.*timeout/);
    expect(removeSpy).toHaveBeenCalledWith([`${UID}/${SKIN}.png`]);
  });

  it('error path: missing SUPABASE_SERVICE_ROLE_KEY → throws configuration error', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://stub.supabase.co');
    await expect(
      uploadSkinAssets({
        uid: UID,
        skinId: SKIN,
        pngBlob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
      }),
    ).rejects.toThrow(/Supabase not configured.*SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('error path: missing NEXT_PUBLIC_SUPABASE_URL → throws configuration error', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x');
    await expect(
      uploadSkinAssets({
        uid: UID,
        skinId: SKIN,
        pngBlob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
      }),
    ).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('honors SUPABASE_BUCKET_NAME env override', async () => {
    vi.stubEnv('SUPABASE_BUCKET_NAME', 'custom-bucket');
    uploadSpy.mockResolvedValue({ error: null, data: {} });
    await uploadSkinAssets({
      uid: UID,
      skinId: SKIN,
      pngBlob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    });
    expect(fromSpy).toHaveBeenCalledWith('custom-bucket');
  });
});

describe('deleteSkinAssets', () => {
  it('removes both PNG + OG paths in one call', async () => {
    removeSpy.mockResolvedValue({ error: null, data: [] });
    await deleteSkinAssets({ uid: UID, skinId: SKIN });
    expect(removeSpy).toHaveBeenCalledWith([
      `${UID}/${SKIN}.png`,
      `${UID}/${SKIN}-og.webp`,
    ]);
  });

  it('fail-soft: partial failure from Supabase is logged but not thrown', async () => {
    removeSpy.mockResolvedValue({
      error: { message: 'partial removal' },
      data: null,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await deleteSkinAssets({ uid: UID, skinId: SKIN });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
