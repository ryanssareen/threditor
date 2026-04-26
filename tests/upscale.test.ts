// @vitest-environment jsdom
//
// M15 Unit 1: nearest-neighbor upscaler tests.

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  upscaleCanvasNearestNeighbor,
  type SupportedResolution,
} from '../lib/editor/upscale';

// ── jsdom canvas mock: tracks a per-canvas __backing typed-array so
//    getImageData / putImageData round-trip. Mirrors the pattern in
//    tests/export.test.ts but size-aware (original mock hardcoded 64).

beforeAll(() => {
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

  HTMLCanvasElement.prototype.getContext = function mockGetContext(
    this: HTMLCanvasElement,
  ) {
    const w = this.width || 64;
    const h = this.height || 64;
    type Backing = Uint8ClampedArray;
    type MockCtx = {
      canvas: HTMLCanvasElement;
      imageSmoothingEnabled: boolean;
      putImageData: (img: ImageData) => void;
      getImageData: (
        x: number,
        y: number,
        ww: number,
        hh: number,
      ) => ImageData;
    };
    const canvas = this as HTMLCanvasElement & {
      __backing?: Backing;
      __ctx?: MockCtx;
    };
    if (
      canvas.__backing === undefined ||
      canvas.__backing.length !== w * h * 4
    ) {
      canvas.__backing = new Uint8ClampedArray(w * h * 4);
    }
    // Cache the context per canvas so subsequent `getContext('2d')` calls
    // return the SAME object — matches browser semantics. Without this
    // cache, the `imageSmoothingEnabled` flag set by the function under
    // test would be invisible to the test assertion polling the flag.
    if (canvas.__ctx === undefined) {
      canvas.__ctx = {
        canvas,
        imageSmoothingEnabled: true,
        putImageData: (img: ImageData) => {
          canvas.__backing!.set(img.data);
        },
        getImageData: (_x: number, _y: number, ww: number, hh: number) => {
          const copy = new Uint8ClampedArray(ww * hh * 4);
          copy.set(canvas.__backing!.subarray(0, ww * hh * 4));
          return { data: copy, width: ww, height: hh } as ImageData;
        },
      };
    }
    return canvas.__ctx as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement['getContext'];
});

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Build a 64×64 canvas whose backing bytes are the supplied RGBA
 * tuple repeated for every pixel. Returns the canvas with the backing
 * bytes already populated so the function-under-test's getImageData
 * returns the expected data.
 */
function makeSolidCanvas(
  size: number,
  rgba: [number, number, number, number],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('mock getContext returned null');
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgba[0];
    pixels[i + 1] = rgba[1];
    pixels[i + 2] = rgba[2];
    pixels[i + 3] = rgba[3];
  }
  ctx.putImageData(new ImageData(pixels, size, size), 0, 0);
  return canvas;
}

/**
 * Build a 64×64 canvas with a single coloured pixel at (x,y) on a
 * background colour. Used to assert nearest-neighbor blocks.
 */
function makeSinglePixelCanvas(
  size: number,
  x: number,
  y: number,
  fg: [number, number, number, number],
  bg: [number, number, number, number],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('mock getContext returned null');
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = bg[0];
    pixels[i + 1] = bg[1];
    pixels[i + 2] = bg[2];
    pixels[i + 3] = bg[3];
  }
  const idx = (y * size + x) * 4;
  pixels[idx] = fg[0];
  pixels[idx + 1] = fg[1];
  pixels[idx + 2] = fg[2];
  pixels[idx + 3] = fg[3];
  ctx.putImageData(new ImageData(pixels, size, size), 0, 0);
  return canvas;
}

/**
 * Read a pixel out of a canvas's mock backing store.
 */
function readPixel(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): [number, number, number, number] {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('mock getContext returned null');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const idx = (y * canvas.width + x) * 4;
  return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
}

// ── Tests ────────────────────────────────────────────────────────────

