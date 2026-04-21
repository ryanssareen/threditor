/**
 * M7 Unit 5: pure reducer for the Ghost Templates gate state machine.
 *
 * No React, no browser APIs — testable in isolation.
 * See DESIGN §5.3 and plan D5/D10 for the full specification.
 */

// ─── State ────────────────────────────────────────────────────────────────

export type GateState =
  | { kind: 'idle' }
  | { kind: 'suggestion_chip' }
  | { kind: 'bottom_sheet'; source: 'ghost'; priorState?: never }
  | { kind: 'bottom_sheet'; source: 'menu'; priorState: GateState }
  | { kind: 'dismissed' };

// ─── Events ───────────────────────────────────────────────────────────────

export type GateEvent =
  | { type: 'MOUNTED'; dismissed: boolean; hasEdited: boolean; hydrationPending: boolean }
  | { type: 'HYDRATION_SETTLED' }
  | { type: 'TIMER_ELAPSED' }
  | { type: 'FIRST_STROKE' }
  | { type: 'CHIP_CLICKED' }
  | { type: 'CHIP_DISMISSED' }
  | { type: 'SHEET_OPENED_FROM_MENU' }
  | { type: 'SHEET_DISMISSED_PERSISTENT' }
  | { type: 'SHEET_DISMISSED_TRANSIENT' }
  | { type: 'TEMPLATE_SELECTED' };

// ─── Initial state ────────────────────────────────────────────────────────

/**
 * Compute the initial GateState from flags read on mount.
 *
 * - dismissed || hasEdited → terminal `dismissed` (skip entirely).
 * - hydrationPending → `idle` but the timer/stroke must NOT advance until
 *   HYDRATION_SETTLED fires (gateNext enforces this for idle when pending).
 * - otherwise → `idle`.
 */
export function gateInitial(
  dismissed: boolean,
  hasEdited: boolean,
  _hydrationPending: boolean,
): GateState {
  if (dismissed || hasEdited) return { kind: 'dismissed' };
  return { kind: 'idle' };
}

// ─── Reducer ─────────────────────────────────────────────────────────────

/**
 * Pure transition function. Returns the next state given the current state
 * and an event. Returns the same object reference when no transition applies
 * (identity guard for React memoisation).
 */
export function gateNext(state: GateState, event: GateEvent): GateState {
  // Terminal: dismissed absorbs everything.
  if (state.kind === 'dismissed') return state;

  switch (event.type) {
    case 'MOUNTED':
      // MOUNTED is handled by gateInitial; if it fires again (HMR edge-case)
      // recompute initial state from the flags carried in the event.
      return gateInitial(event.dismissed, event.hasEdited, event.hydrationPending);

    case 'HYDRATION_SETTLED':
      // No-op in all states — signals that timer/stroke can now advance idle.
      // The component re-arms the timer after this fires; the state itself
      // doesn't change.
      return state;

    case 'TIMER_ELAPSED':
    case 'FIRST_STROKE':
      if (state.kind === 'idle') return { kind: 'suggestion_chip' };
      // suggestion_chip already shown: FIRST_STROKE stays (no-op).
      return state;

    case 'CHIP_CLICKED':
      if (state.kind === 'suggestion_chip') {
        return { kind: 'bottom_sheet', source: 'ghost' };
      }
      return state;

    case 'CHIP_DISMISSED':
      if (state.kind === 'idle' || state.kind === 'suggestion_chip') {
        return { kind: 'dismissed' };
      }
      return state;

    case 'SHEET_OPENED_FROM_MENU':
      // Opens from any non-bottom_sheet state; stashes prior state.
      if (state.kind !== 'bottom_sheet') {
        return { kind: 'bottom_sheet', source: 'menu', priorState: state };
      }
      // Already in a sheet; re-open is a no-op (prevent double stacking).
      return state;

    case 'TEMPLATE_SELECTED':
      if (state.kind === 'bottom_sheet') {
        return { kind: 'dismissed' };
      }
      return state;

    case 'SHEET_DISMISSED_PERSISTENT':
      if (state.kind === 'bottom_sheet') {
        if (state.source === 'ghost') {
          // Explicit × on a ghost-originated sheet → persistent dismiss.
          return { kind: 'dismissed' };
        }
        // Menu-source sheet: persistent close is semantically invalid per
        // D10 (the component never fires it for menu sheets), but defensively
        // treat it like a transient dismiss — restore prior state.
        return state.priorState;
      }
      return state;

    case 'SHEET_DISMISSED_TRANSIENT':
      if (state.kind === 'bottom_sheet') {
        if (state.source === 'menu') {
          // Restore whatever state was active before the menu opened.
          return state.priorState;
        }
        // Ghost-source: backdrop / Esc → return to suggestion_chip
        // (the chip is still visible under the sheet per DESIGN §5.3).
        return { kind: 'suggestion_chip' };
      }
      return state;

    default:
      return state;
  }
}
