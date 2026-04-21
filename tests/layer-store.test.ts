// @vitest-environment jsdom
//
// M6 Unit 1 — layer store actions + narrow-selector contract.

import { createElement, Profiler, act, type ProfilerOnRenderCallback } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { useEditorStore } from '../lib/editor/store';
import type { Layer } from '../lib/editor/types';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(tree: React.ReactNode): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => {
    root!.render(tree);
  });
}

function unmount(): void {
  flushSync(() => {
    root?.unmount();
  });
  if (container !== null) document.body.removeChild(container);
  root = null;
  container = null;
}

function mkLayer(id: string, name = id): Layer {
  return {
    id,
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels: new Uint8ClampedArray(64 * 64 * 4),
  };
}

beforeEach(() => {
  useEditorStore.setState({ layers: [], activeLayerId: '', strokeActive: false });
});

afterEach(() => {
  unmount();
  useEditorStore.setState({ layers: [], activeLayerId: '', strokeActive: false });
});

describe('setLayers + setActiveLayerId', () => {
  it('setLayers replaces the array and preserves activeLayerId if it exists', () => {
    const a = mkLayer('a');
    const b = mkLayer('b');
    const { setLayers, setActiveLayerId } = useEditorStore.getState();
    setLayers([a, b]);
    setActiveLayerId('a');
    setLayers([a, b, mkLayer('c')]);
    expect(useEditorStore.getState().activeLayerId).toBe('a');
  });

  it('setLayers drops an active id that no longer exists and picks the top layer', () => {
    const a = mkLayer('a');
    const b = mkLayer('b');
    const { setLayers, setActiveLayerId } = useEditorStore.getState();
    setLayers([a, b]);
    setActiveLayerId('b');
    setLayers([mkLayer('c'), mkLayer('d')]);
    expect(useEditorStore.getState().activeLayerId).toBe('d');
  });
});

describe('addLayer', () => {
  it('appends and sets active', () => {
    const { addLayer } = useEditorStore.getState();
    const id = addLayer(mkLayer('x'));
    expect(id).toBe('x');
    expect(useEditorStore.getState().layers).toHaveLength(1);
    expect(useEditorStore.getState().activeLayerId).toBe('x');
  });
});

describe('deleteLayer', () => {
  it('removes and returns {layer, index}', () => {
    const { setLayers, setActiveLayerId, deleteLayer } = useEditorStore.getState();
    setLayers([mkLayer('a'), mkLayer('b'), mkLayer('c')]);
    setActiveLayerId('b');
    const removed = deleteLayer('b');
    expect(removed).not.toBeNull();
    expect(removed!.index).toBe(1);
    expect(removed!.layer.id).toBe('b');
    expect(useEditorStore.getState().layers.map((l) => l.id)).toEqual(['a', 'c']);
    expect(useEditorStore.getState().activeLayerId).toBe('c'); // same index → next layer
  });

  it('refuses to delete the last layer and returns null', () => {
    const { setLayers, setActiveLayerId, deleteLayer } = useEditorStore.getState();
    setLayers([mkLayer('only')]);
    setActiveLayerId('only');
    expect(deleteLayer('only')).toBeNull();
    expect(useEditorStore.getState().layers).toHaveLength(1);
  });

  it('returns null for unknown id', () => {
    const { setLayers, deleteLayer } = useEditorStore.getState();
    setLayers([mkLayer('a'), mkLayer('b')]);
    expect(deleteLayer('nope')).toBeNull();
  });
});

