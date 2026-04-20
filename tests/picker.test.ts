// @vitest-environment node
//
// M5 Unit 3 — picker (pickColorAt).

import { describe, expect, it } from 'vitest';

import { pickColorAt } from '../lib/editor/tools/picker';
import { stampPencil } from '../lib/editor/tools/pencil';

const W = 64;
const makePixels = (): Uint8ClampedArray => new Uint8ClampedArray(W * W * 4);

describe('pickColorAt', () => {
  it('returns hex + alpha for a painted pixel', () => {
    const pixels = makePixels();
    stampPencil(pixels, 5, 5, 1, 255, 0, 0, 255);
    expect(pickColorAt(pixels, 5, 5)).toEqual({ hex: '#ff0000', alpha: 255 });
  });

  it('fully transparent pixel → #000000 with alpha 0', () => {
    const pixels = makePixels();
    expect(pickColorAt(pixels, 0, 0)).toEqual({ hex: '#000000', alpha: 0 });
  });

  it('OOB negative → null', () => {
    const pixels = makePixels();
    expect(pickColorAt(pixels, -1, 0)).toBeNull();
    expect(pickColorAt(pixels, 0, -1)).toBeNull();
  });

  it('OOB past 63 → null', () => {
    const pixels = makePixels();
    expect(pickColorAt(pixels, 64, 63)).toBeNull();
    expect(pickColorAt(pixels, 63, 64)).toBeNull();
  });

  it('always returns lowercase hex', () => {
    const pixels = makePixels();
    stampPencil(pixels, 1, 1, 1, 171, 205, 239, 255);
    const r = pickColorAt(pixels, 1, 1);
    expect(r).not.toBeNull();
    expect(r!.hex).toBe('#abcdef');
  });

  it('round-trips with pencil: stamp then pick returns the stamped color', () => {
    const pixels = makePixels();
    const samples = [
      { x: 10, y: 12, r: 0, g: 0, b: 0 },
      { x: 20, y: 22, r: 255, g: 255, b: 255 },
      { x: 30, y: 32, r: 18, g: 52, b: 86 }, // #123456
    ];
    for (const s of samples) {
      stampPencil(pixels, s.x, s.y, 1, s.r, s.g, s.b, 255);
      const got = pickColorAt(pixels, s.x, s.y);
      const expected = `#${[s.r, s.g, s.b]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')}`;
      expect(got).toEqual({ hex: expected, alpha: 255 });
    }
  });

  it('reads alpha independently of RGB', () => {
    const pixels = makePixels();
    stampPencil(pixels, 8, 9, 1, 100, 100, 100, 128);
    expect(pickColorAt(pixels, 8, 9)).toEqual({ hex: '#646464', alpha: 128 });
  });
});
