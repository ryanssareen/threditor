/**
 * lib/editor/tools/dispatch.ts
 *
 * M5 tool dispatcher. Single entry point for pencil / eraser / bucket
 * strokes on both the 2D UV canvas and the 3D player model. Mirror
 * modifier is applied here so paint surfaces never touch mirror logic.
 *
 * Picker is NOT dispatched through strokeStart — it's a one-shot sample,
 * handled via `samplePickerAt` which surfaces call directly on
 * pointerdown (branch before strokeStart).
 *
 * Hot-path contract (inherits from pencil.ts): zero allocations per call
 * beyond what the underlying stamp functions already allocate (localBbox
 * in stampLine/eraseLine). Dispatcher adds no hidden allocations.
 */

import type { TextureManager } from '../texture';
import type { Layer, SkinVariant } from '../types';
import type { BrushSize, ToolId } from '../store';
import { hexDigit } from '@/lib/color/hex-digit';
import { getIslandMap } from '../island-map';
import { stampLine, stampPencil } from './pencil';
import { eraseLine, stampEraser } from './eraser';
import { bucketFill } from './bucket';
import { mirrorAtlasPixel } from './mirror';
import { pickColorAt } from './picker';

export type StrokeContext = {
  tool: ToolId;
  layer: Layer;
  variant: SkinVariant;
  textureManager: TextureManager;
  activeColorHex: string;
  brushSize: BrushSize;
  mirrorEnabled: boolean;
};

/**
 * Apply the first stamp of a stroke at atlas (x, y).
 *
 * Returns `true` when pixels were changed (caller uses this to gate
 * commitToRecents). For bucket, returns false if the seed is outside
 * any island. For pencil/eraser, always returns true (the stamp always
 * touches at least one pixel unless it's fully out of bounds — tolerable
 * because commitToRecents is idempotent with same-color head dedup).
 */
export function strokeStart(ctx: StrokeContext, x: number, y: number): boolean {
  const { tool, layer, variant, textureManager, activeColorHex, brushSize, mirrorEnabled } = ctx;

  const hex = activeColorHex;
  const r = (hexDigit(hex, 1) << 4) | hexDigit(hex, 2);
  const g = (hexDigit(hex, 3) << 4) | hexDigit(hex, 4);
  const b = (hexDigit(hex, 5) << 4) | hexDigit(hex, 6);

  let changed = false;

  if (tool === 'pencil') {
    stampPencil(layer.pixels, x, y, brushSize, r, g, b);
    changed = true;
    if (mirrorEnabled) {
      const m = mirrorAtlasPixel(variant, x, y);
      if (m !== null) stampPencil(layer.pixels, m.x, m.y, brushSize, r, g, b);
    }
  } else if (tool === 'eraser') {
    stampEraser(layer.pixels, x, y, brushSize);
    changed = true;
    if (mirrorEnabled) {
      const m = mirrorAtlasPixel(variant, x, y);
      if (m !== null) stampEraser(layer.pixels, m.x, m.y, brushSize);
    }
  } else if (tool === 'bucket') {
    const islandMap = getIslandMap(variant);
    const res = bucketFill(layer.pixels, islandMap, x, y, r, g, b);
    changed = res.changed;
    if (changed && mirrorEnabled) {
      const m = mirrorAtlasPixel(variant, x, y);
      if (m !== null) {
        bucketFill(layer.pixels, islandMap, m.x, m.y, r, g, b);
      }
    }
  } else {
    // tool === 'picker' — never dispatched through strokeStart.
    return false;
  }

  if (changed) textureManager.flushLayer(layer);
  return changed;
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
  const { tool, layer, variant, textureManager, activeColorHex, brushSize, mirrorEnabled } = ctx;

  if (tool === 'bucket' || tool === 'picker') return;

  const hex = activeColorHex;
  const r = (hexDigit(hex, 1) << 4) | hexDigit(hex, 2);
  const g = (hexDigit(hex, 3) << 4) | hexDigit(hex, 4);
  const b = (hexDigit(hex, 5) << 4) | hexDigit(hex, 6);

  if (tool === 'pencil') {
    stampLine(layer.pixels, fromX, fromY, toX, toY, brushSize, r, g, b);
    if (mirrorEnabled) {
      const mFrom = mirrorAtlasPixel(variant, fromX, fromY);
      const mTo = mirrorAtlasPixel(variant, toX, toY);
      if (mFrom !== null && mTo !== null) {
        stampLine(layer.pixels, mFrom.x, mFrom.y, mTo.x, mTo.y, brushSize, r, g, b);
      }
    }
  } else if (tool === 'eraser') {
    eraseLine(layer.pixels, fromX, fromY, toX, toY, brushSize);
    if (mirrorEnabled) {
      const mFrom = mirrorAtlasPixel(variant, fromX, fromY);
      const mTo = mirrorAtlasPixel(variant, toX, toY);
      if (mFrom !== null && mTo !== null) {
        eraseLine(layer.pixels, mFrom.x, mFrom.y, mTo.x, mTo.y, brushSize);
      }
    }
  }

  textureManager.flushLayer(layer);
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
