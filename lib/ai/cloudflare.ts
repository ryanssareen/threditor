import 'server-only';

/**
 * M17 Unit 3: PNG buffer → AISkinResponse pipeline.
 *
 * Pure transform. No network I/O, no logging side effects. Throws
 * `ImageProcessingError` (typed) on any sharp/image-q/RLE failure
 * with a category tag the route can record on /aiGenerations.
 *
 * Pipeline shape:
 *   sharp(buf).resize(64, 64, { kernel: 'lanczos3', fit: 'fill' })
 *             .ensureAlpha()
 *             .raw()
 *             .toBuffer({ resolveWithObject: true })
 *      → 16,384-byte RGBA buffer
 *   quantizeRgbaBuffer (image-q rgbquant + ciede2000)
 *      → palette: 1..16 hex strings, indices: 4096-byte Uint8ClampedArray
 *   row-major scan → per-row RLE pairs whose runLengths sum to 64
 *   AISkinResponse { palette, rows }
 *
 * `validateResponse` from `skin-codec.ts` should pass by construction;
 * if it ever fails, that is a bug in this module, not a model failure.
 * We do NOT auto-fix here — let it surface.
 *
 * Sharp is dynamically imported on first call so the package's native
 * binary does not load on every cold start when the route falls
 * through to the Groq path via `AI_PROVIDER=groq`.
 */

import { ImageProcessingError } from './cloudflare-errors';
import { quantizeRgbaBuffer } from './cloudflare-quantize';
import type { AISkinResponse } from './types';

const SKIN_DIM = 64;

/**
 * Convert a 512×512 (or any) PNG buffer into an AISkinResponse.
 *
 * Caller-side preconditions:
 *   - Input is a complete PNG/JPEG/WebP/etc that sharp can decode.
 *   - Caller has already validated that the upstream HTTP response
 *     was 2xx and the body is image bytes.
 */
export async function generateSkinFromImage(
  pngBuffer: Buffer,
): Promise<AISkinResponse> {
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.byteLength === 0) {
    throw new ImageProcessingError(
      'resize_failed',
      'input is not a non-empty Buffer',
    );
  }

  const sharpMod = await loadSharp();

  let raw: { data: Buffer; info: { width: number; height: number; channels: number } };
  try {
    raw = await sharpMod(pngBuffer)
      .resize(SKIN_DIM, SKIN_DIM, { kernel: 'lanczos3', fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    throw new ImageProcessingError('resize_failed', formatErr(err));
  }

  if (raw.info.width !== SKIN_DIM || raw.info.height !== SKIN_DIM) {
    throw new ImageProcessingError(
      'resize_failed',
      `sharp returned ${raw.info.width}x${raw.info.height}, expected ${SKIN_DIM}x${SKIN_DIM}`,
    );
  }
  if (raw.info.channels !== 4) {
    throw new ImageProcessingError(
      'resize_failed',
      `sharp returned ${raw.info.channels} channels, expected 4 (RGBA after ensureAlpha)`,
    );
  }

  const { palette, indices } = quantizeRgbaBuffer(raw.data, {
    width: SKIN_DIM,
    height: SKIN_DIM,
    maxColors: 16,
  });

  const rows = indicesToRleRows(indices);

  return { palette, rows };
}

/**
 * Encode a 64×64 row-major palette-index buffer into per-row RLE pairs
 * whose runLengths sum to exactly 64 each. Empty rows are forbidden by
 * the codec — an all-same-color row becomes `[[idx, 64]]`.
 */
export function indicesToRleRows(
  indices: Uint8ClampedArray | Uint8Array,
): [paletteIndex: number, runLength: number][][] {
  if (indices.length !== SKIN_DIM * SKIN_DIM) {
    throw new ImageProcessingError(
      'rle_failed',
      `indices length ${indices.length} != ${SKIN_DIM * SKIN_DIM}`,
    );
  }
  const rows: [number, number][][] = new Array(SKIN_DIM);
  for (let r = 0; r < SKIN_DIM; r++) {
    const offset = r * SKIN_DIM;
    const row: [number, number][] = [];
    let currentIdx = indices[offset];
    let runLength = 1;
    for (let c = 1; c < SKIN_DIM; c++) {
      const idx = indices[offset + c];
      if (idx === currentIdx) {
        runLength++;
      } else {
        row.push([currentIdx, runLength]);
        currentIdx = idx;
        runLength = 1;
      }
    }
    row.push([currentIdx, runLength]);
    rows[r] = row;
  }
  return rows;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedSharp: any | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSharp(): Promise<any> {
  if (cachedSharp !== null) return cachedSharp;
  try {
    const mod = await import('sharp');
    // sharp is a CJS module exporting a callable function as `default`
    // under ESM interop, but on some bundlers the module itself is the
    // function. Handle both shapes.
    const callable =
      typeof mod === 'function'
        ? mod
        : typeof (mod as { default?: unknown }).default === 'function'
        ? (mod as { default: (b: Buffer) => unknown }).default
        : null;
    if (callable === null) {
      throw new Error('sharp default export is not callable');
    }
    cachedSharp = callable;
    return cachedSharp;
  } catch (err) {
    throw new ImageProcessingError(
      'resize_failed',
      `failed to load sharp: ${formatErr(err)}`,
    );
  }
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown image-pipeline error';
}
