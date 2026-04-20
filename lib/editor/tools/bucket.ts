/**
 * lib/editor/tools/bucket.ts
 *
 * M5 bucket fill. Thin wrapper over M3's `floodFill` + `applyFillMask`
 * — the algorithm is already implemented and tested, and this module
 * is the single entry point both paint surfaces + the dispatcher call.
 *
 * Returns null when the seed is outside every island (island ID 0):
 * the bucket click lands on unused atlas space, so the caller should
 * no-op (no flush, no recents insert).
 */

import { applyFillMask, floodFill } from '../flood-fill';
import { islandIdAt } from '../island-map';
import type { IslandMap } from '../types';

export function bucketFill(
  pixels: Uint8ClampedArray,
  islandMap: IslandMap,
  seedX: number,
  seedY: number,
  r: number,
  g: number,
  b: number,
  a: number = 255,
): { changed: boolean } {
  // Fast-fail: out-of-bounds or unused-atlas seed. floodFill already handles
  // this but we also want to skip the applyFillMask loop over 4096 pixels.
  if (islandIdAt(islandMap, seedX, seedY) === 0) {
    return { changed: false };
  }
  const mask = floodFill(pixels, islandMap, seedX, seedY);
  applyFillMask(pixels, mask, r, g, b, a);
  return { changed: true };
}
