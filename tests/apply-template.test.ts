/**
 * M7 Unit 4: apply-template orchestrator + undo integration tests.
 *
 * Covers:
 *   - Happy path state swap.
 *   - Undo/redo round-trip.
 *   - Defensive guards: strokeActive, hydrationPending, bad pixel length.
 *   - Timer cancellation in three places (clarification #1):
 *       (a) New applyTemplate cancels prior in-flight timers.
 *       (b) undo/redo via EditorActions.applyTemplateSnapshot cancels.
 *       (c) cancelActiveTransition() as an exported teardown.
 *   - Byte accounting for apply-template commands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyTemplate,
  cancelActiveTransition,
  type ApplyTemplateActions,
  type ApplyTemplateCommand,
} from '../lib/editor/apply-template';
import { UndoStack, type EditorActions } from '../lib/editor/undo';
import { TIMING } from '../lib/editor/templates';
import type {
  ApplyTemplateSnapshot,
  Layer,
  TemplateMeta,
} from '../lib/editor/types';

// ── Fixtures ────────────────────────────────────────────────────────

function mkLayer(id: string, fill: number): Layer {
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels: new Uint8ClampedArray(64 * 64 * 4).fill(fill),
  };
}

function mkTemplate(overrides: Partial<TemplateMeta> = {}): TemplateMeta {
  return {
    id: 'test-template',
    label: 'Test Template',
    variant: 'classic',
    file: '/templates/classic/test.png',
    thumbnail: '/templates/thumbs/test.png',
    license: 'MIT',
    credit: null,
    tags: ['test'],
    contextualHint: 'Try something new',
    affordancePulse: 'color',
    ...overrides,
  };
}

type TestState = {
  layers: Layer[];
  activeLayerId: string;
  variant: 'classic' | 'slim';
  hasEditedSinceTemplate: boolean;
  lastAppliedTemplateId: string | null;
  contextualHint: string | null;
  pulseTarget: 'color' | 'mirror' | 'brush' | null;
  strokeActive: boolean;
  hydrationPending: boolean;
  recomposites: number;
  /** Timestamps of timer firings, for ordering tests. */
  hintSetAt: number | null;
  pulseSetAt: number | null;
  hintClearedAt: number | null;
  pulseClearedAt: number | null;
};

function makeTestHarness(initial: Partial<TestState> = {}) {
  const state: TestState = {
    layers: [mkLayer('base', 30)],
    activeLayerId: 'base',
    variant: 'classic',
    hasEditedSinceTemplate: false,
    lastAppliedTemplateId: null,
    contextualHint: null,
    pulseTarget: null,
    strokeActive: false,
    hydrationPending: false,
    recomposites: 0,
    hintSetAt: null,
    pulseSetAt: null,
    hintClearedAt: null,
    pulseClearedAt: null,
    ...initial,
  };

  const applyActions: ApplyTemplateActions = {
    getLayers: () => state.layers,
    getActiveLayerId: () => state.activeLayerId,
    getVariant: () => state.variant,
    getHasEditedSinceTemplate: () => state.hasEditedSinceTemplate,
    getLastAppliedTemplateId: () => state.lastAppliedTemplateId,
    strokeActive: () => state.strokeActive,
    hydrationPending: () => state.hydrationPending,
    applyTemplateSnapshot: (snap) => {
      state.layers = snap.layers;
      state.activeLayerId = snap.activeLayerId;
      state.variant = snap.variant;
      state.hasEditedSinceTemplate = snap.hasEditedSinceTemplate;
      state.lastAppliedTemplateId = snap.lastAppliedTemplateId;
    },
    recomposite: () => {
      state.recomposites += 1;
    },
    setActiveContextualHint: (hint) => {
      state.contextualHint = hint;
      state.hintSetAt = Date.now();
    },
    setPulseTarget: (target) => {
      if (target !== null) {
        state.pulseTarget = target;
        state.pulseSetAt = Date.now();
      } else {
        state.pulseTarget = null;
        state.pulseClearedAt = Date.now();
      }
    },
    clearContextualHint: () => {
      state.contextualHint = null;
      state.hintClearedAt = Date.now();
    },
  };

  return { state, applyActions };
}

