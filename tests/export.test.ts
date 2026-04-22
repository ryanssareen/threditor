// @vitest-environment jsdom
//
// M8 Unit 1: export pipeline tests.
//
// Covers exportLayersToBlob (composite → PNG blob), sanitizeFilename,
// buildExportFilename, and downloadBlob progressive-enhancement shape.
// Pixel-parity test vs TextureManager.composite is the P1 acceptance
// criterion — the exported blob's pixels must match the live
// composite output byte-for-byte.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildExportFilename,
  downloadBlob,
  exportLayersToBlob,
  sanitizeFilename,
} from '../lib/editor/export';
import { TextureManager } from '../lib/editor/texture';
import type { Layer } from '../lib/editor/types';

// ── jsdom canvas + ImageData shims (copied from M7's
//    use-texture-manager-seed.test.tsx pattern) ────────────────────────

beforeAll(() => {
  // jsdom's Blob lacks arrayBuffer(); polyfill via FileReader
  // (available in jsdom). Binds to the Blob prototype so tests can
  // call `await blob.arrayBuffer()`.
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
  // jsdom lacks URL.createObjectURL too.
  if (typeof URL.createObjectURL !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = () => 'blob:stub';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = () => {};
  }

  vi.stubGlobal(
    'ImageData',
    class {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    },
  );

  // Pure-JS 64x64 canvas-context mock. getImageData returns whatever was
  // last putImageData'd — enough to let TextureManager.composite +
  // exportLayersToBlob produce identical buffers for the parity test.
  HTMLCanvasElement.prototype.getContext = function mockGetContext(
    this: HTMLCanvasElement,
  ) {
    const w = this.width || 64;
    const h = this.height || 64;
    // Backing store keyed on the canvas instance so separate canvases
    // (main + scratch) don't interfere.
    type Backing = Uint8ClampedArray;
    // Use a WeakMap-ish field on the element.
    const canvas = this as HTMLCanvasElement & { __backing?: Backing };
    if (canvas.__backing === undefined) {
      canvas.__backing = new Uint8ClampedArray(w * h * 4);
    }
    const ctx = {
      canvas,
      imageSmoothingEnabled: true,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      fillStyle: '#000',
      clearRect: () => {
        canvas.__backing!.fill(0);
      },
      fillRect: () => {},
      putImageData: (img: ImageData) => {
        canvas.__backing!.set(img.data);
      },
      drawImage: (src: HTMLCanvasElement) => {
        const srcCanvas = src as HTMLCanvasElement & { __backing?: Backing };
        if (srcCanvas.__backing !== undefined) {
          // Porter-Duff source-over with globalAlpha
          // is approximated by just copying for 'normal' + alpha=1.
          // For tests we care about 'normal' + opacity=1 parity, which
          // is a direct copy. Non-normal blend modes can't be pixel-
          // diffed precisely in a jsdom mock — we test those with
          // shape assertions, not byte equality.
          if (ctx.globalAlpha === 1 && ctx.globalCompositeOperation === 'source-over') {
            canvas.__backing!.set(srcCanvas.__backing);
          }
        }
      },
      getImageData: (x: number, y: number, ww: number, hh: number) => {
        const slice = new Uint8ClampedArray(ww * hh * 4);
        slice.set(canvas.__backing!.subarray(0, ww * hh * 4));
        return { data: slice, width: ww, height: hh } as ImageData;
      },
    };
    return ctx as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement['getContext'];

  // Stub toBlob — real jsdom returns null for toBlob. Emit a minimal
  // PNG-header Blob so the shape tests pass, and capture the backing
  // bytes so the pixel-parity test can compare.
  HTMLCanvasElement.prototype.toBlob = function mockToBlob(
    this: HTMLCanvasElement,
    cb: BlobCallback,
    type?: string,
  ) {
    const canvas = this as HTMLCanvasElement & { __backing?: Uint8ClampedArray };
    const header = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const body = canvas.__backing ?? new Uint8ClampedArray(64 * 64 * 4);
    const payload = new Uint8Array(header.length + body.length);
    payload.set(header, 0);
    payload.set(body, header.length);
    // Exec callback asynchronously — matches real toBlob contract.
    Promise.resolve().then(() =>
      cb(new Blob([payload], { type: type ?? 'image/png' })),
    );
  } as unknown as HTMLCanvasElement['toBlob'];
});

// ── Helpers ──────────────────────────────────────────────────────────

const makeLayer = (fillByte: number): Layer => {
  const pixels = new Uint8ClampedArray(64 * 64 * 4);
  pixels.fill(fillByte);
  return {
    id: `layer-${fillByte}`,
    name: 'Test',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels,
  };
};

// ── sanitizeFilename ─────────────────────────────────────────────────

describe('sanitizeFilename', () => {
  it('replaces colons with hyphens', () => {
    expect(sanitizeFilename('skin-2026-04-22T12:30:45.png')).toBe(
      'skin-2026-04-22T12-30-45.png',
    );
  });

  it('replaces forward and back slashes', () => {
    expect(sanitizeFilename('path/to\\skin.png')).toBe('path-to-skin.png');
  });

  it('strips control characters', () => {
    expect(sanitizeFilename('skin\x00\x1f.png')).toBe('skin.png');
  });

  it('leaves safe names untouched', () => {
    expect(sanitizeFilename('skin-classic-2026-04-22.png')).toBe(
      'skin-classic-2026-04-22.png',
    );
  });
});

// ── buildExportFilename ──────────────────────────────────────────────

describe('buildExportFilename', () => {
  it('prepends variant and embeds an ISO timestamp', () => {
    const at = new Date('2026-04-22T12:30:45.123Z');
    expect(buildExportFilename('classic', at)).toBe(
      'skin-classic-2026-04-22T12-30-45.png',
    );
  });

  it('renders slim variant with slim prefix', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    expect(buildExportFilename('slim', at)).toBe(
      'skin-slim-2026-01-02T03-04-05.png',
    );
  });

  it('uses current time when no date passed', () => {
    const name = buildExportFilename('classic');
    expect(name).toMatch(/^skin-classic-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/);
  });
});

