// @vitest-environment node
//
// M5 Unit 6 — tool dispatcher.
// Unit-test against a mocked StrokeContext (layer + spy textureManager).

import { describe, expect, it, vi } from 'vitest';

import {
  samplePickerAt,
  strokeContinue,
  strokeStart,
  type StrokeContext,
} from '../lib/editor/tools/dispatch';
import { CLASSIC_UVS } from '../lib/three/geometry';
import { mirrorAtlasPixel } from '../lib/editor/tools/mirror';
import type { Layer } from '../lib/editor/types';
import type { BrushSize, ToolId } from '../lib/editor/store';

const W = 64;
const makePixels = (): Uint8ClampedArray => new Uint8ClampedArray(W * W * 4);

function makeLayer(): Layer {
  return {
    id: 'base',
    name: 'base',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels: makePixels(),
  };
}

function makeCtx(overrides: Partial<StrokeContext> = {}): {
  ctx: StrokeContext;
  flushSpy: ReturnType<typeof vi.fn>;
  layer: Layer;
} {
  const layer = overrides.layer ?? makeLayer();
  const flushSpy = vi.fn();
  const textureManager = {
    flushLayer: flushSpy,
  } as unknown as StrokeContext['textureManager'];
  const ctx: StrokeContext = {
    tool: 'pencil',
    layer,
    variant: 'classic',
    textureManager,
    activeColorHex: '#ff0000',
    brushSize: 1 as BrushSize,
    mirrorEnabled: false,
    ...overrides,
  };
  return { ctx, flushSpy, layer };
}

const rgba = (pixels: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * W + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
};