function makeTemplatePixels(fill = 200): Uint8ClampedArray {
  return new Uint8ClampedArray(64 * 64 * 4).fill(fill);
}

// ── Tests ───────────────────────────────────────────────────────────

describe('applyTemplate — happy path', () => {
  beforeEach(() => {
    cancelActiveTransition();
  });
  afterEach(() => {
    cancelActiveTransition();
    vi.useRealTimers();
  });

  it('swaps state: layers, activeLayerId, variant, hasEditedSinceTemplate=false, lastAppliedTemplateId', () => {
    const { state, applyActions } = makeTestHarness({
      hasEditedSinceTemplate: true,
    });
    const cmds: ApplyTemplateCommand[] = [];
    const template = mkTemplate({ id: 'classic-hoodie', variant: 'slim' });

    const result = applyTemplate(
      applyActions,
      (cmd) => cmds.push(cmd),
      template,
      makeTemplatePixels(199),
      { skipTimeline: true },
    );

    expect(result).toEqual({
      ok: true,
      newActiveLayerId: 'template:classic-hoodie',
    });
    expect(state.layers).toHaveLength(1);
    expect(state.layers[0].id).toBe('template:classic-hoodie');
    expect(state.layers[0].pixels[0]).toBe(199);
    expect(state.variant).toBe('slim');
    expect(state.hasEditedSinceTemplate).toBe(false);
    expect(state.lastAppliedTemplateId).toBe('classic-hoodie');
    expect(state.recomposites).toBe(1);
    expect(cmds).toHaveLength(1);
  });

  it('command carries deep-cloned before.layers (pixel buffer is .slice()d)', () => {
    const { state, applyActions } = makeTestHarness();
    const originalRef = state.layers[0].pixels;
    const cmds: ApplyTemplateCommand[] = [];

    applyTemplate(
      applyActions,
      (cmd) => cmds.push(cmd),
      mkTemplate(),
      makeTemplatePixels(),
      { skipTimeline: true },
    );

    expect(cmds).toHaveLength(1);
    expect(cmds[0].before.layers[0].pixels).not.toBe(originalRef);
    expect(cmds[0].before.layers[0].pixels[0]).toBe(30);
  });
});

describe('applyTemplate — defensive guards', () => {
  beforeEach(() => {
    cancelActiveTransition();
  });

  it('rejects when strokeActive is true (D10)', () => {
    const { state, applyActions } = makeTestHarness({ strokeActive: true });
    const cmds: ApplyTemplateCommand[] = [];

    const result = applyTemplate(
      applyActions,
      (cmd) => cmds.push(cmd),
      mkTemplate(),
      makeTemplatePixels(),
      { skipTimeline: true },
    );

    expect(result).toEqual({ ok: false, reason: 'stroke-active' });
    expect(cmds).toHaveLength(0);
    expect(state.layers[0].id).toBe('base');
  });

  it('rejects when hydrationPending is true (clarification #2)', () => {
    const { state, applyActions } = makeTestHarness({ hydrationPending: true });
    const cmds: ApplyTemplateCommand[] = [];

    const result = applyTemplate(
      applyActions,
      (cmd) => cmds.push(cmd),
      mkTemplate(),
      makeTemplatePixels(),
      { skipTimeline: true },
    );

    expect(result).toEqual({ ok: false, reason: 'hydration-pending' });
    expect(cmds).toHaveLength(0);
    expect(state.layers[0].id).toBe('base');
  });

  it('rejects when pixels.length is wrong', () => {
    const { applyActions } = makeTestHarness();
    const cmds: ApplyTemplateCommand[] = [];

    const result = applyTemplate(
      applyActions,
      (cmd) => cmds.push(cmd),
      mkTemplate(),
      new Uint8ClampedArray(100),
      { skipTimeline: true },
    );

    expect(result).toEqual({ ok: false, reason: 'pixel-length-mismatch' });
    expect(cmds).toHaveLength(0);
  });
});

