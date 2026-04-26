/**
 * M16 Unit 1: skin codec — palette + per-row RLE decoder.
 *
 * Pure module — no `'use client'`, no `'server-only'`. Both the API
 * route (server) and the editor handler (client) import this. The
 * encoder is intentionally NOT implemented in M16; only `decode` and
 * `validateResponse` are needed for the round-trip from Groq → Layer.
 *
 * Design principle: validate the entire payload BEFORE allocating the
 * 16384-byte output buffer. This makes attacker-crafted Groq responses
 * incapable of producing any partial-write state — every error path
 * throws before a single byte is written, and there is no out-of-bounds
 * write surface even under adversarial input.
 */

import { CodecError } from './types';
import type { AISkinResponse } from './types';

/** Width × height × channels = 64 * 64 * 4. */
export const SKIN_PIXEL_BYTE_LENGTH = 64 * 64 * 4;

const SKIN_DIM = 64;
const ROW_STRIDE = SKIN_DIM * 4;
const PALETTE_MAX = 16;
const HEX_RE = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

/**
 * Validate that `value` matches the `AISkinResponse` shape — array of
 * hex strings + 64-row RLE matrix — without yet decoding it. Throws
 * `CodecError` with a specific `reason` on the first mismatch.
 *
 * Used by the Groq client wrapper to gate retry-at-temperature-0 vs.
 * accept the response. Separate from `decode` so the route can log
 * the failure category before deciding to retry.
 */
export function validateResponse(value: unknown): asserts value is AISkinResponse {
  if (value === null || typeof value !== 'object') {
    throw new CodecError('shape_invalid', 'Response is not an object');
  }
  const obj = value as Record<string, unknown>;

  // Palette ─────────────────────────────────────────────────────────
  if (!Array.isArray(obj.palette)) {
    throw new CodecError('shape_invalid', 'palette is not an array');
  }
  const palette = obj.palette as unknown[];
  if (palette.length === 0) {
    throw new CodecError('palette_empty');
  }
  if (palette.length > PALETTE_MAX) {
    throw new CodecError('palette_too_large');
  }
  for (let i = 0; i < palette.length; i++) {
    const hex = palette[i];
    if (typeof hex !== 'string' || !HEX_RE.test(hex)) {
      throw new CodecError('palette_hex_invalid', `palette[${i}] is not #rrggbb(aa)`);
    }
  }

  // Rows ────────────────────────────────────────────────────────────
  if (!Array.isArray(obj.rows)) {
    throw new CodecError('shape_invalid', 'rows is not an array');
  }
  const rows = obj.rows as unknown[];
  if (rows.length !== SKIN_DIM) {
    throw new CodecError('row_count_invalid', `expected 64 rows, got ${rows.length}`);
  }
  for (let r = 0; r < SKIN_DIM; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) {
      throw new CodecError('shape_invalid', `rows[${r}] is not an array`);
    }
    if (row.length === 0) {
      throw new CodecError('row_empty', `rows[${r}] has no RLE pairs`);
    }
    let runSum = 0;
    for (let p = 0; p < row.length; p++) {
      const pair = row[p];
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        typeof pair[0] !== 'number' ||
        typeof pair[1] !== 'number'
      ) {
        throw new CodecError(
          'row_runs_invalid',
          `rows[${r}][${p}] is not a [paletteIndex, runLength] tuple`,
        );
      }
      const idx = pair[0];
      const run = pair[1];
      if (!Number.isInteger(idx) || idx < 0 || idx >= palette.length) {
        throw new CodecError(
          'palette_index_oor',
          `rows[${r}][${p}].paletteIndex=${idx} not in [0, ${palette.length})`,
        );
      }
      if (!Number.isInteger(run) || run <= 0) {
        throw new CodecError(
          'row_runs_invalid',
          `rows[${r}][${p}].runLength=${run} must be a positive integer`,
        );
      }
      runSum += run;
      if (runSum > SKIN_DIM) {
        throw new CodecError(
          'row_runs_invalid',
          `rows[${r}] run sum exceeds 64 at pair ${p}`,
        );
      }
    }
    if (runSum !== SKIN_DIM) {
      throw new CodecError(
        'row_runs_invalid',
        `rows[${r}] run sum is ${runSum}, expected 64`,
      );
    }
  }
}

/**
 * Parse one palette hex string into an `[r, g, b, a]` tuple. Accepts
 * `#rrggbb` (alpha defaults to 0xFF) and `#rrggbbaa`. Case-insensitive.
 *
 * Caller has already passed this through `HEX_RE` in `validateResponse`,
 * so this never throws — the invariants are: `hex` starts with `#`,
 * length is 7 or 9, every body char is `[0-9a-fA-F]`.
 */
function parsePaletteHex(hex: string): readonly [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 0xff;
  return [r, g, b, a];
}

/**
 * Decode an `AISkinResponse` into a 16384-byte `Uint8ClampedArray`.
 * Validates the entire shape first, then allocates and writes. On
 * validation failure throws `CodecError` with a specific `reason`;
 * the buffer is never partially populated.
 */
export function decode(response: unknown): Uint8ClampedArray {
  validateResponse(response);
  // After `validateResponse` the cast is sound.
  const { palette, rows } = response as AISkinResponse;

  // Pre-parse palette into a fixed-stride buffer for fast lookup.
  const paletteRgba = new Uint8ClampedArray(palette.length * 4);
  for (let i = 0; i < palette.length; i++) {
    const [r, g, b, a] = parsePaletteHex(palette[i]);
    const o = i * 4;
    paletteRgba[o] = r;
    paletteRgba[o + 1] = g;
    paletteRgba[o + 2] = b;
    paletteRgba[o + 3] = a;
  }

  const out = new Uint8ClampedArray(SKIN_PIXEL_BYTE_LENGTH);
  for (let r = 0; r < SKIN_DIM; r++) {
    let col = 0;
    const rowStart = r * ROW_STRIDE;
    const row = rows[r];
    for (let p = 0; p < row.length; p++) {
      const [idx, run] = row[p];
      const po = idx * 4;
      const pr = paletteRgba[po];
      const pg = paletteRgba[po + 1];
      const pb = paletteRgba[po + 2];
      const pa = paletteRgba[po + 3];
      for (let k = 0; k < run; k++) {
        const o = rowStart + (col + k) * 4;
        out[o] = pr;
        out[o + 1] = pg;
        out[o + 2] = pb;
        out[o + 3] = pa;
      }
      col += run;
    }
  }
  return out;
}
