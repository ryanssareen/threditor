import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  hexToRgb,
  hslToRgb,
  luminance,
  rgbToHex,
  rgbToHsl,
} from '../lib/color/conversions';
import type { HSL, RGB } from '../lib/color/conversions';

const RGB_TOLERANCE = 1;
const HUE_TOLERANCE = 1;
const UNIT_TOLERANCE = 0.01;

const createPrng = (seed: number): (() => number) => {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const hueDistance = (left: number, right: number): number => {
  const rawDelta = Math.abs(left - right) % 360;
  return Math.min(rawDelta, 360 - rawDelta);
};

const expectRgbClose = (actual: RGB, expected: RGB, tolerance = RGB_TOLERANCE): void => {
  expect(Math.abs(actual[0] - expected[0])).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual[1] - expected[1])).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual[2] - expected[2])).toBeLessThanOrEqual(tolerance);
};

const expectHslClose = (actual: HSL, expected: HSL): void => {
  expect(hueDistance(actual[0], expected[0])).toBeLessThanOrEqual(HUE_TOLERANCE);
  expect(Math.abs(actual[1] - expected[1])).toBeLessThanOrEqual(UNIT_TOLERANCE);
  expect(Math.abs(actual[2] - expected[2])).toBeLessThanOrEqual(UNIT_TOLERANCE);
};

describe('color conversions', () => {
  it('round-trips rgb -> hsl -> rgb within 1 unit tolerance for 20 random colors', () => {
    const prng = createPrng(0xc0ffee);

    for (let index = 0; index < 20; index += 1) {
      const rgb: RGB = [
        Math.round(prng() * 255),
        Math.round(prng() * 255),
        Math.round(prng() * 255),
      ];

      expectRgbClose(hslToRgb(...rgbToHsl(...rgb)), rgb);
    }
  });

  it('round-trips hsl -> rgb -> hsl within 1 unit tolerance for 20 random colors', () => {
    const prng = createPrng(0xdecafbad);

    for (let index = 0; index < 20; index += 1) {
      const rgb: RGB = [
        Math.round(prng() * 255),
        Math.round(prng() * 255),
        Math.round(prng() * 255),
      ];
      const hsl: HSL = rgbToHsl(...rgb);

      expectHslClose(rgbToHsl(...hslToRgb(...hsl)), hsl);
    }
  });

  it('round-trips known colors between hex and rgb', () => {
    const knownColors: ReadonlyArray<readonly [RGB, string]> = [
      [[0, 0, 0], '#000000'],
      [[255, 255, 255], '#ffffff'],
      [[255, 0, 0], '#ff0000'],
      [[0, 255, 0], '#00ff00'],
      [[0, 0, 255], '#0000ff'],
      [[255, 255, 0], '#ffff00'],
      [[0, 255, 255], '#00ffff'],
      [[255, 0, 255], '#ff00ff'],
      [[255, 165, 0], '#ffa500'],
      [[70, 130, 180], '#4682b4'],
    ];

    for (const [rgb, hex] of knownColors) {
      expect(rgbToHex(...rgb)).toBe(hex);
      expect(hexToRgb(hex)).toEqual(rgb);
      expect(hexToRgb(hex.slice(1).toUpperCase())).toEqual(rgb);
    }
  });

  it('parses short and alpha hex forms', () => {
    expect(hexToRgb('#abc')).toEqual([170, 187, 204]);
    expect(hexToRgb('ff0080cc')).toEqual([255, 0, 128]);
  });

  it('computes WCAG luminance for key reference colors', () => {
    expect(luminance(255, 255, 255)).toBe(1);
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(128, 128, 128)).toBeCloseTo(0.2159, 3);
  });

  it('computes WCAG contrast ratios for canonical thresholds', () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBe(21);
    expect(contrastRatio([64, 64, 64], [64, 64, 64])).toBe(1);
    expect(contrastRatio([255, 255, 255], [89, 89, 89])).toBeGreaterThanOrEqual(7);
    expect(contrastRatio([255, 255, 255], [90, 90, 90])).toBeLessThan(7);
  });

  it('returns null for invalid hex strings', () => {
    const invalidHexes = [
      '',
      '#',
      '12',
      '#1234',
      '#12345',
      '#1234567',
      '#123456789',
      'xyz',
      '#gggggg',
      '12xz89',
    ];

    for (const invalidHex of invalidHexes) {
      expect(hexToRgb(invalidHex)).toBeNull();
    }
  });

  it('returns gray for zero-saturation HSL regardless of hue', () => {
    expect(hslToRgb(0, 0, 0.25)).toEqual([64, 64, 64]);
    expect(hslToRgb(120, 0, 0.25)).toEqual([64, 64, 64]);
    expect(hslToRgb(360, 0, 0.25)).toEqual([64, 64, 64]);
  });

  it('wraps hue so h=360 matches h=0', () => {
    expect(hslToRgb(360, 1, 0.5)).toEqual(hslToRgb(0, 1, 0.5));
  });

  it('clamps rgb channels before converting to hex', () => {
    expect(rgbToHex(300, -5, 128)).toBe('#ff0080');
  });
});