describe('applyTemplate — undo/redo round-trip via UndoStack', () => {
  let stack: UndoStack;
  let undoActions: EditorActions;
  let state: TestState;
  let applyActions: ApplyTemplateActions;

  beforeEach(() => {
    cancelActiveTransition();
    const h = makeTestHarness();
    state = h.state;
    applyActions = h.applyActions;
    stack = new UndoStack();

    undoActions = {
      getLayers: () => state.layers,
      setLayerPixelRegion: () => {},
      insertLayerAt: () => {},
      deleteLayer: () => {},
      reorderLayers: () => {},
      setLayerName: () => {},
      setLayerOpacity: () => {},
      setLayerBlendMode: () => {},
      setLayerVisible: () => {},
      recomposite: () => {
        state.recomposites += 1;
      },
      strokeActive: () => state.strokeActive,
      applyTemplateSnapshot: (snap) => {
        // (1b) Undo/redo path MUST cancel timers before applying
        // the snapshot. In the real EditorLayout adapter we call
        // cancelActiveTransition() here; mirror that behavior in
        // tests so the contract is exercised.
        cancelActiveTransition();
        applyActions.applyTemplateSnapshot(snap);
      },
    };
  });

  afterEach(() => {
    cancelActiveTransition();
    vi.useRealTimers();
  });

  it('undo restores prior state exactly', () => {
    const priorLayers = state.layers;
    const priorActive = state.activeLayerId;
    const priorVariant = state.variant;

    applyTemplate(
      applyActions,
      (cmd) => stack.push(cmd),
      mkTemplate({ id: 'T1', variant: 'slim' }),
      makeTemplatePixels(50),
      { skipTimeline: true },
    );
    expect(state.variant).toBe('slim');
    expect(state.layers[0].id).toBe('template:T1');

    stack.undo(undoActions);

    // Restored: variant classic, original layer.
    expect(state.variant).toBe(priorVariant);
    expect(state.activeLayerId).toBe(priorActive);
    expect(state.layers).toEqual(priorLayers);
  });

  it('redo reapplies identically', () => {
    applyTemplate(
      applyActions,
      (cmd) => stack.push(cmd),
      mkTemplate({ id: 'T2', variant: 'slim' }),
      makeTemplatePixels(80),
      { skipTimeline: true },
    );
    stack.undo(undoActions);
    stack.redo(undoActions);

    expect(state.variant).toBe('slim');
    expect(state.layers).toHaveLength(1);
    expect(state.layers[0].id).toBe('template:T2');
    expect(state.layers[0].pixels[0]).toBe(80);
    expect(state.lastAppliedTemplateId).toBe('T2');
    expect(state.hasEditedSinceTemplate).toBe(false);
  });

  it('undo → redo → undo is bit-identical to the starting state', () => {
    const startingLayers = JSON.parse(
      JSON.stringify(
        state.layers.map((l) => ({ ...l, pixels: Array.from(l.pixels) })),
      ),
    );

    applyTemplate(
      applyActions,
      (cmd) => stack.push(cmd),
      mkTemplate({ id: 'T3' }),
      makeTemplatePixels(120),
      { skipTimeline: true },
    );
    stack.undo(undoActions);
    stack.redo(undoActions);
    stack.undo(undoActions);

    const nowLayers = JSON.parse(
      JSON.stringify(
        state.layers.map((l) => ({ ...l, pixels: Array.from(l.pixels) })),
      ),
    );
    expect(nowLayers).toEqual(startingLayers);
  });
});

