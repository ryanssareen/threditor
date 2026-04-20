/**
 * lib/editor/tools/eraser.ts
 *
 * M5: eraser stamp + Bresenham eraseLine. Writes fully transparent RGBA
 * (0, 0, 0, 0) at each pixel. Same top-left centering convention,
 * clipping rules, and zero-allocation hot-path discipline as pencil.ts.
 *
 * Pencil and eraser could share a "stamp with these 4 bytes" helper, but
 * three lines of clip math inlined into each file is cheaper than a
 * shared abstraction that adds a function-call frame to the pointermove
 * hot path.
 */

import { SKIN_ATLAS_SIZE } from '../../three/constants';

/**
 * Zero an NxN region centered on atlas (cx, cy). Centering convention
 * matches pencil.ts:
 *   size=1 → halfLeft=0  (top-left = cx+0)
 *   size=2 → halfLeft=1  (top-left = cx-1)
 *   size=3 → halfLeft=1  (top-left = cx-1)
 *   size=4 → halfLeft=1  (top-left = cx-1)
 * Out-of-bounds clamp: writes only in-bounds pixels; OOB seed is a no-op.
 */
export function stampEraser(
  pixels: Uint8ClampedArray,
  cx: number,
  cy: number,
  size: 1 | 2 | 3 | 4,
  outBbox?: { x: number; y: number; w: number; h: number },
): void {
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
      pixels[i]     = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      pixels[i + 3] = 0;
    }
  }

  if (outBbox !== undefined) {
    outBbox.x = x0;
    outBbox.y = y0;
    outBbox.w = x1 - x0;
    outBbox.h = y1 - y0;
  }
}

/**
 * Bresenham erase between two pointer positions. Mirrors stampLine's
 * allocation profile: one localBbox object reused across all stamps
 * in the inner loop; one optional outBbox for the union.
 */
export function eraseLine(
  pixels: Uint8ClampedArray,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: 1 | 2 | 3 | 4,
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

  const localBbox = { x: 0, y: 0, w: 0, h: 0 };

  while (true) {
    stampEraser(pixels, px, py, size, localBbox);

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
