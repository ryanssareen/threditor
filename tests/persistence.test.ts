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

import { initPersistence, loadDocument } from '../lib/editor/persistence';
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

    const { cleanup } = initPersistence({ getLayers: () => [mockLayer], getActiveLayerId: () => mockLayer.id });

    // Flush the probe IIFE microtask chain.
    await Promise.resolve();
    await Promise.resolve();

    expect(useEditorStore.getState().savingState).toBe('enabled');

    cleanup();
  });

  // ── 2. Probe failure → savingState: pending → disabled:private ─────────

  it('probe failure transitions savingState from pending to disabled:private', async () => {
    setSpy.mockRejectedValue(new Error('IDB unavailable'));

    const { cleanup } = initPersistence({ getLayers: () => [mockLayer], getActiveLayerId: () => mockLayer.id });

    await Promise.resolve();
    await Promise.resolve();

    expect(useEditorStore.getState().savingState).toBe('disabled:private');

    cleanup();
  });

  // ── 3. Write dropped during 'pending' until probe resolves ─────────────

  it('markDirty during probe does not call set until probe resolves', async () => {
    vi.useFakeTimers();

    // We need to control when the probe resolves. Use a deferred promise.
    let resolveProbe!: () => void;
    const probeGate = new Promise<void>((res) => { resolveProbe = res; });
    setSpy.mockImplementation(() => probeGate);

    const { markDirty } = initPersistence({ getLayers: () => [mockLayer], getActiveLayerId: () => mockLayer.id });

    // Call markDirty before the probe has had a chance to resolve.
    markDirty();

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

    const { markDirty, cleanup } = initPersistence({ getLayers: () => [mockLayer], getActiveLayerId: () => mockLayer.id });

    // Let the probe resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(useEditorStore.getState().savingState).toBe('enabled');

    // Trigger a document write.
    markDirty();
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

    const { cleanup } = initPersistence({ getLayers: () => [mockLayer], getActiveLayerId: () => mockLayer.id });

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

  // ── Edge: markDirty after cleanup is a no-op (disposed flag) ────────────

  it('markDirty after cleanup does not schedule a new set call', async () => {
    vi.useFakeTimers();
    setSpy.mockResolvedValue(undefined);

    const { markDirty, cleanup } = initPersistence({ getLayers: () => [mockLayer], getActiveLayerId: () => mockLayer.id });

    // Let probe resolve.
    await Promise.resolve();
    await Promise.resolve();

    cleanup();

    // markDirty after cleanup should be a no-op (disposed flag set).
    markDirty();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();

    // Only the probe set() call; no document write.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe('skin-editor:storage-probe');
  });

  // ── Sequencing: initPersistence installed after hydration cannot overwrite ─

  it('write triggered before layer hydration captures blank pixels; after hydration captures saved pixels', async () => {
    vi.useFakeTimers();
    setSpy.mockResolvedValue(undefined);

    // Simulate a layer that starts blank then gets hydrated.
    const layer: Layer = {
      id: 'test', name: 'test', visible: true, opacity: 1, blendMode: 'normal',
      pixels: new Uint8ClampedArray(64 * 64 * 4), // all zeros = blank
    };

    // SCENARIO A: initPersistence installed BEFORE hydration.
    // The probe completes, then a write fires with blank pixels.
    const { markDirty: markDirtyA, cleanup: cleanupA } = initPersistence({ getLayers: () => [layer], getActiveLayerId: () => layer.id });
    await Promise.resolve(); await Promise.resolve(); // probe settles → 'enabled'
    markDirtyA();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();
    const docA = setSpy.mock.calls.find((c) => c[0] === 'skin-editor:m3-document')?.[1] as { layers: { pixels: Uint8ClampedArray }[] } | undefined;
    // All pixels are blank because hydration hasn't happened yet.
    expect(docA?.layers[0]?.pixels.every((v: number) => v === 0)).toBe(true);
    cleanupA();
    useEditorStore.setState({ savingState: 'pending' });
    setSpy.mockReset();
    setSpy.mockResolvedValue(undefined);

    // SCENARIO B: hydrate first, THEN install initPersistence.
    layer.pixels[0] = 42; // simulate hydrated pixel
    const { markDirty: markDirtyB, cleanup: cleanupB } = initPersistence({ getLayers: () => [layer], getActiveLayerId: () => layer.id });
    await Promise.resolve(); await Promise.resolve(); // probe settles → 'enabled'
    markDirtyB();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();
    const docB = setSpy.mock.calls.find((c) => c[0] === 'skin-editor:m3-document')?.[1] as { layers: { pixels: Uint8ClampedArray }[] } | undefined;
    // First pixel reflects the hydrated value.
    expect(docB?.layers[0]?.pixels[0]).toBe(42);
    cleanupB();
    useEditorStore.setState({ savingState: 'pending' });
  });

  // ── M6 Unit 5: N-layer persistence ───────────────────────────────────

  it('buildDocument writes all N layers with their metadata', async () => {
    vi.useFakeTimers();
    setSpy.mockResolvedValue(undefined);

    const layerA: Layer = {
      id: 'base', name: 'Base', visible: true, opacity: 1, blendMode: 'normal',
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };
    const layerB: Layer = {
      id: 'mid', name: 'Shading', visible: false, opacity: 0.5, blendMode: 'multiply',
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };
    const layerC: Layer = {
      id: 'top', name: 'Highlights', visible: true, opacity: 0.75, blendMode: 'screen',
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };
    // Pepper pixels so bit-identity is meaningful.
    layerA.pixels[0] = 1; layerA.pixels[64 * 64 * 4 - 1] = 255;
    layerB.pixels[100] = 42;
    layerC.pixels[500] = 7;

    const { markDirty, cleanup } = initPersistence({
      getLayers: () => [layerA, layerB, layerC],
      getActiveLayerId: () => 'mid',
    });

    await Promise.resolve(); await Promise.resolve();
    markDirty();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();

    const doc = setSpy.mock.calls.find((c) => c[0] === 'skin-editor:m3-document')?.[1] as SkinDocument | undefined;
    expect(doc).toBeDefined();
    expect(doc!.layers).toHaveLength(3);
    expect(doc!.activeLayerId).toBe('mid');

    // Bit-identity per layer.
    expect(doc!.layers[0].pixels[0]).toBe(1);
    expect(doc!.layers[0].pixels[64 * 64 * 4 - 1]).toBe(255);
    expect(doc!.layers[1].pixels[100]).toBe(42);
    expect(doc!.layers[2].pixels[500]).toBe(7);

    // Metadata round-trip.
    expect(doc!.layers[0]).toMatchObject({ id: 'base', name: 'Base', visible: true, opacity: 1, blendMode: 'normal' });
    expect(doc!.layers[1]).toMatchObject({ id: 'mid', name: 'Shading', visible: false, opacity: 0.5, blendMode: 'multiply' });
    expect(doc!.layers[2]).toMatchObject({ id: 'top', name: 'Highlights', visible: true, opacity: 0.75, blendMode: 'screen' });

    cleanup();
  });

  it('loadDocument returns a multi-layer document verbatim', async () => {
    const multi: SkinDocument = {
      id: 'm3-default',
      variant: 'slim',
      layers: [
        { ...mockLayer, id: 'l1', name: 'l1' },
        { ...mockLayer, id: 'l2', name: 'l2', opacity: 0.25, blendMode: 'overlay' },
      ],
      activeLayerId: 'l2',
      createdAt: 42,
      updatedAt: 99,
    };
    getSpy.mockResolvedValue(multi);

    const result = await loadDocument();

    expect(result).toEqual(multi);
    expect(result?.layers).toHaveLength(2);
    expect(result?.activeLayerId).toBe('l2');
  });

  it('loadDocument returns M3–M5 single-layer saves without modification', async () => {
    // Simulate a document written by M3/M5 (single layer, same shape).
    const legacy: SkinDocument = {
      id: 'm3-default',
      variant: 'classic',
      layers: [mockLayer],
      activeLayerId: mockLayer.id,
      createdAt: 1,
      updatedAt: 1,
    };
    getSpy.mockResolvedValue(legacy);

    const result = await loadDocument();

    expect(result).not.toBeNull();
    expect(result?.layers).toHaveLength(1);
    expect(result?.layers[0].id).toBe(mockLayer.id);
  });

  it('getLayers is evaluated at flush time, not install time (captures latest layer set)', async () => {
    vi.useFakeTimers();
    setSpy.mockResolvedValue(undefined);

    const initial: Layer[] = [mockLayer];
    let current: Layer[] = initial;

    const { markDirty, cleanup } = initPersistence({
      getLayers: () => current,
      getActiveLayerId: () => current[current.length - 1]?.id ?? '',
    });

    await Promise.resolve(); await Promise.resolve();

    // Swap to a 2-layer set before markDirty fires.
    current = [
      mockLayer,
      { ...mockLayer, id: 'added', name: 'added' },
    ];

    markDirty();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();

    const doc = setSpy.mock.calls.find((c) => c[0] === 'skin-editor:m3-document')?.[1] as SkinDocument | undefined;
    expect(doc?.layers).toHaveLength(2);
    expect(doc?.layers[1].id).toBe('added');
    expect(doc?.activeLayerId).toBe('added');

    cleanup();
  });

  // ── Edge: getLayer returning null skips the write ─────────────────────

  it('attemptWrite is a no-op when getLayer returns null', async () => {
    vi.useFakeTimers();
    setSpy.mockResolvedValue(undefined);

    const { markDirty, cleanup } = initPersistence({ getLayers: () => [], getActiveLayerId: () => "" });

    // Let probe resolve → savingState: enabled.
    await Promise.resolve();
    await Promise.resolve();
    expect(useEditorStore.getState().savingState).toBe('enabled');

    markDirty();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();

    // Only the probe set(); the document write is skipped because layer is null.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe('skin-editor:storage-probe');

    cleanup();
  });
});
