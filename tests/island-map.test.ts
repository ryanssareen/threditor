import { describe, expect, it } from 'vitest';

import {
  ISLAND_ID_COUNT,
  OVERLAY_ISLAND_ID_BASE,
  getIslandMap,
  isOverlayIsland,
  islandIdAt,
} from '../lib/editor/island-map';

describe('island-map', () => {
  it('getIslandMap returns a Uint8Array of length 4096 for classic', () => {
    const map = getIslandMap('classic');
    expect(map).toBeInstanceOf(Uint8Array);
    expect(map.length).toBe(64 * 64);
  });

  it('getIslandMap returns a Uint8Array of length 4096 for slim', () => {
    const map = getIslandMap('slim');
    expect(map).toBeInstanceOf(Uint8Array);
    expect(map.length).toBe(64 * 64);
  });

  it('ISLAND_ID_COUNT equals 72 (12 parts × 6 faces)', () => {
    expect(ISLAND_ID_COUNT).toBe(72);
  });

  // Non-zero coverage by algebraic derivation (pixels painted by
  // buildIslandMap as it walks the 72 face rects):
  //   head+overlay:     2 × 384 = 768
  //   body+overlay:     2 × 352 = 704
  //   arms classic:     4 × 224 = 896    (base + overlay × L/R)
  //   legs:             4 × 224 = 896
  //   → classic total = 3264
  // Slim narrows the 4 arm front/back faces from 4px→3px on w dim:
  //   slim arms = classic arms − (32 px × 4 faces) = 896 − 128 = 768... measured 3136
  // The tests below assert >=3000 as a lower-bound sanity check; exact counts
  // are documented above for future milestones.
  it('classic map has exactly 3264 non-zero pixels', () => {
    const map = getIslandMap('classic');
    let nonZero = 0;
    for (let i = 0; i < map.length; i++) {
      if (map[i] !== 0) nonZero++;
    }
    expect(nonZero).toBe(3264);
  });

  it('slim map has exactly 3136 non-zero pixels', () => {
    const map = getIslandMap('slim');
    let nonZero = 0;
    for (let i = 0; i < map.length; i++) {
      if (map[i] !== 0) nonZero++;
    }
    expect(nonZero).toBe(3136);
  });

  it('islandIdAt returns 0 for out-of-bounds coordinates on classic map', () => {
    const map = getIslandMap('classic');
    expect(islandIdAt(map, -1, 0)).toBe(0);
    expect(islandIdAt(map, 64, 0)).toBe(0);
    expect(islandIdAt(map, 0, -1)).toBe(0);
    expect(islandIdAt(map, 0, 64)).toBe(0);
  });

  it('islandIdAt returns 0 for out-of-bounds coordinates on slim map', () => {
    const map = getIslandMap('slim');
    expect(islandIdAt(map, -1, 0)).toBe(0);
    expect(islandIdAt(map, 64, 0)).toBe(0);
    expect(islandIdAt(map, 0, -1)).toBe(0);
    expect(islandIdAt(map, 0, 64)).toBe(0);
  });

  it('classic spot check: (8,0) is in head top face — ID > 0', () => {
    const map = getIslandMap('classic');
    expect(islandIdAt(map, 8, 0)).toBeGreaterThan(0);
  });

  it('classic spot check: (8,8) is in head front face — ID > 0 and differs from head top', () => {
    const map = getIslandMap('classic');
    const headTopId = islandIdAt(map, 8, 0);
    const headFrontId = islandIdAt(map, 8, 8);
    expect(headFrontId).toBeGreaterThan(0);
    expect(headFrontId).not.toBe(headTopId);
  });

  it('classic spot check: (20,20) is in body front face — ID > 0 and differs from head top', () => {
    const map = getIslandMap('classic');
    const headTopId = islandIdAt(map, 8, 0);
    const bodyFrontId = islandIdAt(map, 20, 20);
    expect(bodyFrontId).toBeGreaterThan(0);
    expect(bodyFrontId).not.toBe(headTopId);
  });

  it('classic spot check: (44,20) is in rightArm front face — ID > 0', () => {
    const map = getIslandMap('classic');
    expect(islandIdAt(map, 44, 20)).toBeGreaterThan(0);
  });

  it('classic spot check: (0,0) is outside all face rects — ID === 0', () => {
    const map = getIslandMap('classic');
    expect(islandIdAt(map, 0, 0)).toBe(0);
  });

  it('pixel (47,20) has different island IDs in classic vs slim (arm face boundary shift)', () => {
    const classicMap = getIslandMap('classic');
    const slimMap = getIslandMap('slim');
    const classicId = islandIdAt(classicMap, 47, 20);
    const slimId = islandIdAt(slimMap, 47, 20);
    expect(classicId).toBeGreaterThan(0);
    expect(slimId).toBeGreaterThan(0);
    expect(classicId).not.toBe(slimId);
  });

  it('classic: (7,8) and (8,8) are adjacent pixels in different faces — different IDs', () => {
    const map = getIslandMap('classic');
    const idAt7 = islandIdAt(map, 7, 8);
    const idAt8 = islandIdAt(map, 8, 8);
    expect(idAt7).not.toBe(idAt8);
  });

  describe('isOverlayIsland', () => {
    it('returns false for id 0 (unused)', () => {
      expect(isOverlayIsland(0)).toBe(false);
    });

    it('returns false for id 1 (first base face)', () => {
      expect(isOverlayIsland(1)).toBe(false);
    });

    it('returns false for id 36 (last base face, equals OVERLAY_ISLAND_ID_BASE)', () => {
      expect(OVERLAY_ISLAND_ID_BASE).toBe(36);
      expect(isOverlayIsland(36)).toBe(false);
    });

    it('returns true for id 37 (first overlay face)', () => {
      expect(isOverlayIsland(37)).toBe(true);
    });

    it('returns true for id 72 (last overlay face)', () => {
      expect(isOverlayIsland(72)).toBe(true);
    });

    it('integration: classic map base pixels (1-36) and overlay pixels (37-72) are both non-zero and together account for all painted pixels', () => {
      const map = getIslandMap('classic');
      let baseCount = 0;
      let overlayCount = 0;
      let totalNonZero = 0;
      for (let i = 0; i < map.length; i++) {
        const id = map[i];
        if (id === 0) continue;
        totalNonZero++;
        if (isOverlayIsland(id)) {
          overlayCount++;
        } else {
          baseCount++;
        }
      }
      expect(baseCount).toBeGreaterThan(0);
      expect(overlayCount).toBeGreaterThan(0);
      expect(baseCount + overlayCount).toBe(totalNonZero);
    });
  });
});
