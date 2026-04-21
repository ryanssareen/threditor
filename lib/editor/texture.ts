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
import type { BlendMode } from './store';
import type { Layer } from './types';

/**
 * M6: maps our four supported blend modes to Canvas2D globalCompositeOperation
 * strings. Record<BlendMode, ...> enforces exhaustiveness at compile time — if
 * a BlendMode member is added without a mapping here, TS errors at build.
 */
const BLEND_MODE_MAP: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  overlay: 'overlay',
  screen: 'screen',
};

export class TextureManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  // M6: scratch canvas for the composite pipeline. We blit each layer's
  // pixels into the scratch via putImageData (which bypasses globalAlpha
  // + globalCompositeOperation per WHATWG §4.12.5.1.14), then drawImage
  // the scratch onto this.ctx — drawImage DOES honor both. Plan D1.
  private readonly scratchCanvas: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;
  private dirty = false;
  private rafHandle: number | null = null;
  private disposed = false;

  constructor(
    canvas?: HTMLCanvasElement,
    ctx?: CanvasRenderingContext2D,
    scratchCanvas?: HTMLCanvasElement,
    scratchCtx?: CanvasRenderingContext2D,
  ) {
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

    // Scratch canvas for the composite pipeline (D1). Tests may inject
    // mocks via the optional parameters; production passes nothing and
    // a fresh off-DOM canvas + context is created here.
    this.scratchCanvas = scratchCanvas ?? document.createElement('canvas');
    this.scratchCanvas.width = SKIN_ATLAS_SIZE;
    this.scratchCanvas.height = SKIN_ATLAS_SIZE;
    const resolvedScratchCtx =
      scratchCtx ??
      this.scratchCanvas.getContext('2d', { willReadFrequently: true });
    if (resolvedScratchCtx === null) {
      throw new Error('TextureManager: failed to obtain scratch 2D context');
    }
    this.scratchCtx = resolvedScratchCtx;
    this.scratchCtx.imageSmoothingEnabled = false;

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
   * Clear the offscreen canvas and blit each visible layer's pixel buffer
   * with the correct opacity + blend mode.
   *
   * M6 (plan D1): putImageData bypasses globalAlpha AND
   * globalCompositeOperation (WHATWG HTML §4.12.5.1.14). The M3–M5 code
   * path worked because we only ever had one layer at opacity=1 /
   * blendMode='normal'. Now we blit each layer into a reused scratch
   * canvas via putImageData and then drawImage the scratch onto this.ctx
   * — drawImage DOES honor both properties.
   *
   * Allocates one ImageData per visible layer. Acceptable because
   * composite() runs on stroke-end + metadata changes, not per move.
   */
  composite(layers: readonly Layer[]): void {
    this.ctx.clearRect(0, 0, SKIN_ATLAS_SIZE, SKIN_ATLAS_SIZE);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    for (const layer of layers) {
      if (!layer.visible) continue;
      if (layer.opacity <= 0) continue;
      // Blit the raw pixels into the scratch canvas (bypassing the parent
      // ctx's alpha/composite state — putImageData ignores them anyway).
      this.scratchCtx.putImageData(
        new ImageData(layer.pixels, SKIN_ATLAS_SIZE, SKIN_ATLAS_SIZE),
        0,
        0,
      );
      // Now drawImage onto the main ctx with the layer's opacity + blend.
      this.ctx.globalAlpha = layer.opacity;
      this.ctx.globalCompositeOperation = BLEND_MODE_MAP[layer.blendMode];
      this.ctx.drawImage(this.scratchCanvas, 0, 0);
    }
    // Reset context state for any subsequent consumer (flushLayer et al.).
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
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
   * Hot-path canvas update during a stroke. M3–M5 had a single-layer fast
   * path (putImageData direct to main ctx) that bypassed opacity + blend.
   * M6 can't do that — opacity<1 or blendMode≠'normal' on a non-top layer
   * would flash raw pixels through during the stroke. So flushLayers now
   * runs the full multi-layer composite path. The cost (4 allocations +
   * 4 drawImage per move at 4 layers) is negligible at 64×64.
   *
   * Kept separate from composite() so callers can be explicit about the
   * stroke-time-vs-stroke-end distinction even though the implementations
   * are identical; if a future optimization reintroduces a fast path, only
   * flushLayers changes.
   */
  flushLayers(layers: readonly Layer[]): void {
    this.composite(layers);
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
