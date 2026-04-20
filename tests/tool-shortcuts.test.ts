// @vitest-environment jsdom
//
// M5 Unit 7 — Toolbar keyboard shortcuts.

import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { flushSync } from 'react-dom';

import { Toolbar } from '../app/editor/_components/Toolbar';
import { useEditorStore } from '../lib/editor/store';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => {
    root!.render(createElement(Toolbar));
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
  useEditorStore.setState({ activeTool: 'pencil', mirrorEnabled: false });
});

function dispatchKey(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

describe('Toolbar keyboard shortcuts', () => {
  it('B → pencil', () => {
    mount();
    useEditorStore.setState({ activeTool: 'bucket' });
    dispatchKey('b');
    expect(useEditorStore.getState().activeTool).toBe('pencil');
  });

  it('E → eraser', () => {
    mount();
    dispatchKey('e');
    expect(useEditorStore.getState().activeTool).toBe('eraser');
  });

  it('I → picker', () => {
    mount();
    dispatchKey('i');
    expect(useEditorStore.getState().activeTool).toBe('picker');
  });

  it('G → bucket', () => {
    mount();
    dispatchKey('g');
    expect(useEditorStore.getState().activeTool).toBe('bucket');
  });

  it('M toggles mirrorEnabled', () => {
    mount();
    expect(useEditorStore.getState().mirrorEnabled).toBe(false);
    dispatchKey('m');
    expect(useEditorStore.getState().mirrorEnabled).toBe(true);
    dispatchKey('m');
    expect(useEditorStore.getState().mirrorEnabled).toBe(false);
  });

  it('uppercase E still fires eraser', () => {
    mount();
    dispatchKey('E');
    expect(useEditorStore.getState().activeTool).toBe('eraser');
  });

  it('Cmd+B does not swap tool', () => {
    mount();
    useEditorStore.setState({ activeTool: 'bucket' });
    dispatchKey('b', { metaKey: true });
    expect(useEditorStore.getState().activeTool).toBe('bucket');
  });

  it('Ctrl+E does not swap tool', () => {
    mount();
    dispatchKey('e', { ctrlKey: true });
    expect(useEditorStore.getState().activeTool).toBe('pencil');
  });

  it('Alt+I does not swap tool (Alt is the picker modifier)', () => {
    mount();
    dispatchKey('i', { altKey: true });
    expect(useEditorStore.getState().activeTool).toBe('pencil');
  });

  it('shortcut does not fire when focus is in INPUT', () => {
    mount();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    // Dispatch targeting the input element so e.target.tagName === 'INPUT'.
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'e', bubbles: true }),
      );
    });
    expect(useEditorStore.getState().activeTool).toBe('pencil');
    document.body.removeChild(input);
  });

  it('shortcut does not fire when focus is in role=application', () => {
    mount();
    const app = document.createElement('div');
    app.setAttribute('role', 'application');
    app.tabIndex = 0;
    document.body.appendChild(app);
    app.focus();
    act(() => {
      app.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'g', bubbles: true }),
      );
    });
    expect(useEditorStore.getState().activeTool).toBe('pencil');
    document.body.removeChild(app);
  });

  it('mirror button aria-pressed reflects mirrorEnabled', () => {
    mount();
    const btn = container!.querySelector('[data-testid="tool-mirror"]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      dispatchKey('m');
    });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});