describe('cancelActiveTransition — timer orchestration', () => {
  beforeEach(() => {
    cancelActiveTransition();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cancelActiveTransition();
    vi.useRealTimers();
  });

  it('schedules hint + pulse + both clears at the right offsets', () => {
    const { state, applyActions } = makeTestHarness();
    applyTemplate(
      applyActions,
      () => {},
      mkTemplate({ contextualHint: 'Hint A', affordancePulse: 'color' }),
      makeTemplatePixels(),
    );

    // Before 700ms: nothing fired.
    vi.advanceTimersByTime(TIMING.HINT_DELAY_MS - 1);
    expect(state.contextualHint).toBeNull();

    // Advance past 700ms: hint set.
    vi.advanceTimersByTime(1);
    expect(state.contextualHint).toBe('Hint A');
    expect(state.pulseTarget).toBeNull();

    // 1000ms: pulse set.
    vi.advanceTimersByTime(TIMING.PULSE_DELAY_MS - TIMING.HINT_DELAY_MS);
    expect(state.pulseTarget).toBe('color');

    // 1600ms (PULSE_DELAY + PULSE_DURATION): pulse cleared.
    vi.advanceTimersByTime(TIMING.PULSE_DURATION_MS);
    expect(state.pulseTarget).toBeNull();

    // 3700ms (HINT_DELAY + HINT_DURATION): hint cleared.
    vi.advanceTimersByTime(
      TIMING.HINT_DELAY_MS +
        TIMING.HINT_DURATION_MS -
        (TIMING.PULSE_DELAY_MS + TIMING.PULSE_DURATION_MS),
    );
    expect(state.contextualHint).toBeNull();
  });

  it('clarification #1a: new applyTemplate cancels prior timers', () => {
    const h1 = makeTestHarness();
    applyTemplate(
      h1.applyActions,
      () => {},
      mkTemplate({ id: 'A', contextualHint: 'Hint A' }),
      makeTemplatePixels(),
    );

    // 500ms in (before hint fires at 700ms), apply template B.
    vi.advanceTimersByTime(500);
    const h2 = makeTestHarness();
    applyTemplate(
      h2.applyActions,
      () => {},
      mkTemplate({ id: 'B', contextualHint: 'Hint B' }),
      makeTemplatePixels(),
    );

    // After full timeline elapses, ONLY B's timers fired.
    vi.advanceTimersByTime(TIMING.HINT_DELAY_MS + TIMING.HINT_DURATION_MS + 100);
    // A's hint never got written because A's hint timer was cancelled
    // at the top of B's apply call.
    expect(h1.state.contextualHint).toBeNull();
    expect(h1.state.pulseTarget).toBeNull();
    // B's timeline ran to completion.
    // (hint set then cleared → final state null; pulse same.)
    expect(h2.state.hintSetAt).not.toBeNull();
    expect(h2.state.hintClearedAt).not.toBeNull();
    expect(h2.state.pulseSetAt).not.toBeNull();
    expect(h2.state.pulseClearedAt).not.toBeNull();
  });

  it('clarification #1b: undo via adapter cancels in-flight timers', () => {
    const { state, applyActions } = makeTestHarness();
    const stack = new UndoStack();
    const undoActions: EditorActions = {
      getLayers: () => state.layers,
      setLayerPixelRegion: () => {},
      insertLayerAt: () => {},
      deleteLayer: () => {},
      reorderLayers: () => {},
      setLayerName: () => {},
      setLayerOpacity: () => {},
      setLayerBlendMode: () => {},
      setLayerVisible: () => {},
      recomposite: () => {},
      strokeActive: () => false,
      applyTemplateSnapshot: (snap) => {
        cancelActiveTransition(); // the contract
        applyActions.applyTemplateSnapshot(snap);
      },
    };

    applyTemplate(
      applyActions,
      (cmd) => stack.push(cmd),
      mkTemplate({ id: 'A', contextualHint: 'Hint A', affordancePulse: 'color' }),
      makeTemplatePixels(),
    );

    // Trigger undo at 500ms (hint not yet fired).
    vi.advanceTimersByTime(500);
    stack.undo(undoActions);

    // Advance past all timeline offsets; A's hint/pulse should NOT set.
    vi.advanceTimersByTime(TIMING.HINT_DELAY_MS + TIMING.HINT_DURATION_MS + 100);

    expect(state.contextualHint).toBeNull();
    expect(state.pulseTarget).toBeNull();
    expect(state.hintSetAt).toBeNull();
    expect(state.pulseSetAt).toBeNull();
  });

  it('clarification #1c: standalone cancelActiveTransition clears all timers', () => {
    const { state, applyActions } = makeTestHarness();
    applyTemplate(
      applyActions,
      () => {},
      mkTemplate(),
      makeTemplatePixels(),
    );
    cancelActiveTransition();
    vi.advanceTimersByTime(TIMING.HINT_DELAY_MS + TIMING.HINT_DURATION_MS + 100);
    expect(state.hintSetAt).toBeNull();
    expect(state.pulseSetAt).toBeNull();
  });
});

