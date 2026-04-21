/**
 * M7 Unit 4: apply-template orchestrator.
 *
 * Pure module — no React, no zustand. Callers pass in:
 *   - An EditorActions adapter (to mutate the store + pixel regions).
 *   - A pushCommand callback that writes to the session UndoStack.
 *   - The selected TemplateMeta + its decoded pixels.
 *
 * Responsibilities:
 *   1. Cancel any in-flight transition timers (D8 + clarification #1a).
 *   2. Snapshot the CURRENT store state (before).
 *   3. Build the templateLayer with the decoded pixels.
 *   4. Build the after-snapshot with the template layer installed.
 *   5. Push an {kind:'apply-template', before, after} command to undo.
 *   6. Atomically write `after` into the store via
 *      actions.applyTemplateSnapshot.
 *   7. Schedule the post-apply timeline:
 *        +700ms   → setActiveContextualHint(template.contextualHint)
 *        +1000ms  → setPulseTarget(template.affordancePulse)
 *        +1600ms  → setPulseTarget(null)    (PULSE_DELAY + PULSE_DURATION)
 *        +3700ms  → clearContextualHint()   (HINT_DELAY + HINT_DURATION)
 *      Each timer handle stored in module scope so the NEXT apply or
 *      an undo can cancel them (clarification #1).
 *
 * Defensive guards:
 *   - Rejects when store.strokeActive === true (D10; don't interrupt
 *     a pointer-active stroke).
 *   - Rejects when hydration is pending (#2; avoid clobbering a
 *     restore-in-flight).
 *   - Rejects on bad pixel buffer length (defensive against upstream
 *     decode failure).
 * All rejections log a warning and no-op (store unchanged, no push).
 */

import type {
  ApplyTemplateSnapshot,
  Layer,
  TemplateMeta,
} from './types';
import { TIMING } from './templates';

export type ApplyTemplateActions = {
  /** Read current layers (for before-snapshot). */
  getLayers: () => Layer[];
  /** Read current activeLayerId. */
  getActiveLayerId: () => string;
  /** Read current variant. */
  getVariant: () => 'classic' | 'slim';
  /** Read current hasEditedSinceTemplate. */
  getHasEditedSinceTemplate: () => boolean;
  /** Read current lastAppliedTemplateId. */
  getLastAppliedTemplateId: () => string | null;
  /** True while a pointer stroke is mid-flight. */
  strokeActive: () => boolean;
  /** True while IDB hydration is still settling. */
  hydrationPending: () => boolean;
  /** Atomic whole-document swap (layers + variant + flags). */
  applyTemplateSnapshot: (snapshot: ApplyTemplateSnapshot) => void;
  /** Recomposite after state swap. */
  recomposite: () => void;
  /** Hint setter (hint text or null). */
  setActiveContextualHint: (hint: string | null) => void;
  /** Pulse target setter. */
  setPulseTarget: (
    target: 'color' | 'mirror' | 'brush' | null,
  ) => void;
  /** Clear contextual hint (equivalent to setActiveContextualHint(null)). */
  clearContextualHint: () => void;
};

export type ApplyTemplateCommand = {
  kind: 'apply-template';
  before: ApplyTemplateSnapshot;
  after: ApplyTemplateSnapshot;
};

type TimerHandles = {
  hint: ReturnType<typeof setTimeout> | null;
  pulse: ReturnType<typeof setTimeout> | null;
  pulseClear: ReturnType<typeof setTimeout> | null;
  hintClear: ReturnType<typeof setTimeout> | null;
};

const timers: TimerHandles = {
  hint: null,
  pulse: null,
  pulseClear: null,
  hintClear: null,
};

/**
 * Cancel any in-flight post-apply timers. Called from:
 *   (a) top of applyTemplate() — before a new apply kicks off.
 *   (b) EditorActions.applyTemplateSnapshot in EditorLayout — before
 *       the store write during undo/redo of apply-template commands.
 *   (c) exposed for tests / teardown.
 */
export function cancelActiveTransition(): void {
  if (timers.hint !== null) {
    clearTimeout(timers.hint);
    timers.hint = null;
  }
  if (timers.pulse !== null) {
    clearTimeout(timers.pulse);
    timers.pulse = null;
  }
  if (timers.pulseClear !== null) {
    clearTimeout(timers.pulseClear);
    timers.pulseClear = null;
  }
  if (timers.hintClear !== null) {
    clearTimeout(timers.hintClear);
    timers.hintClear = null;
  }
}

