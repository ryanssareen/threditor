// @vitest-environment jsdom
//
// M6 Unit 7 — Cmd/Ctrl+Z + Cmd+Shift+Z shortcut integration.
//
// These tests drive the EditorLayout keydown handler logic directly: we
// re-create the same guards (focus, modifier, strokeActive) in a shared
// helper so the handler's contract is pinned even though EditorLayout
// itself depends on @react-three/fiber (which is expensive to mount in
// jsdom). The keydown logic is pure and well-specified.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UndoStack, writeLayerRegion, type EditorActions } from '../lib/editor/undo';
import { useEditorStore } from '../lib/editor/store';
import type { Layer } from '../lib/editor/types';

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'base',
    name: 'Base',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels: new Uint8ClampedArray(64 * 64 * 4),
    ...overrides,
  };
}

/**
 * Extracted copy of the EditorLayout keydown handler. If this logic
 * drifts in EditorLayout, this test will stop reflecting reality —
 * document that risk in the plan.
 */
function installShortcut(undoStack: UndoStack, actions: EditorActions) {
  const onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target !== null && target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (target.isContentEditable) return;
      if (target.getAttribute('role') === 'application') return;
    }

    const hasCmd = e.metaKey || e.ctrlKey;
    if (!hasCmd) return;
    if (e.metaKey && e.ctrlKey) return;
    if (e.altKey) return;

    const key = e.key.toLowerCase();
    if (key !== 'z') return;

    if (useEditorStore.getState().strokeActive) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    if (e.shiftKey) undoStack.redo(actions);
    else undoStack.undo(actions);
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

function buildActions(getLayers: () => Layer[], recomposite = vi.fn()): EditorActions {
  return {
    getLayers,
    setLayerPixelRegion: (layerId, bbox, region) => {
      writeLayerRegion(getLayers(), layerId, bbox, region);
    },
    insertLayerAt: (layer, index) => useEditorStore.getState().insertLayerAt(layer, index),
    deleteLayer: (id) => {
      useEditorStore.getState().deleteLayer(id);
    },
    reorderLayers: (from, to) => useEditorStore.getState().reorderLayers(from, to),
    setLayerName: (id, name) => useEditorStore.getState().renameLayer(id, name),
    setLayerOpacity: (id, o) => useEditorStore.getState().setLayerOpacity(id, o),
    setLayerBlendMode: (id, m) => useEditorStore.getState().setLayerBlendMode(id, m),
    setLayerVisible: (id, v) => useEditorStore.getState().setLayerVisible(id, v),
    recomposite,
    strokeActive: () => useEditorStore.getState().strokeActive,
    applyTemplateSnapshot: (snapshot) => {
      useEditorStore.getState().applyTemplateState(snapshot);
    },
  };
}

function dispatchKey(
  init: KeyboardEventInit & { target?: HTMLElement | null } = {},
): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  if (init.target) {
    init.target.dispatchEvent(ev);
  } else {
    window.dispatchEvent(ev);
  }
  return ev;
}

