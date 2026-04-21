// @vitest-environment jsdom
/**
 * M7 Unit 7 — ContextualHintOverlay component tests.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '../lib/editor/store';
import { ContextualHintOverlay } from '../app/editor/_components/ContextualHintOverlay';

// @ts-expect-error — jsdom-react environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function resetStore() {
  useEditorStore.setState({ activeContextualHint: null });
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  resetStore();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  resetStore();
});

function render() {
  act(() => {
    root.render(createElement(ContextualHintOverlay));
  });
}

describe('ContextualHintOverlay', () => {
  it('renders nothing when hint is null', () => {
    render();
    expect(container.querySelector('[data-testid="contextual-hint"]')).toBeNull();
  });

  it('renders the bubble when hint is set', () => {
    render();
    act(() => {
      useEditorStore.getState().setActiveContextualHint('Try a new color');
    });
    const el = container.querySelector('[data-testid="contextual-hint"]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('Try a new color');
    expect(el?.getAttribute('role')).toBe('status');
    expect(el?.getAttribute('aria-live')).toBe('polite');
  });

  it('pointerdown after debounce clears the hint', async () => {
    vi.useFakeTimers();
    render();
    act(() => {
      useEditorStore.getState().setActiveContextualHint('Paint your skin');
    });
    expect(container.querySelector('[data-testid="contextual-hint"]')).not.toBeNull();

    // Advance past the 100ms debounce
    act(() => {
      vi.advanceTimersByTime(150);
    });

    act(() => {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    expect(useEditorStore.getState().activeContextualHint).toBeNull();
    // Component should no longer render the bubble
    act(() => {
      root.render(createElement(ContextualHintOverlay));
    });
    expect(container.querySelector('[data-testid="contextual-hint"]')).toBeNull();
  });

  it('pointerdown within debounce window does NOT clear hint', () => {
    vi.useFakeTimers();
    render();
    act(() => {
      useEditorStore.getState().setActiveContextualHint('Paint your skin');
    });

    // Fire pointerdown before the 100ms debounce passes
    act(() => {
      vi.advanceTimersByTime(50);
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    // Hint should still be set because listener wasn't installed yet
    expect(useEditorStore.getState().activeContextualHint).toBe('Paint your skin');
  });

  it('hint change A → B updates in-place without re-mounting', () => {
    render();
    act(() => {
      useEditorStore.getState().setActiveContextualHint('Hint A');
    });
    const elA = container.querySelector('[data-testid="contextual-hint"]');
    expect(elA?.textContent).toContain('Hint A');

    act(() => {
      useEditorStore.getState().setActiveContextualHint('Hint B');
    });
    const elB = container.querySelector('[data-testid="contextual-hint"]');
    expect(elB).not.toBeNull();
    expect(elB?.textContent).toContain('Hint B');
    // Same DOM node (parent container) — no full remount
    expect(container.querySelector('[data-testid="contextual-hint"]')).toBe(elB);
  });
});
