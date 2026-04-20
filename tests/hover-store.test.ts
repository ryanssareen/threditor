// @vitest-environment jsdom
import { createElement, Profiler, act, type ProfilerOnRenderCallback } from 'react';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { useEditorStore } from '../lib/editor/store';

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

afterEach(() => {
  unmount();
  useEditorStore.setState({ hoveredPixel: null });
});

describe('hoveredPixel store slot', () => {
  it('happy path: setHoveredPixel round-trip', () => {
    const { setHoveredPixel } = useEditorStore.getState();

    setHoveredPixel({ x: 10, y: 20, target: 'base' });
    expect(useEditorStore.getState().hoveredPixel).toEqual({ x: 10, y: 20, target: 'base' });

    setHoveredPixel(null);
    expect(useEditorStore.getState().hoveredPixel).toBeNull();
  });

  it('happy path: target field flip preserves coords', () => {
    const { setHoveredPixel } = useEditorStore.getState();

    setHoveredPixel({ x: 10, y: 20, target: 'base' });
    setHoveredPixel({ x: 10, y: 20, target: 'overlay' });

    const state = useEditorStore.getState().hoveredPixel;
    expect(state).toEqual({ x: 10, y: 20, target: 'overlay' });
  });

  it('edge: null-when-already-null is a no-op (identity guard)', () => {
    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => { renderCount += 1; };

    function Consumer() {
      useEditorStore((s) => s.hoveredPixel);
      return null;
    }

    mount(
      createElement(
        Profiler,
        { id: 'test', onRender },
        createElement(Consumer),
      ),
    );
    expect(renderCount).toBe(1);

    act(() => {
      useEditorStore.getState().setHoveredPixel(null);
    });

    expect(renderCount).toBe(1);
  });

  it('narrow selector: subscribing to target only — coord-only change does not re-render', () => {
    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => { renderCount += 1; };

    function Consumer() {
      useEditorStore((s) => s.hoveredPixel?.target ?? null);
      return null;
    }

    mount(
      createElement(
        Profiler,
        { id: 'test', onRender },
        createElement(Consumer),
      ),
    );
    expect(renderCount).toBe(1);

    act(() => {
      useEditorStore.getState().setHoveredPixel({ x: 10, y: 20, target: 'base' });
    });
    expect(renderCount).toBe(2);

    act(() => {
      useEditorStore.getState().setHoveredPixel({ x: 15, y: 25, target: 'base' });
    });
    expect(renderCount).toBe(2);
  });

  it('narrow selector: unrelated store mutation does not re-render', () => {
    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => { renderCount += 1; };

    function Consumer() {
      useEditorStore((s) => s.hoveredPixel);
      return null;
    }

    mount(
      createElement(
        Profiler,
        { id: 'test', onRender },
        createElement(Consumer),
      ),
    );
    expect(renderCount).toBe(1);

    act(() => {
      useEditorStore.setState({ brushSize: 2 });
    });
    expect(renderCount).toBe(1);
  });
});