describe('insertLayerAt', () => {
  it('restores a layer at the given index', () => {
    const { setLayers, insertLayerAt } = useEditorStore.getState();
    setLayers([mkLayer('a'), mkLayer('c')]);
    insertLayerAt(mkLayer('b'), 1);
    expect(useEditorStore.getState().layers.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('clamps out-of-range indexes', () => {
    const { setLayers, insertLayerAt } = useEditorStore.getState();
    setLayers([mkLayer('a')]);
    insertLayerAt(mkLayer('b'), 99);
    expect(useEditorStore.getState().layers.map((l) => l.id)).toEqual(['a', 'b']);
  });
});

describe('reorderLayers', () => {
  it('moves from → to', () => {
    const { setLayers, reorderLayers } = useEditorStore.getState();
    setLayers([mkLayer('a'), mkLayer('b'), mkLayer('c')]);
    reorderLayers(0, 2);
    expect(useEditorStore.getState().layers.map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });

  it('no-ops when from === to', () => {
    const { setLayers, reorderLayers } = useEditorStore.getState();
    const initial = [mkLayer('a'), mkLayer('b')];
    setLayers(initial);
    const before = useEditorStore.getState().layers;
    reorderLayers(1, 1);
    expect(useEditorStore.getState().layers).toBe(before);
  });

  it('ignores out-of-range args', () => {
    const { setLayers, reorderLayers } = useEditorStore.getState();
    setLayers([mkLayer('a'), mkLayer('b')]);
    const before = useEditorStore.getState().layers;
    reorderLayers(5, 0);
    expect(useEditorStore.getState().layers).toBe(before);
  });
});

describe('renameLayer', () => {
  it('updates name', () => {
    const { setLayers, renameLayer } = useEditorStore.getState();
    setLayers([mkLayer('a', 'First')]);
    renameLayer('a', 'Named');
    expect(useEditorStore.getState().layers[0].name).toBe('Named');
  });

  it('rejects empty string (no-op)', () => {
    const { setLayers, renameLayer } = useEditorStore.getState();
    setLayers([mkLayer('a', 'First')]);
    const before = useEditorStore.getState().layers;
    renameLayer('a', '');
    expect(useEditorStore.getState().layers).toBe(before);
  });
});

describe('setLayerOpacity / setLayerBlendMode / setLayerVisible', () => {
  it('opacity clamps to [0, 1]', () => {
    const { setLayers, setLayerOpacity } = useEditorStore.getState();
    setLayers([mkLayer('a')]);
    setLayerOpacity('a', 1.5);
    expect(useEditorStore.getState().layers[0].opacity).toBe(1);
    setLayerOpacity('a', -0.2);
    expect(useEditorStore.getState().layers[0].opacity).toBe(0);
    setLayerOpacity('a', 0.5);
    expect(useEditorStore.getState().layers[0].opacity).toBe(0.5);
  });

  it('blendMode update', () => {
    const { setLayers, setLayerBlendMode } = useEditorStore.getState();
    setLayers([mkLayer('a')]);
    setLayerBlendMode('a', 'multiply');
    expect(useEditorStore.getState().layers[0].blendMode).toBe('multiply');
  });

  it('visible toggle', () => {
    const { setLayers, setLayerVisible } = useEditorStore.getState();
    setLayers([mkLayer('a')]);
    setLayerVisible('a', false);
    expect(useEditorStore.getState().layers[0].visible).toBe(false);
  });

  it('same-value is a no-op (identity preserved)', () => {
    const { setLayers, setLayerOpacity } = useEditorStore.getState();
    setLayers([mkLayer('a')]);
    const before = useEditorStore.getState().layers;
    setLayerOpacity('a', 1); // default is already 1
    expect(useEditorStore.getState().layers).toBe(before);
  });
});

describe('setStrokeActive', () => {
  it('identity-guarded', () => {
    const { setStrokeActive } = useEditorStore.getState();
    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => { renderCount += 1; };

    function Consumer() {
      useEditorStore((s) => s.strokeActive);
      return null;
    }

    mount(
      createElement(Profiler, { id: 't', onRender }, createElement(Consumer)),
    );
    expect(renderCount).toBe(1);

    act(() => { setStrokeActive(false); });
    expect(renderCount).toBe(1); // same value, no re-render

    act(() => { setStrokeActive(true); });
    expect(renderCount).toBe(2);
  });
});

describe('narrow-selector: LayerPanel row subscriber does not re-render on unrelated mutation', () => {
  it('subscribing to one layer by id does not re-render on brushSize change', () => {
    const a = mkLayer('a');
    useEditorStore.setState({ layers: [a], activeLayerId: 'a' });

    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => { renderCount += 1; };

    function Row() {
      useEditorStore((s) => s.layers.find((l) => l.id === 'a'));
      return null;
    }

    mount(createElement(Profiler, { id: 't', onRender }, createElement(Row)));
    expect(renderCount).toBe(1);

    act(() => { useEditorStore.setState({ brushSize: 3 }); });
    expect(renderCount).toBe(1);
  });
});
