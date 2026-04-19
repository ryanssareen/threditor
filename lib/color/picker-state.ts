/**
 * M3: canonical HSL picker state model.
 *
 * Prevents the three color-picker drift failure modes called out in
 * docs/plans/m3-paint-canvas.md §F.1:
 *
 *   1. Rounding bias (Math.round in hslToRgb vs Math.floor in rgbToHex
 *      skews the round-trip).
 *   2. Lossy storage — integer pixel coords vs float HSL values lose
 *      precision across conversions.
 *   3. Gray axis singularity — when S=0, H is undefined. rgbToHsl(128,128,128)
 *      returns H=0, but rgbToHsl(128,128,129) can return H ~= 240. Nudging
 *      one pixel across S=0 causes hue jumps unless hue is latched.
 *
 * Load-bearing rules (apply wherever PickerState is read/written):
 *
 *   - HSL is canonical. Cursor positions, sliders, and previews derive
 *     from (h, s, l). hex is derived only at the moment of HSL change.
 *   - Hex input writes HSL only, never hex directly. Typing "#3366CC"
 *     stores (216deg, 0.6, 0.5) and regenerates hex as "#3366cc".
 *   - No round-trip through RGB for display. SL cursor position is
 *     `(s * squareWidth, (1 - l) * squareHeight)` directly.
 *   - Gray axis hysteresis: when s < 0.01, the prior hue is preserved.
 *     Prevents "typed #808080 then nudged 1px → hue jumped to 240deg".
 */

import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from './conversions';

export type PickerState = {
  /** [0, 360) canonical */
  h: number;
  /** [0, 1] canonical */
  s: number;
  /** [0, 1] canonical */
  l: number;
  /** Lowercase hex including leading '#'. Derived from (h, s, l). */
  hex: string;
};

const GRAY_AXIS_THRESHOLD = 0.01;

/**
 * Build a PickerState from a hex string. Returns null on invalid input
 * (matches `hexToRgb`'s contract). Caller must handle the null case by
 * leaving prior state untouched.
 */
export function pickerStateFromHex(hex: string): PickerState | null {
  const rgb = hexToRgb(hex);
  if (rgb === null) return null;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return { h, s, l, hex: hex.toLowerCase() };
}

/**
 * Build a PickerState from canonical HSL values. Always succeeds (caller
 * is responsible for clamping h/s/l to their valid ranges beforehand).
 */
export function pickerStateFromHSL(h: number, s: number, l: number): PickerState {
  const [r, g, b] = hslToRgb(h, s, l);
  return { h, s, l, hex: rgbToHex(r, g, b) };
}

/**
 * Handle a hex-input change. Invalid hex → no-op (prior state preserved).
 */
export function handleHexInput(state: PickerState, hex: string): PickerState {
  const next = pickerStateFromHex(hex);
  return next ?? state;
}

/**
 * Handle a drag in the SL square. Gray-axis hysteresis preserves the prior
 * hue when `s < GRAY_AXIS_THRESHOLD` so the hue slider doesn't jump.
 */
export function handleSLDrag(state: PickerState, s: number, l: number): PickerState {
  const next = pickerStateFromHSL(state.h, s, l);
  if (s < GRAY_AXIS_THRESHOLD) return { ...next, h: state.h };
  return next;
}

/**
 * Handle a drag on the hue ring. SL values pass through unchanged; hue
 * becomes the new canonical.
 */
export function handleHueDrag(state: PickerState, h: number): PickerState {
  return pickerStateFromHSL(h, state.s, state.l);
}
