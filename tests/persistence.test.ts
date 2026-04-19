// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock idb-keyval at module level so every import of the module under test
// gets the same spy references. The factory runs before any imports below.
const setSpy = vi.fn<(key: string, value: unknown) => Promise<void>>();
const getSpy = vi.fn<(key: string) => Promise<unknown>>();
vi.mock('idb-keyval', () => ({
  set: (k: string, v: unknown) => setSpy(k, v),
  get: (k: string) => getSpy(k),
}));

import { initPersistence, loadDocument, markDocumentDirty } from '../lib/editor/persistence';
import { useEditorStore } from '../lib/editor/store';
import type { Layer, SkinDocument } from '../lib/editor/types';

const mockLayer: Layer = {
  id: 'test',
  name: 'test',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  pixels: new Uint8ClampedArray(64 * 64 * 4),
};

const mockDocument: SkinDocument = {
  id: 'm3-default',
  variant: 'classic',
  layers: [mockLayer],
  activeLayerId: 'test',
  createdAt: 1000,
  updatedAt: 1000,
};

describe('persistence', () => {
  beforeEach(() => {
    setSpy.mockReset();
    getSpy.mockReset();
    useEditorStore.setState({ savingState: 'pending', variant: 'classic' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. Probe success → savingState: pending → enabled ─────────────────

  it('probe success transitions savingState from pending to enabled', async () => {
    setSpy.mockResolvedValue(undefined);

    const cleanup = initPersistence({ getLayer: () => mockLayer });

    // Flush the probe IIFE microtask chain.
    await Promise.resolve();
    await Promise.resolve();

    expect(useEditorStore.getState().savingState).toBe('enabled');

    cleanup();
  });

  // ── 2. Probe failure → savingState: pending → disabled:private ─────────

  it('probe failure transitions savingState from pending to disabled:private', async () => {
    setSpy.mockRejectedValue(new Error('IDB unavailable'));

    const cleanup = initPersistence({ getLayer: () => mockLayer });

    await Promise.resolve();
    await Promise.resolve();

    expect(useEditorStore.getState().savingState).toBe('disabled:private');

    cleanup();
  });

  // ── 3. Write dropped during 'pending' until probe resolves ─────────────

  it('markDocumentDirty during probe does not call set until probe resolves', async () => {
    vi.useFakeTimers();

    // We need to control when the probe resolves. Use a deferred promise.
    let resolveProbe!: () => void;
    const probeGate = new Promise<void>((res) => { resolveProbe = res; });
    setSpy.mockImplementation(() => probeGate);

    initPersistence({ getLayer: () => mockLayer });

    // Call markDocumentDirty before the probe has had a chance to resolve.
    markDocumentDirty();

    // Advance timers well past DEBOUNCE_MS to confirm no extra set fired yet.
    await vi.advanceTimersByTimeAsync(600);

    // Only the probe call should have been attempted so far (it's still pending).
    // setSpy was called once for the probe, and that promise hasn't resolved yet.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe('skin-editor:storage-probe');

    // Now let the probe resolve. Switch the mock to a simple resolver so the
    // document write (scheduled by dirtyWhilePending) can also succeed.
    setSpy.mockResolvedValue(undefined);
    resolveProbe();

    // Let the probe resolution microtasks settle (sets savingState → enabled,
    // then calls scheduleWrite which sets a 500ms debounce timer).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Advance past the debounce so the actual document write fires.
    await vi.advanceTimersByTimeAsync(600);

    // Now setSpy should have been called a second time for the document write.
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(setSpy.mock.calls[1][0]).toBe('skin-editor:m3-document');

    useEditorStore.setState({ savingState: 'pending' });
  });

  // ── 4. QuotaExceededError on write → savingState: disabled:quota ────────

  it('QuotaExceededError on document write flips savingState to disabled:quota', async () => {
    vi.useFakeTimers();

    // Probe succeeds, subsequent writes reject with QuotaExceededError.
    let callCount = 0;
    setSpy.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve();
      return Promise.reject({ name: 'QuotaExceededError' });
    });

    const cleanup = initPersistence({ getLayer: () => mockLayer });

    // Let the probe resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(useEditorStore.getState().savingState).toBe('enabled');

    // Trigger a document write.
    markDocumentDirty();
    await vi.advanceTimersByTimeAsync(600);

    // Let the rejected write's catch handler run.
    await Promise.resolve();
    await Promise.resolve();

    expect(useEditorStore.getState().savingState).toBe('disabled:quota');

    cleanup();
  });

  // ── 5. Cleanup removes beforeunload listener ────────────────────────────

  it('cleanup calls removeEventListener with beforeunload', async () => {
    setSpy.mockResolvedValue(undefined);

    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');

    const cleanup = initPersistence({ getLayer: () => mockLayer });

    // Let probe settle so state is clean.
    await Promise.resolve();
    await Promise.resolve();

    cleanup();

    expect(removeListenerSpy).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function),
    );

    removeListenerSpy.mockRestore();
  });

  // ── 6. loadDocument returns null when no document is stored ─────────────

  it('loadDocument returns null when get() resolves undefined', async () => {
    getSpy.mockResolvedValue(undefined);

    const result = await loadDocument();

    expect(result).toBeNull();
  });

  // ── 7. loadDocument returns the saved document ──────────────────────────

  it('loadDocument returns the document when one is stored', async () => {
    getSpy.mockResolvedValue(mockDocument);

    const result = await loadDocument();

    expect(result).toEqual(mockDocument);
  });

  // ── 8. loadDocument catches get() errors and returns null ───────────────

  it('loadDocument returns null when get() rejects', async () => {
    getSpy.mockRejectedValue(new Error('IDB read failure'));

    const result = await loadDocument();

    expect(result).toBeNull();
  });

  // ── Edge: cleanup resets _scheduleWrite so markDocumentDirty is a no-op ─

  it('markDocumentDirty after cleanup does not schedule a new set call', async () => {
    vi.useFakeTimers();
    setSpy.mockResolvedValue(undefined);

    const cleanup = initPersistence({ getLayer: () => mockLayer });

    // Let probe resolve.
    await Promise.resolve();
    await Promise.resolve();

    cleanup();

    // markDocumentDirty after cleanup should be a no-op.
    markDocumentDirty();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();

    // Only the probe set() call; no document write.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe('skin-editor:storage-probe');
  });

  // ── Edge: getLayer returning null skips the write ─────────────────────

  it('attemptWrite is a no-op when getLayer returns null', async () => {
    vi.useFakeTimers();
    setSpy.mockResolvedValue(undefined);

    const cleanup = initPersistence({ getLayer: () => null });

    // Let probe resolve → savingState: enabled.
    await Promise.resolve();
    await Promise.resolve();
    expect(useEditorStore.getState().savingState).toBe('enabled');

    markDocumentDirty();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();

    // Only the probe set(); the document write is skipped because layer is null.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe('skin-editor:storage-probe');

    cleanup();
  });
});
