/**
 * M6: dirty-rect diff helpers for the undo stack + stroke recorder.
 *
 * `sliceRegion` extracts the RGBA bytes of a bbox from a full-atlas
 * pixel buffer; `applyRegion` writes them back. Round-trip is bit-
 * identical: `applyRegion(pixels, bbox, sliceRegion(pixels, bbox))`
 * leaves pixels unchanged.
 *
 * `unionBbox` grows one bbox to include another — used by the stroke
 * recorder to accumulate the touched region across a Bresenham drag.
 *
 * None of these helpers allocate inside the inner loop; `sliceRegion`
 * allocates its return array once, which is acceptable because callers
 * invoke it at stroke-end only, not per pointer event.
 */

import { SKIN_ATLAS_SIZE } from '@/lib/three/constants';
import type { Bbox } from './types';

/**
 * Copy the RGBA bytes of `bbox` out of a full 64×64 pixel buffer into a
 * fresh `Uint8ClampedArray` of length `bbox.w * bbox.h * 4`. The caller
 * owns the returned buffer; subsequent writes to `pixels` do not affect it.
 *
 * Caller guarantees bbox is clipped to the atlas. Out-of-range bboxes
 * produce undefined content (no bounds check in the hot path).
 */
export function sliceRegion(
  pixels: Uint8ClampedArray,
  bbox: Bbox,
): Uint8ClampedArray {
  const { x, y, w, h } = bbox;
  const out = new Uint8ClampedArray(w * h * 4);
  if (w === 0 || h === 0) return out;
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * SKIN_ATLAS_SIZE + x) * 4;
    const dstStart = row * w * 4;
    out.set(pixels.subarray(srcStart, srcStart + w * 4), dstStart);
  }
  return out;
}

/**
 * Blit a region back into a full 64×64 pixel buffer at `bbox`. The
 * `region` length must equal `bbox.w * bbox.h * 4`. Used by the undo
 * stack to restore `before` (undo) or `after` (redo) pixels.
 */
export function applyRegion(
  pixels: Uint8ClampedArray,
  bbox: Bbox,
  region: Uint8ClampedArray,
): void {
  const { x, y, w, h } = bbox;
  if (w === 0 || h === 0) return;
  for (let row = 0; row < h; row++) {
    const srcStart = row * w * 4;
    const dstStart = ((y + row) * SKIN_ATLAS_SIZE + x) * 4;
    pixels.set(region.subarray(srcStart, srcStart + w * 4), dstStart);
  }
}

/**
 * Expand `acc` to include `next`. Returns a fresh bbox; does not mutate.
 * `null` acc means "first contribution" and returns `next` directly.
 */
export function unionBbox(acc: Bbox | null, next: Bbox): Bbox {
  if (next.w === 0 || next.h === 0) return acc ?? next;
  if (acc === null) return { x: next.x, y: next.y, w: next.w, h: next.h };
  const x0 = acc.x < next.x ? acc.x : next.x;
  const y0 = acc.y < next.y ? acc.y : next.y;
  const accRight = acc.x + acc.w;
  const accBottom = acc.y + acc.h;
  const nextRight = next.x + next.w;
  const nextBottom = next.y + next.h;
  const x1 = accRight > nextRight ? accRight : nextRight;
  const y1 = accBottom > nextBottom ? accBottom : nextBottom;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
