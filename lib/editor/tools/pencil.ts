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
// stampPencil
// ---------------------------------------------------------------------------

/**
 * Stamp an NxN pencil mark centered on the given atlas pixel (cx, cy).
 * Writes directly into `pixels` (Uint8ClampedArray, RGBA, length 16384,
 * top-left origin, row-major). Clamps to the atlas bounds [0, 64).
 *
 * When `outBbox` is provided it is mutated in place with the bounding box
 * of the drawn region — use this from stampLine's inner loop so no per-pixel
 * object is allocated. Callers that need the bbox for the M6 undo stack
 * should pre-allocate one `{ x, y, w, h }` object and reuse it across calls.
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
  outBbox?: { x: number; y: number; w: number; h: number },
): void {
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

  if (outBbox !== undefined) {
    outBbox.x = x0;
    outBbox.y = y0;
    outBbox.w = x1 - x0;
    outBbox.h = y1 - y0;
  }
}

// ---------------------------------------------------------------------------
// stampLine
// ---------------------------------------------------------------------------

/**
 * Bresenham between two pointer positions to fill the gap when pointermove
 * fires faster than once per pixel. Stamps pencil at every integer coord
 * on the line from (x0, y0) to (x1, y1) inclusive.
 *
 * When `outBbox` is provided it is mutated in place with the union bbox of
 * all stamps. One local bbox object is allocated per call (not per pixel)
 * and reused in the inner loop — no module-level mutable state.
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
  outBbox?: { x: number; y: number; w: number; h: number },
): void {
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

  // One bbox object per stampLine call, reused across all inner stampPencil
  // calls — eliminates the per-pixel allocation the old return-value path had.
  const localBbox = { x: 0, y: 0, w: 0, h: 0 };

  while (true) {
    stampPencil(pixels, px, py, size, r, g, b, a, localBbox);

    if (localBbox.w > 0 && localBbox.h > 0) {
      if (localBbox.x < uX0) uX0 = localBbox.x;
      if (localBbox.y < uY0) uY0 = localBbox.y;
      const ex = localBbox.x + localBbox.w;
      const ey = localBbox.y + localBbox.h;
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

  if (outBbox !== undefined) {
    if (uX0 > uX1 || uY0 > uY1) {
      outBbox.x = 0;
      outBbox.y = 0;
      outBbox.w = 0;
      outBbox.h = 0;
    } else {
      outBbox.x = uX0;
      outBbox.y = uY0;
      outBbox.w = uX1 - uX0;
      outBbox.h = uY1 - uY0;
    }
  }
}
