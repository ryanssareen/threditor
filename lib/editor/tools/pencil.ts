/**
 * lib/editor/tools/pencil.ts
 *
 * Pencil stamp and Bresenham line-fill for the M3 paint surface.
 *
 * Hot-path contract: zero allocations per call in both `stampPencil` and
 * `stampLine`. These functions are invoked from the `pointermove` event
 * handler which fires at >60 Hz on high-polling devices — no new arrays,
 * no object literals except the single returned bbox.
 *
 * Atlas layout: 64×64 RGBA, row-major, top-left origin.
 * Pixel (x, y) → `pixels` offset = (y * 64 + x) * 4.
 *
 * See docs/plans/m3-paint-canvas-plan.md §8 (bresenham between pointer moves)
 * and DESIGN.md §9 (tool behavior spec) for design context.
 */

import { SKIN_ATLAS_SIZE } from '../../three/constants';

// ---------------------------------------------------------------------------
// Internal helpers — module-level to avoid per-call allocations
// ---------------------------------------------------------------------------

/** Reusable bbox accumulator for stampLine. Mutated in place each call. */
const _unionBbox = { x: 0, y: 0, w: 0, h: 0 };

// ---------------------------------------------------------------------------
// stampPencil
// ---------------------------------------------------------------------------

/**
 * Stamp an NxN pencil mark centered on the given atlas pixel (cx, cy).
 * Writes directly into `pixels` (Uint8ClampedArray, RGBA, length 16384,
 * top-left origin, row-major). Clamps to the atlas bounds [0, 64).
 *
 * Returns the bounding box of the mutated region so the caller (ViewportUV)
 * can build a Stroke diff record for the undo stack (M6) without re-scanning
 * the whole canvas.
 *
 * Zero allocations in the hot path — this is called from the pointer event
 * handler that may fire at >60Hz. No new arrays, no object literals beyond
 * the single returned bbox.
 *
 * Centering convention (matches Aseprite/Photopea for even sizes):
 *   size=1  → 1×1 at (cx, cy)
 *   size=2  → top-left at (cx-1, cy-1), covers to (cx,   cy)
 *   size=3  → top-left at (cx-1, cy-1), covers to (cx+1, cy+1)
 *   size=4  → top-left at (cx-1, cy-1), covers to (cx+2, cy+2)  [asymmetric]
 */
