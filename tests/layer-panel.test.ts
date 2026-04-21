// @vitest-environment jsdom
//
// M6 Unit 6 — LayerPanel component tests.
//
// Uses the same no-act mount/unmount pattern as color-picker-selectors.test.ts
// to avoid React 19 act-compat fallout.

import { act, createElement, Profiler, type ProfilerOnRenderCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { LayerPanel, type LayerLifecycleCommand } from '../app/editor/_components/LayerPanel';
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

function $(testid: string): HTMLElement {
  const el = container!.querySelector(`[data-testid="${testid}"]`);
  if (el === null) throw new Error(`No element with data-testid="${testid}"`);
  return el as HTMLElement;
}

function $$(selector: string): HTMLElement[] {
  return Array.from(container!.querySelectorAll(selector)) as HTMLElement[];
}

function click(el: HTMLElement): void {
  flushSync(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function dblclick(el: HTMLElement): void {
  flushSync(() => {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}

function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  // React tracks a synthetic _valueTracker to suppress spurious onChange.
  // Assigning via the native prototype setter keeps tracker + value in sync.
  const proto =
    el instanceof HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
}

function change(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  flushSync(() => {
    setNativeValue(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function keydown(el: HTMLElement, key: string): void {
  flushSync(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function pointer(el: HTMLElement, type: 'pointerdown' | 'pointerup'): void {
  flushSync(() => {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  useEditorStore.setState({
    layers: [makeLayer()],
    activeLayerId: 'base',
  });
});

afterEach(() => {
  if (root !== null) unmount();
  useEditorStore.setState({
    layers: [],
    activeLayerId: '',
    strokeActive: false,
  });
});

describe('LayerPanel', () => {
  it('renders one row for the initial single layer and marks it active', () => {
    mount(createElement(LayerPanel));

    const row = $('layer-row-base');
    expect(row.dataset.active).toBe('true');

    const rows = $$('[data-testid^="layer-row-"]');
    expect(rows).toHaveLength(1);
  });

  it('clicking + adds a new layer, makes it active, and pushes a layer-add command', () => {
    const pushes: LayerLifecycleCommand[] = [];
    mount(createElement(LayerPanel, { onUndoPush: (c) => pushes.push(c) }));

    click($('layer-add'));

    const state = useEditorStore.getState();
    expect(state.layers).toHaveLength(2);
    // New layer is active.
    expect(state.activeLayerId).toBe(state.layers[1].id);

    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ kind: 'layer-add', insertedAt: 1 });
  });

  it('double-click name → input → Enter commits rename + pushes layer-rename', () => {
    const pushes: LayerLifecycleCommand[] = [];
    mount(createElement(LayerPanel, { onUndoPush: (c) => pushes.push(c) }));

    dblclick($('layer-name-base'));

    const input = $('layer-name-input-base') as HTMLInputElement;
    change(input, 'Renamed');
    keydown(input, 'Enter');

    expect(useEditorStore.getState().layers[0].name).toBe('Renamed');
    expect(pushes).toMatchObject([
      { kind: 'layer-rename', id: 'base', before: 'Base', after: 'Renamed' },
    ]);
  });

  it('rename to empty string reverts (no store mutation, no undo push)', () => {
    const pushes: LayerLifecycleCommand[] = [];
    mount(createElement(LayerPanel, { onUndoPush: (c) => pushes.push(c) }));

    dblclick($('layer-name-base'));
    const input = $('layer-name-input-base') as HTMLInputElement;
    change(input, '   ');
    keydown(input, 'Enter');

    expect(useEditorStore.getState().layers[0].name).toBe('Base');
    expect(pushes).toHaveLength(0);
  });

  it('changing blend-mode fires setLayerBlendMode + layer-blend command', () => {
    const pushes: LayerLifecycleCommand[] = [];
    mount(createElement(LayerPanel, { onUndoPush: (c) => pushes.push(c) }));

    change($('layer-blend-base') as HTMLSelectElement, 'multiply');

    expect(useEditorStore.getState().layers[0].blendMode).toBe('multiply');
    expect(pushes).toMatchObject([
      { kind: 'layer-blend', id: 'base', before: 'normal', after: 'multiply' },
    ]);
  });

  it('clicking the eye toggles visibility + pushes layer-visibility', () => {
    const pushes: LayerLifecycleCommand[] = [];
    mount(createElement(LayerPanel, { onUndoPush: (c) => pushes.push(c) }));

    click($('layer-visibility-base'));

    expect(useEditorStore.getState().layers[0].visible).toBe(false);
    expect(pushes).toMatchObject([
      { kind: 'layer-visibility', id: 'base', before: true, after: false },
    ]);
  });

  it('opacity slider drag: pointerdown snapshots before, pointerup pushes one layer-opacity', () => {
    const pushes: LayerLifecycleCommand[] = [];
    mount(createElement(LayerPanel, { onUndoPush: (c) => pushes.push(c) }));

    const slider = $('layer-opacity-base') as HTMLInputElement;
    pointer(slider, 'pointerdown');
    change(slider, '42');
    change(slider, '30');
    pointer(slider, 'pointerup');

    expect(useEditorStore.getState().layers[0].opacity).toBeCloseTo(0.3, 2);
    expect(pushes).toMatchObject([
      { kind: 'layer-opacity', id: 'base', before: 1, after: 0.3 },
    ]);
  });

  it('up-arrow on active layer reorders array and pushes layer-reorder', () => {
    useEditorStore.setState({
      layers: [
        makeLayer({ id: 'a', name: 'A' }),
        makeLayer({ id: 'b', name: 'B' }),
      ],
      activeLayerId: 'a',
    });

    const pushes: LayerLifecycleCommand[] = [];
    mount(createElement(LayerPanel, { onUndoPush: (c) => pushes.push(c) }));

    // 'a' is at array index 0; up-arrow should move it to index 1.
    click($('layer-up-a'));

    expect(useEditorStore.getState().layers.map((l) => l.id)).toEqual(['b', 'a']);
    expect(pushes).toMatchObject([{ kind: 'layer-reorder', from: 0, to: 1 }]);
  });

  it('up-arrow on topmost layer is disabled', () => {
    useEditorStore.setState({
      layers: [makeLayer({ id: 'a' }), makeLayer({ id: 'b' })],
      activeLayerId: 'a',
    });
    mount(createElement(LayerPanel));

    const upOnTop = $('layer-up-b') as HTMLButtonElement;
    expect(upOnTop.disabled).toBe(true);
  });

  it('clicking inactive row activates it', () => {
    useEditorStore.setState({
      layers: [makeLayer({ id: 'a' }), makeLayer({ id: 'b' })],
      activeLayerId: 'a',
    });
    mount(createElement(LayerPanel));

    click($('layer-row-b'));

    expect(useEditorStore.getState().activeLayerId).toBe('b');
  });

  it('delete button is disabled when only one layer remains', () => {
    mount(createElement(LayerPanel));

    const del = $('layer-delete-base') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });

  it('delete on a multi-layer setup removes layer + pushes layer-delete', () => {
    useEditorStore.setState({
      layers: [makeLayer({ id: 'a' }), makeLayer({ id: 'b' })],
      activeLayerId: 'b',
    });

    const pushes: LayerLifecycleCommand[] = [];
    mount(createElement(LayerPanel, { onUndoPush: (c) => pushes.push(c) }));

    click($('layer-delete-b'));

    expect(useEditorStore.getState().layers.map((l) => l.id)).toEqual(['a']);
    expect(pushes).toMatchObject([{ kind: 'layer-delete', removedFrom: 1 }]);
  });

  it('opacity readout shown for inactive layers instead of slider', () => {
    useEditorStore.setState({
      layers: [
        makeLayer({ id: 'a', opacity: 0.75 }),
        makeLayer({ id: 'b' }),
      ],
      activeLayerId: 'b',
    });
    mount(createElement(LayerPanel));

    const readout = container!.querySelector('[data-testid="layer-opacity-readout-a"]');
    expect(readout?.textContent).toBe('75%');
    // Inactive should NOT render a slider.
    expect(container!.querySelector('[data-testid="layer-opacity-a"]')).toBeNull();
  });

  it('narrow-selector: changing brushSize does not re-render LayerPanel', () => {
    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      renderCount += 1;
    };

    mount(
      createElement(Profiler, { id: 'lp', onRender },
        createElement(LayerPanel),
      ),
    );

    const initial = renderCount;

    act(() => {
      useEditorStore.getState().setBrushSize(3);
    });

    expect(renderCount).toBe(initial);
  });
});

// Silence unused imports when noUnusedLocals is strict.
void vi;