describe('UndoStack byte accounting for apply-template commands', () => {
  beforeEach(() => {
    cancelActiveTransition();
  });

  it('sums pre + post layer pixel bytes for apply-template records', () => {
    const { state, applyActions } = makeTestHarness();
    // Add a second layer so the before-snapshot is 2 layers × 16KB.
    state.layers = [mkLayer('base', 10), mkLayer('accent', 20)];
    state.activeLayerId = 'base';

    const stack = new UndoStack();
    applyTemplate(
      applyActions,
      (cmd) => stack.push(cmd),
      mkTemplate(),
      makeTemplatePixels(),
      { skipTimeline: true },
    );

    // 2 × 16384 before + 1 × 16384 after + 128 overhead = ~49280 bytes
    const used = stack.bytesUsed();
    expect(used).toBeGreaterThan(16384 * 3);
    expect(used).toBeLessThan(16384 * 3 + 256);
  });
});

describe('markEdited flow integration', () => {
  beforeEach(() => {
    cancelActiveTransition();
  });

  it('first-stroke edge: paint → undo → paint stays hasEditedSinceTemplate=true (no flicker)', () => {
    // markEdited is idempotent: once true, subsequent calls no-op.
    // This is a regression guard on the "paint, undo, paint" edge
    // case from the work-phase clarifications.
    const { state, applyActions } = makeTestHarness({
      hasEditedSinceTemplate: false,
    });

    // Simulate first stroke commit → markEdited is called at the
    // chokepoint. We model the markEdited semantics directly here.
    const markEdited = (): void => {
      if (!state.hasEditedSinceTemplate) {
        state.hasEditedSinceTemplate = true;
      }
    };

    markEdited();
    expect(state.hasEditedSinceTemplate).toBe(true);

    // Undo a stroke (flag does NOT reset; the stroke undo doesn't
    // touch the flag). Second stroke fires markEdited again; still
    // no flicker — flag stays true.
    markEdited();
    markEdited();
    expect(state.hasEditedSinceTemplate).toBe(true);

    // Note: apply-template is the only thing that resets the flag
    // to false (via applyTemplateState in the snapshot).
    applyTemplate(
      applyActions,
      () => {},
      mkTemplate(),
      makeTemplatePixels(),
      { skipTimeline: true },
    );
    expect(state.hasEditedSinceTemplate).toBe(false);

    markEdited();
    expect(state.hasEditedSinceTemplate).toBe(true);
  });
});

describe('post-apply timeline integration (Unit 7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelActiveTransition();
  });

  afterEach(() => {
    cancelActiveTransition();
    vi.useRealTimers();
  });

  it('schedules hint at +700ms, pulse at +1000ms, pulseClear at +1600ms, hintClear at +3700ms', () => {
    const { state, applyActions } = makeTestHarness();

    applyTemplate(
      applyActions,
      () => {},
      mkTemplate({ contextualHint: 'Try a color', affordancePulse: 'color' }),
      makeTemplatePixels(),
    );

    // Before any timer fires
    expect(state.contextualHint).toBeNull();
    expect(state.pulseTarget).toBeNull();

    // +700ms → hint set
    vi.advanceTimersByTime(TIMING.HINT_DELAY_MS);
    expect(state.contextualHint).toBe('Try a color');
    expect(state.pulseTarget).toBeNull();

    // +300ms more (total 1000ms) → pulse set
    vi.advanceTimersByTime(TIMING.PULSE_DELAY_MS - TIMING.HINT_DELAY_MS);
    expect(state.pulseTarget).toBe('color');

    // +600ms more (total 1600ms) → pulse cleared
    vi.advanceTimersByTime(TIMING.PULSE_DURATION_MS);
    expect(state.pulseTarget).toBeNull();
    expect(state.contextualHint).toBe('Try a color');

    // +2100ms more (total 3700ms) → hint cleared
    vi.advanceTimersByTime(
      TIMING.HINT_DELAY_MS + TIMING.HINT_DURATION_MS - TIMING.PULSE_DELAY_MS - TIMING.PULSE_DURATION_MS,
    );
    expect(state.contextualHint).toBeNull();
  });
});
