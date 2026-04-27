// @vitest-environment node
//
// M17 Unit 3 — PNG → AISkinResponse pipeline.
//
// Synthetic PNG inputs are generated with sharp itself so this test
// suite has no fixture dependencies and remains hermetic.

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { ImageProcessingError } from '../cloudflare-errors';
import { generateSkinFromImage, indicesToRleRows } from '../cloudflare';
import { decode, validateResponse } from '../skin-codec';

async function solidPng(
  width: number,
  height: number,
  rgba: { r: number; g: number; b: number; alpha: number },
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: rgba },
  })
    .png()
    .toBuffer();
}

async function halfSplitPng(
  width: number,
  height: number,
  left: { r: number; g: number; b: number; alpha: number },
  right: { r: number; g: number; b: number; alpha: number },
): Promise<Buffer> {
  // Build a raw RGBA buffer manually, then encode as PNG.
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const c = x < width / 2 ? left : right;
      buf[o] = c.r;
      buf[o + 1] = c.g;
      buf[o + 2] = c.b;
      buf[o + 3] = Math.round(c.alpha * 255);
    }
  }
  return sharp(buf, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe('generateSkinFromImage — happy paths', () => {
  it('solid red 512x512 → palette ["#ff0000"], all rows [[0, 64]]', async () => {
    const png = await solidPng(512, 512, { r: 255, g: 0, b: 0, alpha: 1 });
    const result = await generateSkinFromImage(png);
    expect(result.palette.map((h) => h.toLowerCase())).toEqual(['#ff0000']);
    expect(result.rows).toHaveLength(64);
    for (const row of result.rows) {
      expect(row).toEqual([[0, 64]]);
    }
  });

  it('64x64 input (already at target) decodes correctly', async () => {
    const png = await solidPng(64, 64, { r: 64, g: 128, b: 192, alpha: 1 });
    const result = await generateSkinFromImage(png);
    expect(result.palette).toHaveLength(1);
    expect(result.palette[0].toLowerCase()).toBe('#4080c0');
    expect(result.rows).toHaveLength(64);
  });

  it('half-and-half hard split → ≤2 palette entries, each row sums to 64', async () => {
    // 64x64 so the lanczos filter doesn't introduce intermediate
    // colours from a 512→64 downscale's transition zone.
    const png = await halfSplitPng(
      64,
      64,
      { r: 255, g: 0, b: 0, alpha: 1 },
      { r: 0, g: 0, b: 255, alpha: 1 },
    );
    const result = await generateSkinFromImage(png);
    expect(result.palette.length).toBeLessThanOrEqual(2);
    expect(result.palette.length).toBeGreaterThanOrEqual(2);
    // Every row sums to 64.
    for (const row of result.rows) {
      const sum = row.reduce((acc, [, run]) => acc + run, 0);
      expect(sum).toBe(64);
    }
  });

  it('palette is capped at 16 entries even on noisy input', async () => {
    // 64x64 random RGBA noise — 4096 pixels, almost-all unique.
    const buf = Buffer.alloc(64 * 64 * 4);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = (i * 17) & 0xff;
      buf[i + 1] = (i * 31) & 0xff;
      buf[i + 2] = (i * 53) & 0xff;
      buf[i + 3] = 255;
    }
    const png = await sharp(buf, { raw: { width: 64, height: 64, channels: 4 } })
      .png()
      .toBuffer();
    const result = await generateSkinFromImage(png);
    expect(result.palette.length).toBeLessThanOrEqual(16);
    expect(result.rows).toHaveLength(64);
  });

  it('output round-trips through validateResponse + decode without auto-fix', async () => {
    const png = await solidPng(256, 256, { r: 12, g: 34, b: 56, alpha: 1 });
    const result = await generateSkinFromImage(png);
    // Codec validation must pass (unmodified).
    validateResponse(result);
    // Decoded buffer is exactly 16384 bytes (64*64*4).
    const decoded = decode(result);
    expect(decoded.byteLength).toBe(64 * 64 * 4);
    // First pixel is the same color as the palette entry.
    expect(decoded[0]).toBe(12);
    expect(decoded[1]).toBe(34);
    expect(decoded[2]).toBe(56);
    expect(decoded[3]).toBe(255);
  });

  it('preserves transparency: half-transparent input emits a #rrggbbaa palette entry', async () => {
    const png = await halfSplitPng(
      64,
      64,
      { r: 255, g: 100, b: 50, alpha: 1 },
      { r: 0, g: 0, b: 0, alpha: 0 },
    );
    const result = await generateSkinFromImage(png);
    const hasAlpha = result.palette.some((h) => h.length === 9);
    expect(hasAlpha).toBe(true);
    validateResponse(result);
  });
});

describe('generateSkinFromImage — error paths', () => {
  it('throws ImageProcessingError("resize_failed") on empty buffer', async () => {
    const empty = Buffer.alloc(0);
    await expect(generateSkinFromImage(empty)).rejects.toThrow(ImageProcessingError);
    await expect(generateSkinFromImage(empty)).rejects.toMatchObject({
      category: 'resize_failed',
    });
  });

  it('throws ImageProcessingError("resize_failed") on random bytes', async () => {
    const garbage = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    await expect(generateSkinFromImage(garbage)).rejects.toThrow(
      ImageProcessingError,
    );
  });

  it('throws when input is not a Buffer', async () => {
    await expect(
      generateSkinFromImage('not a buffer' as unknown as Buffer),
    ).rejects.toThrow(ImageProcessingError);
  });
});

describe('indicesToRleRows', () => {
  it('encodes a uniform-color buffer as 64 rows of [[idx, 64]]', () => {
    const indices = new Uint8ClampedArray(64 * 64).fill(3);
    const rows = indicesToRleRows(indices);
    expect(rows).toHaveLength(64);
    for (const row of rows) {
      expect(row).toEqual([[3, 64]]);
    }
  });

  it('produces run-length pairs that sum to 64 per row', () => {
    const indices = new Uint8ClampedArray(64 * 64);
    // Row r: alternate 0/1 every r+1 columns.
    for (let r = 0; r < 64; r++) {
      const stride = r + 1;
      for (let c = 0; c < 64; c++) {
        indices[r * 64 + c] = Math.floor(c / stride) % 2;
      }
    }
    const rows = indicesToRleRows(indices);
    for (const row of rows) {
      const sum = row.reduce((acc, [, run]) => acc + run, 0);
      expect(sum).toBe(64);
    }
  });

  it('emits a single pair per identical-run boundary', () => {
    // First 10 cols of row 0 are idx 5, the rest idx 7.
    const indices = new Uint8ClampedArray(64 * 64);
    for (let c = 0; c < 64; c++) {
      indices[c] = c < 10 ? 5 : 7;
    }
    const rows = indicesToRleRows(indices);
    expect(rows[0]).toEqual([
      [5, 10],
      [7, 54],
    ]);
  });

  it('throws ImageProcessingError on wrong-length input', () => {
    const indices = new Uint8ClampedArray(100);
    expect(() => indicesToRleRows(indices)).toThrow(ImageProcessingError);
  });
});
