import { describe, expect, it } from 'vitest';

import { stampLine, stampPencil } from '../lib/editor/tools/pencil';

const WIDTH = 64;
const HEIGHT = 64;

const makePixels = (): Uint8ClampedArray => new Uint8ClampedArray(WIDTH * HEIGHT * 4);

const pixelOffset = (x: number, y: number): number => (y * WIDTH + x) * 4;

const readPixel = (
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
): [number, number, number, number] => {
  const o = pixelOffset(x, y);
  return [pixels[o], pixels[o + 1], pixels[o + 2], pixels[o + 3]];
};

const isColor = (
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): boolean => {
  const [pr, pg, pb, pa] = readPixel(pixels, x, y);
  return pr === r && pg === g && pb === b && pa === a;
};

const isBlank = (pixels: Uint8ClampedArray, x: number, y: number): boolean =>
  isColor(pixels, x, y, 0, 0, 0, 0);

describe('pencil', () => {
  it('stampPencil size=1 at (5,5) writes exactly one pixel', () => {
    const pixels = makePixels();
    stampPencil(pixels, 5, 5, 1, 255, 128, 0, 200);

    expect(isColor(pixels, 5, 5, 255, 128, 0, 200)).toBe(true);

    let changedCount = 0;
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        if (!isBlank(pixels, x, y)) {
          changedCount += 1;
        }
      }
    }
    expect(changedCount).toBe(1);
  });

  it('stampPencil size=2 at (5,5) writes a 2x2 block at top-left (4,4)', () => {
    const pixels = makePixels();
    stampPencil(pixels, 5, 5, 2, 0, 255, 0, 255);

    expect(isColor(pixels, 4, 4, 0, 255, 0, 255)).toBe(true);
    expect(isColor(pixels, 5, 4, 0, 255, 0, 255)).toBe(true);
    expect(isColor(pixels, 4, 5, 0, 255, 0, 255)).toBe(true);
    expect(isColor(pixels, 5, 5, 0, 255, 0, 255)).toBe(true);

    expect(isBlank(pixels, 3, 3)).toBe(true);
    expect(isBlank(pixels, 6, 6)).toBe(true);
  });

  it('stampPencil size=3 at (5,5) writes a 3x3 block at (4,4)..(6,6)', () => {
    const pixels = makePixels();
    stampPencil(pixels, 5, 5, 3, 0, 0, 255, 255);

    expect(isColor(pixels, 4, 4, 0, 0, 255, 255)).toBe(true);
    expect(isColor(pixels, 6, 6, 0, 0, 255, 255)).toBe(true);

    expect(isBlank(pixels, 3, 3)).toBe(true);
    expect(isBlank(pixels, 7, 7)).toBe(true);
  });

  it('stampPencil size=4 at (5,5) writes a 4x4 block at (4,4)..(7,7)', () => {
    const pixels = makePixels();
    stampPencil(pixels, 5, 5, 4, 255, 0, 255, 255);

    expect(isColor(pixels, 4, 4, 255, 0, 255, 255)).toBe(true);
    expect(isColor(pixels, 7, 7, 255, 0, 255, 255)).toBe(true);

    expect(isBlank(pixels, 3, 3)).toBe(true);
    expect(isBlank(pixels, 8, 8)).toBe(true);
  });

  it('default alpha is 255 when a parameter is omitted', () => {
    const pixels = makePixels();
    stampPencil(pixels, 10, 10, 1, 100, 150, 200);

    const [, , , a] = readPixel(pixels, 10, 10);
    expect(a).toBe(255);
  });

  it('edge clamping at (0,0) with size=4: raw top-left (-1,-1) clamps to (0,0)', () => {
    const pixels = makePixels();
    const bbox = { x: 0, y: 0, w: 0, h: 0 };
    stampPencil(pixels, 0, 0, 4, 255, 0, 0, 255, bbox);

    expect(bbox.x).toBe(0);
    expect(bbox.y).toBe(0);
    expect(bbox.w).toBe(3);
    expect(bbox.h).toBe(3);
  });

  it('edge clamping at x=63 with size=4: raw bottom-right (64,64) clamps to (63,63)', () => {
    const pixels = makePixels();
    const bbox = { x: 0, y: 0, w: 0, h: 0 };
    stampPencil(pixels, 62, 62, 4, 255, 0, 0, 255, bbox);

    expect(bbox.x).toBe(61);
    expect(bbox.y).toBe(61);
    expect(bbox.w).toBe(3);
    expect(bbox.h).toBe(3);
  });

  it('outBbox reflects only the drawn region post-clamp, not logical region', () => {
    const pixels = makePixels();
    const bboxClamped = { x: 0, y: 0, w: 0, h: 0 };
    const bboxFull = { x: 0, y: 0, w: 0, h: 0 };
    stampPencil(pixels, 0, 0, 4, 255, 0, 0, 255, bboxClamped);
    stampPencil(pixels, 5, 5, 4, 255, 0, 0, 255, bboxFull);

    expect(bboxClamped.w).toBeLessThan(4);
    expect(bboxFull.w).toBe(4);
    expect(bboxFull.h).toBe(4);
  });

  it('stampLine draws bresenham pixels between (2,2) and (5,5)', () => {
    const pixels = makePixels();
    const bbox = { x: 0, y: 0, w: 0, h: 0 };
    stampLine(pixels, 2, 2, 5, 5, 1, 255, 0, 0, 255, bbox);

    expect(isColor(pixels, 2, 2, 255, 0, 0, 255)).toBe(true);
    expect(isColor(pixels, 3, 3, 255, 0, 0, 255)).toBe(true);
    expect(isColor(pixels, 4, 4, 255, 0, 0, 255)).toBe(true);
    expect(isColor(pixels, 5, 5, 255, 0, 0, 255)).toBe(true);

    expect(isBlank(pixels, 2, 3)).toBe(true);
    expect(isBlank(pixels, 3, 2)).toBe(true);

    expect(bbox).toEqual({ x: 2, y: 2, w: 4, h: 4 });
  });

  it('stampLine with start === end behaves like a single stampPencil', () => {
    const pixelsLine = makePixels();
    const pixelsStamp = makePixels();
    const bboxLine = { x: 0, y: 0, w: 0, h: 0 };
    const bboxStamp = { x: 0, y: 0, w: 0, h: 0 };

    stampLine(pixelsLine, 10, 10, 10, 10, 1, 0, 200, 100, 255, bboxLine);
    stampPencil(pixelsStamp, 10, 10, 1, 0, 200, 100, 255, bboxStamp);

    expect(bboxLine).toEqual(bboxStamp);
    expect(pixelsLine).toEqual(pixelsStamp);
  });

  it('independent outBbox objects do not share state across two stampPencil calls', () => {
    const pixels = makePixels();
    const bbox1 = { x: 0, y: 0, w: 0, h: 0 };
    const bbox2 = { x: 0, y: 0, w: 0, h: 0 };
    stampPencil(pixels, 0, 0, 4, 255, 0, 0, 255, bbox1);
    stampPencil(pixels, 5, 5, 1, 255, 0, 0, 255, bbox2);
    // bbox1 must not be mutated by the second call
    expect(bbox1.w).toBe(3);
    expect(bbox2.x).toBe(5);
    expect(bbox2.w).toBe(1);
  });

  it('stampLine with size=2 fills gaps on diagonal: (0,0) to (4,4) has no holes', () => {
    const pixels = makePixels();
    stampLine(pixels, 0, 0, 4, 4, 2, 255, 0, 0, 255);

    for (let i = 0; i <= 4; i += 1) {
      expect(isColor(pixels, i, i, 255, 0, 0, 255)).toBe(true);
    }

    const stampedCount = Array.from({ length: 5 }, (_, i) =>
      isColor(pixels, i, i, 255, 0, 0, 255),
    ).filter(Boolean).length;
    expect(stampedCount).toBe(5);
  });
});
