// @vitest-environment jsdom
/**
 * M7 Unit 8: persistence of template-aware flags.
 *
 * Covers:
 *   - Round-trip: write document with hasEditedSinceTemplate +
 *     lastAppliedTemplateId; read back identically.
 *   - Backward-compat: M3–M6 save (no template fields) loads with
 *     safe defaults (hasEdited=true, lastApplied=null).
 *   - Defensive: non-boolean / non-string drift → safe defaults.
 *   - Reload-mid-transition: apply template → write to IDB →
 *     simulate reload → confirm template state restored + hint/pulse
 *     default to null.
 *   - idb-keyval handles Uint8ClampedArray round-trip bit-identically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock idb-keyval per tests/persistence.test.ts convention.
const setSpy = vi.fn<(key: string, value: unknown) => Promise<void>>();
const getSpy = vi.fn<(key: string) => Promise<unknown>>();
vi.mock('idb-keyval', () => ({
  set: (k: string, v: unknown) => setSpy(k, v),
  get: (k: string) => getSpy(k),
}));

import {
  applyTemplate,
  cancelActiveTransition,
  type ApplyTemplateActions,
} from '../lib/editor/apply-template';
import { initPersistence, loadDocument } from '../lib/editor/persistence';
import { useEditorStore } from '../lib/editor/store';
import { UndoStack } from '../lib/editor/undo';
import type {
  ApplyTemplateSnapshot,
  Layer,
  SkinDocument,
  TemplateMeta,
} from '../lib/editor/types';

function mkLayer(id: string, fill: number): Layer {
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels: new Uint8ClampedArray(64 * 64 * 4).fill(fill),
  };
}

function mkTemplate(overrides: Partial<TemplateMeta> = {}): TemplateMeta {
  return {
    id: 'classic-hoodie',
    label: 'Classic Hoodie',
    variant: 'classic',
    file: '/templates/classic/classic-hoodie.png',
    thumbnail: '/templates/thumbs/classic-hoodie.png',
    license: 'MIT',
    credit: null,
    tags: ['hoodie'],
    contextualHint: 'Try a new color',
    affordancePulse: 'color',
    ...overrides,
  };
}

function resetStore(): void {
  useEditorStore.setState({
    variant: 'classic',
    layers: [mkLayer('base', 30)],
    activeLayerId: 'base',
    hasEditedSinceTemplate: false,
    lastAppliedTemplateId: null,
    activeContextualHint: null,
    pulseTarget: null,
    savingState: 'enabled',
  });
}

describe('persistence — M7 template flags', () => {
  beforeEach(() => {
    setSpy.mockReset();
    getSpy.mockReset();
    setSpy.mockResolvedValue(undefined);
    resetStore();
    cancelActiveTransition();
  });

  afterEach(() => {
    cancelActiveTransition();
    vi.useRealTimers();
  });

  it('loadDocument: round-trip of hasEditedSinceTemplate + lastAppliedTemplateId', async () => {
    const stored: SkinDocument = {
      id: 'm3-default',
      variant: 'classic',
      layers: [mkLayer('base', 10)],
      activeLayerId: 'base',
      createdAt: 1000,
      updatedAt: 2000,
      hasEditedSinceTemplate: false,
      lastAppliedTemplateId: 'shaded-hoodie',
    };
    getSpy.mockResolvedValueOnce(stored);

    const loaded = await loadDocument();
    expect(loaded).not.toBeNull();
    expect(loaded!.hasEditedSinceTemplate).toBe(false);
    expect(loaded!.lastAppliedTemplateId).toBe('shaded-hoodie');
  });

  it('backward-compat: M3–M6 save (no template fields) → safe defaults', async () => {
    // M3-era shape omits the M7 fields.
    const m3Doc = {
      id: 'm3-default',
      variant: 'classic',
      layers: [mkLayer('base', 20)],
      activeLayerId: 'base',
      createdAt: 500,
      updatedAt: 600,
    };
    getSpy.mockResolvedValueOnce(m3Doc);

    const loaded = await loadDocument();
    expect(loaded).not.toBeNull();
    expect(loaded!.hasEditedSinceTemplate).toBe(true);
    expect(loaded!.lastAppliedTemplateId).toBeNull();
  });

  it('defensive: non-boolean / non-string drift → safe defaults', async () => {
    const drift = {
      id: 'm3-default',
      variant: 'classic',
      layers: [mkLayer('base', 0)],
      activeLayerId: 'base',
      createdAt: 100,
      updatedAt: 200,
      hasEditedSinceTemplate: 'yes',
      lastAppliedTemplateId: 42,
    };
    getSpy.mockResolvedValueOnce(drift);

    const loaded = await loadDocument();
    expect(loaded!.hasEditedSinceTemplate).toBe(true);
    expect(loaded!.lastAppliedTemplateId).toBeNull();
  });

  it('loadDocument returns null when get resolves undefined', async () => {
    getSpy.mockResolvedValueOnce(undefined);
    const loaded = await loadDocument();
    expect(loaded).toBeNull();
  });

  it('initPersistence writes M7 fields via accessors', async () => {
    vi.useFakeTimers();
    useEditorStore.setState({
      hasEditedSinceTemplate: true,
      lastAppliedTemplateId: 'split-color',
      savingState: 'enabled',
    });

    const { markDirty, cleanup } = initPersistence({
      getLayers: () => useEditorStore.getState().layers,
      getActiveLayerId: () => useEditorStore.getState().activeLayerId,
      getHasEditedSinceTemplate: () =>
        useEditorStore.getState().hasEditedSinceTemplate,
      getLastAppliedTemplateId: () =>
        useEditorStore.getState().lastAppliedTemplateId,
    });

    // Let the probe microtask resolve (amendment 5 — the probe write
    // transitions state to 'enabled'). The probe key is stubbed by
    // setSpy which resolves undefined.
    await vi.runAllTimersAsync();
    markDirty();
    // Advance past the 500ms debounce.
    await vi.advanceTimersByTimeAsync(600);

    // The last setSpy call with the DOC_KEY is the document write.
    const docCalls = setSpy.mock.calls.filter(
      (c) => c[0] === 'skin-editor:m3-document',
    );
    expect(docCalls.length).toBeGreaterThan(0);
    const written = docCalls[docCalls.length - 1][1] as SkinDocument;
    expect(written.hasEditedSinceTemplate).toBe(true);
    expect(written.lastAppliedTemplateId).toBe('split-color');

    cleanup();
    vi.useRealTimers();
  });

  it('initPersistence defaults to true / null when accessors omitted (backward-compat)', async () => {
    vi.useFakeTimers();
    const { markDirty, cleanup } = initPersistence({
      getLayers: () => useEditorStore.getState().layers,
      getActiveLayerId: () => useEditorStore.getState().activeLayerId,
      // intentionally omit the two M7 accessors
    });

    await vi.runAllTimersAsync();
    markDirty();
    await vi.advanceTimersByTimeAsync(600);

    const docCalls = setSpy.mock.calls.filter(
      (c) => c[0] === 'skin-editor:m3-document',
    );
    expect(docCalls.length).toBeGreaterThan(0);
    const written = docCalls[docCalls.length - 1][1] as SkinDocument;
    // Safe defaults when accessors omitted.
    expect(written.hasEditedSinceTemplate).toBe(true);
    expect(written.lastAppliedTemplateId).toBeNull();

    cleanup();
    vi.useRealTimers();
  });

  it('reload-mid-transition: apply → IDB → reload → template restored, hint/pulse null', async () => {
    // Step 1: run applyTemplate on an in-memory harness so the
    // resulting state matches what the store would hold.
    const state = {
      layers: [mkLayer('base', 50)] as Layer[],
      activeLayerId: 'base',
      variant: 'classic' as 'classic' | 'slim',
      hasEditedSinceTemplate: true,
      lastAppliedTemplateId: null as string | null,
    };
    const applyActions: ApplyTemplateActions = {
      getLayers: () => state.layers,
      getActiveLayerId: () => state.activeLayerId,
      getVariant: () => state.variant,
      getHasEditedSinceTemplate: () => state.hasEditedSinceTemplate,
      getLastAppliedTemplateId: () => state.lastAppliedTemplateId,
      strokeActive: () => false,
      hydrationPending: () => false,
      applyTemplateSnapshot: (snap: ApplyTemplateSnapshot) => {
        state.layers = snap.layers;
        state.activeLayerId = snap.activeLayerId;
        state.variant = snap.variant;
        state.hasEditedSinceTemplate = snap.hasEditedSinceTemplate;
        state.lastAppliedTemplateId = snap.lastAppliedTemplateId;
      },
      recomposite: () => {},
      setActiveContextualHint: () => {},
      setPulseTarget: () => {},
      clearContextualHint: () => {},
    };
    const stack = new UndoStack();
    const result = applyTemplate(
      applyActions,
      (cmd) => stack.push(cmd),
      mkTemplate({ id: 'classic-hoodie', variant: 'classic' }),
      new Uint8ClampedArray(64 * 64 * 4).fill(200),
      { skipTimeline: true },
    );
    expect(result.ok).toBe(true);
    expect(state.hasEditedSinceTemplate).toBe(false);
    expect(state.lastAppliedTemplateId).toBe('classic-hoodie');

    // Step 2: stage the post-apply state in a "stored" doc.
    const storedDoc: SkinDocument = {
      id: 'm3-default',
      variant: state.variant,
      layers: state.layers,
      activeLayerId: state.activeLayerId,
      createdAt: 1000,
      updatedAt: 1000,
      hasEditedSinceTemplate: state.hasEditedSinceTemplate,
      lastAppliedTemplateId: state.lastAppliedTemplateId,
    };
    getSpy.mockResolvedValueOnce(storedDoc);

    // Step 3: simulate reload — fresh transient slots, then
    // loadDocument, then replay EditorLayout's hydration mutation.
    useEditorStore.setState({
      activeContextualHint: null,
      pulseTarget: null,
    });
    const loaded = await loadDocument();
    expect(loaded).not.toBeNull();

    useEditorStore.setState({
      hasEditedSinceTemplate:
        typeof loaded!.hasEditedSinceTemplate === 'boolean'
          ? loaded!.hasEditedSinceTemplate
          : true,
      lastAppliedTemplateId:
        typeof loaded!.lastAppliedTemplateId === 'string'
          ? loaded!.lastAppliedTemplateId
          : null,
    });

    const post = useEditorStore.getState();
    expect(post.hasEditedSinceTemplate).toBe(false);
    expect(post.lastAppliedTemplateId).toBe('classic-hoodie');
    // Transient UI slots are NOT restored — mid-transition visual
    // state is not replayed on reload (plan §System-wide Impact).
    expect(post.activeContextualHint).toBeNull();
    expect(post.pulseTarget).toBeNull();
  });

  it('idb-keyval passes Uint8ClampedArray through without coercion', async () => {
    // DESIGN §12.5 M7 Compound callout: idb-keyval serializes typed
    // arrays via structured clone, preserving bytes + type. This
    // regression test locks the invariant in CI (the mock doesn't
    // clone, but the test asserts that loadDocument doesn't wrap /
    // coerce / transform the pixels buffer).
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7) & 0xff;

    const stored: SkinDocument = {
      id: 'm3-default',
      variant: 'classic',
      layers: [
        {
          id: 'template:test',
          name: 'Test',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          pixels,
        },
      ],
      activeLayerId: 'template:test',
      createdAt: 1,
      updatedAt: 2,
      hasEditedSinceTemplate: false,
      lastAppliedTemplateId: 'test',
    };
    getSpy.mockResolvedValueOnce(stored);

    const loaded = await loadDocument();
    expect(loaded).not.toBeNull();
    expect(loaded!.layers[0].pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(loaded!.layers[0].pixels.length).toBe(pixels.length);
    expect(loaded!.layers[0].pixels).toBe(pixels);
  });
});
