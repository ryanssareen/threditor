// @vitest-environment node
//
// M5 Unit 0 — atlas math helpers. Extracted from PlayerModel +
// paint-bridge.test.ts so both paint surfaces share a single Y-flip impl.

import { describe, expect, it } from 'vitest';

import { clampAtlas, uvToAtlasX, uvToAtlasY } from '@/lib/three/atlas-math';

describe('clampAtlas', () => {
  it('clamps negatives to 0', () => {
    expect(clampAtlas(-1)).toBe(0);
    expect(clampAtlas(-100)).toBe(0);
  });
  it('clamps values ≥ 64 to 63', () => {
    expect(clampAtlas(64)).toBe(63);
    expect(clampAtlas(200)).toBe(63);
  });
  it('passes through values in [0, 63]', () => {
    expect(clampAtlas(0)).toBe(0);
    expect(clampAtlas(32)).toBe(32);
    expect(clampAtlas(63)).toBe(63);
  });
});

describe('uvToAtlasX (no Y-flip)', () => {
  it('u=0 → 0', () => {
    expect(uvToAtlasX(0)).toBe(0);
  });
  it('u=1 → 63 (clamped, not 64)', () => {
    expect(uvToAtlasX(1)).toBe(63);
  });
  it('u=0.5 → 32', () => {
    expect(uvToAtlasX(0.5)).toBe(32);
  });
  it('clamps UV extrapolation at the overlay +1-px edge', () => {
    expect(uvToAtlasX(-0.01)).toBe(0);
    expect(uvToAtlasX(1.01)).toBe(63);
  });
});

describe('uvToAtlasY (Y-flipped)', () => {
  it('v=0 → 63 (bottom of UV → bottom row of atlas)', () => {
    expect(uvToAtlasY(0)).toBe(63);
  });
  it('v=1 → 0 (top of UV → top row of atlas)', () => {
    expect(uvToAtlasY(1)).toBe(0);
  });
  it('v=0.5 → 32', () => {
    expect(uvToAtlasY(0.5)).toBe(32);
  });
});
