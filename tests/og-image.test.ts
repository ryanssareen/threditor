// @vitest-environment jsdom
//
// M11 Unit 2 — OG image generator.
//
// Testing WebGL in jsdom is futile (jsdom has no WebGL context). We
// mock three.js's WebGLRenderer with a stub that simulates success
// (writing a fake WebP signature to the canvas) + failure modes, and
// verify the surrounding orchestration: fail-soft on WebGL-unavailable,
// correct toBlob arguments, GPU-resource cleanup, variant handling.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkinVariant } from '@/lib/three/geometry';

// ── Hoisted spies so the vi.mock factory can reach them. ──────────

const renderSpy = vi.hoisted(() => vi.fn());
const rendererDisposeSpy = vi.hoisted(() => vi.fn());
const rendererSetSizeSpy = vi.hoisted(() => vi.fn());
const geometryDisposeSpy = vi.hoisted(() => vi.fn());
const materialDisposeSpy = vi.hoisted(() => vi.fn());
const textureDisposeSpy = vi.hoisted(() => vi.fn());
const webglConstructorSpy = vi.hoisted(() => vi.fn());

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: vi.fn().mockImplementation((opts) => {
      webglConstructorSpy(opts);
      return {
        setSize: rendererSetSizeSpy,
        render: renderSpy,
        dispose: rendererDisposeSpy,
      };
    }),
    // Override BoxGeometry / MeshStandardMaterial / CanvasTexture
    // dispose so we can assert cleanup. We DO want the real geometry +
    // material classes so the constructor argument typing stays honest.
    BoxGeometry: class extends actual.BoxGeometry {
      dispose() {
        geometryDisposeSpy();
        super.dispose();
      }
    },
    MeshStandardMaterial: class extends actual.MeshStandardMaterial {
      dispose() {
        materialDisposeSpy();
        super.dispose();
      }
    },
    CanvasTexture: class extends actual.CanvasTexture {
      dispose() {
        textureDisposeSpy();
        super.dispose();
      }
    },
  };
});

import { generateOGImage } from '../lib/editor/og-image';

// ── Polyfill canvas.toBlob in jsdom. ──────────────────────────────

beforeAll(() => {
  HTMLCanvasElement.prototype.toBlob = function mockToBlob(
    cb: BlobCallback,
    type?: string,
  ) {
    const bytes = new Uint8Array([
      // 4-byte RIFF header + size (ignored) + 4-byte WEBP tag.
      0x52,
      0x49,
      0x46,
      0x46,
      0x00,
      0x00,
      0x00,
      0x00,
      0x57,
      0x45,
      0x42,
      0x50,
    ]);
    Promise.resolve().then(() =>
      cb(new Blob([bytes], { type: type ?? 'image/webp' })),
    );
  } as HTMLCanvasElement['toBlob'];

  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function (this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
});

const makeSourceCanvas = (): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  return c;
};

beforeEach(() => {
  renderSpy.mockClear();
  rendererDisposeSpy.mockClear();
  rendererSetSizeSpy.mockClear();
  geometryDisposeSpy.mockClear();
  materialDisposeSpy.mockClear();
  textureDisposeSpy.mockClear();
  webglConstructorSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('generateOGImage', () => {
  it('returns a WebP Blob for a valid classic-variant source canvas', async () => {
    const blob = await generateOGImage(makeSourceCanvas(), 'classic');
    expect(blob).not.toBeNull();
    expect(blob?.type).toBe('image/webp');
    const buf = new Uint8Array(await blob!.arrayBuffer());
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...buf.slice(8, 12))).toBe('WEBP');
  });

  it('returns a WebP Blob for a valid slim-variant source canvas', async () => {
    const blob = await generateOGImage(makeSourceCanvas(), 'slim' as SkinVariant);
    expect(blob).not.toBeNull();
    expect(blob?.type).toBe('image/webp');
  });

  it('configures WebGLRenderer with preserveDrawingBuffer (required for toBlob)', async () => {
    await generateOGImage(makeSourceCanvas(), 'classic');
    expect(webglConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        preserveDrawingBuffer: true,
        antialias: true,
        alpha: true,
      }),
    );
  });

  it('sizes the renderer to 1200×630', async () => {
    await generateOGImage(makeSourceCanvas(), 'classic');
    expect(rendererSetSizeSpy).toHaveBeenCalledWith(1200, 630, false);
  });

  it('calls render() exactly once per invocation', async () => {
    await generateOGImage(makeSourceCanvas(), 'classic');
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('disposes renderer + geometries + materials + texture on success', async () => {
    await generateOGImage(makeSourceCanvas(), 'classic');
    expect(rendererDisposeSpy).toHaveBeenCalledTimes(1);
    // 12 meshes = 12 geometries + 12 materials.
    expect(geometryDisposeSpy).toHaveBeenCalledTimes(12);
    expect(materialDisposeSpy).toHaveBeenCalledTimes(12);
    expect(textureDisposeSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null when WebGLRenderer constructor throws', async () => {
    const { WebGLRenderer } = await import('three');
    (WebGLRenderer as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => {
        throw new Error('WebGL unavailable');
      },
    );
    const blob = await generateOGImage(makeSourceCanvas(), 'classic');
    expect(blob).toBeNull();
  });

  it('returns null when toBlob yields null', async () => {
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      Promise.resolve().then(() => cb(null));
    } as HTMLCanvasElement['toBlob'];
    try {
      const blob = await generateOGImage(makeSourceCanvas(), 'classic');
      expect(blob).toBeNull();
    } finally {
      HTMLCanvasElement.prototype.toBlob = origToBlob;
    }
  });

  it('repeated invocations do not leak renderers (each call disposes)', async () => {
    for (let i = 0; i < 5; i++) {
      await generateOGImage(makeSourceCanvas(), 'classic');
    }
    expect(rendererDisposeSpy).toHaveBeenCalledTimes(5);
  });
});
