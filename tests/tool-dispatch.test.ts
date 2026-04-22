// @vitest-environment node
//
// M5 Unit 6 — tool dispatcher.
// Unit-test against a mocked StrokeContext (layer + spy textureManager).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetStrokeRecorder,
  samplePickerAt,
  strokeContinue,
  strokeEnd,
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
    flushLayers: flushSpy,
    composite: vi.fn(),
    markDirty: vi.fn(),
  } as unknown as StrokeContext['textureManager'];
  const ctx: StrokeContext = {
    tool: 'pencil',
    layer,
    layers: [layer],
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
  it('paints opaque white at (x, y)', () => {
    const layer = makeLayer();
    // pre-paint so we can observe the erase
    layer.pixels[(10 * W + 10) * 4] = 255;
    layer.pixels[(10 * W + 10) * 4 + 3] = 255;
    const { ctx } = makeCtx({ tool: 'eraser', layer });
    const changed = strokeStart(ctx, 10, 10);
    expect(changed).toBe(true);
    expect(rgba(layer.pixels, 10, 10)).toEqual([255, 255, 255, 255]);
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
    expect(rgba(layer.pixels, x, y)).toEqual([255, 255, 255, 255]);
    expect(rgba(layer.pixels, m.x, m.y)).toEqual([255, 255, 255, 255]);
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

describe('dispatch.strokeEnd — recorder emits Stroke records (M6 Unit 4)', () => {
  beforeEach(() => resetStrokeRecorder());

  it('pencil drag: one Stroke with 1 patch covering start + end stamps', () => {
    const commitSpy = vi.fn();
    const { ctx } = makeCtx({
      tool: 'pencil',
      onStrokeCommit: commitSpy,
    });
    strokeStart(ctx, 10, 10);
    strokeContinue(ctx, 10, 10, 15, 10);
    const stroke = strokeEnd(ctx);
    expect(stroke).not.toBeNull();
    expect(stroke!.patches).toHaveLength(1);
    expect(stroke!.mirrored).toBe(false);
    expect(stroke!.tool).toBe('pencil');
    // Bbox covers both stamps (size=1): tight rect from (10,10) to (15,10).
    const { bbox } = stroke!.patches[0];
    expect(bbox.x).toBe(10);
    expect(bbox.y).toBe(10);
    expect(bbox.w).toBe(6); // 10..15 inclusive
    expect(bbox.h).toBe(1);
    expect(commitSpy).toHaveBeenCalledTimes(1);
  });

  it('pencil stroke after = stamped color, before = zeros', () => {
    const { ctx } = makeCtx({ tool: 'pencil', activeColorHex: '#ff8800' });
    strokeStart(ctx, 20, 20);
    const stroke = strokeEnd(ctx)!;
    const patch = stroke.patches[0];
    expect(patch.after.length).toBe(patch.bbox.w * patch.bbox.h * 4);
    expect(patch.before.length).toBe(patch.after.length);
    // after: single pixel painted with the active color
    expect(patch.after[0]).toBe(0xff);
    expect(patch.after[1]).toBe(0x88);
    expect(patch.after[2]).toBe(0x00);
    expect(patch.after[3]).toBe(255);
    // before: zeros
    expect(patch.before[0]).toBe(0);
    expect(patch.before[3]).toBe(0);
  });

  it('mirror pencil: one Stroke, 2 patches, mirrored=true', () => {
    const src = CLASSIC_UVS.rightArm.front;
    const { ctx } = makeCtx({
      tool: 'pencil',
      mirrorEnabled: true,
    });
    strokeStart(ctx, src.x + 1, src.y + 2);
    const stroke = strokeEnd(ctx)!;
    expect(stroke.patches).toHaveLength(2);
    expect(stroke.mirrored).toBe(true);
    const dst = mirrorAtlasPixel('classic', src.x + 1, src.y + 2)!;
    // Second patch covers the mirror stamp.
    const secondBbox = stroke.patches[1].bbox;
    expect(dst.x).toBeGreaterThanOrEqual(secondBbox.x);
    expect(dst.x).toBeLessThan(secondBbox.x + secondBbox.w);
  });

  it('bucket stroke: one patch covering the filled island', () => {
    const rect = CLASSIC_UVS.head.front;
    const { ctx } = makeCtx({ tool: 'bucket', activeColorHex: '#00ff00' });
    strokeStart(ctx, rect.x + 2, rect.y + 2);
    const stroke = strokeEnd(ctx)!;
    expect(stroke.patches).toHaveLength(1);
    expect(stroke.tool).toBe('bucket');
    // Bbox is tight around the head.front island.
    expect(stroke.patches[0].bbox.x).toBe(rect.x);
    expect(stroke.patches[0].bbox.y).toBe(rect.y);
    expect(stroke.patches[0].bbox.w).toBe(rect.w);
    expect(stroke.patches[0].bbox.h).toBe(rect.h);
  });

  it('bucket on empty seed: no Stroke emitted', () => {
    const commitSpy = vi.fn();
    const { ctx } = makeCtx({
      tool: 'bucket',
      onStrokeCommit: commitSpy,
    });
    const changed = strokeStart(ctx, 0, 0);
    expect(changed).toBe(false);
    const stroke = strokeEnd(ctx);
    expect(stroke).toBeNull();
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('onStrokeActive fires true on start and false on end', () => {
    const activeSpy = vi.fn();
    const { ctx } = makeCtx({
      tool: 'pencil',
      onStrokeActive: activeSpy,
    });
    strokeStart(ctx, 5, 5);
    expect(activeSpy).toHaveBeenLastCalledWith(true);
    strokeEnd(ctx);
    expect(activeSpy).toHaveBeenLastCalledWith(false);
    expect(activeSpy).toHaveBeenCalledTimes(2);
  });

  it('picker strokeStart does not open a recorder', () => {
    const commitSpy = vi.fn();
    const { ctx } = makeCtx({
      tool: 'picker' as ToolId,
      onStrokeCommit: commitSpy,
    });
    const changed = strokeStart(ctx, 5, 5);
    expect(changed).toBe(false);
    const stroke = strokeEnd(ctx);
    expect(stroke).toBeNull();
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('eraser horizontal drag: patch after is opaque white across the full bbox', () => {
    const { ctx, layer } = makeCtx({ tool: 'eraser' });
    // pre-paint a 1×6 horizontal red strip so erase-line covers every bbox pixel
    for (let dx = 0; dx < 6; dx++) {
      const i = (10 * W + (10 + dx)) * 4;
      layer.pixels[i] = 255;
      layer.pixels[i + 3] = 255;
    }
    strokeStart(ctx, 10, 10);
    strokeContinue(ctx, 10, 10, 15, 10);
    const stroke = strokeEnd(ctx)!;
    expect(stroke.tool).toBe('eraser');
    const patch = stroke.patches[0];
    expect(patch.bbox.h).toBe(1);
    // After: every pixel in the bbox is opaque white (255,255,255,255).
    for (let i = 0; i < patch.after.length; i += 4) {
      expect(patch.after[i]).toBe(255);
      expect(patch.after[i + 1]).toBe(255);
      expect(patch.after[i + 2]).toBe(255);
      expect(patch.after[i + 3]).toBe(255);
    }
    // Before-alpha was 255 (fully opaque red).
    for (let i = 3; i < patch.before.length; i += 4) {
      expect(patch.before[i]).toBe(255);
    }
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
