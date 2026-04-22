// @vitest-environment jsdom
//
// M8 Unit 6: luminance pill + L hotkey wiring.
//
// EditorLayout's full keydown listener is covered by tests/undo-shortcuts,
// so these tests focus on:
//   - the pill renders only when luminanceEnabled === true
//   - store setter idempotency (already covered in export.test.ts but
//     re-validated here as regression coverage for the hotkey path)

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LuminanceToggle } from '../app/editor/_components/LuminanceToggle';
import { useEditorStore } from '../lib/editor/store';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('LuminanceToggle pill', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useEditorStore.setState({ luminanceEnabled: false });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  const render = () =>
    act(() => {
      root.render(<LuminanceToggle />);
    });

  const pill = () =>
    document.querySelector('[data-testid="luminance-pill"]') as HTMLElement | null;

  it('does not render when luminanceEnabled === false', () => {
    render();
    expect(pill()).toBeNull();
  });

  it('renders when luminanceEnabled === true', () => {
    useEditorStore.setState({ luminanceEnabled: true });
    render();
    expect(pill()).not.toBeNull();
  });

  it('announces via role=status + aria-live=polite', () => {
    useEditorStore.setState({ luminanceEnabled: true });
    render();
    const el = pill()!;
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('applies the slide-in animation', () => {
    useEditorStore.setState({ luminanceEnabled: true });
    render();
    const el = pill()!;
    expect(el.style.animation).toContain('luminance-pill-slide-in');
  });

  it('unmounts when the flag flips back to false', () => {
    useEditorStore.setState({ luminanceEnabled: true });
    render();
    expect(pill()).not.toBeNull();
    act(() => {
      useEditorStore.setState({ luminanceEnabled: false });
    });
    expect(pill()).toBeNull();
  });
});

describe('setLuminanceEnabled — narrow selector', () => {
  it('setting the same value does not replace the store slot identity', () => {
    useEditorStore.setState({ luminanceEnabled: true });
    const before = useEditorStore.getState();
    useEditorStore.getState().setLuminanceEnabled(true);
    const after = useEditorStore.getState();
    // Identity-preserving when no change — Zustand `prev` returned as-is.
    expect(after.luminanceEnabled).toBe(true);
    expect(after).toBe(before);
  });

  it('flipping triggers a state change', () => {
    useEditorStore.setState({ luminanceEnabled: false });
    useEditorStore.getState().setLuminanceEnabled(true);
    expect(useEditorStore.getState().luminanceEnabled).toBe(true);
  });
});