function deepCloneLayers(layers: readonly Layer[]): Layer[] {
  return layers.map((l) => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    blendMode: l.blendMode,
    // .slice() on a Uint8ClampedArray produces a defensive copy so
    // subsequent pixel mutations on the live layer don't corrupt the
    // undo snapshot. M6 COMPOUND flagged this as load-bearing.
    pixels: l.pixels.slice(),
  }));
}

export type ApplyTemplateOptions = {
  /**
   * Skip the post-apply timeline (hint + pulse scheduling). Useful for
   * tests that want to verify the state swap without mock-timer setup.
   * Defaults to false — production always schedules.
   */
  skipTimeline?: boolean;
};

export type ApplyTemplateResult =
  | { ok: true; newActiveLayerId: string }
  | { ok: false; reason: string };

/**
 * Orchestrate a template application. Returns `{ok:false}` with a
 * reason string on defensive rejection; caller logs to console if
 * desired. Returns `{ok:true}` with the new active layer id on
 * success.
 */
export function applyTemplate(
  actions: ApplyTemplateActions,
  pushCommand: (cmd: ApplyTemplateCommand) => void,
  template: TemplateMeta,
  pixels: Uint8ClampedArray,
  options: ApplyTemplateOptions = {},
): ApplyTemplateResult {
  // Guard: pixel buffer shape.
  if (pixels.length !== 64 * 64 * 4) {
    return { ok: false, reason: 'pixel-length-mismatch' };
  }

  // Guard: no mid-stroke interruption (D10).
  if (actions.strokeActive()) {
    return { ok: false, reason: 'stroke-active' };
  }

  // Guard: no apply during hydration race (#2).
  if (actions.hydrationPending()) {
    return { ok: false, reason: 'hydration-pending' };
  }

  // (1a) Cancel any prior in-flight transition BEFORE snapshotting
  // current state — so old timers can't fire against the new
  // about-to-be-set state.
  cancelActiveTransition();

  // (2) Snapshot before-state. Defensive deep clone so the undo record
  // isn't sharing buffers with the live document.
  const before: ApplyTemplateSnapshot = {
    layers: deepCloneLayers(actions.getLayers()),
    activeLayerId: actions.getActiveLayerId(),
    variant: actions.getVariant(),
    hasEditedSinceTemplate: actions.getHasEditedSinceTemplate(),
    lastAppliedTemplateId: actions.getLastAppliedTemplateId(),
  };

  // (3) Build the template layer. ID uses a `template:` prefix to make
  // it obvious in the LayerPanel what the source is; tools still
  // don't care about the id content.
  const templateLayer: Layer = {
    id: `template:${template.id}`,
    name: template.label,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels,
  };

  // (4) Build after-snapshot. Layers is a fresh array of one.
  const after: ApplyTemplateSnapshot = {
    layers: [templateLayer],
    activeLayerId: templateLayer.id,
    variant: template.variant,
    hasEditedSinceTemplate: false,
    lastAppliedTemplateId: template.id,
  };

  // (5) Push command BEFORE the state swap so the undo stack holds
  // the consistent before/after pair even if the swap throws (it
  // shouldn't, but defensive).
  pushCommand({ kind: 'apply-template', before, after });

  // (6) Atomic state swap.
  actions.applyTemplateSnapshot(after);
  actions.recomposite();

  // (7) Post-apply timeline. Skip in tests that don't want timer
  // orchestration polluting their assertions.
  if (!options.skipTimeline) {
    timers.hint = setTimeout(() => {
      actions.setActiveContextualHint(template.contextualHint);
      timers.hint = null;
    }, TIMING.HINT_DELAY_MS);

    timers.pulse = setTimeout(() => {
      actions.setPulseTarget(template.affordancePulse);
      timers.pulse = null;
    }, TIMING.PULSE_DELAY_MS);

    timers.pulseClear = setTimeout(() => {
      actions.setPulseTarget(null);
      timers.pulseClear = null;
    }, TIMING.PULSE_DELAY_MS + TIMING.PULSE_DURATION_MS);

    timers.hintClear = setTimeout(() => {
      actions.clearContextualHint();
      timers.hintClear = null;
    }, TIMING.HINT_DELAY_MS + TIMING.HINT_DURATION_MS);
  }

  return { ok: true, newActiveLayerId: templateLayer.id };
}
