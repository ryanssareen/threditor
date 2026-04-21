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

function createMockCtx(): CanvasRenderingContext2D & {
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
} {
  return {
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    clearRect: () => {},
    putImageData: () => {},
    drawImage: () => {},
  } as unknown as CanvasRenderingContext2D & {
    globalAlpha: number;
    globalCompositeOperation: GlobalCompositeOperation;
  };
}

/** Build a TM with injected mocks for main + scratch ctx (M6). */
function makeTm(
  mainCtx?: CanvasRenderingContext2D,
  scratchCtx?: CanvasRenderingContext2D,
): TextureManager {
  return new TextureManager(
    createMockCanvas(),
    mainCtx ?? createMockCtx(),
    createMockCanvas(),
    scratchCtx ?? createMockCtx(),
  );
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
    const tm = new TextureManager(canvas, ctx, createMockCanvas(), createMockCtx());
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(64);
    tm.dispose();
  });

  it('forces imageSmoothingEnabled to false on ctx', () => {
    const ctx = createMockCtx();
    const tm = makeTm(ctx);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    tm.dispose();
  });

  it('getTexture() returns a three.js CanvasTexture', () => {
    const tm = makeTm();
    expect(tm.getTexture()).toBeInstanceOf(CanvasTexture);
    tm.dispose();
  });

  it('getContext() returns the injected ctx', () => {
    const ctx = createMockCtx();
    const tm = makeTm(ctx);
    expect(tm.getContext()).toBe(ctx);
    tm.dispose();
  });

  it('rAF coalescing — 10 markDirty() calls flip needsUpdate at most once per frame', () => {
    const tm = makeTm();
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
    const tm = makeTm(ctx);
    tm.composite([]);
    expect(clearSpy).toHaveBeenCalledWith(0, 0, 64, 64);
    tm.dispose();
  });

  it('composite([visible layer]) blits scratch via putImageData + drawImage on main (M6 D1)', () => {
    const ctx = createMockCtx();
    const scratchCtx = createMockCtx();
    const drawSpy = vi.fn();
    const scratchPutSpy = vi.fn();
    ctx.drawImage = drawSpy;
    scratchCtx.putImageData = scratchPutSpy;
    const tm = makeTm(ctx, scratchCtx);
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    const layer: Layer = {
      id: 'test', name: 'test', visible: true, opacity: 1, blendMode: 'normal', pixels,
    };
    tm.composite([layer]);
    expect(scratchPutSpy).toHaveBeenCalledTimes(1);
    expect(drawSpy).toHaveBeenCalledTimes(1);
    tm.dispose();
  });

  it('composite([invisible layer]) skips both putImageData and drawImage', () => {
    const ctx = createMockCtx();
    const scratchCtx = createMockCtx();
    const drawSpy = vi.fn();
    const scratchPutSpy = vi.fn();
    ctx.drawImage = drawSpy;
    scratchCtx.putImageData = scratchPutSpy;
    const tm = makeTm(ctx, scratchCtx);
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    const layer: Layer = {
      id: 'test', name: 'test', visible: false, opacity: 1, blendMode: 'normal', pixels,
    };
    tm.composite([layer]);
    expect(scratchPutSpy).not.toHaveBeenCalled();
    expect(drawSpy).not.toHaveBeenCalled();
    tm.dispose();
  });

  it('composite([opacity=0 layer]) skips drawImage (fast path)', () => {
    const ctx = createMockCtx();
    const drawSpy = vi.fn();
    ctx.drawImage = drawSpy;
    const tm = makeTm(ctx);
    const layer: Layer = {
      id: 'a', name: 'a', visible: true, opacity: 0, blendMode: 'normal',
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };
    tm.composite([layer]);
    expect(drawSpy).not.toHaveBeenCalled();
    tm.dispose();
  });

  it('composite() threads layer.opacity through globalAlpha on main ctx', () => {
    const ctx = createMockCtx();
    let observedAlpha = -1;
    ctx.drawImage = () => { observedAlpha = ctx.globalAlpha; };
    const tm = makeTm(ctx);
    const layer: Layer = {
      id: 'a', name: 'a', visible: true, opacity: 0.42, blendMode: 'normal',
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };
    tm.composite([layer]);
    expect(observedAlpha).toBe(0.42);
    tm.dispose();
  });

  it('composite() threads layer.blendMode through globalCompositeOperation', () => {
    const modes: Array<[Layer['blendMode'], GlobalCompositeOperation]> = [
      ['normal', 'source-over'],
      ['multiply', 'multiply'],
      ['overlay', 'overlay'],
      ['screen', 'screen'],
    ];
    for (const [blendMode, expected] of modes) {
      const ctx = createMockCtx();
      let observed: GlobalCompositeOperation | null = null;
      ctx.drawImage = () => { observed = ctx.globalCompositeOperation; };
      const tm = makeTm(ctx);
      const layer: Layer = {
        id: 'a', name: 'a', visible: true, opacity: 1, blendMode,
        pixels: new Uint8ClampedArray(64 * 64 * 4),
      };
      tm.composite([layer]);
      expect(observed).toBe(expected);
      tm.dispose();
    }
  });

  it('composite() resets globalAlpha + globalCompositeOperation after the blit', () => {
    const ctx = createMockCtx();
    const tm = makeTm(ctx);
    const layer: Layer = {
      id: 'a', name: 'a', visible: true, opacity: 0.3, blendMode: 'multiply',
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };
    tm.composite([layer]);
    expect(ctx.globalAlpha).toBe(1);
    expect(ctx.globalCompositeOperation).toBe('source-over');
    tm.dispose();
  });

  it('composite() draws each visible layer in order (bottom-to-top)', () => {
    const ctx = createMockCtx();
    const calls: string[] = [];
    ctx.drawImage = () => {
      calls.push(`alpha=${ctx.globalAlpha}|op=${ctx.globalCompositeOperation}`);
    };
    const tm = makeTm(ctx);
    const a: Layer = {
      id: 'a', name: 'a', visible: true, opacity: 1, blendMode: 'normal',
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };
    const b: Layer = {
      id: 'b', name: 'b', visible: true, opacity: 0.5, blendMode: 'multiply',
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };
    tm.composite([a, b]);
    expect(calls).toEqual([
      'alpha=1|op=source-over',
      'alpha=0.5|op=multiply',
    ]);
    tm.dispose();
  });

  it('dispose() is idempotent — calling twice does not throw', () => {
    const tm = makeTm();
    tm.dispose();
    expect(() => tm.dispose()).not.toThrow();
  });

  it('after dispose(), markDirty() accepts the call without throwing', () => {
    const tm = makeTm();
    tm.dispose();
    expect(() => tm.markDirty()).not.toThrow();
  });

  it('flushLayers() runs the composite pipeline (scratch putImageData + main drawImage)', () => {
    // M6: flushLayers is the stroke-time path; after D1 it is a full
    // composite (no fast path) so opacity/blend on non-top layers render
    // correctly during strokes.
    const ctx = createMockCtx();
    const scratchCtx = createMockCtx();
    const drawSpy = vi.fn();
    const scratchPutSpy = vi.fn();
    ctx.drawImage = drawSpy;
    scratchCtx.putImageData = scratchPutSpy;
    const tm = makeTm(ctx, scratchCtx);
    const layer: Layer = {
      id: 'test', name: 'test', visible: true, opacity: 1, blendMode: 'normal',
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };

    tm.flushLayers([layer]);
    tm.flushLayers([layer]);
    tm.flushLayers([layer]);

    expect(scratchPutSpy).toHaveBeenCalledTimes(3);
    expect(drawSpy).toHaveBeenCalledTimes(3);
    tm.dispose();
  });
});
