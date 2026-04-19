import { describe, expect, it } from 'vitest';

import { applyFillMask, floodFill } from '../lib/editor/flood-fill';
import { getIslandMap } from '../lib/editor/island-map';

const ATLAS_SIZE = 64;
const PIXEL_COUNT = ATLAS_SIZE * ATLAS_SIZE;
const PIXEL_ARRAY_LENGTH = PIXEL_COUNT * 4;

function makePixels(): Uint8ClampedArray {
  return new Uint8ClampedArray(PIXEL_ARRAY_LENGTH);
}

function paintRect(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const base = (py * ATLAS_SIZE + px) * 4;
      pixels[base] = r;
      pixels[base + 1] = g;
      pixels[base + 2] = b;
      pixels[base + 3] = a;
    }
  }
}

function countOnesInRect(mask: Uint8Array, x: number, y: number, w: number, h: number): number {
  let count = 0;
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (mask[py * ATLAS_SIZE + px] === 1) count++;
    }
  }
  return count;
}

describe('flood-fill', () => {
  it('seed on opaque pixel fills a connected same-color region', () => {
    const pixels = makePixels();
    const map = getIslandMap('classic');

    // head.front = {x: 8, y: 8, w: 8, h: 8}
    paintRect(pixels, 8, 8, 8, 8, 255, 0, 0, 255);

    const mask = floodFill(pixels, map, 10, 10);

    expect(mask.length).toBe(PIXEL_COUNT);

    // All 64 pixels in head-front must be set
    const onesInFront = countOnesInRect(mask, 8, 8, 8, 8);
    expect(onesInFront).toBe(64);

    // Everything outside the 8x8 region must be 0
    const totalOnes = mask.reduce((acc, v) => acc + v, 0);
    expect(totalOnes).toBe(64);
  });

  it('island gating — fill does not cross atlas seams', () => {
    const pixels = makePixels();
    const map = getIslandMap('classic');

    // head.top  = {x: 8, y: 0, w: 8, h: 8}  — different island ID
    // head.front = {x: 8, y: 8, w: 8, h: 8}  — seed island
    // Both painted red so color alone would not stop the fill
    paintRect(pixels, 8, 0, 8, 8, 255, 0, 0, 255);
    paintRect(pixels, 8, 8, 8, 8, 255, 0, 0, 255);

    const mask = floodFill(pixels, map, 10, 10);

    // head-front must be fully filled
    const onesInFront = countOnesInRect(mask, 8, 8, 8, 8);
    expect(onesInFront).toBe(64);

    // head-top must be entirely unfilled despite sharing the same color
    const onesInTop = countOnesInRect(mask, 8, 0, 8, 8);
    expect(onesInTop).toBe(0);
  });

  it('color matching — exact equality only; one-unit difference excludes the pixel', () => {
    const pixels = makePixels();
    const map = getIslandMap('classic');

    // Paint head-front solid red
    paintRect(pixels, 8, 8, 8, 8, 255, 0, 0, 255);

    // Override pixel (10, 10) with a one-unit R difference
    const base = (10 * ATLAS_SIZE + 10) * 4;
    pixels[base] = 254;
    pixels[base + 1] = 0;
    pixels[base + 2] = 0;
    pixels[base + 3] = 255;

    // Seed on (9, 9) — pure red
    const mask = floodFill(pixels, map, 9, 9);

    // The off-by-one pixel must be excluded
    expect(mask[10 * ATLAS_SIZE + 10]).toBe(0);
  });

  it('seed on zero-island pixel returns all-zero mask', () => {
    const pixels = makePixels();
    const map = getIslandMap('classic');

    // (0, 0) is in the unused corner (island ID === 0 per island-map.test.ts)
    const mask = floodFill(pixels, map, 0, 0);

    const totalOnes = mask.reduce((acc, v) => acc + v, 0);
    expect(totalOnes).toBe(0);
  });

  it('seed out of atlas bounds returns all-zero mask or exits gracefully', () => {
    const pixels = makePixels();
    const map = getIslandMap('classic');

    let mask: Uint8Array | undefined;
    expect(() => {
      mask = floodFill(pixels, map, 100, 100);
    }).not.toThrow();

    if (mask !== undefined) {
      const totalOnes = mask.reduce((acc, v) => acc + v, 0);
      expect(totalOnes).toBe(0);
    }
  });

  it('applyFillMask writes RGBA at mask=1 positions and leaves others unchanged', () => {
    const target = new Uint8ClampedArray(PIXEL_ARRAY_LENGTH);

    // Fill target with (10, 20, 30, 255)
    for (let i = 0; i < PIXEL_COUNT; i++) {
      const base = i * 4;
      target[base] = 10;
      target[base + 1] = 20;
      target[base + 2] = 30;
      target[base + 3] = 255;
    }

    // Mask: 4×4 region of 1s at (0,0)..(3,3), rest 0
    const mask = new Uint8Array(PIXEL_COUNT);
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 4; px++) {
        mask[py * ATLAS_SIZE + px] = 1;
      }
    }

    applyFillMask(target, mask, 200, 150, 100, 255);

    // Pixels inside the 4×4 region must be (200, 150, 100, 255)
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 4; px++) {
        const base = (py * ATLAS_SIZE + px) * 4;
        expect(target[base]).toBe(200);
        expect(target[base + 1]).toBe(150);
        expect(target[base + 2]).toBe(100);
        expect(target[base + 3]).toBe(255);
      }
    }

    // A pixel outside the region must be unchanged
    const outsideBase = (0 * ATLAS_SIZE + 4) * 4;
    expect(target[outsideBase]).toBe(10);
    expect(target[outsideBase + 1]).toBe(20);
    expect(target[outsideBase + 2]).toBe(30);
    expect(target[outsideBase + 3]).toBe(255);
  });

  it('applyFillMask default alpha === 255 when omitted', () => {
    const target = new Uint8ClampedArray(PIXEL_ARRAY_LENGTH);

    const mask = new Uint8Array(PIXEL_COUNT);
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 4; px++) {
        mask[py * ATLAS_SIZE + px] = 1;
      }
    }

    // Call without alpha argument
    applyFillMask(target, mask, 50, 60, 70);

    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 4; px++) {
        const base = (py * ATLAS_SIZE + px) * 4;
        expect(target[base]).toBe(50);
        expect(target[base + 1]).toBe(60);
        expect(target[base + 2]).toBe(70);
        expect(target[base + 3]).toBe(255);
      }
    }
  });

  it('performance smoke test — flood fill of head-front completes in under 10ms', () => {
    const pixels = makePixels();
    const map = getIslandMap('classic');

    // head.front = {x: 8, y: 8, w: 8, h: 8}
    paintRect(pixels, 8, 8, 8, 8, 255, 0, 0, 255);

    const start = performance.now();
    floodFill(pixels, map, 10, 10);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(10);
  });
});
