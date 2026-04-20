/**
 * lib/editor/tools/picker.ts
 *
 * M5 picker: sample a single atlas pixel and return its hex + alpha.
 *
 * - Returns null only for out-of-bounds coordinates.
 * - Fully transparent pixels return `{hex: '#000000', alpha: 0}` so callers
 *   can decide to skip-or-sample (M5 policy: skip when alpha === 0).
 * - Hex string is always lowercase `#rrggbb` (store lowercases on
 *   setActiveColor; we honor the same convention here).
 */

import { SKIN_ATLAS_SIZE } from '@/lib/three/constants';

const HEX_CHARS = '0123456789abcdef';

function byteToHex(n: number): string {
  return HEX_CHARS[(n >> 4) & 0xf] + HEX_CHARS[n & 0xf];
}

export function pickColorAt(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
): { hex: string; alpha: number } | null {
  if (x < 0 || x >= SKIN_ATLAS_SIZE || y < 0 || y >= SKIN_ATLAS_SIZE) return null;
  const i = (y * SKIN_ATLAS_SIZE + x) * 4;
  const r = pixels[i];
  const g = pixels[i + 1];
  const b = pixels[i + 2];
  const alpha = pixels[i + 3];
  return { hex: `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`, alpha };
}
