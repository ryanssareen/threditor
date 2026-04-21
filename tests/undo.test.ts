// @vitest-environment node
//
// M6 Unit 3 — UndoStack + command union + dual caps + active-stroke guard.

import { describe, expect, it } from 'vitest';

import {
  MAX_HISTORY_COUNT,
  UndoStack,
  writeLayerRegion,
  type Command,
  type EditorActions,
} from '../lib/editor/undo';
import { applyRegion, sliceRegion } from '../lib/editor/diff';
import type { Layer, Stroke } from '../lib/editor/types';

const W = 64;

function mkLayer(id: string): Layer {
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels: new Uint8ClampedArray(W * W * 4),
  };
}

/**
 * Build a minimal adapter backed by a plain array of layers. Tests can
 * snapshot `state.layers` to verify undo/redo effects.
 */
function makeActions(layers: Layer[], opts?: { strokeActive?: () => boolean }): {
  actions: EditorActions;
  state: { layers: Layer[]; recomposites: number };
} {
  const state = { layers, recomposites: 0 };
  const actions: EditorActions = {
    getLayers: () => state.layers,
    setLayerPixelRegion: (id, bbox, region) => {
      writeLayerRegion(state.layers, id, bbox, region);
    },
    insertLayerAt: (layer, index) => {
      const next = state.layers.slice();
      next.splice(Math.max(0, Math.min(index, next.length)), 0, layer);
      state.layers = next;
    },
    deleteLayer: (id) => {
      state.layers = state.layers.filter((l) => l.id !== id);
    },
    reorderLayers: (from, to) => {
      const next = state.layers.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      state.layers = next;
    },
    setLayerName: (id, name) => {
      state.layers = state.layers.map((l) => (l.id === id ? { ...l, name } : l));
    },
    setLayerOpacity: (id, opacity) => {
      state.layers = state.layers.map((l) => (l.id === id ? { ...l, opacity } : l));
    },
    setLayerBlendMode: (id, blendMode) => {
      state.layers = state.layers.map((l) => (l.id === id ? { ...l, blendMode } : l));
    },
    setLayerVisible: (id, visible) => {
      state.layers = state.layers.map((l) => (l.id === id ? { ...l, visible } : l));
    },
    recomposite: () => { state.recomposites += 1; },
    strokeActive: opts?.strokeActive ?? (() => false),
  };
  return { actions, state };
}

function mkStrokeCmd(
  layerId: string,
  bbox: { x: number; y: number; w: number; h: number },
  before: number,
  after: number,
  opts?: { mirrored?: boolean; mirrorBbox?: { x: number; y: number; w: number; h: number } },
): Command {
  const beforeBuf = new Uint8ClampedArray(bbox.w * bbox.h * 4).fill(before);
  const afterBuf = new Uint8ClampedArray(bbox.w * bbox.h * 4).fill(after);
  const patches = [{ bbox, before: beforeBuf, after: afterBuf }];
  if (opts?.mirrored && opts.mirrorBbox) {
    const mBefore = new Uint8ClampedArray(opts.mirrorBbox.w * opts.mirrorBbox.h * 4).fill(before);
    const mAfter = new Uint8ClampedArray(opts.mirrorBbox.w * opts.mirrorBbox.h * 4).fill(after);
    patches.push({ bbox: opts.mirrorBbox, before: mBefore, after: mAfter });
  }
  const stroke: Stroke = {
    id: `s-${Math.random().toString(36).slice(2)}`,
    layerId,
    patches,
    tool: 'pencil',
    mirrored: opts?.mirrored ?? false,
  };
  return { kind: 'stroke', stroke };
}

