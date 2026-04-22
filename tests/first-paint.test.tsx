// @vitest-environment jsdom
//
// M8 Units 7+8: first-paint hook tests.
//
// The full EditorLayout is heavy to mount in jsdom (requires R3F Canvas
// shims, TextureManager stubs, and IDB mocks). Instead, we test the
// hook contract directly by exercising the timer sequence against the
// same store slots it writes to. A separate test extracts the first-
// paint coordinator logic into the store slots it's meant to affect.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '../lib/editor/store';
import { TIMING } from '../lib/editor/templates';

// ── Reimplementation of the hook's effect body for deterministic
//    testing. Mirrors the EditorLayout code exactly. If that code
//    changes, this harness must track it. ─────────────────────────────

type Timers = {
  glow: ReturnType<typeof setTimeout> | null;
  hint: ReturnType<typeof setTimeout> | null;
  pulse: ReturnType<typeof setTimeout> | null;
  pulseKey: ReturnType<typeof setTimeout> | null;
};

function startFirstPaint(onGlowClear: () => void, onPulseKey: () => void): Timers {
  const t: Timers = { glow: null, hint: null, pulse: null, pulseKey: null };
  t.glow = setTimeout(onGlowClear, TIMING.FIRST_PAINT_GLOW_MS);
  t.hint = setTimeout(() => {
    useEditorStore
      .getState()
      .setActiveContextualHint('Try painting — click anywhere on the model.');
  }, TIMING.HINT_DELAY_MS);
  t.pulse = setTimeout(() => {
    useEditorStore.getState().setPulseTarget('brush');
  }, TIMING.PULSE_DELAY_MS);
  t.pulseKey = setTimeout(() => {
    if (useEditorStore.getState().strokeActive) return;
    if (useEditorStore.getState().hasEditedSinceTemplate) return;
    onPulseKey();
  }, TIMING.FIRST_PAINT_PULSE_MS);
  return t;
}

function cancel(t: Timers): void {
  if (t.glow !== null) clearTimeout(t.glow);
  if (t.hint !== null) clearTimeout(t.hint);
  if (t.pulse !== null) clearTimeout(t.pulse);
  if (t.pulseKey !== null) clearTimeout(t.pulseKey);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('first-paint hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.setState({
      activeContextualHint: null,
      pulseTarget: null,
      strokeActive: false,
      hasEditedSinceTemplate: false,
      lastAppliedTemplateId: null,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('clears the glow indicator at FIRST_PAINT_GLOW_MS', () => {
    let glowCleared = false;
    const t = startFirstPaint(() => {
      glowCleared = true;
    }, () => {});
    expect(glowCleared).toBe(false);
    act(() => {
      vi.advanceTimersByTime(TIMING.FIRST_PAINT_GLOW_MS);
    });
    expect(glowCleared).toBe(true);
    cancel(t);
  });

  it('sets contextual hint at HINT_DELAY_MS', () => {
    const t = startFirstPaint(() => {}, () => {});
    expect(useEditorStore.getState().activeContextualHint).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TIMING.HINT_DELAY_MS);
    });
    expect(useEditorStore.getState().activeContextualHint).toBe(
      'Try painting — click anywhere on the model.',
    );
    cancel(t);
  });

  it('sets pulseTarget to brush at PULSE_DELAY_MS', () => {
    const t = startFirstPaint(() => {}, () => {});
    expect(useEditorStore.getState().pulseTarget).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TIMING.PULSE_DELAY_MS);
    });
    expect(useEditorStore.getState().pulseTarget).toBe('brush');
    cancel(t);
  });

  it('bumps the pulse key at FIRST_PAINT_PULSE_MS when no stroke fired', () => {
    let pulseKeyBumps = 0;
    const t = startFirstPaint(
      () => {},
      () => {
        pulseKeyBumps += 1;
      },
    );
    act(() => {
      vi.advanceTimersByTime(TIMING.FIRST_PAINT_PULSE_MS);
    });
    expect(pulseKeyBumps).toBe(1);
    cancel(t);
  });

  it('skips the pulse key when a stroke committed before t=1600ms', () => {
    let pulseKeyBumps = 0;
    const t = startFirstPaint(
      () => {},
      () => {
        pulseKeyBumps += 1;
      },
    );
    // User paints at t=900ms.
    act(() => {
      vi.advanceTimersByTime(900);
      useEditorStore.getState().markEdited();
    });
    act(() => {
      vi.advanceTimersByTime(TIMING.FIRST_PAINT_PULSE_MS - 900);
    });
    expect(pulseKeyBumps).toBe(0);
    cancel(t);
  });

  it('skips the pulse key when strokeActive === true at t=1600', () => {
    let pulseKeyBumps = 0;
    const t = startFirstPaint(
      () => {},
      () => {
        pulseKeyBumps += 1;
      },
    );
    act(() => {
      vi.advanceTimersByTime(TIMING.FIRST_PAINT_PULSE_MS - 100);
      useEditorStore.setState({ strokeActive: true });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(pulseKeyBumps).toBe(0);
    cancel(t);
  });

  it('cancelled timers no longer fire after cancel', () => {
    let glowCleared = false;
    let pulseKeyBumps = 0;
    const t = startFirstPaint(
      () => {
        glowCleared = true;
      },
      () => {
        pulseKeyBumps += 1;
      },
    );
    cancel(t);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(glowCleared).toBe(false);
    expect(pulseKeyBumps).toBe(0);
    expect(useEditorStore.getState().activeContextualHint).toBeNull();
    expect(useEditorStore.getState().pulseTarget).toBeNull();
  });
});
