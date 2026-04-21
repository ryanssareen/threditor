// @vitest-environment jsdom
/**
 * M7 Unit 5 — TemplateGate component tests.
 *
 * Uses fake timers to control CHIP_DELAY_MS without real-time waits.
 * The gate state is hoisted via useTemplateGate; here we exercise the
 * component indirectly by rendering a minimal EditorLayout-like harness
 * that owns state + passes it down to TemplateGate.
 */

import { act, createElement, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TIMING } from '../lib/editor/templates';
import { useEditorStore } from '../lib/editor/store';
import { gateInitial, gateNext, type GateState, type GateEvent } from '../lib/editor/template-gate-state';
import { TemplateGate } from '../app/editor/_components/TemplateGate';
import type { TemplateMeta } from '../lib/editor/types';

// @ts-expect-error — jsdom-react environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ─── Canvas / ImageData stubs (copied from use-texture-manager-seed pattern) ──

beforeAll(() => {
  vi.stubGlobal(
    'ImageData',
    class {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    },
  );
  HTMLCanvasElement.prototype.getContext = function mockGetContext() {
    return {
      imageSmoothingEnabled: true,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      clearRect: () => {},
      fillRect: () => {},
      putImageData: () => {},
      drawImage: () => {},
      getImageData: () => ({
        data: new Uint8ClampedArray(64 * 64 * 4).fill(80),
        width: 64,
        height: 64,
      }),
    } as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement['getContext'];

  // createImageBitmap stub.
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({}));
});

// ─── Harness component ────────────────────────────────────────────────────

type HarnessProps = {
  dismissed: boolean;
  hasEdited: boolean;
  hydrationPending: boolean;
  onApply?: (t: TemplateMeta, p: Uint8ClampedArray) => void;
};

function Harness({ dismissed, hasEdited, hydrationPending, onApply }: HarnessProps) {
  const [state, dispatch] = useReducer(
    gateNext,
    undefined,
    () => gateInitial(dismissed, hasEdited, hydrationPending),
  );
  // Expose dispatch + state to tests via a dom attribute trick.
  const [hydration, setHydration] = useState(hydrationPending);
  void setHydration; // may be used by tests that flip hydration

  return createElement(TemplateGate, {
    state,
    dispatch,
    onApplyTemplate: onApply ?? (() => {}),
    hydrationPending: hydration,
  });
}

// ─── Mount helpers ───────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function mount(node: React.ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });
}

async function unmount(): Promise<void> {
  await act(async () => { root.unmount(); });
  document.body.removeChild(container);
}

function $q(testid: string): Element | null {
  return container.querySelector(`[data-testid="${testid}"]`);
}

function resetStore(): void {
  useEditorStore.setState({ hasEditedSinceTemplate: false });
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('TemplateGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    // Stub fetch per-test so restoreAllMocks in afterEach doesn't drop it.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));
  });

  afterEach(async () => {
    try { await unmount(); } catch { /* already unmounted */ }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('chip renders after CHIP_DELAY_MS timer elapses (dismissed=false, hasEdited=false)', async () => {
    await mount(createElement(Harness, { dismissed: false, hasEdited: false, hydrationPending: false }));

    // Before timer: chip should NOT be present.
    expect($q('template-chip')).toBeNull();

    // Advance past the chip delay.
    await act(async () => {
      vi.advanceTimersByTime(TIMING.CHIP_DELAY_MS + 10);
    });

    expect($q('template-chip')).not.toBeNull();
  });

  it('chip renders on FIRST_STROKE before timer (store flip)', async () => {
    await mount(createElement(Harness, { dismissed: false, hasEdited: false, hydrationPending: false }));

    expect($q('template-chip')).toBeNull();

    // Flip hasEditedSinceTemplate false → true (simulates first stroke).
    await act(async () => {
      useEditorStore.getState().markEdited();
    });

    expect($q('template-chip')).not.toBeNull();
  });

  it('dismissed=true → chip never renders even after timer', async () => {
    await mount(createElement(Harness, { dismissed: true, hasEdited: false, hydrationPending: false }));

    await act(async () => {
      vi.advanceTimersByTime(TIMING.CHIP_DELAY_MS + 100);
    });

    expect($q('template-chip')).toBeNull();
  });

  it('hasEdited=true → chip never renders (returning user path)', async () => {
    await mount(createElement(Harness, { dismissed: false, hasEdited: true, hydrationPending: false }));

    await act(async () => {
      vi.advanceTimersByTime(TIMING.CHIP_DELAY_MS + 100);
    });

    expect($q('template-chip')).toBeNull();
  });

  it('hydrationPending=true → timer does NOT start; chip stays hidden', async () => {
    await mount(createElement(Harness, { dismissed: false, hasEdited: false, hydrationPending: true }));

    await act(async () => {
      vi.advanceTimersByTime(TIMING.CHIP_DELAY_MS + 100);
    });

    // Timer should not have fired because hydration is still pending.
    expect($q('template-chip')).toBeNull();
  });

  it('unmount during timer → no errors', async () => {
    await mount(createElement(Harness, { dismissed: false, hasEdited: false, hydrationPending: false }));

    // Unmount before timer fires — should not throw.
    await expect(unmount()).resolves.not.toThrow();

    // Advance timer after unmount — should not cause state-update errors.
    await act(async () => {
      vi.advanceTimersByTime(TIMING.CHIP_DELAY_MS + 10);
    });

    // Already unmounted so this is just confirming no crash.
    expect(true).toBe(true);
  });
});
