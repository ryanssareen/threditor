'use client';

/**
 * M7 Unit 5: render-only gate component.
 *
 * State is hoisted to EditorLayout via useTemplateGate() and passed
 * down as `state` + `dispatch`. This component only handles:
 *   - timer scheduling (TIMER_ELAPSED after CHIP_DELAY_MS)
 *   - store subscription (FIRST_STROKE when hasEditedSinceTemplate flips)
 *   - hydration settle detection (HYDRATION_SETTLED event)
 *   - manifest loading
 *   - conditional rendering of chip / sheet
 *   - writing to localStorage on terminal transitions
 */

import { useEffect, useRef, useState } from 'react';

import { loadManifest, decodeTemplatePng, TIMING } from '@/lib/editor/templates';
import { writeDismissed } from '@/lib/editor/template-gate-storage';
import { useEditorStore } from '@/lib/editor/store';
import type { TemplateManifest, TemplateMeta } from '@/lib/editor/types';
import type { GateState, GateEvent } from '@/lib/editor/template-gate-state';
import { TemplateSuggestionChip } from './TemplateSuggestionChip';
import { TemplateBottomSheet } from './TemplateBottomSheet';

type Props = {
  state: GateState;
  dispatch: (event: GateEvent) => void;
  onApplyTemplate: (template: TemplateMeta, pixels: Uint8ClampedArray) => void;
  hydrationPending: boolean;
};

export function TemplateGate({ state, dispatch, onApplyTemplate, hydrationPending }: Props) {
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);

  // Load manifest once on mount.
  useEffect(() => {
    let cancelled = false;
    loadManifest().then((m) => {
      if (!cancelled) setManifest(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hydration settle: when hydrationPending flips false → true fire event.
  const prevHydrationRef = useRef(hydrationPending);
  useEffect(() => {
    const wasHydrating = prevHydrationRef.current;
    prevHydrationRef.current = hydrationPending;
    if (wasHydrating && !hydrationPending) {
      dispatch({ type: 'HYDRATION_SETTLED' });
    }
  }, [hydrationPending, dispatch]);

  // Timer: start when state is 'idle' AND hydration has settled.
  useEffect(() => {
    if (state.kind !== 'idle') return;
    if (hydrationPending) return;

    const id = setTimeout(() => {
      dispatch({ type: 'TIMER_ELAPSED' });
    }, TIMING.CHIP_DELAY_MS);

    return () => clearTimeout(id);
  }, [state.kind, hydrationPending, dispatch]);

  // Narrow store subscription: fire FIRST_STROKE when hasEditedSinceTemplate
  // flips false → true while state is idle.
  useEffect(() => {
    let prevEdited = useEditorStore.getState().hasEditedSinceTemplate;
    const unsub = useEditorStore.subscribe((s) => {
      const next = s.hasEditedSinceTemplate;
      if (!prevEdited && next) {
        dispatch({ type: 'FIRST_STROKE' });
      }
      prevEdited = next;
    });
    return unsub;
  }, [dispatch]);

  // Write localStorage when the gate transitions to dismissed via
  // CHIP_DISMISSED, SHEET_DISMISSED_PERSISTENT, or TEMPLATE_SELECTED.
  // We detect this by tracking whether `state.kind` just became 'dismissed'.
  const prevStateKindRef = useRef(state.kind);
  useEffect(() => {
    if (prevStateKindRef.current !== 'dismissed' && state.kind === 'dismissed') {
      writeDismissed();
    }
    prevStateKindRef.current = state.kind;
  }, [state.kind]);

  // Template selection handler.
  const handleSelect = async (template: TemplateMeta) => {
    try {
      const pixels = await decodeTemplatePng(template.file);
      onApplyTemplate(template, pixels);
      dispatch({ type: 'TEMPLATE_SELECTED' });
    } catch (err) {
      console.warn('TemplateGate: failed to decode template PNG', template.id, err);
      // Sheet stays open; user can try another template or dismiss.
    }
  };

  if (state.kind === 'suggestion_chip') {
    return (
      <TemplateSuggestionChip
        onOpen={() => dispatch({ type: 'CHIP_CLICKED' })}
        onDismiss={() => dispatch({ type: 'CHIP_DISMISSED' })}
      />
    );
  }

  if (state.kind === 'bottom_sheet') {
    return (
      <TemplateBottomSheet
        manifest={manifest}
        source={state.source}
        onSelect={handleSelect}
        onCloseTransient={() => dispatch({ type: 'SHEET_DISMISSED_TRANSIENT' })}
        onClosePersistent={() => dispatch({ type: 'SHEET_DISMISSED_PERSISTENT' })}
      />
    );
  }

  return null;
}
