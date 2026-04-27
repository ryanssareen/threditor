import 'server-only';

/**
 * M17 Unit 3 (helper): palette + per-pixel index extraction.
 *
 * Pure function — no I/O, no logging. Input: a 64×64 RGBA buffer
 * (4 bytes per pixel, row-major top-left origin). Output: a hex
 * palette of ≤16 entries plus a 4096-byte `Uint8ClampedArray` of
 * palette indices.
 *
 * Alpha awareness: each palette entry is rendered as `#rrggbb` when
 * alpha is 0xFF and `#rrggbbaa` otherwise. Minecraft skin atlases use
 * transparency in the second-layer overlay regions; the M16 codec
 * already accepts `#rrggbbaa` for exactly this reason.
 *
 * The function builds a `Map<rgba32, paletteIndex>` cache from the
 * palette's own color points, then walks the quantized output once
 * to assign indices. The map is O(palette.length) entries — at most
 * 16 — so collisions are not a real concern.
 *
 * Separated from `cloudflare.ts` so the indexing logic can be
 * unit-tested in isolation against synthetic inputs without setting
 * up a full sharp pipeline.
 */

import { applyPaletteSync, buildPaletteSync, utils } from 'image-q';

import { ImageProcessingError } from './cloudflare-errors';

const PALETTE_MAX = 16;

export type QuantizeResult = {
  /** Hex palette, 1..16 entries. `#rrggbb` when opaque, `#rrggbbaa` otherwise. */
  palette: string[];
  /** Length = width*height. Each byte is an index into `palette`. */
  indices: Uint8ClampedArray;
};

function toHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/** Pack four 0..255 channels into a single 32-bit unsigned integer. */
function packRgba(r: number, g: number, b: number, a: number): number {
  // Use unsigned right-shift to keep the result in the 32-bit range.
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

function paletteEntryToHex(r: number, g: number, b: number, a: number): string {
  const base = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return a === 0xff ? base : `${base}${toHex(a)}`;
}

export type QuantizeOptions = {
  width: number;
  height: number;
  /** Cap palette at this many colors. Must be <= 16. Default: 16. */
  maxColors?: number;
};

export function quantizeRgbaBuffer(
  rgba: Uint8Array | Uint8ClampedArray | Buffer,
  options: QuantizeOptions,
): QuantizeResult {
  const { width, height } = options;
  const maxColors = options.maxColors ?? PALETTE_MAX;
  if (maxColors < 1 || maxColors > PALETTE_MAX) {
    throw new ImageProcessingError(
      'quantize_failed',
      `maxColors must be in [1, ${PALETTE_MAX}], got ${maxColors}`,
    );
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new ImageProcessingError(
      'quantize_failed',
      `invalid dimensions ${width}x${height}`,
    );
  }
  const expectedBytes = width * height * 4;
  if (rgba.byteLength !== expectedBytes) {
    throw new ImageProcessingError(
      'quantize_failed',
      `buffer length ${rgba.byteLength} != expected ${expectedBytes}`,
    );
  }

  // image-q's `fromUint8Array` expects a plain `Uint8Array`. A Node
  // `Buffer` is a Uint8Array subclass and works directly.
  const inputContainer = utils.PointContainer.fromUint8Array(
    rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba),
    width,
    height,
  );

  let palette;
  try {
    palette = buildPaletteSync([inputContainer], {
      colors: maxColors,
      paletteQuantization: 'rgbquant',
      colorDistanceFormula: 'ciede2000',
    });
  } catch (err) {
    throw new ImageProcessingError('quantize_failed', formatErr(err));
  }

  let outputContainer;
  try {
    outputContainer = applyPaletteSync(inputContainer, palette, {
      colorDistanceFormula: 'ciede2000',
      imageQuantization: 'nearest',
    });
  } catch (err) {
    throw new ImageProcessingError('quantize_failed', formatErr(err));
  }

  const colorPoints = palette.getPointContainer().getPointArray();
  if (colorPoints.length === 0) {
    throw new ImageProcessingError(
      'quantize_failed',
      'palette quantizer returned 0 colors',
    );
  }
  if (colorPoints.length > PALETTE_MAX) {
    throw new ImageProcessingError(
      'quantize_failed',
      `palette quantizer returned ${colorPoints.length} colors, expected <= ${PALETTE_MAX}`,
    );
  }

  // Build palette + lookup map. The lookup map's keys are 32-bit
  // packed RGBA so equality comparisons are O(1).
  const paletteHex: string[] = new Array(colorPoints.length);
  const lookup = new Map<number, number>();
  for (let i = 0; i < colorPoints.length; i++) {
    const p = colorPoints[i];
    paletteHex[i] = paletteEntryToHex(p.r, p.g, p.b, p.a);
    lookup.set(packRgba(p.r, p.g, p.b, p.a), i);
  }

  // Walk the output, look each pixel up. `applyPaletteSync` writes
  // palette colors back into the output, so every pixel's RGBA must
  // appear as a key in `lookup`. If we ever miss, that's a quantizer
  // contract violation, not a model failure.
  const outBytes = outputContainer.toUint8Array();
  const indices = new Uint8ClampedArray(width * height);
  for (let i = 0; i < indices.length; i++) {
    const o = i * 4;
    const key = packRgba(
      outBytes[o],
      outBytes[o + 1],
      outBytes[o + 2],
      outBytes[o + 3],
    );
    const idx = lookup.get(key);
    if (idx === undefined) {
      throw new ImageProcessingError(
        'quantize_failed',
        `quantized pixel at ${i} (${outBytes[o]},${outBytes[o + 1]},${outBytes[o + 2]},${outBytes[o + 3]}) not in palette`,
      );
    }
    indices[i] = idx;
  }

  return { palette: paletteHex, indices };
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown quantizer error';
}