describe('upscaleCanvasNearestNeighbor', () => {
  it('pass-through: 64 → 64 produces a fresh canvas with identical pixels', () => {
    const source = makeSolidCanvas(64, [100, 200, 50, 255]);
    const target = upscaleCanvasNearestNeighbor(source, 64);

    expect(target.width).toBe(64);
    expect(target.height).toBe(64);
    // Fresh allocation, not a reference to source.
    expect(target).not.toBe(source);
    // Every pixel matches source.
    expect(readPixel(target, 0, 0)).toEqual([100, 200, 50, 255]);
    expect(readPixel(target, 32, 32)).toEqual([100, 200, 50, 255]);
    expect(readPixel(target, 63, 63)).toEqual([100, 200, 50, 255]);
  });

  it('2× upscale: 64 → 128 produces a 128×128 canvas', () => {
    const source = makeSolidCanvas(64, [10, 20, 30, 255]);
    const target = upscaleCanvasNearestNeighbor(source, 128);
    expect(target.width).toBe(128);
    expect(target.height).toBe(128);
  });

  it('2× upscale: a single source pixel at (3,5) maps to a 2×2 block at (6-7, 10-11)', () => {
    const source = makeSinglePixelCanvas(
      64,
      3,
      5,
      [255, 0, 0, 255], // red foreground pixel
      [0, 0, 0, 255], // black background
    );
    const target = upscaleCanvasNearestNeighbor(source, 128);

    // The 2×2 block at (6-7, 10-11) should be red.
    expect(readPixel(target, 6, 10)).toEqual([255, 0, 0, 255]);
    expect(readPixel(target, 7, 10)).toEqual([255, 0, 0, 255]);
    expect(readPixel(target, 6, 11)).toEqual([255, 0, 0, 255]);
    expect(readPixel(target, 7, 11)).toEqual([255, 0, 0, 255]);
    // Neighbours should still be the black background (no bilinear bleed).
    expect(readPixel(target, 5, 10)).toEqual([0, 0, 0, 255]);
    expect(readPixel(target, 8, 10)).toEqual([0, 0, 0, 255]);
    expect(readPixel(target, 6, 9)).toEqual([0, 0, 0, 255]);
    expect(readPixel(target, 6, 12)).toEqual([0, 0, 0, 255]);
  });

  it('4× upscale: single source pixel maps to a 4×4 block', () => {
    const source = makeSinglePixelCanvas(
      64,
      10,
      10,
      [0, 255, 0, 255], // green foreground
      [0, 0, 0, 0], // fully transparent background
    );
    const target = upscaleCanvasNearestNeighbor(source, 256);
    expect(target.width).toBe(256);
    expect(target.height).toBe(256);

    // The 4×4 block at (40-43, 40-43) should be green.
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        expect(readPixel(target, 40 + dx, 40 + dy)).toEqual([0, 255, 0, 255]);
      }
    }
    // Pixel outside the block should still be transparent with zero RGB.
    expect(readPixel(target, 44, 40)).toEqual([0, 0, 0, 0]);
  });

  it('8× upscale: single source pixel maps to an 8×8 block (64 → 512)', () => {
    const source = makeSinglePixelCanvas(
      64,
      0,
      0,
      [123, 45, 67, 200],
      [0, 0, 0, 0],
    );
    const target = upscaleCanvasNearestNeighbor(source, 512);
    expect(target.width).toBe(512);
    expect(target.height).toBe(512);

    // The 8×8 block at (0-7, 0-7) should carry the source pixel's RGBA.
    for (let dy = 0; dy < 8; dy++) {
      for (let dx = 0; dx < 8; dx++) {
        expect(readPixel(target, dx, dy)).toEqual([123, 45, 67, 200]);
      }
    }
    // Adjacent block should be the background.
    expect(readPixel(target, 8, 0)).toEqual([0, 0, 0, 0]);
    expect(readPixel(target, 0, 8)).toEqual([0, 0, 0, 0]);
  });

  it('Minecraft-safe transparent pre-image: alpha=0 AND RGB=0 survives 8× upscale', () => {
    // M8 invariant: transparent regions MUST encode as alpha=0 AND
    // RGB=0. A nearest-neighbor upscale of (0,0,0,0) must stay
    // (0,0,0,0) across every destination pixel in the block.
    const source = makeSolidCanvas(64, [0, 0, 0, 0]);
    const target = upscaleCanvasNearestNeighbor(source, 512);

    const ctx = target.getContext('2d');
    if (ctx === null) throw new Error('unexpected null context');
    const data = ctx.getImageData(0, 0, 512, 512).data;
    // Spot-check corners and centre; total pixel count = 262144.
    const checks = [
      [0, 0],
      [0, 511],
      [511, 0],
      [511, 511],
      [256, 256],
      [137, 299],
    ];
    for (const [x, y] of checks) {
      const idx = (y * 512 + x) * 4;
      expect(data[idx]).toBe(0);
      expect(data[idx + 1]).toBe(0);
      expect(data[idx + 2]).toBe(0);
      expect(data[idx + 3]).toBe(0);
    }
  });

  it('disables imageSmoothingEnabled on the target context (regression guard)', () => {
    // If a future refactor reintroduces `ctx.drawImage(src, 0, 0, tw,
    // th)` without disabling smoothing, this assertion should catch
    // it. The current typed-array loop doesn't depend on the flag,
    // but the contract is that the flag IS disabled — that's the
    // invariant we want to preserve if the implementation changes.
    const source = makeSolidCanvas(64, [100, 100, 100, 255]);
    const target = upscaleCanvasNearestNeighbor(source, 128);
    const ctx = target.getContext('2d');
    if (ctx === null) throw new Error('unexpected null context');
    expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  it('tolerates a non-64 source canvas (e.g., 128 → 256)', () => {
    const source = makeSinglePixelCanvas(
      128,
      10,
      10,
      [200, 100, 50, 255],
      [0, 0, 0, 255],
    );
    const target = upscaleCanvasNearestNeighbor(source, 256);
    expect(target.width).toBe(256);
    expect(target.height).toBe(256);
    // 2× upscale of source → 2×2 block at (20-21, 20-21).
    expect(readPixel(target, 20, 20)).toEqual([200, 100, 50, 255]);
    expect(readPixel(target, 21, 21)).toEqual([200, 100, 50, 255]);
  });

  it('target canvas is not the same reference as source even at pass-through', () => {
    const source = makeSolidCanvas(64, [1, 2, 3, 4]);
    const target = upscaleCanvasNearestNeighbor(source, 64);
    expect(target).not.toBe(source);
    // Mutating the source's backing should not affect the target.
    const srcCtx = source.getContext('2d');
    if (srcCtx === null) throw new Error('unexpected null context');
    const mutated = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < mutated.length; i += 4) {
      mutated[i] = 99;
      mutated[i + 1] = 99;
      mutated[i + 2] = 99;
      mutated[i + 3] = 99;
    }
    srcCtx.putImageData(new ImageData(mutated, 64, 64), 0, 0);
    // Target should still show the ORIGINAL colour.
    expect(readPixel(target, 0, 0)).toEqual([1, 2, 3, 4]);
  });

  it('throws a typed error when getContext returns null (OOM / insecure env)', () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    // Force getContext to return null.
    HTMLCanvasElement.prototype.getContext =
      (() => null) as unknown as HTMLCanvasElement['getContext'];
    try {
      expect(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        upscaleCanvasNearestNeighbor(canvas, 128);
      }).toThrow(/upscale: failed to obtain 2D context/);
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });

  it('SupportedResolution literal union accepts every shipped size', () => {
    // Compile-time contract: this test literally just proves the
    // types compile. A TS regression breaks the test file.
    const resolutions: SupportedResolution[] = [64, 128, 256, 512];
    expect(resolutions).toHaveLength(4);
  });
});