// ── exportLayersToBlob ───────────────────────────────────────────────

describe('exportLayersToBlob', () => {
  it('returns a Blob of type image/png', async () => {
    const blob = await exportLayersToBlob([makeLayer(42)]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('blob starts with the PNG signature bytes', async () => {
    const blob = await exportLayersToBlob([makeLayer(100)]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(buf[0]).toBe(137);
    expect(buf[1]).toBe(80);
    expect(buf[2]).toBe(78);
    expect(buf[3]).toBe(71);
  });

  it('empty layers array resolves with a transparent 64x64 PNG (alpha=0, RGB=0)', async () => {
    const blob = await exportLayersToBlob([]);
    expect(blob.type).toBe('image/png');
    // Our jsdom stub packs the backing pixels after the 8-byte PNG
    // signature; verify all bytes are zero.
    const buf = new Uint8Array(await blob.arrayBuffer());
    const pixels = buf.slice(8); // after PNG sig
    for (let i = 0; i < pixels.length; i++) {
      expect(pixels[i]).toBe(0);
    }
  });

  it('all-hidden layers resolves with a transparent output (Minecraft-safe)', async () => {
    const hidden = makeLayer(200);
    hidden.visible = false;
    const blob = await exportLayersToBlob([hidden]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const pixels = buf.slice(8);
    for (let i = 0; i < pixels.length; i++) {
      expect(pixels[i]).toBe(0);
    }
  });

  it('pixel-parity: exportLayersToBlob output matches TextureManager.composite output', async () => {
    const layer = makeLayer(77);
    // Build the reference composite.
    const ref = new TextureManager();
    ref.composite([layer]);
    const refCtx = ref.getContext();
    const refData = refCtx.getImageData(0, 0, 64, 64).data;

    // Export.
    const blob = await exportLayersToBlob([layer]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const exported = buf.slice(8);

    expect(exported.length).toBe(refData.length);
    for (let i = 0; i < refData.length; i++) {
      expect(exported[i]).toBe(refData[i]);
    }
  });
});

// ── downloadBlob ─────────────────────────────────────────────────────

describe('downloadBlob', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let revokeSpy: any;

  beforeEach(() => {
    createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => 'blob:mock');
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    // Clear any prior showSaveFilePicker flag from other tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).showSaveFilePicker;
  });

  afterEach(() => {
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it('falls back to anchor-click + createObjectURL when showSaveFilePicker is unavailable', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const clicks: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag.toLowerCase() === 'a') {
        const anchor = el as HTMLAnchorElement;
        anchor.click = () => {
          clicks.push(anchor);
        };
      }
      return el;
    });

    downloadBlob(blob, 'skin-test.png');

    expect(createSpy).toHaveBeenCalledWith(blob);
    expect(clicks.length).toBe(1);
    expect(clicks[0].getAttribute('download')).toBe('skin-test.png');
    expect(clicks[0].getAttribute('href')).toBe('blob:mock');
  });

  it('prefers showSaveFilePicker when available', async () => {
    const writable = {
      write: vi.fn(),
      close: vi.fn(),
    };
    const handle = { createWritable: vi.fn(() => Promise.resolve(writable)) };
    const picker = vi.fn(() => Promise.resolve(handle));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).showSaveFilePicker = picker;

    const blob = new Blob([new Uint8Array([7])], { type: 'image/png' });
    await downloadBlob(blob, 'skin-test.png');

    expect(picker).toHaveBeenCalledTimes(1);
    expect(writable.write).toHaveBeenCalledWith(blob);
    expect(writable.close).toHaveBeenCalledTimes(1);
  });

  it('user-cancelled showSaveFilePicker does NOT fall back to anchor download', async () => {
    const cancel = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const picker = vi.fn(() => Promise.reject(cancel));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).showSaveFilePicker = picker;

    const blob = new Blob([new Uint8Array([7])], { type: 'image/png' });
    await downloadBlob(blob, 'skin-test.png');

    expect(picker).toHaveBeenCalled();
    // AbortError is swallowed — no anchor-download fallback triggered.
    expect(createSpy).not.toHaveBeenCalled();
  });
});
