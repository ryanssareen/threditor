// @vitest-environment node
//
// M5 Unit 4 — bucket tool wrapper tests.
// Algorithm correctness is covered by tests/flood-fill.test.ts; these
// tests exercise the wrapper's seam gating, OOB handling, and bbox.

import { describe, expect, it } from 'vitest';

import { bucketFill } from '../lib/editor/tools/bucket';
import { getIslandMap } from '../lib/editor/island-map';
import { CLASSIC_UVS } from '../lib/three/geometry';

const W = 64;
const makePixels = (): Uint8ClampedArray => new Uint8ClampedArray(W * W * 4);

const pixelRGBA = (
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
): [number, number, number, number] => {
  const i = (y * W + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
};

describe('bucketFill', () => {
  const classic = getIslandMap('classic');

  it('fills a head-front seed across the whole head-front island', () => {
    const pixels = makePixels();
    const rect = CLASSIC_UVS.head.front;
    const seedX = rect.x + 2;
    const seedY = rect.y + 2;

    const res = bucketFill(pixels, classic, seedX, seedY, 200, 100, 50);
    expect(res.changed).toBe(true);

    // every pixel inside head.front is now (200,100,50,255)
    for (let dy = 0; dy < rect.h; dy++) {
      for (let dx = 0; dx < rect.w; dx++) {
        expect(pixelRGBA(pixels, rect.x + dx, rect.y + dy)).toEqual([200, 100, 50, 255]);
      }
    }
  });

  it('does not bleed across UV seams into adjacent head-right rect', () => {
    const pixels = makePixels();
    const frontRect = CLASSIC_UVS.head.front;
    const rightRect = CLASSIC_UVS.head.right;

    bucketFill(pixels, classic, frontRect.x + 2, frontRect.y + 2, 255, 0, 0);

    // head.right pixels should still be transparent (0,0,0,0).
    expect(pixelRGBA(pixels, rightRect.x + 1, rightRect.y + 1)).toEqual([0, 0, 0, 0]);
  });

  it('stops at a color boundary within the same island', () => {
    const pixels = makePixels();
    const rect = CLASSIC_UVS.head.front;
    // split head.front into two colors vertically down the middle: left half
    // painted red, right half painted green. Seed on the red half; fill with
    // blue; green half stays green.
    for (let dy = 0; dy < rect.h; dy++) {
      for (let dx = 0; dx < rect.w; dx++) {
        const i = ((rect.y + dy) * W + (rect.x + dx)) * 4;
        const isLeft = dx < rect.w / 2;
        pixels[i] = isLeft ? 255 : 0;
        pixels[i + 1] = isLeft ? 0 : 255;
        pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      }
    }

    bucketFill(pixels, classic, rect.x + 1, rect.y + 1, 0, 0, 255);

    // Left half now blue, right half still green.
    expect(pixelRGBA(pixels, rect.x + 1, rect.y + 1)).toEqual([0, 0, 255, 255]);
    expect(pixelRGBA(pixels, rect.x + rect.w - 1, rect.y + 1)).toEqual([0, 255, 0, 255]);
  });

  it('returns changed:false for seed outside any island', () => {
    const pixels = makePixels();
    const res = bucketFill(pixels, classic, 0, 0, 255, 0, 0);
    // (0,0) lives in classic head.top? Let's verify — CLASSIC_UVS.head.top
    // starts at (8, 0) so (0,0) is outside. If that ever changes the test
    // will need a different coord.
    expect(res.changed).toBe(false);
    // pixels at (0,0) still transparent.
    expect(pixelRGBA(pixels, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('writes the provided alpha', () => {
    const pixels = makePixels();
    const rect = CLASSIC_UVS.body.front;
    bucketFill(pixels, classic, rect.x + 1, rect.y + 1, 10, 20, 30, 128);
    expect(pixelRGBA(pixels, rect.x + 1, rect.y + 1)).toEqual([10, 20, 30, 128]);
  });

  it('OOB seed is a no-op', () => {
    const pixels = makePixels();
    const res = bucketFill(pixels, classic, -1, -1, 255, 0, 0);
    expect(res.changed).toBe(false);
    expect(pixelRGBA(pixels, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});