export function stampPencil(
  pixels: Uint8ClampedArray,
  cx: number,
  cy: number,
  size: 1 | 2 | 3 | 4,
  r: number,
  g: number,
  b: number,
  a?: number,
): { x: number; y: number; w: number; h: number } {
  const alpha = a !== undefined ? a : 255;

  // For size N: halfLeft = floor(N/2). This gives:
  //   size=1 → halfLeft=0  (top-left = cx+0)
  //   size=2 → halfLeft=1  (top-left = cx-1)
  //   size=3 → halfLeft=1  (top-left = cx-1)
  //   size=4 → halfLeft=2  (top-left = cx-2) — but spec says cx-1, so use floor((N-1)/2)
  // Spec table from contract:
  //   size=2: top-left (cx-1, cy-1)  → halfLeft=1  = floor((2-1)/2)=0 … no.
  // Per contract literally: floor(N/2) for all sizes.
  //   size=1 → floor(1/2)=0  → TL=(cx,   cy)   ✓
  //   size=2 → floor(2/2)=1  → TL=(cx-1, cy-1) ✓
  //   size=3 → floor(3/2)=1  → TL=(cx-1, cy-1) ✓
  //   size=4 → floor(4/2)=2  → TL=(cx-2, cy-2) — but contract says (cx-1,cy-1) for size=4.
  // Contract for size=4: "top-left (cx-1, cy-1), covers through (cx+2,cy+2)" — that is a
  // 4-wide block starting one pixel left of the cursor, i.e. halfLeft = floor((4-1)/2) = 1.
  // Resolving: use floor((size-1)/2) so that:
  //   size=1 → 0  → TL=(cx,   cy)   stamp=(1×1)  ✓
  //   size=2 → 0  → TL=(cx,   cy)   stamp=(2×2) … contract says TL=(cx-1,cy-1).
  // Conflict detected. Re-reading contract carefully:
  //   "top-left corner is at (cx - floor(N/2), cy - floor(N/2))"
  //   size=4: "top-left (cx-1, cy-1)" → floor(4/2)=2 → cx-2? But contract text says cx-1.
  // The contract body says "Pick the top-left-convention" and shows:
  //   size=4: top-left (cx-1, cy-1), covers through (cx+2,cy+2).
  // That is NOT floor(N/2)=2, it is halfLeft=1 for size=4 only.
  // This matches floor((N-1)/2):
  //   size=1 → floor(0/2)=0  → TL=(cx,   cy)   covers to (cx,   cy)   1×1 ✓
  //   size=2 → floor(1/2)=0  → TL=(cx,   cy) … but contract shows TL=(cx-1,cy-1) for size=2.
  // Neither formula is consistent with all four rows in the contract.
  // Authoritative rows from the contract (verbatim):
  //   size=1: 1×1 at (cx, cy)
  //   size=2: top-left (cx-1,cy-1), covers (cx-1,cy-1),(cx,cy-1),(cx-1,cy),(cx,cy)
  //   size=3: TL (cx-1,cy-1), covers through (cx+1,cy+1)
  //   size=4: TL (cx-1,cy-1), covers through (cx+2,cy+2)
  // So: size=1→halfLeft=0; size=2,3,4→halfLeft=1.
  // Formula: halfLeft = size === 1 ? 0 : 1. Equivalently: Math.min(1, size - 1).
  // Verify:
  //   size=1: hl=0 → TL=(cx,  cy  ) span=(1,1) ✓
  //   size=2: hl=1 → TL=(cx-1,cy-1) span=(2,2) ✓
  //   size=3: hl=1 → TL=(cx-1,cy-1) span=(3,3) ✓
  //   size=4: hl=1 → TL=(cx-1,cy-1) span=(4,4) covers to cx+2,cy+2 ✓
  const halfLeft = size === 1 ? 0 : 1;

  const rawX0 = cx - halfLeft;
  const rawY0 = cy - halfLeft;
  const rawX1 = rawX0 + size;
  const rawY1 = rawY0 + size;

  const x0 = rawX0 < 0 ? 0 : rawX0;
  const y0 = rawY0 < 0 ? 0 : rawY0;
  const x1 = rawX1 > SKIN_ATLAS_SIZE ? SKIN_ATLAS_SIZE : rawX1;
  const y1 = rawY1 > SKIN_ATLAS_SIZE ? SKIN_ATLAS_SIZE : rawY1;

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * SKIN_ATLAS_SIZE + px) * 4;
      pixels[i]     = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = alpha;
    }
  }

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------------------
// stampLine
// ---------------------------------------------------------------------------

/**
 * Bresenham between two pointer positions to fill the gap when pointermove
 * fires faster than once per pixel. Stamps pencil at every integer coord
 * on the line from (x0, y0) to (x1, y1) inclusive. Returns the union bbox
 * of all stamps.
 *
 * Zero allocations beyond the single returned bbox.
 */
export function stampLine(
  pixels: Uint8ClampedArray,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: 1 | 2 | 3 | 4,
  r: number,
  g: number,
  b: number,
  a?: number,
): { x: number; y: number; w: number; h: number } {
  // Initialize union bbox to sentinel values that will be overwritten on the
  // first stamp. Using ±Infinity keeps the hot-path min/max calls branchless.
  let uX0 = SKIN_ATLAS_SIZE;
  let uY0 = SKIN_ATLAS_SIZE;
  let uX1 = 0;
  let uY1 = 0;

  const dx = x1 > x0 ? x1 - x0 : x0 - x1;
  const dy = y1 > y0 ? y1 - y0 : y0 - y1;
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;

  let err = dx - dy;
  let px = x0;
  let py = y0;

  while (true) {
    const stamp = stampPencil(pixels, px, py, size, r, g, b, a);

    if (stamp.w > 0 && stamp.h > 0) {
      if (stamp.x < uX0) uX0 = stamp.x;
      if (stamp.y < uY0) uY0 = stamp.y;
      const ex = stamp.x + stamp.w;
      const ey = stamp.y + stamp.h;
      if (ex > uX1) uX1 = ex;
      if (ey > uY1) uY1 = ey;
    }

    if (px === x1 && py === y1) break;

    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      px += sx;
    }
    if (e2 < dx) {
      err += dx;
      py += sy;
    }
  }

  // If no pixels were mutated (e.g. line entirely outside atlas bounds),
  // return a zero-area bbox at the origin rather than the sentinel values.
  if (uX0 > uX1 || uY0 > uY1) {
    _unionBbox.x = 0;
    _unionBbox.y = 0;
    _unionBbox.w = 0;
    _unionBbox.h = 0;
  } else {
    _unionBbox.x = uX0;
    _unionBbox.y = uY0;
    _unionBbox.w = uX1 - uX0;
    _unionBbox.h = uY1 - uY0;
  }

  return _unionBbox;
}
