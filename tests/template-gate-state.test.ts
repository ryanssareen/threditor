/**
 * M7 Unit 5 — template-gate-state reducer tests.
 *
 * Pure unit tests; no React, no DOM. Verifies every transition in the
 * DESIGN §5.3 state machine and the D10 dismiss-semantics table.
 */

import { describe, expect, it } from 'vitest';

import {
  gateInitial,
  gateNext,
  type GateState,
} from '../lib/editor/template-gate-state';

// ─── Helpers ──────────────────────────────────────────────────────────────

function idle(): GateState { return { kind: 'idle' }; }
function chip(): GateState { return { kind: 'suggestion_chip' }; }
function sheetGhost(): GateState { return { kind: 'bottom_sheet', source: 'ghost' }; }
function sheetMenu(priorState: GateState = idle()): GateState {
  return { kind: 'bottom_sheet', source: 'menu', priorState };
}
function dismissed(): GateState { return { kind: 'dismissed' }; }

// ─── gateInitial ─────────────────────────────────────────────────────────

describe('gateInitial', () => {
  it('returns idle when neither dismissed nor hasEdited', () => {
    expect(gateInitial(false, false, false)).toEqual(idle());
  });

  it('returns dismissed when dismissed=true', () => {
    expect(gateInitial(true, false, false)).toEqual(dismissed());
  });

  it('returns dismissed when hasEdited=true', () => {
    expect(gateInitial(false, true, false)).toEqual(dismissed());
  });

  it('returns dismissed when both dismissed and hasEdited are true', () => {
    expect(gateInitial(true, true, false)).toEqual(dismissed());
  });

  it('returns idle when hydrationPending=true (timer deferred to HYDRATION_SETTLED)', () => {
    expect(gateInitial(false, false, true)).toEqual(idle());
  });
});

// ─── dismissed (terminal) ────────────────────────────────────────────────

describe('dismissed state — absorbs all events', () => {
  const d = dismissed();

  const events = [
    'TIMER_ELAPSED', 'FIRST_STROKE', 'CHIP_CLICKED', 'CHIP_DISMISSED',
    'SHEET_OPENED_FROM_MENU', 'SHEET_DISMISSED_PERSISTENT',
    'SHEET_DISMISSED_TRANSIENT', 'TEMPLATE_SELECTED', 'HYDRATION_SETTLED',
  ] as const;

  for (const type of events) {
    it(`${type} from dismissed stays dismissed`, () => {
      const next = gateNext(d, { type } as Parameters<typeof gateNext>[1]);
      expect(next).toBe(d); // same reference — identity guard
    });
  }
});

// ─── idle transitions ────────────────────────────────────────────────────

describe('idle transitions', () => {
  it('TIMER_ELAPSED → suggestion_chip', () => {
    expect(gateNext(idle(), { type: 'TIMER_ELAPSED' })).toEqual(chip());
  });

  it('FIRST_STROKE → suggestion_chip', () => {
    expect(gateNext(idle(), { type: 'FIRST_STROKE' })).toEqual(chip());
  });

  it('CHIP_DISMISSED from idle → dismissed', () => {
    expect(gateNext(idle(), { type: 'CHIP_DISMISSED' })).toEqual(dismissed());
  });

  it('HYDRATION_SETTLED from idle is a no-op (state unchanged)', () => {
    const s = idle();
    expect(gateNext(s, { type: 'HYDRATION_SETTLED' })).toBe(s);
  });

  it('SHEET_OPENED_FROM_MENU from idle → bottom_sheet(menu) with priorState=idle', () => {
    const s = idle();
    const next = gateNext(s, { type: 'SHEET_OPENED_FROM_MENU' });
    expect(next).toEqual({ kind: 'bottom_sheet', source: 'menu', priorState: idle() });
  });
});

// ─── suggestion_chip transitions ─────────────────────────────────────────