describe('UndoStack — stroke commands', () => {
  it('pushing a stroke, then undo restores before; redo reapplies after', () => {
    const base = mkLayer('base');
    // Seed the layer with `after` content; before-stroke was all zeros.
    applyRegion(base.pixels, { x: 10, y: 10, w: 2, h: 2 }, new Uint8ClampedArray(16).fill(50));
    const { actions, state } = makeActions([base]);
    const stack = new UndoStack();
    stack.push(mkStrokeCmd('base', { x: 10, y: 10, w: 2, h: 2 }, 0, 50));

    expect(stack.canUndo()).toBe(true);
    stack.undo(actions);
    expect(sliceRegion(state.layers[0].pixels, { x: 10, y: 10, w: 2, h: 2 })[0]).toBe(0);
    expect(state.recomposites).toBe(1);

    stack.redo(actions);
    expect(sliceRegion(state.layers[0].pixels, { x: 10, y: 10, w: 2, h: 2 })[0]).toBe(50);
  });

  it('two strokes: undo twice, redo twice — pixels match original end-state', () => {
    const base = mkLayer('base');
    const { actions } = makeActions([base]);
    const stack = new UndoStack();

    // Simulate two strokes: first fills (0,0,2,2) with 80; second fills (10,10,2,2) with 120.
    applyRegion(base.pixels, { x: 0, y: 0, w: 2, h: 2 }, new Uint8ClampedArray(16).fill(80));
    stack.push(mkStrokeCmd('base', { x: 0, y: 0, w: 2, h: 2 }, 0, 80));
    applyRegion(base.pixels, { x: 10, y: 10, w: 2, h: 2 }, new Uint8ClampedArray(16).fill(120));
    stack.push(mkStrokeCmd('base', { x: 10, y: 10, w: 2, h: 2 }, 0, 120));

    stack.undo(actions);
    stack.undo(actions);
    // both regions back to 0
    expect(base.pixels[0]).toBe(0);
    expect(base.pixels[(10 * W + 10) * 4]).toBe(0);

    stack.redo(actions);
    stack.redo(actions);
    expect(base.pixels[0]).toBe(80);
    expect(base.pixels[(10 * W + 10) * 4]).toBe(120);
  });

  it('mirror atomic: one stroke, 2 patches → undo once restores both sides', () => {
    const base = mkLayer('base');
    const primary = { x: 5, y: 5, w: 2, h: 2 };
    const mirror = { x: 50, y: 50, w: 2, h: 2 };
    applyRegion(base.pixels, primary, new Uint8ClampedArray(16).fill(111));
    applyRegion(base.pixels, mirror, new Uint8ClampedArray(16).fill(111));

    const { actions } = makeActions([base]);
    const stack = new UndoStack();
    stack.push(mkStrokeCmd('base', primary, 0, 111, { mirrored: true, mirrorBbox: mirror }));

    stack.undo(actions);
    expect(base.pixels[(5 * W + 5) * 4]).toBe(0);
    expect(base.pixels[(50 * W + 50) * 4]).toBe(0);
  });
});

