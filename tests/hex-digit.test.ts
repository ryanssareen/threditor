// @vitest-environment node
//
// M5 Unit 0 — scalar hex digit parse.
// Extracted from ViewportUV and PlayerModel; shared on hot paint paths.

import { describe, expect, it } from 'vitest';

import { hexDigit } from '@/lib/color/hex-digit';

describe('hexDigit', () => {
  it('parses digits 0-9', () => {
    expect(hexDigit('#0a1b2c', 1)).toBe(0);
    expect(hexDigit('#000000', 1)).toBe(0);
    expect(hexDigit('#123456', 1)).toBe(1);
    expect(hexDigit('#987654', 1)).toBe(9);
  });

  it('parses lowercase hex letters a-f', () => {
    expect(hexDigit('#abcdef', 1)).toBe(10);
    expect(hexDigit('#abcdef', 2)).toBe(11);
    expect(hexDigit('#abcdef', 3)).toBe(12);
    expect(hexDigit('#abcdef', 4)).toBe(13);
    expect(hexDigit('#abcdef', 5)).toBe(14);
    expect(hexDigit('#abcdef', 6)).toBe(15);
  });

  it('parses uppercase hex letters A-F defensively', () => {
    expect(hexDigit('#ABCDEF', 1)).toBe(10);
    expect(hexDigit('#ABCDEF', 6)).toBe(15);
  });

  it('ffffff → 15 per digit', () => {
    expect(hexDigit('#ffffff', 1)).toBe(15);
    expect(hexDigit('#ffffff', 6)).toBe(15);
  });

  it('returns 0 for non-hex characters', () => {
    expect(hexDigit('#z00000', 1)).toBe(0);
    expect(hexDigit('#', 0)).toBe(0); // '#' is not hex
  });

  it('composes per-channel into the expected RGB byte', () => {
    const hex = '#abcdef';
    const r = (hexDigit(hex, 1) << 4) | hexDigit(hex, 2);
    const g = (hexDigit(hex, 3) << 4) | hexDigit(hex, 4);
    const b = (hexDigit(hex, 5) << 4) | hexDigit(hex, 6);
    expect(r).toBe(0xab);
    expect(g).toBe(0xcd);
    expect(b).toBe(0xef);
  });
});
