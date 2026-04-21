/**
 * lib/editor/tools/dispatch.ts
 *
 * M5/M6 tool dispatcher. Single entry point for pencil / eraser / bucket
 * strokes on both the 2D UV canvas and the 3D player model. Mirror
 * modifier is applied here so paint surfaces never touch mirror logic.
 *
 * Picker is NOT dispatched through strokeStart — it's a one-shot sample,
 * handled via `samplePickerAt` which surfaces call directly on
 * pointerdown (branch before strokeStart).
 *
 * M6: added `StrokeRecorder` (plan Unit 4). Every tool's writes go
 * through a single recorder that captures a pre-image at strokeStart
 * and emits a `Stroke` command with tight patches at strokeEnd. The
 * recorder is a module-scoped singleton — only one stroke can be in
 * flight at a time (cross-surface strokes are out of scope through M8).
 *
 * Hot-path contract (inherits from pencil.ts): zero allocations in
 * strokeContinue beyond a single bbox object. The expensive pieces
 * (preImage clone, two slice calls) happen once per stroke.
 */

import type { TextureManager } from '../texture';
import type { Bbox, Layer, SkinVariant, Stroke } from '../types';
import type { BrushSize, ToolId } from '../store';
import { hexDigit } from '@/lib/color/hex-digit';
import { getIslandMap, islandIdAt } from '../island-map';
import { stampLine, stampPencil } from './pencil';
import { eraseLine, stampEraser } from './eraser';
import { bucketFill } from './bucket';
import { mirrorAtlasPixel } from './mirror';
import { pickColorAt } from './picker';
import { sliceRegion, unionBbox } from '../diff';

export type StrokeContext = {
  tool: ToolId;
  /**
   * The active layer receives every stamp. Tools mutate `layer.pixels`
   * directly; the store's identity doesn't change (M6 keeps pixel writes
   * off the store per the zero-alloc pointer hot-path invariant).
   */
  layer: Layer;
  /**
   * M6: full layers array for the composite pipeline. Flushes during a
   * stroke need the whole stack so opacity/blend on non-top layers
   * render correctly. The array is the store's reference — mutations to
   * `layer.pixels` show up here because `layer` is one of the entries.
   */
  layers: readonly Layer[];
  variant: SkinVariant;
  textureManager: TextureManager;
  activeColorHex: string;
  brushSize: BrushSize;
  mirrorEnabled: boolean;
  /**
   * Called when the stroke completes with a ready-to-push command.
   * EditorLayout plumbs this into `undoStack.push`. Optional so the
   * M4-era tests that don't care about undo still work.
   */
  onStrokeCommit?: (stroke: Stroke) => void;
  /**
   * Bridges the stroke's active state into the store so the undo
   * shortcut's D10 guard can see it. Fired on strokeStart (true) and
   * strokeEnd (false). Optional.
   */
  onStrokeActive?: (active: boolean) => void;
};

/**
 * Per-stroke state. Module-scoped because only one stroke is ever in
 * flight (both paint surfaces share the same dispatcher and only one
 * `paintingRef` can be true at a time).
 */
type RecorderState = {
  layerId: string;
  tool: 'pencil' | 'eraser' | 'bucket';
  mirrored: boolean;
  /** Cloned copy of layer.pixels at strokeStart time. */
  preImage: Uint8ClampedArray;
  /** Accumulating bbox of the primary-side stamps. Null if no stamp yet. */
  bboxAccum: Bbox | null;
  /** Accumulating bbox of the mirror-side stamps. Null if no mirror stamp. */
  mirrorBboxAccum: Bbox | null;
};

let currentStroke: RecorderState | null = null;

function beginStroke(
  layer: Layer,
  tool: 'pencil' | 'eraser' | 'bucket',
  mirrored: boolean,
): void {
  currentStroke = {
    layerId: layer.id,
    tool,
    mirrored,
    preImage: new Uint8ClampedArray(layer.pixels),
    bboxAccum: null,
    mirrorBboxAccum: null,
  };
}

function accumulate(primary: Bbox | null, mirror: Bbox | null): void {
  if (currentStroke === null) return;
  if (primary !== null) {
    currentStroke.bboxAccum = unionBbox(currentStroke.bboxAccum, primary);
  }
  if (mirror !== null) {
    currentStroke.mirrorBboxAccum = unionBbox(currentStroke.mirrorBboxAccum, mirror);
  }
}