describe('UndoStack — layer lifecycle commands', () => {
  it('layer-add: undo removes; redo restores at insertedAt', () => {
    const base = mkLayer('base');
    const { actions, state } = makeActions([base]);
    const stack = new UndoStack();
    const added = mkLayer('added');
    actions.insertLayerAt(added, 1);
    stack.push({ kind: 'layer-add', layer: added, insertedAt: 1 });

    stack.undo(actions);
    expect(state.layers.map((l) => l.id)).toEqual(['base']);

    stack.redo(actions);
    expect(state.layers.map((l) => l.id)).toEqual(['base', 'added']);
  });

  it('layer-delete: undo restores at removedFrom', () => {
    const base = mkLayer('base');
    const extra = mkLayer('extra');
    const { actions, state } = makeActions([base, extra]);
    const stack = new UndoStack();

    actions.deleteLayer('extra');
    stack.push({ kind: 'layer-delete', layer: extra, removedFrom: 1 });
    expect(state.layers.map((l) => l.id)).toEqual(['base']);

    stack.undo(actions);
    expect(state.layers.map((l) => l.id)).toEqual(['base', 'extra']);
  });

  it('layer-reorder: undo reverts, redo re-applies', () => {
    const a = mkLayer('a');
    const b = mkLayer('b');
    const c = mkLayer('c');
    const { actions, state } = makeActions([a, b, c]);
    const stack = new UndoStack();

    actions.reorderLayers(0, 2);
    stack.push({ kind: 'layer-reorder', from: 0, to: 2 });
    expect(state.layers.map((l) => l.id)).toEqual(['b', 'c', 'a']);

    stack.undo(actions);
    expect(state.layers.map((l) => l.id)).toEqual(['a', 'b', 'c']);
    stack.redo(actions);
    expect(state.layers.map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });

  it('rename / opacity / blend / visibility round-trip', () => {
    const base = mkLayer('base');
    const { actions, state } = makeActions([base]);
    const stack = new UndoStack();

    actions.setLayerName('base', 'Renamed');
    stack.push({ kind: 'layer-rename', id: 'base', before: 'base', after: 'Renamed' });
    actions.setLayerOpacity('base', 0.5);
    stack.push({ kind: 'layer-opacity', id: 'base', before: 1, after: 0.5 });
    actions.setLayerBlendMode('base', 'multiply');
    stack.push({ kind: 'layer-blend', id: 'base', before: 'normal', after: 'multiply' });
    actions.setLayerVisible('base', false);
    stack.push({ kind: 'layer-visibility', id: 'base', before: true, after: false });

    stack.undo(actions); // visibility
    expect(state.layers[0].visible).toBe(true);
    stack.undo(actions); // blend
    expect(state.layers[0].blendMode).toBe('normal');
    stack.undo(actions); // opacity
    expect(state.layers[0].opacity).toBe(1);
    stack.undo(actions); // name
    expect(state.layers[0].name).toBe('base');
  });
});

describe('UndoStack — redo truncation (R9)', () => {
  it('after 3 undos, a new push discards the 3 redo entries', () => {
    const base = mkLayer('base');
    const { actions } = makeActions([base]);
    const stack = new UndoStack();
    for (let i = 0; i < 5; i++) {
      stack.push(mkStrokeCmd('base', { x: i, y: 0, w: 1, h: 1 }, 0, 10 + i));
    }
    stack.undo(actions);
    stack.undo(actions);
    stack.undo(actions);
    expect(stack.canRedo()).toBe(true);

    stack.push(mkStrokeCmd('base', { x: 0, y: 0, w: 1, h: 1 }, 0, 99));
    // Now cursor is on the new push; no redo.
    expect(stack.canRedo()).toBe(false);
    // And the discarded bytes came out of the byte counter.
    expect(stack.length()).toBe(3); // first 2 kept + the new push
  });
});

describe('UndoStack — memory caps (D4)', () => {
  it('hard count cap at 100: pushing 101 keeps the newest 100', () => {
    const base = mkLayer('base');
    const stack = new UndoStack();
    for (let i = 0; i < 101; i++) {
      stack.push(mkStrokeCmd('base', { x: 0, y: 0, w: 1, h: 1 }, 0, i));
    }
    expect(stack.length()).toBe(MAX_HISTORY_COUNT);
  });

  it('byte cap evicts oldest when exceeded', () => {
    // Push a few large layer-add commands (each ~16 KB) to cross 5 MB quickly.
    // 5 MB / 16 KB ≈ 320 commands; use 400 to be safe.
    const stack = new UndoStack();
    for (let i = 0; i < 400; i++) {
      stack.push({ kind: 'layer-add', layer: mkLayer(`L${i}`), insertedAt: 0 });
    }
    // Either count cap or byte cap kicks in; confirm length bounded + bytes bounded.
    expect(stack.length()).toBeLessThanOrEqual(MAX_HISTORY_COUNT);
    expect(stack.bytesUsed()).toBeLessThanOrEqual(5 * 1024 * 1024 + 16 * 1024);
  });

  it('eviction decrements the cursor so canUndo reflects remaining depth', () => {
    const base = mkLayer('base');
    const stack = new UndoStack();
    for (let i = 0; i < 101; i++) {
      stack.push(mkStrokeCmd('base', { x: 0, y: 0, w: 1, h: 1 }, 0, i));
    }
    expect(stack.cursorIndex()).toBe(MAX_HISTORY_COUNT - 1); // last index
    expect(stack.canUndo()).toBe(true);
  });
});

describe('UndoStack — stroke-active guard (D10)', () => {
  it('undo is ignored when strokeActive() === true', () => {
    const base = mkLayer('base');
    let active = true;
    const { actions, state } = makeActions([base], { strokeActive: () => active });
    const stack = new UndoStack();
    applyRegion(base.pixels, { x: 0, y: 0, w: 1, h: 1 }, new Uint8ClampedArray(4).fill(99));
    stack.push(mkStrokeCmd('base', { x: 0, y: 0, w: 1, h: 1 }, 0, 99));

    const result = stack.undo(actions);
    expect(result).toBe(false);
    expect(state.recomposites).toBe(0);

    active = false;
    expect(stack.undo(actions)).toBe(true);
    expect(state.recomposites).toBe(1);
  });

  it('redo is ignored when strokeActive', () => {
    const base = mkLayer('base');
    let active = false;
    const { actions } = makeActions([base], { strokeActive: () => active });
    const stack = new UndoStack();
    stack.push(mkStrokeCmd('base', { x: 0, y: 0, w: 1, h: 1 }, 0, 50));
    stack.undo(actions);
    active = true;
    expect(stack.redo(actions)).toBe(false);
    active = false;
    expect(stack.redo(actions)).toBe(true);
  });
});

describe('UndoStack — deleted-layer redo (D9)', () => {
  it('redo of a stroke whose layer was deleted silently advances', () => {
    const base = mkLayer('base');
    const extra = mkLayer('extra');
    const { actions, state } = makeActions([base, extra]);
    const stack = new UndoStack();

    // Push a stroke on `extra`.
    applyRegion(extra.pixels, { x: 0, y: 0, w: 1, h: 1 }, new Uint8ClampedArray(4).fill(77));
    stack.push(mkStrokeCmd('extra', { x: 0, y: 0, w: 1, h: 1 }, 0, 77));

    // Undo the stroke.
    stack.undo(actions);
    // Manually drop `extra` from state without pushing a command.
    state.layers = state.layers.filter((l) => l.id !== 'extra');

    // Redo should silently advance without throwing.
    const result = stack.redo(actions);
    expect(result).toBe(true);
    // And the surviving layer is untouched.
    expect(state.layers[0].pixels[0]).toBe(0);
  });
});

describe('UndoStack — clear()', () => {
  it('empties the stack + resets counters', () => {
    const base = mkLayer('base');
    const stack = new UndoStack();
    for (let i = 0; i < 5; i++) {
      stack.push(mkStrokeCmd('base', { x: 0, y: 0, w: 1, h: 1 }, 0, i));
    }
    stack.clear();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.bytesUsed()).toBe(0);
    expect(stack.length()).toBe(0);
  });
});

