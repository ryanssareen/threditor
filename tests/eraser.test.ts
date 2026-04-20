// @vitest-environment node
//
// M5 Unit 2 — eraser stamp + Bresenham eraseLine.

import { describe, expect, it } from 'vitest';

import { eraseLine, stampEraser } from '../lib/editor/tools/eraser';
import { stampPencil } from '../lib/editor/tools/pencil';

const WIDTH = 64;
const HEIGHT = 64;

const makePixels = (): Uint8ClampedArray => new Uint8ClampedArray(WIDTH * HEIGHT * 4);
const pixelOffset = (x: number, y: number): number => (y * WIDTH + x) * 4;

const isTransparent = (pixels: Uint8ClampedArray, x: number, y: number): boolean => {
  const o = pixelOffset(x, y);
  return pixels[o] === 0 && pixels[o + 1] === 0 && pixels[o + 2] === 0 && pixels[o + 3] === 0;
};

describe('stampEraser', () => {
  it('size=1 zeros a single pixel', () => {
    const pixels = makePixels();
    stampPencil(pixels, 10, 10, 1, 255, 128, 0, 200);
    stampEraser(pixels, 10, 10, 1);
    expect(isTransparent(pixels, 10, 10)).toBe(true);
  });

  it('size=2 zeros a 2x2 block at (cx-1, cy-1)', () => {
    const pixels = makePixels();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      stampPencil(pixels, x, y, 1, 255, 0, 0, 255);
    }
    stampEraser(pixels, 2, 2, 2);
    for (let y = 1; y <= 2; y++) for (let x = 1; x <= 2; x++) {
      expect(isTransparent(pixels, x, y)).toBe(true);
    }
    // outside: still painted red
    expect(isTransparent(pixels, 0, 0)).toBe(false);
    expect(isTransparent(pixels, 3, 3)).toBe(false);
  });

  it('size=3 zeros 3x3 centered', () => {
    const pixels = makePixels();
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      stampPencil(pixels, x, y, 1, 10, 20, 30, 255);
    }
    stampEraser(pixels, 2, 2, 3);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
      expect(isTransparent(pixels, x, y)).toBe(true);
    }
  });

  it('clips at atlas right/bottom edges (no OOB writes)', () => {
    const pixels = makePixels();
    stampPencil(pixels, 63, 63, 1, 255, 255, 255, 255);
    stampEraser(pixels, 63, 63, 4);
    expect(isTransparent(pixels, 63, 63)).toBe(true);
    // No throw + buffer length unchanged:
    expect(pixels.length).toBe(WIDTH * HEIGHT * 4);
  });

  it('OOB seed is a no-op', () => {
    const pixels = makePixels();
    stampPencil(pixels, 0, 0, 1, 1, 2, 3, 4);
    stampEraser(pixels, -5, -5, 1);
    const o = pixelOffset(0, 0);
    expect(pixels[o]).toBe(1);
    expect(pixels[o + 3]).toBe(4);
  });

  it('integration: pencil then eraser at same coord yields transparent', () => {
    const pixels = makePixels();
    stampPencil(pixels, 20, 20, 2, 255, 0, 0, 255);
    stampEraser(pixels, 20, 20, 2);
    for (let y = 19; y <= 20; y++) for (let x = 19; x <= 20; x++) {
      expect(isTransparent(pixels, x, y)).toBe(true);
    }
  });

  it('writes outBbox when provided', () => {
    const pixels = makePixels();
    const bbox = { x: -1, y: -1, w: -1, h: -1 };
    stampEraser(pixels, 10, 10, 2, bbox);
    expect(bbox).toEqual({ x: 9, y: 9, w: 2, h: 2 });
  });
});

describe('eraseLine', () => {
  it('(0,0) to (4,4) with size 1 zeros 5 pixels on the diagonal', () => {
    const pixels = makePixels();
    for (let i = 0; i < 5; i++) stampPencil(pixels, i, i, 1, 200, 100, 50, 255);
    eraseLine(pixels, 0, 0, 4, 4, 1);
    for (let i = 0; i < 5; i++) {
      expect(isTransparent(pixels, i, i)).toBe(true);
    }
  });

  it('writes union bbox for a horizontal line', () => {
    const pixels = makePixels();
    const bbox = { x: -1, y: -1, w: -1, h: -1 };
    eraseLine(pixels, 5, 10, 10, 10, 1, bbox);
    expect(bbox.x).toBe(5);
    expect(bbox.y).toBe(10);
    expect(bbox.w).toBe(6); // 5..10 inclusive
    expect(bbox.h).toBe(1);
  });
});