describe('suggestion_chip transitions', () => {
  it('CHIP_CLICKED → bottom_sheet(ghost)', () => {
    expect(gateNext(chip(), { type: 'CHIP_CLICKED' })).toEqual(sheetGhost());
  });

  it('CHIP_DISMISSED → dismissed', () => {
    expect(gateNext(chip(), { type: 'CHIP_DISMISSED' })).toEqual(dismissed());
  });

  it('FIRST_STROKE stays at suggestion_chip (chip already shown)', () => {
    const s = chip();
    expect(gateNext(s, { type: 'FIRST_STROKE' })).toBe(s);
  });

  it('TIMER_ELAPSED stays at suggestion_chip (already showing chip)', () => {
    const s = chip();
    expect(gateNext(s, { type: 'TIMER_ELAPSED' })).toBe(s);
  });

  it('SHEET_OPENED_FROM_MENU → bottom_sheet(menu) with priorState=suggestion_chip', () => {
    const s = chip();
    const next = gateNext(s, { type: 'SHEET_OPENED_FROM_MENU' });
    expect(next).toEqual({ kind: 'bottom_sheet', source: 'menu', priorState: chip() });
  });
});

// ─── bottom_sheet (ghost) transitions ────────────────────────────────────

describe('bottom_sheet(ghost) transitions', () => {
  it('TEMPLATE_SELECTED → dismissed', () => {
    expect(gateNext(sheetGhost(), { type: 'TEMPLATE_SELECTED' })).toEqual(dismissed());
  });

  it('SHEET_DISMISSED_PERSISTENT → dismissed (explicit × on ghost-originated sheet)', () => {
    expect(gateNext(sheetGhost(), { type: 'SHEET_DISMISSED_PERSISTENT' })).toEqual(dismissed());
  });

  it('SHEET_DISMISSED_TRANSIENT → suggestion_chip (backdrop/Esc on ghost sheet)', () => {
    expect(gateNext(sheetGhost(), { type: 'SHEET_DISMISSED_TRANSIENT' })).toEqual(chip());
  });

  it('SHEET_OPENED_FROM_MENU while already in sheet is a no-op', () => {
    const s = sheetGhost();
    expect(gateNext(s, { type: 'SHEET_OPENED_FROM_MENU' })).toBe(s);
  });
});

// ─── bottom_sheet (menu) transitions ─────────────────────────────────────

describe('bottom_sheet(menu) transitions', () => {
  it('SHEET_DISMISSED_TRANSIENT restores priorState (idle)', () => {
    const s = sheetMenu(idle());
    expect(gateNext(s, { type: 'SHEET_DISMISSED_TRANSIENT' })).toEqual(idle());
  });

  it('SHEET_DISMISSED_TRANSIENT restores priorState (suggestion_chip)', () => {
    const s = sheetMenu(chip());
    expect(gateNext(s, { type: 'SHEET_DISMISSED_TRANSIENT' })).toEqual(chip());
  });

  it('SHEET_DISMISSED_PERSISTENT on menu sheet restores priorState (defensive path per D10)', () => {
    const s = sheetMenu(chip());
    expect(gateNext(s, { type: 'SHEET_DISMISSED_PERSISTENT' })).toEqual(chip());
  });

  it('TEMPLATE_SELECTED from menu sheet → dismissed', () => {
    expect(gateNext(sheetMenu(chip()), { type: 'TEMPLATE_SELECTED' })).toEqual(dismissed());
  });

  it('SHEET_OPENED_FROM_MENU while already in menu-sheet is a no-op (no double stacking)', () => {
    const s = sheetMenu(idle());
    expect(gateNext(s, { type: 'SHEET_OPENED_FROM_MENU' })).toBe(s);
  });
});

// ─── MOUNTED event ───────────────────────────────────────────────────────

describe('MOUNTED event', () => {
  it('MOUNTED with dismissed=true → dismissed', () => {
    expect(
      gateNext(idle(), { type: 'MOUNTED', dismissed: true, hasEdited: false, hydrationPending: false }),
    ).toEqual(dismissed());
  });

  it('MOUNTED with hasEdited=true → dismissed', () => {
    expect(
      gateNext(idle(), { type: 'MOUNTED', dismissed: false, hasEdited: true, hydrationPending: false }),
    ).toEqual(dismissed());
  });

  it('MOUNTED with all-false flags → idle', () => {
    expect(
      gateNext(chip(), { type: 'MOUNTED', dismissed: false, hasEdited: false, hydrationPending: false }),
    ).toEqual(idle());
  });
});