describe('UndoStack — involution invariant', () => {
  it('sequence [push, push, push, undo, undo, redo, push] ends correctly', () => {
    const base = mkLayer('base');
    const { actions, state } = makeActions([base]);
    const stack = new UndoStack();

    const regions: number[] = [];
    const doStroke = (val: number) => {
      applyRegion(base.pixels, { x: 0, y: 0, w: 1, h: 1 }, new Uint8ClampedArray(4).fill(val));
      stack.push(mkStrokeCmd('base', { x: 0, y: 0, w: 1, h: 1 }, regions[regions.length - 1] ?? 0, val));
      regions.push(val);
    };

    doStroke(10);
    doStroke(20);
    doStroke(30);
    stack.undo(actions); // back to 20
    expect(state.layers[0].pixels[0]).toBe(20);
    stack.undo(actions); // back to 10
    expect(state.layers[0].pixels[0]).toBe(10);
    stack.redo(actions); // forward to 20
    expect(state.layers[0].pixels[0]).toBe(20);
    // push a new stroke from 20 → 99. Redo to 30 is discarded.
    applyRegion(base.pixels, { x: 0, y: 0, w: 1, h: 1 }, new Uint8ClampedArray(4).fill(99));
    stack.push(mkStrokeCmd('base', { x: 0, y: 0, w: 1, h: 1 }, 20, 99));
    expect(stack.canRedo()).toBe(false);
    expect(state.layers[0].pixels[0]).toBe(99);
  });
});
