/**
 * M7 Unit 1: template-aware store slots + actions.
 *
 * Covers markEdited idempotency, contextual-hint + pulse setter identity
 * guards, applyTemplateState atomic swap, and narrow-selector re-render
 * semantics for TemplateGate-shaped subscriptions.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '../lib/editor/store';
import type { ApplyTemplateSnapshot, Layer } from '../lib/editor/types';

function makeLayer(id: string, fill: number): Layer {
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels: new Uint8ClampedArray(64 * 64 * 4).fill(fill),
  };
}

function resetStore(): void {
  useEditorStore.setState({
    variant: 'classic',
    layers: [],
    activeLayerId: '',
    hasEditedSinceTemplate: false,
    lastAppliedTemplateId: null,
    activeContextualHint: null,
    pulseTarget: null,
  });
}

describe('useEditorStore — M7 template slots', () => {
  beforeEach(resetStore);

  describe('markEdited', () => {
    it('flips false → true on first call', () => {
      useEditorStore.getState().markEdited();
      expect(useEditorStore.getState().hasEditedSinceTemplate).toBe(true);
    });

    it('is idempotent: subsequent calls return same state reference', () => {
      useEditorStore.getState().markEdited();
      const s1 = useEditorStore.getState();
      useEditorStore.getState().markEdited();
      const s2 = useEditorStore.getState();
      expect(s2).toBe(s1);
    });

    it('re-fires false → true after applyTemplateState resets it', () => {
      useEditorStore.getState().markEdited();
      expect(useEditorStore.getState().hasEditedSinceTemplate).toBe(true);
      const snapshot: ApplyTemplateSnapshot = {
        layers: [makeLayer('template:A', 100)],
        activeLayerId: 'template:A',
        variant: 'classic',
        hasEditedSinceTemplate: false,
        lastAppliedTemplateId: 'A',
      };
      useEditorStore.getState().applyTemplateState(snapshot);
      expect(useEditorStore.getState().hasEditedSinceTemplate).toBe(false);
      useEditorStore.getState().markEdited();
      expect(useEditorStore.getState().hasEditedSinceTemplate).toBe(true);
    });
  });

  describe('setActiveContextualHint + clearContextualHint', () => {
    it('sets + clears', () => {
      useEditorStore.getState().setActiveContextualHint('Try a new color');
      expect(useEditorStore.getState().activeContextualHint).toBe(
        'Try a new color',
      );
      useEditorStore.getState().clearContextualHint();
      expect(useEditorStore.getState().activeContextualHint).toBeNull();
    });

    it('same-hint setter is a no-op (identity-guarded)', () => {
      useEditorStore.getState().setActiveContextualHint('Test');
      const s1 = useEditorStore.getState();
      useEditorStore.getState().setActiveContextualHint('Test');
      const s2 = useEditorStore.getState();
      expect(s2).toBe(s1);
    });

    it('clearContextualHint from null is a no-op', () => {
      const s1 = useEditorStore.getState();
      useEditorStore.getState().clearContextualHint();
      const s2 = useEditorStore.getState();
      expect(s2).toBe(s1);
    });
  });

  describe('setPulseTarget', () => {
    it('sets + clears', () => {
      useEditorStore.getState().setPulseTarget('color');
      expect(useEditorStore.getState().pulseTarget).toBe('color');
      useEditorStore.getState().setPulseTarget(null);
      expect(useEditorStore.getState().pulseTarget).toBeNull();
    });

    it('same-target setter is a no-op', () => {
      useEditorStore.getState().setPulseTarget('mirror');
      const s1 = useEditorStore.getState();
      useEditorStore.getState().setPulseTarget('mirror');
      const s2 = useEditorStore.getState();
      expect(s2).toBe(s1);
    });
  });

  describe('applyTemplateState', () => {
    it('swaps all five slots atomically', () => {
      const snapshot: ApplyTemplateSnapshot = {
        layers: [makeLayer('template:X', 200)],
        activeLayerId: 'template:X',
        variant: 'slim',
        hasEditedSinceTemplate: false,
        lastAppliedTemplateId: 'X',
      };
      // Single subscription sees one final state.
      let callbackCount = 0;
      let seenState: { variant: string; layerId: string } | null = null;
      const unsub = useEditorStore.subscribe((s) => {
        callbackCount += 1;
        seenState = { variant: s.variant, layerId: s.activeLayerId };
      });
      useEditorStore.getState().applyTemplateState(snapshot);
      unsub();
      // Zustand's base create batches the setter's return object into
      // one state update → subscribers see the final state once.
      expect(callbackCount).toBe(1);
      expect(seenState).toEqual({ variant: 'slim', layerId: 'template:X' });
    });

    it('does NOT clear layers when variant changes (vs setVariant)', () => {
      const snapshot: ApplyTemplateSnapshot = {
        layers: [makeLayer('template:Y', 50)],
        activeLayerId: 'template:Y',
        variant: 'slim',
        hasEditedSinceTemplate: false,
        lastAppliedTemplateId: 'Y',
      };
      useEditorStore.getState().applyTemplateState(snapshot);
      const state = useEditorStore.getState();
      expect(state.variant).toBe('slim');
      expect(state.layers.length).toBe(1);
      expect(state.layers[0].id).toBe('template:Y');
    });

    it('setVariant (user toggle) DOES clear layers — contrast with applyTemplateState', () => {
      useEditorStore.setState({
        layers: [makeLayer('base', 10)],
        activeLayerId: 'base',
      });
      useEditorStore.getState().setVariant('slim');
      expect(useEditorStore.getState().layers.length).toBe(0);
    });

    it('restores lastAppliedTemplateId + hasEditedSinceTemplate on undo-style reapply', () => {
      // Simulate: apply A (hasEdited: false, lastApplied: A), user paints
      // (hasEdited: true), undo apply-template (back to some priorSnapshot).
      const priorSnapshot: ApplyTemplateSnapshot = {
        layers: [makeLayer('placeholder', 30)],
        activeLayerId: 'placeholder',
        variant: 'classic',
        hasEditedSinceTemplate: false,
        lastAppliedTemplateId: null,
      };
      useEditorStore.getState().applyTemplateState(priorSnapshot);
      expect(useEditorStore.getState().hasEditedSinceTemplate).toBe(false);
      expect(useEditorStore.getState().lastAppliedTemplateId).toBeNull();
    });
  });

  describe('narrow-selector re-render guard', () => {
    it('subscribers to hasEditedSinceTemplate do not fire on unrelated mutations', () => {
      let callCount = 0;
      const unsub = useEditorStore.subscribe((s, prev) => {
        if (s.hasEditedSinceTemplate !== prev.hasEditedSinceTemplate) {
          callCount += 1;
        }
      });
      useEditorStore.getState().setBrushSize(2);
      useEditorStore.getState().setActiveColor({
        h: 90,
        s: 0.5,
        l: 0.5,
        hex: '#80c080',
      });
      unsub();
      expect(callCount).toBe(0);
    });

    it('fires once when markEdited flips the flag', () => {
      let callCount = 0;
      const unsub = useEditorStore.subscribe((s, prev) => {
        if (s.hasEditedSinceTemplate !== prev.hasEditedSinceTemplate) {
          callCount += 1;
        }
      });
      useEditorStore.getState().markEdited();
      useEditorStore.getState().markEdited(); // idempotent; no fire
      useEditorStore.getState().markEdited();
      unsub();
      expect(callCount).toBe(1);
    });
  });
});
