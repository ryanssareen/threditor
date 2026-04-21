'use client';

/**
 * M7 Unit 5: hoisted gate state hook.
 *
 * Owns the GateState so EditorLayout can pass both `state` and `dispatch`
 * to TemplateGate (render) and Sidebar (menu button). This keeps the
 * state machine logic in one place while allowing sibling components to
 * drive events without prop-drilling through TemplateGate's internals.
 */

import { useReducer } from 'react';

import {
  gateInitial,
  gateNext,
  type GateEvent,
  type GateState,
} from '@/lib/editor/template-gate-state';
import { readDismissed } from '@/lib/editor/template-gate-storage';
import { useEditorStore } from '@/lib/editor/store';

export type { GateState, GateEvent };

export type TemplateGateHandle = {
  state: GateState;
  dispatch: (event: GateEvent) => void;
};

/**
 * Call once in EditorLayout. Pass the returned handle as props to
 * TemplateGate and TemplateMenuButton.
 */
export function useTemplateGate(hydrationPending: boolean): TemplateGateHandle {
  const dismissed = readDismissed();
  const hasEdited = useEditorStore.getState().hasEditedSinceTemplate;

  const [state, dispatch] = useReducer(
    gateNext,
    undefined,
    () => gateInitial(dismissed, hasEdited, hydrationPending),
  );

  return { state, dispatch };
}
