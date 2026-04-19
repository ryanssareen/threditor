/**
 * M3: TextureManager — owns the offscreen 64x64 canvas, the three.js
 * CanvasTexture fed to PlayerModel, and the rAF-coalesced dirty flag
 * that batches GPU uploads to at most one per frame.
 *
 * Contract (docs/DESIGN.md §7):
 *
 *   - `composite(layers)` clears the ctx and blits each visible layer's
 *     pixel buffer. Single M3 layer = one putImageData call; M6 extends
 *     to multi-layer with blendModes + opacity.
 *   - `markDirty()` is a primitive-write-only fast path; call from every
 *     pencil stamp. The rAF loop flips `texture.needsUpdate = true` at
 *     most once per frame regardless of how many markDirty() calls came
 *     in since the last tick.
 *   - Zero allocations in `markDirty()` and in the rAF tick. The only
 *     allocation in the class is `new ImageData(...)` inside composite(),
 *     which is called per-stroke-commit (not per-pointer-move).
 *   - `dispose()` cancels the rAF loop and disposes the CanvasTexture.
 *     Called from EditorCanvas's useEffect cleanup when the component
 *     unmounts or variant changes — per the M2 caller-owned GPU resource
 *     contract (docs/solutions/performance-issues/
 *     r3f-geometry-prop-disposal-2026-04-18.md).
 *
 * Amendment 1 (plan review): the constructor accepts optional canvas +
 * ctx parameters so tests can inject mocks. jsdom's missing
 * CanvasRenderingContext2D is sidestepped entirely — production code
 * behavior is unchanged because defaults are created when parameters
 * are omitted.
 */

import { CanvasTexture, NearestFilter } from 'three';

import { SKIN_ATLAS_SIZE } from '@/lib/three/constants';
import type { Layer } from './types';

export class TextureManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private dirty = false;
  private rafHandle: number | null = null;
  private disposed = false;
  private cachedImageData: ImageData | null = null;

  constructor(canvas?: HTMLCanvasElement, ctx?: CanvasRenderingContext2D) {
    this.canvas = canvas ?? document.createElement('canvas');
    this.canvas.width = SKIN_ATLAS_SIZE;
    this.canvas.height = SKIN_ATLAS_SIZE;

    const providedOrDefaultCtx =
      ctx ??
      this.canvas.getContext('2d', { willReadFrequently: true });
    if (providedOrDefaultCtx === null) {
      throw new Error('TextureManager: failed to obtain 2D canvas context');
    }
    this.ctx = providedOrDefaultCtx;
    this.ctx.imageSmoothingEnabled = false;

    this.texture = new CanvasTexture(this.canvas);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;

    this.startRAFLoop();
  }

  /** The three.js texture to pass into `<mesh map={...}>` material slots. */
  getTexture(): CanvasTexture {
    return this.texture;
  }

  /** Exposed for pencil/eraser direct writes that don't go through composite(). */
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * The underlying offscreen canvas. ViewportUV mounts this element into
   * its DOM tree so the 2D display is the same pixel buffer the 3D side
   * samples from — no redundant blits. CSS `transform: scale()` + `image-
   * rendering: pixelated` on a wrapper provides zoom without re-drawing.
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Clear the offscreen canvas and blit each visible layer's pixel buffer.
   * For M3 with a single layer this is a single putImageData call. M6
   * extends to honoring `opacity` and `blendMode` per layer.
   *
   * Allocates one ImageData per visible layer per call. Acceptable because
   * `composite()` is called per-stroke-commit, not per-pointer-move.
   */
  composite(layers: readonly Layer[]): void {
    this.ctx.clearRect(0, 0, SKIN_ATLAS_SIZE, SKIN_ATLAS_SIZE);
    for (const layer of layers) {
      if (!layer.visible) continue;
      // M3: single layer, opacity=1, blendMode='normal'. M6 extends this
      // with globalAlpha + globalCompositeOperation mapping.
      const imageData = new ImageData(
        layer.pixels,
        SKIN_ATLAS_SIZE,
        SKIN_ATLAS_SIZE,
      );
      this.ctx.putImageData(imageData, 0, 0);
    }
    this.markDirty();
  }

  /**
   * Primitive-write fast path. Safe to call from pointer hot loops at any
   * rate — the rAF tick coalesces multiple dirty flips into one GPU upload.
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Hot-path canvas update: copies `layer.pixels` into a pre-allocated
   * ImageData (one heap allocation on first call; zero allocations on every
   * subsequent call) and flushes to ctx. Use this in pointer-down/move
   * handlers. Call composite() once at pointer-up for the authoritative
   * multi-layer blit.
   */
  flushLayer(layer: Layer): void {
    if (this.cachedImageData === null) {
      this.cachedImageData = new ImageData(
        new Uint8ClampedArray(SKIN_ATLAS_SIZE * SKIN_ATLAS_SIZE * 4),
        SKIN_ATLAS_SIZE,
        SKIN_ATLAS_SIZE,
      );
    }
    this.cachedImageData.data.set(layer.pixels);
    this.ctx.putImageData(this.cachedImageData, 0, 0);
    this.dirty = true;
  }

  /**
   * Cancel the rAF loop and dispose the underlying CanvasTexture. After
   * dispose(), the instance is inert — further `markDirty()` / `composite()`
   * calls are silent no-ops (the dirty flag still flips but no rAF tick
   * will consume it).
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.texture.dispose();
  }

  private startRAFLoop(): void {
    const tick = (): void => {
      if (this.disposed) return;
      if (this.dirty) {
        this.texture.needsUpdate = true;
        this.dirty = false;
      }
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }
}
