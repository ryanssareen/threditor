// @vitest-environment node
//
// M6 Unit 2 — diff helpers (sliceRegion, applyRegion, unionBbox).

import { describe, expect, it } from 'vitest';

import { applyRegion, sliceRegion, unionBbox } from '../lib/editor/diff';

const W = 64;
const makePixels = (): Uint8ClampedArray => new Uint8ClampedArray(W * W * 4);

/** Paint a w×h rect at (x,y) with channels (r,g,b,a) so tests have known content. */
function paintRect(
  pixels: Uint8ClampedArray,
  x: number, y: number, w: number, h: number,
  r: number, g: number, b: number, a: number,
): void {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const i = (py * W + px) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a;
    }
  }
}

describe('sliceRegion', () => {
  it('slices a 10×10 region and returns 400 bytes', () => {
    const pixels = makePixels();
    paintRect(pixels, 5, 5, 10, 10, 200, 100, 50, 255);
    const slice = sliceRegion(pixels, { x: 5, y: 5, w: 10, h: 10 });
    expect(slice.length).toBe(10 * 10 * 4);
    // First pixel
    expect(slice[0]).toBe(200);
    expect(slice[1]).toBe(100);
    expect(slice[2]).toBe(50);
    expect(slice[3]).toBe(255);
  });

  it('slices a 1×1 region at (0, 0)', () => {
    const pixels = makePixels();
    paintRect(pixels, 0, 0, 1, 1, 10, 20, 30, 40);
    const slice = sliceRegion(pixels, { x: 0, y: 0, w: 1, h: 1 });
    expect(Array.from(slice)).toEqual([10, 20, 30, 40]);
  });

  it('slices the last pixel at (63, 63)', () => {
    const pixels = makePixels();
    paintRect(pixels, 63, 63, 1, 1, 1, 2, 3, 4);
    const slice = sliceRegion(pixels, { x: 63, y: 63, w: 1, h: 1 });
    expect(Array.from(slice)).toEqual([1, 2, 3, 4]);
  });

  it('slices w=0 h=0 returns empty buffer', () => {
    const pixels = makePixels();
    const slice = sliceRegion(pixels, { x: 10, y: 10, w: 0, h: 0 });
    expect(slice.length).toBe(0);
  });
});

describe('applyRegion', () => {
  it('round-trip: sliceRegion → applyRegion yields identity', () => {
    const pixels = makePixels();
    paintRect(pixels, 10, 10, 5, 5, 100, 50, 25, 200);
    const bbox = { x: 10, y: 10, w: 5, h: 5 };
    const slice = sliceRegion(pixels, bbox);
    const zeroed = makePixels();
    applyRegion(zeroed, bbox, slice);
    // compare bbox in both buffers
    for (let dy = 0; dy < 5; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        const i = ((10 + dy) * W + (10 + dx)) * 4;
        expect(zeroed[i]).toBe(pixels[i]);
        expect(zeroed[i + 1]).toBe(pixels[i + 1]);
        expect(zeroed[i + 2]).toBe(pixels[i + 2]);
        expect(zeroed[i + 3]).toBe(pixels[i + 3]);
      }
    }
  });

  it('does not touch pixels outside the bbox', () => {
    const pixels = makePixels();
    paintRect(pixels, 0, 0, 64, 64, 10, 10, 10, 255); // fill all gray
    const region = new Uint8ClampedArray(5 * 5 * 4).fill(99);
    applyRegion(pixels, { x: 20, y: 20, w: 5, h: 5 }, region);
    // outside (10, 10) stays gray
    const i = (10 * W + 10) * 4;
    expect(pixels[i]).toBe(10);
    // inside (22, 22) is 99
    const j = (22 * W + 22) * 4;
    expect(pixels[j]).toBe(99);
  });

  it('w=0 h=0 is a no-op', () => {
    const pixels = makePixels();
    paintRect(pixels, 10, 10, 5, 5, 1, 2, 3, 4);
    const empty = new Uint8ClampedArray(0);
    applyRegion(pixels, { x: 10, y: 10, w: 0, h: 0 }, empty);
    expect(pixels[(10 * W + 10) * 4]).toBe(1);
  });
});

describe('unionBbox', () => {
  it('null + rect → returns rect', () => {
    const r = unionBbox(null, { x: 5, y: 5, w: 3, h: 3 });
    expect(r).toEqual({ x: 5, y: 5, w: 3, h: 3 });
  });

  it('overlapping rects union correctly', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(unionBbox(a, b)).toEqual({ x: 0, y: 0, w: 15, h: 15 });
  });

  it('disjoint rects produce the envelope', () => {
    const a = { x: 0, y: 0, w: 3, h: 3 };
    const b = { x: 60, y: 60, w: 3, h: 3 };
    expect(unionBbox(a, b)).toEqual({ x: 0, y: 0, w: 63, h: 63 });
  });

  it('contained rect leaves acc unchanged', () => {
    const a = { x: 0, y: 0, w: 20, h: 20 };
    const b = { x: 5, y: 5, w: 5, h: 5 };
    expect(unionBbox(a, b)).toEqual(a);
  });

  it('zero-area next is a no-op', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const empty = { x: 100, y: 100, w: 0, h: 0 };
    expect(unionBbox(a, empty)).toEqual(a);
  });
});