describe('dispatch.strokeStart — pencil', () => {
  it('writes the active color at (x, y) and flushes', () => {
    const { ctx, flushSpy, layer } = makeCtx({ tool: 'pencil' });
    const changed = strokeStart(ctx, 10, 10);
    expect(changed).toBe(true);
    expect(rgba(layer.pixels, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('mirrors pencil stamp when mirrorEnabled', () => {
    const src = CLASSIC_UVS.rightArm.front;
    const { ctx, layer } = makeCtx({
      tool: 'pencil',
      mirrorEnabled: true,
      activeColorHex: '#00ff00',
    });
    const x = src.x + 1;
    const y = src.y + 2;
    strokeStart(ctx, x, y);
    const m = mirrorAtlasPixel('classic', x, y)!;
    expect(rgba(layer.pixels, x, y)).toEqual([0, 255, 0, 255]);
    expect(rgba(layer.pixels, m.x, m.y)).toEqual([0, 255, 0, 255]);
  });

  it('mirror on non-body pixel: primary still paints, mirror skipped', () => {
    const { ctx, layer, flushSpy } = makeCtx({
      tool: 'pencil',
      mirrorEnabled: true,
    });
    // (0, 0) is outside any classic part rect.
    const changed = strokeStart(ctx, 0, 0);
    expect(changed).toBe(true);
    expect(rgba(layer.pixels, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });
});

describe('dispatch.strokeStart — eraser', () => {
  it('zeros the pixel at (x, y)', () => {
    const layer = makeLayer();
    // pre-paint so we can observe the erase
    layer.pixels[(10 * W + 10) * 4] = 255;
    layer.pixels[(10 * W + 10) * 4 + 3] = 255;
    const { ctx } = makeCtx({ tool: 'eraser', layer });
    const changed = strokeStart(ctx, 10, 10);
    expect(changed).toBe(true);
    expect(rgba(layer.pixels, 10, 10)).toEqual([0, 0, 0, 0]);
  });

  it('mirrors eraser when mirrorEnabled', () => {
    const src = CLASSIC_UVS.leftLeg.front;
    const layer = makeLayer();
    const x = src.x;
    const y = src.y;
    // paint both so erase is observable
    layer.pixels[(y * W + x) * 4 + 3] = 255;
    const m = mirrorAtlasPixel('classic', x, y)!;
    layer.pixels[(m.y * W + m.x) * 4 + 3] = 255;
    const { ctx } = makeCtx({ tool: 'eraser', mirrorEnabled: true, layer });
    strokeStart(ctx, x, y);
    expect(rgba(layer.pixels, x, y)).toEqual([0, 0, 0, 0]);
    expect(rgba(layer.pixels, m.x, m.y)).toEqual([0, 0, 0, 0]);
  });
});

describe('dispatch.strokeStart — bucket', () => {
  it('fills the clicked island in activeColor', () => {
    const rect = CLASSIC_UVS.head.front;
    const { ctx, layer } = makeCtx({
      tool: 'bucket',
      activeColorHex: '#0000ff',
    });
    const changed = strokeStart(ctx, rect.x + 2, rect.y + 2);
    expect(changed).toBe(true);
    expect(rgba(layer.pixels, rect.x, rect.y)).toEqual([0, 0, 255, 255]);
  });

  it('returns false for seed outside every island; no flush', () => {
    const { ctx, flushSpy } = makeCtx({ tool: 'bucket' });
    const changed = strokeStart(ctx, 0, 0);
    expect(changed).toBe(false);
    expect(flushSpy).not.toHaveBeenCalled();
  });

  it('mirror bucket: fills both the seed island and the mirror island', () => {
    const src = CLASSIC_UVS.rightArm.front;
    const dst = CLASSIC_UVS.leftArm.front;
    const { ctx, layer } = makeCtx({
      tool: 'bucket',
      mirrorEnabled: true,
      activeColorHex: '#800080',
    });
    strokeStart(ctx, src.x + 1, src.y + 1);
    // both islands filled (sample a cell from each)
    expect(rgba(layer.pixels, src.x, src.y)).toEqual([0x80, 0x00, 0x80, 255]);
    expect(rgba(layer.pixels, dst.x, dst.y)).toEqual([0x80, 0x00, 0x80, 255]);
  });
});

describe('dispatch.strokeStart — picker is never dispatched', () => {
  it('picker tool returns false and does not flush', () => {
    const { ctx, flushSpy } = makeCtx({ tool: 'picker' as ToolId });
    expect(strokeStart(ctx, 5, 5)).toBe(false);
    expect(flushSpy).not.toHaveBeenCalled();
  });
});

describe('dispatch.strokeContinue', () => {
  it('pencil draws a Bresenham line with mirror when enabled', () => {
    const src = CLASSIC_UVS.head.front;
    const { ctx, layer } = makeCtx({ tool: 'pencil', mirrorEnabled: true });
    strokeContinue(ctx, src.x + 0, src.y + 0, src.x + 2, src.y + 0);
    // primary row painted
    expect(rgba(layer.pixels, src.x + 0, src.y)[3]).toBe(255);
    expect(rgba(layer.pixels, src.x + 2, src.y)[3]).toBe(255);
    // mirror row painted (head.front self-mirrors within its own rect)
    const mx0 = src.x + (src.w - 1 - 0);
    const mx2 = src.x + (src.w - 1 - 2);
    expect(rgba(layer.pixels, mx0, src.y)[3]).toBe(255);
    expect(rgba(layer.pixels, mx2, src.y)[3]).toBe(255);
  });

  it('bucket strokeContinue is a no-op', () => {
    const { ctx, flushSpy } = makeCtx({ tool: 'bucket' });
    strokeContinue(ctx, 0, 0, 10, 10);
    expect(flushSpy).not.toHaveBeenCalled();
  });
});

describe('dispatch.samplePickerAt', () => {
  it('returns hex+alpha for a painted pixel', () => {
    const layer = makeLayer();
    layer.pixels[(5 * W + 5) * 4] = 255;
    layer.pixels[(5 * W + 5) * 4 + 3] = 255;
    expect(samplePickerAt(layer, 5, 5)).toEqual({ hex: '#ff0000', alpha: 255 });
  });

  it('returns null for OOB', () => {
    const layer = makeLayer();
    expect(samplePickerAt(layer, -1, 0)).toBeNull();
  });
});
