// @vitest-environment jsdom
//
// jsdom env provides `requestAnimationFrame`, `cancelAnimationFrame`, and
// `ImageData` — all of which TextureManager touches. The P2 concern from
// the M3 plan (jsdom lacking a real `CanvasRenderingContext2D`) is handled
// by plan amendment 1: the constructor's optional (canvas, ctx) parameters
// let tests inject plain object mocks so the native `canvas` package is
// never needed.
//
// Note on `texture.needsUpdate`: three.js Texture declares this as a
// setter-only property (it increments `version` and marks the source
// dirty). Reading `texture.needsUpdate` returns `undefined`. This test
// file tracks `texture.version` instead — each flip of needsUpdate=true
// increments version by 1.

import { CanvasTexture } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TextureManager } from '../lib/editor/texture';
import type { Layer } from '../lib/editor/types';

function createMockCanvas(): HTMLCanvasElement {
  return { width: 0, height: 0 } as unknown as HTMLCanvasElement;
}

function createMockCtx(): CanvasRenderingContext2D {
  return {
    imageSmoothingEnabled: true,
    clearRect: () => {},
    putImageData: () => {},
  } as unknown as CanvasRenderingContext2D;
}

describe('TextureManager', () => {
  // Capture rAF callbacks so tests can manually advance the loop. Without
  // this, jsdom's real rAF would fire on its own ~16ms timer and make the
  // rAF coalescing test non-deterministic.
  let savedTicks: FrameRequestCallback[] = [];

  beforeEach(() => {
    savedTicks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      savedTicks.push(cb);
      return savedTicks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    // jsdom 27 does not ship the ImageData class. Production browsers all
    // have it (MDN compat: universal since 2015). The stub just preserves
    // the constructor's (data, width, height) signature so TextureManager
    // can instantiate it.
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('construction with mocks sets canvas dimensions', () => {
    const canvas = createMockCanvas();
    const ctx = createMockCtx();
    const tm = new TextureManager(canvas, ctx);
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(64);
    tm.dispose();
  });

  it('forces imageSmoothingEnabled to false on ctx', () => {
    const ctx = createMockCtx();
    const tm = new TextureManager(createMockCanvas(), ctx);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    tm.dispose();
  });

  it('getTexture() returns a three.js CanvasTexture', () => {
    const tm = new TextureManager(createMockCanvas(), createMockCtx());
    expect(tm.getTexture()).toBeInstanceOf(CanvasTexture);
    tm.dispose();
  });

  it('getContext() returns the injected ctx', () => {
    const ctx = createMockCtx();
    const tm = new TextureManager(createMockCanvas(), ctx);
    expect(tm.getContext()).toBe(ctx);
    tm.dispose();
  });

  it('rAF coalescing — 10 markDirty() calls flip needsUpdate at most once per frame', () => {
    const tm = new TextureManager(createMockCanvas(), createMockCtx());
    const texture = tm.getTexture();
    const startVersion = texture.version;

    // No dirty calls yet. The constructor scheduled the first rAF; fire it.
    // Without any markDirty, version should NOT change.
    savedTicks[0]?.(performance.now());
    expect(texture.version).toBe(startVersion);

    // 10 markDirty calls → at most one version bump on the next tick.
    for (let i = 0; i < 10; i++) tm.markDirty();
    // Before the tick: still no upload scheduled.
    expect(texture.version).toBe(startVersion);

    // The last rAF scheduled is savedTicks[savedTicks.length - 1]; fire it.
    savedTicks[savedTicks.length - 1]?.(performance.now());
    expect(texture.version).toBe(startVersion + 1);

    // A second tick without a new markDirty must not re-flip.
    savedTicks[savedTicks.length - 1]?.(performance.now());
    expect(texture.version).toBe(startVersion + 1);

    tm.dispose();
  });

  it('composite([]) clears the ctx', () => {
    const ctx = createMockCtx();
    const clearSpy = vi.fn();
    ctx.clearRect = clearSpy;
    const tm = new TextureManager(createMockCanvas(), ctx);
    tm.composite([]);
    expect(clearSpy).toHaveBeenCalledWith(0, 0, 64, 64);
    tm.dispose();
  });

  it('composite([visible layer]) calls putImageData once', () => {
    const ctx = createMockCtx();
    const putSpy = vi.fn();
    ctx.putImageData = putSpy;
    const tm = new TextureManager(createMockCanvas(), ctx);
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    const layer: Layer = {
      id: 'test',
      name: 'test',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      pixels,
    };
    tm.composite([layer]);
    expect(putSpy).toHaveBeenCalledTimes(1);
    tm.dispose();
  });

  it('composite([invisible layer]) skips the layer', () => {
    const ctx = createMockCtx();
    const putSpy = vi.fn();
    ctx.putImageData = putSpy;
    const tm = new TextureManager(createMockCanvas(), ctx);
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    const layer: Layer = {
      id: 'test',
      name: 'test',
      visible: false,
      opacity: 1,
      blendMode: 'normal',
      pixels,
    };
    tm.composite([layer]);
    expect(putSpy).toHaveBeenCalledTimes(0);
    tm.dispose();
  });

  it('dispose() is idempotent — calling twice does not throw', () => {
    const tm = new TextureManager(createMockCanvas(), createMockCtx());
    tm.dispose();
    expect(() => tm.dispose()).not.toThrow();
  });

  it('after dispose(), markDirty() accepts the call without throwing', () => {
    const tm = new TextureManager(createMockCanvas(), createMockCtx());
    tm.dispose();
    expect(() => tm.markDirty()).not.toThrow();
  });
});
