// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDecodeCache, decodeTemplatePng } from '../lib/editor/templates';

const EXPECTED_LENGTH = 64 * 64 * 4;

function makeKnownBuffer(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(EXPECTED_LENGTH);
  for (let i = 0; i < EXPECTED_LENGTH; i++) buf[i] = (i % 256) as number;
  return buf;
}

function makeFetchOkBlob(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    blob: () => Promise.resolve(new Blob()),
  } as unknown as Response);
}

function makeFetch404(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 404,
    blob: () => Promise.resolve(new Blob()),
  } as unknown as Response);
}

describe('decodeTemplatePng', () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = function mockGetContext() {
      return {
        imageSmoothingEnabled: true,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        clearRect: () => {},
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: makeKnownBuffer(),
          width: w,
          height: h,
        }),
      } as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement['getContext'];
  });

  beforeEach(() => {
    clearDecodeCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearDecodeCache();
  });

  it('happy path: decodes 64×64 PNG and returns expected buffer', async () => {
    vi.stubGlobal('fetch', makeFetchOkBlob());
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 64, height: 64 }));

    const buffer = await decodeTemplatePng('/test.png');

    expect(buffer).toBeInstanceOf(Uint8ClampedArray);
    expect(buffer.length).toBe(EXPECTED_LENGTH);
    const known = makeKnownBuffer();
    expect(buffer).toEqual(known);
  });

  it('cache hit: same URL called twice → fetch called once, second call returns same reference', async () => {
    const fetchSpy = makeFetchOkBlob();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 64, height: 64 }));

    const first = await decodeTemplatePng('/cached.png');
    const second = await decodeTemplatePng('/cached.png');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('dimension mismatch: throws with "bad dimensions" in error message', async () => {
    vi.stubGlobal('fetch', makeFetchOkBlob());
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 32, height: 32 }));

    HTMLCanvasElement.prototype.getContext = function mockGetContext() {
      return {
        imageSmoothingEnabled: true,
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => ({
          data: new Uint8ClampedArray(32 * 32 * 4),
          width: 32,
          height: 32,
        }),
      } as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement['getContext'];

    await expect(decodeTemplatePng('/bad-dims.png')).rejects.toThrow('bad dimensions');
  });

  it('fetch 404 → throws', async () => {
    vi.stubGlobal('fetch', makeFetch404());
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 64, height: 64 }));

    await expect(decodeTemplatePng('/missing.png')).rejects.toThrow();
  });

  it('clearDecodeCache() empties the cache so next call re-fetches', async () => {
    const fetchSpy = makeFetchOkBlob();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 64, height: 64 }));

    HTMLCanvasElement.prototype.getContext = function mockGetContext() {
      return {
        imageSmoothingEnabled: true,
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => ({
          data: makeKnownBuffer(),
          width: 64,
          height: 64,
        }),
      } as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement['getContext'];

    await decodeTemplatePng('/cache-clear.png');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    clearDecodeCache();

    await decodeTemplatePng('/cache-clear.png');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
