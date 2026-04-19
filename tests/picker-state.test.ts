import { describe, expect, it } from 'vitest';

import {
  handleHexInput,
  handleHueDrag,
  handleSLDrag,
  pickerStateFromHex,
  pickerStateFromHSL,
} from '../lib/color/picker-state';

const HUE_TOLERANCE = 1;
const UNIT_TOLERANCE = 0.01;

const hueDistance = (a: number, b: number): number => {
  const raw = Math.abs(a - b) % 360;
  return Math.min(raw, 360 - raw);
};

describe('picker-state', () => {
  it('pickerStateFromHex — happy path (pure red)', () => {
    const state = pickerStateFromHex('#ff0000');
    expect(state).not.toBeNull();
    expect(hueDistance(state!.h, 0)).toBeLessThanOrEqual(HUE_TOLERANCE);
    expect(Math.abs(state!.s - 1)).toBeLessThanOrEqual(UNIT_TOLERANCE);
    expect(Math.abs(state!.l - 0.5)).toBeLessThanOrEqual(UNIT_TOLERANCE);
    expect(state!.hex).toBe('#ff0000');
  });

  it('pickerStateFromHex — invalid hex returns null', () => {
    expect(pickerStateFromHex('xyz')).toBeNull();
    expect(pickerStateFromHex('')).toBeNull();
    expect(pickerStateFromHex('#12')).toBeNull();
    expect(pickerStateFromHex('notacolor')).toBeNull();
  });

  it('pickerStateFromHex — case-insensitive input normalizes to lowercase hex', () => {
    const state = pickerStateFromHex('#FF00FF');
    expect(state).not.toBeNull();
    expect(state!.hex).toBe('#ff00ff');
  });

  it('pickerStateFromHSL — happy path (pure red from h=0,s=1,l=0.5)', () => {
    const state = pickerStateFromHSL(0, 1, 0.5);
    expect(state.hex).toBe('#ff0000');
  });

  it('pickerStateFromHSL — grayscale (h=0,s=0,l=0.5) produces #808080', () => {
    const state = pickerStateFromHSL(0, 0, 0.5);
    expect(state.hex).toBe('#808080');
  });

  it('handleHexInput — invalid hex preserves prior state', () => {
    const prior = pickerStateFromHex('#ff0000')!;
    const result = handleHexInput(prior, 'xyz');
    expect(result).toBe(prior);
  });

  it('handleHexInput — valid hex updates state to green', () => {
    const prior = pickerStateFromHex('#ff0000')!;
    const result = handleHexInput(prior, '#00ff00');
    expect(result.hex).toBe('#00ff00');
    expect(hueDistance(result.h, 120)).toBeLessThanOrEqual(HUE_TOLERANCE);
    expect(Math.abs(result.s - 1)).toBeLessThanOrEqual(UNIT_TOLERANCE);
    expect(Math.abs(result.l - 0.5)).toBeLessThanOrEqual(UNIT_TOLERANCE);
  });

  it('handleSLDrag — gray-axis hysteresis latches prior hue when s < 0.01', () => {
    const prior = pickerStateFromHSL(120, 0.8, 0.5);
    const result = handleSLDrag(prior, 0.005, 0.5);
    expect(result.h).toBe(120);
  });

  it('handleSLDrag — normal drag preserves hue at s >= 0.01', () => {
    const prior = pickerStateFromHSL(120, 0.8, 0.5);
    const result = handleSLDrag(prior, 0.6, 0.3);
    expect(hueDistance(result.h, 120)).toBeLessThanOrEqual(HUE_TOLERANCE);
    expect(Math.abs(result.s - 0.6)).toBeLessThanOrEqual(UNIT_TOLERANCE);
    expect(Math.abs(result.l - 0.3)).toBeLessThanOrEqual(UNIT_TOLERANCE);
  });

  it('handleSLDrag — at exactly s=0.01 boundary hysteresis does NOT activate', () => {
    const prior = pickerStateFromHSL(120, 0.8, 0.5);
    const result = handleSLDrag(prior, 0.01, 0.5);
    expect(Math.abs(result.s - 0.01)).toBeLessThanOrEqual(UNIT_TOLERANCE);
    expect(Math.abs(result.l - 0.5)).toBeLessThanOrEqual(UNIT_TOLERANCE);
  });

  it('handleHueDrag — preserves S and L, updates H', () => {
    const prior = pickerStateFromHSL(0, 0.5, 0.7);
    const result = handleHueDrag(prior, 180);
    expect(hueDistance(result.h, 180)).toBeLessThanOrEqual(HUE_TOLERANCE);
    expect(Math.abs(result.s - 0.5)).toBeLessThanOrEqual(UNIT_TOLERANCE);
    expect(Math.abs(result.l - 0.7)).toBeLessThanOrEqual(UNIT_TOLERANCE);
  });

  it('sanity flow from plan §F.4 — all steps produce valid states', () => {
    const isValidState = (s: unknown): void => {
      expect(s).not.toBeNull();
      const state = s as { h: number; s: number; l: number; hex: string };
      expect(typeof state.h).toBe('number');
      expect(typeof state.s).toBe('number');
      expect(typeof state.l).toBe('number');
      expect(typeof state.hex).toBe('string');
      expect(state.hex).toMatch(/^#[0-9a-f]{6}$/);
    };

    const start = pickerStateFromHex('#6b3a1e');
    isValidState(start);

    const step1 = handleSLDrag(start!, 0.9, 0.4);
    isValidState(step1);

    const step2 = pickerStateFromHex('#00ff00');
    isValidState(step2);

    const step3 = pickerStateFromHex('#4a7a32');
    isValidState(step3);

    const step4 = handleHexInput(step3!, '#8b5a3c');
    isValidState(step4);
  });
});
