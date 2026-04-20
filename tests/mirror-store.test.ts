// @vitest-environment jsdom
//
// M5 Unit 1 — mirrorEnabled store slot + narrow-selector contract.
// Mirrors tests/hover-store.test.ts's Profiler skeleton.

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
  useEditorStore.setState({ mirrorEnabled: false });
});

describe('mirrorEnabled store slot', () => {
  it('default state is false', () => {
    expect(useEditorStore.getState().mirrorEnabled).toBe(false);
  });

  it('setMirrorEnabled flips the boolean', () => {
    const { setMirrorEnabled } = useEditorStore.getState();
    setMirrorEnabled(true);
    expect(useEditorStore.getState().mirrorEnabled).toBe(true);
    setMirrorEnabled(false);
    expect(useEditorStore.getState().mirrorEnabled).toBe(false);
  });

  it('toggleMirror flips false → true → false', () => {
    const { toggleMirror } = useEditorStore.getState();
    toggleMirror();
    expect(useEditorStore.getState().mirrorEnabled).toBe(true);
    toggleMirror();
    expect(useEditorStore.getState().mirrorEnabled).toBe(false);
  });

  it('identity guard: setMirrorEnabled(false) when already false is a no-op', () => {
    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => { renderCount += 1; };

    function Consumer() {
      useEditorStore((s) => s.mirrorEnabled);
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
      useEditorStore.getState().setMirrorEnabled(false);
    });
    expect(renderCount).toBe(1);
  });

  it('narrow selector: unrelated mutation does not re-render', () => {
    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => { renderCount += 1; };

    function Consumer() {
      useEditorStore((s) => s.mirrorEnabled);
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
      useEditorStore.setState({ brushSize: 3 });
    });
    expect(renderCount).toBe(1);
  });
});
