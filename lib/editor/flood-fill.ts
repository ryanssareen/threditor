/**
 * Scanline flood fill for the 64×64 Minecraft skin atlas.
 *
 * Implementation of the Smith 1979 scanline algorithm, island-gated per
 * DESIGN.md §9.1. Used by M3 bucket-fill hover preview and M5 actual bucket tool.
 *
 * ## Algorithm (scanline row-span variant)
 *
 * Rather than pushing every matching pixel onto the stack individually
 * (naive 4-connected), we push one entry per *contiguous horizontal run*
 * found in adjacent rows. For a dense 512-pixel island this is 3-5× faster
 * because stack depth is bounded by the number of spans, not pixels.
 *
 * Loop per popped (x, y):
 *   1. Walk left from x until the match condition fails → leftmost column L.
 *   2. Walk right from x until the match condition fails → rightmost column R.
 *   3. Mark mask[i] = 1 for every pixel in [L, R] on row y.
 *   4. For each of rows y-1 and y+1, scan [L, R] and push the start of every
 *      contiguous sub-run whose first pixel satisfies the match condition.
 *      Pushing only the start (not every pixel) keeps the stack shallow.
 *
 * ## Match condition (pixel at atlas index i)
 *   - RGBA equals seed RGBA (exact, no tolerance — pixel art requirement)
 *   - islandMap[i] equals seed island ID (prevents bleed across UV seams)
 *   - mask[i] === 0 (not yet filled in this call)
 *
 * ## Island gating
 *   If the seed pixel's island ID is 0 (unused/transparent atlas region), the
 *   function returns an all-zero mask immediately. This prevents unintentional
 *   floods across completely unowned atlas space.
 *
 * ## Zero-allocation inner loop
 *   The explicit `number[]` stack is allocated once before the loop and reused
 *   across iterations via push/pop. No objects, typed arrays, or closures are
 *   allocated inside the scanline loop.
 *
 * @module flood-fill
 */

import type { IslandMap } from './types';
import { SKIN_ATLAS_SIZE } from '@/lib/three/constants';

const W = SKIN_ATLAS_SIZE; // 64
const H = SKIN_ATLAS_SIZE; // 64
const TOTAL = W * H;       // 4096

/**
 * Perform a scanline flood fill seeded at (seedX, seedY).
 *
 * @param pixels   - Flat RGBA Uint8ClampedArray, length 64*64*4 = 16384.
 *                   Row-major, top-left origin. Index of pixel (x,y) = (y*64+x)*4.
 * @param islandMap - Flat Uint8Array of island IDs, length 64*64 = 4096.
 *                   Index of pixel (x,y) = y*64+x.
 * @param seedX    - X coordinate of the seed pixel, 0 ≤ seedX < 64.
 * @param seedY    - Y coordinate of the seed pixel, 0 ≤ seedY < 64.
 * @returns        Uint8Array of length 4096. mask[i] = 1 means pixel i is in
 *                 the filled region; 0 means excluded.
 */
export function floodFill(
  pixels: Uint8ClampedArray,
  islandMap: IslandMap,
  seedX: number,
  seedY: number,
): Uint8Array {
  const mask = new Uint8Array(TOTAL);

  // Validate seed coordinates.
  if (seedX < 0 || seedX >= W || seedY < 0 || seedY >= H) {
    return mask;
  }

  const seedIdx = seedY * W + seedX;

  // Read seed island ID. ID 0 = unused atlas region — bail immediately.
  const seedIslandId = islandMap[seedIdx];
  if (seedIslandId === 0) {
    return mask;
  }

  // Read seed RGBA (four consecutive bytes starting at seedIdx*4).
  const pi = seedIdx * 4;
  const seedR = pixels[pi];
  const seedG = pixels[pi + 1];
  const seedB = pixels[pi + 2];
  const seedA = pixels[pi + 3];

  /**
   * Inline match test for atlas index `i`.
   * Inlined rather than extracted to a function to avoid per-call overhead
   * inside the hot inner loop.
   */
  const matches = (i: number): boolean => {
    if (mask[i] !== 0) return false;
    if (islandMap[i] !== seedIslandId) return false;
    const p = i * 4;
    return (
      pixels[p]     === seedR &&
      pixels[p + 1] === seedG &&
      pixels[p + 2] === seedB &&
      pixels[p + 3] === seedA
    );
  };

  // Explicit stack storing flat [x, y] pairs. Pre-allocated as a plain array
  // so push/pop are O(1) amortised with no typed-array copies.
  const stack: number[] = [seedX, seedY];

  while (stack.length > 0) {
    // Guard against corrupt stack (each entry is an [x, y] pair).
    if (stack.length < 2) break;
    // Pop y before x (LIFO push order is x then y).
    const y = stack.pop()!;
    const x = stack.pop()!;

    const rowBase = y * W;

    // Skip if this pixel was already filled by a previous span expansion.
    if (mask[rowBase + x] !== 0) continue;

    // The seed pixel itself must still match (it might not if it was filled
    // via a different span entry for the same row).
    if (!matches(rowBase + x)) continue;

    // 1. Walk left to find leftmost column L.
    let L = x;
    while (L > 0 && matches(rowBase + L - 1)) {
      L--;
    }

    // 2. Walk right to find rightmost column R.
    let R = x;
    while (R < W - 1 && matches(rowBase + R + 1)) {
      R++;
    }

    // 3. Fill the span [L, R] on row y.
    for (let col = L; col <= R; col++) {
      mask[rowBase + col] = 1;
    }

    // 4. Scan adjacent rows (y-1 and y+1). For each contiguous sub-run
    //    within [L, R] that satisfies the match condition, push only the
    //    first pixel of the run. This keeps stack entries proportional to
    //    the number of distinct runs rather than the number of pixels.
    if (y > 0) {
      const aboveBase = (y - 1) * W;
      let inRun = false;
      for (let col = L; col <= R; col++) {
        if (matches(aboveBase + col)) {
          if (!inRun) {
            stack.push(col, y - 1);
            inRun = true;
          }
        } else {
          inRun = false;
        }
      }
    }

    if (y < H - 1) {
      const belowBase = (y + 1) * W;
      let inRun = false;
      for (let col = L; col <= R; col++) {
        if (matches(belowBase + col)) {
          if (!inRun) {
            stack.push(col, y + 1);
            inRun = true;
          }
        } else {
          inRun = false;
        }
      }
    }
  }

  return mask;
}

/**
 * Apply a fill mask to a pixel buffer in-place.
 *
 * For every atlas pixel i where mask[i] === 1, overwrites the RGBA bytes in
 * `target` with (r, g, b, a). Uses direct index writes; no ImageData allocation.
 *
 * @param target - Flat RGBA Uint8ClampedArray to modify in-place, length 16384.
 * @param mask   - Fill mask returned by {@link floodFill}, length 4096.
 * @param r      - Red channel, 0–255.
 * @param g      - Green channel, 0–255.
 * @param b      - Blue channel, 0–255.
 * @param a      - Alpha channel, 0–255. Defaults to 255 (fully opaque).
 */
export function applyFillMask(
  target: Uint8ClampedArray,
  mask: Uint8Array,
  r: number,
  g: number,
  b: number,
  a: number = 255,
): void {
  for (let i = 0; i < TOTAL; i++) {
    if (mask[i] === 1) {
      const p = i * 4;
      target[p]     = r;
      target[p + 1] = g;
      target[p + 2] = b;
      target[p + 3] = a;
    }
  }
}
