// @vitest-environment node
//
// M16 Unit 1 — palette + RLE codec.

import { describe, expect, it } from 'vitest';

import { decode, SKIN_PIXEL_BYTE_LENGTH, validateResponse } from '../skin-codec';
import { CodecError } from '../types';

/** Build a 64-row RLE matrix where every row is a single solid run. */
function solidRows(idx: number): [number, number][][] {
  return Array.from({ length: 64 }, () => [[idx, 64]] as [number, number][]);
}

describe('validateResponse', () => {
  it('accepts a minimal valid response', () => {
    expect(() =>
      validateResponse({ palette: ['#000000'], rows: solidRows(0) }),
    ).not.toThrow();
  });

  it('rejects non-object root', () => {
    expect(() => validateResponse(null)).toThrow(CodecError);
    expect(() => validateResponse('hello')).toThrow(CodecError);
    // Bare array has no .palette so it bottoms out in the palette
    // shape_invalid branch — same `reason`, different message.
    try {
      validateResponse([]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CodecError);
      expect((e as CodecError).reason).toBe('shape_invalid');
    }
  });

  it('throws palette_empty on empty palette', () => {
    try {
      validateResponse({ palette: [], rows: solidRows(0) });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CodecError);
      expect((e as CodecError).reason).toBe('palette_empty');
    }
  });

  it('throws palette_too_large on >16 colors', () => {
    const palette = Array.from({ length: 17 }, () => '#000000');
    try {
      validateResponse({ palette, rows: solidRows(0) });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('palette_too_large');
    }
  });

  it('throws palette_hex_invalid on malformed hex', () => {
    try {
      validateResponse({ palette: ['#xyz'], rows: solidRows(0) });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('palette_hex_invalid');
    }
  });

  it('throws palette_hex_invalid on missing # prefix', () => {
    try {
      validateResponse({ palette: ['000000'], rows: solidRows(0) });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('palette_hex_invalid');
    }
  });

  it('throws palette_hex_invalid on 5-char hex', () => {
    try {
      validateResponse({ palette: ['#abcde'], rows: solidRows(0) });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('palette_hex_invalid');
    }
  });

  it('accepts case-mixed hex', () => {
    expect(() =>
      validateResponse({ palette: ['#AaBbCc'], rows: solidRows(0) }),
    ).not.toThrow();
  });

  it('accepts 8-char hex with alpha', () => {
    expect(() =>
      validateResponse({ palette: ['#aabbccdd'], rows: solidRows(0) }),
    ).not.toThrow();
  });

  it('throws row_count_invalid on 63 rows', () => {
    const rows = solidRows(0).slice(0, 63);
    try {
      validateResponse({ palette: ['#000000'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('row_count_invalid');
    }
  });

  it('throws row_count_invalid on 65 rows', () => {
    const rows: [number, number][][] = [...solidRows(0), [[0, 64]]];
    try {
      validateResponse({ palette: ['#000000'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('row_count_invalid');
    }
  });

  it('throws row_runs_invalid on under-sum (63)', () => {
    const rows = solidRows(0);
    rows[10] = [[0, 63]];
    try {
      validateResponse({ palette: ['#000000'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('row_runs_invalid');
    }
  });

  it('throws row_runs_invalid on over-sum (65)', () => {
    const rows = solidRows(0);
    rows[10] = [[0, 65]];
    try {
      validateResponse({ palette: ['#000000'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('row_runs_invalid');
    }
  });

  it('throws row_runs_invalid on zero-length run', () => {
    const rows = solidRows(0);
    rows[10] = [
      [0, 0],
      [0, 64],
    ];
    try {
      validateResponse({ palette: ['#000000'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('row_runs_invalid');
    }
  });

  it('throws row_runs_invalid on negative run', () => {
    const rows = solidRows(0);
    rows[10] = [
      [0, -1],
      [0, 65],
    ];
    try {
      validateResponse({ palette: ['#000000'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('row_runs_invalid');
    }
  });

  it('throws row_runs_invalid on non-integer run', () => {
    const rows = solidRows(0);
    rows[10] = [[0, 1.5]];
    try {
      validateResponse({ palette: ['#000000'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('row_runs_invalid');
    }
  });

  it('throws palette_index_oor on out-of-range palette index', () => {
    const rows = solidRows(0);
    rows[10] = [[5, 64]];
    try {
      validateResponse({ palette: ['#000000', '#111111', '#222222'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('palette_index_oor');
    }
  });

  it('throws palette_index_oor on negative palette index', () => {
    const rows = solidRows(0);
    rows[10] = [[-1, 64]];
    try {
      validateResponse({ palette: ['#000000'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('palette_index_oor');
    }
  });

  it('throws row_empty on empty row', () => {
    const rows = solidRows(0);
    rows[10] = [];
    try {
      validateResponse({ palette: ['#000000'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('row_empty');
    }
  });

  it('throws row_runs_invalid on malformed pair shape', () => {
    const rows = solidRows(0);
    rows[10] = [[0, 32, 99] as unknown as [number, number]];
    try {
      validateResponse({ palette: ['#000000'], rows });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CodecError).reason).toBe('row_runs_invalid');
    }
  });
});

describe('decode', () => {
  it('returns a 16384-byte buffer', () => {
    const out = decode({ palette: ['#000000'], rows: solidRows(0) });
    expect(out.byteLength).toBe(SKIN_PIXEL_BYTE_LENGTH);
    expect(out.byteLength).toBe(16384);
  });

  it('writes a solid color across the whole skin', () => {
    const out = decode({ palette: ['#aabbcc'], rows: solidRows(0) });
    // Sample 4 corners + center.
    for (const [x, y] of [
      [0, 0],
      [63, 0],
      [0, 63],
      [63, 63],
      [32, 32],
    ]) {
      const o = (y * 64 + x) * 4;
      expect(out[o]).toBe(0xaa);
      expect(out[o + 1]).toBe(0xbb);
      expect(out[o + 2]).toBe(0xcc);
      expect(out[o + 3]).toBe(0xff);
    }
  });

  it('decodes rgb hex without alpha to alpha=0xff', () => {
    const out = decode({ palette: ['#aabbcc'], rows: solidRows(0) });
    expect(out[3]).toBe(0xff);
  });

  it('decodes rgba hex (8 chars) preserving alpha', () => {
    const out = decode({ palette: ['#aabbcc80'], rows: solidRows(0) });
    expect(out[0]).toBe(0xaa);
    expect(out[1]).toBe(0xbb);
    expect(out[2]).toBe(0xcc);
    expect(out[3]).toBe(0x80);
  });

  it('decodes a multi-color row correctly', () => {
    // Row 0 = [red×16, green×16, blue×16, white×16]
    const palette = ['#ff0000', '#00ff00', '#0000ff', '#ffffff'];
    const rows: [number, number][][] = solidRows(0);
    rows[0] = [
      [0, 16],
      [1, 16],
      [2, 16],
      [3, 16],
    ];
    const out = decode({ palette, rows });
    // x=0..15 should be red.
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0x00);
    // x=16..31 should be green.
    expect(out[16 * 4]).toBe(0x00);
    expect(out[16 * 4 + 1]).toBe(0xff);
    // x=32..47 should be blue.
    expect(out[32 * 4]).toBe(0x00);
    expect(out[32 * 4 + 1]).toBe(0x00);
    expect(out[32 * 4 + 2]).toBe(0xff);
    // x=48..63 should be white.
    expect(out[48 * 4]).toBe(0xff);
    expect(out[48 * 4 + 3]).toBe(0xff);
  });

  it('handles palette of 16 colors', () => {
    const palette = Array.from({ length: 16 }, (_, i) =>
      `#${i.toString(16).padStart(2, '0')}0000`,
    );
    expect(() => decode({ palette, rows: solidRows(15) })).not.toThrow();
  });

  it('throws CodecError on invalid input (does not allocate output)', () => {
    // Per Unit 1 approach: validation runs BEFORE allocation, so a
    // crafted invalid response can't induce any partial-write state.
    try {
      decode({ palette: ['#xyz'], rows: solidRows(0) });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CodecError);
    }
  });
});