function commitStroke(layer: Layer, onStrokeCommit?: (stroke: Stroke) => void): Stroke | null {
  if (currentStroke === null) return null;
  const state = currentStroke;
  currentStroke = null;
  if (state.bboxAccum === null) return null; // nothing changed (shouldn't happen post-strokeStart)

  const patches = [
    {
      bbox: state.bboxAccum,
      before: sliceRegion(state.preImage, state.bboxAccum),
      after: sliceRegion(layer.pixels, state.bboxAccum),
    },
  ];
  if (state.mirrored && state.mirrorBboxAccum !== null) {
    patches.push({
      bbox: state.mirrorBboxAccum,
      before: sliceRegion(state.preImage, state.mirrorBboxAccum),
      after: sliceRegion(layer.pixels, state.mirrorBboxAccum),
    });
  }
  const stroke: Stroke = {
    id: newStrokeId(),
    layerId: state.layerId,
    patches,
    tool: state.tool,
    mirrored: state.mirrored,
  };
  onStrokeCommit?.(stroke);
  return stroke;
}

/** Visible for tests; resets module-scoped state between test runs. */
export function resetStrokeRecorder(): void {
  currentStroke = null;
}

function newStrokeId(): string {
  // crypto.randomUUID is standard-lib in modern browsers + Node 19+.
  // Falls back to a simple timestamp+random string if unavailable.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Compute the tight bbox of an N×N stamp centered at (cx, cy). Matches
 * the stampPencil/stampEraser clip convention (halfLeft=1 for size>1,
 * 0 for size=1; clipped to [0, 64)).
 */
function stampBbox(cx: number, cy: number, size: BrushSize): Bbox | null {
  const halfLeft = size === 1 ? 0 : 1;
  const rawX0 = cx - halfLeft;
  const rawY0 = cy - halfLeft;
  const rawX1 = rawX0 + size;
  const rawY1 = rawY0 + size;
  const x0 = rawX0 < 0 ? 0 : rawX0;
  const y0 = rawY0 < 0 ? 0 : rawY0;
  const x1 = rawX1 > 64 ? 64 : rawX1;
  const y1 = rawY1 > 64 ? 64 : rawY1;
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Compute the tight bbox of a Bresenham line segment rendered at
 * brush size N. This is the envelope of stampBbox(from) + stampBbox(to)
 * grown by (size - halfLeft) on each axis in case the Bresenham
 * intermediate pixels expand the bounds — but for rectilinear lines
 * the start+end stamps' envelope already covers all intermediate stamps
 * because stampLine just calls stampPencil along the Bresenham path.
 */
function lineBbox(
  fromX: number, fromY: number, toX: number, toY: number, size: BrushSize,
): Bbox | null {
  const a = stampBbox(fromX, fromY, size);
  const b = stampBbox(toX, toY, size);
  if (a === null) return b;
  if (b === null) return a;
  return unionBbox(a, b);
}

/**
 * Bucket-fill touches the entire seed island. The cheapest tight bbox
 * is "scan the island map for cells matching seed island id" — but
 * that's 4096 comparisons per fill. An upper-bound alternative: the
 * full atlas bbox (64×64) — always correct, always tight-enough for
 * the 5 MB budget since body-front = 96 px and even the full atlas is
 * only 16 KB before + 16 KB after = 32 KB per bucket stroke.
 *
 * We take the scan-for-tight-bbox approach because mirror bucket
 * produces two disjoint rects on different limbs; spanning them would
 * waste memory per D2.
 */
function bucketFillBbox(
  variant: SkinVariant, seedX: number, seedY: number,
): Bbox | null {
  const islandMap = getIslandMap(variant);
  const seedId = islandIdAt(islandMap, seedX, seedY);
  if (seedId === 0) return null;

  let minX = 64, minY = 64, maxX = -1, maxY = -1;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (islandMap[y * 64 + x] === seedId) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Apply the first stamp of a stroke at atlas (x, y).
 *
 * Returns `true` when pixels were changed (caller uses this to gate
 * commitToRecents). For bucket, returns false if the seed is outside
 * any island.
 */
export function strokeStart(ctx: StrokeContext, x: number, y: number): boolean {
  const { tool, layer, layers, variant, textureManager, activeColorHex, brushSize, mirrorEnabled } = ctx;

  if (tool === 'picker') return false;

  const hex = activeColorHex;
  const r = (hexDigit(hex, 1) << 4) | hexDigit(hex, 2);
  const g = (hexDigit(hex, 3) << 4) | hexDigit(hex, 4);
  const b = (hexDigit(hex, 5) << 4) | hexDigit(hex, 6);

  const mirror = mirrorEnabled ? mirrorAtlasPixel(variant, x, y) : null;

  // For bucket we need to know up-front whether a stamp will actually
  // land (the seed may be outside every island). Check via the island
  // map; return false before any allocation if the seed is unused.
  if (tool === 'bucket') {
    if (getIslandMap(variant)[y * 64 + x] === 0) return false;
  }

  // CRITICAL: clone the pre-image BEFORE any pixel write. The recorder's
  // `before` patches slice from this clone so undo restores the pre-
  // stroke state correctly.
  beginStroke(layer, tool as 'pencil' | 'eraser' | 'bucket', mirror !== null);

  let primaryBbox: Bbox | null = null;
  let mirrorBbox: Bbox | null = null;

  if (tool === 'pencil') {
    stampPencil(layer.pixels, x, y, brushSize, r, g, b);
    primaryBbox = stampBbox(x, y, brushSize);
    if (mirror !== null) {
      stampPencil(layer.pixels, mirror.x, mirror.y, brushSize, r, g, b);
      mirrorBbox = stampBbox(mirror.x, mirror.y, brushSize);
    }
  } else if (tool === 'eraser') {
    stampEraser(layer.pixels, x, y, brushSize);
    primaryBbox = stampBbox(x, y, brushSize);
    if (mirror !== null) {
      stampEraser(layer.pixels, mirror.x, mirror.y, brushSize);
      mirrorBbox = stampBbox(mirror.x, mirror.y, brushSize);
    }
  } else if (tool === 'bucket') {
    const islandMap = getIslandMap(variant);
    bucketFill(layer.pixels, islandMap, x, y, r, g, b);
    primaryBbox = bucketFillBbox(variant, x, y);
    if (mirror !== null) {
      bucketFill(layer.pixels, islandMap, mirror.x, mirror.y, r, g, b);
      mirrorBbox = bucketFillBbox(variant, mirror.x, mirror.y);
    }
  }

  const changed = primaryBbox !== null;
  if (!changed) {
    // Rollback the recorder; nothing changed (shouldn't happen post-bucket
    // island check, but defensive).
    resetStrokeRecorder();
    return false;
  }

  accumulate(primaryBbox, mirrorBbox);
  ctx.onStrokeActive?.(true);
  textureManager.flushLayers(layers);
  return true;
}

/**
 * Apply a continuation segment from the previous stamp to (toX, toY).
 * For pencil/eraser this is a Bresenham-filled line; for bucket it's a
 * no-op (bucket is stroke-start-only, not a drag).
 */
export function strokeContinue(
  ctx: StrokeContext,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  const { tool, layer, layers, variant, textureManager, activeColorHex, brushSize, mirrorEnabled } = ctx;

  if (tool === 'bucket' || tool === 'picker') return;

  const hex = activeColorHex;
  const r = (hexDigit(hex, 1) << 4) | hexDigit(hex, 2);
  const g = (hexDigit(hex, 3) << 4) | hexDigit(hex, 4);
  const b = (hexDigit(hex, 5) << 4) | hexDigit(hex, 6);

  let primaryBbox: Bbox | null = null;
  let mirrorBbox: Bbox | null = null;

  if (tool === 'pencil') {
    stampLine(layer.pixels, fromX, fromY, toX, toY, brushSize, r, g, b);
    primaryBbox = lineBbox(fromX, fromY, toX, toY, brushSize);
    if (mirrorEnabled) {
      const mFrom = mirrorAtlasPixel(variant, fromX, fromY);
      const mTo = mirrorAtlasPixel(variant, toX, toY);
      if (mFrom !== null && mTo !== null) {
        stampLine(layer.pixels, mFrom.x, mFrom.y, mTo.x, mTo.y, brushSize, r, g, b);
        mirrorBbox = lineBbox(mFrom.x, mFrom.y, mTo.x, mTo.y, brushSize);
      }
    }
  } else if (tool === 'eraser') {
    eraseLine(layer.pixels, fromX, fromY, toX, toY, brushSize);
    primaryBbox = lineBbox(fromX, fromY, toX, toY, brushSize);
    if (mirrorEnabled) {
      const mFrom = mirrorAtlasPixel(variant, fromX, fromY);
      const mTo = mirrorAtlasPixel(variant, toX, toY);
      if (mFrom !== null && mTo !== null) {
        eraseLine(layer.pixels, mFrom.x, mFrom.y, mTo.x, mTo.y, brushSize);
        mirrorBbox = lineBbox(mFrom.x, mFrom.y, mTo.x, mTo.y, brushSize);
      }
    }
  }

  accumulate(primaryBbox, mirrorBbox);
  textureManager.flushLayers(layers);
}

/**
 * Close out the active stroke. Slices pre- and post-image bytes for
 * each patch, builds the Stroke record, and hands it to
 * `onStrokeCommit`. Also flips `onStrokeActive(false)`.
 */
export function strokeEnd(ctx: StrokeContext): Stroke | null {
  const stroke = commitStroke(ctx.layer, ctx.onStrokeCommit);
  ctx.onStrokeActive?.(false);
  return stroke;
}

/**
 * One-shot sampler for the picker tool / Alt-hold modifier. Surfaces
 * call this directly on pointerdown and skip strokeStart when they do.
 */
export function samplePickerAt(
  layer: Layer,
  x: number,
  y: number,
): { hex: string; alpha: number } | null {
  return pickColorAt(layer.pixels, x, y);
}