describe('undo-shortcut handler', () => {
  let teardown: () => void = () => {};
  let stack: UndoStack;
  let layer: Layer;

  beforeEach(() => {
    layer = makeLayer();
    useEditorStore.setState({
      layers: [layer],
      activeLayerId: 'base',
      strokeActive: false,
    });
    stack = new UndoStack();
  });

  afterEach(() => {
    teardown();
    useEditorStore.setState({
      layers: [],
      activeLayerId: '',
      strokeActive: false,
    });
  });

  it('Cmd+Z with a pushed stroke invokes undo and restores pixel before-state', () => {
    // Seed a stroke: before=zeros, after=42 at position (0, 0).
    const before = new Uint8ClampedArray(4); // all zeros
    const after = new Uint8ClampedArray([42, 42, 42, 42]);
    // Apply "after" to the layer so we can verify undo restores "before".
    layer.pixels.set(after, 0);

    stack.push({
      kind: 'stroke',
      stroke: {
        id: 'a',
        layerId: 'base',
        patches: [{ bbox: { x: 0, y: 0, w: 1, h: 1 }, before, after }],
        tool: 'pencil',
        mirrored: false,
      },
    });

    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));

    dispatchKey({ key: 'z', metaKey: true });

    // Pixel restored.
    expect(layer.pixels[0]).toBe(0);
  });

  it('Ctrl+Z on Linux/Windows works identically', () => {
    const before = new Uint8ClampedArray([0, 0, 0, 0]);
    const after = new Uint8ClampedArray([99, 99, 99, 99]);
    layer.pixels.set(after, 0);

    stack.push({
      kind: 'stroke',
      stroke: {
        id: 'a', layerId: 'base', tool: 'pencil', mirrored: false,
        patches: [{ bbox: { x: 0, y: 0, w: 1, h: 1 }, before, after }],
      },
    });

    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));

    dispatchKey({ key: 'z', ctrlKey: true });
    expect(layer.pixels[0]).toBe(0);
  });

  it('Cmd+Shift+Z redoes after an undo', () => {
    const before = new Uint8ClampedArray([0, 0, 0, 0]);
    const after = new Uint8ClampedArray([7, 7, 7, 7]);
    layer.pixels.set(after, 0);

    stack.push({
      kind: 'stroke',
      stroke: {
        id: 'a', layerId: 'base', tool: 'pencil', mirrored: false,
        patches: [{ bbox: { x: 0, y: 0, w: 1, h: 1 }, before, after }],
      },
    });

    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));

    dispatchKey({ key: 'z', metaKey: true }); // undo
    expect(layer.pixels[0]).toBe(0);

    dispatchKey({ key: 'z', metaKey: true, shiftKey: true }); // redo
    expect(layer.pixels[0]).toBe(7);
  });

  it('Cmd+Y does NOT trigger redo', () => {
    const spyUndo = vi.spyOn(stack, 'undo');
    const spyRedo = vi.spyOn(stack, 'redo');

    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));

    dispatchKey({ key: 'y', metaKey: true });

    expect(spyUndo).not.toHaveBeenCalled();
    expect(spyRedo).not.toHaveBeenCalled();
  });

  it('Alt+Cmd+Z is ignored (Alt blocks)', () => {
    const spyUndo = vi.spyOn(stack, 'undo');
    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));

    dispatchKey({ key: 'z', metaKey: true, altKey: true });
    expect(spyUndo).not.toHaveBeenCalled();
  });

  it('Cmd+Ctrl+Z is ignored (XOR guard)', () => {
    const spyUndo = vi.spyOn(stack, 'undo');
    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));

    dispatchKey({ key: 'z', metaKey: true, ctrlKey: true });
    expect(spyUndo).not.toHaveBeenCalled();
  });

  it('Cmd+Z inside an input is ignored', () => {
    const spyUndo = vi.spyOn(stack, 'undo');
    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    dispatchKey({ key: 'z', metaKey: true, target: input });

    expect(spyUndo).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('Cmd+Z during an active stroke is a no-op', () => {
    const spyUndo = vi.spyOn(stack, 'undo');
    useEditorStore.setState({ strokeActive: true });

    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));

    dispatchKey({ key: 'z', metaKey: true });
    expect(spyUndo).not.toHaveBeenCalled();
  });

  it('Cmd+Z with no history is a safe no-op', () => {
    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));
    expect(() => dispatchKey({ key: 'z', metaKey: true })).not.toThrow();
  });

  it('layer-add undo removes the just-added layer', () => {
    const newLayer = makeLayer({ id: 'added', name: 'added' });
    useEditorStore.getState().addLayer(newLayer);
    stack.push({ kind: 'layer-add', layer: newLayer, insertedAt: 1 });

    expect(useEditorStore.getState().layers).toHaveLength(2);

    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));
    dispatchKey({ key: 'z', metaKey: true });

    expect(useEditorStore.getState().layers).toHaveLength(1);
    expect(useEditorStore.getState().layers[0].id).toBe('base');
  });

  it('layer-delete undo restores the removed layer at its original index', () => {
    useEditorStore.setState({
      layers: [makeLayer({ id: 'a' }), makeLayer({ id: 'b' }), makeLayer({ id: 'c' })],
      activeLayerId: 'b',
    });
    const removed = useEditorStore.getState().deleteLayer('b');
    expect(removed).not.toBeNull();
    stack.push({ kind: 'layer-delete', layer: removed!.layer, removedFrom: removed!.index });

    expect(useEditorStore.getState().layers.map((l) => l.id)).toEqual(['a', 'c']);

    teardown = installShortcut(stack, buildActions(() => useEditorStore.getState().layers));
    dispatchKey({ key: 'z', metaKey: true });

    expect(useEditorStore.getState().layers.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('recomposite is invoked once per successful undo', () => {
    const before = new Uint8ClampedArray([0, 0, 0, 0]);
    const after = new Uint8ClampedArray([1, 2, 3, 4]);
    layer.pixels.set(after, 0);

    stack.push({
      kind: 'stroke',
      stroke: {
        id: 'a', layerId: 'base', tool: 'pencil', mirrored: false,
        patches: [{ bbox: { x: 0, y: 0, w: 1, h: 1 }, before, after }],
      },
    });

    const recomposite = vi.fn();
    teardown = installShortcut(
      stack,
      buildActions(() => useEditorStore.getState().layers, recomposite),
    );

    dispatchKey({ key: 'z', metaKey: true });
    expect(recomposite).toHaveBeenCalledTimes(1);
  });
});
