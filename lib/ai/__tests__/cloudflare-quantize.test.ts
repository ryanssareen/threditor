// @vitest-environment node
//
// M17 Unit 3 — palette + per-pixel index extraction.

import { describe, expect, it } from 'vitest';

import { ImageProcessingError } from '../cloudflare-errors';
import { quantizeRgbaBuffer } from '../cloudflare-quantize';

/** Build a `width×height` RGBA buffer from a `(x,y) → [r,g,b,a]` callback. */
function makeRgba(
  width: number,
  height: number,
  pick: (x: number, y: number) => [number, number, number, number],
): Buffer {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const [r, g, b, a] = pick(x, y);
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return out;
}

describe('quantizeRgbaBuffer', () => {
  it('solid red 8x8 produces a single-color palette and uniform indices', () => {
    const rgba = makeRgba(8, 8, () => [255, 0, 0, 255]);
    const { palette, indices } = quantizeRgbaBuffer(rgba, { width: 8, height: 8 });
    expect(palette).toHaveLength(1);
    expect(palette[0].toLowerCase()).toBe('#ff0000');
    for (const i of indices) expect(i).toBe(0);
  });

  it('two-color split produces a two-color palette indexable per region', () => {
    // Left half red, right half blue.
    const rgba = makeRgba(8, 4, (x) =>
      x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255],
    );
    const { palette, indices } = quantizeRgbaBuffer(rgba, { width: 8, height: 4 });
    expect(palette.length).toBeLessThanOrEqual(2);
    // The left-half indices should all reference the red entry, the
    // right-half all the blue entry. (Which numeric index they map to
    // depends on the quantizer's internal ordering — assert by colour.)
    const idxRed = palette.findIndex((h) => h.toLowerCase() === '#ff0000');
    const idxBlue = palette.findIndex((h) => h.toLowerCase() === '#0000ff');
    expect(idxRed).toBeGreaterThanOrEqual(0);
    expect(idxBlue).toBeGreaterThanOrEqual(0);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        const i = y * 8 + x;
        if (x < 4) expect(indices[i]).toBe(idxRed);
        else expect(indices[i]).toBe(idxBlue);
      }
    }
  });

  it('caps palette at 16 colors when input has 17+ distinct colors', () => {
    // 18 distinct colors arranged in an 18×1 strip.
    const rgba = makeRgba(18, 1, (x) => [
      (x * 14) & 0xff, // R varies
      (x * 7) & 0xff, // G varies
      (x * 11) & 0xff, // B varies
      255,
    ]);
    const { palette, indices } = quantizeRgbaBuffer(rgba, { width: 18, height: 1 });
    expect(palette.length).toBeLessThanOrEqual(16);
    expect(palette.length).toBeGreaterThan(0);
    for (const i of indices) expect(i).toBeLessThan(palette.length);
  });

  it('emits #rrggbbaa for non-opaque palette entries', () => {
    const rgba = makeRgba(4, 4, (x) => {
      // Half opaque red, half transparent black.
      if (x < 2) return [255, 0, 0, 255];
      return [0, 0, 0, 0];
    });
    const { palette } = quantizeRgbaBuffer(rgba, { width: 4, height: 4 });
    expect(palette.length).toBeLessThanOrEqual(2);
    // The transparent entry should be rendered as 9 chars (`#rrggbbaa`).
    const hasAlpha = palette.some((h) => h.length === 9);
    expect(hasAlpha).toBe(true);
  });

  it('rejects buffer length that does not match width*height*4', () => {
    const wrong = Buffer.alloc(10);
    expect(() =>
      quantizeRgbaBuffer(wrong, { width: 8, height: 8 }),
    ).toThrow(ImageProcessingError);
  });

  it('rejects invalid dimensions', () => {
    const buf = Buffer.alloc(0);
    expect(() =>
      quantizeRgbaBuffer(buf, { width: 0, height: 0 }),
    ).toThrow(ImageProcessingError);
    expect(() =>
      quantizeRgbaBuffer(buf, { width: -1, height: 8 }),
    ).toThrow(ImageProcessingError);
    expect(() =>
      quantizeRgbaBuffer(buf, { width: 1.5, height: 8 }),
    ).toThrow(ImageProcessingError);
  });

  it('rejects maxColors out of [1, 16]', () => {
    const rgba = makeRgba(2, 2, () => [0, 0, 0, 255]);
    expect(() =>
      quantizeRgbaBuffer(rgba, { width: 2, height: 2, maxColors: 0 }),
    ).toThrow(ImageProcessingError);
    expect(() =>
      quantizeRgbaBuffer(rgba, { width: 2, height: 2, maxColors: 17 }),
    ).toThrow(ImageProcessingError);
  });

  it('hex strings are lowercase and well-formed', () => {
    const rgba = makeRgba(4, 4, (x, y) => [x * 60, y * 60, 100, 255]);
    const { palette } = quantizeRgbaBuffer(rgba, { width: 4, height: 4 });
    for (const h of palette) {
      expect(h.startsWith('#')).toBe(true);
      // Lowercase hex, 6 or 8 body chars.
      expect(h).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    }
  });

  it('every index is in [0, palette.length)', () => {
    // Random-ish 16x16 input.
    const rgba = makeRgba(16, 16, (x, y) => [
      ((x * 17) ^ (y * 31)) & 0xff,
      ((x * 7) ^ (y * 13)) & 0xff,
      ((x * 11) ^ (y * 19)) & 0xff,
      255,
    ]);
    const { palette, indices } = quantizeRgbaBuffer(rgba, {
      width: 16,
      height: 16,
    });
    for (const i of indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(palette.length);
    }
  });
});
