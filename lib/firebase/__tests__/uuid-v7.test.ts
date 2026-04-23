// @vitest-environment node
//
// M11 Unit 4 — UUID v7 generator.

import { describe, expect, it } from 'vitest';

import { generateUuidV7, UUID_V7_REGEX } from '../uuid-v7';

describe('generateUuidV7', () => {
  it('matches the v7 format regex (36-char, version nibble 7, variant 10xx)', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateUuidV7()).toMatch(UUID_V7_REGEX);
    }
  });

  it('version nibble is literally 7', () => {
    // 3rd group (after 2 hyphens) starts with the version nibble.
    const id = generateUuidV7();
    const versionNibble = id.split('-')[2][0];
    expect(versionNibble).toBe('7');
  });

  it('variant top-two-bits are 10 (so 4th-group first hex is 8, 9, a, or b)', () => {
    // 4th group first hex corresponds to bits 64-67.
    // Variant bits are bits 64-65 = 10, so the high nibble is
    // 0b10xx = 8, 9, a, or b.
    for (let i = 0; i < 20; i++) {
      const id = generateUuidV7();
      const variantHex = id.split('-')[3][0];
      expect('89ab').toContain(variantHex);
    }
  });

  it('timestamps are monotonic across rapid calls', () => {
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) ids.push(generateUuidV7());
    const timestamps = ids.map((id) => {
      const hex = id.replace(/-/g, '').slice(0, 12);
      return parseInt(hex, 16);
    });
    for (let i = 1; i < timestamps.length; i++) {
      // Allow same-ms ties (IDs within one millisecond share a timestamp
      // prefix by design). Must never decrease.
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it('is unique across 10 000 sequential calls', () => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i++) set.add(generateUuidV7());
    expect(set.size).toBe(10_000);
  });
});
